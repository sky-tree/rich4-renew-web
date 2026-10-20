# 06 · 开发环境、构建、测试、VPS 部署与回滚

> **注意**：本篇中的 Web 专用命令、目录与流水线是实施方案；若标为“目标”，不代表脚本和 Nginx 路由已存在。本次建档仅提交规划文档，不安装依赖、不部署素材、不改 Nginx。

## 1. Git 管理策略

| Remote | 地址 | 用途 |
| --- | --- | --- |
| `origin` | `git@github.com:sky-tree/rich4-renew-web.git` | 自己的 GitHub Fork，开发结果向这里推送 |
| `upstream` | `https://github.com/iam567/rich4-renew-app.git` | 原作者同步，只读 |

建议使用 `main` 存放可合并、已通过测试的代码；用 `feat/web-build`、`feat/asset-packs`、`experiment/pixi` 等短分支做 PR，避免将未经验证的 PixiJS 重构直接推上主分支。部署测试版时使用 Git commit SHA/Release Tag 固定版本，不追踪随时变化的 HEAD。

```bash
# VPS 现有开发目录：/srv/devspace/repos/rich4-web
cd /srv/devspace/repos/rich4-web
git status --short --branch
git fetch origin
git fetch upstream
git log --oneline --decorate --max-count=5

# 后续创建功能分支的示例（不作为本次已执行命令）
git switch main
git pull --ff-only origin main
git switch -c feat/web-build
```

**上游更新规程**：先在临时分支或 worktree 拉取并审阅 `git log`/diff，执行原版规则测试及 Web 回归后再合并；把规则变化与渲染/素材接口变化分开处理。禁止自动覆盖本地改动或强推 `main`。

## 2. 基线开发命令（现有项目）

在有 Node/npm（按仓库 lockfile 可安装）的机器上：

```bash
cd game
npm ci
npm test
npx tsc --noEmit

# 不带素材，只验证前端代码能否构建：不是完整可玩的站点
RICH4_NO_ASSETS=1 npm run build
```

现有 `npm run dev` 只绑定 `127.0.0.1`，适合本机验证；要从其他测试设备访问时，应显式设置 `--host`，并将 Vite 开发端口仅开放给受控网络，不把开发服务器直接暴露公网。

运行有合法素材的完整网页测试时，需先将相应素材准备到 `game/public/assets/`。此目录被 Git 忽略；如果沿用 `npm run assets`，它依赖本地额外目录结构；也可按照上游 README 的说明使用经授权的素材目录。**没有素材时不应声称页面已可玩。**

### 目标 Web 构建命令（M1/M2 完成后）

```bash
cd game
npm ci
npm test
npx tsc --noEmit

# 现有 Vite 用法可在命令行覆盖 base；M1 完成后固化为独立 Web 脚本
RICH4_NO_ASSETS=1 npx vite build --base=/rich4/

# 当前构建工具依赖完整素材与 cwebp；M2 完成后改用 Web 分包流水线
RICH4_WEBP=1 node scripts/bundle-assets.mjs
```

**注意**：这套命令只是现有构建的操作基础：`bundle-assets.mjs` 仍处理整个素材合集，尚不满足 Web 专用分包目标。最终计划提供 `npm run build:web` 和 `npm run audit:assets`，在脚本真正加入仓库后才更新文档为可执行命令。

## 3. 建议的环境划分

| 环境 | 部署目的 | 访问与版本控制 |
| --- | --- | --- |
| Local | 开发机热更新、单地图调试 | Vite + 本地合法素材；不影响 VPS |
| VPS DevSpace | 源码仓、静态构建/代码检查 | `/srv/devspace/repos/rich4-web`，非线上发布目录 |
| Staging | 移动设备、网络、回归验证 | 独立 URL/子路径、固定 commit，严格控制素材权限 |
| Production | 对公众提供正式 Web 访问 | **先满足代码/素材授权、性能、联机安全与发布验收** |

考虑已有 `apps.gopeaks.club` Nginx 站点，目标生产路径可以是 `https://apps.gopeaks.club/rich4/`；测试路径可以使用独立受控子域或 `/rich4-staging/`。后者必须配对应的 Vite `base` 与资源前缀，不可直接复制 `/rich4/` 构建结果后假设子路径可用。

## 4. VPS 环境与容量

2026-10-20 曾读取到：4 vCPU、约 7.8 GiB RAM、40 GB 系统盘（约 32 GB 可用），Nginx 80/443 在监听，Swap 未配置。以上是**瞬时环境快照**，不能替代带宽/出口流量、IOPS 和并发下载压测。

策略：

1. VPS 首期只提供静态网站，单机规则全部在浏览器执行，不启动 Java/Node 游戏后端。
2. 高清资源尽可能在开发工作站构建，产物按版本上传；VPS 上不做大量 `cwebp` 批量转码，避免与现有服务争内存/CPU。
3. 传输压力 = 新玩家/地图更新时的文件下载量；同时在线人数不是服务器计算复杂度的决定因素。
4. 首期单机及小范围测试无需升级 VPS；当公网带宽、月流量额度或全球访问延迟成为瓶颈时，考虑独立 CDN/对象存储而不是先加 CPU。
5. 对外开放多人时另外监控 PeerServer/coturn 的连接、丢包、出站带宽及滥用情况。

## 5. 静态文件布局与 Nginx 样例

**计划路径（不是现有目录）**：

```text
/srv/www/apps/
  rich4/                     # 指向某个已验证 release 的符号链接
  rich4-releases/
    <commit-sha-A>/           # index.html, assets/, JS, CSS
    <commit-sha-B>/
```

以下配置需放入现有 `apps.gopeaks.club` 的 HTTPS `server` 内，修改前检查配置冲突：

```nginx
location = /rich4 {
    return 301 /rich4/;
}

location ^~ /rich4/ {
    root /srv/www/apps;
    index index.html;
    try_files $uri $uri/ =404;
}
```

这要求 `/srv/www/apps/rich4/` 是构建根目录，且 Vite 以 `/rich4/` 为 base。不需要为游戏加入通用 SPA deep-link 回退：当前游戏没有必须由 HTML 兜底的 URL Router，资源 404 应保持真实 404，便于定位缺失文件。

**额外配置实施事项**：

- HTML 不永久缓存；带内容哈希的 JS/CSS 可设置 `public, max-age=31536000, immutable`。
- 地图 JSON/纹理清单与图片要有成套 buildId/hash 或带版本 URL，再设置长缓存；不变名的资源切勿盲设一年缓存。
- `.wasm` 仅在未来采用 WASM 时需要额外 MIME；当前 JS/Canvas Web 项目不依赖 WASM。
- WebP、PNG、JSON、M4A MIME 与 `Content-Encoding` 正确，静态资源可使用 Brotli/gzip（图片多已压缩，重点压缩文本）。
- 同一目录下的多个项目互不覆盖；修改前 `nginx -t`，检查 `curl -I` 和真实浏览器网络请求。
- 不让私有密钥、构建缓存、Git 配置、素材原始压缩包直接位于 Web root。
- 若未来加入 PWA，Service Worker scope 应是 `/rich4/`，避免影响 `apps.gopeaks.club` 下其他项目。

## 6. 发布、回滚与数据安全

**原子化发布步骤（计划）**：

1. CI 或工作站用固定 commit 构建；测试和资源引用校验通过；生成 buildId、SHA256 清单。
2. 经授权的完整 Web 产物上传到一个**新版本目录**，校验 hash；不在当前线上目录就地覆盖一半文件。
3. 在受控环境启动浏览器冒烟，验证 HTML、静态素材、地图及存档（受控测试账号/浏览器）。
4. 在同一文件系统内原子地切换指向新版本的符号链接；尽可能保留旧版本直到旧页面缓存生命周期结束。
5. 观测 404、JS 错误、地图首帧、加载时延。失败则切回旧版本，重新测试。

**风险提示**：仅切换 `rich4` 符号链接并不能自动解决客户端已缓存旧 JS 与新资源混搭。JS/CSS 与资源文件应使用 hash/version 不变路径，并在部署时保留历史资源可访问期，必要时按版本独立目录提供。存档 schema 更新必须考虑回滚后旧版本是否能读取新存档。

## 7. CI/CD 建议（未实现）

- Pull Request：`npm ci` → `npm test` → `tsc --noEmit` → **无素材代码构建** → 静态检查 →（具合法测试素材时）资源清单校验、浏览器冒烟。
- Main：重复全部 PR 检查，并记录版本与资源大小报告；打包产物为受控 Artifact。
- Release/Tag：带许可审核记录，指定 staging/prod；生产发布需要人工批准与回滚信息。
- 缺素材时标记 `asset-integration: blocked/not-run`，不能让“代码构建成功”冒充“游戏全流程验证通过”。
- 不把 TURN 动态认证服务的签名密钥、素材私有下载令牌、SSH 私钥提交 GitHub 或写入前端 JS。

## 8. 发布前运维清单

- [ ] 确认素材已获分发许可，或生产不包含受限素材。
- [ ] 选择固定 commit，记录 buildId、回滚版本和更新说明。
- [ ] 测试 `npm test`、TypeScript、合法素材完整 build、E2E、资源引用校验。
- [ ] 执行 Nginx `nginx -t`（实际配置修改时），检查现有其他 App 未受影响。
- [ ] 测试首页、选图、图片/音频、存档、手机浏览器；联机另测信令/TURN。
- [ ] 检查响应头与资源缓存，核验无未受保护密钥及大体积敏感文件。
- [ ] 监控 VPS 出口带宽、HTTP 404/5xx、存储余量和下载流量配额。
- [ ] 确认一键/手动回滚步骤已演练，并已完成故障联系人/处理指引。
