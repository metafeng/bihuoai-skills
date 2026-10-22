---
# 默认形象和声音。ID 必须来自当前授权账号的 MCP 实时列表。
# default_avatar_id: 12345
# default_avatar_name: 你的形象名称
# default_voice_id: voice_请替换为你的声音ID
# default_voice_name: 你的声音名称
# 默认成片档位不填写时使用公共默认 1（LITE，较省算力）。需要 PRO/超清时取消下一行注释。
# default_video_version: 2
default_speed: 1.0
default_language_boost: Chinese
tts_normalize: true

# 为特定形象绑定专用声音。把 12345 换成真实形象 ID。
# avatar_voice_12345: voice_该形象专用的声音ID

# 视频封面默认底图。值与 cover_background_<key> 对应。
# cover_default_background: studio
# cover_background_studio_name: 摄影棚背景封面
# cover_background_studio_url: https://example.com/your-studio-background.jpg
# cover_background_course_name: 课程现场背景封面
# cover_background_course_url: https://example.com/your-course-background.png

# 历史封面只在用户明确要求参考或复刻时使用。编号支持 01 至 09。
# cover_case_01_name: 我的历史封面1
# cover_case_01_url: https://example.com/your-cover-case-01.png

# 链接提取的私有术语表。使用绝对路径。
# terminology_file: /absolute/path/my-terminology.md
preserve_raw: true
---

# 必火AI用户配置模板

本文件只保存用户自己的工作流默认值，不保存任何登录凭证。平台账号认证完全由 `agent-bihuoai` MCP 的 OAuth 授权管理。

复制到私有位置：

- macOS / Linux：`~/.bihuoai-skills/bihuoai-digital-human/BIHUOAI_USER_CONFIG.md`
- Windows：`%USERPROFILE%\.bihuoai-skills\bihuoai-digital-human\BIHUOAI_USER_CONFIG.md`

Skill 只读取文件顶部两个 `---` 之间的字段。删除需要启用字段前面的 `#`，并替换示例值。

## 资源获取与校验

1. 连接并授权 `agent-bihuoai` MCP。
2. 使用 `list_avatars` 查询当前账号形象，记录 `trainingId` 和名称。
3. 使用 `list_voices` 查询当前账号声音，记录 `voiceId` 和名称。
4. 把需要的默认值写入本文件。
5. 每次真正创建前仍用实时列表核验资源存在；账号切换后不要沿用旧账号 ID。

形象和声音优先级为：用户本次明确指定 > 形象专用声音映射 > 私有全局默认 > 平台工具默认。公共 Skill 不提供跨账号兜底 ID。

清晰度不配置时默认使用 `version=1`（LITE，较省算力；平台界面可能显示为“高清”）。希望默认使用更高质量的 PRO/超清档时，在私有配置中加入 `default_video_version: 2`。接口只接受 `1` 或 `2`，没有第三个更低清晰度枚举。

文字模式默认使用 `default_speed: 1.0` 和 `default_language_boost: Chinese`。语速必须填写数字；当前 MCP 工具定义没有公开上下限，因此不要自行假设范围。语种增强还可按接口当前枚举改成 `Chinese,Yue`、`English`、`Japanese`、`auto` 等值。当前数字人创建接口不支持情绪、音调或音量参数，不要在配置中填写 `default_emotion`。

## 封面素材

先用 `bihuoai-material-upload` 把本地底图传到平台，取得公网 URL，再填写 `cover_background_*_url`。普通封面默认只用底图和提示词，不自动加入历史封面；只有用户明确要求参考、复刻、沿用或模仿某张案例时，才使用对应的 `cover_case_*`。

模型顺序不保存在私有配置中，统一由封面 Skill 管理：Image 2.5 Sunburst → Image 2.5 Flare → 千问3.0 Pro（默认 2K）。

## 私有术语

公司名、产品名、人名等个人术语可放在独立 Markdown 文件中，再由 `terminology_file` 指向它。上下文证据仍然不足时保留原词，不强制替换。

## 安全边界

- 不要在本文件填写平台登录凭证、Cookie 或一次性上传信息。
- 不要把个人形象 ID、声音 ID、私人 OSS 地址或发布账号 ID 提交到公共仓库。
- 私有文件建议仅允许当前用户读取。
