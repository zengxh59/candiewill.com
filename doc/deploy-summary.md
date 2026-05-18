# candiewill.com 部署发布总结

## 基本信息

| 项目 | 值 |
|------|-----|
| 域名 | candiewill.com |
| 域名注册商 | spaceship.com |
| GitHub 仓库 | https://github.com/zengxh59/candiewill.com |
| 网站地址 | https://candiewill.com |

## 架构

```
candiewill.com (GitHub Pages)                 ← 静态首页 + 所有应用前端
├── index.html                                   首页导航
├── three-player-chinese-chess/dist/             三人象棋（Vite 构建）
├── typing-tutor/dist/                           打字练习（Vite 构建）
└── mc-platformer/                               方块跳跃（纯静态）

candiewill-com.onrender.com (Render)           ← 联机 WebSocket 服务器
└── Node.js (ws)                                 房间管理 + 走棋验证
```

- AI 对弈模式纯前端运行，无需服务器
- 联机模式通过 `VITE_ONLINE_WS_URL` 环境变量连接 Render WebSocket

## 自动部署流程

推送 `main` 分支自动触发：

| 步骤 | 说明 |
|------|------|
| Checkout | 拉取最新代码 |
| Setup Node.js 20 | 安装运行时 |
| Build three-player-chinese-chess | `npm ci && npm run build`，注入 `VITE_ONLINE_WS_URL` |
| Build typing-tutor | `npm ci && npm run build` |
| Upload artifact | 上传整个仓库目录（含 dist 产物） |
| Deploy to GitHub Pages | 部署到 CDN |
| Render 自动重建 | 检测到推送，重新构建联机服务器 |

部署耗时约 40-50 秒。

## 发布操作

```bash
# 1. 确认所有改动已提交（重点：检查 git status 不要遗漏未暂存文件）
git status
git diff --stat

# 2. 提交
git add <具体文件>
git commit -m "描述改动"

# 3. 推送
git push origin main

# 4. 查看部署状态
gh run list --limit 1
```

## 常见问题

### 线上看不到更新

GitHub Pages CDN 缓存 10 分钟（`cache-control: max-age=600`）。强制刷新：
- Mac: `Cmd + Shift + R`
- Windows: `Ctrl + Shift + R`
- 或使用无痕窗口

### 线上内容比预期旧

检查是否有未提交的本地改动：

```bash
git status          # 是否有 modified 文件
git diff --stat     # 改动量和涉及的文件
```

本地有未 commit 的文件不会进入 CI 构建。**每次发布前务必确认 `git status` 和 `git diff --stat` 为空或仅有预期改动。**

### 部署成功但 JS 产物不对

Vite 构建使用内容哈希命名（如 `index-DDvXnTU-.js`），可对比线上和本地 `dist/` 中的文件大小。如果线上明显更小，说明源码未完全提交。

### 工作目录路径问题

Git 操作需要从仓库根目录执行。如果 shell 当前在子目录（如 `three-player-chinese-chess/`），使用 `cd` 回到仓库根目录再执行 `git add`：

```bash
pwd                  # 确认当前目录
cd /path/to/candiewill.com   # 切回仓库根
git add three-player-chinese-chess/src/core/ai.ts  # 用相对于根目录的路径
```

## 各应用构建说明

### 三人象棋

```bash
cd three-player-chinese-chess
npm ci
VITE_ONLINE_WS_URL=wss://candiewill-com.onrender.com/ws npm run build
```

构建执行 `tsc && vite build && npm run build:server`：
- `tsc` — 类型检查
- `vite build` — 前端打包到 `dist/`（含 ai-worker）
- `build:server` — esbuild 打包服务器到 `dist/server/online-server.cjs`

`vite.config.ts` 设置 `base: "./"` 使用相对路径，确保子目录下正常加载。

### 打字练习

```bash
cd typing-tutor
npm ci
npm run build
```

### 本地开发

```bash
cd three-player-chinese-chess
npm run dev           # AI 对弈模式
npm run dev:online    # 联机模式（前端 + 服务器）
```

## Render 联机服务器

| 配置项 | 值 |
|--------|-----|
| 平台 | Render Web Service |
| Root Directory | `three-player-chinese-chess` |
| Build Command | `npm ci && npm run build` |
| Start Command | `node dist/server/online-server.cjs` |
| 套餐 | Free（15 分钟无活动休眠） |
| 域名 | `candiewill-com.onrender.com` |

服务器功能：HTTP 静态文件服务、WebSocket `/ws`、房间管理、走棋验证、断线重连。房间数据存内存，重启后丢失。

## DNS 配置

| 类型 | Host | Value |
|------|------|-------|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `zengxh59.github.io` |

HTTPS 证书由 GitHub Pages 通过 Let's Encrypt 自动签发和续期，覆盖 `candiewill.com` 和 `www.candiewill.com`。
