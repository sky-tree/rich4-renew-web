# Rich4 Renew Web — 开发计划与技术路线

> 文档版本：v1.0 · 制定日期：2026-10-20
>
> 项目：[`sky-tree/rich4-renew-web`](https://github.com/sky-tree/rich4-renew-web)
>
> 上游：[`iam567/rich4-renew-app`](https://github.com/iam567/rich4-renew-app)
>
> 规划基线：`bb1093863f389620fb56bc630d8b32ef9a35e901`（检查到的上游提交；后续以 `git rev-parse HEAD` 为准）

## 0. 使用说明

这里是 **Web 专项 Fork 的执行方案**，不是已实现功能说明。所有新技术、脚本、路径、性能目标及部署配置，在标明“已实现”之前均属于 **待实施**；不能据此推断当前代码已完成纯 Web 化或已上线。

**阅读顺序与单一事实来源：**

| 文档 | 解决的问题 | 使用场景 |
| --- | --- | --- |
| [01-product-scope.md](01-product-scope.md) | 做什么、不做什么、授权与发布门槛 | 需求变更、立项审查 |
| [02-architecture-and-stack.md](02-architecture-and-stack.md) | 技术选型、模块边界、架构演进 | 新功能设计、Code Review |
| [03-roadmap-and-backlog.md](03-roadmap-and-backlog.md) | 阶段、任务、依赖、交付及验收 | 每次开发开工/收尾 |
| [04-assets-and-performance.md](04-assets-and-performance.md) | 素材、网络、缓存、Canvas/PixiJS 性能策略 | 资源处理、性能优化 |
| [05-network-and-storage.md](05-network-and-storage.md) | WebRTC、存档、离线、安全性 | 联机、存档、PWA |
| [06-build-test-and-deploy.md](06-build-test-and-deploy.md) | 本地/测试/线上构建、Nginx、CI/CD、回滚 | 上线、排障 |
| [07-acceptance-and-quality.md](07-acceptance-and-quality.md) | 核心回归、指标、验收报告模板 | PR、发布验收 |
| [08-risks-and-decisions.md](08-risks-and-decisions.md) | 风险台账、决策记录、变更治理 | 架构评审、上游同步 |

## 1. 一页结论

**核心路线：现有 TypeScript 规则 + Vite + DOM/CSS UI + Canvas 2D 首发；在数据证明有收益后，引入 PixiJS 8 / WebGL 渐进替换地图渲染；Nginx 部署纯静态 Web。**

1. **先可运行**：Fork 基线、移除原生包依赖、通过单机游戏回归，不同步重写游戏规则。
2. **再可加载**：按入口 / 地图 / 风格组织资源，先测首屏与首张地图传输，避免全资源强制下载。
3. **再优化画面**：保留 CanvasRenderer 作为基准与回退，PixiRenderer 单地图对比测试，通过门槛再扩展。
4. **联机与离线独立演进**：保留现有 PeerJS 锁步设计；公网部署前解决信令与 TURN 凭据；PWA 不强制预缓存全量素材。
5. **发布合规优先于扩量**：GPL 源码许可 ≠ 游戏美术、原始音效及高清重绘素材的公开分发许可。

## 2. 当前状态（本次建档时）

| 项目 | 状态 | 依据或备注 |
| --- | --- | --- |
| GitHub Fork | **已完成** | `sky-tree/rich4-renew-web` |
| VPS 源码同步 | **已完成** | `/srv/devspace/repos/rich4-web` |
| Git 远端 | **已配置** | `origin`=个人 Fork；`upstream`=原作者 |
| Web 游戏架构 | **上游已有** | TypeScript + Vite + HTML/CSS + Canvas 2D |
| 原生依赖移除 | **未开始** | 仍有 Capacitor、Android/iOS、Electron |
| Web 专用素材构建 | **未开始** | 上游 `bundle-assets.mjs` 以 App 打包为导向 |
| PixiJS 渲染 | **未开始** | 当前仍是 `board-view.ts` Canvas 2D |
| 可公开访问 Web 站 | **未部署** | 规划路径 `/rich4/`，不代表已经开放 |
| 自动化发布/性能基线 | **未开始** | 需测量，不使用估算替代结果 |
| 素材公开分发许可 | **未确认** | 公网发布的阻断项；详见 01、08 |

## 3. 项目边界及环境

- **唯一目标形态**：浏览器直接打开可玩的 HTML5 游戏；不继续构建 APK、IPA 或 Electron 安装包。
- **保留玩法**：原有普通模式、地图与事件、大富豪模式、派对模式，尽可能保持规则一致。
- **无需兼容原版游戏二进制存档/数据格式**：保留目前 Fork 使用的 JSON 规则/存档是为降低迁移风险，不等于要求兼容原版 1998 年的数据文件。
- **代码开发与验证**：`/srv/devspace/repos/rich4-web`；现有 `main` 对应 GitHub Fork，不直接在未验证的代码上覆盖线上版本。
- **部署入口候选**：`https://apps.gopeaks.club/rich4/`（尚未部署）；优先与已有 Nginx 共存。
- **VPS 资源快照**：曾检查到 4 vCPU / 约 8 GiB 内存 / 40 GB 系统盘，但**带宽和月流量未验证**；游戏渲染与规则主要在客户端，网络/资源分发才是扩容重点。

## 4. 每次开发的工作约定

1. 开工前检查 `git status`, `origin`, `upstream`，确定目标里程碑与验收用例。
2. 先写/更新相关任务条目，再实现最小、可回滚改动；**规则引擎与渲染层不要在同一 PR 大面积重构**。
3. 每个 PR 要包含：做了什么、影响哪些入口、如何测试、测试结果、数据或截图、回滚路径。
4. 使用 `npm ci`、`npm test`、TypeScript 校验和 Web 构建（实际资源不在 Git，素材依赖需独立标记）。
5. 素材不得直接提交 Git，也不能将第三方 TURN 密钥、账号口令或下载令牌写入源码。
6. 只有达到 [07-acceptance-and-quality.md](07-acceptance-and-quality.md) 的验收条件才标记阶段完成。
7. 做出架构变更时同步 [08-risks-and-decisions.md](08-risks-and-decisions.md) 的决策记录。

## 5. 首个开发任务

执行 **[M0/M1：基线与纯 Web 化](03-roadmap-and-backlog.md)**。优先修复 Capacitor 依赖和构建，完成不依赖安装包的浏览器运行链路；**不要先实现 PixiJS 全量替换**。
