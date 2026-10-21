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
- [`deploy/nginx-rich4.conf`](deploy/nginx-rich4.conf)：Nginx `/rich4/` 子路径静态部署与缓存策略配置
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

# 5. 构建 Web 生产包（默认子路径 /rich4/；无素材 CI 可加 RICH4_NO_ASSETS=1）
npm run build:web

# 6. 严格发布验证（强制校验完整素材闭包与真实内容 SHA-256）
npm run verify:web

# 7. 无素材仅代码构建验证（供 GitHub Actions CI 使用，不代表生产素材验收）
npm run verify:web:code

# 8. 启动本地开发服务器（默认 http://127.0.0.1:5173/）
npm run dev
```

## 当前工程与验收状态

- **代码实现与本地测试（已完成）**：M0–M6 代码实现、安全加固（联机聊天 DOM XSS 防护、两阶段 SHA-256 重连令牌轮换防冒用、锁步座位归属与未开启 `seq` 强校验、6 位高熵房间码）、全量 36,109 文件真实字节 SHA-256 资源审计、强制串联校验的不可变版本发布脚本、PWA 最小可运行资源预缓存、手动分包优化及 **55 个测试文件 / 529 项单元测试**（无素材 CI 模式下 148 项通过 / 381 项跳过）已全部通过。
- **线上部署与跨设备真机验收（待在私人云端 VPS 执行）**：需在挂载合法私人素材的云端 Nginx 服务器（`/rich4/`）完成真实 HTTPS 冒烟、跨网络 WebRTC/TURN 真机联机与多浏览器实机验收后，方可视为完成最终线上生产验收。

## 授权说明

源码遵循 `GPL-3.0-or-later`（规则研究引用 `mytbk/rich4`，详见 [`THIRD_PARTY.md`](THIRD_PARTY.md)）。大富翁4 原游戏提取资源及其重绘素材**不在 GPL 授权范围内**，严禁公开商业分发，仅供个人/私人学习与自用。
