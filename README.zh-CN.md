# Awesome Codex + Blender + Seedance 工作流

[![Codex、Blender 与 Seedance 预演工作流封面](assets/cover.webp)](https://www.hiapi.ai/)

[English](README.md) | [环境准备](docs/setup.md) | [架构](docs/architecture.md) | [调研记录](docs/research.md) | [开发计划](docs/PLAN.md)

这是一个可执行、可审查的 AI 电影预演仓库：Codex 编写结构化镜头，Blender 批量渲染灰盒预演，再通过 [HiAPI](https://www.hiapi.ai/) 把预演作为 Seedance 2.0 的动作、空间、节奏与镜头参考。

它不是提示词画廊。每套工作流都包含版本化 JSON 镜头合约、确定性编译、真实 Blender 渲染、默认 dry-run 的 HiAPI 请求和自动测试。

## 首批工作流

| 工作流 | 解决的问题 | 时长 | 镜头 |
|---|---|---:|---|
| [仓库追逐](examples/warehouse-pursuit/shot.json) | 追逐间距、横穿障碍与可见手持漂移 | 6 秒 | 低机位手持跟拍 |
| [楼顶信号揭示](examples/rooftop-reveal/shot.json) | 人物表演过渡到三层城市纵深揭示 | 8 秒 | 中景跟随到升降大全景 |
| [腕表精密揭示](examples/tabletop-reveal/shot.json) | 产品几何、秒针启动与移动高光时序 | 5 秒 | 微距滑轨弧线 |
| [沙漠 RV 实验室](examples/desert-rv-laboratory/shot.json) | 冷暖室内对比、玻璃金属响应与克制表演 | 8 秒 | 35mm 慢速推轨 |

引擎支持白名单立方体、球体、圆柱体、圆锥体、物体与摄影机变换、焦距变化和线性关键帧。可选电影级规范还可以启用有上限的 Cycles 采样、材质预设、倒角、平滑着色、景深、体积密度和最多 16 盏经过验证的灯光；渲染器仍然不会执行任意模型生成的 Python。

## 建模与运镜方法

参考 [Reid Hannaford 的 Blender → Seedance 流程](https://x.com/reidhannaford/status/2071595581508563168)：先用一张平面起始图确定美术方向与首帧构图，再用 Blender 只解决场面调度、时序、遮挡和摄影机运动。最终外观交给 Seedance，预演不是精模作品。

| Blender 必须表达 | 不影响镜头就不要做 |
|---|---|
| 轮廓与大致体块 | 最终拓扑与细分 |
| 相对比例与落地接触 | 五官、手指和服装细节 |
| 路径、间距、重叠与遮挡 | 微纹理和不可见背面 |
| 机位高度、焦距、目标点与地平线 | 画外装饰几何 |
| 明确的动作和运镜节拍 | 清晰节拍之间的多余关键帧 |

先让第 1 帧匹配确认过的平面图，再用最少关键帧做出可读运动；每轮只改站位、时序或摄影机中的一类变量。完整观看 MP4，精确核对时再查 `motion-trace.json` 中 Blender 实际求值后的逐帧数据。当前 CLI 把平面图作为创作基准，只自动提交预演视频，不会自动上传起始图。

## 快速开始

需要 Node.js 20+、Blender 4.5+，以及包含 `ffprobe` 和 `libx264` 的 FFmpeg。本仓库已在 Windows 的 Node 22.22.3、Blender 5.2.0 LTS、FFmpeg 8.1.2 上完成真实验证。

```powershell
npm ci
npm run doctor -- --strict
npm test
npm run compile -- examples/warehouse-pursuit/shot.json --out-dir outputs/warehouse-pursuit
npm run render -- examples/warehouse-pursuit/shot.json --out-dir outputs/warehouse-pursuit
```

先检查 `outputs/warehouse-pursuit/prompt.txt`、`manifest.json` 和 `seedance.request.json`，打开 `outputs/warehouse-pursuit/review/contact-sheet.png`，按 `outputs/warehouse-pursuit/review-checklist.md` 逐项检查，再从头到尾观看 `outputs/warehouse-pursuit/previs.mp4`。灰盒只负责表达运动、站位、时序和摄影机路径，不代表最终画面材质。需要俯视检查空间调度时，在 render 命令末尾加 `--blocking-svg`。

```powershell
npm run generate -- --request outputs/warehouse-pursuit/seedance.request.json --video outputs/warehouse-pursuit/previs.mp4 --out-dir outputs/warehouse-pursuit/hiapi
```

上面的命令只做预检，不会读取 API Key，也不会创建付费任务。它会显示完整 API 端点，并输出绑定该端点、当前请求与视频哈希的 `preflightToken`。付费前必须完整观看预演、完成 `review-checklist.md`、处理全部自动检查标记，再把对应 `review-report.json` 中的 `humanReviewComplete` 从 `false` 改为 `true`；提交器会拒绝请求哈希或视频 SHA-256 不匹配的报告。之后只有显式带回当前预检生成的完全相同 token 才会提交任务：

```powershell
npm run generate -- --request outputs/warehouse-pursuit/seedance.request.json --video outputs/warehouse-pursuit/previs.mp4 --out-dir outputs/warehouse-pursuit/hiapi --confirm-preflight <token>
```

付费 POST 会同时把该 token 作为 `Idempotency-Key`，并发送 canonical JSON 字节。请求发出前，CLI 先写入带首次尝试时间和“当前 API Key 单向加盐绑定”的 `hiapi/preflight-<token>.pending.json`，但绝不保存 Key 明文；收到合法任务 ID 后，再写入 `<task-id>.submitted.json` 并删除 journal。如果提交过程中连接中断，请保留 journal，只在其 23 小时安全窗口内用同一个 Key、未改动的输入与同一 token 重试。明确的客户端拒绝会清除 pending 状态，传输错误与歧义状态则保留它供人工核对。窗口过期后 CLI 会拒绝再次提交，因为服务端幂等记录可能已经过期。本地参考视频上限为 90 MiB，以确保 base64 请求不超过 API body 限制。成片每次跳转都会解析并校验全部地址，在不重新解析 DNS 的前提下固定地址集合并于同一总时限内回退，再流式写入临时文件，经响应、大小、Content-Type 与 MP4 容器校验后以原子不覆盖方式发布，最后把字节数与 SHA-256 写入 `<task-id>.download.json`。

先[注册 HiAPI 账号](https://www.hiapi.ai/zh/register)，再到 [HiAPI API Key 页面](https://www.hiapi.ai/zh/dashboard/api-keys)创建密钥，并通过当前进程环境变量 `HIAPI_API_KEY` 注入。不要把密钥写入聊天、命令参数、源码或 Git。安全配置方式见[环境准备](docs/setup.md)。

## 交给 Codex

```text
阅读 AGENTS.md。复制最接近的示例到 examples/subway-platform-reveal。
制作一个连续 7 秒镜头：通勤者发现一列空车进站，摄影机侧向移动，
逐步揭示所有车厢都没有灯。保持运动方向一致，代理物不超过六个，
完成 validate、compile 和真实预演渲染，不提交付费 HiAPI 任务。
```

Blender MCP 或 [Blockout](https://github.com/wassermanproductions/blockout) 可以作为交互式创作前端，但最终贡献必须收敛为 `shot.json`，这样才能进行 Git diff、复现和自动校验。

## 生成产物

```text
outputs/<shot-id>/
|-- compiled.json
|-- manifest.json
|-- prompt.txt
|-- seedance.request.json
|-- previs.blend
|-- motion-trace.json
|-- previs.mp4
|-- render-report.json
|-- review-report.json
|-- review-checklist.md
|-- frames/
|   `-- frame_####.png
|-- review/
|   |-- first-frame.png
|   |-- middle-frame.png
|   |-- last-frame.png
|   |-- contact-sheet.png
|   `-- blocking-top.svg  # 仅在使用 --blocking-svg 时生成
`-- hiapi/                # 仅在确认付费任务后出现
```

编译器和渲染器会用 shot 专属标记认领空输出目录，并在写入期间持有独占锁；未认领的非空目录、并发写入和不同 shot 复用都会被拒绝。每次渲染先在隔离 staging 中完成 Blender、编码和审片验证，任一步失败都保留上一版已发布预演；最终发布使用可恢复的备份事务，下次运行会先修复被中断的发布。Blender 会从实际求值后的依赖图写出 `motion-trace.json`：逐帧记录插值和约束生效后的摄影机位置、目标点、前向/上向向量、焦距、水平视场角，以及每个代理物体的变换；Node 包装层会在发布前拒绝缺帧、时间轴漂移、非法向量和对象集合漂移。渲染器确认 PNG 帧序列精确连续后先编码临时 MP4，再用 FFprobe 校验 H.264/yuv420p、尺寸、帧率和帧数，全部通过才发布。`review-report.json` 记录已验证的媒体事实，并标出疑似空白帧与亮度突变；这些自动结果只用于分流检查，不等于创意验收通过。即使指定自定义输出目录，生成媒体、报告、staging 数据和任务 journal 也会被 Git 全局忽略。

## 为什么这样设计

- **预演是控制信号。** 编译后的提示词明确保留站位、动作时序、焦段节奏与摄影机路径，同时要求完全替换灰盒外观。
- **一份 spec 对应一个镜头。** 4-15 秒内只维护一套空间与时间合同，减少模型误读。
- **默认不付费。** API 端点、请求或视频任何变化都会让确认 token 失效。
- **付费交接可恢复。** 预检 token 同时作为服务端幂等键，POST 前先落本地 pending journal。
- **不执行任意 Python。** Codex 只能输出 schema 允许的 primitive、相机和关键帧。
- **不重复大型编辑器。** Blender MCP 与 Blockout 负责交互探索，本仓库负责轻量、可审计的交接和 HiAPI 执行。

## 人工验收

生成前：检查自动生成的首/中/尾帧与 contact sheet，逐项处理 `review-report.json` 的提示，再完整观看预演并完成 `review-checklist.md`。检查人物间距、运动方向、接触事件、摄影机速度和时长；只有人工完整观看后才能把 `humanReviewComplete` 标为完成。

生成后：完整观看成片，检查主体一致性、肢体与接触、镜头遵循度、物体数量、连续性锁定、灰盒泄漏、肖像/IP 授权和音画同步。API 返回 `success` 只代表生成完成，不代表创意质检通过。

贡献要求见 [CONTRIBUTING.md](CONTRIBUTING.md)。仓库使用 MIT 许可证；外部调研与借鉴边界记录在 [docs/research.md](docs/research.md)，不打包第三方代码和媒体。
