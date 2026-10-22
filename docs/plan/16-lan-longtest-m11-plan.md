# 16 · 三设备局域网 1 小时长测与 M11 开发/验收计划

> **2026-10-23**：本页是用户新增的**实体设备实测反馈**与下一阶段排期，关联 [GitHub Issues](https://github.com/sky-tree/rich4-renew-web/issues) 和 [PR #11](https://github.com/sky-tree/rich4-renew-web/pull/11)。报告中“通过”的含义仅限下列实测范围，不代表候选完整验收或跨 NAT 断线恢复。详见脱敏 [evidence/2026-10-23-lan/three-device-1h.json](evidence/2026-10-23-lan/three-device-1h.json)。

## 1. 本轮实测事实与验收判定

| 要素 | 用户报告 / 结果 |
| --- | --- |
| 测试网络 | 三设备**同一局域网**；并未对本次链路做 ICE candidate pair 抓取 |
| Windows | 联想小新，AMD Ryzen 7 8845HS |
| macOS | MacBook Pro，M1 Pro |
| iPadOS | iPad Pro，A12Z |
| 时长与人数 | **三人、一小时**；游戏运行稳定 |
| **游戏规则/数值状态一致性** | **PASS（用户报告）**，与此前“有些设备快、有些设备慢”所指的**动画显示进度**明确区分 |
| 动画/跳过进度 | 存在**视觉节奏差异**：界面可点击快进，设备显示快慢不同；尚未提供截图或操作 seq |
| iPad 首次资源加载 | 相对 Windows 和 Mac **慢**；网络/解码/渲染瓶颈尚未拆分 |
| 断网/网络切换/房主掉线 | **NOT TESTED**，不得标记通过 |
| 对局完整结算/联机续档 | **NOT TESTED**，不得标记通过 |
| 各设备构建号、全字段状态 hash、真实选中 ICE 候选对 | **未提供**；VPS 当前候选发布 `581bef6`，不能反推每台设备的精确运行构建 |

### 关键技术判断（经源码核查）

1. `game/src/ui/party-net.ts` 使用确定性 Lockstep：房主确认并广播操作编号，**每台设备本地运行相同游戏规则**，不是从服务器下发逐帧画面。
2. 独立候选环境目前将 `iceTransportPolicy: relay` 用作默认策略；同 LAN 的三个浏览器也可能仍经 VPS TURN。**现有测试不能证明已使用 LAN 直连**，真实路由由 selected candidate pair 数据判断。
3. `main.ts` 在 `'ask' in s` 的关键决策点执行 `room.answer(seq)`/房主确认，部分动画/页面可本地快进；用户报告的视觉快慢**不应记为状态分叉**。不宜改为每帧等待慢设备。
4. `core/save.ts` 的 `SaveData` 具备完整规则快照；`saves.ts` 的 IndexedDB / JSON 导出属于单机存档基础。现有联机房间的席位、重连令牌与答案日志**没有跨浏览器重开后恢复**的全流程，需引入 `PartySaveEnvelope`、房间新 epoch、身份/席位认领与准备确认，不能直接恢复单机槽位。
5. 浏览器每个 Origin 的 CacheStorage/IndexedDB 不会在设备之间自动共享。iPad 冷加载慢不一定由下载导致，不应无基准就加入 WebRTC 素材 P2P。

## 2. Issues 状态：与 GitHub 实际操作保持一致

| 状态 | Issue | 判定依据 / 剩余责任 |
| --- | --- | --- |
| **Closed · completed** | [#5](https://github.com/sky-tree/rich4-renew-web/issues/5) | 候选发布证据已涵盖构建来源、资源 SHA、运行 symlink、HTTP/鉴权和回滚基线。**实际在线 A→B→A 仍属 #1/#3** |
| **Closed · completed** | [#6](https://github.com/sky-tree/rich4-renew-web/issues/6) | Playwright code-only CI、full-assets UI 读档路径及失败证据分层已落地。**真实设备矩阵仍属 #7** |
| Open | #1–#4 | PWA 安装、线上 SW A→B→A、跨身份/CDN 隔离等原始验收条件未全部满足 |
| Open | [#7](https://github.com/sky-tree/rich4-renew-web/issues/7) | 三设备局域网游戏规则状态一致，但真实完整结算、特殊地图、历史存档和跨设备矩阵未通过 |
| Open | [#8](https://github.com/sky-tree/rich4-renew-web/issues/8) | 原始性能数据已有，但 iPad 冷启动/解码/内存与多次实机采样不足，关联 #15 |
| Open | [#9](https://github.com/sky-tree/rich4-renew-web/issues/9) | WebGL 像素合成/回退已修复；天气、歌舞伎町、复杂场景和实机对照仍缺 |
| Open | [#10](https://github.com/sky-tree/rich4-renew-web/issues/10) | 本次 LAN 三设备稳定 1 小时、**逻辑状态一致**；跨 NAT 长会话、断网恢复、五设备等仍待测 |
| **New · Open** | [#12](https://github.com/sky-tree/rich4-renew-web/issues/12) | 多设备动画/快进进度的可观测性及视觉协调 |
| **New · Open** | [#13](https://github.com/sky-tree/rich4-renew-web/issues/13) | 联机保存 → 全端退出 → 重建房间 → 原席位认领 → 继续游戏 |
| **New · Open** | [#14](https://github.com/sky-tree/rich4-renew-web/issues/14) | LAN WebRTC 直连优先、TURN 回退及候选对统计 |
| **New · Open** | [#15](https://github.com/sky-tree/rich4-renew-web/issues/15) | iPad Pro A12Z 首次加载诊断、关键资源优化 |

> #5、#6 的关闭基于目前**候选分支 PR #11** 中已验证的功能与私有长测部署，**PR 仍为 Draft、`main` 未合并候选功能**。若回归发现关闭项实际失效，应重新打开。不要将结项理解为正式发布批准。

## 3. M11 开发与测试顺序

阶段按前置条件推进，不承诺具体完工日期。**不修改当前受控长测构建的配置来试验未验证的方案**；功能实现先在新隔离分支/候选上验证，PR #11 仍不自动合并。

### A. 先固定回归观测基线（优先，半天～1 个工作单元）

1. 用 Windows + Mac + iPad 重复同 LAN 测试，记录各设备构建号、浏览器版本、所选 WebRTC candidate pair、平均 RTT 和自增 `seq`；脱敏，不发送凭据、存档、第三方图片。
2. 在回合决策点与动画结束点分别打标，重现“一个设备点击跳过，另一个仍在播”的路径；不要求逐帧同步。
3. 开始 #12：把**规则状态一致、视觉进度不同**作为既定观察，不写入“不同步 BUG 已复现”。若真发现同 seq 规则字段不同，再升级 P0。
4. 追加 #10 的单独**断线验收**：10 / 20 / 30 秒断网及恢复、iPad 后台、Wi-Fi↔蜂窝/房主掉线，测试结束均可继续操作且状态一致；也需 1 小时以上 TURN 凭据有效期/续期测试。**本轮未测试，不可提前 PASS**。

### B. P0：联机存档/恢复（#13）

1. 设计 `PartySaveEnvelope` 与版本兼容：同一 `SaveData` + 已确认 seq + 原始人类席位/角色与身份 + hash，禁止分叉状态快照。
2. 安全检查点冻结操作后主机保存，同时存本机副本、可导出 JSON；不改变现有单机槽位/随机数语义。
3. 新建**待恢复房间**（new session epoch），等待原始人数到齐并认领席位；服务器仅承担已有信令/中继，不要求新增存档数据库。
4. 3 台全部关闭网页后重开，从单一可信快照恢复，三方校验同一 hash、恢复原席位并继续至少 20 次操作；涵盖错误身份、少人、重放、旧版协议、重复确认与存档期间断网。
5. 后续可研究房主离线时服务器托管加密快照，但**不属于 P0 MVP**。

### C. P1：iPad 资源性能与可见动画体验（#15 / #12）

1. iPad / Windows / Mac 相同地图冷、热启动各至少 3 轮：分别量化 HTTP 资源、SW 命中、图片 decode、首地图可交互时间以及可测内存。
2. 优先做关键资源/低分辨率预载与小图请求优化、按需地图包和浏览器本地缓存；是否 P2P 共享素材取决于下载是否为真瓶颈、设备性能与授权边界。
3. 对快进操作完善动画排队/追上提示，但**不修改 Lockstep 提交顺序**，不得将最慢端动画结束设为每个回合的全局硬门槛。

### D. P1：LAN 网络实验（#14）

1. 实验开关从当前默认 `relay` 切到允许 host/srflx/relay 的 `all`，获取**实际** candidate pair；每设备至少 3 次 A/B。
2. 直连不可用时保持 TURN 回退，保证此前公网用户回归通过。
3. 未达指标则关闭实验，继续使用现有受控 TURN；不要让 LAN 优化阻塞联机存档或现有稳定长测。

## 4. 下一阶段放行条件

- **基础联机**：同 LAN 3 台持续 1 小时，关键 `seq` 的状态一致，视觉动画可不同步但不可误推进/越过规则。
- **续档 MVP**：3 人局内保存，**三人全部退出、重新开页、相同角色/席位认领并继续 20 操作**，内容与 RNG 哈希一致。
- **断线恢复**：20 秒中断后的同局继续和长期 TURN 凭据过期后新连接/重连均已验证；不能用“长测 1 小时但无断线”代替。
- **资源性能**：iPad 首次加载的网络/解码/首帧耗时可复验，优化有效且游戏画面正确。
- **发布治理**：#1–#4、#7–#10 及新 Issues 分别按**原始范围**关闭，PR #11 未经复审不合并，`main` 和原 `/rich4/` 保持不变。
