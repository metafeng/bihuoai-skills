---
name: bihuoai-digital-human
description: 通过必火全员IP营销平台 MCP 查询当前账号的数字人形象和声音，将数字、日期和数量转换为适合中文 TTS 的朗读文本，再按文案或音频创建并查询数字人口播视频。用户提到必火AI数字人、形象ID、声音ID、口播视频或数字人作品时使用。
---

# 必火AI数字人合成

本 Skill 只负责数字人合成，不承担智能剪辑和外部发布。平台能力与账号数据通过 `agent-bihuoai` MCP 获取。

## 认证和连接

- 使用客户端已经连接并完成 OAuth 授权的 `agent-bihuoai` MCP。
- Skill 不读取、不保存、不要求用户粘贴任何平台凭证，也不直接请求平台接口。
- MCP 不可用时，先读取 `https://agent.bihuoai.com/oauth/mcp-install` 的当前说明并引导用户完成连接；不要回退到旧认证方式。
- 首次使用、工具字段变化或流程不明确时，先调用 `get_usage_guide`。

## 私有默认值

可读取用户私有配置：

- macOS / Linux：`~/.bihuoai-skills/bihuoai-digital-human/BIHUOAI_USER_CONFIG.md`
- Windows：`%USERPROFILE%\.bihuoai-skills\bihuoai-digital-human\BIHUOAI_USER_CONFIG.md`

支持 `default_avatar_id`、`default_voice_id`、`default_video_version`、名称、`default_speed`、`default_language_boost`、TTS 开关，以及 `avatar_voice_<形象ID>`。它只提供候选默认值；创建前仍要通过 MCP 实时核验资源属于当前授权账号。

形象和声音优先级：用户本次明确指定 > 形象专用声音映射 > 私有全局默认 > 平台工具默认。公共 Skill 不提供跨账号兜底 ID。

清晰度优先级：用户本次明确指定 > 私有配置 `default_video_version` > 公共默认 `version=1`。公共默认始终使用较省算力的 LITE 档；只有用户明确要求更高质量，或其私有配置写有 `default_video_version: 2` 时，才使用 PRO 档。

文字模式的 TTS 参数优先级：用户本次明确指定 > 私有配置 > 公共默认。公共默认使用 `speed=1.0`、`languageBoost=Chinese`。`speed` 必须是 MCP 当前接受的数字；工具定义未公开上下限时，不猜测范围。`languageBoost` 必须使用 `create_digital_human_video` 当前工具定义列出的枚举值。

## 标准流程

1. 调用 `list_avatars`。用户说“我的形象”时用 `scope=mine`；需要公共形象时用 `scope=system`。使用返回的 `trainingId`，不要猜 ID。
2. 文本驱动时调用 `list_voices`，使用返回的 `voiceId`。用户没有明确选择时可读取私有默认，但必须在实时列表中匹配成功。
3. 文本驱动先按 [TTS 朗读文本规范化](references/tts-text-normalization.md) 生成朗读版。默认可用本 Skill 的离线脚本预处理：

```bash
node scripts/tts-normalize.mjs --text-file ./口播稿.txt --output ./口播稿.朗读版.txt
```

4. 向用户展示创建预检：视频名、清晰度版本、形象、声音、语速、语种增强、原文与朗读版差异。工具说明标注会扣费时，明确说明并取得确认。
5. 文本驱动调用 `create_digital_human_video`，传 `videoName`、`version`、`trainingId`、朗读版 `text`、`voiceId`、`speed` 和 `languageBoost`。未指定时固定用 `version=1`（LITE，较省算力；平台界面可能显示为“高清”）；`version=2` 为 PRO/超清，只在用户明确选择或私有配置覆盖时使用。接口没有低于 `version=1` 的第三个“标清”枚举，不得编造其他值。
6. 音频驱动先用 `bihuoai-material-upload` 获得 `audioUrl`，再创建数字人；不要同时传文字和声音 ID，也不执行 TTS 文本规范化。
7. 保存返回的 `dhVideoId`，用 `get_dh_video_status(dhVideoId)` 查询。未完成时至少间隔 15 秒；成功后返回 `videoUrl`。
8. 任务失败时转告平台错误并保留任务 ID。超时、断线或状态未知时继续查询原任务，不重新创建。

## TTS 规则

- 年份 `2020年` → “二零二零年”；数量 `2020个人` → “两千零二十个人”。
- `2个` → “两个”；`第2个` → “第二个”；`2.0版本` → “二点零版本”。
- 日期、时间、百分比和明确的电话号码可转换为自然中文读法。
- 孤立数字、产品型号或用途不明确的数字保留原样，继续创建，不询问、不阻塞。
- 不覆盖原始文案；平台使用朗读版，原文继续留档。
- 用户明确要求保持原始读法时跳过规范化。

## 当前参数边界

- 创建接口当前支持：`videoName`、`version`、`trainingId`，以及文字模式的 `text`、`voiceId`、`speed`、`languageBoost`，或音频模式的 `audioUrl`。
- 当前接口没有情绪、音调、音量、背景音乐、字幕样式等创建参数，不把 `default_emotion` 或类似字段传给 MCP，也不向用户承诺它们会生效。
- `list_voices` 返回的声音类型、性别等字段用于筛选声音，不是创建接口的独立控制参数。

## 输出和边界

- 最少保存 `dhVideoId`、当前状态、`videoUrl`、使用的形象和声音，方便恢复。
- 创建成功只代表任务已提交，不能当作视频已经生成。
- 不在查询资源或查看状态时触发付费创建。
- 不把数字人确认扩展为剪辑或发布确认。
