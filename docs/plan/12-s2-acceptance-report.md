# 12 · S2 测试与实机验收报告

> 2026-10-21～22 候选周期复核。此表替代原报告中 T-01～T-14 全部 PASS、Safari 已通过的结论。单测、文件校验和模拟视口不能代替真实设备验收。关联 Issues #6、#7；GitHub 状态仍为 OPEN。

## 验收矩阵

PASS 仅针对明确写出的执行范围；PARTIAL 表示仍有必需子项未执行；NOT RUN 表示没有对应现场证据。

| 编号 | 场景 | 状态 | 已有证据与剩余范围 |
| --- | --- | --- | --- |
| T-01 | 首页、菜单、新开局 | PARTIAL | Chromium 正式构建可开台湾 2P；音效、语言及全设备组合未全面检查。 |
| T-02 | 普通 2–4 人 + AI | PARTIAL | 真实 2P UI 对局，浏览器动画时钟加速，规则未改，30 天自然结算；4 人及破产路径未专项验收。 |
| T-03 | 股票、银行、卡片、道具、事件 | PARTIAL | 规则回归单测通过；未逐项完成对应 UI、金额及特效比对。 |
| T-04 | 多原版地图 | PARTIAL | 全量素材摘要校验；浏览器流程只覆盖台湾地图，不能据此确认其他地图视觉。 |
| T-05 | 自制、歌舞伎町地图 | NOT RUN | 有规则单测，缺专项浏览器与触摸操作记录。 |
| T-06 | 五城十二人大富豪 | NOT RUN | 有世界规则单测，缺完整 UI 对局及资源加载记录。 |
| T-07 | 手动与自动存档 | PASS（限定） | Chromium 桌面/移动视口：实际 UI 保存、刷新、UI 读档、全部 SaveData 字段比对（忽略 savedAt）、继续掷骰；自动档由引擎自然生成。历史版本及实机仍待验。 |
| T-08 | 下载、分享图片 | NOT RUN | 现有单测不足以确认系统分享面板或下载结果。 |
| T-09 | 横竖屏、缩放 | PARTIAL | Chromium 视口烟测；WebKit 模拟竖屏/横屏 ATM 控件边界通过。实体手机截图缺图，已更改会话鉴权，真机复测待验。 |
| T-10 | 慢网、断网、404 | PARTIAL | 真实 Nginx 严格 404 与启动烟测；尚未全面执行限速、离线恢复和素材失败重试。 |
| T-11 | SW 更新、发布回滚 | PARTIAL | 本地真实 Nginx、生成的不同入口 A→B→A：SW 激活后 UI 读档一致、无关缓存保留；不是历史正式存档或线上回滚验收。 |
| T-12 | 派对联机 | PARTIAL | 旧候选首次入房失败；BinaryPack 缺陷已修。用户在修复版强制中继入口以家宽电脑/移动数据手机确认双方两位成员、聊天互通；同机真实 TURN 往返也通过。用户 macOS Chrome / iOS Safari 报告日期资源一致，但手机缺图、反复登录、断网不能恢复。登录会话已部署，座位及迟到摘要已修；新版同机双 Chromium 经远端 TURN 推进 21 天、替换真实连接后继续至 22 天，全存档状态一致；两条物理网络的断网恢复重测和 3–5 人验收待完成。 |
| T-13 | 老设备、低内存 | NOT RUN | 没有真实低内存设备的进程终止、恢复与降级数据。 |
| T-14 | 卸载、重新载图 | PARTIAL | 渲染单测、实际 WebGL 丢失后 Canvas 回退通过；缺长期循环内存与音频/Worker 清理测量。 |

## 实际执行环境

- 本机 macOS / Apple M1 Pro / 32 GiB；本地 Node 25.9.0，CI 配置仍为 Node 22。
- Playwright Chromium 156.0.8078.4：桌面 1280×720、移动触摸模拟 844×390。移动模拟使用桌面浏览器内核，不算 iPhone 或 Android 实机。
- 本地 `dist` 正式 `/rich4/` 构建，有完整私有素材；默认 Playwright 启动 `vite preview`，显式 `E2E_DEV_SERVER=1` 才使用开发服务器。
- 用户已用 macOS Chrome 与 iOS Safari 跨网试玩并提供缺图截图；不代表完整实机验收通过。WebKit 模拟测试另行记录。Windows Edge、iPad、Android 未执行完整实机验收。

## 可复验证据

61 个 Vitest 文件 / 546 项用例通过（含断线座位及迟到摘要回归）；应用与 E2E 严格 TypeScript 检查通过。UI 存档和渲染浏览器测试共 8 项通过，并在历史候选 `a5f27de` 重跑 8 项全部通过；`f7e8528` 上相同 8 项 Chromium 回归通过；WebKit 图片/ATM 横竖屏检查通过，但存档测试出现一次后台动画刷新错误，重试通过，暂不判定稳定。新候选双客户端真实连接替换前后与继续游戏时全存档状态一致。一月完整对局自然结算测试通过两次。完整素材 36,109 文件真实字节摘要校验通过。

自然结算设置、初末状态和结果见 [complete-match.json](evidence/2026-10-21-rc/complete-match.json)；本地更新回滚结果见 [release-cycle.json](evidence/2026-10-21-rc/release-cycle.json)。动画时钟加速只适用于结算功能测试，不能用于性能测量。截图含私有素材，仅在本地保留。

`verify:web` 中的 HTTP 检查是模拟；新增 `test:nginx` 才会启动实际 Nginx、发送 HTTP 并检查鉴权/MIME/缓存/404。候选 `736766b` 的 [Node 22.23.3 CI](https://github.com/sky-tree/rich4-renew-web/actions/runs/39635177666) 已通过类型、真实 Nginx、无素材单测（161 通过 / 381 跳过）、TURN 签名、生产构建/壳校验和 6 项浏览器冒烟；私有素材与真实设备另验。

候选环境与后续实机结果统一登记在 [14-release-candidate-acceptance.md](14-release-candidate-acceptance.md)。

最新 `f7e8528` 的 [Node 22.23.3 CI](https://github.com/sky-tree/rich4-renew-web/actions/runs/39639998311) 通过：165 项单测通过 / 381 跳过、6 项浏览器烟测通过，新增会话签名/失效/篡改测试也通过。
