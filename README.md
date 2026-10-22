# 大富翁4 高清重制版 · 纯 Web 专项版（Rich4 Renew Web）

本项目为 [`iam567/rich4-renew-app`](https://github.com/iam567/rich4-renew-app) 的**纯 Web 专项 Fork（私人使用，不公开商业分发）**。
目标是保留原版反汇编还原的 TypeScript 确定性规则引擎、4x 高清重绘画面、「大富豪模式」（五城十二人全国战）与「歌舞伎町」独立玩法，彻底移除移动端/桌面原生打包依赖（Capacitor / Electron），演进为通过浏览器即可直接畅玩的纯 HTML5 Web 游戏。

完整游戏素材（原版提取、高清重绘、地图、地表切片、音效）**不提交进 Git**，通过本地或私人服务器独立挂载。

## 目录结构

- [`game/src/core`](game/src/core)：纯规则引擎（回合状态机、地产、银行、股票、卡片、道具、事件、小游戏、大富豪模式）
- [`game/src/ui`](game/src/ui)：浏览器视图、Canvas 2D 棋盘渲染、Web Audio 音频、IndexedDB 存档与导入导出、PeerJS/WebRTC 锁步联机
- [`game/src/assets`](game/src/assets)：Web 资源分包清单、并发重试加载器、CDN 地址解析、按需地图离线包与作用域受限的 App Shell PWA
- [`game/src/renderer`](game/src/renderer)：等角投影纯函数、`BoardRenderer` 抽象接口、Canvas 2D 与实验性 WebGL 着色器渲染后端
- [`game/scripts`](game/scripts)：素材真实内容 SHA-256 审计（`audit-assets.mjs`）、Web 分包构建（`bundle-assets.mjs`）、发布校验（`verify-web.mjs`）与不可变版本原子发布/回滚（`release-web.mjs`）
- [`deploy/nginx-rich4.conf`](deploy/nginx-rich4.conf)：独立 Nginx `/rich4/` 子路径静态部署与缓存策略配置
- [`deploy/web-gateway-rich4.conf`](deploy/web-gateway-rich4.conf)：DevSpace Web Gateway `/rich4/` 静态路由、分级缓存与 Basic Auth 访问控制配置
- [`deploy/rich4-ctl.sh`](deploy/rich4-ctl.sh)：VPS 版本化发布、秒级回滚、素材拉取校验与访问控制管理脚本
- [`docs/rules`](docs/rules)：原版反汇编还原的 22 份详尽游戏规则规范
- [`docs/plan`](docs/plan/README.md)：Rich4 Renew Web 开发计划、架构设计、里程碑与验收状态台账

## 常用开发与验证命令（`game/` 目录下执行）

```bash
cd game

# 1. 安装依赖
npm ci

# 2. 挂载游戏素材（从上游 Releases 下载 rich4-assets.tar 并校验解压至 game/public/）
gh release download assets -R iam567/rich4-renew-app -p 'rich4-assets.tar*'
shasum -a 256 -c rich4-assets.tar.sha256
mkdir -p public && tar -xf rich4-assets.tar -C public

# 3. 运行单元测试（含联机安全、存档校验、资源加载与全量游戏规则测试）
npm test

# 4. 运行 TypeScript 静态类型检查
npx tsc --noEmit
npx tsc --noEmit -p tsconfig.e2e.json

# 5. 构建 Web 生产包（默认子路径 /rich4/；无素材 CI 可加 RICH4_NO_ASSETS=1）
npm run build:web

# 6. 严格发布验证（强制校验完整素材闭包与真实内容 SHA-256）
npm run verify:web

# 7. 无素材仅代码构建验证（供 GitHub Actions CI 使用，不代表生产素材验收）
npm run verify:web:code

# 8. 启动本地开发服务器（默认 http://127.0.0.1:5173/）
npm run dev

# 9. 已构建 dist 后，以生产 preview 执行浏览器测试（首次先安装 Chromium）
npx playwright install chromium
npm run test:e2e:code
npm run test:e2e:full
```

## 当前工程与验收状态

- **候选代码与本地测试**：67 个文件 / 564 项 Vitest 通过；正式构建、36,109 文件素材摘要、真实 Nginx、UI 存档恢复、一局自然结算、WebGL 合成/回退和原始性能记录已补齐，具体范围见 [候选验收记录](docs/plan/14-release-candidate-acceptance.md)。
- **当前长测版**：[rich4-staging.gopeaks.club](https://rich4-staging.gopeaks.club/) 已发布 `v0.6.7-longtest.1 · 581bef6`，沿用私测账号、独立 Origin 及默认 TURN 中继。基于三设备至少 20 次掷骰验收通过的 `0a1ed20`，本次只更新版本标识；规则和联机协议仍为 `0.6.6`。发布文件/素材摘要、线上鉴权、6 项 Chrome/WebKit 版本布局及三客户端成员/聊天/实际中继路径检查通过，见 [长测发布记录](docs/plan/15-longtest-release.md)。
- **清理与验收范围**：旧本地测试服务、构建及测试输出已清理；VPS 旧候选和日志已归档，保留两个回滚基线，验证房间已清空。既有 `/rich4/` 仍为 `66cf0b3`。弱网、五设备实体对局、完整长局、长局 TURN 续期及更广设备/存档矩阵仍待验收，PR #11 保持草稿，不能判定 M7–M10 全部完成。

## 授权说明

源码遵循 `GPL-3.0-or-later`（规则研究引用 `mytbk/rich4`，详见 [`THIRD_PARTY.md`](THIRD_PARTY.md)）。大富翁4 原游戏提取资源及其重绘素材**不在 GPL 授权范围内**，严禁公开商业分发，仅供个人/私人学习与自用。
