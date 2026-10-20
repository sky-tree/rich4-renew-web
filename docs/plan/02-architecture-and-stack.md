# 02 · 技术选型与目标架构

## 1. 源码现状：2026-10-20 基线

| 层 | 当前源码和技术 | 下一步 |
| --- | --- | --- |
| 构建 | `game/package.json`，Vite 7、TS 5.9、Vitest 3 | 保留；加独立 Web 构建目标 |
| 规则 | `game/src/core/game.ts`、`world.ts`、`modules/`、`flow.ts` | 尽量原样保留 |
| UI | `game/src/ui/main.ts`、`hud.ts`、`screens/` 和 CSS | 保留 DOM；按需模块化 |
| 渲染 | `game/src/ui/board-view.ts` Canvas 2D；`ground-cache.ts`、`ground.ts`、`sprites.ts` | 第一阶段保留；后续可替换 PixiJS |
| 素材 | `assets.ts`、`decode.ts`、`board-preload.ts`、`bundle-assets.mjs` | 构建清单/加载策略优化 |
| 声音 | `game/src/ui/audio.ts`，Web Audio | 保留、优化生命周期 |
| 存档 | `game/src/ui/saves.ts`：Web IndexedDB / 原生 Capacitor Filesystem | 去原生分支、保留浏览器存档 |
| 联机 | `party-net.ts`、`party-check.ts`，PeerJS 1.5.5 + WebRTC | 保留锁步；自建服务作为上线子任务 |
| 平台 | Capacitor iOS/Android、Electron 桌面 | Web-only 后从发布链移除 |

现有入口 `game/index.html` 加载 `src/ui/main.ts`，规则与 UI 在同一浏览器执行。没有必须驻留 VPS 才能运算单机对局的后端。

## 2. 技术栈决策

| 能力 | 第一阶段采用 | 未来备选 | 选择理由 |
| --- | --- | --- | --- |
| 核心语言 | TypeScript | 不迁移 | 与 Fork 一致、复用最大化 |
| 开发构建 | Vite + Node（以 lockfile 锁版本） | 暂不引入完整前端框架 | 当前结构足够，构建简单 |
| 测试 | Vitest + 浏览器 E2E（计划加入 Playwright） | — | 覆盖逻辑与真正浏览器 |
| 游戏规则 | 原生 TypeScript Generator | — | 不影响现有玩法；避免重写风险 |
| UI | HTML/CSS/DOM | 独立非游戏页面再选 Vue | 现有屏幕改动成本最低 |
| 地图绘制 | Canvas 2D | PixiJS 8 / WebGL | 先发布，再以基准判断收益 |
| 纹理/素材 | 现有 PNG/WebP + Manifest | 图集 / 多分辨率 / AVIF（单独测试） | 不破坏已有帧偏移和回退 |
| 客户端数据 | IndexedDB + localStorage | 可选存档导入导出、云存档 | 零账号成本，支持离线本地进度 |
| 多人通信 | PeerJS / WebRTC DataChannel | 私有 PeerServer + coturn | 优先保留既有玩法和锁步协议 |
| Web 服务 | Nginx + HTTPS | CDN / 对象存储 | 单机无动态后端，VPS 资源足够小规模服务 |
| PWA | 后续可选 | `vite-plugin-pwa` 或直接编写 SW | 不是 v1 技术阻塞，避免全量缓存 |

**不选的路径**：Godot 4、Three.js、C++/SDL3、WASM 规则移植目前均不是最小风险路线。若需要 3D 场景编辑器、复杂光照或原生平台体验，另立评审，不在本路线中顺手引入。

## 3. 目标运行时架构

```text
                  用户浏览器（所有规则和绘制）
  ┌─────────────────────────────────────────────────┐
  │ App Shell：标题、菜单、设置、加载状态（DOM/CSS） │
  ├─────────────────────────────────────────────────┤
  │ GameFlow 驱动层：事件 / Ask / Answer / Step       │
  ├─────────────────────────────────────────────────┤
  │ Game / World / modules / RNG（现有 TS 规则核心） │
  ├──────────────────────┬──────────────────────────┤
  │ SceneAdapter         │ HTML HUD / Screens       │
  │ 坐标、帧、排序、命中  │ 游戏面板、对话框、按钮   │
  ├──────────────────────┴──────────────────────────┤
  │ Renderer：Canvas 首发；PixiJS 验证后渐进替换     │
  ├───────────────────┬─────────────────────────────┤
  │ AssetLoader       │ IndexedDB / Audio / WebRTC  │
  └─────────┬─────────┴────────────────────┬────────┘
            │ HTTP(S) 静态文件             │ 联机可选
            ▼                            ▼
    Nginx + 游戏资源             PeerServer + STUN/TURN
```

**关键不变量**：同一游戏状态 + 玩家回答 + 随机种子应产生一致规则结果；渲染帧率和资源加载顺序不应改变 RNG 消费次序。

## 4. 渲染接口演进：先拆边界，不先重写

`board-view.ts` 当前混合了相机/投影/命中/动画与 Canvas 绘制，约 1,700+ 行。计划按“移出可纯计算的部分 → 接口封装 → 新渲染器并行”的次序。

```ts
// 目标接口草案：不是项目现有 API；落地时依据真实依赖调整。
interface RenderScene {
  camera: { x: number; y: number; rotation: number; zoom: number };
  ground: unknown; // 用明确的 TileRef/TextureRef 替代
  actors: ReadonlyArray<ActorRenderState>;
  objects: ReadonlyArray<ObjectRenderState>;
}

interface BoardRenderer {
  mount(target: HTMLElement): Promise<void>;
  render(scene: RenderScene, interpolation: number): void;
  resize(width: number, height: number, dpr: number): void;
  dispose(): void;
}

// ActorRenderState/ObjectRenderState 需包含坐标、深度、frame、anchor、scale 等字段。
```

必须将下列计算与 Canvas API 解耦：

1. 等角投影矩阵、坐标正反变换、摄像机跟随、平移、旋转、缩放；
2. 建筑、地块、人物、特效的遮挡排序与绘制深度；
3. 精灵逻辑尺寸与原点锚点（HD 文件的物理像素倍率不可改变世界坐标）；
4. 指针/触摸命中测试，含透明像素精确选中策略；
5. 纹理缓存销毁与切换地图后的资源释放。

渲染器切换仅在调试构建或用户显式开关中先验证；**Canvas 必须保留到 PixiJS 通过回归和性能门槛**。PixiJS 在 Safari 上应优先使用 WebGL，不能假定所有浏览器已支持 WebGPU。

## 5. 建议逐步落地的结构（不是立即搬迁）

```text
game/
  src/
    core/               # 保留现有逻辑与模块
    ui/                 # 保留现有 DOM UI、screens 与 HUD
    renderer/           # 阶段 M4 才新建
      scene/            # 无 Canvas API 的场景数据
      canvas/           # 对当前 BoardView 的逐步封装
      pixi/             # PixiJS 适配器与图集
    assets/             # 阶段 M2 才抽出
      manifest.ts       # 资源清单模型与版本校验
      loader.ts         # 失败重试、并发控制、优先级
    storage/            # v1 可先放 ui/saves.ts
    network/            # v1 可先放 ui/party-net.ts
  scripts/              # 保留并扩展 bundle-assets.mjs
  public/               # 不提交未经授权的素材
```

**原则**：不要为了看上去“分层好看”而在 M1 一次性移动全部文件；优先缩小差异以便与上游同步。

## 6. 与上游的长期关系

- `origin`: `git@github.com:sky-tree/rich4-renew-web.git`，本项目唯一推送目标。
- `upstream`: `https://github.com/iam567/rich4-renew-app.git`，仅拉取、比较、选择性同步，不向其推送。
- 尽量在独立提交中完成“平台删除 / 资源接口 / 渲染接口”的改造，降低上游合并冲突。
- 上游继续修改大富豪、派对逻辑时，先跑核心 Vitest，再执行关键浏览器 E2E；不直接无条件 `git merge upstream/main` 到线上分支。
- GitHub 上线更新通过 PR 审查与阶段验收，而不是在服务器裸目录中手改业务逻辑后直接部署。
