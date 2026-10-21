# Rich4 Renew Web — 开发计划与技术路线

> 文档版本：v1.3 · 更新日期：2026-10-21（增加线上审核与 M7–M10 后续计划）
>
> 项目：[`sky-tree/rich4-renew-web`](https://github.com/sky-tree/rich4-renew-web)（纯 Web 专项 Fork · 私人使用，不公开）
>
> 上游：[`iam567/rich4-renew-app`](https://github.com/iam567/rich4-renew-app)
>
> 上游分叉基线：`bb1093863f389620fb56bc630d8b32ef9a35e901`

## 0. 使用说明与状态分类原则

本目录是 **Web 专项 Fork 的单一事实来源（Single Source of Truth）**。为保持工程实事求是，所有里程碑与功能状态严格区分三个层级：

1. **已实现（Implemented）**：源码、构建脚本、安全加固与接口已在仓库中落地。
2. **已本地测试（Tested Locally）**：已在挂载完整本地素材（36,109 个文件）及无素材 CI 模式下通过 Vitest 单元测试（55 文件 / 529 项测试；无素材 CI 模式 148 通过 / 381 跳过）、TypeScript 类型检查、Vite 构建与本地静态冒烟校验。
3. **待云端与多设备实机验收（Pending Cloud / Multi-Device Sign-off）**：需在私人云端 Linux VPS 的真实 Nginx（`/rich4/`）与多台物理设备（桌面 + 移动 Safari/Chrome + 跨 NAT WebRTC/TURN）上完成实机验证，不能仅凭本地单元测试或模拟请求直接等同于线上生产验收通过。

**阅读顺序：**

| 文档 | 解决的问题 | 使用场景 |
| --- | --- | --- |
| [01-product-scope.md](01-product-scope.md) | 做什么、不做什么、私人使用边界 | 需求变更、立项审查 |
| [02-architecture-and-stack.md](02-architecture-and-stack.md) | 技术选型、模块边界、架构演进 | 新功能设计、Code Review |
| [03-roadmap-and-backlog.md](03-roadmap-and-backlog.md) | 阶段、任务、依赖、交付及验收状态 | 每次开发开工/收尾 |
| [04-assets-and-performance.md](04-assets-and-performance.md) | 素材、网络、缓存、Canvas/WebGL 性能策略 | 资源处理、性能优化 |
| [05-network-and-storage.md](05-network-and-storage.md) | WebRTC 安全、存档、离线、PWA 边界 | 联机、存档、PWA |
| [06-build-test-and-deploy.md](06-build-test-and-deploy.md) | 多端构建（Win/Mac）、云端服务器 Nginx、回滚 | 部署验证、排障 |
| [07-acceptance-and-quality.md](07-acceptance-and-quality.md) | 核心回归、指标、验收报告模板 | PR、阶段验收 |
| [08-risks-and-decisions.md](08-risks-and-decisions.md) | 风险台账、决策记录、变更治理 | 架构评审、上游同步 |
| [09-post-deploy-verification.md](09-post-deploy-verification.md) | M7–M10 线上修复、浏览器/真机验收、性能与联机放行标准 | 当前后续开发与验收执行 |
| [10-github-issue-register.md](10-github-issue-register.md) | 已创建的 GitHub Issues #1～#10 及原始问题证据和验收清单 | 跟踪 M7–M10 修复与实机验收 |

## 1. 一页结论

**核心路线：现有 TypeScript 规则 + Vite + DOM/CSS UI + Canvas 2D 主渲染；保留 `BoardRenderer` 抽象与实验性 WebGL 着色器后端供 A/B 对比；云端服务器 Nginx 部署纯静态 Web 验证在线服务。**

1. **先可运行（M0/M1）**：移除 Capacitor/Electron 原生依赖，纯 Web API 收敛存档/分享/方向/音频，支持 `/rich4/` 子路径与双端跨平台脚本。
2. **再可加载（M2）**：按 `shell / core / map / ground / optional` 组织资源并计算真实字节 SHA-256，结合并发控制、指数退避重试与 404 fail-fast 加载器。
3. **可验证发布（M3）**：严格发布模式（`npm run verify:web`）强制校验完整素材闭包与真实内容 SHA-256；`release-web.mjs` 强制校验版本 ID 格式并拒绝覆盖已有不可变版本目录；配备 `.github/workflows/ci.yml` 自动化回归。
4. **渲染演进（M4）**：默认采用成熟稳定的 Canvas 2D 主渲染器；同时提供具备完整着色器管线、纹理 LRU 预算与上下文丢失恢复的实验性 `WebGLBoardRenderer`（`?renderer=webgl`）。
5. **联机安全与离线增强（M5/M6）**：消除联机聊天 DOM XSS（纯 DOM API + 严格 Schema 白名单）、引入 SHA-256 重连令牌承诺防身份冒用、锁步 `ans` 座位归属强校验、6 位高熵邀请码；构建期自动向 `sw.js` 注入全量入口 JS/CSS 预缓存列表并限定 `/rich4/` 注销作用域；选图界面支持按需离线缓存地图包。

## 2. 当前状态总览（2026-10-21）

| 领域 / 阶段 | 代码实现 | 本地测试与构建（含全量素材） | 云端真实环境上线验收 | 依据或备注 |
| --- | --- | --- | --- | --- |
| **M0 开发基线** | **已实现** | **已通过**（55 文件 / 529 项测试） | 不适用（本地基线） | 完整素材 36,109 文件已挂载并完成全文件真实字节 SHA-256 校验 |
| **M1 纯 Web 化** | **已实现** | **已通过**（`build:web` + 单测） | **待云端实机回归** | 已移除 `@capacitor/*`，JS 分包后主包降至 ~325 KB |
| **M2 资源分层与真实哈希** | **已实现** | **已通过**（`audit:assets` 0 缺失） | **待云端实测首屏耗时** | `web-packs.json` 记录真实内容 SHA-256，`verify:web` 强制校验素材闭包 |
| **M3 发布、回滚与 CI** | **已实现** | **已通过**（本地冒烟 + 回滚单测） | **已部署测试版，待真实回滚和浏览器验收** | 2026-10-21 VPS 运行 `0.6.6-66cf0b3`；检测到 `rich4-ctl.sh rollback` 命令不一致，参见 M7 |
| **M4 渲染接口与 WebGL 实验** | **已实现** | **已通过**（Canvas 主用 + WebGL 管线单测） | **保持实验状态** | `BoardView` 已接入 `?renderer=webgl` 与完整着色器绘制，默认保持 Canvas 2D |
| **M5 联机安全与存档迁移** | **已实现** | **已通过**（含 XSS/防冒用/抢答拦截单测） | **待跨网双机/多机联机实测** | 已修复 P0 聊天 XSS、重连令牌校验、座位归属校验与 6 位高熵房间码 |
| **M6 PWA、离线包与脱敏诊断** | **已实现** | **已通过**（SW 注入 JS/CSS + 作用域单测） | **待云端 HTTPS 离线实测** | `sw.js` 预缓存构建产物、仅注销 `/rich4/` 作用域、选图 UI 接入离线包 |
| **M7–M10 稳定化** | **已规划，待实施** | **部分线上 HTTP + VPS 单测已核实** | **尚无完整游戏、真机、性能、跨 NAT 验收签字** | [09 后续计划](09-post-deploy-verification.md) / [10 Issue 台账](10-github-issue-register.md) |

## 3. 项目边界及多端环境

- **唯一目标形态**：浏览器直接打开可玩的 HTML5 游戏（私人使用，不公开）；不构建 APK、IPA 或 Electron 安装包。
- **三端职责与协同**：
  1. **Windows 开发设备**：日常编码、规则与 UI 调试、单元测试与构建验证。
  2. **Mac 开发设备**：日常编码、Safari 兼容性调试、资源审计与构建验证。
  3. **云端服务器（Linux VPS）**：用于部署 `/rich4/` Nginx 静态服务及验证 WebRTC/TURN 跨网联机。

## 4. 下一步重点工作（2026-10-21 审核后更新）

1. **M7 先修已定位的问题**：修正 `rich4-ctl.sh` 回滚入口、缺失 PWA 图标、Manifest MIME、Service Worker 缓存策略；核查认证下的 Cloudflare 缓存。已经有 HTTPS 测试版，但尚未做真实回滚验收。
2. **M8 完整浏览器游戏验收**：引入 Playwright 并进行真实一局结算、历史存档恢复、Windows/Mac/iPhone/iPad/Android 真机测试（T-01～T-14）。
3. **M9/M10 数据驱动优化和联机**：记录冷/热启动、首地图流量、帧时间/内存，保留 Canvas 为默认；在跨 NAT PeerServer/TURN 长局通过后才扩大受控内测。
4. **工单现状**：GitHub Issues 已启用、访问权限已验证；[M7–M10 的 #1～#10 已正式创建](https://github.com/sky-tree/rich4-renew-web/issues)。工单目前待处理，不等同于问题已修复。

**实测快照（2026-10-21）**：代码 HEAD `0dcd86a`，VPS 激活 `0.6.6-66cf0b3`；`/rich4/` 经授权 200、未授权 401；地图 JSON 经授权 200、未授权 401；未知素材 404；VPS Vitest 55 文件/529 用例通过。完整浏览器对局未执行。详情及复验方法见 [09](09-post-deploy-verification.md)。
