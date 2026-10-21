# 14 · 发布候选版验收记录

> 执行窗口：2026-10-21～22（Asia/Shanghai）。已授权完整候选版验收及独立测试环境。结论：仍在受控验收中，未达到扩大内测或全部 Issues 关闭的条件。

## 发布与环境

| 项目 | 记录 |
| --- | --- |
| 源码分支 | `codex/release-candidate-acceptance` |
| 审核入口 | [草稿 PR #11](https://github.com/sky-tree/rich4-renew-web/pull/11)，保持未合并 |
| 单机/部署修复基线 | `7d72a63` |
| 当前候选源码 | `a5f27de`，修复首次入房握手并接入受控信令/短效 TURN |
| 候选 URL | https://rich4-staging.gopeaks.club/ |
| 强制中继验收入口 | https://rich4-staging.gopeaks.club/?relay=1&rc=a5f27de |
| 服务器 | 既有 DevSpace VPS `216.23.82.22`，`ssh gopeaks` 登录 deploy，通过 sudo 使用 devspace |
| 候选活动链接 | `/srv/devspace/repos/rich4-runtime/rich4-staging` → `rich4-staging-releases/a5f27de` |
| 既有版本 | `/srv/devspace/repos/rich4-runtime/rich4` 仍指向 `rich4-releases/66cf0b3`，原路由未修改 |
| 进程 | `rich4-staging.service`、`rich4-staging-party.service`、`rich4-staging-turn.service`，均由 systemd 管理 |

候选使用独立 Origin、根路径构建与 SW `/` 作用域，和既有 `/rich4/` 的 IndexedDB、LocalStorage、SW 分离。TLS 使用该子域名独立证书。每版在切换前校验 217 个代码/壳文件及 36,109 个素材的字节摘要；素材从既有私有目录创建独立硬链接，清除候选副本中的 AppleDouble 元数据，不修改既有文件内容。

本地构建使用 Node 25.9.0；VPS 既有运行时为 Node 24.21.0；CI 固定 Node 22，远端检查结果见草稿 PR #11。远端 CI 不含私有素材、真实设备或 staging 凭据，不能替代完整素材/跨网验收。

## 五项清单

1. **部署与安全：部分通过。** 本地三份真实 Nginx 配置测试通过；线上 HTTPS 授权首页/素材 200、匿名及错误身份 401、缺失素材 404、Manifest MIME、公开图标、SW no-store 与 scope 已实际核查。Cloudflare 受限素材未观察到 HIT。仅一个有效测试账号，未核查 Cloudflare 控制台规则或完成真实双账号矩阵。A→B→A 的 SW/UI 存档测试在本地独立 Nginx 完成；线上只切换候选目录，未在用户正在测试时回滚。
2. **真正游戏 E2E：限定通过。** UI 手动/自然自动档恢复、全字段相等、继续掷骰通过；台湾 2P 一月游戏由 UI 托管自然结算，动画时钟加速，未改规则。不是四人/所有地图/历史正式存档/全设备验收。
3. **WebGL 合成和回退：限定通过。** 透明 HUD 缓冲、真实像素合成、创建失败及上下文丢失后原 Canvas 回退均有 Chromium 桌面/移动视口测试。复杂天气和特殊地图仍待验。
4. **正式构建性能：本地证据已补。** 源站真实 HTTP 字节覆盖 SW 后台流量；同存档配对 300 个 rAF 记录及 JS 堆样本已保留。实机、受控网络、GPU/进程峰值及长局性能未测，见 [S3](13-s3-benchmark-report.md)。
5. **跨网络多人：部分通过。** 用户家宽电脑＋移动数据手机实测 `7d72a63`：可进入房间界面，但成员/聊天未同步，判定 FAIL。已复现、修复并部署 `a5f27de`；用户在强制中继入口复测，确认双方均显示两位成员、聊天互通。另有同一 Mac 上的双浏览器成员/聊天、远端 TURN 强制中继 20 条消息往返测试通过。长局、断线恢复、逐状态摘要及 3–5 人内测仍待验收；当前请用户执行至少 20 次掷骰，这不等于 20 个完整轮次。

## 入房缺陷及验证

PeerJS BinaryPack 将显式 `prev: undefined` 编码为 `null`，房主验证器据此拒收首次 `hi`；原客人界面只等待 DataChannel open，造成看似已加入。修复省略缺失字段，等待包含自身的房主成员列表后再确认加入；未收到确认则失败并关闭连接。真实编码器单测覆盖首次入房与未确认超时。部署前双浏览器重现房主仅 1 人；部署后双方均为 2 人且聊天互通。

2026-10-22 用户跨网络复测原话：“双方都能看到两人，聊天互通”。环境为电脑家宽、手机移动数据，使用 `?relay=1&rc=a5f27de`；系统和浏览器版本尚未回报。尚无真实设备候选对统计，因此此项是用户可见行为通过，不能代替 TURN 路径统计或状态逐字段一致性证明。无“不同步”提示也不能单独证明摘要已匹配：现有代码在对端摘要尚未到达时返回通过，未重新比较迟到摘要。

同一线上候选已完成 8 项 Chromium 浏览器测试（桌面/移动视口各 4 项）：手动档、自然自动档的 UI 恢复与继续掷骰，以及 WebGL 像素合成、创建失败和上下文丢失回退。移动视口是浏览器模拟，不是真机。

## 联机设施与私有配置

- PeerServer 1.0.2 依赖由 `deploy/party-runtime/package-lock.json` 锁定，绑定 `127.0.0.1:18183`，经 staging Basic Auth 与 WSS 代理，关闭公开发现接口。
- `/api/party-config` 由回环 18182 服务生成，Basic Auth 保护、`private, no-store`；客户端只在内存保存一小时 TURN 凭据，近到期在新建连接前刷新，不写入存档或 LocalStorage。
- 签名密钥及 coturn 配置分别在私有 `state/turn-staging.env`、`state/turn-staging.conf`，权限 600，未进入 Git、前端代码或证据日志。
- TURN 使用 UDP/TCP 3478；UDP 中继分配范围 49160–49200；有总分配/用户/带宽上限，禁止内网/回环/组播目标，关闭匿名 CLI 和 TCP relay allocation。测试只用了 UDP/TCP TURN，尚无 TURN TLS/受限企业网验证。
- 系统默认 coturn 服务已禁用/屏蔽，仅启用隔离的 `rich4-staging-turn.service`。

## 证据与复现

原始 JSON 在 [evidence/2026-10-21-rc](evidence/2026-10-21-rc/)；仅保留合成测试状态、公开构建信息、脱敏路径/字节、帧间隔和验证结果。私有素材截图、trace、录屏留在本地，未提交。

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

本地发布回滚测试使用生成的不同 A/B 入口，不是历史正式包兼容性的证明。线上回滚保留 `7d72a63` 目录，需要在受控窗口原子切回 staging 链接，并重新验证 SW、清单、素材和 UI 存档；回滚也不应触碰既有生产链接。停止候选服务或删除 staging hostname 路由可撤销独立入口；若停止联机设施，还需撤销本次三条 UFW 规则，保留私有密钥文件直到受控清理。
