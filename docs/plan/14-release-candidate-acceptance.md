# 14 · 发布候选版验收记录

> 执行窗口：2026-10-21～22（Asia/Shanghai）。已授权完整候选版验收及独立测试环境。结论：仍在受控验收中，未达到扩大内测或全部 Issues 关闭的条件。

## 发布与环境

| 项目 | 记录 |
| --- | --- |
| 源码分支 | `codex/release-candidate-acceptance` |
| 审核入口 | [草稿 PR #11](https://github.com/sky-tree/rich4-renew-web/pull/11)，保持未合并 |
| 单机/部署修复基线 | `7d72a63` |
| 当前候选源码 | `f7e8528`，修复同 ID 重连座位和迟到摘要；会话鉴权为 `a7ec99b` |
| 候选 URL | https://rich4-staging.gopeaks.club/ |
| 强制中继验收入口 | https://rich4-staging.gopeaks.club/?relay=1&rc=f7e8528 |
| 服务器 | 既有 DevSpace VPS `216.23.82.22`，`ssh gopeaks` 登录 deploy，通过 sudo 使用 devspace |
| 候选活动链接 | `/srv/devspace/repos/rich4-runtime/rich4-staging` → `rich4-staging-releases/f7e8528` |
| 既有版本 | `/srv/devspace/repos/rich4-runtime/rich4` 仍指向 `rich4-releases/66cf0b3`，原路由未修改 |
| 进程 | `rich4-staging.service`、`rich4-staging-party.service`、`rich4-staging-turn.service`，均由 systemd 管理 |

候选使用独立 Origin、根路径构建与 SW `/` 作用域，和既有 `/rich4/` 的 IndexedDB、LocalStorage、SW 分离。TLS 使用该子域名独立证书。`f7e8528` 在切换前校验 217 个代码/壳文件及 36,109 个素材的字节摘要；素材从既有私有目录创建独立硬链接，清除候选副本中的 AppleDouble 元数据，不修改既有文件内容。

本地构建使用 Node 25.9.0；VPS 既有运行时为 Node 24.21.0；CI 固定 Node 22；`f7e8528` 的 [Node 22.23.3 CI](https://github.com/sky-tree/rich4-renew-web/actions/runs/39639998311) 通过，165 项单测通过 / 381 项素材相关跳过，6 项浏览器冒烟通过；另含真实 Nginx 和会话签名测试。远端 CI 不含私有素材、真实设备或 staging 凭据，不能替代完整素材/跨网验收。

## 五项清单

1. **部署与安全：部分通过。** 本地三份真实 Nginx 配置测试通过；线上 HTTPS 授权首页/素材 200、匿名及错误身份 401、缺失素材 404、Manifest MIME、公开图标、SW no-store 与 scope 已实际核查。Cloudflare 受限素材未观察到 HIT。仅一个有效测试账号，未核查 Cloudflare 控制台规则或完成真实双账号矩阵。A→B→A 的 SW/UI 存档测试在本地独立 Nginx 完成；线上只切换候选目录，未在用户正在测试时回滚。
2. **真正游戏 E2E：限定通过。** UI 手动/自然自动档恢复、全字段相等、继续掷骰通过；台湾 2P 一月游戏由 UI 托管自然结算，动画时钟加速，未改规则。不是四人/所有地图/历史正式存档/全设备验收。
3. **WebGL 合成和回退：限定通过。** 透明 HUD 缓冲、真实像素合成、创建失败及上下文丢失后原 Canvas 回退均有 Chromium 桌面/移动视口测试。复杂天气和特殊地图仍待验。
4. **正式构建性能：本地证据已补。** 源站真实 HTTP 字节覆盖 SW 后台流量；同存档配对 300 个 rAF 记录及 JS 堆样本已保留。实机、受控网络、GPU/进程峰值及长局性能未测，见 [S3](13-s3-benchmark-report.md)。
5. **跨网络多人：部分通过。** 用户家宽电脑＋移动数据手机实测 `7d72a63`：可进入房间界面，但成员/聊天未同步，判定 FAIL。已复现、修复并部署 `a5f27de`；用户在强制中继入口复测，确认双方均显示两位成员、聊天互通。另有同一 Mac 上的双浏览器成员/聊天、远端 TURN 强制中继 20 条消息往返测试通过。后续用户报告日期/资源一致，但手机缺图、弱网延迟、断网无法恢复、反复要求登录，不能判定此项通过。对应修复及复测见下节；3–5 人内测仍未执行。

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

会话为无服务端状态的签名 token；修改密码不会立即撤销已签发会话，最长保留 8 小时。轮换签名密钥会同时撤销会话并影响 TURN，需受控操作。私有账号及 cookie 仅在内存使用，不写入测试报告。

## 联机设施与私有配置

- PeerServer 1.0.2 依赖由 `deploy/party-runtime/package-lock.json` 锁定，绑定 `127.0.0.1:18183`，经 staging 会话鉴权与 WSS 代理，关闭公开发现接口。
- `/api/party-config` 由回环 18182 服务生成，会话鉴权保护、`private, no-store`；客户端只在内存保存一小时 TURN 凭据，近到期在新建 Peer 前刷新；既有 Peer 在长局重连时的配置更新仍待验，不写入存档或 LocalStorage。
- 签名密钥及 coturn 配置分别在私有 `state/turn-staging.env`、`state/turn-staging.conf`，权限 600，未进入 Git、前端代码或证据日志。
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
```

本地发布回滚测试使用生成的不同 A/B 入口，不是历史正式包兼容性的证明。线上回滚保留 `a5f27de` 和 `7d72a63` 目录，需要在受控窗口原子切回 staging 链接，并重新验证 SW、清单、素材和 UI 存档；回滚也不应触碰既有生产链接。停止候选服务或删除 staging hostname 路由可撤销独立入口；若停止联机设施，还需撤销本次三条 UFW 规则，保留私有密钥文件直到受控清理。


新增专项复测（认证与素材使用上述私有环境开关）：

```sh
E2E_PARTY_GAME=1 npx playwright test tests/e2e/party-gameplay.spec.ts --project=desktop-chrome
E2E_WEBKIT=1 E2E_REMOTE_ASSETS=1 npx playwright test tests/e2e/mobile-assets.spec.ts --project=ios-webkit
```

联机测试默认至少 20 天；`E2E_PARTY_DAYS=1` 仅用于诊断，不能作为 20 天通过证据。ATM 测试直接调用该界面来检查图片和布局，不证明自然走到银行的完整交易流程。
