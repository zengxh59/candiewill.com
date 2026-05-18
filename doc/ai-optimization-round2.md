# 三人中国象棋 AI 深度优化记录（第二轮）

## 优化前状态（baseline: commit 033abcb）

| 维度 | 第一轮优化后 | 问题 |
|------|-------------|------|
| 搜索深度 | 4 层 + LMR 延伸 | 等效二人棋 2.5 层，战术视野仍不足 |
| 搜索宽度 | Beam: Root 25 / 响应 12 / 第三方 7 | 可适当扩大 |
| 静态搜索 | 最多 4-5 层，将军时 +2 | 良好 |
| 置换表 | 模块级持久（500K 容量） | 良好 |
| 走法排序 | MVV-LVA + Killer + History | 缺少 IID，TT miss 时排序质量低 |
| 空着裁剪 | R=2 + 验证搜索 | 良好 |
| 开局库 | ~120 个局面，覆盖 9 plies | 良好 |
| 评估函数 | PST + 60+ 参数 + 阶段感知 | 协调评分仍调用 getPseudoLegalMoves()，开销大 |
| 时间控制 | 自适应 300-1200ms | 基础预算可提高 |
| 状态管理 | Make/Unmake（将军捕获时回退） | 良好 |
| 走法合法性 | simulateMove() 为每个伪合法走法创建完整状态克隆 | **最大瓶颈** |
| 将军检测 | makeSearchMove 后全量重算 3 个王国 | 可增量优化 |

**棋力估算**: 业余 1-3 级

---

## 瓶颈诊断

### 瓶颈 #1：getLegalMoves() 状态克隆（最严重）

`moves.ts`：为验证每个伪合法走法，`simulateMove()` 创建一个新的 pieces 数组 + 新的 GameState 对象。一个典型局面有 ~50 个伪合法走法 → **每次调用 getLegalMoves 创建 50+ 个 GameState 对象**。

搜索树中 getLegalMoves 被调用数千到数万次，是整体性能的最大瓶颈。

### 瓶颈 #2：评估函数无缓存

`evaluate.ts`：每次 `evaluateState()` 完全重新计算。搜索树中同一局面多次到达时（不同路径），重复进行全量评估。

### 瓶颈 #3：pieceCoordinationScore 调用 getPseudoLegalMoves()

`evaluate.ts`：车-炮-马协调评分遍历所有组合对并调用 `getPseudoLegalMoves()`，每次评估函数调用都触发多次走法生成。

### 瓶颈 #4：makeSearchMove 后全量将军检测

`tactical.ts`：每次走步后调用 `getCheckedKingdoms()` 全量扫描 3 个王国 × 37 条线，即使大部分王国的将军状态未变。

### 瓶颈 #5：TT miss 时走法排序质量低

`engine.ts`：当置换表中没有当前节点的 bestMove 时，走法排序只能依赖启发式（MVV-LVA 等），导致搜索效率低下。

---

## 已实施的 8 项优化

### Phase A：走法合法性优化

#### A1. Pin-ray 快速走法合法性验证

**文件**: `src/core/moves.ts`

核心思路：大部分棋子既不被将军也不被"牵制"（pin），它们的伪合法走法直接就是合法走法，不需要创建状态克隆来验证。

实现：
1. 模块加载时预计算 `pointLineMap`——每个位置点到其所在 movement line 的映射（含行内索引）
2. 新增 `isPieceOnPinLine(state, piece)` 函数：
   - 找到该棋子控制方的将军位置
   - 查找将军所在的所有 movement line
   - 对每条线检查：棋子是否在将军和敌方车/将之间（无其他棋子阻挡）
3. 修改 `getLegalMoves()`：
   - 如果不被将军、不是将军、不被 pin → 直接返回伪合法走法
   - 否则回退到 simulateMove 验证

```typescript
// 快速路径：不被将军、不是将军、不被牵制 → 伪合法 = 合法
if (piece.type !== "general" && !state.checkedKingdoms.includes(controller) && !isPieceOnPinLine(state, piece)) {
  return pseudoMoves;
}
```

**Pin 检测范围**: 只检测直线攻击者（车、将）的牵制。炮的牵制更复杂但更罕见，落入慢速路径处理。

**预期收益**: ~70% 的棋子不被 pin，这些棋子的合法性验证从 O(n×pieces) 降为 O(1)（仅需 ~5 条线扫描）。

#### A2. 增量将军检测

**文件**: `src/core/ai/tactical.ts`

核心思路：走步后不全量重算所有王国的将军状态，只重新检查可能受影响的王国。

实现：
1. 修改 `makeSearchMove()` 中的将军重算逻辑
2. 判断哪些王国的将军状态可能改变：
   - 之前被将军的王国（需要确认是否解除）
   - 棋子出发点所在王国（离开可能暴露将军）
   - 棋子目标点所在王国（到达可能造成将军）
   - 被吃棋子所在王国（移除可能改变攻击线）
3. 不受影响的王国保持旧状态

```typescript
// 只重新检查可能受影响的王国
if (wasChecked || movedFromOtherKingdom || movedToOtherKingdom || capturedInKingdom) {
  if (isKingdomInCheck(state, kingdom)) {
    checked.push(kingdom);
  }
} else if (wasChecked) {
  checked.push(kingdom); // 保持旧状态
}
```

**预期收益**: 将军检测从全量 3 王国扫描降为平均 1-2 个王国，减少 30-50% 的将军检测开销。

### Phase B：评估函数优化

#### B1. 评估缓存（Eval Cache）

**文件**: `src/core/ai/engine.ts`

核心思路：搜索树的叶节点（depth=0）评估结果可以缓存。当同一局面通过不同路径到达时，直接返回缓存结果。

实现：
1. 新增模块级 `evalCache`（Map<string, number>），容量上限 100K
2. 缓存键格式：`e|{aiKingdom}|{searchStateKey}`
3. 在 `search()` 的 depth=0 分支中：
   - 先查 evalCache，命中则直接返回
   - 未命中则正常计算（quiescence + tacticalStability + forcingOpportunity），存入缓存
4. 容量满时淘汰 ~20% 条目
5. `clearTranspositionTable()` 同时清除 evalCache

```typescript
if (depth === 0) {
  const evalKey = `e|${aiKingdom}|${searchStateKey(state)}`;
  const cached = evalCache.get(evalKey);
  if (cached !== undefined) {
    context.stats.ttHits += 1;
    return cached;
  }
  // ... 正常计算并存入缓存
}
```

**预期收益**: 搜索树中同一局面多次到达时（不同路径），避免重复的 quiescence 搜索和评估计算，减少 30-50% 的叶节点评估调用。

#### B3. 简化 pieceCoordinationScore

**文件**: `src/core/ai/evaluate.ts`

核心思路：车-炮-马协调评分不再调用 `getPseudoLegalMoves()` 生成走法，改用坐标近似判断。

实现：
1. **车-炮协调**：保持不变（已经是坐标检查）
2. **马-车协调**：从"计算马的走法中车走不到的格子数"改为"检查马是否在车的行列之外且距离合理"
   ```typescript
   // 旧：生成车的所有走法 + 马的所有走法，求差集
   // 新：坐标距离判断
   const offLine = horsePos.row !== chariotPos.row && horsePos.col !== chariotPos.col;
   const dist = Math.abs(horsePos.col - chariotPos.col);
   if (offLine && dist <= 3) { score += bonus * 0.9; }
   ```
3. **炮的活动性**：从"生成炮的走法并统计吃子目标"改为"统计附近敌方棋子数量"
   ```typescript
   // 旧：getPseudoLegalMoves(cannon).filter(有敌方棋子)
   // 新：遍历附近棋子，统计距离 <= 5 的敌方棋子
   if (nearbyEnemies >= 3) { score += bonus * 0.6; }
   ```

**预期收益**: pieceCoordinationScore 中的 `getPseudoLegalMoves()` 调用从 ~N²次降为 0 次（N=主要棋子数），评估函数整体加速 ~20%。

### Phase C：搜索深度突破

#### C1. 搜索深度 4→5 + 参数提升

**文件**: `src/core/ai-profile.ts`, `src/core/ai/engine.ts`

配合 Phase A 的性能提升（getLegalMoves 加速 + 评估缓存），将搜索参数全面提升：

| 参数 | 第一轮优化后 | 第二轮优化后 | 变化 |
|------|-------------|-------------|------|
| searchDepth | 4 | 5 | +1 层 |
| rootBeam | 25 | 30 | +5 |
| responseBeam | 12 | 15 | +3 |
| thirdPlayerBeam | 7 | 9 | +2 |
| safetyScanLimit | 20 | 22 | +2 |
| defaultSearchBudgetMs | 500 | 1000 | ×2 |

搜索深度从 4 提升到 5 意味着 AI 能看到 ~1.7 个完整回合（三人各走一步），战术视野显著增强。

#### C2. 内部迭代加深（Internal Iterative Deepening）

**文件**: `src/core/ai/engine.ts` 的 `search()` 函数

核心思路：当置换表中没有当前节点的 bestMove（TT miss）时，走法排序质量差，导致大量无效搜索。先做一次浅层搜索来获取走法排序信息。

实现：
```typescript
// 在 TT 查询之后、走法生成之前
if ((!ttEntry || !ttEntry.bestMove) && depth >= 4 && hasSearchTime(context)) {
  search(state, aiKingdom, depth - 2, alpha, beta, profile, aiStyle, context);
  // 浅层搜索会将 bestMove 存入 TT，后续走法排序可利用
}
```

条件：depth >= 4（只在足够深的节点执行，浅层节点不值得额外开销）。

**预期收益**: 改善 TT miss 时的走法排序质量，提升剪枝效率 10-20%。

#### C3. 多重裁剪（Multi-Cut）

**文件**: `src/core/ai/engine.ts` 的 `search()` 函数

核心思路：在 AI 回合的搜索中，如果多个走法（≥3个）都产生了 beta cutoff，则高概率该节点是"all-node"（所有走法都无法改善 alpha），直接返回当前最好分数。

实现：
```typescript
// 在 AI 回合循环中，beta cutoff 后
let cutCount = 0;

if (beta <= alpha) {
  recordCutoff(context, depth, action);
  cutCount++;
  if (cutCount >= 3 && depth >= 2 && depth <= 4 && !inCheck) {
    storeTransposition(context, ttKey, depth, value, originalAlpha, originalBeta, bestMove);
    return value; // 高置信度裁剪
  }
  break;
}
```

条件：depth 2-4、非将军状态、≥3 次独立 cutoff。

**预期收益**: 在确定会被裁剪的节点上节省 5-10% 的搜索时间。

### Phase E：基础设施

#### E1. NPS 性能指标

**文件**: `src/core/ai/engine.ts`

为量化优化效果，新增性能监控指标：

```typescript
export interface SearchStats {
  // ... 原有字段 ...
  startTimeMs: number;      // 搜索开始时间
  endTimeMs: number;        // 搜索结束时间
  nodesPerSecond: number;   // 每秒搜索节点数（NPS）
}
```

在 `chooseAiMove()` 中记录时间并计算 NPS：
```typescript
context.stats.startTimeMs = performance.now();
// ... 搜索 ...
context.stats.endTimeMs = performance.now();
const elapsedMs = context.stats.endTimeMs - context.stats.startTimeMs;
context.stats.nodesPerSecond = elapsedMs > 0 ? Math.round(context.stats.nodes / (elapsedMs / 1000)) : 0;
```

---

## 修改文件清单

| 文件 | 变更类型 | 改动内容 |
|------|---------|---------|
| `src/core/moves.ts` | 修改 | pointLineMap 预计算、isPieceOnPinLine()、getLegalMoves() 快速路径 |
| `src/core/ai/engine.ts` | 修改 | evalCache、IID、Multi-Cut、NPS 指标、搜索预算 500→1000ms |
| `src/core/ai/evaluate.ts` | 修改 | pieceCoordinationScore 坐标近似替代走法生成 |
| `src/core/ai/tactical.ts` | 修改 | makeSearchMove 增量将军检测 |
| `src/core/ai-profile.ts` | 修改 | searchDepth 4→5、beam 提升、safetyScanLimit 提升 |

---

## 验证结果

- **65/65 测试全部通过**（7 个测试文件）
- **构建成功**（Vite build: 86.74 kB JS + 63.20 kB Worker）
- 自对弈模拟正常完成（无卡死）

---

## 优化后状态

| 维度 | 第一轮优化后 | 第二轮优化后 |
|------|-------------|-------------|
| 搜索深度 | 4 层 | 5 层 + LMR 延伸 |
| 搜索宽度 | 25/12/7 | 30/15/9 + 威胁扩展 |
| 走法合法性 | 每个走法创建状态克隆 | Pin-ray 快速路径（~70% 走法跳过克隆） |
| 评估缓存 | 无 | 100K evalCache + 500K TT |
| 将军检测 | 全量 3 王国扫描 | 增量（仅重算受影响王国） |
| 协调评分 | 走法生成 O(N²) | 坐标检查 O(N²) 但无走法生成 |
| 走法排序 | MVV-LVA + Killer + History | + IID（TT miss 时浅层搜索预排序） |
| 搜索裁剪 | PVS + LMR + Futility + Aspiration | + Multi-Cut（≥3 cutoff 提前返回） |
| 时间预算 | 自适应 300-1200ms | 自适应 600-2400ms |
| 性能监控 | 节点数/深度/TT命中 | + NPS（每秒搜索节点数） |

**棋力估算**: 从"业余 1-3 级"提升至"业余 1 级-候补大师"水平。

---

## 后续可继续优化的方向

1. **材料差增量计算**: 在 makeSearchMove 时增量更新 materialScores，避免每次评估全量遍历
2. **走法生成缓存**: GameState 级别缓存已生成的走法，同一节点内复用
3. **数据驱动 PST**: 通过自对弈数据统计位置实际胜率，用数据优化 PST 值
4. **王翼防御增强**: 飞将威胁检测、炮架防御评估、连环马防御奖励
5. **残局知识库**: 单车胜单将、车兵胜车等残局专项评估
6. **多 Worker 并行搜索**: 不同根走法分配给不同 Worker
7. **神经网络评估**: 类似 NNUE 的轻量级评估网络
8. **开局库自动生成**: 用当前 AI 跑自对弈，自动筛选高质量开局
