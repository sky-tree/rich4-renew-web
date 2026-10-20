# CLAUDE.md — Rich4 Renew Web 协作指南

本文件为 AI 编程助手（Claude Code / Gemini / Antigravity 等）在 `rich4-renew-web` 仓库中工作时的核心上下文与工程规范。

---

## 1. 项目定位与核心边界

- **项目名称**：Rich4 Renew Web（大富翁4 高清重制版 · 纯 Web 专项 Fork）
- **项目性质**：**个人/私人使用的纯 Web 项目，不对外公开商业分发**。
- **仓库关系**：
  - `origin`：`https://github.com/sky-tree/rich4-renew-web`（本项目唯一推送目标）
  - `upstream`：`https://github.com/iam567/rich4-renew-app`（Fork 来源，上游原作者仓库，只读参考/选择性同步）
- **多端开发与验证拓扑**：
  1. **Windows 开发设备**：日常开发、规则与 UI 调试、单元测试、构建验证。
  2. **macOS 开发设备**：日常开发、Safari 兼容性调试、资源处理（如 `cwebp`）与构建验证。
  3. **云端服务器（Linux VPS）**：用于验证纯 Web 在线服务（Nginx 静态托管、资源按需加载、WebRTC/PeerJS 联机信令与 TURN 服务）。
- **唯一目标形态**：浏览器直接打开可玩的 HTML5 游戏（桌面 + 移动浏览器）。**不再构建或维护 Android APK、iOS IPA、Electron 桌面安装包**。
- **核心技术路线**：
  1. **M0/M1（首发基线）**：保留现有 TypeScript 规则引擎 + Vite + DOM/CSS UI + Canvas 2D 渲染，移除 Capacitor/Electron 原生依赖，确保 Windows / macOS 双端开发脚本兼容。
  2. **M2/M3（资源与部署）**：按 `shell / core / map / ground / optional` 拆分 Web 资源清单与按需加载，在云端服务器通过 Nginx 部署验证在线服务（目标子路径 `/rich4/`）。
  3. **M4（渲染演进）**：在 Canvas 2D 基线数据完备后，渐进抽离 `SceneAdapter` 与 `BoardRenderer`，以单地图 A/B 试验评估 PixiJS 8 / WebGL，达标后再推广。
  4. **M5/M6（联机与离线）**：保留 PeerJS/WebRTC 锁步同步协议，移除源码硬编码 TURN 凭据并切换为可控配置；按需支持存档 JSON 导入导出与 App Shell PWA。

---

## 2. 目录结构与模块职责

```text
rich4-renew-web/
├── game/                       # 前端与游戏核心工程（Vite + TypeScript + Vitest）
│   ├── index.html              # 浏览器入口（含启动异常兜底面板 #boot-err）
│   ├── package.json            # 依赖与构建脚本（需保持 Windows / macOS 跨平台兼容）
│   ├── vite.config.ts          # Vite 构建配置（支持 RICH4_NO_ASSETS=1 跳过素材复制）
│   ├── src/
│   │   ├── core/               # 纯规则引擎（与 DOM/Canvas 解耦，确定性 RNG 驱动）
│   │   │   ├── game.ts         # 单局核心状态机与 Generator 流程 (game.run())
│   │   │   ├── world.ts        # 大富豪模式（五城十二人跨城世界状态）
│   │   │   ├── board.ts        # 地图数据结构解析
│   │   │   ├── save.ts         # 存档序列化/反序列化
│   │   │   └── modules/        # 地产、银行、股票、卡片、道具、事件、小游戏等规则子模块
│   │   └── ui/                 # 浏览器视图、交互、渲染、音频、存档与联机
│   │       ├── main.ts         # 应用启动入口、模式路由与主循环衔接
│   │       ├── board-view.ts   # 等角投影、相机控制、命中测试与 Canvas 2D 棋盘绘制
│   │       ├── assets.ts       # 地图与基础资源加载（基于 import.meta.env.BASE_URL）
│   │       ├── sprites.ts      # 原版与 4x HD 精灵清单、锚点与帧管理
│   │       ├── ground.ts       # 地面切片（ground tiles）按需加载
│   │       ├── ground-cache.ts # Canvas 2D 地面分块缓存（关联 mem-tier.ts 内存分档）
│   │       ├── audio.ts        # Web Audio 音效、语音与背景音乐管理
│   │       ├── saves.ts        # 存档管理（IndexedDB 7 槽位 + 最近 5 回合自动档环）
│   │       ├── share.ts        # 结算画面图片保存与 Web Share / 下载
│   │       ├── orientation.ts  # 屏幕方向偏好设置
│   │       ├── lang.ts         # 繁简显示转换（仅转换视图层，绝不改动规则/存档/RNG）
│   │       ├── party-net.ts    # 派对模式 PeerJS / WebRTC 锁步联机
│   │       └── screens/        # 标题、设置、选人、股市、小游戏等 DOM 界面
│   └── scripts/                # 资源链接 (link-assets.mjs) 与打包脚本 (bundle-assets.mjs)
├── docs/
│   ├── plan/                   # 【单一事实来源】Web 化开发计划、架构、里程碑与风险台账
│   └── rules/                  # 原版反汇编还原的 22 份详尽游戏规则规范
└── editor/                     # 地图资源目录占位（editor/site/assets 软链目标，不入库）
```

---

## 3. 常用开发与验证命令（Windows & macOS 双端通用）

所有前端命令均在 `game/` 目录下执行：

```bash
cd game

# 1. 严格按 lockfile 安装依赖
npm ci

# 2. 运行 Vitest 单元测试（无本地游戏素材时，依赖地图 JSON 的测试会自动 skip）
npm test

# 3. 运行 TypeScript 静态类型检查
npx tsc --noEmit

# 4. 无素材代码构建验证（验证 TS + Vite 打包 JS/CSS/字体是否正常）
# macOS / Linux (bash/zsh):
RICH4_NO_ASSETS=1 npm run build
# Windows (PowerShell):
$env:RICH4_NO_ASSETS="1"; npm run build

# 5. 本地开发服务器（默认绑定 127.0.0.1）
npm run dev

# 6. 链接本地游戏素材到 game/public/assets
npm run assets
```

---

## 4. 关键工程不变量与红线（必读）

1. **规则引擎确定性（Determinism）**：
   - `game/src/core/` 中的所有随机行为必须且只能消费游戏自身的 `RNG` 流。
   - **严禁**因渲染帧率、资源加载先后、简繁体切换（`lang.ts`）或 UI 动画状态改变 `RNG` 调用顺序。
2. **多端跨平台兼容（Windows + macOS + Linux 云端）**：
   - 编写 `package.json` 脚本、Node 构建脚本（`game/scripts/*`）与单元测试时，必须兼顾 Windows（路径分隔符、目录 Junction 软链、CRLF、系统 Locale）与 macOS/Linux 的一致性。
   - 避免在 `package.json` 的通用脚本中直接硬编码仅限 POSIX shell 的环境变量语法（可通过 Node 脚本或 Vite 配置读取环境变量）。
3. **关注点分离与小步变更**：
   - **不要在同一个 PR 中同时大面积修改 `src/core/` 规则引擎与 `src/ui/` 渲染层**。
   - 不要在 M1 阶段为了“目录好看”大规模移动文件路径，优先保持小 diff 以便与 `upstream` 对比同步。
4. **素材与安全管理（私人使用约定）**：
   - **严禁将游戏素材提交进 Git**：`game/public/assets/` 体积庞大且属原游戏提取/重绘资源，保持 `.gitignore` 忽略，在本地或私人云端服务器通过独立目录/软链管理。
   - **严禁在 Git 源码中硬编码敏感凭据**：不得将服务器密码、TURN 凭据、SSH 密钥写入源码或提交至 GitHub 仓库。
5. **实事求是的测试与验收**：
   - 无本地素材时通过 `RICH4_NO_ASSETS=1` 构建仅代表“代码可编译”，需标记 `asset-integration: blocked/not-run`；完整游戏验证需配合本地或云端已部署素材执行。
   - 存档写入必须等待 IndexedDB 事务 `oncomplete` 后才能向用户反馈成功。

---

## 5. 开发计划与文档索引（单一事实来源）

每次开工或设计方案前，请先查阅 [`docs/plan/README.md`](docs/plan/README.md)：

- [`01-product-scope.md`](docs/plan/01-product-scope.md)：产品范围、MVP 定义与私人使用边界
- [`02-architecture-and-stack.md`](docs/plan/02-architecture-and-stack.md)：技术选型、运行时分层、`BoardRenderer` 演进接口
- [`03-roadmap-and-backlog.md`](docs/plan/03-roadmap-and-backlog.md)：M0–M6 里程碑任务拆解与 PR 拆分建议
- [`04-assets-and-performance.md`](docs/plan/04-assets-and-performance.md)：素材依赖闭包、分包策略、Web 加载与性能基线
- [`05-network-and-storage.md`](docs/plan/05-network-and-storage.md)：WebRTC 锁步安全、IndexedDB 存档与导入导出、PWA 策略
- [`06-build-test-and-deploy.md`](docs/plan/06-build-test-and-deploy.md)：多端 Git 规程、构建命令、云端 Nginx `/rich4/` 部署与回滚
- [`07-acceptance-and-quality.md`](docs/plan/07-acceptance-and-quality.md)：T-01~T-14 端到端用例、浏览器矩阵、验收模板
- [`08-risks-and-decisions.md`](docs/plan/08-risks-and-decisions.md)：R-01~R-15 风险台账与 ADR-001~ADR-006 架构决策记录

---

## 6. 当前基线状态快照（M0–M6 全阶段收尾记录 · 2026-10-21）

- **代码基线**：上游基线 `bb1093863f389620fb56bc630d8b32ef9a35e901`，已完成 M0–M6 全部里程碑改造与本地分阶段 Git 提交。
- **编译与构建**：`npx tsc --noEmit` 零错误通过；`RICH4_NO_ASSETS=1 npm run build:web` 正常产出 `/rich4/` 子路径构建包及 PWA App Shell（`manifest.webmanifest`、`sw.js`）；`npm run verify:web` 8 项冒烟检查全部通过。
- **本地素材与全量测试**：
  - 素材包：`rich4-assets.tar`（SHA-256: `0a2296aa05c8c91edd578475fa0615e07adfb8725b47ab15bc059397b539a1f4`），解压至 `game/public/assets/` 共 36,109 个文件、约 1.64 GB（`npm run audit:assets` 校验 0 缺失，`shell` 包 53 文件 / 7.30 MiB）。
  - 单元测试：**55 个测试文件 / 519 项测试 100% 通过**。
- **M1–M6 核心交付摘要**：
  - **M1（纯 Web 化）**：彻底移除 `@capacitor/*` 原生依赖与平台分支，`saves.ts` / `share.ts` / `orientation.ts` / `audio.ts` 全部收敛为纯 Web API，支持 `/rich4/` 子路径与 `absAssetUrl()`。
  - **M2（资源分层与加载器）**：新增 `audit:assets`、`bundle:web`（`shell / core / map / ground / optional`）与 `AssetLoader`（并发控制、指数退避重试、去重、404 fail-fast）。
  - **M3（部署、验证与回滚）**：新增 `deploy/nginx-rich4.conf`、`verify:web` 与 `release:web` 原子软链发布及一键回滚脚本。
  - **M4（渲染接口演进）**：抽离纯函数等角投影（`projection.ts`）、`BoardRenderer` 接口、`Canvas2DBoardRenderer`、`WebGLBoardRenderer`（含纹理预算 LRU 与上下文丢失恢复）及 `RenderMetricsCollector`（`window.__rich4Perf`），默认保留 Canvas 2D 主渲染器。
  - **M5（联机安全与存档导入导出）**：移除源码硬编码 TURN 凭据，新增协议版本与消息结构/大小校验（`validateIncomingMsg`），新增存档 JSON 导入/导出、防原型污染校验与覆写前自动备份槽位。
  - **M6（PWA 与离线包/诊断）**：新增受 `/rich4/` 作用域约束的 App Shell PWA（`manifest.webmanifest` + `sw.js`）、紧急停用开关（`?nosw=1`）、配额检测与按需地图离线包管理（`offline-pwa.ts`）、可选 CDN 前缀解析及匿名脱敏诊断环形缓冲区（`window.__rich4Diag`）。
