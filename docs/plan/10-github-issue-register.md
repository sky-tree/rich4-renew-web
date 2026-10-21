# 10 · GitHub Issue 登记台账（M7–M10）

> 2026-10-21 初次审计与 Issues 登记。**ISSUE-DRAFT-xx 是文档内部稳定追踪 ID；实际 GitHub Issue # 与链接见下表。**
>
> GitHub App 仓库授权及仓库 Issues 功能开启后，以下 10 条工单已经创建。创建 Issue 不等于问题得到修复，也不等于功能通过验收。
>
> 不在 GitHub Issue、复现步骤、截图或附件中发布 Basic Auth 密码、TURN 凭据、个人存档/聊天记录。严重的实际可利用漏洞应走私有安全报告渠道，而非公开操作细节。

## 1. 追踪表

2026-10-21 通过 GitHub 实时核实 #1～#10 均为 OPEN；本表实现进度不代表工单已关闭。未修改远端 Issue 状态。

| 追踪 ID | 优先级 | 阶段 | 工单标题 | GitHub Issue | 状态 |
| --- | --- | --- | --- | --- | --- |
| ISSUE-DRAFT-01 | P1 | M7 | 修复 VPS 版本回滚入口与实机回滚验收 | [#1](https://github.com/sky-tree/rich4-renew-web/issues/1) | OPEN · 有实现/本地验证，线上验收待完成 |
| ISSUE-DRAFT-02 | P1 | M7 | 修复 PWA 图标缺失与 Web Manifest MIME | [#2](https://github.com/sky-tree/rich4-renew-web/issues/2) | OPEN · 有实现/本地验证，线上验收待完成 |
| ISSUE-DRAFT-03 | P1 | M7 | 修正 Service Worker 更新缓存策略及回滚一致性 | [#3](https://github.com/sky-tree/rich4-renew-web/issues/3) | OPEN · 有实现/本地验证，线上验收待完成 |
| ISSUE-DRAFT-04 | P1 / security | M7 | 审核 Basic Auth / Cloudflare 对受限素材的缓存边界 | [#4](https://github.com/sky-tree/rich4-renew-web/issues/4) | OPEN · 有实现/本地验证，线上验收待完成 |
| ISSUE-DRAFT-05 | P1 | M7 | 发布版本对齐与回滚/HTTP 证据留档 | [#5](https://github.com/sky-tree/rich4-renew-web/issues/5) | OPEN · 有实现/本地验证，线上验收待完成 |
| ISSUE-DRAFT-06 | P1 | M8 | 引入 Playwright Web E2E 冒烟与失败证据归档 | [#6](https://github.com/sky-tree/rich4-renew-web/issues/6) | OPEN · 生产预览测试已补齐，新 CI 待运行 |
| ISSUE-DRAFT-07 | P1 | M8 | 普通完整对局、跨设备与历史存档验收 | [#7](https://github.com/sky-tree/rich4-renew-web/issues/7) | OPEN · 部分验收，详见 S2 修正报告 |
| ISSUE-DRAFT-08 | P1 | M9 | 冷/热加载、资源体积和 Canvas 性能基准 | [#8](https://github.com/sky-tree/rich4-renew-web/issues/8) | OPEN · 本地候选证据已补，实机范围待完成（见 [S3](13-s3-benchmark-report.md)） |
| ISSUE-DRAFT-09 | P2 | M9 | 检查实验 WebGL 的双绘制并完成真正 A/B | [#9](https://github.com/sky-tree/rich4-renew-web/issues/9) | OPEN · 本地候选证据已补，实机范围待完成（见 [S3](13-s3-benchmark-report.md)） |
| ISSUE-DRAFT-10 | P1 | M10 | PeerJS/TURN 跨 NAT、断线恢复与 3–5 人内测 | [#10](https://github.com/sky-tree/rich4-renew-web/issues/10) | OPEN · 用户跨网成员/聊天通过；长局、重连和 3–5 人待验 |

**统一 Issue 标题前缀**：`[M7][P1]` / `[M9][P2]`；可根据仓库现有 labels 再标记 `bug`、`enhancement`、`testing` 或 `security`，不要假设不存在的 label 已创建。

## 2. GitHub Issue 正文存档（与已创建工单对应）

### ISSUE-DRAFT-01 · `[M7][P1] 修复 VPS 版本回滚入口与实机回滚验收`

**发现（2026-10-21）**：`deploy/rich4-ctl.sh` 的 `rollback` 分支调用不存在的 `npm run rollback:web`；`game/package.json` 仅定义 `release:web`，`game/scripts/release-web.mjs` 支持 `rollback` 子命令。线上未进行破坏性验证。

**工作**：
- [ ] 对齐 `rich4-ctl.sh` 与 `release:web -- rollback` 的 CLI，验证有参、无参与非法 ID。
- [ ] 新增隔离目录测试，不触碰活跃测试版 symlink；确认返回码、目标版本、路径安全。
- [ ] 授权窗口演练 A→B→A；复核首页/素材/发布清单/存档；记录 symlink 和 SHA。

**验收**：助手脚本能在正确目录恢复目标版本；真实回滚后 HTTP 资源与 `release-manifest` 匹配，历史存档未损坏。涉及 T-11、M7-01。

### ISSUE-DRAFT-02 · `[M7][P1] 修复 PWA 图标缺失与 Web Manifest MIME`

**发现（2026-10-21）**：`game/public/manifest.webmanifest` 指向 `assets/hd/portraits/p01.webp` 和 `.png`；线上对应文件缺失，且 `/rich4/manifest.webmanifest` 返回 `application/octet-stream`。不能据此断言所有浏览器安装失败，需实测。

**工作**：
- [ ] 换成有权发布的独立 192/512 PNG 图标，不把受限素材混入 Git。
- [ ] 修正线上 MIME、Base URL、Manifest 的图标与 scope；检查 PWA 鉴权行为。
- [ ] 构建或发布验证检查 Manifest 图标文件是否存在。
- [ ] Android Chrome 与 iOS/iPad Safari 按平台能力进行安装/启动验收。

**验收**：Manifest 和图标请求 200，类型与尺寸正确；受支持平台可安装/启动。涉及 T-01/T-11、M7-02。

### ISSUE-DRAFT-03 · `[M7][P1] 修正 Service Worker 更新缓存策略及回滚一致性`

**发现（2026-10-21）**：在线 `sw.js` 响应 `Cache-Control: max-age=14400, must-revalidate`；部署片段希望更新更及时。尚未复现真实版本混读。

**工作**：
- [ ] 对照源站 Nginx、DevSpace Gateway、Cloudflare 最终规则与响应头。
- [ ] 明确 `sw.js`、HTML、Manifest、带哈希文件的缓存和刷新策略。
- [ ] 同一浏览器有/无旧 SW、有/无离线包、离线恢复后执行发布 A→B→A。
- [ ] 保留 `/rich4/` 作用域，不能清除同域其他应用数据。

**验收**：受控更新和回滚均无旧包/新清单混读，不影响存档，不留下关键 404；有自动化证据。涉及 T-11、M7-03。

### ISSUE-DRAFT-04 · `[M7][P1][security] 审核 Basic Auth 与 Cloudflare 对受限素材的缓存边界`

**发现（2026-10-21）**：匿名首页及地图 JSON 请求返回 401；授权后部分素材携带 `Cache-Control: public` 并通过 Cloudflare。**没有发现匿名可读素材的证据**，仅构成需验证的私有缓存隔离风险。

**工作**：
- [ ] 核对 Cloudflare 对 `Authorization`、cookie、带 Basic Auth 资源的缓存配置（不要公开敏感配置）。
- [ ] 进行匿名与不同测试身份交叉访问验证，记录脱敏 HTTP 头与缓存命中。
- [ ] 为受限素材选择合理的 `private/no-store` 或有版权许可的安全资源分发策略；评估 Manifest 开放的必要性。
- [ ] 轮换在协作沟通中共享过的测试口令，私密存放；日志/CI/HAR 禁止存凭据。
- [ ] 在扩大测试范围前复核素材许可。Basic Auth 不代表版权分发授权。

**验收**：未认证及跨身份请求不可能通过共享缓存取到受限素材；有安全核查记录。涉及 M7-04、R-01/R-14/R-16。若发现实际漏洞，先私下处理。

### ISSUE-DRAFT-05 · `[M7][P1] 发布版本对齐与回滚/HTTP 证据留档`

**发现（2026-10-21）**：GitHub `main` 为 `0dcd86a`；VPS 运行 `0.6.6-66cf0b3`，`gitSha:66cf0b3`。区别本身不构成故障，但开发计划曾把云端部署标成“待执行”，状态与现场不一致。

**工作**：
- [ ] 发布台账包含 Git SHA、构建 ID、素材摘要、真实 symlink、执行者、时间、HTTP 头、回滚版本。
- [ ] 修正文档对“已部署”与“待实机验收”的混淆；保留历史基线。
- [ ] 明确使用独立版本号测试，不假设新 commit 已自动上线；部署/回滚使用显式确认机制。
- [ ] 在发布后运行 `smoke-test`、受限资源 401、页面 200、缺失资源 404、存档回归。

**验收**：任意一次测试版可从报告追溯到源码和资源版本；当前运行版本不会因提交文档被更改。涉及 M7-05。

### ISSUE-DRAFT-06 · `[M8][P1] 引入 Playwright Web E2E 冒烟与失败证据归档`

**现状**：2026-10-21 VPS `npm test` 55 files / 529 cases passed；CI 代码模式不能替代真正打开浏览器游戏。

**工作**：
- [ ] 浏览器流程：入口 → 菜单 → 新游戏 → 正常回合 → 存档 → 刷新恢复 → 错误加载提示。
- [ ] CI 用可发布/自制夹具，私有授权素材 E2E 另运行；严禁通过 GitHub artifact 外发第三方游戏素材。
- [ ] 输出可复现 trace、console、network、匿名截图、版本/地图/浏览器；引入合理重试与失败分类。
- [ ] 加入不同视口的基本触控/布局烟测；不把截图通过当作规则通过。

**验收**：真实浏览器至少一条稳定的保存恢复路径，每个失败有证据；测试分层 `code-only` / `full-assets` / `manual`。涉及 M8-01、T-01/T-02/T-07/T-10。

### ISSUE-DRAFT-07 · `[M8][P1] 普通完整对局、跨设备与历史存档验收`

**现状**：暂无可审计的 Windows/Mac/iPhone/iPad/Android 真实完整对局报告。

**工作**：
- [ ] 普通 2–4 人+AI：掷骰、移动、地产、银行、股票、卡片、事件、结算/破产（至少真实完整一局）。
- [ ] 特殊地图、歌舞伎町、大富豪跨城及音频特效的专项验证。
- [ ] Windows Chrome/Edge、macOS Safari、iPhone/iPad Safari、Android Chrome：横竖屏、点击命中、前后台恢复、存档/自动档/导入导出、PWA 离线。
- [ ] T-01～T-14 逐项标记 PASS/FAIL/BLOCKED/NOT RUN，记录复现步骤和失败分类。

**验收**：不少于 1 局真实结算、存档刷新恢复正确、无未隔离 P0，主要设备可以完成关键操作。涉及 M8-02～05、T-01～T-14。

### ISSUE-DRAFT-08 · `[M9][P1] 冷/热加载、资源体积和 Canvas 性能基准`

**现状**：分包清单累计约 1.64 GB，但缺少已验收的冷/热 TTI、首地图 transferred、请求数、FPS/内存数据；总素材体积 **不等于首屏网络传输量**。

**工作**：
- [x] 本地固定构建/电脑/浏览器/视口，记录冷/热菜单、首地图窗口及真实源站 HTTP 传输。
- [x] 保留 300 个 rAF 原始间隔、分位数与 JS 堆采样；它们不是 GPU 时间或进程峰值。
- [ ] 目标设备及受控网络条件复测，定位素材/字体瀑布与长局瓶颈。
- [ ] 按实测瓶颈决定是否优化，并覆盖锚点、方向、透明度与复杂场景视觉回归。

**验收状态**：旧数值不再作为正式依据。生产 Nginx 的原始传输和 rAF 记录见 [S3 修正报告](13-s3-benchmark-report.md)；目标设备及受控网络条件复测未完成。涉及 M9-01～03。

### ISSUE-DRAFT-09 · `[M9][P2] 检查实验 WebGL 的双绘制并完成真正 A/B`

**证据**：`game/src/ui/board-view.ts` 中 `sprite()` 先 `ctx.drawImage()` 再将精灵记录到 `sceneSprites`，`draw()` 尾部调用 `expRenderer.render()`；实验路径并非关闭 Canvas 的替代后端。

**工作**：
- [x] 定义独立 Canvas 和 WebGL 视觉渲染职责；在不改变规则 RNG 的情况下去重绘制。
- [ ] 补齐复杂场景/天气/歌舞伎町/文字/点击命中/DPR 的视觉回归。
- [ ] GPU/CPU、显存及目标设备专项仍待测；本地同局 rAF 和上下文丢失回退已有证据。
- [x] 明确是否值得继续投入；无可重复收益则保持默认 Canvas，不扩大 WebGL 适配范围。

**验收状态**：透明缓冲及失败回退修复已覆盖实际 Chromium 像素测试；配对性能记录见 [S3](13-s3-benchmark-report.md)。尚不能声称所有复杂场景已验证，保持 Canvas 默认。涉及 M9-04。

### ISSUE-DRAFT-10 · `[M10][P1] PeerJS/TURN 跨 NAT、断线恢复与 3–5 人内测`

**现状**：已有 PeerJS/WebRTC 锁步与安全单测；尚无实测跨 NAT 长局、房主迁移、TURN 中继及多设备状态摘要证据。

**工作**：
- [ ] 测试同 Wi-Fi、移动网络与家宽、PC ↔ iOS/Android，房间创建/加入/交接和关闭。
- [ ] 使用合法受控 PeerServer WSS / STUN / TURN 及短效凭据，验证转发链路、异常提示、带宽与资源限制。
- [ ] 固定版本/随机种子，执行 20+ 回合并比对游戏状态摘要；断网、重连、前后台/房主掉线、托管恢复。
- [ ] 检查恶意消息、越座位答案、跨版本协议不兼容和高熵房间码。
- [ ] 在授权范围内进行 3–5 人受控内测；每个问题关联设备、浏览器、版本、匿名日志。

**验收**：跨 NAT 长局状态一致、断线恢复可靠且无凭据泄露。未通过时仅允许单机功能继续受控测试。涉及 M10-01～04、T-12。

## 3. 创建与维护规程

1. **登记完成**：ISSUE-DRAFT-01～10 对应 GitHub [#1](https://github.com/sky-tree/rich4-renew-web/issues/1)～[#10](https://github.com/sky-tree/rich4-renew-web/issues/10)，均为 Open，后续不要重复创建。
2. 标题使用 `[M7][P1]` 等里程碑/优先级前缀；Issue 的验收依据参见 `docs/plan/09-post-deploy-verification.md`。
3. 开发过程中跟踪 Open / In Progress / Fixed / Verified / Closed；关闭时附 PR、commit、CI、浏览器与实机证据。
4. 不以“已创建 Issue”代替已修复；不以“GitHub CI green”代替真实素材/联机/性能验收。
