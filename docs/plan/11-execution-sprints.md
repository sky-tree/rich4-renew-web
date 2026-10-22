# 11 · 接下来四个周期的执行计划（2026-10-21）

> **状态提醒（2026-10-23）**：本页 S1–S4 排期和“当前冻结点”是 **2026-10-21 历史计划快照**，不再作为最新 Issues 状态或当前开发顺序。现已进入 [16 · M11 执行计划](16-lan-longtest-m11-plan.md)：GitHub #5/#6 结项，#12–#15 新建；3 台物理设备同 LAN 长测 1 小时游戏规则状态一致，**断线未测试**。候选 PR #11 仍未合并至 `main`。

> 状态：**候选验收进行中（2026-10-22）**，最新证据见 [14](14-release-candidate-acceptance.md)。主要目标：把已实现的 M0–M6 从「单测与构建正常」推进到「受控版本可回滚、能完整对局、可量化性能、跨网络联机可验证」。
>
> 任务源：GitHub [Issues #1～#10](https://github.com/sky-tree/rich4-renew-web/issues)；技术基线与事实证据见 [09-post-deploy-verification.md](09-post-deploy-verification.md)。
>
> 下表为**建议时间窗口**，适用于单人 + AI 辅助开发；以验收是否通过为准，不承诺一定在日期当天完成，阻断时停止向后发布。当前未分配具体 GitHub 负责人。

## 0. 当前冻结点

- **GitHub `main`**：`9305668`（2026-10-21）；该提交的 GitHub Actions [Rich4 Web CI](https://github.com/sky-tree/rich4-renew-web/actions/runs/39555347947) 已通过。
- **VPS 当前发布（2026-10-21 再核对）**：`rich4-releases/66cf0b3`，`buildId:0.6.6-66cf0b3`，`gitSha:66cf0b3`。与 `main` 不同是当前事实，不直接等于异常。
- **Issues 状态**：10 条问题已创建，暂无开放 PR；全部是**待完成**，不是已修复。
- **已知测试边界**：VPS 上 55 文件 / 529 单元测试通过，线上 HTTP 的基础访问检查通过；完整实际对局、PWA 安装、移动真机、跨 NAT 联机没有可审计通过报告。
- **变更边界**：本计划**不**自动重启或部署 VPS；**不**将第三方游戏素材、Basic Auth、TURN 凭据写入公开代码/Issue；**不**因为无素材 CI 成功就批准内测扩围。

## 1. 时间表、前置条件、交付产物

| 周期与建议窗口 | 处理 Issue（优先顺序） | 本周期输出 | 放行 / 下一周期的前置门槛 |
| --- | --- | --- | --- |
| **S1 · 发布可靠性** 10/22–10/28 | **#1 回滚 → #4 鉴权/CDN → #5 版本台账 → #2 PWA 图标/MIME → #3 SW 缓存** | 独立的修复 PR、自动化回归、HTTP/缓存检查、受控 A→B→A 回滚记录 | 授权访问与资源隔离可信，回滚可验证，PWA/SW 不引入版本混读 |
| **S2 · 完整可玩性** 10/29–11/04 | **#6 浏览器 E2E → #7 完整对局/真机** | Playwright 冒烟和失败工件；至少一场完整结算；存档刷新恢复；桌面/移动测试矩阵 | 无阻断 P0；至少一个桌面和一个移动端完成启动、操作、存档恢复；完整对局报告 |
| **S3 · 测量与优化** 11/05–11/11 | **#8 性能基线 → #9 WebGL 实验（部分验证）** | 生产构建原始 HTTP/rAF 数据及合成/回退测试 | 本地证据已补，实机/复杂场景待验；见 [13](13-s3-benchmark-report.md) |
| **S4 · 联机验收/内测** 11/12–11/18 | **#10 PeerJS/TURN、跨 NAT 长局与 3–5 人测试** | 两种以上真实网络组合；20+ 回合状态一致性；断线恢复、TURN/安全审计；内测缺陷回流 | 联机未通过就不开放联机；如果单机已经过 S1+S2 验收，可只开放受控单机测试 |

### S1 · 本轮立即开工的具体步骤

1. **建立发布证据（#5，与 #1 同步）**：记录源代码 SHA、`release-manifest.json`、当前 symlink、Nginx/Cloudflare 脱敏响应头，禁止直接更新 `main` 到线上。记录可回滚前版本。
2. **修回滚入口（#1）**：`deploy/rich4-ctl.sh` 调用的 `rollback:web` 并未定义；先确认 `release-web.mjs` 参数语义，再使用临时根目录补无参数、指定版本、异常 ID 的自动化测试。未经授权窗口，不在当前上线版本上实际切换 symlink。
3. **验证私有资源隔离（#4）**：检查匿名/受控身份取资源及 Cloudflare 是否缓存带 `Authorization` 的私有响应。观察到 `Cache-Control: public` 并**不等于**已发生数据泄漏；基于结果调整 Nginx/Cloudflare。轮换已在沟通中共享的口令，凭据仅放私有受控目录。
4. **修 PWA（#2）**：提供有权分发的独立 192/512 图标、校验文件存在和像素尺寸，给 `manifest.webmanifest` 合理 MIME；调整 `start_url`/`scope` 及图标访问策略。
5. **修 SW 与更新路径（#3）**：诊断实际 `sw.js` 缓存头（审计时为 4 小时）以及 Nginx + Cloudflare 最终行为；设计 A→B→A、已有 SW、无 SW、离线恢复等测试。
6. **单 PR 单目的 + CI**：#1、#4、#2/#3 分别提交；#5 主要记录部署自动化与版本审计。合并后仅在明确授权窗口部署测试环境、执行冒烟与受控回滚。完成后回填 #1～#5 验收证据并关闭对应问题。

### S1 · 发布可靠性（#1、#2、#3、#4、#5）进展记录

- [x] **#1 回滚入口（实现/隔离测试）**：修复 `deploy/rich4-ctl.sh` 调用 `scripts/release-web.mjs rollback`，增加安全正则校验防路径穿越；`game/package.json` 补充 `rollback:web`；隔离沙盒测试（A→B→A→B）全部通过；**线上真实回滚仍待 #1 验收，不能把实现勾选等同于 Issue 已关闭**。
- [x] **#2 PWA 图标与 Manifest**：由 `game/scripts/generate-icons.mjs` 原生渲染合规标准的独立 192/512/32 PNG 图标与 SVG/ICO，直接入库；`manifest.webmanifest` 引用正确相对路径；Nginx 补齐 `.webmanifest` 标准 MIME；`verify-web.mjs` 增加图标存在性与字节大小强断言；测试通过。
- [x] **#3 SW 缓存与回滚一致性**：Nginx 将 `sw.js` 设为 `no-cache, no-store, must-revalidate, max-age=0` 与 `Service-Worker-Allowed: /rich4/`；`sw.js` 针对 `manifest.webmanifest` 实行 Network-First 策略并预缓存独立图标；测试通过。
- [x] **#4 访问安全与缓存边界**：Nginx/Gateway 中将受保护游戏素材（`webp|png|json|m4a`）严格设定为 `Cache-Control: private, no-transform, max-age=86400, must-revalidate` 与 `Vary: Authorization, Accept-Encoding`，彻底切断 Cloudflare 及共享代理对未授权请求泄露素材的路径；独立图标与 Manifest 保持免密；测试通过。
- [x] **#5 版本台账与审计流水**：`release-web.mjs` 在 `history.json` 记录 `gitSha`、`buildId`、`filesCount`、`assetHashVerified` 及 `history.events`（发布与回滚流水）；端到端测试覆盖。

### S2 · 测试系统和真机（#6、#7）进展记录

- [x] **#6 Playwright Web E2E 体系与失败证据归档**：
  - 引入 `@playwright/test`，编写 `game/playwright.config.ts`；
  - 建立分层测试：`npm run test:e2e:code`（无素材 CI 模式，覆盖启动、PWA Manifest 与多视口响应式）与 `npm run test:e2e:full`（完整素材对局模式）；
  - 实现 `setupDiagnostics()` 自动脱敏并归档 Console、失败请求与错误堆栈；
  - 在 `.github/workflows/ci.yml` 引入 Chromium 浏览器与 `test:e2e:code` 自动化冒烟，失败自动留存 artifact。
- [ ] **#7 完整范围尚未完成**：已补 UI 手动/自然自动档逐字段恢复与台湾 2P 一月自然结算；跨设备、所有地图和历史正式存档仍待验。逐项状态见 [12](12-s2-acceptance-report.md)。

### S3 · 先测量再优化

1. **#8 采样**：同一设备同一地图重复至少 3 次，统计 cold/warm 首页和首地图网络大小/耗时、请求数、FPS、p95/p99、长帧、峰值内存；参考目标为首屏必需包 ≤10 MiB，桌面争取 60FPS / 手机稳定 30FPS，需按实际设备复核。
2. 先优化真正瓶颈（碎片图片、地表缓存、无关预取、并发/缓存、低内存释放），**不**一次性下载约 1.64 GB 的素材。
3. **#9 是实验项，不是发布阻断项**：当前实验路径存在 Canvas + WebGL 双绘制；只有去重后、视觉一致且性能确有可重复收益，才考虑替换默认 Canvas 2D。不得扰乱 `core` 的确定性 RNG。

### S3 · 测量与优化（#8、#9）进展记录

- [x] 正式构建通过实际 Nginx 采集压缩 HTTP 字节，计入 SW 后台请求；原始 JSON 与方法见 [13](13-s3-benchmark-report.md)。旧 4.70 MiB / 59.5 FPS 数值已撤回为正式依据。
- [x] 修复 WebGL HUD 透明缓冲与失败回退，通过真实 Chromium 像素测试；同存档各采集 300 个 rAF 间隔，保持默认 Canvas。
- [ ] 每环境三次重复、真实手机/低内存设备、复杂运动/天气场景及进程/GPU 内存尚未完成，不标记整项 PASS 或关闭 #8/#9。

### S4 · 联机与小范围测试

1. **#10**：验证 WSS PeerServer、STUN/TURN（不用硬编码长效密钥）和真实家庭宽带/移动数据网跨 NAT；同局最少 20 回合检查状态摘要。
2. 重点测掉线、重连、前后台切换、房主失联、协议版本不一致和玩家座位越权；记录流量/失败率及脱敏诊断。
3. 只在 S1 和 S2 准入门槛通过后邀请 3–5 名受控测试者；若联网仍有风险，分离为仅单机测试。禁止因 Basic Auth 已开启就推定有素材公开分发许可。

## 2. 执行方式：避免并行修改造成冲突

| 工作项 | 主要变更面 | 允许并行关系 |
| --- | --- | --- |
| #1 + #5 | `deploy/rich4-ctl.sh`、发布脚本/校验/文档 | 同组处理；先确认命令签名 |
| #4 | DevSpace Nginx/Gateway/Cloudflare 配置、资源访问策略 | 可与 #1 并行排查；配置变更独立 PR，避免影响同 VPS 其他 `apps` 服务 |
| #2 + #3 | `game/public/manifest.webmanifest`、`sw.js`、gateway MIME/Cache | 可一起分析，但修图标和改缓存分开验收 |
| #6 + #7 | 测试框架、`game/src/ui`、私有测试环境 | #6 自动化辅助 #7；先验证可复现的一回合再长局 |
| #8 + #9 | `assets`、`board-view.ts`、renderer | #8 的真机基线是 #9 的前置条件 |
| #10 | `party-net.ts`、PeerServer/TURN 环境 | 在 S2 真机路径稳定后做联网验收，避免和渲染大改同一个 PR |

**分支/合并规则**：每个 Issue 独立 `fix/issue-N-...` / `test/issue-N-...` 分支和 PR；通过 Vitest、类型检查、无素材 Web 构建、必要的本地有素材集成测试后合并 `main`；仅在用户许可的发布窗口部署到 `/rich4/`，执行 smoke-test 并记录回滚证据。GitHub Issue 的关闭取决于验收，不取决于代码写完。

## 3. 执行优先级与停止条件

**最高优先级**：#1（确定性命令错误）、#4（未证实但须先核查的资源安全边界）、#5（可追溯的发布基线），随后 #2/#3 和 #6/#7。

**条件性后置**：#9 如果没有足够的视觉/性能收益就停止实验；#10 如果跨 NAT 仍有状态分叉则将联网功能保持关闭，不影响单机版验证。

**每周期退出**：至少提交对应 PR/commit、GitHub Actions 结果、受控部署版本（如实际发布）、实验/真机证据、遗留问题及回滚方案。遇到版权/权限问题、跨身份缓存风险、不可回滚版本或 P0 游戏崩溃，应暂停扩大测试范围。

## 4. 第一条可执行开发指令

**从 [Issue #1](https://github.com/sky-tree/rich4-renew-web/issues/1) 入手，先实现纯代码修复与临时发布目录自动化测试。** 输出 PR、变更文件、用例结果，不切换当前 VPS 的活动发布 symlink。同步用 #5 留存审计基线，然后检查 #4 的鉴权/CDN 隔离，再进入 PWA 修复。
