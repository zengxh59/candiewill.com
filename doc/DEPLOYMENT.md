# 部署方案

## 架构概览

```
candiewill.com (GitHub Pages)                ← 静态首页 + 所有应用前端
├── index.html                                  首页导航
├── three-player-chinese-chess/dist/            三人象棋前端
├── typing-tutor/dist/                          打字练习前端
└── mc-platformer/                              方块跳跃

candiewill-com.onrender.com (Render)          ← 联机 WebSocket 服务器
└── Node.js (ws)                                房间管理 + 走棋验证
```

前端通过环境变量 `VITE_ONLINE_WS_URL` 连接 Render 的 WebSocket 服务。AI 对弈模式无需服务器，纯前端运行。

## 静态前端 — GitHub Pages

### 部署方式

通过 GitHub Actions 自动部署，配置文件：`.github/workflows/static.yml`

- **触发条件**：推送到 `main` 分支
- **构建流程**：
  1. 检出代码
  2. 安装 Node.js 20
  3. 构建 three-player-chinese-chess（注入 `VITE_ONLINE_WS_URL` 环境变量）
  4. 构建 typing-tutor
  5. 上传到 GitHub Pages

### 构建命令

| 应用 | 目录 | 构建命令 |
|------|------|----------|
| 三人象棋 | `three-player-chinese-chess/` | `npm ci && npm run build` |
| 打字练习 | `typing-tutor/` | `npm ci && npm run build` |

### 注意事项

- three-player-chinese-chess 的 `vite.config.ts` 设置了 `base: "./"`，使构建产物使用相对路径，确保在子目录下正常加载
- GitHub Actions 中通过 `env` 注入 `VITE_ONLINE_WS_URL: wss://candiewill-com.onrender.com/ws`，让前端知道联机服务器地址

## 联机服务器 — Render

### 服务配置

| 配置项 | 值 |
|--------|-----|
| 平台 | Render Web Service |
| 运行时 | Node.js |
| Root Directory | `three-player-chinese-chess` |
| Build Command | `npm ci && npm run build` |
| Start Command | `node dist/server/online-server.cjs` |
| 套餐 | Free |
| 域名 | `candiewill-com.onrender.com` |

### 构建流程

`npm run build` 实际执行：

```
tsc && vite build && npm run build:server
```

1. `tsc` — 前端类型检查
2. `vite build` — 构建前端静态资源到 `dist/`
3. `npm run build:server` — 类型检查服务器代码 + esbuild 打包服务器到 `dist/server/online-server.cjs`

### 服务器功能

- HTTP 静态文件服务（`dist/` 目录）
- WebSocket 端点（`/ws` 路径）
- 房间管理（创建/加入/离开/投降）
- 走棋验证（权威式，服务器校验每一步）
- 断线重连（2 分钟窗口）
- 环境变量 `PORT` 由 Render 自动设置

### 注意事项

- `esbuild` 需要作为显式 devDependency 声明（不能仅依赖 Vite 的间接依赖）
- 免费套餐在 15 分钟无活动后休眠，首次唤醒约 30 秒
- 房间数据存储在内存中，服务器重启后丢失

## 本地开发

```bash
cd three-player-chinese-chess

# AI 对弈模式（纯前端）
npm run dev

# 联机模式（前端 + 服务器同时启动）
npm run dev:online
```

联机模式下 WebSocket 连接走本地回退逻辑：`ws://127.0.0.1:4173/ws`

## 发布流程

```bash
# 1. 提交改动
git add <files>
git commit -m "描述"

# 2. 推送到 main 分支
git push origin main
```

推送后自动触发：
- GitHub Actions → 构建并部署静态前端到 GitHub Pages
- Render → 检测到推送，重新构建并部署联机服务器
