# AI 自动对弈自我提升

本文档记录当前 AI 自学习闭环，供后续迭代 AI 棋手使用。

## 浏览器调试模块

主页展开“AI自学习”后，点击“启动自学习”进入棋盘，由 AI 控制魏、蜀、吴三国自动对弈。

参数：

- 对弈轮数：默认 10，可手动填写。
- 思考强度：
  - 快速：搜索深度 1，每轮上限 2 分钟。
  - 常规：搜索深度 2，每轮上限 3 分钟。
  - 深度：搜索深度 3，每轮上限 5 分钟。

每轮默认规则：

- 出局条件：主公被吃掉。
- 出局棋子处理：障碍。

每轮结束后：

- 正常胜负：棋局自然产生唯一胜者。
- 超时、重复局面、步数过长或无可行棋：按当前评估分裁定一个胜者，避免学习流程卡死。
- 自动运行 AI 基准与调参。
- 候选参数通过固定场景回归且评分不下降时，导入到当前浏览器运行态，下一轮直接使用。

自动对弈模式会启用可控随机探索：AI 仍优先选择高分候选，但会按思考强度从高分候选中抽样，避免三国在镜像局面中持续走出完全一致的棋路。普通玩家对局不启用该随机探索。

魏、蜀、吴现在拥有固定棋风画像：

- 魏：攻势压迫，更偏向车炮进攻和打击强方。
- 蜀：稳健守成，更重视主公安全和士相防线。
- 吴：机动作战，更偏向马炮机动和灵活开发。

普通 AI 对局和自学习对局都会使用这些棋风画像。普通 AI 对局按难度使用思考预算：简单约 2 秒，中等约 5 秒，困难约 10 秒。浏览器会把 AI 计算放入 Web Worker，避免长思考时冻结棋盘。

自动对弈模式会使用极快动画和极短行棋间隔，以提高学习效率。普通玩家对局仍保留原有动画速度。

浏览器调试模块不会写回源码。它适合观察棋局过程、检查调参方向和导出问题数据。

自学习完成至少一轮后，主页“AI自学习”模块会启用“下载学习数据”按钮。该按钮会导出最近一次自学习 JSON。建议把下载文件放入项目目录：

```text
ai-learning-exports/
```

浏览器安全模型不允许页面直接写入项目目录，因此需要手动保存或移动下载文件。

## 浏览器数据

浏览器会保存最近一次自学习数据：

```text
localStorage.three-player-chinese-chess.ai-learning-history
```

字段：

- `savedAt`：保存时间。
- `totalRounds`：计划对弈轮数。
- `completedRounds`：已完成轮数。
- `intensity`：思考强度。
- `config`：本轮搜索深度、调参迭代次数、时间上限、步数上限。
- `config.explorationRate`：自动对弈随机探索概率。
- `config.explorationTop`：随机探索时参与抽样的高分候选数量。
- `config.timeBudgetMs`：单步 AI 思考预算。
- `records`：每轮对局记录。
- `profile`：当前浏览器使用的 AI 参数。

每轮 `records` 字段：

- `round`：轮次。
- `winner`：胜者。
- `reason`：结束原因，可能为 `winner`、`timeout`、`repetition`、`ply-limit`、`no-move`。
- `plies`：总步数。
- `durationMs`：耗时。
- `baselineScore`：调参前基准分。
- `candidateScore`：候选参数基准分。
- `gain`：评分变化。
- `applied`：是否导入候选参数。
- `scenario`：固定回归场景通过数。
- `styles`：本轮魏、蜀、吴使用的棋风标签。
- `timeBudgetMs`：本轮单步思考预算。
- `repetitions`：本轮最高重复局面次数。
- `benchmarkSummary`：调参候选的自博弈摘要。
- `rejectedCandidates`：本轮调参中被拒绝的候选数量。
- `moves`：行棋记录。

后续定位 AI 问题时，优先提供：

- `three-player-chinese-chess.ai-learning-history` 的 JSON。
- 或者“下载学习数据”导出的 JSON 文件。
- 问题发生轮次。
- 对应 `moves`。
- 当时的 `profile`。

## 本地长跑

如果要产出可部署源码改动，使用命令行长跑：

```bash
npm run ai:learn:loop -- --hours 8 --iterations 120 --verify
```

该命令会把有效参数写回：

```text
src/core/ai-profile.ts
```

并把每轮报告写入：

```text
ai-learning-runs/
```

最近一轮报告：

```text
ai-learning-runs/latest.json
```

## 迭代原则

- 浏览器模块用于可视化观察和临时调参。
- 命令行长跑用于生成可部署代码。
- 新发现的坏棋应沉淀为 `src/core/ai-scenarios.ts` 固定场景。
- 参数调优只修改 `src/core/ai-profile.ts`。
- 策略代码级改动，例如搜索结构、三国博弈模型、残局策略，应单独开发并配套场景测试。
