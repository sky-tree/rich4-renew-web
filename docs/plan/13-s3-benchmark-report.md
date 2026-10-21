# 13 · S3 生产构建性能与渲染复核

> 2026-10-22，候选源码 `a5f27de`。本报告替代旧的 4.70 MiB、59.5 FPS 和 Issues #8/#9 已关闭的结论。GitHub 两条工单仍为 OPEN；本地结果不等于线上、手机或低内存设备验收。

## 方法与原始数据

使用正式 `/rich4/` 构建，通过真实 Nginx 1.28.0 的回环 HTTP 服务加载，开启 gzip；macOS / Apple M1 Pro / 32 GiB，Node 25.9.0，Playwright Chromium 156.0.8078.4。无网络限速或 CPU 降速；移动模式只改变视口、触摸与设备特征，仍使用同一台电脑。

每个用例创建干净浏览器上下文。冷加载等待菜单可用、SW 安装并控制页面；热加载重用浏览器缓存和 SW。首地图窗口从新游戏的开始按钮前计数，到台湾 2P 的 GO 按钮出现并网络空闲为止，不是下载整张地图。

Nginx `$bytes_sent` 原始日志包括页面和 SW 的后台请求，以及实际压缩后的 HTTP 头和正文，不含 TLS/TCP 开销。CDP `encodedDataLength` 同时保留用于对照，但页面会漏掉部分 SW 请求，不能单独作为总传输量。没有使用解码大小或 Content-Length 代替传输。

同一 UI 存档分别加载 Canvas 和 WebGL，全部 SaveData 字段一致后，各采集全新 300 个真实 rAF 间隔。保留每帧间隔、堆采样、请求路径/状态/字节数和构建清单：

- [桌面原始 JSON](evidence/2026-10-21-rc/benchmark-desktop.json)
- [移动视口原始 JSON](evidence/2026-10-21-rc/benchmark-mobile.json)

## 本次结果

以下传输列单位均为字节，FPS / p95 列单位为帧每秒 / 毫秒。

| 环境 | 冷菜单含 SW | 热菜单 | 首地图加载窗口 | Canvas FPS / p95 | WebGL FPS / p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 桌面 1280×720 | 4,360,882 | 1,839 | 49,640,441 | 60.00 / 16.70 | 60.00 / 16.70 |
| 移动模拟 844×390 | 4,360,882 | 1,839 | 37,533,417 | 60.00 / 16.80 | 60.00 / 16.70 |

两次冷菜单均为约 4.16 MiB，低于本次 10 MiB 门槛；热菜单仍有 HTML 网络重验证，并非完全零网络开销。首地图数据会随随机角色和视口变化，不作为严格重复的 A/B 网络比较。

## 渲染正确性与决策

修复上层 HUD Canvas 的透明缓冲、WebGL 创建失败时的重复 Canvas、上下文丢失回退。实际 Chromium 像素检查确认透明区域能显示下层 WebGL，且真实丢失上下文后回到完整 Canvas。桌面和移动视口均通过；原截图含私有素材，仅本地保存。

保持 Canvas 为默认后端，WebGL 只通过 `?renderer=webgl` 启用。300 帧静止局面的 rAF 接近 60 Hz，无法证明哪种后端有普遍性能优势；不延续旧报告中 Canvas 胜出 0.9 FPS 的推论。

## 尚未验证

rAF 是呈现调度间隔，不是 GPU 执行耗时；JS 堆样本不是进程或显存峰值。没有执行真实手机、Safari、长局运动场景、天气/歌舞伎町、热降频或低内存压力测试。每视口一次样本不足以建立统计显著收益或全设备预算。扩大内测前仍需目标设备复测。

## 复现

先 `npm run build:web && npm run verify:web`；终端一运行：

```sh
E2E_ORIGIN_LOG=/tmp/rich4-origin.jsonl node scripts/serve-nginx.mjs
```

终端二运行：

```sh
E2E_SKIP_SERVER=1 E2E_BASE_URL=http://127.0.0.1:5189/rich4/ \
E2E_ORIGIN_LOG=/tmp/rich4-origin.jsonl npm run test:e2e:benchmark
```

需要完整私有素材、Nginx 和 MIME 表，可用 `NGINX_BIN`、`NGINX_MIME_TYPES` 指定。原始 JSON 存放于 Playwright 每项测试输出目录；不要公开包含私有素材的截图、trace 或录屏。
