# AI 棋手规则规格

本文档沉淀当前已实现的玩法规则，为后续增加“AI 棋手”提供统一依据。AI 不应读取 Canvas、DOM 或屏幕坐标；AI 只依赖 `src/core` 中的纯 TypeScript 状态和规则函数。

## 1. AI 的输入与输出

AI 输入：

```ts
GameState
```

AI 输出：

```ts
{
  pieceId: string;
  target: PointId;
}
```

AI 决策流程建议：

1. 读取 `state.currentKingdom`，确定当前需要行动的国家。
2. 从 `state.pieces` 中筛选 `piece.controller === state.currentKingdom` 且 `piece.blocksMovement === true` 的棋子。
3. 对每个棋子调用 `getLegalMoves(state, piece)` 生成候选目标。
4. 将所有 `{ pieceId, target }` 作为候选动作。
5. 对候选动作调用 `applyMove(state, pieceId, target)` 得到后继状态。
6. 对后继状态评分并选择最佳动作。

## 2. 核心数据模型

### 国度

```ts
type Kingdom = "wei" | "wu" | "shu";
```

显示名：

| Kingdom | 显示 |
| --- | --- |
| `wei` | 魏 |
| `shu` | 蜀 |
| `wu` | 吴 |

### 点位

```ts
type PointId = "A1" | "A2" | ... | "O9";
```

全棋盘共 `135` 个可落子点，详见 `BOARD_SPEC.md`。

### 棋子

```ts
interface Piece {
  id: string;
  type: PieceType;
  kingdom: Kingdom;
  controller: Kingdom;
  color: "red" | "blue" | "green";
  label: string;
  position: PointId;
  defeated: boolean;
  blocksMovement: boolean;
}
```

字段说明：

| 字段 | 含义 |
| --- | --- |
| `kingdom` | 棋子原始所属国家，不随接管变化 |
| `controller` | 当前控制该棋子的国家，接管模式下会变化 |
| `color` | 棋子文字原始颜色 |
| `defeated` | 棋子所属国家是否已出局 |
| `blocksMovement` | 是否仍占据点位并阻挡行棋 |

AI 行棋时应使用 `controller` 判断控制权，而不是使用 `kingdom`。

### 棋局状态

```ts
interface GameState {
  pieces: Piece[];
  selectedPieceId: string | null;
  legalMoves: PointId[];
  currentKingdom: Kingdom;
  checkedKingdoms: Kingdom[];
  winner: Kingdom | null;
  lastMoveMessage: string | null;
  defeatedKingdoms: Kingdom[];
  options: GameOptions;
}
```

AI 可忽略 `selectedPieceId`、`legalMoves`、`lastMoveMessage`，这些主要用于 UI。

## 3. 玩法配置

```ts
type DefeatCondition = "checkmate" | "capture";
type DefeatedPieceMode = "remove" | "block" | "takeover";

interface GameOptions {
  defeatCondition: DefeatCondition;
  defeatedPieceMode: DefeatedPieceMode;
}
```

### 出局条件

| 配置 | 规则 |
| --- | --- |
| `checkmate` | 主公被将军，且该国无法通过任意一步解除将军，则出局 |
| `capture` | 主公被实际吃掉时出局 |

### 出局棋子处理

| 配置 | 规则状态变化 | AI 影响 |
| --- | --- | --- |
| `remove` | 出局国所有棋子从 `pieces` 中移除 | 不再参与阻挡或行动 |
| `block` | 出局棋子保留，`defeated=true`，`blocksMovement=true`，`controller` 不变 | 只作为障碍，不应生成可行动作 |
| `takeover` | 出局棋子保留，`defeated=true`，`blocksMovement=true`，`controller` 改为征服方 | 征服方可操作这些棋子 |

## 4. 回合顺序

固定顺序：

```text
魏 -> 蜀 -> 吴 -> 魏
```

代码常量：

```ts
turnOrder = ["wei", "shu", "wu"];
```

当某国出局后，回合推进会跳过该国。

示例：

```text
魏吃掉吴主公，吴出局后：
魏 -> 蜀 -> 魏
```

## 5. 动作生成

AI 应通过以下方式生成动作：

```ts
function getAvailableActions(state: GameState) {
  return state.pieces
    .filter(piece => piece.controller === state.currentKingdom)
    .filter(piece => piece.blocksMovement)
    .flatMap(piece => {
      return getLegalMoves(state, piece).map(target => ({
        pieceId: piece.id,
        target,
      }));
    });
}
```

注意：

- 当前实现的 `getLegalMoves` 返回棋子本身可走的全部路线。
- 即使某国处于被将军状态，也不会过滤掉“不能解将”的走法。
- 这符合当前交互设计：玩家自行选择是否解将。
- 如果出局条件为 `checkmate`，则 `applyMove` 后会自动判断是否有国家被将死。

## 6. 执行动作

AI 不应自己修改 `GameState`。统一使用：

```ts
applyMove(state, pieceId, target): GameState
```

`applyMove` 会处理：

- 回合合法性检查
- 目标是否合法
- 普通吃子
- 主公被吃出局
- 将死出局
- 出局棋子处理配置
- 跳过已出局国家
- 胜者判断
- 将军状态刷新

非法动作会抛出错误。AI 在搜索中应只使用 `getLegalMoves` 生成动作，避免触发非法动作。

## 7. 终局判断

```ts
state.winner !== null
```

当只剩一个未出局国家时，该国成为 `winner`。

AI 搜索时：

- 如果 `state.winner === aiKingdom`，应视为极大收益。
- 如果 `state.winner !== null && state.winner !== aiKingdom`，应视为极大损失。
- 如果 `state.winner === null`，继续搜索。

## 8. 将军与将死

将军检测：

```ts
getCheckedKingdoms(state): Kingdom[]
isKingdomInCheck(state, kingdom): boolean
```

将死检测：

```ts
getCheckmatedKingdoms(state): Kingdom[]
```

当前将死定义：

1. 该国处于被将军状态。
2. 该国所有 `controller === kingdom` 且 `blocksMovement === true` 的棋子，都没有任意一步能让该国脱离将军。

注意：

- 在 `takeover` 模式下，被接管棋子的 `controller` 会变成征服方，因此会参与征服方的解将与行动。
- 在 `block` 模式下，出局棋子虽然阻挡路线，但不应作为行动棋子。

## 9. 棋子走法

当前已实现棋子：

| 类型 | 显示 | 规则摘要 |
| --- | --- | --- |
| `general` | 魏/吴/蜀 | 在本国九宫内沿连接线移动；攻击判定包含照将 |
| `advisor` | 士 | 在本国九宫斜线移动 |
| `elephant` | 相 | 本国范围内走田字，受象眼阻挡 |
| `horse` | 马 | 走日字，受马腿阻挡；可按跨界展开网格跨界 |
| `chariot` | 车 | 沿行棋线直行，不能越子，可跨界 |
| `cannon` | 炮 | 移动同车；吃子必须隔一个棋子，可跨界 |
| `soldier` | 兵/卒 | 向中心前进；到中心侧行后可跨界，过界后可前进或左右，不可后退 |

跨界展开线详见 `BOARD_SPEC.md` 的 `5.1 跨界行棋展开线`。

## 10. AI 评估建议

第一版 AI 可以先做浅层搜索：

```text
1-ply: 贪心吃子
2-ply: 预测下一家回应
3-ply: 魏/蜀/吴完整一轮
```

三人棋不是标准零和二人博弈，建议先使用“当前 AI 国度收益最大化”的评分：

```ts
score(state, aiKingdom) =
  material(aiKingdom)
  - max(material(otherKingdoms))
  + safety(aiKingdom)
  + tacticalBonuses
```

初始棋子基础价值建议：

| 棋子 | 建议分值 |
| --- | --- |
| 主公 | 10000 |
| 车 | 900 |
| 炮 | 450 |
| 马 | 400 |
| 相 | 200 |
| 士 | 200 |
| 兵/卒 | 100 |

战术加分：

- 将军对手：加分
- 可吃主公：极大加分
- 自家被将军：扣分
- 出局一个对手：大幅加分
- 接管模式下获得额外棋子：加分

## 11. AI 集成边界

当前 AI 模块放在：

```text
src/core/ai.ts
src/core/ai-profile.ts
src/core/ai-scenarios.ts
scripts/ai-benchmark.ts
scripts/ai-tune.ts
```

当前导出：

```ts
interface AiMove {
  pieceId: string;
  from: PointId;
  target: PointId;
}

function chooseAiMove(state: GameState, kingdom: Kingdom): AiMove | null;
function getAiActions(state: GameState, kingdom: Kingdom): AiMove[];
function evaluateAiState(state: GameState, kingdom: Kingdom): number;
```

当前实现为中级规则 AI：

- 使用“候选排序 + 波束搜索”控制分支数量，减少无效思考。
- 中后盘模拟当前 AI 行棋后的另外两国响应，按对 AI 不利的三方博弈局面估值；开局阶段以快速阵型评估为主，避免浏览器主线程卡顿。
- 搜索内部保留 alpha-beta 剪枝，优先展开高价值动作。
- 搜索叶子追加轻量战术稳定性评分，惩罚己方高价值棋子落在可被反吃的位置，避免完整安静搜索造成思考过慢。
- 优先选择不让己方主公处于将军状态的走法。
- 可安全吃主公时直接优先执行。
- 评分包含子力价值、强势对手压制、出局收益、将军状态、可动性、兵卒推进、开局发展和阵型完整。
- 吃子动作会做换子审查；开局阶段会压低炮、马、车脱离本阵去换同价值子且落点易被反吃的动作。
- 主公安全为高优先级：被将军、宫区受压、士相缺位、主公离开原位都会显著扣分。
- 主公安全吃掉本宫入侵子是防守高优先级动作，不按普通“主公高价值棋子换低价值棋子”的换子模型扣分。
- 三方均势会参与评分：当两个对手差距过大时，AI 会降低继续扩大失衡的收益，减少过早把局面推成单挑。

AI 自我迭代能力：

- `src/core/ai-profile.ts` 将搜索宽度、搜索深度、子力价值和评分权重参数化。
- `src/core/ai-scenarios.ts` 保存关键局面，防止修一个问题时退化另一个问题。
- `npm run ai:benchmark` 会运行固定局面和轻量自我对弈，输出评分、失败场景、平均思考时间、早期出局次数和胜者分布。
- `npm run ai:tune -- --iterations 20` 会自动扰动评分参数，跑基准并输出当前搜索到的较优参数。
- `npm run ai:tune -- --iterations 20 --apply` 可将搜索到的较优参数写回 `ai-profile.ts`。应用后必须再运行测试和人工抽查。

AI 禁止：

- 读取 Canvas 坐标。
- 直接修改 `state.pieces`。
- 绕过 `applyMove` 自行处理吃子或胜负。
- 使用 `kingdom` 判断控制权，应使用 `controller`。

AI 允许：

- 复制 `GameState` 做搜索。
- 调用 `getLegalMoves` 枚举动作。
- 调用 `applyMove` 模拟动作。
- 调用 `getCheckedKingdoms`、`getCheckmatedKingdoms` 辅助评分。

## 12. 当前测试覆盖

已有规则测试覆盖：

- 棋盘点线图生成。
- 三国初始棋子。
- 基础走法与跨界走法。
- 炮跨界隔子吃子。
- 回合顺序。
- 非当前国不能行棋。
- 普通吃子。
- 主公被吃出局。
- 出局棋子三种处理模式。
- 将军检测。
- 将军状态下仍显示普通行棋提示。
- 吴在蜀将军魏时仍可行棋。
- `checkmate` 与 `capture` 两种出局条件差异。
- AI 优先吃主公。
- AI 避免让自家主公继续处于将军状态。
- AI 主公会优先安全吃掉进入本宫的敌方炮、车、马等入侵子。

后续增强 AI 时，应继续为动作生成、评估函数、搜索深度和残局局面补测试。
