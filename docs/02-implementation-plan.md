# 落地实施计划（10 个阶段）

> 配套文档：`01-gameplay-analysis.md`（玩法分析）、`research/smb3-mechanics.md`（数值考证）。
> 原则：**自内向外**——先把帧层手感做对，再往外套关卡与地图（对应《调研报告》"教学是后置设计"）。

## 技术选型与约束

| 项 | 决定 | 理由 |
|---|---|---|
| 语言 | 原生 JavaScript ES modules | 零构建、双击即玩、可读性 = "游戏是产品" |
| 渲染 | Canvas 2D，内部分辨率 **256×224**（NES），整数倍放大 | 像素风纯净、性能稳 |
| 依赖 | **0 个** npm 依赖 | 不可被环境破坏 |
| 逻辑步长 | 固定 **60Hz**（累加器 + 插值渲染上限） | 物理可复现、手感一致 |
| 美术 | 程序化绘制（`src/render/art.js`） | 无素材、无版权风险 |
| 音频 | WebAudio 实时合成（`src/core/audio.js`），**原创旋律** | 无素材、无版权风险 |
| 测试 | `node --test`（纯逻辑模块不碰 DOM） | 物理/碰撞/地图可回归 |

## 目录结构

```
index.html                  入口（内部分辨率画布 + 启动 main.js）
src/
  core/      loop.js input.js audio.js rng.js  引擎基础设施
  render/    art.js（子代理产出） renderer.js hud.js
  game/      constants.js physics.js player.js collision.js tilemap.js
             camera.js items.js entities/*.js level.js session.js
  data/      tiles.js levels/*.js worldmap.js
  scenes/    scene.js title.js map.js level.js interlude.js
  main.js
tests/       *.test.mjs
tools/       serve.mjs（零依赖静态服务器） art-preview.html audio-preview.html
docs/
```

## 阶段表

| # | 阶段 | 交付 | 验收标准 |
|---|---|---|---|
| 1 | 引擎骨架 | 定步长循环、输入（键盘+手柄）、场景栈、256×224 缩放渲染、调试叠层 | 打开页面看到稳定 60fps 的测试图案，F1 切调试信息 |
| 2 | **马里奥物理** | `constants.js` + `physics.js` + `player.js`：三档速度、P 表、分档跳跃、惯性/打滑 | 通过 `01-gameplay-analysis.md` §3.4 的 6 条手感自检；单测覆盖速度/P表/跳跃 |
| 3 | 瓦片世界 | 瓦片图、AABB 扫掠碰撞、斜坡、单向平台、砖块/问号块/隐藏块、管道进出 | 能在一张手写测试关里跑、跳、撞块、走斜坡、进管道 |
| 4 | 形态系统 | 小/超级/火焰/狸猫；尾击、缓降、P 飞行；道具生成与吃取；受伤先降超级；星星无敌 | 四形态动词全部可用；飞行能上到关卡上层 |
| 5 | 敌人与交互 | 栗宝宝/慢慢龟/飞龟/龟壳/食人花/铁甲龟/刺猬/骨头龟/岩浆泡/子弹比尔/锤子兵/Boom-Boom | 踩踏、踢壳、连踩得分序列、尾击、火球击杀全部生效；要塞 BOSS 三踩败退 |
| 6 | 关卡数据 | 1-1（隐性教学，**最后写**）、1-2（地下）、1-3（空中踏板）、1-要塞、1-4 | 五关可连续通关；关卡校验脚本无"同屏 >3 障碍"告警 |
| 7 | 世界地图 | 节点图移动、库存、蘑菇屋、要塞开路、关卡状态持久化（localStorage） | 从地图进关、通关回地图、开新路、用库存道具变身 |
| 8 | 元系统 | HUD、终点卡片、得分/金币/生命、计时与超时、场景流转、暂停、遥测钩子 | 完整一轮：标题 → 地图 → 关卡 → 卡片 → 地图 → 通关世界 |
| 9 | 验收 | 单元测试、静态服务器、浏览器实测、性能与手感调优 | `node --test` 全绿；浏览器实机 60fps 无异常 |
| 10 | 交付 | README、截图说明、GitHub Pages 就绪、git 提交并推送 `xlwangcs/AIMario` | 远端可访问、克隆后三步内可玩 |

## 每阶段的提交策略

每个阶段一个 git commit，message 用 `feat(phaseN): ...`，正文写清"本阶段实现了哪条玩法机制、对应分析文档的哪一节"，使提交历史本身就是一份可追溯的开发日志。
