# 技术架构建议

本文档用于约束后续开发方式：当前先做 PC 端网页版，后续同步支持 Android 和 iOS App。

## 1. 推荐方向

推荐采用“规则核心独立 + 多端渲染适配”的架构。

当前阶段不要把棋盘规则、棋子走法、胜负判断写死在 Canvas 绘制代码里。应把项目拆成：

| 层级 | 责任 | 是否跨端共享 |
| --- | --- | --- |
| 规则核心层 | 棋盘点线图、棋子规则、合法走法、吃子、胜负判断 | 是 |
| 状态层 | 当前棋局、历史记录、悔棋、回放、AI/联机同步数据 | 是 |
| 渲染层 | 棋盘绘制、棋子绘制、动画、高亮、触摸/鼠标交互 | 部分共享 |
| 平台层 | Web、Android、iOS 的入口、存储、分享、账号、支付等 | 否 |

核心原则：

- 规则核心必须是纯 TypeScript，不依赖 DOM、Canvas、React、浏览器 API。
- 棋盘文档 `BOARD_SPEC.md` 是规则核心的数据依据。
- 渲染层只负责“把状态画出来”和“把点击/触摸转成点位”。
- Web 和移动端可以使用不同渲染实现，但共用同一套规则核心。

## 2. 推荐技术栈

### 当前 PC Web

建议逐步迁移到：

- Vite
- TypeScript
- Canvas 或 SVG 渲染
- Vitest 做规则测试

当前 `index.html` 可以先继续作为原型，但后续应拆成模块：

```text
src/
  core/
    board.ts
    graph.ts
    pieces.ts
    moves/
    game-state.ts
  renderer/
    geometry.ts
    canvas-board.ts
    hit-test.ts
  app/
    web-entry.ts
```

### Android / iOS

建议优先路线：

1. 短期：使用 Capacitor 将 Web 游戏打包为 Android/iOS App。
2. 中期：如果需要更强原生体验，再评估 Expo/React Native。

选择原因：

- 当前项目已经是 Web 棋盘原型，Capacitor 可以最大化复用现有 HTML/CSS/Canvas/TypeScript。
- 中国象棋这类棋盘游戏主要交互集中在绘图、点击、拖拽和状态同步，WebView 承载成本较低。
- 只要规则核心是纯 TypeScript，以后切换到 Expo/React Native 也不会推翻核心规则。

## 3. 可选方案对比

| 方案 | 优点 | 风险 | 当前建议 |
| --- | --- | --- | --- |
| Web + Capacitor | 复用现有 Web；最快支持 Android/iOS；规则和渲染都能共享 | 极高性能动画和复杂原生交互不如纯原生 | 推荐第一阶段使用 |
| Expo / React Native | Android、iOS 原生体验更好；也能支持 Web | 需要重写 Canvas/DOM 绘制层；移动端渲染要重新选型 | 中期可评估 |
| Flutter | 跨端一致性强，适合复杂图形 UI | 当前 JS/TS 资产需要重写为 Dart | 不建议当前阶段采用 |

## 4. 核心模块设计

### `core/board.ts`

负责定义棋盘点、国度、界河和特殊区域。

建议数据：

```ts
export type Kingdom = "wei" | "wu" | "shu";
export type EdgeType = "normal" | "palace" | "inter_kingdom";
export type PointId = `${string}${number}`;

export interface BoardPoint {
  id: PointId;
  row: string;
  col: number;
  kingdom: Kingdom;
  isPalace: boolean;
  marker?: "soldier" | "cannon";
}

export interface BoardEdge {
  from: PointId;
  to: PointId;
  type: EdgeType;
}
```

### `core/graph.ts`

负责把 `BOARD_SPEC.md` 中的点线规则转成无向图。

应提供：

```ts
getPoint(id: PointId): BoardPoint;
getNeighbors(id: PointId): PointId[];
hasEdge(from: PointId, to: PointId): boolean;
getEdgeType(from: PointId, to: PointId): EdgeType | null;
```

### `core/moves/`

每类棋子一个独立文件，例如：

```text
moves/
  general.ts
  advisor.ts
  elephant.ts
  horse.ts
  chariot.ts
  cannon.ts
  soldier.ts
```

所有走法函数只接收棋局状态和点位，不读取屏幕坐标。

```ts
getLegalMoves(state: GameState, pieceId: string): PointId[];
```

### `renderer/geometry.ts`

负责将逻辑点位映射到屏幕坐标。

Web、Android、iOS 都可以共享“棋盘几何算法”，但不共享具体绘制 API。

```ts
getBoardPointPosition(pointId: PointId, viewport: Viewport): { x: number; y: number };
hitTestBoardPoint(x: number, y: number): PointId | null;
```

## 5. 渲染策略

当前棋盘是线框和文字，后续还会加入棋子、选中、高亮、动画。

建议渲染流程：

1. 绘制棋盘静态层。
2. 绘制界河和国度文字。
3. 绘制可交互状态层：选中点、可走点、将军提示。
4. 绘制棋子层。
5. 绘制拖拽中的棋子。

性能建议：

- 棋盘静态层可以缓存为离屏 Canvas。
- 棋子和交互层单独重绘。
- 移动端触摸命中不要依赖文字或线段，应基于连接点坐标半径判断。

## 6. 移动端适配原则

移动端需要优先考虑：

- 横屏模式为主。
- 允许双指缩放和平移棋盘。
- 点击连接点选择棋子，再点击目标点移动。
- 拖拽移动可以作为增强交互，不作为唯一操作方式。
- 棋盘坐标、界河、国度文字应根据屏幕尺寸动态缩放。

推荐布局：

```text
顶部：当前回合、计时、菜单
中间：可缩放棋盘
底部：悔棋、认输、提示、历史
```

## 7. 测试策略

规则核心必须优先写自动化测试。

最低测试范围：

- 棋盘应生成 135 个连接点。
- 普通连接线数量正确。
- 九宫斜线正确。
- 跨国连接线正确。
- 每个国度点位归属正确。
- 界河边界点正确。
- 每类棋子的基础合法走法正确。

渲染测试可以晚一点做，但规则测试要先做。

## 8. 迁移路线

第一阶段：原型整理

- 保留当前 `index.html`。
- 把棋盘几何和绘制逻辑拆出。
- 新增 `BOARD_SPEC.md` 和规则核心数据。

第二阶段：Web 工程化

- 引入 Vite + TypeScript。
- 建立 `src/core`、`src/renderer`、`src/app`。
- 用测试锁定棋盘图结构。

第三阶段：移动端壳

- 使用 Capacitor 接入 Android/iOS。
- 适配横屏、触摸、缩放、安全区域。
- 保持 Web 与 App 共用同一套构建产物。

第四阶段：如有必要再原生化

- 如果后续需要更强原生体验，再评估 Expo/React Native。
- 保留 `core`，只替换 `renderer` 和 `platform`。

## 9. 当前项目约束

后续开发请遵守：

- 不在绘图代码里直接写棋子移动规则。
- 不在棋子规则里读取 Canvas 坐标。
- 所有点位必须来自 `BOARD_SPEC.md`。
- 所有移动判断都基于连接图。
- 所有平台共享同一套棋局状态和规则核心。
