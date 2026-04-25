/**
 * =============================================================================
 * 程序化音频模块（无外部 mp3/wav，全部 Web Audio API 合成）
 * =============================================================================
 * 浏览器策略：AudioContext 初始为 suspended，必须在用户点击等手势里调用 unlock() 后
 * 才能稳定发声。游戏内在「开始」「按钮」等回调里 await unlock()。
 *
 * 结构：总线 master → 分支 bgmGain（循环八音旋律）与 sfxGain（短音效）；音量见 getVolumePercent / setVolumePercent。
 * 对外暴露 window.GameAudio，方法名与 game.js 中 snd()?.xxx() 一一对应。
 * =============================================================================
 */
window.GameAudio = (() => {
  /** Web Audio 主上下文，懒创建 */
  let ctx = null;
  /** 总输出增益，接 destination */
  let master = null;
  /** 音效总线 */
  let sfxGain = null;
  /** BGM 总线（音量略低于 SFX） */
  let bgmGain = null;
  /** setInterval 句柄，用于每拍触发 bgmTick */
  let bgmTimer = null;
  /** 旋律步进下标，循环 MELODY 长度 */
  let bgmStep = 0;
  /** 是否允许 bgmTick 发声（stopBgm 会关掉） */
  let bgmEnabled = false;

  /** 主旋律音高序列（Hz），与 BASS 同长度一一对位 */
  const MELODY = [196, 262, 233, 220, 196, 174, 196, 247];
  /** 低音层音高（Hz） */
  const BASS = [98, 98, 87, 82, 98, 73, 98, 82];

  /** localStorage：{ bgmPct, sfxPct } 各 0～100，映射到下方总线最大增益 */
  const AUDIO_VOL_STORAGE_KEY = "mc_block_jump_audio_vol_v1";
  /** BGM 总线在 100% 时的 gain（拍内音符仍受此母线衰减） */
  const BGM_BUS_MAX = 0.55;
  /** SFX 总线在 100% 时的 gain */
  const SFX_BUS_MAX = 1.25;

  function clampVolPct(n) {
    return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
  }

  function loadStoredVolumePercents() {
    try {
      const raw = localStorage.getItem(AUDIO_VOL_STORAGE_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        return {
          bgmPct: clampVolPct(o.bgmPct ?? 36),
          sfxPct: clampVolPct(o.sfxPct ?? 74),
        };
      }
    } catch (_) {}
    return { bgmPct: 36, sfxPct: 74 };
  }

  function saveStoredVolumePercents(bgmPct, sfxPct) {
    try {
      localStorage.setItem(
        AUDIO_VOL_STORAGE_KEY,
        JSON.stringify({
          bgmPct: clampVolPct(bgmPct),
          sfxPct: clampVolPct(sfxPct),
        })
      );
    } catch (_) {}
  }

  function volumePctToBgmGain(pct) {
    return (clampVolPct(pct) / 100) * BGM_BUS_MAX;
  }

  function volumePctToSfxGain(pct) {
    return (clampVolPct(pct) / 100) * SFX_BUS_MAX;
  }

  /** 懒初始化 AudioContext、Gain 节点树；多次调用返回同一 ctx */
  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.42;
      master.connect(ctx.destination);

      const v0 = loadStoredVolumePercents();
      bgmGain = ctx.createGain();
      bgmGain.gain.value = volumePctToBgmGain(v0.bgmPct);
      bgmGain.connect(master);

      sfxGain = ctx.createGain();
      sfxGain.gain.value = volumePctToSfxGain(v0.sfxPct);
      sfxGain.connect(master);
    }
    return ctx;
  }

  /** 读取当前 BGM/SFX 音量百分比（0～100） */
  function getVolumePercent() {
    getCtx();
    if (!bgmGain || !sfxGain) return { bgmPct: 36, sfxPct: 74 };
    return {
      bgmPct: clampVolPct((bgmGain.gain.value / BGM_BUS_MAX) * 100),
      sfxPct: clampVolPct((sfxGain.gain.value / SFX_BUS_MAX) * 100),
    };
  }

  /**
   * 设置 BGM/SFX 母线音量（0～100），立即写入 gain 并持久化。
   * @param {{ bgmPct?: number, sfxPct?: number }} p 可只传其一，未传项保持当前值
   */
  function setVolumePercent(p) {
    getCtx();
    const cur = getVolumePercent();
    const bgmPct = p.bgmPct != null ? clampVolPct(p.bgmPct) : cur.bgmPct;
    const sfxPct = p.sfxPct != null ? clampVolPct(p.sfxPct) : cur.sfxPct;
    if (bgmGain) bgmGain.gain.value = volumePctToBgmGain(bgmPct);
    if (sfxGain) sfxGain.gain.value = volumePctToSfxGain(sfxPct);
    saveStoredVolumePercents(bgmPct, sfxPct);
  }

  /** 用户手势后恢复 AudioContext（从 suspended → running） */
  async function unlock() {
    const c = getCtx();
    if (c.state === "suspended") {
      await c.resume();
    }
  }

  /** 停止 BGM 定时器，避免重复 setInterval */
  function clearBgmTimer() {
    if (bgmTimer) {
      clearInterval(bgmTimer);
      bgmTimer = null;
    }
  }

  /**
   * 播放一段包络振荡音：attack 起音、指数衰减到 0；可选 freqEnd 滑音。
   * @param {object} o 参数对象
   */
  function playOsc({
    freq,
    type = "square",
    dur = 0.08,
    vol = 0.12,
    attack = 0.005,
    freqEnd,
    when = 0,
    dest,
  }) {
    const c = getCtx();
    const t0 = c.currentTime + when;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd != null) {
      o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(dest || sfxGain);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  /** 白噪声短 burst，经低通，用于受击/爆炸质感 */
  function noiseBurst(dur = 0.14, vol = 0.24) {
    const c = getCtx();
    const t0 = c.currentTime;
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const f = c.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 880;
    src.connect(f);
    f.connect(g);
    g.connect(sfxGain);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /** BGM 一拍：三角波旋律 + 正弦低音，步进 bgmStep */
  function bgmTick() {
    if (!bgmEnabled || !ctx || ctx.state !== "running") return;
    const c = ctx;
    const t0 = c.currentTime;
    const i = bgmStep % MELODY.length;
    const f1 = MELODY[i];
    const f2 = BASS[i];

    const o1 = c.createOscillator();
    o1.type = "triangle";
    o1.frequency.setValueAtTime(f1, t0);
    const g1 = c.createGain();
    g1.gain.setValueAtTime(0.0001, t0);
    g1.gain.linearRampToValueAtTime(0.07, t0 + 0.02);
    g1.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    o1.connect(g1);
    g1.connect(bgmGain);
    o1.start(t0);
    o1.stop(t0 + 0.2);

    const o2 = c.createOscillator();
    o2.type = "sine";
    o2.frequency.setValueAtTime(f2, t0);
    const g2 = c.createGain();
    g2.gain.setValueAtTime(0.0001, t0);
    g2.gain.linearRampToValueAtTime(0.1, t0 + 0.03);
    g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    o2.connect(g2);
    g2.connect(bgmGain);
    o2.start(t0);
    o2.stop(t0 + 0.25);

    bgmStep += 1;
  }

  /** 开始循环 BGM（需 ctx 已在 running 状态） */
  function startBgm() {
    const c = getCtx();
    if (c.state !== "running") return;
    bgmEnabled = true;
    clearBgmTimer();
    bgmTimer = setInterval(bgmTick, 210);
    bgmTick();
  }

  /** 停止 BGM 循环与内部标志 */
  function stopBgm() {
    bgmEnabled = false;
    clearBgmTimer();
  }

  /** 页签隐藏时停 BGM 节电；回到前台且之前在播则恢复 */
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) {
      clearBgmTimer();
    } else {
      await unlock();
      if (bgmEnabled) {
        bgmTimer = setInterval(bgmTick, 210);
        bgmTick();
      }
    }
  });

  /** 左右脚交替：轻噪声 + 短三角音，模拟草地/土上小步 */
  let footstepAlt = false;
  function footstep() {
    try {
      footstepAlt = !footstepAlt;
      const base = footstepAlt ? 92 : 118;
      noiseBurst(0.024, 0.1);
      playOsc({
        freq: base,
        type: "triangle",
        dur: 0.042,
        vol: 0.1,
        freqEnd: base * 0.52,
      });
    } catch (_) {}
  }

  /** 跳跃音效；二段跳略高略短 */
  function jump(isDouble) {
    try {
      playOsc({
        freq: isDouble ? 520 : 380,
        type: "square",
        dur: 0.07,
        vol: 0.11,
        freqEnd: isDouble ? 780 : 640,
      });
    } catch (_) {}
  }

  /** 对幻翼射击：短促方波下滑音 */
  function shoot() {
    try {
      playOsc({
        freq: 720,
        type: "square",
        dur: 0.055,
        vol: 0.09,
        freqEnd: 380,
      });
    } catch (_) {}
  }

  /** 骷髅弓手拉弓射箭：略低、短促的弦音 */
  function skeletonBow() {
    try {
      playOsc({
        freq: 420,
        type: "triangle",
        dur: 0.045,
        vol: 0.075,
        freqEnd: 260,
      });
    } catch (_) {}
  }

  /** 骷髅箭命中（仅击退、无伤害）：轻噪声 */
  function skeletonArrowKnock() {
    try {
      noiseBurst(0.05, 0.07);
    } catch (_) {}
  }

  /** 骷髅被击毁（飞弹或近战）：碎裂感短噪声 + 偏高衰减音 */
  function skeletonKill() {
    try {
      noiseBurst(0.07, 0.1);
      playOsc({
        freq: 620,
        type: "triangle",
        dur: 0.08,
        vol: 0.09,
        freqEnd: 220,
      });
    } catch (_) {}
  }

  /** 飞弹命中幻翼：三角波 + 短噪声 */
  function phantomHit() {
    try {
      playOsc({
        freq: 520,
        type: "triangle",
        dur: 0.09,
        vol: 0.1,
        freqEnd: 180,
      });
      noiseBurst(0.05, 0.07);
    } catch (_) {}
  }

  /** 砍刀击杀苦力怕：低频方波 + 噪声 */
  function creeperKill() {
    try {
      noiseBurst(0.08, 0.12);
      playOsc({
        freq: 95,
        type: "square",
        dur: 0.1,
        vol: 0.12,
        freqEnd: 42,
      });
    } catch (_) {}
  }

  /** 拾取蓝钻：双音高叠加大致「叮」感 */
  function diamond() {
    try {
      playOsc({
        freq: 784,
        type: "triangle",
        dur: 0.08,
        vol: 0.1,
        when: 0,
      });
      playOsc({
        freq: 1046,
        type: "triangle",
        dur: 0.1,
        vol: 0.09,
        when: 0.05,
      });
    } catch (_) {}
  }

  /** 碰到终点红钻：偏低主音 + 偏高点缀 */
  function redGoal() {
    try {
      playOsc({
        freq: 392,
        type: "square",
        dur: 0.07,
        vol: 0.12,
        freqEnd: 622,
      });
      playOsc({
        freq: 880,
        type: "triangle",
        dur: 0.12,
        vol: 0.11,
        when: 0.06,
      });
    } catch (_) {}
  }

  /** 被敌人碰到扣血：噪声 + 锯齿下滑 */
  function hurt() {
    try {
      noiseBurst(0.13, 0.22);
      playOsc({
        freq: 150,
        type: "sawtooth",
        dur: 0.18,
        vol: 0.11,
        attack: 0.008,
        freqEnd: 50,
      });
    } catch (_) {}
  }

  /** 生命归零 / 死亡确认前：偏长的下沉感 */
  function death() {
    try {
      const c = getCtx();
      const t0 = c.currentTime;
      noiseBurst(0.32, 0.34);
      playOsc({
        freq: 200,
        type: "sawtooth",
        dur: 0.52,
        vol: 0.15,
        attack: 0.025,
        freqEnd: 32,
      });
      playOsc({
        freq: 165,
        type: "square",
        dur: 0.35,
        vol: 0.09,
        when: 0.12,
        freqEnd: 55,
      });
    } catch (_) {}
  }

  /** 单关结算（进入下一关） */
  function levelClear() {
    try {
      const c = getCtx();
      const t0 = c.currentTime;
      const ns = [784, 988, 1174, 1318];
      ns.forEach((f, i) => {
        playOsc({
          freq: f,
          type: "triangle",
          dur: 0.1,
          vol: 0.1,
          when: i * 0.068,
        });
      });
    } catch (_) {}
  }

  /** 全部通关结算：前奏 + 主旋律 */
  function win() {
    try {
      const c = getCtx();
      const t0 = c.currentTime;
      const lead = [392, 523, 659, 784];
      lead.forEach((f, i) => {
        playOsc({
          freq: f,
          type: "triangle",
          dur: 0.1,
          vol: 0.1,
          when: i * 0.055,
        });
      });
      const leadEnd = 0.24;
      const notes = [523, 659, 784, 1046, 784, 1046, 1318];
      let acc = leadEnd;
      for (const f of notes) {
        const o = c.createOscillator();
        o.type = "square";
        const g = c.createGain();
        const start = t0 + acc;
        o.frequency.setValueAtTime(f, start);
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(0.11, start + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);
        o.connect(g);
        g.connect(sfxGain);
        o.start(start);
        o.stop(start + 0.13);
        acc += 0.095;
      }
    } catch (_) {}
  }

  /** 对外 API：game.js 通过 snd()?.方法名() 调用；全部 try 包裹避免静音环境下抛错 */
  return {
    unlock,
    startBgm,
    stopBgm,
    getVolumePercent,
    setVolumePercent,
    jump,
    footstep,
    shoot,
    skeletonBow,
    skeletonArrowKnock,
    skeletonKill,
    phantomHit,
    creeperKill,
    diamond,
    redGoal,
    hurt,
    death,
    levelClear,
    win,
  };
})();
