# candiewill.com 部署发布手册

## 基本信息

| 项目 | 值 |
|------|-----|
| 域名 | candiewill.com |
| 域名注册商 | spaceship.com |
| GitHub 仓库 | https://github.com/zengxh59/candiewill.com |
| GitHub 用户 | zengxh59 |
| 网站地址 | https://candiewill.com |
| 部署方式 | GitHub Pages + GitHub Actions |

## 项目结构

```
candiewill.com/
├── index.html                  # 首页（导航入口）
├── CNAME                       # GitHub Pages 自定义域名
├── mc-platformer/              # 方块跳跃游戏
├── typing-tutor/               # 打字练习应用（需构建）
│   ├── src/                    # 源码
│   ├── dist/                   # 构建产物（gitignore）
│   └── package.json
├── .github/workflows/static.yml # 部署工作流
└── .gitignore
```

## DNS 配置

在 spaceship.com 域名管理面板设置以下 DNS 记录：

| 类型 | Host | Value | TTL |
|------|------|-------|-----|
| A | `@` | `185.199.108.153` | 3600 |
| A | `@` | `185.199.109.153` | 3600 |
| A | `@` | `185.199.110.153` | 3600 |
| A | `@` | `185.199.111.153` | 3600 |
| CNAME | `www` | `zengxh59.github.io` | 3600 |

Nameservers（无需修改，默认）：
- launch1.spaceship.net
- launch2.spaceship.net

## 部署流程

### 自动部署

推送代码到 `main` 分支即自动触发部署：

```bash
git add .
git commit -m "描述改动内容"
git push
```

GitHub Actions 工作流（`.github/workflows/static.yml`）会自动执行：
1. 检出代码
2. 安装 Node.js 20
3. 构建 typing-tutor（`npm ci && npm run build`）
4. 部署到 GitHub Pages

可在 https://github.com/zengxh59/candiewill.com/actions 查看部署状态。

### 新增子应用

以添加一个名为 `new-app` 的应用为例：

1. 在项目根目录创建 `new-app/` 目录，开发应用
2. 在 `index.html` 的 `<nav>` 中添加入口链接：
   ```html
   <a href="new-app/" class="app">
       <div class="icon">图标</div>
       <span class="label">应用名</span>
       <span class="desc">应用描述</span>
   </a>
   ```
3. 如果需要构建步骤，在 `static.yml` 的 steps 中添加构建命令
4. 提交并推送

## HTTPS 证书

- 由 GitHub Pages 自动通过 Let's Encrypt 签发
- 证书有效期 90 天，自动续期
- 证书覆盖域名：`candiewill.com` 和 `www.candiewill.com`
- 已启用 Enforce HTTPS（强制 HTTPS）

### 证书问题排查

如果 HTTPS 证书异常（Enforce HTTPS 变灰）：
1. 检查 DNS 记录是否正确指向 GitHub Pages IP
2. 尝试在 GitHub 仓库 Settings > Pages 中移除并重新添加自定义域名
3. 等待 15-30 分钟让证书重新签发
4. 也可通过 API 触发：
   ```bash
   # 移除域名
   curl -X PUT -H "Authorization: token <TOKEN>" \
     -H "Content-Type: application/json" \
     https://api.github.com/repos/zengxh59/candiewill.com/pages \
     -d '{"cname":null}'
   # 重新添加
   curl -X PUT -H "Authorization: token <TOKEN>" \
     -H "Content-Type: application/json" \
     https://api.github.com/repos/zengxh59/candiewill.com/pages \
     -d '{"cname":"candiewill.com"}'
   ```

## 注意事项

- `typing-tutor/dist/` 目录在 `.gitignore` 中，不会提交到仓库，由 CI 构建
- 本地使用 VPN/代理时，`dig` 可能返回 `198.18.x.x` 的虚拟 IP，这是代理软件的 DNS 劫持，不影响外部访问
- GitHub Pages 的 GitHub Actions 工作流需要有 `pages: write` 和 `id-token: write` 权限
