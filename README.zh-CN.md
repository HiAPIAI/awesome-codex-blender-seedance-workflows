# Awesome Codex + Blender + Seedance 工作流

[English](README.md) | [环境准备](docs/setup.md) | [架构](docs/architecture.md) | [调研记录](docs/research.md) | [开发计划](docs/PLAN.md)

这是一个可执行、可审查的 AI 电影预演仓库：Codex 编写结构化镜头，Blender 批量渲染灰盒预演，再通过 [HiAPI](https://www.hiapi.ai/) 把预演作为 Seedance 2.0 的动作、空间、节奏与镜头参考。

它不是提示词画廊。每套工作流都包含版本化 JSON 镜头合约、确定性编译、真实 Blender 渲染、默认 dry-run 的 HiAPI 请求和自动测试。

## 首批工作流

| 工作流 | 解决的问题 | 时长 | 镜头 |
|---|---|---:|---|
| [仓库追逐](examples/warehouse-pursuit/shot.json) | 双人追逐与横穿车辆的空间关系 | 6 秒 | 低机位手持跟拍 |
| [楼顶信号揭示](examples/rooftop-reveal/shot.json) | 从人物表演过渡到城市尺度揭示 | 8 秒 | 中景跟随到升降大全景 |
| [腕表精密揭示](examples/tabletop-reveal/shot.json) | 产品几何、反光和节奏控制 | 5 秒 | 微距滑轨弧线 |

## 快速开始

需要 Node.js 20+、Blender 4.5+ 和 FFmpeg。本仓库已在 Windows 的 Node 22.22.3、Blender 5.2.0 LTS、FFmpeg 8.1.2 上完成真实验证。

```powershell
npm run doctor
npm test
npm run render -- examples/warehouse-pursuit/shot.json --out-dir outputs/warehouse-pursuit
```

从头到尾检查 `outputs/warehouse-pursuit/previs.mp4`。灰盒只负责表达运动、站位、时序和摄影机路径，不代表最终画面材质。

```powershell
npm run generate -- --request outputs/warehouse-pursuit/seedance.request.json --video outputs/warehouse-pursuit/previs.mp4
```

上面的命令只做预检，不会创建付费任务。它会输出绑定当前请求与视频哈希的 `preflightToken`。只有显式带回完全相同的 token 才会提交一次任务：

```powershell
npm run generate -- --request outputs/warehouse-pursuit/seedance.request.json --video outputs/warehouse-pursuit/previs.mp4 --confirm-preflight <token>
```

请在 [HiAPI API Key 页面](https://www.hiapi.ai/en/dashboard/api-keys) 创建密钥，并通过当前进程环境变量 `HIAPI_API_KEY` 注入。不要把密钥写入聊天、命令参数、源码或 Git。安全配置方式见[环境准备](docs/setup.md)。

## 交给 Codex

```text
阅读 AGENTS.md。复制最接近的示例到 examples/subway-platform-reveal。
制作一个连续 7 秒镜头：通勤者发现一列空车进站，摄影机侧向移动，
逐步揭示所有车厢都没有灯。保持运动方向一致，代理物不超过六个，
完成 validate、compile 和真实预演渲染，不提交付费 HiAPI 任务。
```

Blender MCP 或 [Blockout](https://github.com/wassermanproductions/blockout) 可以作为交互式创作前端，但最终贡献必须收敛为 `shot.json`，这样才能进行 Git diff、复现和自动校验。

## 为什么这样设计

- **预演是控制信号。** 编译后的提示词明确保留站位、动作时序、焦段节奏与摄影机路径，同时要求完全替换灰盒外观。
- **一份 spec 对应一个镜头。** 4-15 秒内只维护一套空间与时间合同，减少模型误读。
- **默认不付费。** 请求或视频任何变化都会让确认 token 失效。
- **不执行任意 Python。** Codex 只能输出 schema 允许的 primitive、相机和关键帧。
- **不重复大型编辑器。** Blender MCP 与 Blockout 负责交互探索，本仓库负责轻量、可审计的交接和 HiAPI 执行。

## 人工验收

生成前：完整观看预演，检查首/中/尾帧、人物间距、运动方向、接触事件、摄影机速度和时长。

生成后：完整观看成片，检查主体一致性、肢体与接触、镜头遵循度、物体数量、连续性锁定、灰盒泄漏、肖像/IP 授权和音画同步。API 返回 `success` 只代表生成完成，不代表创意质检通过。

贡献要求见 [CONTRIBUTING.md](CONTRIBUTING.md)。仓库使用 MIT 许可证；外部调研与借鉴边界记录在 [docs/research.md](docs/research.md)，不打包第三方代码和媒体。
