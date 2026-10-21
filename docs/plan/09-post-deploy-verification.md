# 09 · M7–M10：线上复核、真机验收与稳定化计划

> 版本 v1.0 · 2026-10-21 · 状态：**待执行**。此前 M0–M6 为代码/本地测试完成，不代表真实生产验收。
>
> 适用范围：纯 Web 私人受控测试版；`/rich4/`；不更改现有 TypeScript 规则引擎，不开展 Godot/C++ 重写，不默认迁移 PixiJS。
>
> 对应任务的 10 条 GitHub Issues（#1～#10）均已登记，详情见 [10-github-issue-register.md](10-github-issue-register.md)；**当前仍待修复和验收**。

## 1. 2026-10-21 审核基线：事实、限制与证据

| 项目 | 观察 / 证据 | 结论边界 |
| --- | --- | --- |
| 仓库 `main` | `0dcd86a`（完整 SHA `0dcd86a323cd336d28dc2de75dd018f7e31fb406`） | 线上不追踪 HEAD |
| VPS 当前发布 | `rich4-releases/66cf0b3`，发布清单 `0.6.6-66cf0b3`、`gitSha: 66cf0b3` | 记录为审核时快照，需每次发布复核 |
| Vitest（VPS） | 55 测试文件 / 529 用例通过；2026-10-21 复跑 | **仅单测**，不代表游戏端到端通过 |
| GitHub Actions | 至当日最新 4 次 `Rich4 Web CI` 运行成功 | 无素材 CI 不能证明完整游戏素材和浏览器可玩 |
| 带凭据访问 `/rich4/` | HTTP 200；`/rich4/assets/maps/maps.json` 200；不存在的图片 404 | HTTP 冒烟通过，不等于游戏内开局 |
| 未授权请求 | 首页、`maps.json` HTTP 401 | 已有入口门禁；没有证明全部资源/CDN 隔离 |
| `manifest.webmanifest` | HTTP 200，但 `Content-Type: application/octet-stream`；部署清单中引用的 `p01.webp/.png` 文件缺失 | PWA 安装/图标受影响风险，浏览器未实测 |
| `sw.js` | HTTP 200；`Cache-Control: max-age=14400, must-revalidate` | 和期望 no-cache 不一致，需核查实际反代/CDN 层级 |
| 素材缓存头 | 部分素材响应 `Cache-Control: public, max-age=86400, must-revalidate` | **不代表已证实缓存泄漏**；需审查认证、边缘缓存策略 |
| 发布助手 | `deploy/rich4-ctl.sh` 回滚调用 `npm run rollback:web`，`game/package.json` 不含该 script | 可静态确认的回滚入口缺陷；尚未在真实在线版本执行回滚 |
| WebGL | `BoardView.sprite()` 先 Canvas `drawImage`，再入 `sceneSprites`，`draw()` 末尾再调 `expRenderer.render()` | 当前为双绘制实验，不是纯 WebGL 替换或性能收益证据 |
| 游戏交互/浏览器 | 本次无可用交互式浏览器环境 | **完整对局、跨设备、移动端性能、联机均未验收** |

### 不变量与发布约束

- 保持 **TypeScript 确定性核心、Canvas 2D 默认主渲染器**。性能优化不得改变 RNG 消耗顺序、地图单位、角色命中、存档/联机协议。
- 原始/重绘素材的许可与源码 GPL 分开审查。**Basic Auth ≠ 素材公开分发授权**；CI 不上传受限素材。
- 测试使用的认证凭据、TURN 令牌、玩家存档、聊天记录不得写入仓库、Issue、HAR、截图、GitHub Actions artifact 或日志。
- 每次发布记录 `gitSha`、`buildId`、素材哈希、实际 VPS symlink、目标浏览器和回滚版本；单测通过与实机通过分别记录。
- 现有站点继续提供受控访问。除非经过授权窗口，不执行真实发布/回滚，不触碰生产 symlink。

## 2. 里程碑与依赖

| 阶段 | 优先级/状态 | 目标 | 退出门槛 |
| --- | --- | --- | --- |
| **M7：线上环境与发布可靠性** | P1 / 待开始 | 修复回滚、PWA、缓存、访问边界；对齐版本 | 自动冒烟、权限测试和 A→B→A 回滚演练通过 |
| **M8：端到端和真机游戏质量** | P1 / 依赖 M7 基线 | Playwright 冒烟，桌面/手机/iPad 全局实测和完整对局 | 完整对局+存档恢复证据；无 P0 阻断 |
| **M9：性能与渲染** | P1/P2 / 依赖 M8 可复现样本 | 冷/热启动、地图、网络/内存/FPS；Canvas/WebGL A/B | 有数据支撑的优化、无玩法回归及低内存崩溃 |
| **M10：联机与小范围内测** | P1 / 依赖 M7+M8 | PeerJS / NAT/TURN、断线恢复、日志与限流 | 跨网络长局无分叉；测试版发布准入审核通过 |

### M7 · 线上修复与交付基础

- [ ] **M7-01 回滚修复**：使 `rich4-ctl.sh rollback` 正确调用已有 `release:web -- rollback` 接口，并覆盖指定版本/缺省版本/异常参数；先临时目录自动化，再授权窗口进行实际 A→B→A 演练。见 ISSUE-DRAFT-01。
- [ ] **M7-02 PWA 清单**：替换不存在的图标为有权分发的独立 192/512px PNG，修正 `manifest.webmanifest` Content-Type、作用域与实际资源路径；构建期拒绝失效图标。见 ISSUE-DRAFT-02。
- [ ] **M7-03 SW/缓存一致性**：检查最终生效的 Nginx Gateway、Cloudflare 缓存与实际 `sw.js`、HTML、版本 Manifest 头；不同 SW 状态下演练更新、断网恢复与回滚。见 ISSUE-DRAFT-03。
- [ ] **M7-04 私有素材/鉴权**：交叉测试匿名与授权请求，记录 Cloudflare 是否命中和 `Authorization` 处理；审查 `public` vs `private/no-store`；轮换已共享的测试凭据，杜绝在日志和仓库中存明文。见 ISSUE-DRAFT-04。
- [ ] **M7-05 发布台账**：保存 `main`、当前版本 symlink、`release-manifest.json`、HTTP 头及素材闭包的证据；PR/CI 和线上环境要明确区分。见 ISSUE-DRAFT-05。

**M7 验收**：带/不带认证的 200/401/404 正确；HTML、SW、manifest、哈希文件缓存头与设计一致；A→B→A 在浏览器中完成且不损坏历史存档。未验明版权边界不得扩大素材访问范围。

### M8 · 玩家可玩性与多设备 E2E

- [ ] **M8-01 自动化**：引入 Playwright（桌面 Chromium 起步），执行打开页面、进入菜单、新局、正常回合、存档、刷新恢复、失效资源可重试；CI 使用无版权/授权可分发的夹具，私人全素材联调独立跑。见 ISSUE-DRAFT-06。
- [ ] **M8-02 完整人工对局**：普通模式 2–4 人+AI，验证掷骰、移动、地产、银行、股票、卡片、破产/结算；记录随机种子、地图、版本、结果和异常。至少 1 场完整实际结算。
- [ ] **M8-03 扩展玩法**：原版多地图、重制地图、歌舞伎町、大富豪跨城、赌场/小游戏及音频/特效。覆盖 T-03～T-06、T-08、T-14。
- [ ] **M8-04 真机矩阵**：Windows Chrome/Edge，macOS Safari，iPhone Safari、iPad Safari、Android Chrome；重点测小屏横竖屏、点击目标与 hit test、后台恢复、低内存、存档/导出导入、PWA 离线。见 ISSUE-DRAFT-07。
- [ ] **M8-05 回归报告**：执行 T-01～T-14（派对按 M10 复核），每项记录 PASS/FAIL/BLOCKED/NOT RUN；截图和 trace 去密。

**M8 验收**：至少 1 场真实完整对局；存档能在刷新后正确恢复，历史档与新版本兼容；所有 P0 关闭或对应功能明确关闭；端设备问题有可复现工单而非笼统结论。

### M9 · 基于证据的加载、渲染与内存优化

- [ ] **M9-01 统一基准**：同地图、同人数、同 DPR、同动作脚本，分别采集冷/热首页、首地图、requests/transferred、TTI、FPS、p95/p99 frame time、>50ms 长帧、浏览器进程峰值。
- [ ] **M9-02 素材加载**：监控首屏下载，检查小文件瀑布、精灵 WebP 转码和 atlas 可行性；优先处理首屏无关资源和大量请求。不得一次下载整个 1.64 GB 素材库。
- [ ] **M9-03 Canvas 默认优化**：可视切片、精灵缓存、Worker 解码、内存档位、释放纹理、音频资源；移动端确保后台恢复。
- [ ] **M9-04 WebGL A/B 决策**：先消除 Canvas+WebGL 双绘制产生的无效比较，再对照视觉一致性、DPR、点击命中、实际 GPU/CPU、上下文恢复。无稳定显著收益则继续保持默认 Canvas。见 ISSUE-DRAFT-08、09。

**M9 初始参考目标（不是目前成绩）**：首页必需资源 ≤10 MiB；桌面典型场景争取 60 FPS，手机至少稳定 30 FPS；多次重复测量并保存 p95/内存证据，针对实测设备设最终门槛。

### M10 · 联机与小规模受控内测

- [ ] **M10-01 联机环境**：核查 PeerJS 信令 WSS、STUN/TURN 配置、短期 TURN 令牌/速率限制及失败路径；禁用无准备的公网联机入口。
- [ ] **M10-02 跨 NAT 长局**：两台不同网络设备及混合 PC/iPhone/iPad/Android，创建/加入/交接、20+ 回合一致性、超时托管和房主切后台、断线重连日志恢复。
- [ ] **M10-03 数据与安全**：检查房间码高熵、恶意消息拒绝、越座位抢答、规则协议版本、日志脱敏、TURN 流量监控。
- [ ] **M10-04 3–5 人受控测试**：按测试清单收集系统、浏览器、地图、版本、步骤、匿名截图/性能；按 P0/P1/P2 分类修复并复测。见 ISSUE-DRAFT-10。

**M10 验收**：跨 NAT 的 PeerServer/TURN 真实连接、持续游戏状态摘要相同、断线重新加入不重播错误答案；若未达标，只开放经过验收的单机模式并明确说明。

## 3. 建议合并/发布顺序

1. **文档/工单先行**：本文件、Issue 台账、阶段/风险/验收文档改动，不涉及运行中服务。
2. **小型修复 PR**：回滚；PWA 图标与 MIME；SW 缓存；鉴权/CDN 安全。每个 PR 独立验证/回滚。
3. **Playwright 验收设施**：基础启动 → 单个回合 → 保存恢复；与真实素材人工/私有 E2E 分离。
4. **测试与性能**：先 Canvas 真机/带宽基线，再精灵与缓存，最后 WebGL A/B。
5. **联机发布门槛**：逐台跨网络验收后再邀请小范围用户。

**变更控制**：不在同一 PR 内大改 `core/`、`board-view.ts`、`party-net.ts`；版本绑定 commit SHA，不以代码已合并代表已部署；对客户端新增测试命令必须同时更新 README 和 CI。

## 4. 可直接复制的测试报告模板

```md
## Rich4 受控版本验收 / YYYY-MM-DD
- 环境 / URL / 访问控制（不填账号密码）：
- 仓库 commit / 发布 buildId / 当前 symlink / 素材 sha256：
- 设备 / OS / 浏览器版本 / DPR / 网络：
- T-01 ~ T-14：逐项 PASS / FAIL / BLOCKED / NOT RUN
- 普通完整对局：开局设置、回合数、是否结算、结果：
- 存档：保存、刷新恢复、导出/导入、跨版本恢复：
- 联机：不同网络、PeerServer/STUN/TURN、状态摘要与断线恢复：
- 冷/热请求次数、下载 MiB、首页/地图交互耗时：
- Canvas / WebGL：FPS、p95、p99、>50ms 长帧、峰值内存：
- 401/200/404、Manifest MIME/icon、SW 缓存/更新、Cloudflare 响应：
- 已知问题（Issue ID/URL）、敏感信息脱敏情况：
- 授权/分发状态、发布/回滚验证、结论：批准受控测试 / 拒绝 / 限制能力
```

## 5. 当前放行结论

**仅允许继续当前受控测试，不签字为“全部功能生产可用”。** 线上基础 HTTP 检查已通过；完整对局、PWA 安装、移动端、性能与公网联机证据尚未建立。优先解决 M7 明确缺陷，再按 M8→M9→M10 推进。
