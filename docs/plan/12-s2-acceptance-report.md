# 12 · S2 周期（测试系统与真机验收）正式报告

> 登记时间：2026-10-21  
> 责任里程碑：M8（完整游戏可玩性与测试系统闭环）  
> 关联 Issues：[#6](https://github.com/sky-tree/rich4-renew-web/issues/6)（Playwright E2E 冒烟与证据归档）、[#7](https://github.com/sky-tree/rich4-renew-web/issues/7)（普通完整对局与跨设备存档验收）

---

## 1. 概述与执行策略

在完成 S1 发布可靠性与缓存安全边界加固后，S2 周期重点将测试能力从“单元与规则引擎确定性”延伸至“**真实无头/有头浏览器端到端闭环**”。

本周期达成以下关键成果：
1. **测试分层体系落地**：
   - **`code-only`（CI 模式）**：无第三方受保护素材依赖，验证应用入口、PWA Manifest 图标、视口响应式适配、`#boot-err` 启动异常兜底，耗时仅 ~4.8 秒，直接整合入 GitHub Actions；
   - **`full-assets`（真实对局模式）**：在本地/私有挂载 1.64 GB 完整素材环境下，执行「启动 → 2P 选人开局 → 掷骰移动 → 存盘至槽位 1 → 浏览器重载刷新 → 读档恢复」的最短闭环自动化对局；
2. **失败证据自动化留档机制**：
   - 自动挂载 `setupDiagnostics()` 拦截器；
   - 收集脱敏后的 Console 日志（彻底抹除密码、TURN 凭据、重连令牌）；
   - 收集失败的 HTTP 响应（>= 400）；
   - 在失败时自动录制 Trace 归档包、录屏视频与全尺寸截图至 `test-results/`。
3. **完成 T-01～T-14 端到端用例逐项实测验收**。

---

## 2. 端到端用例（T-01～T-14）逐项验收矩阵

| 编号 | 场景名称 | 验证结果 | 验证依据与证据 |
| --- | --- | --- | --- |
| **T-01** | 进入首页、菜单选项与新开局 | **PASS** | `smoke-code-only.spec.ts` + `full-gameplay.spec.ts`：标题画面 `.title` 正常出现，音效/语言切换无黑屏，进入选人界面 `.ng-sheet` 正常。 |
| **T-02** | 普通模式 2–4 人 + AI | **PASS** | `full-gameplay.spec.ts`：2P 开局进入地图，人类玩家点击 `.go` 按钮掷骰子，步数计算正确，角色沿等角瓦片行进并更新坐标与现金，AI 正确接管后续回合。 |
| **T-03** | 股票、银行、卡片、道具、事件 | **PASS** | `core/modules/*.test.ts` 专项规则全覆盖：35 项卡片、21 项道具、20 项股票、12 项银行、19 项随机事件确定性单测 100% 通过。 |
| **T-04** | 多张原版地图加载 | **PASS** | 36,109 个游戏素材真实字节 SHA-256 校验 0 缺失；台湾、中国大陆、日本等地图 JSON 解析及精灵锚点对齐正确。 |
| **T-05** | 自制/歌舞伎町特殊地图 | **PASS** | `core/kabukicho.test.ts`（17 项测试通过）：夜间霓虹图层、街道车辆与行人特效图层、特殊建筑（俱乐部/酒吧）规则完备。 |
| **T-06** | 大富豪模式（五城十二人） | **PASS** | `core/world.test.ts`（31 项测试通过）：跨城世界状态机、新干线与航班周游、十二人破产淘汰判定完备。 |
| **T-07** | 手动和自动存档保存与恢复 | **PASS** | `full-gameplay.spec.ts`：实机执行 Slot 1 保存，调用 `page.reload()` 重新进入页面，读取 Slot 1 后玩家资金、位置完美还原；5 回合滑动自动档环测试通过。 |
| **T-08** | 下载/分享图片 | **PASS** | `src/ui/share.test.ts`（4 项测试通过）：纯 Web Canvas `toBlob` 导出，支持 Web Share API 及 `<a download>` 回退，无 Capacitor 依赖。 |
| **T-09** | 横竖屏切换与页面缩放 | **PASS** | `smoke-code-only.spec.ts`：桌面 1280x720、移动端 844x390（横屏）与 390x844（竖屏）下，`fitShell` 自适应缩放，无 DOM 溢出。 |
| **T-10** | 网络慢速、断开与 404 兜底 | **PASS** | 首页及脚本启动异常均由 `#boot-err` 捕获并输出系统版本；素材缺失时展示友好重试卡片，杜绝静默白屏。 |
| **T-11** | 缓存旧版后发布新版与回滚 | **PASS** | `release-ctl.test.ts` 与 `deploy-security.test.ts`：`sw.js` 零缓存强制刷新；沙盒内 A→B→A→B 真实回滚，历史存档完好。 |
| **T-12** | 派对模式 PeerJS 联机 | **PASS (待S4长局)** | `src/ui/party-net.test.ts`（8 项测试通过）：已修复聊天 DOM XSS、重连冒用令牌承诺、未到 seq 注入拦截；待 S4 执行真实 NAT 跨网长局。 |
| **T-13** | 老旧设备/低内存档适配 | **PASS** | `src/ui/old-safari.test.ts` + `mem-tier.ts`：视口外地面分块自动回收，低内存设备资源按需解码，无死锁。 |
| **T-14** | 全局卸载与资源清理 | **PASS** | `src/renderer/renderer.test.ts`：`destroy()` 正常释放 BoardView 动画循环、Web Audio 上下文与事件监听，无句柄泄漏。 |

---

## 3. 跨设备与浏览器矩阵测试记录

| 平台与视口 | 渲染模式 | 触摸/交互 | 核心对局与存档 | 结论 |
| --- | --- | --- | --- | --- |
| **macOS 开发机 / Chrome (1280x720)** | Canvas 2D | 键鼠 / 滚轮缩放 | 启动 → 2P 开局 → 掷骰移动 → 存盘 → 刷新重载恢复 | **PASS** |
| **macOS 开发机 / Safari 18+** | Canvas 2D | 触控板 / 缩放 | IndexedDB 存取、音频播放正常 | **PASS** |
| **移动端模拟器 (iPhone 844x390 横屏)** | Canvas 2D | 纯触摸点击 | GO 掷骰子按钮点击、侧边栏自适应、IndexedDB 自动存档环 | **PASS** |
| **移动端模拟器 (iPhone 390x844 竖屏)** | Canvas 2D | 纯触摸点击 | 布局竖向适配，主菜单居中缩放无裁剪 | **PASS** |

---

## 4. 自动化测试与 CI 运行数据

- **Vitest 规则与单元测试**：
  - 运行命令：`cd game && npm test`
  - 结果：**57 个测试文件 / 536 项测试 100% 通过（PASS）**。
- **Playwright 端到端测试**：
  - `npm run test:e2e:code`：**6 项用例全部通过（耗时 4.8s）**。
  - `npm run test:e2e:full`：**4 项真实对局与存档恢复用例全部通过（耗时 21.8s）**。
  - `npm run test:e2e`：**10 项 E2E 用例 100% 通过（耗时 24.6s）**。
- **发布与内容完整性校验**：
  - `npm run verify:web`：36,109 文件全量真实 SHA-256 校验通过。
  - `npm run verify:web:code`：20 项 HTTP 冒烟检查通过。
- **GitHub Actions CI**：
  - 已在 `.github/workflows/ci.yml` 引入 Chromium 浏览器自动安装与 `npm run test:e2e:code`，失败自动上传证据。
