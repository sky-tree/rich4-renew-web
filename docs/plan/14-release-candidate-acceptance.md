# 14 · 发布候选版验收记录

> 执行窗口：2026-10-21～22（Asia/Shanghai）。已授权完整候选版验收及独立测试环境。结论：仍在受控验收中，未达到扩大内测或全部 Issues 关闭的条件。

## 发布与环境

| 项目 | 记录 |
| --- | --- |
| 源码分支 | `codex/release-candidate-acceptance` |
| 审核入口 | [草稿 PR #11](https://github.com/sky-tree/rich4-renew-web/pull/11)，保持未合并 |
| 单机/部署修复基线 | `7d72a63` |
| 当前候选源码 | `0a1ed20`，含默认中继、准确入房错误、静默恢复与图片重试 |
| 候选 URL | https://rich4-staging.gopeaks.club/ |
| 普通验收入口（默认中继） | https://rich4-staging.gopeaks.club/?rc=0a1ed20 |
| 服务器 | 既有 DevSpace VPS `216.23.82.22`，`ssh gopeaks` 登录 deploy，通过 sudo 使用 devspace |
| 候选活动链接 | `/srv/devspace/repos/rich4-runtime/rich4-staging` → `rich4-staging-releases/0a1ed20` |
| 既有版本 | `/srv/devspace/repos/rich4-runtime/rich4` 仍指向 `rich4-releases/66cf0b3`，原路由未修改 |
| 进程 | `rich4-staging.service`、`rich4-staging-party.service`、`rich4-staging-turn.service`，均由 systemd 管理 |

候选使用独立 Origin、根路径构建与 SW `/` 作用域，和既有 `/rich4/` 的 IndexedDB、LocalStorage、SW 分离。TLS 使用该子域名独立证书。`f7e8528` 在切换前校验 217 个代码/壳文件及 36,109 个素材的字节摘要；素材从既有私有目录创建独立硬链接，清除候选副本中的 AppleDouble 元数据，不修改既有文件内容。

本地构建使用 Node 25.9.0；VPS 既有运行时为 Node 24.21.0；CI 固定 Node 22；`f7e8528` 的 [Node 22.23.3 CI](https://github.com/sky-tree/rich4-renew-web/actions/runs/39639998311) 通过，165 项单测通过 / 381 项素材相关跳过，6 项浏览器冒烟通过；另含真实 Nginx 和会话签名测试。远端 CI 不含私有素材、真实设备或 staging 凭据，不能替代完整素材/跨网验收。

## 五项清单

1. **部署与安全：部分通过。** 本地三份真实 Nginx 配置测试通过；线上 HTTPS 授权首页/素材 200、匿名及错误身份 401、缺失素材 404、Manifest MIME、公开图标、SW no-store 与 scope 已实际核查。Cloudflare 受限素材未观察到 HIT。仅一个有效测试账号，未核查 Cloudflare 控制台规则或完成真实双账号矩阵。A→B→A 的 SW/UI 存档测试在本地独立 Nginx 完成；线上只切换候选目录，未在用户正在测试时回滚。
2. **真正游戏 E2E：限定通过。** UI 手动/自然自动档恢复、全字段相等、继续掷骰通过；台湾 2P 一月游戏由 UI 托管自然结算，动画时钟加速，未改规则。不是四人/所有地图/历史正式存档/全设备验收。
3. **WebGL 合成和回退：限定通过。** 透明 HUD 缓冲、真实像素合成、创建失败及上下文丢失后原 Canvas 回退均有 Chromium 桌面/移动视口测试。复杂天气和特殊地图仍待验。
4. **正式构建性能：本地证据已补。** 源站真实 HTTP 字节覆盖 SW 后台流量；同存档配对 300 个 rAF 记录及 JS 堆样本已保留。实机、受控网络、GPU/进程峰值及长局性能未测，见 [S3](13-s3-benchmark-report.md)。
5. **跨网络多人：部分通过。** 用户家宽电脑＋移动数据手机实测 `7d72a63`：可进入房间界面，但成员/聊天未同步，判定 FAIL。已复现、修复并部署 `a5f27de`；用户在强制中继入口复测，确认双方均显示两位成员、聊天互通。另有同一 Mac 上的双浏览器成员/聊天、远端 TURN 强制中继 20 条消息往返测试通过。后续用户报告日期/资源一致，但手机缺图、弱网延迟、断网无法恢复、反复要求登录，不能判定此项通过。对应修复及复测见下节。最新 `0a1ed20` 普通入口三设备实体入房、全员聊天、只有玩家开局及合计至少 20 次掷骰已获用户确认通过，日期/资金一致且未报告“不同步”；五设备实体对局、完整长局及弱网等更广矩阵仍未完成。

## 入房缺陷及验证

PeerJS BinaryPack 将显式 `prev: undefined` 编码为 `null`，房主验证器据此拒收首次 `hi`；原客人界面只等待 DataChannel open，造成看似已加入。修复省略缺失字段，等待包含自身的房主成员列表后再确认加入；未收到确认则失败并关闭连接。真实编码器单测覆盖首次入房与未确认超时。部署前双浏览器重现房主仅 1 人；部署后双方均为 2 人且聊天互通。

2026-10-22 用户跨网络复测原话：“双方都能看到两人，聊天互通”。环境为电脑家宽、手机移动数据，使用 `?relay=1&rc=a5f27de`；设备为 macOS Chrome（家宽）与 iOS Safari（移动数据），具体版本未记录。尚无真实设备候选对统计，因此此项是用户可见行为通过，不能代替 TURN 路径统计或状态逐字段一致性证明。无“不同步”提示也不能单独证明摘要已匹配：`a5f27de` 对迟到摘要没有重新比较；`f7e8528` 已增加双向到达顺序比较和回调，回归单测通过，哈希字段范围仍有限。

`a5f27de` 和 `f7e8528` 均已完成 8 项 Chromium 浏览器测试（桌面/移动视口各 4 项）：手动档、自然自动档的 UI 恢复与继续掷骰，以及 WebGL 像素合成、创建失败和上下文丢失回退。移动视口是浏览器模拟，不是真机。

## 手机实测反馈与修复（2026-10-22）

用户提供四张私有截图：手机横/竖屏缺建筑与设施，ATM 大部分图片缺失；电脑同局有这些图像。截图未提交。用户报告双方日期、资源一致，但手机弱网有延迟，断网后无法恢复，几乎每次操作都要求用户名密码。未据此声称已完成 20 个完整轮次。

- **登录与图片**：`a7ec99b` 改用现有账号的登录表单和签名会话（8 小时、HttpOnly/Secure/SameSite=Lax、Host-only），已部署。Nginx `auth_request` 仍保护私有素材/API/WSS，匿名或篡改 cookie 返回 401，不发送 Basic challenge。线上登录、受保护资源、无效会话、公开 bundle 不设 cookie 检查通过。`a5f27de` 和 `f7e8528` 的 WebKit 27.2 / iPhone 模拟中可加载可见建筑及 ATM 全部图片，430×750 与 932×305 控件边界通过；须等旋转后的 ResizeObserver 布局稳定。`f7e8528` 的移动 Chromium 也通过同项测试。该结果不能替代实体 Safari 复测或慢网恢复证明。
- **断线座位**：`a5f27de` 同一 Peer ID 重连时先复制再删除座位映射，误删自身座位；成员数恢复后房主仍拒绝该玩家操作。`f7e8528` 只在 ID 改变时移动映射。真实握手及继续答题单测先失败后通过，另覆盖 ID 改变场景。
- **一致性**：增加迟到摘要比较回归；546 项单测、应用与 E2E 类型检查通过。`f7e8528` 双 Chromium 客户端经远端 TURN、UI 托管推进超过 20 天，初始/断开前/重连后/继续推进检查点的全部 SaveData 字段（仅忽略 savedAt）一致；关闭真实 RTCPeerConnection 后成功建立新连接并继续游戏，测试通过。动画时钟加速；这是同一 Mac 的连接替换，不是两条物理网络的 10 秒中断，实体恢复仍需复测。

另补跑 WebKit UI 存档：自动档通过；手动档初次在完成恢复/继续操作后，因刷新期间后台机器人动画请求的 access-control 错误未通过 clean-boot 断言。诊断重跑通过，只观察到刷新取消请求；间歇性预加载/导航错误未完全排除，不能将 WebKit 存档标为稳定通过，见 [记录](evidence/2026-10-21-rc/webkit-save-f7e8528.json)。

用户随后使用 `?relay=1&rc=f7e8528` 入口复测（当时首页不含构建编号，实际运行版本未核实）：电脑始终停在邀请码界面，未短暂出现第二位成员；手机无法加入，提示房主未确认，**该次实体跨网入房为 FAIL**。用户确认新版不再持续弹出用户名密码窗口；缺图及实际断网恢复因无法入房尚未复验。同一 Mac 的 Chromium 房主与独立 iPhone WebKit 客人经远端强制中继可达到 2/2 成员及双向聊天，但不能替代该实体失败。

用户要求优先区分缓存版本：`78d7fc9` 将 Git 编号编译进 JS，首页显示 `v0.6.6 · 78d7fc9`，不会使用服务器清单覆盖正在运行的编号。首页以 `no-store` 查询发布清单，发现不同编号后提供手动刷新；不自动中断对局或清除存档。中继预检查现在必须实际收集到 relay candidate 才允许强制中继模式通过，避免仅 STUN 可用时误报。Node 22.23.4 下 62 文件 / 548 单测与两份类型检查通过；发布前校验 217 个壳文件及 36,109 个素材。

2026-10-22 用户在 `?rc=78d7fc9` 复测，明确确认：“两端编号一致，入房和聊天成功”。因此该候选的实体跨网自动连接入房及双向聊天通过。本次没有 `relay=1`，也未取得候选对统计，不能判定实际使用直连或 TURN；旧失败与本次成功同时改变了版本核实和连接策略，不能把旧失败归因于缓存。

随后同版本实体复测 **FAIL**：手机仍缺素材；断网 20 秒恢复后，手机等待电脑、电脑等待手机。用户报告断网前日期、资金一致，未确认至少 20 次掷骰。私有截图显示侧栏、日历和对话框破图，截图时刻未核实同步。见 [实体反馈](evidence/2026-10-21-rc/physical-mobile-78d7fc9.json)。旧版在自动 ICE 下保持通道开启、仅丢弃客人出站消息 20 秒，复现互相等待及状态分歧；此前主动关闭连接的测试未覆盖该故障。该诊断只要求 1 天，不能记为 20 天验收，见 [修复前证据](evidence/2026-10-21-rc/party-silent-outage-before-78d7fc9.json)。同次强制中继诊断在入房阶段失败，未进入断网步骤；此路径仍待排查。

`cf587f4` 新增修复：客人答案等待房主确认才写入回放并推进规则，重连重发未确认答案，重复包返回已提交答案；同一题多个等待者共享结果。每 3 秒心跳、15 秒无入站数据关闭旧通道并走现有重连，网络恢复时重建路径，旧通道尚未清理可重试。运行时配置刷新失败不会终止重连循环。图片增加有限重试，精灵加载失败不再永久缓存为空；本地 Chromium/WebKit 6 项图片测试通过。线上旧版 WebKit 未复现实体缺图，故图片根因及实机修复效果仍未确认。Node 22.23.4 下 65 文件 / 557 单测和应用、E2E 类型检查通过；[CI](https://github.com/sky-tree/rich4-renew-web/actions/runs/39717218728) 通过。独立候选切换前校验 217 壳文件及 36,109 素材，原生产链接仍为 `66cf0b3`。

`cf587f4` 线上 Chrome/WebKit 共 12 项版本及图片检查通过，包含真实 SW 侧栏加载与注入破图后的恢复，见 [图片恢复记录](evidence/2026-10-21-rc/mobile-recovery-cf587f4.json)。游戏断网专项多次在入房阶段失败，未执行故障注入，不能判定修复后恢复通过。独立大厅成员/聊天测试通过；不包装 WebRTC 的同流程开局对照也曾失败，因此不能归因于测试插桩。浏览器记录 ICE 486（分配配额不足）；候选 TURN 用户/总配额从 4/16 调为 16/32，带宽和 UDP 端口范围未改、保留私有回滚配置，但随后仍出现 486 和入房失败，不能标为已解决，见 [中继诊断](evidence/2026-10-21-rc/turn-quota-cf587f4.json)。

另确认首页大厅异步关闭竞态：离开首页时仍在建立的 Peer、连接或共享大厅持有者可在关闭后留下。新增回归先复现两个泄漏，修复在每个等待阶段后检查关闭状态并销毁迟到资源，三项生命周期测试通过。生命周期泄漏已单独验证；其对实体入房及配额故障的因果影响尚未隔离。`a128f6a` 在 Node 22.23.4 下 66 文件 / 560 单测及两份类型检查通过，[CI](https://github.com/sky-tree/rich4-renew-web/actions/runs/39720530875) 通过。用户已确认首页为 `a128f6a`；实体复测结果见下文。

进一步在 `a128f6a` 核对：两端编译编号一致，客人 OFFER 到达正确房间，仍在入房前出现 ICE 486。直接进行单次认证 TURN Allocate，取得标准原因 **Allocation Bandwidth Quota Reached**。coturn 4.6.1 对每个分配预留 `max-bps`；原每分配 1,048,576 B/s、总容量 8,388,608 B/s，只能容纳约 8 个分配，调整连接数配额不能解除该限制。现将每分配上限降为 262,144 B/s，保留总容量、16/32 用户/总配额与端口限制，仅重启候选 TURN，保留私有回滚配置。应用仍固定 `a128f6a`。修正后独立强制中继 20 条消息往返通过、双端均 relay/relay、无 ICE 错误；凭据每次请求唯一且不缓存。此结果不是实体断网验收，见 [带宽配额记录](evidence/2026-10-21-rc/turn-bandwidth-a128f6a.json)。

联机游戏测试改用真实时钟：加速页面时钟也会加速 15 秒静默检测，使正常 TURN 延迟被误判为断线；不能把该运行当成修复后断网证据。真实时钟、强制中继的 1 天诊断已通过：初始、连接替换后、继续操作、20 秒消息黑洞后及再继续操作六个检查点完整存档一致，最终推进至第 8 天，双端无 ICE 错误，见 [短程恢复证据](evidence/2026-10-21-rc/party-recovery-diagnostic-a128f6a.json)。该运行的要求是 1 天，不作为 20 天通过证明。另执行独立 **至少 20 天真实时钟强制中继测试通过**：第 21 天连接替换后继续至第 23 天，第 24 天消息黑洞恢复后再继续至第 26 天，六个完整状态检查点相等，双端无 ICE 错误，见 [20 天恢复证据](evidence/2026-10-21-rc/party-recovery-20-days-a128f6a.json)。

用户在 `a128f6a` 实体复测报告：可入房、双向聊天，手机本次素材正常，断网后可重连回房间并恢复游戏；本次使用网络较好的 **5GA**，不能推定弱网稳定通过。提问要求断网 20 秒，回复未重述精确时长，也没有实体候选对统计；实际连接策略及测试相对 TURN 配额修正的时序未核实。同次新增失败：第二台电脑使用公共网络，在已有两台设备时无法加入；用户进一步明确：两台原设备停留在邀请码候房界面，第三台提示“房主未确认”；属于开局前失败，不能按开局后拒收新玩家解释，三设备实体验收为 FAIL。见 [当前实体反馈](evidence/2026-10-21-rc/physical-mobile-a128f6a.json)。补跑同一 Mac 三 Chromium 页面、强制中继配置候房对照通过：三端均显示 3 位成员，逐端发送聊天均可互见，见 [三客户端候房](evidence/2026-10-21-rc/party-three-client-lobby-a128f6a.json)。此项未复现公共网络，未验证三人开局；当前设计最多 8 人候房，开局后仅允许持有原座位 token 的玩家重连。

随后同版本五 Chromium 客户端候房/全员聊天对照也通过，五端均显示 5 位成员，见 [五客户端候房](evidence/2026-10-21-rc/party-five-client-lobby-a128f6a.json)。这些测试没有复现公共网络，不能推定实体问题已修复。用户随后在第三台公共网络电脑、同版本 `a128f6a`、`?relay=1` 入口确认“能加入”。三设备实体候房入房在该路径限定通过；全员聊天、三人开局和状态一致仍未确认。该对照支持连接策略与故障有关，尚未取得实体 ICE 统计，不能进一步断言具体 NAT 或防火墙机制。

排查发现旧版错误文案把未建立 DataChannel、找不到房间、房主明确拒绝都改写为“房主尚未确认加入”。新增回归先复现三种误报，现已在源码中保留实际拒绝原因，并区分网络连接失败与真正的加入确认超时；4 项专项、全量 67 文件 / 564 单测及应用类型检查通过。此文案修正在 `fa3760c` 完成，未单独部署，现随 `0a1ed20` 发布；不将文案修正本身当作公共网络连接修复。

`78d7fc9` 的 [CI](https://github.com/sky-tree/rich4-renew-web/actions/runs/39703675343) 通过。线上 Chrome / iPhone WebKit 模拟共 6 项版本专项检查通过：显示编号与真实发布清单一致、手机横竖屏边界、新版提示及手动刷新、清单不可用时保留编号；刷新后合成本地存储标记仍在。真实版本检查保留 SW；模拟清单响应测试单独禁用 SW，以避免 WebKit 绕过 Playwright 路由（初次因此失败，诊断确认模拟路由调用次数为 0）。这不是实际发布 A→B 的线上 SW 更新或存档兼容性证明。

会话为无服务端状态的签名 token；修改密码不会立即撤销已签发会话，最长保留 8 小时。轮换签名密钥会同时撤销会话并影响 TURN，需受控操作。私有账号及 cookie 仅在内存使用，不写入测试报告。

`0a1ed20` 已将受控 staging 的 `/api/party-config` 默认设为 `iceTransportPolicy: relay`，普通入口无需手动 `relay=1`；保留短效凭据、现有端口和带宽上限。原生产路由不接入该 staging API。源码网络检查显示“已使用轉送伺服器聯機”，不把策略强制中继误称为网络只能中继。运行时配置回归先失败后通过；4 项运行时/会话、67 文件 / 564 单测及两份类型检查通过。发布校验 217 壳文件及 36,109 素材摘要通过，[CI](https://github.com/sky-tree/rich4-renew-web/actions/runs/39731091072) 通过。候选联机配置源码摘要与提交一致，原生产仍为 `66cf0b3`。不带 `relay=1` 的普通入口，三及五 Chromium 客户端候房/全员聊天通过；所有实际连接配置均为 relay、选中候选对均 relay/relay，未记录 ICE 错误。首次统计断言错误纳入 PeerJS 临时能力探测的默认 all 策略，测试未通过；修正为检查实际 connected 连接并单列探测策略后通过，失败与修正均保留。见 [普通入口中继证据](evidence/2026-10-21-rc/default-relay-0a1ed20.json)。另在普通入口完成至少 20 天真实时钟游戏恢复：第 21 天连接替换，第 23 天继续，第 24 天消息黑洞恢复，再继续至第 26 天；六个完整 SaveData 检查点一致，双端无 ICE 错误，见 [普通入口游戏恢复](evidence/2026-10-21-rc/party-game-default-0a1ed20.json)。

用户随后回复“测试通过”，确认本次限定范围：三台设备关闭旧页面、核对 `v0.6.6 · 0a1ed20`，经普通入口入房、均看到 3 位成员并互通聊天；房主选择“只有玩家”开局，合计至少 20 次掷骰后日期/资金一致，未报告“不同步”。设备网络沿用此前识别的家宽 macOS Chrome、移动数据 iOS Safari、公共网络第二台电脑，第三台系统/浏览器未提供。此为用户报告的三设备实体行为通过，没有实体 ICE 统计或完整存档逐字段比较；本次未要求重新断网，也不能据此判定五设备、完整对局、弱网或长局 TURN 续期通过。见 [三设备实体验收](evidence/2026-10-21-rc/physical-three-device-0a1ed20.json)。候选继续固定 `0a1ed20`，草稿 PR 和剩余验收项保持开放。

## 联机设施与私有配置

- PeerServer 1.0.2 依赖由 `deploy/party-runtime/package-lock.json` 锁定，绑定 `127.0.0.1:18183`，经 staging 会话鉴权与 WSS 代理，关闭公开发现接口。
- `/api/party-config` 由回环 18182 服务生成，会话鉴权保护、`private, no-store`；客户端只在内存保存一小时 TURN 凭据，近到期在新建 Peer 前刷新；既有 Peer 在长局重连时的配置更新仍待验，不写入存档或 LocalStorage。
- 签名密钥及 coturn 配置分别在私有 `state/turn-staging.env`、`state/turn-staging.conf`，权限 600，未进入 Git、前端代码或证据日志。
- 配额维护：`max-bps × total-quota ≤ bps-capacity` 才能容纳设定的最大并发分配；每台设备/房间可建立多个分配，不能将分配数当玩家数。当前 262,144 × 32 = 8,388,608 B/s。
- TURN 使用 UDP/TCP 3478；UDP 中继分配范围 49160–49200；有总分配/用户/带宽上限，禁止内网/回环/组播目标，关闭匿名 CLI 和 TCP relay allocation。测试只用了 UDP/TCP TURN，尚无 TURN TLS/受限企业网验证。
- 系统默认 coturn 服务已禁用/屏蔽，仅启用隔离的 `rich4-staging-turn.service`。

## 证据与复现

原始 JSON 在 [evidence/2026-10-21-rc](evidence/2026-10-21-rc/)；新增 [完整状态及重连](evidence/2026-10-21-rc/party-gameplay-f7e8528.json)、[WebKit 图片/布局](evidence/2026-10-21-rc/mobile-assets-webkit-f7e8528.json)、[会话鉴权](evidence/2026-10-21-rc/staging-session-f7e8528.json) 和 [实体反馈](evidence/2026-10-21-rc/cross-network-user-mobile-feedback.json)。仅保留合成测试状态、公开构建信息、脱敏路径/字节、帧间隔和验证结果。私有素材截图、trace、录屏留在本地，未提交。

从 `game/` 执行常规 `npm test`、两份严格 TypeScript 检查、先构建再运行 Playwright。独立选项：

```sh
npm run test:nginx
npm run test:e2e:full
npm run test:e2e:renderer
npm run test:e2e:complete
npm run test:e2e:release
```

真实私有环境需要显式启用，认证只经 SSH 读入内存，禁用 trace/video/HTML/JSON reporter：

```sh
E2E_STAGING_AUTH=1 E2E_PARTY=1 E2E_SKIP_SERVER=1 \
E2E_BASE_URL=https://rich4-staging.gopeaks.club/ \
npx playwright test tests/e2e/party-lobby.spec.ts tests/e2e/turn-relay.spec.ts \
  --project=desktop-chrome --reporter=list

# 默认策略候房验证（不附加 relay 参数）；仍需上述私有环境认证变量
E2E_PARTY=1 E2E_PARTY_CLIENTS=3 E2E_FORCE_RELAY=0 \
  npx playwright test tests/e2e/party-lobby.spec.ts --project=desktop-chrome --reporter=list
```

本地发布回滚测试使用生成的不同 A/B 入口，不是历史正式包兼容性的证明。线上回滚保留 `a5f27de` 和 `7d72a63` 目录，需要在受控窗口原子切回 staging 链接，并重新验证 SW、清单、素材和 UI 存档；回滚也不应触碰既有生产链接。`0a1ed20` 的受控回滚还需从私有 `control/party-runtime-before-default-relay-0a1ed20` 恢复联机配置，并只重启候选 party 服务；应用链接可切回 `a128f6a`。已证实的 TURN 带宽容量修正独立保留。停止候选服务或删除 staging hostname 路由可撤销独立入口；若停止联机设施，还需撤销本次三条 UFW 规则，保留私有密钥文件直到受控清理。

新增专项复测（认证与素材使用上述私有环境开关）：

```sh
E2E_PARTY_GAME=1 E2E_NETWORK_BLACKHOLE=1 E2E_FORCE_RELAY=0 \
npx playwright test tests/e2e/party-gameplay.spec.ts --project=desktop-chrome
E2E_WEBKIT=1 E2E_REMOTE_ASSETS=1 npx playwright test tests/e2e/mobile-assets.spec.ts --project=ios-webkit
```

联机测试默认至少 20 天；`E2E_PARTY_DAYS=1` 仅用于诊断，不能作为 20 天通过证据。ATM 测试直接调用该界面来检查图片和布局，不证明自然走到银行的完整交易流程。
