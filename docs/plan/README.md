# Rich4 Renew Web — 开发计划与技术路线

> 文档版本：v1.1 · 更新日期：2026-10-20
>
> 项目：[`sky-tree/rich4-renew-web`](https://github.com/sky-tree/rich4-renew-web)（纯 Web 专项 Fork · 私人使用，不公开）
>
> 上游：[`iam567/rich4-renew-app`](https://github.com/iam567/rich4-renew-app)
>
> 规划基线：`bb1093863f389620fb56bc630d8b32ef9a35e901`（检查到的上游提交；后续以 `git rev-parse HEAD` 为准）

## 0. 使用说明

这里是 **Web 专项 Fork 的执行方案**，不是已实现功能说明。所有新技术、脚本、路径、性能目标及部署配置，在标明“已实现”之前均属于 **待实施**；不能据此推断当前代码已完成纯 Web 化或已上线。

**阅读顺序与单一事实来源：**

| 文档 | 解决的问题 | 使用场景 |
| --- | --- | --- |
| [01-product-scope.md](01-product-scope.md) | 做什么、不做什么、私人使用边界 | 需求变更、立项审查 |
| [02-architecture-and-stack.md](02-architecture-and-stack.md) | 技术选型、模块边界、架构演进 | 新功能设计、Code Review |
| [03-roadmap-and-backlog.md](03-roadmap-and-backlog.md) | 阶段、任务、依赖、交付及验收 | 每次开发开工/收尾 |
| [04-assets-and-performance.md](04-assets-and-performance.md) | 素材、网络、缓存、Canvas/PixiJS 性能策略 | 资源处理、性能优化 |
| [05-network-and-storage.md](05-network-and-storage.md) | WebRTC、存档、离线、安全性 | 联机、存档、PWA |
| [06-build-test-and-deploy.md](06-build-test-and-deploy.md) | 多端构建（Win/Mac）、云端服务器 Nginx、回滚 | 部署验证、排障 |
| [07-acceptance-and-quality.md](07-acceptance-and-quality.md) | 核心回归、指标、验收报告模板 | PR、阶段验收 |
| [08-risks-and-decisions.md](08-risks-and-decisions.md) | 风险台账、决策记录、变更治理 | 架构评审、上游同步 |

## 1. 一页结论

**核心路线：现有 TypeScript 规则 + Vite + DOM/CSS UI + Canvas 2D 首发；在数据证明有收益后，引入 PixiJS 8 / WebGL 渐进替换地图渲染；云端服务器 Nginx 部署纯静态 Web 验证在线服务。**

1. **先可运行**：Fork 基线、移除原生包依赖、通过单机游戏回归，不同步重写游戏规则，确保 Windows / Mac 双端开发脚本兼容。
2. **再可加载**：按入口 / 地图 / 风格组织资源，先测首屏与首张地图传输，避免全资源强制下载。
3. **再优化画面**：保留 CanvasRenderer 作为基准与回退，PixiRenderer 单地图对比测试，通过门槛再扩展。
4. **联机与离线独立演进**：保留现有 PeerJS 锁步设计；在私人云端服务器验证信令与 TURN 服务；PWA 不强制预缓存全量素材。
5. **私人使用与仓库规范**：本项目定位为**私人使用、不对外公开**；游戏素材体积庞大，保持 `.gitignore` 不提交进 Git，在开发机与云端验证服务器上独立放置。

## 2. 当前状态

| 项目 | 状态 | 依据或备注 |
| --- | --- | --- |
| GitHub Fork | **已完成** | `https://github.com/sky-tree/rich4-renew-web` |
| Git 远端 | **已配置** | `origin`=个人 Fork (`sky-tree/rich4-renew-web`)；`upstream`=原作者 (`iam567/rich4-renew-app`) |
| 多端开发拓扑 | **已明确** | 1 台 Windows 开发设备 + 1 台 Mac 开发设备 + 1 台云端服务器（验证在线服务） |
| AI 引导与 M0 基线 | **已完成** | 已生成 [`CLAUDE.md`](../../CLAUDE.md) / [`GEMINI.md`](../../GEMINI.md) 并完成 M0 基线检查 |
| Web 游戏架构 | **上游已有** | TypeScript + Vite + HTML/CSS + Canvas 2D |
| 原生依赖移除 | **待开始 (M1)** | 仍有 Capacitor、Android/iOS、Electron |
| Web 专用素材构建 | **未开始 (M2)** | 上游 `bundle-assets.mjs` 以 App 打包为导向 |
| 云端在线服务验证 | **未部署 (M3)** | 规划路径 `/rich4/`，用于私人验证在线服务 |
| PixiJS 渲染 | **未开始 (M4)** | 当前仍是 `board-view.ts` Canvas 2D |
| 项目使用范围 | **私人使用（不公开）** | 仅供个人使用与云端在线服务验证，素材不入 Git |

## 3. 项目边界及多端环境

- **唯一目标形态**：浏览器直接打开可玩的 HTML5 游戏（私人使用，不公开）；不继续构建 APK、IPA 或 Electron 安装包。
- **保留玩法**：原有普通模式、地图与事件、大富豪模式、派对模式，尽可能保持规则一致。
- **无需兼容原版游戏二进制存档/数据格式**：保留目前 Fork 使用的 JSON 规则/存档是为降低迁移风险，不等于要求兼容原版 1998 年的数据文件。
- **三端职责与协同**：
  1. **Windows 开发设备**：日常编码、规则与 UI 调试、单元测试与构建验证。
  2. **Mac 开发设备**：日常编码、Safari 兼容性调试、资源处理（如 `cwebp`）与构建验证。
  3. **云端服务器（Linux VPS）**：`/srv/devspace/repos/rich4-web`，用于部署和验证在线 Web 静态服务及 WebRTC 联机功能；三端通过 `origin` (`https://github.com/sky-tree/rich4-renew-web`) 同步代码。
- **部署入口候选**：`https://apps.gopeaks.club/rich4/`（尚未部署，供私人验证在线服务）；优先与已有 Nginx 共存。
- **VPS 资源快照**：曾检查到 4 vCPU / 约 8 GiB 内存 / 40 GB 系统盘；游戏渲染与规则主要在客户端，服务端主要承担静态资源分发与联机信令/中继验证。

## 4. 每次开发的工作约定

1. 开工前检查 `git status`, `origin`, `upstream`，确定目标里程碑与验收用例。
2. 先写/更新相关任务条目，再实现最小、可回滚改动；**规则引擎与渲染层不要在同一 PR 大面积重构**。
3. 编写构建与工具脚本时确保 **Windows 与 macOS 双端跨平台兼容**。
4. 使用 `npm ci`、`npm test`、TypeScript 校验和 Web 构建（实际资源不在 Git，素材依赖需独立标记）。
5. 素材不得直接提交 Git，也不能将服务器密码、TURN 密钥、SSH 私钥写入源码提交至 GitHub。
6. 只有达到 [07-acceptance-and-quality.md](07-acceptance-and-quality.md) 的验收条件才标记阶段完成。
7. 做出架构变更时同步 [08-risks-and-decisions.md](08-risks-and-decisions.md) 的决策记录。

## 5. 下一步开发任务

执行 **[M1：纯 Web 化](03-roadmap-and-backlog.md)**。优先修复跨平台脚本与 Capacitor 依赖，完成不依赖安装包的浏览器运行链路；**不要先实现 PixiJS 全量替换**。
