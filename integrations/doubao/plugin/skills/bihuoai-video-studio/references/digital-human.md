# 数字人合成

1. 调用 `list_avatars` 查询当前账号可用形象；“我的形象”按工具定义用 `scope=mine`，公共形象用 `scope=system`。只使用实际返回的 `trainingId`。
2. 文本驱动时调用 `list_voices`，让用户选择实际可用的 `voiceId`。查询不到时停止，不编造兜底 ID。
3. 按 TTS 参考规则在当前编排中生成朗读版，保留原文及差异，不运行脚本。音频驱动需先取得真实可访问的 `audioUrl`。
4. 检查输入及形象、声音使用权益。向用户展示视频名、形象、声音、版本、语速、语言、稿件差异和费用影响，确认后调用 `create_digital_human_video`。
5. 参数只使用当前工具声明的字段。已知文字模式为 `videoName`、`version`、`trainingId`、`text`、`voiceId`、`speed`、`languageBoost`；音频模式以 `audioUrl` 驱动，不能同时填入互斥字段。以实际 Schema 为最终依据。
6. 未指定时优先较省算力的 LITE 档；只有当前 Schema 仍声明 `version=1` 对应 LITE 时使用该值。PRO 或其他版本需用户明确选择及实时工具定义支持。
7. 保存 `dhVideoId`，调用 `get_dh_video_status` 查询原任务，成功并取得 `videoUrl` 后检查实际输出及审核状态再交付。

文字驱动的默认语速为 `speed=1.0`、默认语种增强为 `languageBoost=Chinese`，仅在当前工具 Schema 接受时使用；用户本次选择和本任务已提供配置优先。没有公开参数上下限时不猜范围。清晰度以当前定义为准，不编造低于 LITE 的第三个“标清”枚举。音频驱动不同时传 `text` 和 `voiceId`，不做 TTS 规范化。保存形象、声音、版本和模式用于恢复，输出不包含凭据。

不虚构情绪、音调、音量、背景音乐、字幕样式等未公开参数。创建成功只代表受理，数字人生成确认不包含剪辑、封面或发布。人物与声音授权不明确时先确认用途及权利范围。

