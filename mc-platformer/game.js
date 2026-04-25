/**
 * =============================================================================
 * 《方块跳跃》主游戏脚本（MC 风格 2D 卷轴平台跳跃）
 * =============================================================================
 * 运行环境：浏览器 + Canvas 2D；与 index.html 约定 id；音效由 audio.js 暴露的
 * window.GameAudio 提供（需用户点击等手势后 unlock 音频上下文）。
 *
 * 【状态机 state】
 * - menu：游戏首页（开始游戏 / 游戏排行榜；回车等同「开始游戏」）
 * - leaderboard：游戏排行榜页（Top10 本地通关记录），返回后回到 menu
 * - weapon_select：武器外观（射击 / 砍刀各 5 种样式 + 鞘翅颜色），本地保存，返回 menu
 * - settings：游戏设置（背景音乐 / 音效音量滑条），返回 menu
 * - play：正常游玩（物理、敌人、拾取在此状态更新）
 * - gameover：「生命」归零，显示「游戏失败」结算页（可回车或点击从第一关重来）
 * - intermission：过关结算，点「下一关」或回车进下一关
 * - win：五关通关，显示排行榜与「再玩一次」
 *
 * 【世界与镜头】
 * - 所有实体使用世界坐标；渲染时屏幕 x = 世界 x - camX。
 * - camX 为镜头左缘；跟随玩家，夹在 [0, maxCamX] 避免卷轴穿帮。
 *
 * 【每帧顺序（play 时）】resolvePlayer → updateCollectibles → 绘制（含抖动/闪红）
 * =============================================================================
 */
(() => {
  /** 取全局音效模块（未加载 audio.js 时返回 undefined，调用处用可选链） */
  const snd = () => window.GameAudio;

  // --- DOM 引用：与 index.html 中元素 id 一一对应 ---
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const hpEl = document.getElementById("hp");
  const lifeStockEl = document.getElementById("life-stock");
  const levelEl = document.getElementById("level");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayMsg = document.getElementById("overlay-msg");
  const overlayBtn = document.getElementById("overlay-btn");
  const overlayBtnSecondary = document.getElementById("overlay-btn-secondary");
  const overlayBtnTertiary = document.getElementById("overlay-btn-tertiary");
  const overlayBtnSettings = document.getElementById("overlay-btn-settings");
  const overlayActions = document.getElementById("overlay-actions");
  /** 遮罩内主面板：点击标题/说明等空白处与点主按钮等效（避免点按钮时重复触发） */
  const overlayCard = overlay.querySelector(".card");
  const restartBtn = document.getElementById("restart");
  const timeEl = document.getElementById("timer");
  const ammoEl = document.getElementById("ammo");

  /** 画布像素尺寸（与 canvas 属性一致，用于碰撞与 UI 布局） */
  const W = canvas.width;
  const H = canvas.height;
  /** 关卡格子边长（像素），平台在 LEVELS 里用「格」填写再乘 TILE 转世界坐标 */
  const TILE = 48;
  /** 单局「血量」上限；每次受伤扣 1，扣尽时消耗 1 点「生命」并补满血量（若生命仍有余） */
  const MAX_HP = 6;
  /** 「生命」条数；用尽时游戏结束并从第一关整局重开 */
  const MAX_PLAYER_LIFE_STOCK = 5;

  /** 画布绘制用色板：天空、地形、史蒂夫、苦力怕、幻翼、宝石、飞弹与砍刀等 */
  const COLORS = {
    skyTop: "#87ceeb",
    skyBot: "#b8e0f4",
    grassTop: "#7cb342",
    grassSide: "#558b2f",
    dirt: "#6d4c41",
    stone: "#9e9e9e",
    stoneDark: "#757575",
    plank: "#bcaaa4",
    diamond: "#00e5ff",
    diamondShine: "#fff",
    redDiamond: "#e53935",
    redDiamondCore: "#ff7043",
    redDiamondShine: "#ffecb3",
    steveShirt: "#1565c0",
    steveShirtDark: "#0d47a1",
    stevePants: "#283593",
    steveSkin: "#ffcc80",
    creeper: "#33691e",
    creeperFace: "#1b5e20",
    creeperLight: "#558b2f",
    creeperDark: "#1b5e20",
    phantomBody: "#2c2c44",
    phantomBodyLight: "#3d3d5c",
    phantomWing: "#5c4d7a",
    phantomWingEdge: "#7e5fa8",
    phantomEye: "#00e5d0",
    phantomEyeCore: "#b388ff",
    skeletonBone: "#eceff1",
    skeletonBoneDim: "#b0bec5",
    skeletonJoint: "#78909c",
    skeletonBow: "#5d4037",
    skeletonBowStr: "#8d6e63",
    steveHair: "#3e2723",
    steveEye: "#263238",
    boltCore: "#ff8a80",
    boltGlow: "#d50000",
    knifeBlade: "#42a5f5",
    knifeEdge: "#bbdefb",
    knifeHilt: "#1565c0",
  };

  // --- 键盘：持续按住的方向键存在 Set 中；跳跃/射击用边沿触发标志避免长按连发 ---
  const keys = new Set();
  /** 由 keydown 触发（忽略长按连发），每帧最多消耗一次 */
  let jumpPressed = false;
  let shootPressed = false;
  /** 远程射击默认备弹；近战砍苦力怕不消耗弹药 */
  const DEFAULT_AMMO = 10;
  let ammo = DEFAULT_AMMO;
  /** 对幻翼的飞弹列表，世界坐标，每帧位移并与幻翼 AABB 做碰撞 */
  let projectiles = [];
  /** 挥刀动画剩余帧数；大于 0 时 drawKnifeSlash 会绘制刀光 */
  let knifeSwing = 0;
  /** 近战挥砍总帧数（与 tryConsumeShoot / drawSteve / drawKnifeSlash 一致） */
  const STEVE_KNIFE_FRAMES = 20;
  /** 远程射击姿势总帧数 */
  const STEVE_SHOOT_FRAMES = 24;
  /** 地面行走时累计 |vx| 超过该值播一次脚步（与 drawSteve 中 walk 的 vx 阈值一致） */
  const WALK_SFX_DIST_PER_STEP = 34;
  const WALK_SFX_MIN_VX = 0.26;
  /** 行走音效位移累计（仅 play 且贴地行走时递增） */
  let walkSoundAccum = 0;
  /** 远程射击后持枪/后坐力姿势剩余帧（仅影响 drawSteve） */
  let steveShootPose = 0;
  /** 玩家身体矩形与苦力怕矩形各向外膨胀此像素后的重叠即判定为「靠近」可出刀 */
  const CREEPER_MELEE_PAD = 40;
  /**
   * 跳劈：水平「正上方一条带」= 与苦力怕顶面投影对齐的竖条，在苦力怕宽度左右各扩的像素（容差很小）。
   */
  const CREEPER_JUMP_SLASH_STRIPE_PAD = 8;
  /** 跳劈：竖直方向允许高出苦力怕顶缘的像素（仍在条带正上方区域内） */
  const CREEPER_JUMP_SLASH_REACH_UP = 100;
  /** 跳劈：脚底可低于苦力怕顶缘的像素（快落地时仍可劈） */
  const CREEPER_JUMP_SLASH_REACH_DOWN = 72;
  /** 视为「下落中」的最小向下速度，避免起跳瞬间误触 */
  const CREEPER_JUMP_SLASH_MIN_VY = 0.22;
  /** 游戏主状态，见文件头「状态机」说明 */
  let state = "menu";
  let score = 0;
  let hp = MAX_HP;
  /** 剩余生命条数（与 HUD「生命」对应） */
  let lifeStock = MAX_PLAYER_LIFE_STOCK;
  let camX = 0;
  let invuln = 0;
  /** 扣血动效：全屏闪红剩余帧数 */
  let damageFlash = 0;
  /** 扣血时镜头抖动强度（像素量级，每帧衰减） */
  let damageShake = 0;

  /** 玩家史蒂夫：位置、速度、朝向与二段跳剩余次数；与 platforms 做分离轴碰撞 */
  const player = {
    x: 120,
    y: 200,
    w: 28,
    h: 52,
    vx: 0,
    vy: 0,
    onGround: false,
    /** 离地后还可再跳的次数（二段跳 = 1） */
    airJumpsLeft: 1,
    facing: 1,
  };

  // --- 玩家运动学常量（单位：像素与「每帧」速度，与 60fps 设计相匹配） ---
  const gravity = 0.55;
  const jumpV = -12.5;
  const moveAccel = 0.85;
  const maxRun = 5.2;
  const friction = 0.82;
  /** 仅在地面上、|vx| 低于此值时水平加速度打折（离地后恢复满加速度，方便跳远） */
  const runSoftSpeed = 2.2;
  const runSoftMul = 0.36;
  /** 地面起跳时若已按左右且速度仍偏低，补足水平速度（像素/帧量级），避免软起步导致跳不过沟 */
  const jumpRunCarry = 2.9;
  /** 空中水平摩擦略小于地面，抛物更远、手感更顺 */
  const airFriction = 0.92;
  /** 鞘翅缓降：二段跳用尽后下落阶段重力乘数（相对 gravity） */
  const ELYTRA_GRAVITY_MUL = 0.27;
  /** 鞘翅滑翔时竖直下落速度上限（像素/帧） */
  const ELYTRA_MAX_FALL_VY = 2.55;
  /** 竖直速度大于该值才进入鞘翅缓降（避免二段跳上升段误触发） */
  const ELYTRA_GLIDE_MIN_VY = 0.1;

  // --- 关卡运行时实体列表（由 loadLevel 重建） ---
  /** 不可动平台矩形：x,y,w,h,type（grass | stone | plank） */
  let platforms = [];
  /** 蓝钻；taken 为 true 表示已拾取 */
  let diamonds = [];
  /** 苦力怕：x,y,w,h,vx,minX,maxX,facing；在 minX~maxX 间往返巡逻 */
  let creepers = [];
  /** 幻翼：带 vx,vy,phase 做追击与抖动；数量受 phantomLevelCap 与冷却限制 */
  let phantoms = [];
  /** 毫秒累计；≤0 且本关已生成数未达上限时刷下一只幻翼（进关后从 0 起逐只出现） */
  let phantomSpawnCooldown = 0;
  /** 本关已生成幻翼只数（含已击杀），达到 phantomLevelCap 后不再生成 */
  let phantomsSpawnedTotal = 0;
  /** 每关幻翼生成名额上限（见 getEnemyQuotaForLevel）；打死后不刷新，用 phantomsSpawnedTotal 计数 */
  let phantomLevelCap = 6;
  /** 前四关苦力怕与幻翼各几只 */
  const ENEMIES_PER_LEVEL = 6;
  /** 第一只幻翼出现前的等待（毫秒），进关/重置后场上从 0 只开始递增 */
  const PHANTOM_FIRST_DELAY_MIN = 650;
  const PHANTOM_FIRST_DELAY_MAX = 1300;
  /** 第 2～6 只幻翼：间隔随已有数量递增（毫秒），关卡越靠后略加长 */
  const PHANTOM_STAGGER_BASE = 1900;
  const PHANTOM_STAGGER_PER_SLOT = 420;
  const PHANTOM_STAGGER_JITTER = 480;
  const PHANTOM_LEVEL_STAGGER_EXTRA = 220;
  /**
   * 玩家世界 x 至少超过本关 spawnX 向右该距离后，才视为「已推进关卡」并开始刷新幻翼；
   * 未满足时冷却不计时、不生成（出生点附近不出现幻翼）。
   */
  const PHANTOM_MIN_PROGRESS_FROM_SPAWN = 180;
  /** 上一帧是否已满足幻翼刷新地图条件（用于刚解锁时压缩首只等待） */
  let phantomUnlockPrev = false;
  /** 幻翼朝玩家方向的加速度分量；WOBBLE 为正弦扰动；DAMP 为速度衰减；MAX 为限速 */
  const PH_HUNT_ACCEL = 0.11;
  const PH_WOBBLE_ACCEL = 0.058;
  const PH_DAMP = 0.993;
  const PH_VX_MAX = 3.9;
  const PH_VY_MAX = 2.6;
  /** 骷髅弓手：每关固定 1 只，生成在关卡水平几何中心地面（中心为坑时向两侧找最近可站面）；可被飞弹或近战/跳劈击毁；约 0.5 秒射一箭，箭仅击退不伤血 */
  const SKELETON_ARCHER_W = 36;
  const SKELETON_ARCHER_H = 46;
  const SKELETON_SHOT_INTERVAL_MS = 500;
  /** 单帧最多补射几箭，避免大 dt（切后台）时一帧生成过多箭 */
  const SKELETON_SHOTS_MAX_CATCHUP_PER_FRAME = 12;
  const SKELETON_ARROW_SPEED = 10.4;
  /** 箭矢击退：沿箭方向的冲量（像素/帧量级），不扣血 */
  const SKELETON_ARROW_KNOCK = 9.5;
  /** 当前关骷髅；null 仅当关卡无任何可站平台（极罕见） */
  let skeletonArcher = null;
  /** 骷髅箭：世界坐标中心 x,y，速度 vx,vy，单位方向 nx,ny，半宽半高用于碰撞 */
  let skeletonArrows = [];
  /** 累计毫秒，达到 SKELETON_SHOT_INTERVAL_MS 时射一箭 */
  let skeletonShotTimerMs = 0;
  /** 本关世界左右界（箭飞出回收用），在 loadLevel 写入 */
  let levelWorldLeft = 0;
  let levelWorldRight = 960;
  /** 终点红钻，拾取后过关 */
  let redGoalGem = null;
  const LEVEL_COUNT = 5;
  /** 第 5 关（终关）苦力怕与幻翼生成上限，多于前四关 */
  const ENEMIES_LAST_LEVEL = 10;
  let currentLevel = 1;

  /** 关卡 n 的苦力怕数量与幻翼名额（终关加量） */
  function getEnemyQuotaForLevel(levelN) {
    return levelN === LEVEL_COUNT ? ENEMIES_LAST_LEVEL : ENEMIES_PER_LEVEL;
  }
  /** 终关（第 5 关）远程飞弹不扣弹药（内部用 Infinity 表示） */
  function isUnlimitedAmmoLevel(levelN) {
    return levelN === LEVEL_COUNT;
  }
  /** 进入关卡 levelN 时的弹药初值 */
  function startingAmmoForLevel(levelN) {
    return isUnlimitedAmmoLevel(levelN)
      ? Number.POSITIVE_INFINITY
      : DEFAULT_AMMO;
  }
  /** 通关第 1 关后获得鞘翅；本局内保持，整局重开时清除 */
  let hasElytra = false;
  /** 摄像机右边界，避免卷轴露出空白 */
  let maxCamX = 0;

  /** 本局累计游玩时间（毫秒），仅在 state === "play" 时累加 */
  let playTimeMs = 0;
  let lastLoopTs = performance.now();
  /** localStorage 键名：存 JSON 数组，每项含蓝钻数、用时、时间戳等 */
  const RANK_STORAGE_KEY = "mc_block_jump_rank_v1";
  /** localStorage：武器外观 { shoot, knife, elytra } */
  const WEAPON_STYLE_STORAGE_KEY = "mc_block_jump_weapon_style_v1";
  const WEAPON_SHOOT_STYLES = 5;
  const WEAPON_KNIFE_STYLES = 5;
  /** 鞘翅翼膜颜色预设数量（通关第 1 关后滑翔时背部两翼） */
  const WEAPON_ELYTRA_STYLES = 6;
  /** 鞘翅 RGB；fill 用半透明翼膜，stroke 用加深约 0.57 倍的描边 */
  const ELYTRA_PALETTES = [
    { r: 186, g: 104, b: 200 },
    { r: 67, g: 160, b: 71 },
    { r: 229, g: 57, b: 53 },
    { r: 255, g: 193, b: 7 },
    { r: 41, g: 182, b: 246 },
    { r: 158, g: 158, b: 158 },
  ];
  /** 射击飞弹外观下标（与 tryConsumeShoot 写入 projectiles.weaponStyle 一致） */
  let weaponShootStyle = 0;
  /** 砍刀挥砍外观下标 */
  let weaponKnifeStyle = 0;
  /** 鞘翅颜色预设下标（与 ELYTRA_PALETTES 一致） */
  let weaponElytraStyle = 0;

  function elytraColorsForStyle(idx) {
    const n = Number(idx);
    const i = Math.max(
      0,
      Math.min(WEAPON_ELYTRA_STYLES - 1, Number.isFinite(n) ? n : 0)
    );
    const c = ELYTRA_PALETTES[i];
    const dr = Math.max(0, Math.min(255, Math.floor(c.r * 0.57)));
    const dg = Math.max(0, Math.min(255, Math.floor(c.g * 0.57)));
    const db = Math.max(0, Math.min(255, Math.floor(c.b * 0.57)));
    return {
      fill: `rgba(${c.r},${c.g},${c.b},0.62)`,
      stroke: `rgba(${dr},${dg},${db},0.45)`,
    };
  }

  /**
   * 将毫秒数格式化为 HUD 用短字符串 m:ss（用于计时器与结算）。
   * @param {number} ms 游玩累计毫秒
   * @returns {string} 如 "3:05"
   */
  function formatTimeShort(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  /**
   * 排行榜条目写入时间戳格式化为 YYYY-MM-DD（仅展示用）。
   * @param {number} ts `Date.now()` 毫秒
   */
  function formatRankDate(ts) {
    if (ts == null || !Number.isFinite(ts)) return "—";
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function loadWeaponStyles() {
    try {
      const raw = localStorage.getItem(WEAPON_STYLE_STORAGE_KEY);
      if (!raw) return;
      const o = JSON.parse(raw);
      weaponShootStyle = Math.max(
        0,
        Math.min(WEAPON_SHOOT_STYLES - 1, Number(o.shoot) || 0)
      );
      weaponKnifeStyle = Math.max(
        0,
        Math.min(WEAPON_KNIFE_STYLES - 1, Number(o.knife) || 0)
      );
      weaponElytraStyle = Math.max(
        0,
        Math.min(WEAPON_ELYTRA_STYLES - 1, Number(o.elytra) || 0)
      );
    } catch (_) {}
  }

  function saveWeaponStyles() {
    try {
      localStorage.setItem(
        WEAPON_STYLE_STORAGE_KEY,
        JSON.stringify({
          shoot: weaponShootStyle,
          knife: weaponKnifeStyle,
          elytra: weaponElytraStyle,
        })
      );
    } catch (_) {}
  }

  /**
   * 将用户/关卡名等插入 innerHTML 前做最小转义，防止 XSS（结算里拼接 HTML 用）。
   * @param {string} str 原始文本
   * @returns {string} 转义后的安全字符串
   */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** 把当前 playTimeMs 同步到页眉 #timer 元素 */
  function updateTimerHud() {
    if (timeEl) timeEl.textContent = formatTimeShort(playTimeMs);
  }

  /**
   * 写入一条通关记录到本地排行榜：蓝钻降序、用时升序；只保留前 24 条。
   * @param {number} diamonds 本局蓝钻总数
   * @param {number} timeMs 本局累计用时毫秒
   * @returns {{ list: object[], rank: number, entry: object }}
   */
  function addRankingEntry(diamonds, timeMs) {
    const entry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      diamonds,
      timeMs,
      at: Date.now(),
    };
    let list = [];
    try {
      const raw = localStorage.getItem(RANK_STORAGE_KEY);
      if (raw) list = JSON.parse(raw);
    } catch (_) {
      list = [];
    }
    if (!Array.isArray(list)) list = [];
    list.push(entry);
    list.sort((a, b) => {
      if (b.diamonds !== a.diamonds) return b.diamonds - a.diamonds;
      return a.timeMs - b.timeMs;
    });
    const rank = list.findIndex((e) => e.id === entry.id) + 1;
    list = list.slice(0, 24);
    try {
      localStorage.setItem(RANK_STORAGE_KEY, JSON.stringify(list));
    } catch (_) {}
    return { list, rank, entry };
  }

  /**
   * 从 localStorage 读取排行榜（不写回），按蓝钻降序、用时升序，最多 24 条。
   * @returns {object[]}
   */
  function loadRankListFromStorage() {
    let list = [];
    try {
      const raw = localStorage.getItem(RANK_STORAGE_KEY);
      if (raw) list = JSON.parse(raw);
    } catch (_) {
      list = [];
    }
    if (!Array.isArray(list)) list = [];
    list.sort((a, b) => {
      if (b.diamonds !== a.diamonds) return b.diamonds - a.diamonds;
      return a.timeMs - b.timeMs;
    });
    return list.slice(0, 24);
  }

  /** 非首页遮罩：隐藏第二按钮并取消首页双按钮布局与排行榜加宽样式 */
  function hideOverlayHomeChrome() {
    if (overlayCard) {
      overlayCard.classList.remove("card--leaderboard");
      overlayCard.classList.remove("card--settings");
    }
    if (overlayBtnSecondary) {
      overlayBtnSecondary.classList.add("hidden");
      overlayBtnSecondary.onclick = null;
    }
    if (overlayBtnTertiary) {
      overlayBtnTertiary.classList.add("hidden");
      overlayBtnTertiary.onclick = null;
    }
    if (overlayBtnSettings) {
      overlayBtnSettings.classList.add("hidden");
      overlayBtnSettings.onclick = null;
    }
    if (overlayActions) overlayActions.classList.remove("overlay-actions--home");
  }

  /**
   * 游戏首页：说明文案 +「开始游戏」「游戏排行榜」「武器外观」「游戏设置」。
   */
  function showHomePage() {
    hideOverlayHomeChrome();
    state = "menu";
    overlayTitle.classList.remove("overlay-title--fail");
    overlayTitle.textContent = "方块跳跃";
    overlayMsg.textContent = getIntroOverlayHelpMessage();
    overlayBtn.textContent = "开始游戏";
    if (overlayBtnSecondary) {
      overlayBtnSecondary.textContent = "游戏排行榜";
      overlayBtnSecondary.classList.remove("hidden");
    }
    if (overlayBtnTertiary) {
      overlayBtnTertiary.textContent = "武器外观";
      overlayBtnTertiary.classList.remove("hidden");
    }
    if (overlayBtnSettings) {
      overlayBtnSettings.textContent = "游戏设置";
      overlayBtnSettings.classList.remove("hidden");
    }
    if (overlayActions) overlayActions.classList.add("overlay-actions--home");
    overlay.classList.remove("hidden");
    overlayBtn.onclick = async () => {
      if (snd()) {
        await snd().unlock();
      }
      overlay.classList.add("hidden");
      hideOverlayHomeChrome();
      state = "play";
      resetGame(true);
      snd()?.startBgm();
    };
    if (overlayBtnSecondary) {
      overlayBtnSecondary.onclick = async () => {
        if (snd()) {
          await snd().unlock();
        }
        showLeaderboardPage();
      };
    }
    if (overlayBtnTertiary) {
      overlayBtnTertiary.onclick = async () => {
        if (snd()) {
          await snd().unlock();
        }
        showWeaponSelectPage();
      };
    }
    if (overlayBtnSettings) {
      overlayBtnSettings.onclick = async () => {
        if (snd()) {
          await snd().unlock();
        }
        showSettingsPage();
      };
    }
  }

  /**
   * 游戏设置：背景音乐与音效音量（0～100%），写入 audio 模块 localStorage。
   */
  function showSettingsPage() {
    state = "settings";
    overlayTitle.classList.remove("overlay-title--fail");
    overlayTitle.textContent = "游戏设置";
    hideOverlayHomeChrome();
    if (overlayCard) overlayCard.classList.add("card--settings");
    const vol = snd()?.getVolumePercent?.() ?? { bgmPct: 36, sfxPct: 74 };
    const bgmPct = vol.bgmPct;
    const sfxPct = vol.sfxPct;
    overlayMsg.innerHTML = `
      <div class="settings-page">
        <p class="settings-lead">拖动滑块调节音量，设置保存在本机浏览器。</p>
        <div class="settings-row">
          <div class="settings-row-head">
            <span class="settings-label">背景音乐</span>
            <span class="settings-val" id="settings-bgm-val">${bgmPct}%</span>
          </div>
          <input type="range" id="settings-bgm" class="settings-range" min="0" max="100" value="${bgmPct}" aria-label="背景音乐音量" />
        </div>
        <div class="settings-row">
          <div class="settings-row-head">
            <span class="settings-label">音效</span>
            <span class="settings-val" id="settings-sfx-val">${sfxPct}%</span>
          </div>
          <input type="range" id="settings-sfx" class="settings-range" min="0" max="100" value="${sfxPct}" aria-label="音效音量" />
        </div>
        <p class="settings-foot">音效含脚步、射击、受击、拾取等；背景音乐为循环八音旋律。</p>
      </div>
    `;
    overlayBtn.textContent = "返回首页";
    overlay.classList.remove("hidden");
    overlayBtn.onclick = async () => {
      if (snd()) {
        await snd().unlock();
      }
      showHomePage();
    };
    const bgmEl = overlayMsg.querySelector("#settings-bgm");
    const sfxEl = overlayMsg.querySelector("#settings-sfx");
    const bgmLab = overlayMsg.querySelector("#settings-bgm-val");
    const sfxLab = overlayMsg.querySelector("#settings-sfx-val");
    const pushVol = () => {
      const b = Number(bgmEl?.value ?? bgmPct);
      const s = Number(sfxEl?.value ?? sfxPct);
      if (bgmLab) bgmLab.textContent = `${b}%`;
      if (sfxLab) sfxLab.textContent = `${s}%`;
      snd()?.setVolumePercent?.({ bgmPct: b, sfxPct: s });
    };
    if (bgmEl) bgmEl.addEventListener("input", pushVol);
    if (sfxEl) sfxEl.addEventListener("input", pushVol);
  }

  /**
   * 武器外观页：射击 / 砍刀各 5 种样式 + 鞘翅颜色，写入 localStorage 并刷新本页选中态。
   */
  function showWeaponSelectPage() {
    state = "weapon_select";
    overlayTitle.classList.remove("overlay-title--fail");
    overlayTitle.textContent = "武器外观";
    hideOverlayHomeChrome();
    const shootLabels = [
      "炽红能量",
      "翡翠碎片",
      "虚空粒子",
      "琥珀熔核",
      "霜晶脉冲",
    ];
    const knifeLabels = [
      "霜蓝弧刃",
      "紫电斩击",
      "锻金阔刃",
      "赤焰阔斩",
      "青藤长刃",
    ];
    const shootBtns = Array.from({ length: WEAPON_SHOOT_STYLES }, (_, i) => i)
      .map(
        (i) =>
          `<button type="button" class="weapon-opt${weaponShootStyle === i ? " weapon-opt--selected" : ""}" data-weapon="shoot" data-idx="${i}">${shootLabels[i]}</button>`
      )
      .join("");
    const knifeBtns = Array.from({ length: WEAPON_KNIFE_STYLES }, (_, i) => i)
      .map(
        (i) =>
          `<button type="button" class="weapon-opt${weaponKnifeStyle === i ? " weapon-opt--selected" : ""}" data-weapon="knife" data-idx="${i}">${knifeLabels[i]}</button>`
      )
      .join("");
    const elytraLabels = [
      "紫韵",
      "翠青",
      "赤焰",
      "琥珀",
      "霜蓝",
      "银灰",
    ];
    const elytraBtns = Array.from({ length: WEAPON_ELYTRA_STYLES }, (_, i) => i)
      .map((i) => {
        const sel = weaponElytraStyle === i ? " weapon-opt--selected" : "";
        const c = ELYTRA_PALETTES[i];
        const ec = elytraColorsForStyle(i);
        const face = `rgb(${c.r},${c.g},${c.b})`;
        return `<button type="button" class="weapon-opt weapon-opt--elytra${sel}" data-weapon="elytra" data-idx="${i}"><span class="weapon-opt-swatch" style="background:${face};box-shadow:inset 0 0 0 2px ${ec.stroke}" aria-hidden="true"></span>${elytraLabels[i]}</button>`;
      })
      .join("");
    overlayMsg.innerHTML = `
      <div class="weapon-select-page">
        <p class="weapon-select-lead">选择射击飞弹与砍刀的<strong>画面样式</strong>（各 5 种），以及鞘翅<strong>翼膜颜色</strong>（通关第 1 关获得鞘翅后在空中滑翔时可见）。已发射的飞弹保持发射时样式；新开局即生效。</p>
        <div class="weapon-select-section">
          <h3 class="weapon-select-heading">射击（对幻翼飞弹）</h3>
          <div class="weapon-select-row">${shootBtns}</div>
        </div>
        <div class="weapon-select-section">
          <h3 class="weapon-select-heading">砍刀（近战挥砍）</h3>
          <div class="weapon-select-row">${knifeBtns}</div>
        </div>
        <div class="weapon-select-section">
          <h3 class="weapon-select-heading">鞘翅颜色（滑翔翼膜）</h3>
          <div class="weapon-select-row">${elytraBtns}</div>
        </div>
        <p class="weapon-select-foot">偏好保存在本机浏览器。</p>
      </div>
    `;
    overlayBtn.textContent = "返回首页";
    overlay.classList.remove("hidden");
    overlayBtn.onclick = async () => {
      if (snd()) {
        await snd().unlock();
      }
      showHomePage();
    };
  }

  /**
   * 游戏排行榜页：设计化展示本地 Top10（蓝钻优先、用时次之）；「返回首页」回到 showHomePage。
   */
  function showLeaderboardPage() {
    state = "leaderboard";
    overlayTitle.classList.remove("overlay-title--fail");
    overlayTitle.textContent = "游戏排行榜";
    hideOverlayHomeChrome();
    if (overlayCard) overlayCard.classList.add("card--leaderboard");
    const list = loadRankListFromStorage();
    const top = list.slice(0, 10);
    const rows =
      top.length === 0
        ? ""
        : top
            .map((e, i) => {
              const rank = i + 1;
              const tier =
                rank === 1
                  ? "leaderboard-row--gold"
                  : rank === 2
                    ? "leaderboard-row--silver"
                    : rank === 3
                      ? "leaderboard-row--bronze"
                      : "";
              return `<div class="leaderboard-row ${tier}">
            <span class="leaderboard-cell leaderboard-rank">${rank}</span>
            <span class="leaderboard-cell leaderboard-diamonds">${e.diamonds}</span>
            <span class="leaderboard-cell leaderboard-time">${formatTimeShort(e.timeMs)}</span>
            <span class="leaderboard-cell leaderboard-date">${formatRankDate(e.at)}</span>
          </div>`;
            })
            .join("");
    const body =
      top.length === 0
        ? `<div class="leaderboard-empty">
            <p class="leaderboard-empty-title">暂无记录</p>
            <p class="leaderboard-empty-hint">通关全部 5 关后会将本局成绩写入本地排行榜（最多保留 24 条）。</p>
          </div>`
        : `<div class="leaderboard-table" role="table" aria-label="本地前10名">
            <div class="leaderboard-head" role="row">
              <span>名次</span>
              <span>蓝钻</span>
              <span>用时</span>
              <span>日期</span>
            </div>
            <div class="leaderboard-body">${rows}</div>
          </div>`;
    overlayMsg.innerHTML = `
      <div class="leaderboard-page">
        <div class="leaderboard-hero">
          <p class="leaderboard-kicker">本地保存 · 本机 Top 10</p>
          <p class="leaderboard-top-badge">TOP 10</p>
          <p class="leaderboard-rules">排名规则：蓝钻数量多者优先；蓝钻相同时，通关用时短者优先。</p>
        </div>
        ${body}
      </div>
    `;
    overlayBtn.textContent = "返回首页";
    overlay.classList.remove("hidden");
    overlayBtn.onclick = async () => {
      if (snd()) {
        await snd().unlock();
      }
      showHomePage();
    };
  }

  /**
   * 轴对齐矩形相交判定（玩家、敌人、宝石、飞弹等统一使用 {x,y,w,h}）。
   * @param {{x:number,y:number,w:number,h:number}} a
   * @param {{x:number,y:number,w:number,h:number}} b
   */
  function rectsOverlap(a, b) {
    return (
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y
    );
  }

  /** 宝石底与平台顶面的间距（像素） */
  const GEM_FLOAT_GAP = 10;

  /**
   * 在若干采样竖线上找「最高」的平台顶面 y，用于把宝石摆在土面上方而不是埋进地形。
   * @param {number} xWorld 世界 x（像素）
   * @param {object[]} plats 平台数组
   * @returns {number|null} 顶面 y 或 null
   */
  function highestPlatformTopAtX(xWorld, plats) {
    const xs = [xWorld, xWorld - 14, xWorld + 14, xWorld - 28, xWorld + 28];
    let best = null;
    for (const xw of xs) {
      for (const p of plats) {
        if (xw >= p.x && xw < p.x + p.w) {
          if (best === null || p.y < best) best = p.y;
        }
      }
    }
    return best;
  }

  /**
   * 根据宝石左缘与宽度，计算贴平台顶悬浮的 y；若无平台则用 gyFallback 行换算。
   */
  function makeFloatingGemRect(xLeft, w, h, gyFallback, plats) {
    const cx = xLeft + w / 2;
    const top = highestPlatformTopAtX(cx, plats);
    const y =
      top !== null ? top - GEM_FLOAT_GAP - h : gyFallback * TILE - 28;
    return { x: xLeft, y, w, h };
  }

  const CREEPER_W = 32;
  const CREEPER_H = 40;
  const GEM_W = 18;
  const GEM_H = 18;
  /** 每关蓝钻固定数量，沿关卡宽度均匀分桶放置 */
  const DIAMONDS_PER_LEVEL = 6;

  /** 计算当前关卡所有平台包络的左右世界边界，供幻翼初始散落用 */
  function worldBoundsX(plats) {
    let left = Infinity;
    let right = -Infinity;
    for (const p of plats) {
      left = Math.min(left, p.x);
      right = Math.max(right, p.x + p.w);
    }
    if (left === Infinity) return { left: 0, right: 960 };
    return { left, right };
  }

  /**
   * 出生点禁区：苦力怕与蓝钻不可与此矩形重叠（略大于玩家体积，避免开局贴脸）。
   */
  function spawnExclusionRect(spawnX, spawnY, pw, ph) {
    const padX = 220;
    const padY = 100;
    return {
      x: spawnX - padX,
      y: spawnY - padY,
      w: pw + padX * 2,
      h: ph + padY * 2,
    };
  }

  /**
   * 在水平 cx 处找「最靠上」的可站立平台（用于均匀落点）。
   */
  function findGroundPlatformAtX(plats, cx) {
    let best = null;
    for (const p of plats) {
      if (cx < p.x || cx >= p.x + p.w) continue;
      if (!best || p.y < best.y) best = p;
    }
    return best;
  }

  /** 平台段唯一键：同一段台阶只许一只苦力怕 */
  function platformSegmentKey(p) {
    return `${p.x}|${p.y}|${p.w}|${p.h}`;
  }

  /**
   * 在随机平台上生成一只苦力怕：巡逻边界为整段平台内边距，初速度左右随机。
   * @param {object[]} plats 平台列表
   * @param {number} patrolHint 来自关卡配置的整数，经模运算微调水平速度倍率
   */
  function randomCreeperOnPlatform(plats, patrolHint) {
    const cw = CREEPER_W;
    const ch = CREEPER_H;
    const margin = 8;
    const p = plats[Math.floor(Math.random() * plats.length)];
    const minX = p.x + margin;
    const maxX = p.x + p.w - cw - margin;
    if (maxX - minX < 40) return null;
    const base = minX + Math.random() * Math.max(4, maxX - minX - 8);
    const y = p.y - ch;
    const dir = Math.random() < 0.5 ? -1 : 1;
    const hint = Math.max(8, Math.abs(Number(patrolHint)) || 36);
    const speedMul = 0.78 + (hint % 40) * 0.018;
    const creep = {
      x: base,
      y,
      w: cw,
      h: ch,
      vx: 1.28 * speedMul * dir,
      minX,
      maxX,
      facing: dir,
    };
    creep.platKey = platformSegmentKey(p);
    return creep;
  }

  /**
   * 在关卡宽度上均匀分桶放置苦力怕，并避开玩家出生禁区；**同一平台段仅允许 1 只**。
   */
  function spawnUniformCreepers(plats, patrolList, spawnX, spawnY) {
    const wb = worldBoundsX(plats);
    const n = patrolList.length;
    const safe = spawnExclusionRect(spawnX, spawnY, player.w, player.h);
    const cw = CREEPER_W;
    const ch = CREEPER_H;
    const margin = 8;
    const out = [];
    const usedPlatformKeys = new Set();

    const makeOnPlatform = (p, centerX, hint) => {
      const minX = p.x + margin;
      const maxX = p.x + p.w - cw - margin;
      if (maxX - minX < 24) return null;
      const x = Math.max(minX, Math.min(maxX, centerX - cw / 2));
      const y = p.y - ch;
      const hintVal = Math.max(8, Math.abs(Number(hint)) || 36);
      const speedMul = 0.78 + (hintVal % 40) * 0.018;
      const dir = out.length % 2 === 0 ? 1 : -1;
      return {
        x,
        y,
        w: cw,
        h: ch,
        vx: 1.28 * speedMul * dir,
        minX,
        maxX,
        facing: dir,
        platKey: platformSegmentKey(p),
      };
    };

    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const targetCx = wb.left + 60 + t * (wb.right - wb.left - 120);
      const hint = patrolList[i];
      const offsets = [0, -48, 48, -96, 96, -150, 150, -210, 210];
      let placed = null;

      for (const ox of offsets) {
        const cx = targetCx + ox;
        const p = findGroundPlatformAtX(plats, cx);
        if (!p) continue;
        const pk = platformSegmentKey(p);
        if (usedPlatformKeys.has(pk)) continue;
        const c = makeOnPlatform(p, cx, hint);
        if (!c || rectsOverlap(c, safe)) continue;
        let clash = false;
        for (const o of out) {
          if (rectsOverlap(c, o)) {
            clash = true;
            break;
          }
        }
        if (!clash) {
          placed = c;
          usedPlatformKeys.add(pk);
          break;
        }
      }

      if (!placed) {
        for (let att = 0; att < 120; att++) {
          const c = randomCreeperOnPlatform(plats, hint);
          if (!c || rectsOverlap(c, safe)) continue;
          if (c.platKey && usedPlatformKeys.has(c.platKey)) continue;
          let clash = false;
          for (const o of out) {
            if (rectsOverlap(c, o)) {
              clash = true;
              break;
            }
          }
          if (!clash) {
            placed = c;
            if (c.platKey) usedPlatformKeys.add(c.platKey);
            break;
          }
        }
      }
      if (placed) out.push(placed);
    }
    return out;
  }

  /**
   * 蓝钻沿关卡宽度均匀分桶，避开出生禁区与苦力怕；每桶在竖线附近微调找合法贴顶位置。
   */
  function spawnUniformDiamonds(plats, creeperRects, spawnX, spawnY) {
    const wb = worldBoundsX(plats);
    const safe = spawnExclusionRect(spawnX, spawnY, player.w, player.h);
    const gyFb = 9;
    const gems = [];
    const count = DIAMONDS_PER_LEVEL;

    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const targetCx = wb.left + 52 + t * (wb.right - wb.left - 104);
      const offsets = [0, -36, 36, -72, 72, -120, 120];
      let placed = null;
      for (const ox of offsets) {
        const cx = targetCx + ox;
        const xLeft = cx - GEM_W / 2;
        const pack = makeFloatingGemRect(xLeft, GEM_W, GEM_H, gyFb, plats);
        const gem = { x: xLeft, y: pack.y, w: GEM_W, h: GEM_H, taken: false };
        if (rectsOverlap(gem, safe)) continue;
        let bad = false;
        for (const c of creeperRects) {
          if (rectsOverlap(gem, c)) {
            bad = true;
            break;
          }
        }
        for (const g of gems) {
          if (rectsOverlap(gem, g)) {
            bad = true;
            break;
          }
        }
        if (!bad) {
          placed = gem;
          break;
        }
      }
      if (!placed && plats.length) {
        const p = plats[Math.min(i, plats.length - 1)];
        const xLeft = Math.max(p.x + 8, Math.min(p.x + p.w - GEM_W - 8, targetCx - GEM_W / 2));
        const pack = makeFloatingGemRect(xLeft, GEM_W, GEM_H, gyFb, plats);
        placed = { x: xLeft, y: pack.y, w: GEM_W, h: GEM_H, taken: false };
      }
      if (placed) gems.push(placed);
    }
    return gems;
  }

  /**
   * 按 slotIndex（0..phantomLevelCap-1）在关卡宽度均匀分桶生成一只幻翼（竖直错层、避开出生列）。
   * 与「逐只补员」共用，保证第 k 只始终落在预定桶位。
   */
  function spawnOnePhantomAtSlot(slotIndex) {
    const wb = worldBoundsX(platforms);
    const Lcfg = LEVELS[currentLevel - 1];
    const spawnX = Lcfg.spawnX;
    const worldLeft = wb.left;
    const worldRight = wb.right;
    const margin = 44;
    const span = Math.max(1, worldRight - worldLeft - margin * 2);
    const phw = 40;
    const phh = 22;
    const n = phantomLevelCap;
    const t = (slotIndex + 0.5) / n;
    let x = worldLeft + margin + t * span - phw / 2;
    let y = 52 + ((slotIndex * 61 + (slotIndex % 4) * 37) % 218);
    const avoidX0 = spawnX - 130;
    const avoidX1 = spawnX + player.w + 130;
    if (x + phw > avoidX0 && x < avoidX1) {
      if (spawnX - worldLeft < worldRight - spawnX) x = avoidX1 + 4;
      else x = avoidX0 - phw - 4;
      x = Math.max(worldLeft + 6, Math.min(worldRight - phw - 6, x));
    }
    phantoms.push({
      x,
      y,
      w: phw,
      h: phh,
      vx: (Math.random() - 0.5) * 2.2,
      vy: (Math.random() - 0.5) * 1.4,
      phase: Math.random() * Math.PI * 2,
    });
  }

  /**
   * 清空幻翼；第一只在 FIRST_DELAY 后出现，之后按递增间隔逐只补至 phantomLevelCap（关卡越靠后间隔略长）。
   */
  function restartPhantomSystemFull() {
    phantoms = [];
    phantomsSpawnedTotal = 0;
    phantomUnlockPrev = false;
    phantomSpawnCooldown =
      PHANTOM_FIRST_DELAY_MIN +
      Math.random() * (PHANTOM_FIRST_DELAY_MAX - PHANTOM_FIRST_DELAY_MIN);
  }

  /** 刷新页眉弹药数字（终关无限时显示 ∞） */
  function updateAmmoHud() {
    if (!ammoEl) return;
    ammoEl.textContent = Number.isFinite(ammo) ? String(ammo) : "∞";
  }

  /** 刷新页眉「血量」「生命」数字 */
  function updateLifeHud() {
    if (hpEl) hpEl.textContent = String(hp);
    if (lifeStockEl) lifeStockEl.textContent = String(lifeStock);
  }

  /**
   * 从史蒂夫发射点看向所有幻翼，返回欧氏距离最近的一只（用于自动瞄弹）。
   */
  function findNearestPhantom(cx, cy) {
    let best = null;
    let bestD = Infinity;
    for (const ph of phantoms) {
      const pcx = ph.x + ph.w * 0.5;
      const pcy = ph.y + ph.h * 0.5;
      const d = Math.hypot(pcx - cx, pcy - cy);
      if (d < bestD) {
        bestD = d;
        best = ph;
      }
    }
    return best;
  }

  /**
   * 自动射击目标：在幻翼与骷髅弓手中取离发射点最近者（用于空格远程消耗弹药）。
   * @returns {{ kind: "phantom", ph: object } | { kind: "skeleton", sk: object } | null}
   */
  function findNearestShootTarget(cx, cy) {
    let best = null;
    let bestD = Infinity;
    for (const ph of phantoms) {
      const pcx = ph.x + ph.w * 0.5;
      const pcy = ph.y + ph.h * 0.5;
      const d = Math.hypot(pcx - cx, pcy - cy);
      if (d < bestD) {
        bestD = d;
        best = { kind: "phantom", ph };
      }
    }
    if (skeletonArcher) {
      const sk = skeletonArcher;
      const scx = sk.x + sk.w * 0.5;
      const scy = sk.y + sk.h * 0.35;
      const d = Math.hypot(scx - cx, scy - cy);
      if (d < bestD) {
        bestD = d;
        best = { kind: "skeleton", sk };
      }
    }
    return best;
  }

  /**
   * 近战判定：玩家与某苦力怕的「膨胀 AABB」相交时参与比较，取中心距玩家最近的一只。
   */
  function findCreeperInMeleeRange() {
    const hb = { x: player.x, y: player.y, w: player.w, h: player.h };
    const pad = CREEPER_MELEE_PAD;
    const pcx = player.x + player.w * 0.5;
    const pcy = player.y + player.h * 0.5;
    let best = null;
    let bestD = Infinity;
    for (const c of creepers) {
      const er = {
        x: c.x - pad,
        y: c.y - pad,
        w: c.w + pad * 2,
        h: c.h + pad * 2,
      };
      if (!rectsOverlap(hb, er)) continue;
      const ccx = c.x + c.w * 0.5;
      const ccy = c.y + c.h * 0.5;
      const d = Math.hypot(ccx - pcx, ccy - pcy);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /**
   * 跳劈判定：仅在空中且向下落时，玩家 AABB 与「苦力怕正上方竖条」相交即可
   *（竖条 x = 苦力怕宽度 ± 极小垫量；竖直从顶缘上 reachUp 到顶缘下 reachDown）。
   * 多只重叠条带时取脚底距该苦力怕顶缘最近的一只。
   */
  function findCreeperInJumpSlashRange() {
    if (player.onGround || player.vy < CREEPER_JUMP_SLASH_MIN_VY) return null;
    const sp = CREEPER_JUMP_SLASH_STRIPE_PAD;
    const up = CREEPER_JUMP_SLASH_REACH_UP;
    const down = CREEPER_JUMP_SLASH_REACH_DOWN;
    const pl = player.x;
    const pr = player.x + player.w;
    const pt = player.y;
    const pb = player.y + player.h;
    let best = null;
    let bestD = Infinity;
    for (const c of creepers) {
      const stripeL = c.x - sp;
      const stripeR = c.x + c.w + sp;
      if (pr < stripeL || pl > stripeR) continue;
      const bandTop = c.y - up;
      const bandBot = c.y + down;
      if (pb < bandTop || pt > bandBot) continue;
      const d = Math.max(0, pb - c.y);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  /** 与骷髅弓手的膨胀 AABB 相交时视为可近战击毁（判定与苦力怕同垫量）。 */
  function findSkeletonInMeleeRange() {
    if (!skeletonArcher) return null;
    const sk = skeletonArcher;
    const hb = { x: player.x, y: player.y, w: player.w, h: player.h };
    const pad = CREEPER_MELEE_PAD;
    const er = {
      x: sk.x - pad,
      y: sk.y - pad,
      w: sk.w + pad * 2,
      h: sk.h + pad * 2,
    };
    return rectsOverlap(hb, er) ? sk : null;
  }

  /** 跳劈竖条与骷髅弓手相交时可击毁骷髅（规则与苦力怕跳劈一致）。 */
  function findSkeletonInJumpSlashRange() {
    if (!skeletonArcher) return null;
    if (player.onGround || player.vy < CREEPER_JUMP_SLASH_MIN_VY) return null;
    const sp = CREEPER_JUMP_SLASH_STRIPE_PAD;
    const up = CREEPER_JUMP_SLASH_REACH_UP;
    const down = CREEPER_JUMP_SLASH_REACH_DOWN;
    const c = skeletonArcher;
    const pl = player.x;
    const pr = player.x + player.w;
    const pt = player.y;
    const pb = player.y + player.h;
    const stripeL = c.x - sp;
    const stripeR = c.x + c.w + sp;
    if (pr < stripeL || pl > stripeR) return null;
    const bandTop = c.y - up;
    const bandBot = c.y + down;
    if (pb < bandTop || pt > bandBot) return null;
    return skeletonArcher;
  }

  /**
   * 贴近幻翼砍杀判定：与苦力怕相同的膨胀 AABB 重叠判定，取距玩家中心最近的一只。
   */
  function findPhantomInMeleeKnifeRange() {
    if (phantoms.length === 0) return null;
    const hb = { x: player.x, y: player.y, w: player.w, h: player.h };
    const pad = CREEPER_MELEE_PAD;
    const pcx = player.x + player.w * 0.5;
    const pcy = player.y + player.h * 0.5;
    let best = null;
    let bestD = Infinity;
    for (const ph of phantoms) {
      const er = {
        x: ph.x - pad,
        y: ph.y - pad,
        w: ph.w + pad * 2,
        h: ph.h + pad * 2,
      };
      if (!rectsOverlap(hb, er)) continue;
      const phcx = ph.x + ph.w * 0.5;
      const phcy = ph.y + ph.h * 0.5;
      const d = Math.hypot(phcx - pcx, phcy - pcy);
      if (d < bestD) {
        bestD = d;
        best = ph;
      }
    }
    return best;
  }

  /**
   * 跳劈幻翼判定：与苦力怕跳劈相同的竖带与下落条件，取脚底距幻翼顶缘最近的一只。
   */
  function findPhantomInJumpSlashKnifeRange() {
    if (phantoms.length === 0) return null;
    if (player.onGround || player.vy < CREEPER_JUMP_SLASH_MIN_VY) return null;
    const sp = CREEPER_JUMP_SLASH_STRIPE_PAD;
    const up = CREEPER_JUMP_SLASH_REACH_UP;
    const down = CREEPER_JUMP_SLASH_REACH_DOWN;
    const pl = player.x;
    const pr = player.x + player.w;
    const pt = player.y;
    const pb = player.y + player.h;
    let best = null;
    let bestD = Infinity;
    for (const ph of phantoms) {
      const stripeL = ph.x - sp;
      const stripeR = ph.x + ph.w + sp;
      if (pr < stripeL || pl > stripeR) continue;
      const bandTop = ph.y - up;
      const bandBot = ph.y + down;
      if (pb < bandTop || pt > bandBot) continue;
      const d = Math.max(0, pb - ph.y);
      if (d < bestD) {
        bestD = d;
        best = ph;
      }
    }
    return best;
  }

  /**
   * 处理本帧空格「射击」意图：优先近战删苦力怕；跳劈删苦力怕；再近战/跳劈删骷髅；
   * 贴近或跳劈命中幻翼时一律出刀删幻翼（不耗弹药）；否则有弹药且存在幻翼或骷髅时朝最近目标发射飞弹。
   * 无论成功与否都会清除 shootPressed，避免长按连发（连发由 keydown repeat 抑制）。
   */
  function tryConsumeShoot() {
    if (!shootPressed) return;
    shootPressed = false;
    if (state !== "play") return;

    const creepVictim =
      findCreeperInMeleeRange() || findCreeperInJumpSlashRange();
    if (creepVictim) {
      const idx = creepers.indexOf(creepVictim);
      if (idx >= 0) creepers.splice(idx, 1);
      knifeSwing = STEVE_KNIFE_FRAMES;
      snd()?.creeperKill();
      return;
    }

    if (findSkeletonInMeleeRange() || findSkeletonInJumpSlashRange()) {
      skeletonArcher = null;
      knifeSwing = STEVE_KNIFE_FRAMES;
      snd()?.skeletonKill();
      return;
    }

    const phKnifeVictim =
      findPhantomInMeleeKnifeRange() || findPhantomInJumpSlashKnifeRange();
    if (phKnifeVictim) {
      const idx = phantoms.indexOf(phKnifeVictim);
      if (idx >= 0) phantoms.splice(idx, 1);
      knifeSwing = STEVE_KNIFE_FRAMES;
      snd()?.phantomHit();
      return;
    }

    if (ammo <= 0) return;

    const cx = player.x + player.w * 0.5;
    const cy = player.y + player.h * 0.35;
    const tgt = findNearestShootTarget(cx, cy);
    if (!tgt) return;

    let tx;
    let ty;
    if (tgt.kind === "phantom") {
      const ph = tgt.ph;
      tx = ph.x + ph.w * 0.5;
      ty = ph.y + ph.h * 0.5;
    } else {
      const sk = tgt.sk;
      tx = sk.x + sk.w * 0.5;
      ty = sk.y + sk.h * 0.35;
    }
    const dx = tx - cx;
    const dy = ty - cy;
    const len = Math.hypot(dx, dy) || 1;
    const sp = 15;
    projectiles.push({
      x: cx + (dx / len) * 14,
      y: cy + (dy / len) * 10,
      vx: (dx / len) * sp,
      vy: (dy / len) * sp,
      r: 5,
      weaponStyle: weaponShootStyle,
    });
    ammo -= 1;
    updateAmmoHud();
    steveShootPose = STEVE_SHOOT_FRAMES;
    snd()?.shoot();
  }

  /**
   * 飞弹运动与碰撞：命中骷髅弓手或幻翼则移除目标与飞弹并播放音效；飞出屏幕外则回收飞弹。
   * @param {number} dt 与主循环相同的帧间隔毫秒，用于与 16ms 基准归一化
   */
  function updateProjectiles(dt = 16) {
    const k = Math.min(dt / 16, 2.5);
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const pr = projectiles[i];
      pr.x += pr.vx * k;
      pr.y += pr.vy * k;

      const hb = {
        x: pr.x - pr.r,
        y: pr.y - pr.r,
        w: pr.r * 2,
        h: pr.r * 2,
      };
      if (skeletonArcher && rectsOverlap(hb, skeletonArcher)) {
        skeletonArcher = null;
        projectiles.splice(i, 1);
        snd()?.skeletonKill();
        continue;
      }
      let hit = false;
      for (let j = phantoms.length - 1; j >= 0; j--) {
        const ph = phantoms[j];
        if (rectsOverlap(hb, ph)) {
          phantoms.splice(j, 1);
          hit = true;
          break;
        }
      }
      if (hit) {
        projectiles.splice(i, 1);
        snd()?.phantomHit();
        continue;
      }
      if (
        pr.x < camX - 120 ||
        pr.x > camX + W + 120 ||
        pr.y < -60 ||
        pr.y > H + 80
      ) {
        projectiles.splice(i, 1);
      }
    }
  }

  /**
   * 骷髅弓手：约每 0.5 秒朝玩家当前位置射一箭；箭矢运动与碰撞在 updateSkeletonArrows（本函数末尾调用）。
   */
  function updateSkeletonArcherSystem(dt = 16) {
    if (state !== "play") return;
    if (skeletonArcher) {
      const sk = skeletonArcher;
      sk.facing =
        player.x + player.w * 0.5 >= sk.x + sk.w * 0.5 ? 1 : -1;
      skeletonShotTimerMs += dt;
      let burst = 0;
      while (
        skeletonShotTimerMs >= SKELETON_SHOT_INTERVAL_MS &&
        burst < SKELETON_SHOTS_MAX_CATCHUP_PER_FRAME
      ) {
        skeletonShotTimerMs -= SKELETON_SHOT_INTERVAL_MS;
        burst += 1;
        const ax = sk.x + sk.w * 0.5;
        const ay = sk.y + sk.h * 0.3;
        const tx = player.x + player.w * 0.5;
        const ty = player.y + player.h * 0.42;
        const dx = tx - ax;
        const dy = ty - ay;
        const len = Math.hypot(dx, dy) || 1;
        const nx = dx / len;
        const ny = dy / len;
        skeletonArrows.push({
          x: ax + nx * 24,
          y: ay + ny * 10,
          vx: nx * SKELETON_ARROW_SPEED,
          vy: ny * SKELETON_ARROW_SPEED,
          nx,
          ny,
          hw: 11,
          hh: 4,
        });
        snd()?.skeletonBow();
      }
    }
    updateSkeletonArrows(dt);
  }

  /**
   * 骷髅箭位移；撞平台移除；命中玩家仅叠加击退速度、不扣血；飞出关卡范围移除。
   */
  function updateSkeletonArrows(dt = 16) {
    if (state !== "play") return;
    const k = Math.min(dt / 16, 2.5);
    const hb = { x: player.x, y: player.y, w: player.w, h: player.h };
    const pad = 3;
    for (let i = skeletonArrows.length - 1; i >= 0; i--) {
      const ar = skeletonArrows[i];
      ar.x += ar.vx * k;
      ar.y += ar.vy * k;
      const ab = {
        x: ar.x - ar.hw - pad,
        y: ar.y - ar.hh - pad,
        w: (ar.hw + pad) * 2,
        h: (ar.hh + pad) * 2,
      };
      let hitPlat = false;
      for (const p of platforms) {
        if (rectsOverlap(ab, p)) {
          hitPlat = true;
          break;
        }
      }
      if (hitPlat) {
        skeletonArrows.splice(i, 1);
        continue;
      }
      if (rectsOverlap(ab, hb)) {
        player.vx = Math.max(
          -maxRun * 2.5,
          Math.min(maxRun * 2.5, player.vx + ar.nx * SKELETON_ARROW_KNOCK)
        );
        player.vy = Math.max(
          -14,
          Math.min(11, player.vy + ar.ny * SKELETON_ARROW_KNOCK * 0.52)
        );
        skeletonArrows.splice(i, 1);
        snd()?.skeletonArrowKnock();
        continue;
      }
      if (
        ar.x < levelWorldLeft - 320 ||
        ar.x > levelWorldRight + 320 ||
        ar.y < -140 ||
        ar.y > H + 200
      ) {
        skeletonArrows.splice(i, 1);
      }
    }
  }

  /** 骷髅弓手（骨骼 + 弓）；站位由 spawnSkeletonArcher 决定，对齐关卡水平几何中心 */
  function drawSkeletonArcher() {
    if (!skeletonArcher) return;
    const sk = skeletonArcher;
    const sx = sk.x - camX;
    const sy = sk.y;
    const w = sk.w;
    const h = sk.h;
    const f = sk.facing >= 0 ? 1 : -1;
    ctx.save();
    ctx.translate(sx + w * 0.5, sy + h * 0.5);
    ctx.scale(f, 1);
    ctx.translate(-w * 0.5, -h * 0.5);
    const bone = COLORS.skeletonBone;
    const dim = COLORS.skeletonBoneDim;
    const jt = COLORS.skeletonJoint;
    ctx.fillStyle = jt;
    ctx.fillRect(9, 38, 5, 8);
    ctx.fillRect(20, 38, 5, 8);
    ctx.fillStyle = dim;
    ctx.fillRect(7, 30, 20, 10);
    ctx.fillStyle = bone;
    ctx.fillRect(8, 18, 18, 14);
    ctx.fillRect(10, 10, 14, 10);
    ctx.fillStyle = "#263238";
    ctx.fillRect(12, 14, 3, 3);
    ctx.fillRect(19, 14, 3, 3);
    ctx.fillRect(14, 17, 6, 2);
    ctx.fillStyle = COLORS.skeletonBow;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(w - 2, 22, 13, -0.95, 0.95);
    ctx.stroke();
    ctx.strokeStyle = COLORS.skeletonBowStr;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w - 2, 9);
    ctx.lineTo(w - 2, 35);
    ctx.stroke();
    ctx.fillStyle = bone;
    ctx.fillRect(4, 22, 6, 5);
    ctx.fillRect(4, 26, 6, 4);
    ctx.restore();
  }

  /** 骷髅箭：沿速度方向绘箭杆与箭头 */
  function drawSkeletonArrows() {
    for (const ar of skeletonArrows) {
      const sx = ar.x - camX;
      const sy = ar.y;
      const ang = Math.atan2(ar.vy, ar.vx);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(ang);
      ctx.fillStyle = "#bcaaa4";
      ctx.fillRect(-20, -2, 20, 4);
      ctx.fillStyle = "#8d6e63";
      ctx.beginPath();
      ctx.moveTo(2, 0);
      ctx.lineTo(11, -5);
      ctx.lineTo(11, 5);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#5d4037";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }

  /** 绘制飞弹：样式由 projectiles[].weaponStyle 或当前 weaponShootStyle 决定 */
  function drawProjectiles() {
    for (const pr of projectiles) {
      const st =
        pr.weaponStyle != null ? pr.weaponStyle : weaponShootStyle;
      const sx = pr.x - camX;
      const sy = pr.y;
      const rr = pr.r;
      if (st === 0) {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rr + 4);
        g.addColorStop(0, COLORS.boltCore);
        g.addColorStop(0.45, COLORS.boltGlow);
        g.addColorStop(1, "rgba(211,47,47,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sx, sy, rr + 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffcdd2";
        ctx.beginPath();
        ctx.arc(sx, sy, rr * 0.45, 0, Math.PI * 2);
        ctx.fill();
      } else if (st === 1) {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rr + 5);
        g.addColorStop(0, "#b9f6ca");
        g.addColorStop(0.42, "#00c853");
        g.addColorStop(1, "rgba(0,77,64,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sx, sy, rr + 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(performance.now() * 0.008);
        ctx.fillStyle = "#e0f7fa";
        ctx.beginPath();
        ctx.moveTo(0, -rr * 1.1);
        ctx.lineTo(rr * 0.85, 0);
        ctx.lineTo(0, rr * 1.1);
        ctx.lineTo(-rr * 0.85, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (st === 2) {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rr + 6);
        g.addColorStop(0, "#f3e5f5");
        g.addColorStop(0.38, "#aa00ff");
        g.addColorStop(1, "rgba(49,27,146,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sx, sy, rr + 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(234,128,252,${0.55 + Math.sin(performance.now() * 0.02) * 0.2})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let k = 0; k < 4; k++) {
          const a = (k * Math.PI) / 2 + performance.now() * 0.006;
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + Math.cos(a) * (rr + 8), sy + Math.sin(a) * (rr + 8));
        }
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(sx, sy, rr * 0.35, 0, Math.PI * 2);
        ctx.fill();
      } else if (st === 3) {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rr + 5);
        g.addColorStop(0, "#fff8e1");
        g.addColorStop(0.4, "#ff6f00");
        g.addColorStop(1, "rgba(191,54,12,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sx, sy, rr + 3, 0, Math.PI * 2);
        ctx.fill();
        const t = performance.now() * 0.012;
        ctx.strokeStyle = `rgba(255,213,79,${0.5 + Math.sin(t) * 0.25})`;
        ctx.lineWidth = 2;
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + t;
          ctx.beginPath();
          ctx.moveTo(sx + Math.cos(a) * rr * 0.3, sy + Math.sin(a) * rr * 0.3);
          ctx.lineTo(sx + Math.cos(a) * (rr + 10), sy + Math.sin(a) * (rr + 10));
          ctx.stroke();
        }
        ctx.fillStyle = "#ffecb3";
        ctx.beginPath();
        ctx.arc(sx, sy, rr * 0.4, 0, Math.PI * 2);
        ctx.fill();
      } else if (st === 4) {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rr + 5);
        g.addColorStop(0, "#e1f5fe");
        g.addColorStop(0.45, "#0288d1");
        g.addColorStop(1, "rgba(1,87,155,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sx, sy, rr + 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(performance.now() * 0.01);
        ctx.strokeStyle = "rgba(179,229,252,0.85)";
        ctx.lineWidth = 1.5;
        for (let k = 0; k < 3; k++) {
          const a = (k * Math.PI) / 3;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * rr * 0.2, Math.sin(a) * rr * 0.2);
          ctx.lineTo(Math.cos(a) * (rr + 6), Math.sin(a) * (rr + 6));
          ctx.stroke();
        }
        ctx.restore();
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(sx, sy, rr * 0.32, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rr + 4);
        g.addColorStop(0, COLORS.boltCore);
        g.addColorStop(0.45, COLORS.boltGlow);
        g.addColorStop(1, "rgba(211,47,47,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sx, sy, rr + 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffcdd2";
        ctx.beginPath();
        ctx.arc(sx, sy, rr * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /**
   * 近战挥刀表现：刀身随 knifeSwing 从蓄力到劈出再收招；weaponKnifeStyle 切换 5 套配色与刀形。
   */
  function drawKnifeSlash() {
    if (knifeSwing <= 0) return;
    const px = player.x - camX + player.w * 0.5;
    const py = player.y + player.h * 0.4;
    const f = player.facing;
    const u = knifeSwing / STEVE_KNIFE_FRAMES;
    const strike = u < 0.72 ? (0.72 - u) / 0.72 : 0;
    const ks = weaponKnifeStyle;
    ctx.save();
    ctx.translate(px, py);
    ctx.scale(f, 1);
    ctx.rotate(-0.28 + strike * 1.18 + (1 - u) * 0.12);
    if (ks === 0) {
      ctx.fillStyle = COLORS.knifeHilt;
      ctx.fillRect(-7, -3, 11, 6);
      ctx.fillStyle = COLORS.knifeBlade;
      ctx.beginPath();
      ctx.moveTo(4, -3);
      ctx.lineTo(38, -1.5);
      ctx.lineTo(44, 0);
      ctx.lineTo(38, 1.5);
      ctx.lineTo(4, 3);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = COLORS.knifeEdge;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = `rgba(144,202,249,${0.25 + u * 0.55})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 2, 50, -0.4, 0.92 + strike * 0.35);
      ctx.stroke();
      if (strike > 0.35) {
        ctx.strokeStyle = `rgba(100,181,246,${strike * 0.5})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(8, 0, 28, -0.2, 1.1);
        ctx.stroke();
      }
    } else if (ks === 1) {
      ctx.fillStyle = "#311b92";
      ctx.fillRect(-7, -3, 11, 6);
      ctx.fillStyle = "#9575cd";
      ctx.beginPath();
      ctx.moveTo(2, -4);
      ctx.lineTo(42, -1);
      ctx.lineTo(48, 0);
      ctx.lineTo(42, 1);
      ctx.lineTo(2, 4);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#d1c4e9";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = `rgba(206,147,216,${0.28 + u * 0.52})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(2, 0, 52, -0.35, 0.95 + strike * 0.32);
      ctx.stroke();
      if (strike > 0.35) {
        ctx.strokeStyle = `rgba(224,64,251,${strike * 0.55})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(10, -1, 30, -0.15, 1.15);
        ctx.stroke();
      }
    } else if (ks === 2) {
      ctx.fillStyle = "#4e342e";
      ctx.fillRect(-6, -2, 10, 5);
      ctx.fillStyle = "#ffca28";
      ctx.beginPath();
      ctx.moveTo(6, -5);
      ctx.lineTo(34, -3);
      ctx.lineTo(40, 0);
      ctx.lineTo(34, 3);
      ctx.lineTo(6, 5);
      ctx.lineTo(2, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#ffe082";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,183,77,${0.3 + u * 0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(-2, 1, 46, -0.35, 0.88 + strike * 0.3);
      ctx.stroke();
      if (strike > 0.35) {
        ctx.strokeStyle = `rgba(255,112,67,${strike * 0.52})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(6, 0, 26, -0.1, 1.05);
        ctx.stroke();
      }
    } else if (ks === 3) {
      ctx.fillStyle = "#3e2723";
      ctx.fillRect(-7, -3, 11, 6);
      ctx.fillStyle = "#d84315";
      ctx.beginPath();
      ctx.moveTo(4, -4);
      ctx.lineTo(40, -2);
      ctx.lineTo(46, 0);
      ctx.lineTo(40, 2);
      ctx.lineTo(4, 4);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#ffab91";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,138,101,${0.32 + u * 0.5})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 1, 50, -0.38, 0.9 + strike * 0.34);
      ctx.stroke();
      if (strike > 0.35) {
        ctx.strokeStyle = `rgba(255,87,34,${strike * 0.58})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(8, 0, 30, -0.18, 1.12);
        ctx.stroke();
      }
    } else if (ks === 4) {
      ctx.fillStyle = "#33691e";
      ctx.fillRect(-6, -2, 10, 5);
      ctx.fillStyle = "#aed581";
      ctx.beginPath();
      ctx.moveTo(3, -3.5);
      ctx.lineTo(36, -2);
      ctx.lineTo(42, 0);
      ctx.lineTo(36, 2);
      ctx.lineTo(3, 3.5);
      ctx.lineTo(-1, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#dcedc8";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = `rgba(129,199,132,${0.3 + u * 0.48})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(-1, 0, 48, -0.32, 0.86 + strike * 0.28);
      ctx.stroke();
      if (strike > 0.35) {
        ctx.strokeStyle = `rgba(102,187,106,${strike * 0.5})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(7, 0, 27, -0.12, 1.02);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /**
   * 关卡配置表（共 LEVEL_COUNT 关）。每项字段含义：
   * - title：关卡名（结算文案用）
   * - redDiamond：[格子 x, 格子 y] 终点红钻参考格坐标，再换算像素并贴平台顶
   * - spawnX / spawnY：玩家出生世界坐标（像素）
   * - plat：多行 [格子x, 格子y, 宽(格), 类型]，类型 grass | stone | plank
   * - creepersPatrol：整数数组，用于循环生成各关苦力怕（前四关各 ENEMIES_PER_LEVEL、终关各 ENEMIES_LAST_LEVEL）时的速度微调，非巡逻距离
   * - 蓝钻数量由常量 DIAMONDS_PER_LEVEL 固定为 6，与关卡数据无关
   */
  const LEVELS = [
    {
      title: "草地练习",
      redDiamond: [36, 9],
      spawnX: 72,
      spawnY: 10 * TILE - player.h - 2,
      plat: [
        [0, 10, 6, "grass"],
        [8, 9, 4, "stone"],
        [14, 8, 3, "plank"],
        [19, 7, 4, "grass"],
        [25, 9, 3, "stone"],
        [30, 10, 9, "grass"],
      ],
      creepersPatrol: [38],
    },
    {
      title: "矿脉石桥",
      redDiamond: [47, 9],
      spawnX: 64,
      spawnY: 10 * TILE - player.h - 2,
      plat: [
        [0, 10, 5, "stone"],
        [6, 10, 2, "stone"],
        [9, 9, 3, "stone"],
        [13, 10, 2, "stone"],
        [16, 9, 4, "stone"],
        [21, 8, 3, "stone"],
        [25, 9, 3, "plank"],
        [30, 10, 5, "grass"],
        [37, 9, 4, "stone"],
        [43, 10, 6, "grass"],
      ],
      creepersPatrol: [36, 48],
    },
    {
      title: "天梯木板",
      redDiamond: [49, 9],
      spawnX: 56,
      spawnY: 10 * TILE - player.h - 2,
      plat: [
        [0, 10, 4, "grass"],
        [5, 9, 2, "plank"],
        [8, 8, 2, "plank"],
        [11, 7, 2, "plank"],
        [14, 6, 2, "plank"],
        [17, 6, 3, "stone"],
        [21, 7, 3, "grass"],
        [26, 8, 3, "plank"],
        [31, 9, 4, "grass"],
        [37, 10, 6, "grass"],
        [45, 10, 5, "grass"],
      ],
      creepersPatrol: [32, 52],
    },
    {
      title: "浮岛裂谷",
      redDiamond: [43, 9],
      spawnX: 48,
      spawnY: 10 * TILE - player.h - 2,
      plat: [
        [0, 10, 4, "grass"],
        [6, 9, 2, "stone"],
        [10, 8, 2, "stone"],
        [14, 7, 3, "plank"],
        [19, 6, 2, "stone"],
        [23, 7, 3, "grass"],
        [28, 8, 2, "plank"],
        [32, 9, 3, "stone"],
        [37, 10, 9, "grass"],
      ],
      creepersPatrol: [44, 42],
    },
    {
      title: "苦力怕长廊",
      redDiamond: [55, 9],
      spawnX: 80,
      spawnY: 10 * TILE - player.h - 2,
      plat: [
        [0, 10, 6, "grass"],
        [8, 9, 3, "stone"],
        [12, 8, 3, "stone"],
        [17, 9, 4, "plank"],
        [23, 8, 3, "stone"],
        [28, 7, 3, "stone"],
        [33, 8, 4, "plank"],
        [39, 9, 5, "grass"],
        [47, 10, 11, "grass"],
      ],
      creepersPatrol: [40, 48, 52, 56],
    },
  ];

  /** 更新页眉「关卡 x/5」 */
  function updateLevelHud() {
    if (levelEl) levelEl.textContent = `${currentLevel}/${LEVEL_COUNT}`;
  }

  /**
   * 按关卡 n 的配置在现有 platforms 上生成苦力怕（用于 loadLevel 与丢命后补怪）。
   * @param {number} n 关卡号 1..LEVEL_COUNT
   */
  function spawnCreepersForLevel(n) {
    const L = LEVELS[n - 1];
    const rawPatrol = L.creepersPatrol?.length ? L.creepersPatrol : [40];
    const patrols = [];
    const q = getEnemyQuotaForLevel(n);
    for (let i = 0; i < q; i++) {
      patrols.push(rawPatrol[i % rawPatrol.length]);
    }
    creepers = spawnUniformCreepers(platforms, patrols, L.spawnX, L.spawnY);
  }

  /**
   * 加载第 n 关：重建平台、敌人、宝石、终点红钻、幻翼系统、弹药与飞弹；重算 maxCamX。
   * @param {number} n 关卡号 1..LEVEL_COUNT
   */
  function loadLevel(n) {
    const L = LEVELS[n - 1];
    platforms = [];
    diamonds = [];
    creepers = [];
    for (const row of L.plat) {
      const [gx, gy, gw, type] = row;
      platforms.push({
        x: gx * TILE,
        y: gy * TILE,
        w: gw * TILE,
        h: TILE,
        type,
      });
    }

    spawnCreepersForLevel(n);
    diamonds = spawnUniformDiamonds(platforms, creepers, L.spawnX, L.spawnY);

    phantomLevelCap = getEnemyQuotaForLevel(n);
    restartPhantomSystemFull();
    projectiles = [];
    ammo = startingAmmoForLevel(n);
    knifeSwing = 0;
    steveShootPose = 0;
    updateAmmoHud();

    const [rgx, rgy] = L.redDiamond;
    const rx = rgx * TILE + TILE * 0.18;
    const rw = 26;
    const rh = 26;
    const rPack = makeFloatingGemRect(rx, rw, rh, rgy, platforms);
    redGoalGem = { ...rPack, taken: false };

    let right = 0;
    for (const p of platforms) {
      right = Math.max(right, p.x + p.w);
    }
    maxCamX = Math.max(0, right - W + 120);
    const wbBounds = worldBoundsX(platforms);
    levelWorldLeft = wbBounds.left;
    levelWorldRight = wbBounds.right;
    spawnSkeletonArcher();
    hp = MAX_HP;
    updateLifeHud();
  }

  /**
   * 每关必生成骷髅弓手：站在关卡**水平几何中心**（全体平台包络 [left,right] 的中点）正下方地面；
   * 脚底 x 尽量对齐中心（`mid - 骷髅半宽`），中心竖线为坑时沿 x 小步外扩采样地面，再回退「距中心最近宽平台」「最宽平台」。
   */
  function spawnSkeletonArcher() {
    skeletonArrows = [];
    skeletonShotTimerMs = 0;
    if (!platforms.length) {
      skeletonArcher = null;
      return;
    }
    const wb = worldBoundsX(platforms);
    const mid = (wb.left + wb.right) * 0.5;
    const sw = SKELETON_ARCHER_W;
    const sh = SKELETON_ARCHER_H;
    const margin = 6;
    const minPlatW = sw + margin * 2;
    const idealFootLeft = mid - sw * 0.5;

    const tryPlaceOnCandidate = (cand) => {
      if (!cand || cand.w < minPlatW) return null;
      const minX = cand.x + margin;
      const maxX = cand.x + cand.w - sw - margin;
      if (maxX < minX) return null;
      const x = Math.max(minX, Math.min(maxX, idealFootLeft));
      return { x, y: cand.y - sh, w: sw, h: sh, facing: 1 };
    };

    /** 由竖线 cx 找顶面平台，再把脚底锁到关卡水平中心（夹在本平台内） */
    const tryAtProbeCx = (probeCx) => {
      const cand = findGroundPlatformAtX(platforms, probeCx);
      return tryPlaceOnCandidate(cand);
    };

    const offsets = [
      0, -32, 32, -64, 64, -96, 96, -144, 144, -200, 200, -280, 280, -400, 400,
    ];
    let placed = null;
    for (const ox of offsets) {
      placed = tryAtProbeCx(mid + ox);
      if (placed) break;
    }

    if (!placed) {
      let bestPlat = null;
      let bestDist = Infinity;
      for (const cand of platforms) {
        if (cand.w < minPlatW) continue;
        const d = Math.abs(cand.x + cand.w * 0.5 - mid);
        if (d < bestDist) {
          bestDist = d;
          bestPlat = cand;
        }
      }
      if (bestPlat) placed = tryPlaceOnCandidate(bestPlat);
    }

    if (!placed) {
      let widest = null;
      for (const cand of platforms) {
        if (!widest || cand.w > widest.w) widest = cand;
      }
      if (widest) {
        const m2 = 2;
        const minX2 = widest.x + m2;
        const maxX2 = widest.x + widest.w - sw - m2;
        if (maxX2 >= minX2) {
          const x = Math.max(minX2, Math.min(maxX2, idealFootLeft));
          placed = { x, y: widest.y - sh, w: sw, h: sh, facing: 1 };
        }
      }
    }

    if (!placed) {
      skeletonArcher = null;
      return;
    }
    skeletonArcher = placed;
  }

  /** 把玩家放到当前关 LEVELS 配置的 spawn 坐标（不改变速度时可在外部先清零 vx,vy） */
  function applySpawn() {
    const L = LEVELS[currentLevel - 1];
    player.x = L.spawnX;
    player.y = L.spawnY;
  }

  /** 受伤时触发全屏闪红与镜头抖动强度初值 */
  function triggerDamageFx() {
    damageFlash = 36;
    damageShake = 14;
  }

  /**
   * 整局或半局重置：full 为 true 时清分数、补满生命与血量、回到第 1 关；始终 loadLevel + applySpawn。
   * @param {boolean} [full=true] 是否完全新局
   */
  function resetGame(full = true) {
    if (full) {
      score = 0;
      lifeStock = MAX_PLAYER_LIFE_STOCK;
      currentLevel = 1;
      hasElytra = false;
    }
    loadLevel(currentLevel);
    applySpawn();
    player.vx = 0;
    player.vy = 0;
    player.airJumpsLeft = 1;
    camX = Math.max(0, Math.min(maxCamX, player.x - W * 0.35));
    invuln = 0;
    damageFlash = 0;
    damageShake = 0;
    playTimeMs = 0;
    lastLoopTs = performance.now();
    scoreEl.textContent = String(score);
    updateLifeHud();
    updateLevelHud();
    updateTimerHud();
  }

  /**
   * 血量被敌人或坠落扣至 0 时：生命 -1；若生命仍 >0 则本关起点重生并补满血量、重置苦力怕与弹药等；否则进入游戏失败结算。
   */
  function onLifeStockLost() {
    if (state !== "play") return;
    lifeStock -= 1;
    updateLifeHud();
    if (lifeStock <= 0) {
      showGameOverConfirm();
      return;
    }
    hp = MAX_HP;
    updateLifeHud();
    spawnCreepersForLevel(currentLevel);
    spawnSkeletonArcher();
    applySpawn();
    player.vx = 0;
    player.vy = 0;
    player.airJumpsLeft = 1;
    camX = Math.max(0, Math.min(maxCamX, player.x - W * 0.35));
    invuln = 150;
    projectiles = [];
    ammo = startingAmmoForLevel(currentLevel);
    knifeSwing = 0;
    steveShootPose = 0;
    updateAmmoHud();
    restartPhantomSystemFull();
    snd()?.hurt();
  }

  /**
   * 「生命」归零：切到 gameover，停 BGM，展示「游戏失败」结算页；确认后整局从第一关重开。
   */
  function showGameOverConfirm() {
    hideOverlayHomeChrome();
    state = "gameover";
    knifeSwing = 0;
    steveShootPose = 0;
    projectiles = [];
    skeletonArrows = [];
    skeletonArcher = null;
    phantoms = [];
    phantomSpawnCooldown =
      PHANTOM_FIRST_DELAY_MIN +
      Math.random() * (PHANTOM_FIRST_DELAY_MAX - PHANTOM_FIRST_DELAY_MIN);
    snd()?.stopBgm();
    snd()?.death();
    const Lfail = LEVELS[currentLevel - 1];
    const failTitle = escapeHtml(Lfail.title);
    const failSettle = `<div class="settlement settlement--fail">
      <div class="settlement-stat"><span>到达进度</span><strong>第 ${currentLevel}/${LEVEL_COUNT} 关 · ${failTitle}</strong></div>
      <div class="settlement-stat"><span>本局蓝钻</span><strong>${score}</strong></div>
      <div class="settlement-stat"><span>本局用时</span><strong>${formatTimeShort(playTimeMs)}</strong></div>
      <div class="settlement-stat"><span>失败原因</span><strong>生命归零</strong></div>
    </div>`;
    overlayTitle.classList.add("overlay-title--fail");
    overlayTitle.textContent = "游戏失败";
    overlayMsg.innerHTML =
      failSettle +
      `<p class="settlement-hint">本局已结束。点击下方按钮或按回车将从<strong>第一关</strong>重新开始，分数与关卡进度将重置。</p>`;
    overlayBtn.textContent = "从第一关重来";
    overlay.classList.remove("hidden");
    overlayBtn.onclick = async () => {
      if (snd()) {
        await snd().unlock();
      }
      overlayTitle.classList.remove("overlay-title--fail");
      overlay.classList.add("hidden");
      overlayMsg.textContent = "";
      state = "play";
      resetGame(true);
      snd()?.startBgm();
    };
  }

  /**
   * 通用遮罩：过关结算、提示等。settlementHtml 非空时与 msg 组合为 innerHTML。
   * @param {string} settlementHtml 可选 HTML 片段（蓝钻/用时统计等）
   */
  function showIntermission(title, msg, btnText, onContinue, settlementHtml = null) {
    hideOverlayHomeChrome();
    overlayTitle.classList.remove("overlay-title--fail");
    overlayTitle.textContent = title;
    if (settlementHtml) {
      overlayMsg.innerHTML =
        settlementHtml +
        `<p class="settlement-hint">${escapeHtml(msg)}</p>`;
    } else {
      overlayMsg.textContent = msg;
    }
    overlayBtn.textContent = btnText;
    overlay.classList.remove("hidden");
    overlayBtn.onclick = async () => {
      if (snd()) {
        await snd().unlock();
      }
      overlay.classList.add("hidden");
      if (typeof onContinue === "function") {
        await onContinue();
      }
      state = "play";
    };
  }

  /**
   * 玩家碰到红钻：若非最后一关则 intermission 并进下一关；否则 win、写排行榜、打开通关遮罩。
   */
  function handleLevelComplete() {
    if (currentLevel < LEVEL_COUNT) {
      state = "intermission";
      snd()?.levelClear();
      const levelCfg = LEVELS[currentLevel - 1];
      const doneTitle = levelCfg.title;
      const nextTitle = LEVELS[currentLevel].title;
      const midSettle = `<div class="settlement">
        <div class="settlement-stat"><span>累计蓝钻</span><strong>${score}</strong></div>
        <div class="settlement-stat"><span>累计用时</span><strong>${formatTimeShort(playTimeMs)}</strong></div>
      </div>`;
      const nextMsg =
        currentLevel === 1
          ? `「${doneTitle}」已通过。获得鞘翅：从下一关起，二段跳用完后在空中下落会变慢、可长距离滑翔。下一关：${nextTitle}`
          : `「${doneTitle}」已通过。下一关：${nextTitle}`;
      showIntermission(
        `第 ${currentLevel} 关 · 结算`,
        nextMsg,
        "下一关",
        async () => {
          if (currentLevel === 1) hasElytra = true;
          currentLevel += 1;
          loadLevel(currentLevel);
          applySpawn();
          player.vx = 0;
          player.vy = 0;
          player.airJumpsLeft = 1;
          invuln = 100;
          updateLevelHud();
          camX = Math.max(0, Math.min(maxCamX, player.x - W * 0.35));
        },
        midSettle
      );
    } else {
      state = "win";
      snd()?.stopBgm();
      snd()?.win();
      const rankInfo = addRankingEntry(score, playTimeMs);
      openWinSettlement(rankInfo);
    }
  }

  /**
   * 全部通关后的 HTML 结算页：展示本局蓝钻、用时、名次及本地前 10 榜。
   */
  function openWinSettlement(rankInfo) {
    hideOverlayHomeChrome();
    overlayTitle.classList.remove("overlay-title--fail");
    const { list, rank, entry } = rankInfo;
    const diamonds = score;
    const timeMs = playTimeMs;
    overlayTitle.textContent = "全部通关 · 结算";
    const top = list.slice(0, 10);
    const rows = top
      .map((e, i) => {
        const you = e.id === entry.id ? " rank-row--you" : "";
        return `<div class="rank-row${you}"><span>#${i + 1}</span><span>${e.diamonds} 蓝钻</span><span>${formatTimeShort(e.timeMs)}</span></div>`;
      })
      .join("");
    const rankNote =
      rank <= 10
        ? `<p class="settlement-rank">本局名次：<strong>#${rank}</strong>（先比蓝钻多，再比用时短）</p>`
        : `<p class="settlement-rank">本局名次：<strong>#${rank}</strong>（未显示在下方前十内）</p>`;
    overlayMsg.innerHTML = `
      <div class="settlement">
        <div class="settlement-stat"><span>本局蓝钻</span><strong>${diamonds}</strong></div>
        <div class="settlement-stat"><span>通关用时</span><strong>${formatTimeShort(timeMs)}</strong></div>
        ${rankNote}
      </div>
      <p class="settlement-sub">本地排行榜（前 10）</p>
      <div class="rank-list">${rows || '<div class="rank-empty">暂无记录</div>'}</div>
    `;
    overlayBtn.textContent = "再玩一次";
    overlay.classList.remove("hidden");
    overlayBtn.onclick = async () => {
      if (snd()) {
        await snd().unlock();
      }
      overlay.classList.add("hidden");
      overlayMsg.textContent = "";
      state = "play";
      resetGame(true);
      snd()?.startBgm();
    };
  }

  /**
   * 首屏「开始游戏」等简单遮罩：点击后切到 nextState；若为 play 则 resetGame 并开 BGM。
   */
  function showOverlay(title, msg, btnText, nextState) {
    hideOverlayHomeChrome();
    overlayTitle.classList.remove("overlay-title--fail");
    overlayTitle.textContent = title;
    overlayMsg.textContent = msg;
    overlayBtn.textContent = btnText;
    overlay.classList.remove("hidden");
    overlayBtn.onclick = async () => {
      if (snd()) {
        await snd().unlock();
      }
      overlay.classList.add("hidden");
      state = nextState;
      if (nextState === "play") {
        resetGame(true);
        snd()?.startBgm();
      }
    };
  }

  /**
   * 首屏说明文案：关卡总数、每关弹药、血量/生命等与玩法共用常量，改配置时无需手改此处。
   */
  function getIntroOverlayHelpMessage() {
    return (
      `共 ${LEVEL_COUNT} 关，每关终点有一颗红色钻石，碰到红钻才算过关。蓝钻加分。` +
      `支持二段跳（W 或 ↑）；通过第 1 关后获得鞘翅，二段跳用完后在空中会缓慢下落便于滑翔；滑翔时按住 ↓ 或 S 可加快下落。` +
      `靠近苦力怕时空格为砍刀；贴近幻翼时空格亦为砍刀可击落幻翼，否则有弹药时对幻翼/骷髅自动射击（前四关各 ${DEFAULT_AMMO} 发，第五关无限）。` +
      `血量 ${MAX_HP} 点（受伤或坠落每次扣 1）；扣尽时消耗 1 点生命并回满血量在本关继续。` +
      `生命 ${MAX_PLAYER_LIFE_STOCK} 条，用尽则游戏结束并从第一关整局重开。` +
      `前四关每关最多各 ${ENEMIES_PER_LEVEL} 只苦力怕与幻翼，第五关各 ${ENEMIES_LAST_LEVEL} 只；每关固定一名骷髅弓手，生成在关卡水平最中央，约每 0.5 秒朝你射一支箭，箭只造成击退、不扣血；骷髅可被飞弹或近战击毁。` +
      `游戏失败结算页可按回车确认。` +
      `首页可选「开始游戏」「游戏排行榜」「武器外观」或「游戏设置」（调节背景音乐与音效音量）；「武器外观」内可自选飞弹与砍刀样式、鞘翅翼膜颜色；点「开始游戏」或卡片内空白处即可开局并播放背景音乐与音效。`
    );
  }

  /** 天空渐变 + 视差云朵（与 camX 挂钩营造卷轴感） */
  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, COLORS.skyTop);
    g.addColorStop(1, COLORS.skyBot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(-camX * 0.15, 0);
    for (let i = 0; i < 20; i++) {
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(i * 180 - (camX * 0.05) % 180, 40 + (i % 3) * 20, 80, 24);
    }
    ctx.restore();
  }

  /** 绘制单个平台瓦片（草地分层 / 石砖网格 / 木板竖纹） */
  function drawTilePlat(p) {
    const { x, y, w, h, type } = p;
    const sx = x - camX;

    if (type === "grass") {
      ctx.fillStyle = COLORS.dirt;
      ctx.fillRect(sx, y + 12, w, h - 12);
      ctx.fillStyle = COLORS.grassSide;
      ctx.fillRect(sx, y + 8, w, 8);
      ctx.fillStyle = COLORS.grassTop;
      ctx.fillRect(sx, y, w, 10);
    } else if (type === "stone") {
      ctx.fillStyle = COLORS.stoneDark;
      ctx.fillRect(sx, y, w, h);
      ctx.strokeStyle = "#616161";
      ctx.lineWidth = 2;
      for (let i = 0; i < w; i += 24) {
        for (let j = 0; j < h; j += 24) {
          ctx.strokeRect(sx + i + 2, y + j + 2, 20, 20);
        }
      }
    } else {
      ctx.fillStyle = COLORS.plank;
      ctx.fillRect(sx, y, w, h);
      ctx.strokeStyle = "#8d6e63";
      ctx.lineWidth = 2;
      for (let i = 0; i < w / 16; i++) {
        ctx.beginPath();
        ctx.moveTo(sx + i * 16, y);
        ctx.lineTo(sx + i * 16, y + h);
        ctx.stroke();
      }
    }
  }

  /**
   * 绘制史蒂夫：脚底为轴；走路（摆腿扬尘）、跳跃（流线与抬腿）、射击（举臂/击发/后座火光）、挥砍（蓄力倾身与摆臂）；无敌闪烁。
   */
  function drawSteve() {
    const px = player.x - camX;
    const py = player.y;
    const f = player.facing;
    const vxAbs = Math.abs(player.vx);
    const air = !player.onGround;
    const slash = knifeSwing > 0;
    const shootP = steveShootPose > 0;
    const walk = vxAbs > 0.26 && player.onGround && !slash && !shootP;
    const now = performance.now();
    const runAmp = Math.min(1, vxAbs / maxRun);
    const runF = player.onGround ? 2.05 + vxAbs * 0.22 : 1.08;
    const runPhase = now * 0.001 * (235 * runF);
    const kf = STEVE_KNIFE_FRAMES;
    const sf = STEVE_SHOOT_FRAMES;
    const stSlash = slash ? knifeSwing / kf : 0;
    const stShoot = shootP ? steveShootPose / sf : 0;

    /** 行走摆腿相位：随 facing 微调，左右走时步态不对称（不仅镜像） */
    const walkPhaseOff = walk ? f * 0.38 : 0;
    let leg = walk
      ? Math.sin(runPhase + walkPhaseOff) * 4.6
      : Math.sin(now * 0.0021) * 0.85;
    let arm = walk
      ? Math.sin(runPhase + 0.92 + walkPhaseOff * 0.55) * (2.5 + runAmp * 4.2) +
          f * Math.sin(runPhase * 2) * (0.55 + runAmp * 0.45)
      : Math.sin(now * 0.0029) * 1.4;
    let chopLean = 0;
    let legSpread = 0;
    let slashTwist = 0;

    if (air && !slash && !shootP) {
      leg = Math.sin(now * 0.016) * 3.2 + 3.4;
      arm = -1.2;
      legSpread = 2.4;
    } else if (slash) {
      const wind = stSlash > 0.55 ? (stSlash - 0.55) / 0.45 : 0;
      const hit = stSlash <= 0.55 && stSlash > 0.22 ? 1 : 0;
      leg = 1.2 + wind * 2.4 + hit * Math.sin(stSlash * Math.PI * 3) * 1.2;
      arm = Math.sin(Math.min(1, stSlash * 1.35) * Math.PI) * 6.2;
      chopLean = wind * 0.14 + (1 - stSlash) * 0.08;
      slashTwist = hit * 0.22;
    } else if (shootP) {
      const prep = stShoot > 0.72 ? (stShoot - 0.72) / 0.28 : 0;
      const fire = stShoot <= 0.72 && stShoot > 0.38 ? 1 : 0;
      leg *= 0.35 + prep * 0.25;
      arm = prep * -2.5 + fire * 5.5 + (1 - prep - fire) * 2;
      chopLean = -fire * 0.14 - prep * 0.06;
    }

    /** 速度方向倾角：在 scale(f,1) 之前施加，避免镜像把「往左/往右倾身」抵消 */
    const vxSign = vxAbs > 0.12 ? Math.sign(player.vx) : 0;
    const groundTilt =
      slash || shootP
        ? 0
        : walk
          ? vxSign * runAmp * 0.17
          : player.onGround
            ? vxSign * runAmp * 0.065
            : vxSign * runAmp * 0.04;
    let squashX = 1;
    let squashY = 1;
    if (!player.onGround) {
      if (player.vy < -2) {
        squashY = 1.06;
        squashX = 0.95;
      } else if (player.vy > 3.5) {
        squashY = 0.92;
        squashX = 1.05;
      }
    }
    const bodyBobWalk = walk
      ? Math.sin(runPhase * 2 + f * 0.25) * 1.6
      : 0;
    const headBob =
      player.onGround && walk && !slash && !shootP
        ? Math.sin(runPhase * 2 + 0.4 + f * 0.35) * 1.15
        : air && !slash && !shootP
          ? Math.sin(now * 0.019) * 0.75
          : slash
            ? Math.sin(stSlash * Math.PI) * 0.9
            : 0;

    ctx.save();
    const ox = px + player.w / 2;
    const oy = py + player.h;
    ctx.translate(ox, oy);
    ctx.rotate(groundTilt);
    ctx.scale(f, 1);
    ctx.rotate(
      chopLean + slashTwist + (slash ? (1 - stSlash) * 0.14 : 0)
    );
    ctx.scale(squashX, squashY);
    ctx.translate(-player.w / 2, -player.h);
    ctx.translate(0, bodyBobWalk);

    if (air && !slash && !shootP && player.vy < -0.8) {
      ctx.strokeStyle = `rgba(255,255,255,${Math.min(0.35, (-player.vy) * 0.028)})`;
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(-4 - i * 5, 26 + i * 4);
        ctx.lineTo(-14 - i * 7, 32 + i * 5);
        ctx.stroke();
      }
    }

    ctx.fillStyle = COLORS.stevePants;
    if (walk) {
      const wf = Math.sin(runPhase + walkPhaseOff);
      const wf2 = Math.sin(runPhase + Math.PI + walkPhaseOff * 0.85);
      ctx.fillRect(5, 34 + wf * 3.5, 7, 9);
      ctx.fillRect(5 + wf * 2.2, 42 - wf * 1.2, 7, 10);
      ctx.fillRect(16, 34 + wf2 * 3.5, 7, 9);
      ctx.fillRect(16 + wf2 * 2.2, 42 - wf2 * 1.2, 7, 10);
      ctx.fillStyle = "#1a237e";
      ctx.fillRect(5, 51, 7, 3);
      ctx.fillRect(16, 51, 7, 3);
      if (Math.abs(wf) > 0.88 || Math.abs(wf2) > 0.88) {
        const a = Math.max(Math.abs(wf), Math.abs(wf2)) - 0.88;
        ctx.fillStyle = `rgba(160,140,120,${a * 2.2})`;
        ctx.fillRect(6 + wf * 4, 52, 3, 2);
        ctx.fillRect(17 + wf2 * 4, 52, 3, 2);
        ctx.fillRect(4 + wf * 6, 53, 2, 2);
        ctx.fillRect(19 + wf2 * 5, 53, 2, 2);
      }
    } else if (air && !slash && !shootP) {
      const tuck = Math.min(1, Math.max(0, player.vy) * 0.12);
      ctx.fillRect(4, 40 - tuck * 3, 6, 8);
      ctx.fillRect(1, 46 - tuck * 2, 7, 9);
      ctx.fillRect(18, 40 - tuck * 3, 6, 8);
      ctx.fillRect(21, 46 - tuck * 2, 7, 9);
      ctx.fillStyle = "#1a237e";
      ctx.fillRect(4, 54, 8, 3);
      ctx.fillRect(17, 54, 8, 3);
    } else {
      const ly1 = 38 + leg * 0.22 + legSpread;
      const ly2 = 38 - leg * 0.22 - legSpread;
      ctx.fillRect(5, ly1, 7, 12);
      ctx.fillRect(16, ly2, 7, 12);
      ctx.fillStyle = "#1a237e";
      ctx.fillRect(5, 49, 7, 3);
      ctx.fillRect(16, 49, 7, 3);
    }

    ctx.fillStyle = COLORS.steveShirtDark;
    ctx.fillRect(1, 21, 26, 18);
    ctx.fillStyle = COLORS.steveShirt;
    ctx.fillRect(3, 19, 22, 16);

    if (
      hasElytra &&
      air &&
      player.airJumpsLeft === 0 &&
      !slash &&
      !shootP
    ) {
      const flap = Math.sin(now * 0.009) * 3;
      const spread = Math.min(26, 10 + Math.max(0, player.vy) * 5.5);
      const ec = elytraColorsForStyle(weaponElytraStyle);
      ctx.fillStyle = ec.fill;
      ctx.beginPath();
      ctx.moveTo(2, 24);
      ctx.lineTo(-16 - spread * 0.4, 36 + flap * 0.4);
      ctx.lineTo(2, 32 + flap * 0.15);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(26, 24);
      ctx.lineTo(42 + spread * 0.4, 36 + flap * 0.4);
      ctx.lineTo(26, 32 + flap * 0.15);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = ec.stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.fillStyle = COLORS.steveSkin;
    if (shootP) {
      const prep = stShoot > 0.72 ? (stShoot - 0.72) / 0.28 : 0;
      const fire = stShoot <= 0.72 && stShoot > 0.38 ? 1 : 0;
      const rec = stShoot <= 0.38 ? 1 - stShoot / 0.38 : 0;
      const ws = weaponShootStyle;
      let gunFill = "#3949ab";
      let muzzleFillA = 0.22;
      let muzzleFillB = 0.52;
      let muzzleFillC = 0.18;
      let muzzleRgb = "255,112,92";
      let strokeRgb = "255,205,200";
      if (ws === 1) {
        gunFill = "#00695c";
        muzzleFillA = 0.2;
        muzzleFillB = 0.48;
        muzzleFillC = 0.16;
        muzzleRgb = "77,208,225";
        strokeRgb = "224,247,250";
      } else if (ws === 2) {
        gunFill = "#4a148c";
        muzzleFillA = 0.22;
        muzzleFillB = 0.55;
        muzzleFillC = 0.2;
        muzzleRgb = "234,128,252";
        strokeRgb = "248,187,255";
      } else if (ws === 3) {
        gunFill = "#e65100";
        muzzleFillA = 0.24;
        muzzleFillB = 0.52;
        muzzleFillC = 0.2;
        muzzleRgb = "255,183,77";
        strokeRgb = "255,236,179";
      } else if (ws === 4) {
        gunFill = "#37474f";
        muzzleFillA = 0.2;
        muzzleFillB = 0.5;
        muzzleFillC = 0.18;
        muzzleRgb = "179,229,252";
        strokeRgb = "236,239,241";
      }
      ctx.fillRect(2 + arm * 0.08, 21 + prep * 2, 5, 13);
      ctx.fillRect(20 + prep * 3 + fire * 6, 16 - fire * 3, 11, 7 + fire * 2);
      ctx.fillStyle = gunFill;
      ctx.fillRect(23 + prep * 2 + fire * 7, 17 - fire * 2, 10, 5 + fire * 3);
      ctx.fillStyle = COLORS.steveSkin;
      if (fire > 0 || (stShoot > 0.38 && stShoot < 0.82)) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = `rgba(${muzzleRgb},${muzzleFillA + fire * muzzleFillB + rec * muzzleFillC})`;
        ctx.beginPath();
        ctx.arc(31 + fire * 4, 19, 4 + fire * 8 + rec * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(${strokeRgb},${fire * 0.5})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(31 + fire * 3, 19, 10 + fire * 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    } else if (slash) {
      const back = stSlash > 0.55 ? (stSlash - 0.55) / 0.45 : 0;
      ctx.fillRect(1 + back * 4, 18 + back * 6, 6, 13);
      ctx.fillRect(19 - back * 2 + (1 - back) * 2, 16 - stSlash * 5, 7, 15);
    } else if (air) {
      const up = -6;
      ctx.fillRect(1, 7 + up, 5, 20);
      ctx.fillRect(22, 7 + up, 5, 20);
      ctx.fillRect(0, 9 + up, 4, 8);
      ctx.fillRect(24, 9 + up, 4, 8);
    } else {
      ctx.fillRect(arm * 0.1, 21, 5, 14);
      ctx.fillRect(23 - arm * 0.1, 21, 5, 14);
    }

    const hb = headBob;
    const eyeS = air && !slash && !shootP && player.vy < -2 ? 1 : 0;
    ctx.fillStyle = COLORS.steveSkin;
    ctx.fillRect(5, 4 + hb, 18, 16);
    ctx.fillStyle = COLORS.steveHair;
    ctx.fillRect(5, 0 + hb, 18, 5);
    ctx.fillRect(3, 2 + hb, 5, 8);
    ctx.fillRect(20, 2 + hb, 5, 8);
    ctx.fillStyle = "#fff";
    ctx.fillRect(8, 10 + hb, 4, 3);
    ctx.fillRect(16, 10 + hb, 4, 3);
    ctx.fillStyle = COLORS.steveEye;
    ctx.fillRect(9 - eyeS * 0.5, 11 + hb, 2 + eyeS, 2 + eyeS);
    ctx.fillRect(17 - eyeS * 0.5, 11 + hb, 2 + eyeS, 2 + eyeS);

    if (invuln > 0 && Math.floor(invuln / 4) % 2 === 0) {
      ctx.globalAlpha = 0.45;
    }
    ctx.restore();
  }

  /** 未拾取的蓝钻：自转菱形 */
  function drawDiamonds() {
    for (const d of diamonds) {
      if (d.taken) continue;
      const sx = d.x - camX;
      ctx.save();
      ctx.translate(sx + d.w / 2, d.y + d.h / 2);
      ctx.rotate((performance.now() / 400) % (Math.PI * 2));
      ctx.fillStyle = COLORS.diamond;
      ctx.beginPath();
      ctx.moveTo(0, -10);
      ctx.lineTo(8, 0);
      ctx.lineTo(0, 10);
      ctx.lineTo(-8, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = COLORS.diamondShine;
      ctx.fillRect(-2, -4, 4, 8);
      ctx.restore();
    }
  }

  /** 终点红钻：旋转 + 外发光，已拾取则跳过 */
  function drawRedGoalGem() {
    if (!redGoalGem || redGoalGem.taken) return;
    const g = redGoalGem;
    const sx = g.x - camX;
    ctx.save();
    ctx.translate(sx + g.w / 2, g.y + g.h / 2);
    ctx.rotate((performance.now() / 320) % (Math.PI * 2));
    ctx.shadowColor = "rgba(229,57,53,0.65)";
    ctx.shadowBlur = 14;
    ctx.fillStyle = COLORS.redDiamond;
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(11, 0);
    ctx.lineTo(0, 12);
    ctx.lineTo(-11, 0);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = COLORS.redDiamondCore;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(6, 0);
    ctx.lineTo(0, 6);
    ctx.lineTo(-6, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = COLORS.redDiamondShine;
    ctx.fillRect(-3, -5, 6, 9);
    ctx.restore();
  }

  /** 苦力怕：上下微摆 + 腿部交替；按 facing 水平翻转贴图 */
  function drawCreepers() {
    const tm = performance.now() * 0.009;
    for (const c of creepers) {
      const sx = c.x - camX;
      const bob = Math.sin(tm + c.x * 0.015) * 1.2;
      const vxSign = c.vx >= 0 ? 1 : -1;
      const leg = Math.sin(tm * 1.65 + c.x * 0.04 + (vxSign < 0 ? 1.1 : 0)) * 2.45;
      const by = c.y + bob;
      const face = (c.facing ?? vxSign) >= 0 ? 1 : -1;

      ctx.save();
      ctx.translate(sx + c.w / 2, by + 20);
      ctx.scale(face, 1);
      ctx.translate(-c.w / 2, -20);

      ctx.fillStyle = COLORS.creeperDark;
      ctx.fillRect(4, 28 + leg, 7, 11);
      ctx.fillRect(21, 28 - leg, 7, 11);

      ctx.fillStyle = COLORS.creeper;
      ctx.fillRect(0, 0, c.w, 28);
      ctx.fillStyle = COLORS.creeperLight;
      ctx.fillRect(2, 2, c.w - 4, 7);

      ctx.fillStyle = COLORS.creeperFace;
      ctx.fillRect(6, 10, 8, 8);
      ctx.fillRect(18, 10, 8, 8);
      ctx.fillRect(12, 22, 8, 6);
      ctx.fillStyle = "#0d1a0d";
      ctx.fillRect(8, 12, 4, 4);
      ctx.fillRect(20, 12, 4, 4);
      ctx.fillRect(14, 24, 4, 3);
      ctx.fillStyle = "#000";
      ctx.fillRect(12, 18, 8, 2);

      ctx.restore();
    }
  }

  /** 幻翼：翅膀扑动、身体椭圆与尾摆、发光眼 */
  function drawPhantoms() {
    const now = performance.now();
    for (const ph of phantoms) {
      const sx = ph.x - camX;
      const flap = Math.sin(now * 0.011 + ph.phase);
      const bob = Math.sin(now * 0.006 + ph.phase * 0.7) * 2;
      const cx = sx + ph.w / 2;
      const cy = ph.y + ph.h / 2 + bob;

      ctx.save();
      ctx.translate(cx, cy);

      ctx.save();
      ctx.rotate(-0.58 + flap * 0.48);
      ctx.fillStyle = COLORS.phantomWing;
      ctx.beginPath();
      ctx.moveTo(0, -2);
      ctx.lineTo(-32, -10);
      ctx.lineTo(-26, 12);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = COLORS.phantomWingEdge;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.rotate(0.58 - flap * 0.48);
      ctx.beginPath();
      ctx.moveTo(0, -2);
      ctx.lineTo(32, -10);
      ctx.lineTo(26, 12);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = COLORS.phantomBodyLight;
      ctx.beginPath();
      ctx.ellipse(0, 0, 11, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.phantomBody;
      ctx.fillRect(-9, -5, 18, 11);

      ctx.fillStyle = COLORS.phantomBody;
      ctx.beginPath();
      ctx.moveTo(0, 6);
      ctx.lineTo(-5, 18 + flap * 4);
      ctx.lineTo(5, 18 - flap * 3);
      ctx.closePath();
      ctx.fill();

      const eg = ctx.createRadialGradient(-5, -2, 0, -5, -2, 7);
      eg.addColorStop(0, COLORS.phantomEye);
      eg.addColorStop(0.45, COLORS.phantomEyeCore);
      eg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = eg;
      ctx.fillRect(-12, -10, 10, 10);
      const eg2 = ctx.createRadialGradient(5, -2, 0, 5, -2, 7);
      eg2.addColorStop(0, COLORS.phantomEye);
      eg2.addColorStop(0.45, COLORS.phantomEyeCore);
      eg2.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = eg2;
      ctx.fillRect(2, -10, 10, 10);
      ctx.fillStyle = "#002822";
      ctx.fillRect(-6, -3, 2, 2);
      ctx.fillRect(4, -3, 2, 2);

      ctx.restore();
    }
  }

  /**
   * 鞘翅滑翔：已解锁、离地、二段跳次数用尽且正在下落时，重力减弱并限制最大下落速度。
   */
  function isElytraGliding() {
    return (
      state === "play" &&
      hasElytra &&
      !player.onGround &&
      player.airJumpsLeft === 0 &&
      player.vy > ELYTRA_GLIDE_MIN_VY
    );
  }

  /**
   * 单帧玩家物理：重力、摩擦、左右加速、跳跃（含二段跳）、与平台 AABB 分离轴解算、镜头跟随。
   * 掉出地图底部则扣 1 血量并拉回出生点；若血量因此扣尽则再触发 onLifeStockLost（消耗生命）。
   */
  function resolvePlayer() {
    const inElytraAir =
      state === "play" &&
      hasElytra &&
      !player.onGround &&
      player.airJumpsLeft === 0 &&
      player.vy > ELYTRA_GLIDE_MIN_VY;
    const elytraSinkDown =
      inElytraAir &&
      (keys.has("ArrowDown") || keys.has("s") || keys.has("S"));
    player.vy +=
      gravity * (inElytraAir && !elytraSinkDown ? ELYTRA_GRAVITY_MUL : 1);
    player.vx *= player.onGround ? friction : airFriction;

    const speedAbs = Math.abs(player.vx);
    const accelMul =
      player.onGround && speedAbs < runSoftSpeed ? runSoftMul : 1;
    const ax = moveAccel * accelMul;

    if (keys.has("ArrowLeft") || keys.has("a") || keys.has("A")) {
      player.vx -= ax;
      player.facing = -1;
    }
    if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) {
      player.vx += ax;
      player.facing = 1;
    }
    player.vx = Math.max(-maxRun, Math.min(maxRun, player.vx));

    if (jumpPressed) {
      if (player.onGround) {
        player.vy = jumpV;
        player.onGround = false;
        jumpPressed = false;
        snd()?.jump(false);
        const runHeld =
          keys.has("ArrowLeft") ||
          keys.has("a") ||
          keys.has("A") ||
          keys.has("ArrowRight") ||
          keys.has("d") ||
          keys.has("D");
        if (runHeld && Math.abs(player.vx) < jumpRunCarry) {
          player.vx = player.facing * jumpRunCarry;
        }
      } else if (player.airJumpsLeft > 0) {
        player.vy = jumpV * 0.9;
        player.airJumpsLeft -= 1;
        jumpPressed = false;
        snd()?.jump(true);
      } else {
        jumpPressed = false;
      }
    }

    player.x += player.vx;
    player.y += player.vy;
    player.onGround = false;

    const hb = { x: player.x, y: player.y, w: player.w, h: player.h };
    for (const p of platforms) {
      if (!rectsOverlap(hb, p)) continue;
      // 四方向穿透深度，取最小者作为「当前应解决的碰撞轴」（经典平台 AABB 解法）
      const overlapL = hb.x + hb.w - p.x;
      const overlapR = p.x + p.w - hb.x;
      const overlapT = hb.y + hb.h - p.y;
      const overlapB = p.y + p.h - hb.y;
      const m = Math.min(overlapL, overlapR, overlapT, overlapB);

      if (m === overlapT && player.vy >= 0) {
        player.y = p.y - player.h;
        player.vy = 0;
        player.onGround = true;
        player.airJumpsLeft = 1;
      } else if (m === overlapB && player.vy < 0) {
        player.y = p.y + p.h;
        player.vy = 0;
      } else if (m === overlapL) {
        player.x = p.x - player.w;
        player.vx = 0;
      } else if (m === overlapR) {
        player.x = p.x + p.w;
        player.vx = 0;
      }
    }

    if (isElytraGliding() && player.vy > ELYTRA_MAX_FALL_VY) {
      const sinking =
        keys.has("ArrowDown") || keys.has("s") || keys.has("S");
      if (!sinking) player.vy = ELYTRA_MAX_FALL_VY;
    }

    /** 摔出地图：扣 1 血量并拉回出生点；血量扣尽时再消耗生命（走 onLifeStockLost） */
    if (state === "play" && player.y > H + 200) {
      hp -= 1;
      updateLifeHud();
      invuln = 120;
      triggerDamageFx();
      if (hp > 0) {
        applySpawn();
        player.vx = 0;
        player.vy = 0;
        player.airJumpsLeft = 1;
        camX = Math.max(0, Math.min(maxCamX, player.x - W * 0.35));
        snd()?.hurt();
      } else {
        onLifeStockLost();
      }
    }

    /** 史蒂夫行走音效：贴地、非挥砍/射击、水平速度足够时按位移累计触发 */
    if (state === "play") {
      const vxAbs = Math.abs(player.vx);
      const canWalkSfx =
        player.onGround &&
        vxAbs > WALK_SFX_MIN_VX &&
        knifeSwing <= 0 &&
        steveShootPose <= 0;
      if (canWalkSfx) {
        walkSoundAccum += vxAbs;
        while (walkSoundAccum >= WALK_SFX_DIST_PER_STEP) {
          walkSoundAccum -= WALK_SFX_DIST_PER_STEP;
          snd()?.footstep();
        }
      } else {
        walkSoundAccum = 0;
      }
    }

    camX = player.x - W * 0.35;
    if (camX < 0) camX = 0;
    if (camX > maxCamX) camX = maxCamX;
  }

  /**
   * 与苦力怕/幻翼重叠且无敌帧结束时的扣血：减 1 血量；血量 >0 则小击退，否则消耗 1 点生命并可能游戏结束。
   */
  function hurtPlayerFromEnemy() {
    if (state !== "play") return;
    hp -= 1;
    updateLifeHud();
    invuln = 120;
    triggerDamageFx();
    if (hp > 0) {
      snd()?.hurt();
      player.vx = player.facing * -6;
      player.vy = -6;
    } else {
      onLifeStockLost();
    }
  }

  /**
   * 每帧收集物与敌人逻辑（部分在 play 外也会跑，如钻石检测依赖 hb）：
   * 挥刀倒计时、射击、幻翼生成/AI、飞弹、蓝钻/红钻、无敌递减、苦力怕巡逻与伤害、幻翼伤害。
   * @param {number} dt 距上一帧毫秒，用于与 16.67ms 基准归一化（防止大卡顿穿墙）
   */
  function updateCollectibles(dt = 16) {
    const hb = { x: player.x, y: player.y, w: player.w, h: player.h };
    const k = Math.min(dt / 16, 2.5);

    if (state === "play") {
      if (knifeSwing > 0) knifeSwing -= 1;
      if (steveShootPose > 0) steveShootPose -= 1;
      tryConsumeShoot();
    }

    if (state === "play") {
      const Lp = LEVELS[currentLevel - 1];
      const phantomUnlock =
        player.x >= Lp.spawnX + PHANTOM_MIN_PROGRESS_FROM_SPAWN;
      if (phantomUnlock) {
        if (!phantomUnlockPrev) {
          phantomSpawnCooldown = Math.min(
            phantomSpawnCooldown,
            PHANTOM_FIRST_DELAY_MAX
          );
        }
        phantomSpawnCooldown -= dt;
        if (
          phantomSpawnCooldown <= 0 &&
          phantomsSpawnedTotal < phantomLevelCap
        ) {
          spawnOnePhantomAtSlot(phantomsSpawnedTotal);
          phantomsSpawnedTotal += 1;
          const lvExtra = (currentLevel - 1) * PHANTOM_LEVEL_STAGGER_EXTRA;
          if (phantomsSpawnedTotal < phantomLevelCap) {
            phantomSpawnCooldown =
              PHANTOM_STAGGER_BASE +
              (phantomsSpawnedTotal - 1) * PHANTOM_STAGGER_PER_SLOT +
              Math.random() * PHANTOM_STAGGER_JITTER +
              lvExtra;
          } else {
            phantomSpawnCooldown = 1e9;
          }
        }
      }
      phantomUnlockPrev = phantomUnlock;
    }

    if (state === "play") {
      const wob = performance.now() * 0.0025;
      for (const ph of phantoms) {
        // 幻翼：朝玩家上半身方向加速 + 正余弦扰动，阻尼与限速防止飞出玩法区
        const tcx = player.x + player.w * 0.5 - (ph.x + ph.w * 0.5);
        const tcy = player.y + player.h * 0.35 - (ph.y + ph.h * 0.5);
        const td = Math.hypot(tcx, tcy) || 1;
        ph.vx +=
          (tcx / td) * PH_HUNT_ACCEL +
          Math.sin(wob * 2.4 + ph.phase) * PH_WOBBLE_ACCEL;
        ph.vy +=
          (tcy / td) * (PH_HUNT_ACCEL * 0.78) +
          Math.cos(wob * 2 + ph.phase) * (PH_WOBBLE_ACCEL * 0.75);
        ph.vx *= PH_DAMP;
        ph.vy *= PH_DAMP;
        ph.vx = Math.max(-PH_VX_MAX, Math.min(PH_VX_MAX, ph.vx));
        ph.vy = Math.max(-PH_VY_MAX, Math.min(PH_VY_MAX, ph.vy));
        ph.x += ph.vx * k;
        ph.y += ph.vy * k;
        if (ph.y < 40) ph.y = 40;
        if (ph.y > 395) ph.y = 395;
        if (ph.x < camX - 140) ph.x = camX + W + 30;
        else if (ph.x > camX + W + 140) ph.x = camX - 30;
      }
    }

    if (state === "play") {
      updateProjectiles(dt);
    }

    if (state === "play") {
      updateSkeletonArcherSystem(dt);
    }

    for (const d of diamonds) {
      if (d.taken) continue;
      if (rectsOverlap(hb, d)) {
        d.taken = true;
        score += 1;
        scoreEl.textContent = String(score);
        snd()?.diamond();
      }
    }

    if (
      redGoalGem &&
      !redGoalGem.taken &&
      rectsOverlap(hb, redGoalGem)
    ) {
      redGoalGem.taken = true;
      snd()?.redGoal();
      handleLevelComplete();
      return;
    }

    if (invuln > 0) invuln -= 1;

    for (const c of creepers) {
      c.x += c.vx * k;
      // 平台巡逻：到左/右边界贴齐并水平速度改向，保证 |vx| 恒为正数乘方向
      if (c.x <= c.minX) {
        c.x = c.minX;
        c.vx = Math.abs(c.vx);
      } else if (c.x + c.w >= c.maxX) {
        c.x = c.maxX - c.w;
        c.vx = -Math.abs(c.vx);
      }
      c.facing = c.vx >= 0 ? 1 : -1;

      if (invuln <= 0 && rectsOverlap(hb, c)) {
        hurtPlayerFromEnemy();
      }
    }

    for (const ph of phantoms) {
      if (invuln <= 0 && rectsOverlap(hb, ph)) {
        hurtPlayerFromEnemy();
        break;
      }
    }
  }

  /**
   * 主循环：先算 dt；play 时累加计时、更新玩家与收集物逻辑。
   * 绘制始终执行（菜单/死亡时画面仍刷新），世界层 clip 在画布内，闪红与震屏在 clip 外叠加。
   */
  function loop() {
    const now = performance.now();
    const dt = Math.min(now - lastLoopTs, 120);
    lastLoopTs = now;
    if (state === "play") {
      playTimeMs += dt;
      updateTimerHud();
      resolvePlayer();
      updateCollectibles(dt);
    }

    drawBackground();

    const camSaved = camX;
    if (damageShake > 0.12) {
      camX += (Math.random() - 0.5) * damageShake * 2.2;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();

    for (const p of platforms) drawTilePlat(p);
    drawCreepers();
    drawSkeletonArcher();
    drawPhantoms();
    drawDiamonds();
    drawRedGoalGem();
    drawSkeletonArrows();
    drawSteve();
    drawKnifeSlash();
    drawProjectiles();

    ctx.restore();

    camX = camSaved;

    if (damageFlash > 0) {
      const k = damageFlash / 36;
      ctx.fillStyle = `rgba(183,28,28,${0.14 + k * 0.38})`;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = `rgba(255,255,255,${k * 0.12})`;
      ctx.lineWidth = 3;
      ctx.strokeRect(2, 2, W - 4, H - 4);
    }

    if (damageShake > 0.08) {
      damageShake *= 0.86;
    } else {
      damageShake = 0;
    }
    if (damageFlash > 0) {
      damageFlash -= 1;
    }

    requestAnimationFrame(loop);
  }

  // --- 键盘输入：方向持续态 + 跳跃/射击边沿；遮罩上回车等效点击主按钮（开始/从第一关重来/下一关） ---
  window.addEventListener("keydown", (e) => {
    if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault();
    }
    keys.add(e.key);
    if (e.code === "Space") keys.add("Space");

    const jumpKey =
      e.key === "ArrowUp" || e.key === "w" || e.key === "W";
    if (jumpKey && !e.repeat) {
      jumpPressed = true;
    }
    if ((e.code === "Space" || e.key === " ") && !e.repeat) {
      shootPressed = true;
    }

    if (
      (e.key === "Enter" || e.code === "Enter") &&
      !e.repeat &&
      overlay &&
      !overlay.classList.contains("hidden") &&
      (state === "menu" ||
        state === "leaderboard" ||
        state === "weapon_select" ||
        state === "settings" ||
        state === "gameover" ||
        state === "intermission")
    ) {
      e.preventDefault();
      overlayBtn.click();
    }
  });
  window.addEventListener("keyup", (e) => {
    keys.delete(e.key);
    if (e.code === "Space") keys.delete("Space");
  });

  if (overlayCard) {
    overlayCard.addEventListener("click", (e) => {
      if (overlay.classList.contains("hidden")) return;
      const opt = e.target.closest(".weapon-opt");
      if (opt && state === "weapon_select") {
        const kind = opt.getAttribute("data-weapon");
        const idx = Number(opt.getAttribute("data-idx"));
        if (kind === "shoot")
          weaponShootStyle = Math.max(
            0,
            Math.min(WEAPON_SHOOT_STYLES - 1, idx)
          );
        else if (kind === "knife")
          weaponKnifeStyle = Math.max(
            0,
            Math.min(WEAPON_KNIFE_STYLES - 1, idx)
          );
        else if (kind === "elytra")
          weaponElytraStyle = Math.max(
            0,
            Math.min(WEAPON_ELYTRA_STYLES - 1, idx)
          );
        saveWeaponStyles();
        showWeaponSelectPage();
        return;
      }
      if (state === "settings" && e.target.closest(".settings-page")) return;
      if (e.target.closest("#overlay-btn")) return;
      if (e.target.closest("#overlay-btn-secondary")) return;
      if (e.target.closest("#overlay-btn-tertiary")) return;
      if (e.target.closest("#overlay-btn-settings")) return;
      overlayBtn.click();
    });
  }

  /** 页眉「重新开始」：整局重置并尝试开 BGM */
  restartBtn.addEventListener("click", async () => {
    if (snd()) {
      await snd().unlock();
    }
    state = "play";
    resetGame(true);
    snd()?.startBgm();
  });

  // --- 首屏初始化：加载第 1 关数据、摆好玩家与镜头，再弹出「开始游戏」遮罩（此时尚未 play） ---
  currentLevel = 1;
  loadLevel(1);
  applySpawn();
  camX = Math.max(0, Math.min(maxCamX, player.x - W * 0.35));
  updateLevelHud();

  loadWeaponStyles();
  showHomePage();

  requestAnimationFrame(loop);
  // 主循环入口；全文件包在 IIFE 内，不向全局泄漏变量（仅注册事件监听与闭包状态）。
})();
