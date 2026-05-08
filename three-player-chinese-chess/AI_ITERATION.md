# AI 迭代工作流

目标：让 AI 不再依赖人工逐步指出坏棋，而是通过固定局面、轻量自我对弈和自动调参持续改进。

## 命令

```bash
npm run ai:benchmark
```

运行固定局面和轻量自我对弈，输出：

- 关键局面通过数。
- 失败局面原因。
- 平均思考耗时。
- 多开局、多棋风自我对弈平均步数。
- 早期出局次数。
- 胜者分布。
- 自然胜负数、重复局面数、开局多样性和平均安全分。

```bash
npm run ai:tune -- --iterations 20
```

自动扰动 AI 参数并运行基准，输出搜索到的较优参数，但不写回代码。

```bash
npm run ai:improve
```

自动调参、写回 `src/core/ai-profile.ts`、运行测试、再运行基准。

```bash
npm run ai:learn:loop -- --hours 8 --iterations 120 --verify
```

长期运行的本地自学习流程。每隔 8 小时执行一轮：

- 读取当前 `src/core/ai-profile.ts` 的 AI 参数。
- 运行基准作为 baseline。
- 使用小种群扰动搜索候选参数，每个候选会同时调整多个相关权重。
- 只有候选分数提升、固定场景全部通过时，才写回 `src/core/ai-profile.ts`。
- 未通过的候选会记录拒绝原因，方便判断是场景回归还是综合分不足。
- 加上 `--verify` 时，写回后会运行 `npm test`；如果测试失败，会自动回滚本轮写入。
- 每轮报告会写入 `ai-learning-runs/`，其中 `latest.json` 是最近一轮结果。

如果只想试跑一轮，可以使用：

```bash
npm run ai:learn:loop -- --cycles 1 --iterations 20 --verify
```

浏览器主页的“AI自学习”模块提供可视化调试版本：点击“启动自学习”后，会进入棋盘并由 AI 控制魏、蜀、吴自动对弈。浏览器模块会把学习记录保存到 `localStorage.three-player-chinese-chess.ai-learning-history`，但不会写回源码。完整数据结构见 `AI_SELF_LEARNING.md`。

## 结构

- `src/core/ai-profile.ts`：AI 参数画像，包含搜索宽度、子力价值和评分权重。
- `src/core/ai.ts`：AI 搜索、三方响应模型、战术延伸和魏蜀吴棋风应用。
- `src/core/ai-scenarios.ts`：关键局面库，用于防止 AI 回归。
- `src/app/ai-worker.ts`：浏览器 AI 计算 Worker，避免长思考阻塞 UI。
- `scripts/ai-benchmark.ts`：基准评估入口。
- `scripts/ai-tune.ts`：自动参数搜索入口。
- `scripts/ai-learn-loop.ts`：长期本地自学习入口，会把有效改进写回可部署代码。

## 迭代原则

- 新发现的坏棋应优先沉淀为 `ai-scenarios.ts` 中的场景。
- 只有 `ai:benchmark` 通过，才认为一次 AI 改动合格。
- `ai:improve` 写回参数后，仍需要检查基准输出，避免只优化局部分数。
- 当前自学习优化的是 AI 搜索参数和评分权重，不自动改写 `src/core/ai.ts` 的策略代码。策略代码级别的变化应单独开发，并用场景测试和自我对弈报告验证。
