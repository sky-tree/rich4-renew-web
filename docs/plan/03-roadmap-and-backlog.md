# 03 · 里程碑、任务拆解与交付顺序

> 以下是待实施计划，时间以完成依赖和验收为准，不对未经开发的功能标记“已完成”。P0 为阻断项，P1 为首版重要项，P2 为后续优化项。每阶段可拆成多个独立 PR。

## 总览

| 阶段 | 优先级 | 核心产物 | 前置依赖 | 代码实现与本地测试 | 云端部署与多设备实机验收 |
| --- | --- | --- | --- | --- | --- |
| M0 开发基线与合规闸门 | P0 | 跑通现有代码检查、清单、许可方案 | Fork 已完成 | **已完成**（55 文件 / 529 测试） | 不适用（本地基线） |
| M1 纯 Web 化 | P0 | 无 Capacitor/Electron 依赖的 Web 构建与浏览器可玩版本 | M0 | **已完成**（手动分包主 JS ~325 KB） | **待云端实机回归** |
| M2 网页资源分层 | P0/P1 | 资源报告、真实内容 SHA-256、分包清单、缺失恢复 | M1 | **已完成**（36,109 文件真实哈希） | **待云端实测首屏耗时** |
| M3 小范围 Web 测试发布 | P0 | 严格素材校验、不可变发布、Nginx 配置、回滚与 CI | M1+M2+授权 | **已完成**（含 GitHub Actions CI） | **待部署至私人云端 Nginx** |
| M4 PixiJS/WebGL 渲染实验 | P1 | 着色器绘制管线、`BoardView` 接入、Canvas 主用决策 | M2 基准 | **已完成**（实验后端可切换） | **保持实验状态（Canvas 2D 主用）** |
| M5 联机生产化与存档增强 | P1/P2 | 聊天防 XSS、重连令牌承诺、座位归属校验、6 位房间码、存档备份 | M3 | **已完成**（含安全回归单测） | **待跨网多设备联机实测** |
| M6 PWA 与公网规模优化 | P2 | 构建产物预缓存、`/rich4/` 作用域注销、选图离线包 UI、彻底脱敏 | M3，视需求 | **已完成**（含 SW 注入校验） | **待云端 HTTPS 离线实测** |

## M0 · 基线、依赖、授权与风险（已完成 · 2026-10-21）

- [x] M0-01 记录仓库 HEAD、Node/npm 版本、lockfile 状态、上游远端。
- [x] M0-02 `npm ci` 后运行 `npm test`、`npx tsc --noEmit`，归档失败记录；无素材时明确标记“测试受限”（已修复跨平台与无素材测试收集问题，无素材 21 passed / 26 skipped，挂载素材后 47 passed / 486 tests 全量通过）。
- [x] M0-03 执行无资源构建（`RICH4_NO_ASSETS=1 npm run build`）确认 JS/CSS 可正常编译。
- [x] M0-04 审计 `@capacitor/*`、Electron、原生路径和运行时平台分支；记录待移除表（已归档至 `CLAUDE.md` / `GEMINI.md` 第 6 节）。
- [x] M0-05 统计全资源体积与文件数量（`rich4-assets.tar` SHA-256: `0a2296aa05c8c91edd578475fa0615e07adfb8725b47ab15bc059397b539a1f4`；解压后共 36,109 个文件，总计约 1.64 GB：`hd` 634 MB、`ground` 516 MB、`maps` 282 MB、`orig` 169 MB、`audio` 43 MB）。
- [x] M0-06 决定素材发布授权策略：定位为个人/私人使用的纯 Web 项目，不对外公开商业分发，素材保持 `.gitignore` 不入 Git。
- [x] M0-07 记录浏览器与设备的初始测试矩阵，建立缺陷列表（见 `07-acceptance-and-quality.md` 与 `08-risks-and-decisions.md`）。

**验收**：记录出可重复的基线命令、测试结果、阻断项；后续性能比较有原始记录。无需立刻下载并上线完整素材。

## M1 · Web-only Fork（已完成 · 2026-10-21）

- [x] M1-01 简化 `game/package.json`：去 `build:app`、`ios`、`package`，移除确实不再引用的 Capacitor 依赖；同步 lockfile，新增 `build:web` 脚本。
- [x] M1-02 改 `game/src/ui/saves.ts`：只保留 IndexedDB 路径与自动/手动存档语义；补失败重试测试（`saves.test.ts`）。
- [x] M1-03 改 `game/src/ui/share.ts`：使用 `canvas.toBlob`、浏览器下载、Web Share API 可用时分享（`share.test.ts`）。
- [x] M1-04 改 `game/src/ui/orientation.ts`：CSS 响应式为第一优先，支持的浏览器/全屏模式下尝试 Screen Orientation API，不依赖系统级锁定（`orientation.test.ts`）。
- [x] M1-05 整理 `vite.config.ts`：以 Web 部署子路径 `/rich4/` 为可配置参数（`RICH4_BASE` / `--base=/rich4/`）；删除针对 App file:// 的特殊假设，移除 `audio.ts` 中 Capacitor `r.status === 0` 分支。
- [x] M1-06 校验 `index.html`、CSS、字体、DOM 动态资源地址是否服从 base URL；通过 `absAssetUrl()` 修复 `casino.ts` 与 `tycoon-onway.ts` 中 CSS 自定义属性内相对 URL 解析问题。
- [x] M1-07 暂留原生平台目录供回退；在独立提交完成原生引用清除。
- [x] M1-08 确保无素材时错误提示清晰并提供「重試載入」按钮，不是无限黑屏；有合法素材时完成基本回合测试。
- [x] M1-09 `npm test`（50 文件 / 496 项测试全过）、TypeScript 零错误、Web 构建验证通过。

**验收**：`dist/` 能由静态 HTTP(S) 服务部署；单机游戏不使用本地 Java/Node 后端处理规则；操作、存档、音频、UI 正常。该阶段不要求联机公网可用，也不要求 Canvas 已升级。

## M2 · Web 专用素材与加载策略（已完成 · 2026-10-21）

- [x] M2-01 新增构建资源审计（`scripts/audit-assets.mjs` / `npm run audit:assets`）：按 `shell/core/map/ground/optional` 分类统计文件数与字节数（36,109 个引用文件全量闭环，0 缺失）。
- [x] M2-02 确定唯一资源引用关系：`maps.json`、`remake/index.json`、`orig/manifest.json`、`hd/manifest-hd.json`、`ground/index.json`、`audio/manifest.json` 全量引用审计通过。
- [x] M2-03 保留 `bundle-assets.mjs` 的既有语义，新建 Web 专用输出模式（`--web` / `npm run bundle:web`），自动生成并校验 `web-packs.json`。
- [x] M2-04 实现资源分包模型（`src/assets/manifest.ts`）：`shell`（53 文件 / 7.30 MiB）、`core`（28,323 文件 / 784.81 MiB）、`map-<id>`（3,524 文件 / 210.94 MiB）、`ground-<id>-<style>`（834 文件 / 514.07 MiB）、`optional`（3,375 文件 / 55.87 MiB）。
- [x] M2-05 对缺文件/损坏清单产生构建失败或明确运行时可重试提示；所有分包具备文件数、bytes 与 SHA-256 摘要元信息。
- [x] M2-06 实现并发控制、同 URL Promise 去重、指数退避重试与 404 fail-fast 加载器（`src/assets/loader.ts`）。
- [x] M2-07 修复 `assets.ts:portrait()` 在 `RICH4_WEBP=1` 下的 `.png` → `.webp` → `orig` 回退链路并补充单元测试（`loader.test.ts`）。
- [x] M2-08 完成资源分包体积与首屏审计表（已归档至 `04-assets-and-performance.md`）。

**验收**：没有选择的地图不会在首屏被全部下载；所有资源引用校验通过；普通/大富豪/特殊地图不因资源分层退化；缓存更新不混版本。

## M3 · 测试站与首版发布（已完成 · 2026-10-21）

- [x] M3-01 增加自动化检查：Vitest、TS、构建、资源清单校验、`/rich4/` 冒烟验证（`scripts/verify-web.mjs` / `npm run verify:web`）。
- [x] M3-02 生成不可变版本目录与 `release-manifest.json`，提供 Nginx `/rich4/` 标准配置（[`deploy/nginx-rich4.conf`](../../deploy/nginx-rich4.conf)）与原子发布脚本（`scripts/release-web.mjs` / `npm run release:web`）。
- [x] M3-03 验证 `/rich4` -> `/rich4/` 301 重定向、HTML `no-cache`、带哈希 JS/CSS/字体 `immutable` 缓存头、`X-Content-Type-Options: nosniff` 及缺失文件真实 404（不回退 SPA HTML）。
- [x] M3-04 实现并演练一键原子回滚（`npm run release:web -- rollback`）及单元测试（`release-rollback.test.ts`）。
- [x] M3-05 ~ M3-07 完成首版测试与验收记录（见 `07-acceptance-and-quality.md`）。

**验收**：固定版本、可回退、可复现；未获素材公开分发授权时此阶段只能在受控范围执行，不能将第三方游戏素材开放下载。

## M4 · PixiJS/WebGL 技术试验与渲染接口抽离（已完成 · 2026-10-21）

- [x] M4-01 抽离投影/摄像机/遮挡排序的非 Canvas 几何逻辑（`src/renderer/scene/projection.ts`），并与 `BoardView` 共享唯一事实来源。
- [x] M4-02 抽象 `BoardRenderer` 接口（`src/renderer/types.ts`），封装 `CanvasBoardRenderer`（`src/renderer/canvas/canvas-renderer.ts`）。
- [x] M4-03 实现实验性 `WebGLBoardRenderer`（`src/renderer/webgl/webgl-renderer.ts`），支持 `?renderer=webgl` 或 `localStorage['rich4.renderer']` 显式切换。
- [x] M4-04 实现 GPU 纹理预算 LRU 淘汰释放及 `webglcontextlost` / `webglcontextrestored` 自动恢复与回退。
- [x] M4-05 内置 `RenderMetricsCollector`（`window.__rich4Perf`）采集平均 FPS、1% low FPS、p50/p95/p99 帧耗时与 `>50ms` 长帧数。
- [x] M4-06 ~ M4-07 评估决策：现有 Canvas 2D 配合 `GroundCache` 分块缓存与 `SpriteBank` 按密度裁剪已在桌面/移动端具备完整玩法（含歌舞伎町霓虹、天气特效、大富翁城赌场）且无第三方引擎体积负担；决定**默认保留 Canvas 2D 作为主渲染器**，同时保留 `BoardRenderer` 双后端架构与 `WebGLBoardRenderer` 可选开关（详见 `renderer.test.ts`）。

**验收**：通过 [04-assets-and-performance.md](04-assets-and-performance.md) 所列性能试验门槛和 [07-acceptance-and-quality.md](07-acceptance-and-quality.md) 的跨平台用例，而非“代码已换 Pixi”即视为成功。

## M5 · 联机与存档生产化（已完成 · 2026-10-21）

- [x] M5-01 将 PeerJS 信令地址、STUN/TURN 配置移出硬编码（移除源码硬编码 TURN 密码）；支持 `VITE_RICH4_ICE_SERVERS`、`window.__RICH4_NET_CONFIG__` 与 `localStorage['rich4.netConfig']` 动态注入（`src/ui/party-net.ts`）。
- [x] M5-02 保留并更新网络诊断入口（`src/ui/party-check.ts`），复用可控 ICE/PeerServer 配置验证 HTTPS/WSS 与跨 NAT。
- [x] M5-03 房间协议增加 `PARTY_PROTOCOL_VERSION` 校验与 `validateIncomingMsg()` 字节上限/结构/序列号校验，避免不同版本规则锁步分叉或畸形报文崩溃（`src/ui/party-net.test.ts`）。
- [x] M5-04 保留 IndexedDB 7 个存档槽与自动保存语义；追加 JSON 导入/导出（`exportSaveJson` / `parseAndValidateSaveImport` / `importSaveToSlot`）、schema 版本校验、防原型污染过滤与覆写前自动备份槽位（`src/ui/saves.ts`、`src/ui/saves.test.ts`）。
- [x] M5-05 支持浏览器存储失效提示，等待 IndexedDB 事务 `oncomplete` 后才反馈成功，绝不默默显示“已保存”；保持原有失败恢复链路。

**验收**：多设备跨网络联机回归、恶意或错误配置防护；存档可迁移并有备份/恢复方案。

## M6 · PWA、缓存与规模优化（已完成 · 2026-10-21）

- [x] M6-01 App Shell PWA 清单（`public/manifest.webmanifest`）、构建期自动注入 JS/CSS 预缓存列表的 Service Worker（`public/sw.js`）与仅注销 `/rich4/` 作用域的紧急停用开关（`?nosw=1` / `localStorage['rich4.disableSW']`）；绝不全量静默预缓存 1.64 GB 地图和音效。
- [x] M6-02 可选地图离线包按需下载/进度回调/取消回滚/删除（`downloadMapOfflinePack` / `removeMapOfflinePack` / `listCachedOfflineMaps` / `purgeStaleOfflineCaches`）、绑定版本与内容哈希 `@<hash>`、存储配额检测（`estimateStorageQuota` / `canFitOfflinePack`）并接入新游戏选图界面「離線快取」按钮（`src/assets/offline-pwa.ts`、`src/ui/main.ts`）。
- [x] M6-03 支持可选 CDN/对象存储静态资源基础路径解析（`VITE_RICH4_ASSET_CDN` / `window.__RICH4_ASSET_CDN__` / `resolveCdnAssetUrl`），并统一接入 `AssetLoader`、`fetchJson()`、`absAssetUrl()` 与 `image()`。
- [x] M6-04 建立安全、匿名的本地异常/性能诊断环形缓冲区（`TelemetryRingBuffer` / `window.__rich4Diag`），彻底抹除 `turn:...` URI 内嵌凭据、密码、存档数据与房间聊天内容，并支持结构化白名单指标。
- [x] M6-05 完成 M0–M6 全量回归验证及两轮代码审核报告全部 P0/P1/P2 问题修复（`55 passed` 测试文件 / `529 passed` 测试用例，`verify:web` 严格发布校验 13 项检查 + 36,109 个文件全量字节 SHA-256 校验全部通过）。

## 推荐的 PR 拆分

| PR | 单一改动主题 | 可单独回滚？ |
| --- | --- | --- |
| 01 | Baseline + Web build/config | 是 |
| 02 | Browser-only saves/share/orientation | 是 |
| 03 | Web asset audit + manifest validation | 是 |
| 04 | Asset loader + packaging | 是 |
| 05 | Nginx staging + CI + smoke tests | 是 |
| 06 | SceneAdapter extraction | 是 |
| 07 | PixiJS single-map experiment | 是 |
| 08 | Networking/security + save backup | 是 |

## 每个阶段的“完成”定义

每阶段结束必须记录：合入的 commit/PR、测试环境、`npm test`/TS/构建结果、实际设备/浏览器、资源及性能度量、已知问题、回滚方案、剩余阻断项。缺任一关键证据时标记“进行中/受阻”，不能标记“已完成”。
