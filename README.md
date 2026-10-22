# 必火AI Skills

面向[必火全员IP营销平台](https://agent.bihuoai.com)的一组专业工作流 Skills。平台 MCP 负责账号授权、能力调用、数据访问与计费；本仓库负责数字人、封面、剪辑、发布等任务的业务流程、质量规则、默认配置和断点恢复。

## MCP 与 Skills 的关系

- `agent-bihuoai` MCP 是能力层：以当前登录账号调用平台工具，形象、声音、模型、模板、素材和发布账号都来自该账号。
- `$ai-studio` 是平台通用使用说明：覆盖 MCP 提供的大多数工具和通用上传方法，适合临时、非固定流程的任务。
- 本仓库的 Skills 是工作流层：决定先查什么、如何选资源、何时确认费用、如何轮询、怎样质检和怎样避免重复创建。
- 只安装 MCP，或 MCP 加 `$ai-studio`，已经能完成通用操作；需要稳定复用数字语境转换、术语校正、封面设计规范、模型降级或全流程恢复时，仍建议安装本仓库。
- OAuth 登录凭证由客户端和操作系统安全存储。Skill 不读取、不保存，也不要求用户手工填写平台密钥。

## Skill 组成

| Skill | 中文显示名称 | 作用 |
| --- | --- | --- |
| `bihuoai-link-extract` | 必火AI链接提取 | 提取视频口播文稿，并结合上下文校正 AI 术语 |
| `bihuoai-material-upload` | 必火AI素材上传 | 上传本地图片、音频、视频或文档并返回素材 URL |
| `bihuoai-video-cover` | 必火AI视频封面 | 用必火AI生图模型制作中文大字短视频封面 |
| `bihuoai-digital-human` | 必火AI数字人合成 | 规范中文 TTS 朗读文本并创建数字人口播视频 |
| `bihuoai-smart-clip` | 必火AI智能剪辑 | 查询模板并把已有视频制作成智能剪辑成片 |
| `bihuoai-publish` | 必火AI视频发布 | 保存平台稿件，并在确认后提交到指定账号 |
| `bihuoai-video-pipeline` | 必火AI视频全流程 | 串联合成、剪辑和发布，支持断点恢复 |

```text
视频分享链接 → 链接提取（可选） → 数字人合成 → 智能剪辑（可选） → 视频发布（可选）
本地素材 → 素材上传 → 公网 URL → 数字人 / 生图 / 剪辑 / 发布
人物或视频底图 + 标题 → 视频封面 → 封面 URL → 视频发布（可选）
```

## 安装平台 MCP 并授权

安装说明以平台当前页面为准：

```bash
curl -fsSL https://agent.bihuoai.com/oauth/mcp-install
```

Codex 可使用：

```bash
codex mcp add agent-bihuoai --url https://agent.bihuoai.com/v1/mcp
```

随后在客户端发起连接，浏览器会打开必火AI授权页。登录自己的平台账号并同意授权即可。macOS 通常把凭证放在系统钥匙串，Windows 通常放在 Windows 凭据管理器；配置文件只保存 MCP 地址，不保存可直接使用的登录凭证。

若连接提示“该接口未对开放接入密钥开放”，说明平台尚未向 OAuth 接入凭证开放该能力，重复登录不会解决，需要联系平台开通。

## 推荐安装方式：直接告诉 Codex

在 Codex 中新建对话，复制下面整段指令：

```text
请使用 $skill-installer，从 GitHub 公共仓库 metafeng/bihuoai-skills 的 main 分支安装以下 7 个 Skill 到 Codex：

- bihuoai-link-extract
- bihuoai-material-upload
- bihuoai-video-cover
- bihuoai-digital-human
- bihuoai-smart-clip
- bihuoai-publish
- bihuoai-video-pipeline

安装后逐个验证 Skill，并告诉我实际安装位置。不要在 Skill 中写入账号凭证。

然后先用 curl 读取 https://agent.bihuoai.com/oauth/mcp-install 的最新安装说明，再按说明接入名为 agent-bihuoai 的 MCP 服务，并引导我在浏览器完成 OAuth 账号授权。不要改用其他认证方式。
```

Codex 的内置安装器会把这些目录安装到 `$CODEX_HOME/skills`；未设置 `CODEX_HOME` 时默认是 `~/.codex/skills`。安装完成后，从下一轮对话开始使用新 Skill。

如果 Skill 已经存在，不要直接覆盖。先确认它来自哪个仓库，再决定更新还是保留本地改动。

## 手动安装

需要自己维护 Git 仓库时，可以克隆后链接到 Codex：

```bash
git clone https://github.com/metafeng/bihuoai-skills.git
cd bihuoai-skills
mkdir -p ~/.codex/skills

for skill in \
  bihuoai-link-extract \
  bihuoai-material-upload \
  bihuoai-video-cover \
  bihuoai-digital-human \
  bihuoai-smart-clip \
  bihuoai-publish \
  bihuoai-video-pipeline
do
  ln -s "$PWD/$skill" "$HOME/.codex/skills/$skill"
done
```

Claude Code 和 WorkBuddy 可分别链接到它们自己的 Skills 目录。若目标位置已有同名目录，先核对来源，不要直接覆盖。

## 初始化用户默认配置

安装和授权完成后，在新的 Codex 对话中复制下面的指令：

```text
请帮我初始化必火AI用户配置：

1. 从 https://raw.githubusercontent.com/metafeng/bihuoai-skills/main/BIHUOAI_USER_CONFIG.example.md 读取公开模板。
2. 将模板保存为我本机的私有配置：
   - macOS / Linux：~/.bihuoai-skills/bihuoai-digital-human/BIHUOAI_USER_CONFIG.md
   - Windows：%USERPROFILE%\.bihuoai-skills\bihuoai-digital-human\BIHUOAI_USER_CONFIG.md
3. 使用 $bihuoai-digital-human，通过已授权的 agent-bihuoai MCP，只读查询当前账号“我的形象”和声音，列出名称与 ID，不创建视频、不产生生成费用。
4. 让我选择默认形象和默认声音；得到我的选择后，再把对应的 trainingId、voiceId、名称写入 BIHUOAI_USER_CONFIG.md。
5. 不要把 OAuth 凭证、Cookie、临时上传信息或其他账号的资源写入配置文件。
6. 写入后重新读取配置，只显示字段名称和所选资源名称，不输出任何登录凭证。
```

如果只想先创建空白配置，也可以手动执行。

macOS / Linux：

```bash
config_dir="$HOME/.bihuoai-skills/bihuoai-digital-human"
mkdir -p "$config_dir"
curl -fsSL \
  https://raw.githubusercontent.com/metafeng/bihuoai-skills/main/BIHUOAI_USER_CONFIG.example.md \
  -o "$config_dir/BIHUOAI_USER_CONFIG.md"
chmod 600 "$config_dir/BIHUOAI_USER_CONFIG.md"
```

Windows PowerShell：

```powershell
$configDir = Join-Path $env:USERPROFILE ".bihuoai-skills\bihuoai-digital-human"
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
Invoke-WebRequest `
  -Uri "https://raw.githubusercontent.com/metafeng/bihuoai-skills/main/BIHUOAI_USER_CONFIG.example.md" `
  -OutFile (Join-Path $configDir "BIHUOAI_USER_CONFIG.md")
```

配置文件可以保存以下用户默认值：

- 默认数字人形象和声音。
- 默认成片档位；不配置时使用较省算力的 `version=1`，需要 PRO/超清时设置 `default_video_version: 2`。
- 某个形象专用的声音搭配。
- 默认语速、TTS 语种增强和数字规范化开关。
- 视频封面默认底图与用户主动选择时才使用的历史封面。
- 链接提取使用的私有术语表路径。

账号切换后应重新查询形象和声音，不要继续沿用旧账号的资源 ID。

## Codex 中的中文显示名称

7 个 Skill 的 `agents/openai.yaml` 都已经配置中文 `display_name`。在支持该元数据的 Codex 界面中，Skill 列表和选择入口会显示中文名称：

| 中文显示名称 | 提示词中的调用标识 |
| --- | --- |
| 必火AI链接提取 | `$bihuoai-link-extract` |
| 必火AI素材上传 | `$bihuoai-material-upload` |
| 必火AI视频封面 | `$bihuoai-video-cover` |
| 必火AI数字人合成 | `$bihuoai-digital-human` |
| 必火AI智能剪辑 | `$bihuoai-smart-clip` |
| 必火AI视频发布 | `$bihuoai-publish` |
| 必火AI视频全流程 | `$bihuoai-video-pipeline` |

中文名称用于界面展示；文件夹名、Skill 技术标识和提示词中的 `$skill-name` 仍使用英文小写名称。这能保证 Codex、终端和其他客户端跨平台兼容。部分只显示技术标识的客户端可能仍会看到英文名称，但不会影响使用。

## 使用原则

1. 先确认 `agent-bihuoai` MCP 已连接并完成浏览器授权。
2. 资源 ID 一律通过平台实时列表取得，不复制其他账号的形象、声音、模板或发布账号 ID。
3. 本地文件先使用 `bihuoai-material-upload` 转成公网 URL。
4. 工具说明标注会扣费的操作，调用前必须向用户说明并取得明确确认。
5. 创建类工具返回任务 ID 只代表已提交；使用对应状态工具查询，间隔不少于 15 秒。
6. 超时或状态不明时继续查询原任务，不重新创建，避免重复扣费。
7. 发布是独立的对外操作，数字人或剪辑生成的确认不等于发布确认。

## 私有默认配置

形象、声音、封面底图和个人术语可以保存在本机私有配置中，不提交到仓库：

- macOS / Linux：`~/.bihuoai-skills/bihuoai-digital-human/BIHUOAI_USER_CONFIG.md`
- Windows：`%USERPROFILE%\.bihuoai-skills\bihuoai-digital-human\BIHUOAI_USER_CONFIG.md`

公开模板见 [BIHUOAI_USER_CONFIG.example.md](./BIHUOAI_USER_CONFIG.example.md)。复制后去掉 `.example`，作为用户自己的 `BIHUOAI_USER_CONFIG.md`。Skill 会优先采用用户在本次任务中明确指定的资源，其次读取私有默认；最终仍要通过 MCP 的实时列表核验资源属于当前授权账号。

## 各 Skill 的核心行为

### 链接提取

调用 `extract_content` 获得平台原始转写，原文单独保存；随后依据 [AI 术语表](./bihuoai-link-extract/references/ai-terminology.md) 生成上下文校正版。校正不是润色，无法确认的专有词保留原文并标注疑点。

### 素材上传

本地文件先由 `scripts/upload.mjs stat` 计算文件名、大小和 MD5，再调用 MCP 的 `prepare_file_upload`。未命中秒传时，用返回的一次性上传信息执行 `scripts/upload.mjs put`。最终 URL 可交给其他平台工具。

### 数字人合成

使用 `list_avatars` 和 `list_voices` 核验形象及声音，然后调用 `create_digital_human_video`。文本驱动模式会先生成 TTS 朗读版，例如把年份 `2020年` 转成“二零二零年”、数量 `2个` 转成“两个”；用途不明确的数字保留原样并继续，不询问、不阻塞。

清晰度未指定时，公共 Skill 固定使用较省算力的 `version=1`（LITE，平台界面可能显示为“高清”）。只有用户本次明确选择更高质量，或私有 `BIHUOAI_USER_CONFIG.md` 写有 `default_video_version: 2` 时，才使用 PRO/超清。当前接口只有 `1` 和 `2` 两档，没有第三个更低清晰度枚举。

文字模式支持通过 `default_speed` 设置默认语速，通过 `default_language_boost` 设置 TTS 语种增强；公开模板默认分别为 `1.0` 和 `Chinese`。生成时 Skill 会把两项实际传给 MCP，用户本次明确指定的值优先于私有配置。当前 MCP 创建接口未公开语速上下限，也没有情绪、音调、音量、背景音乐或字幕样式参数，因此配置文件不再提供 `default_emotion`。

当前可选择的创建参数包括：视频名称、数字人形象、LITE/PRO 档位，以及文字模式的文案、声音、语速、语种增强；也可以改用公网音频 URL 直接驱动。音频模式不同时传文字、声音 ID、语速或语种增强。

### 视频封面

默认使用“人物或视频底图 + 提示词”，不强制提供历史封面。模型顺序为：

1. `gpt-image-2.5-sunburst`
2. `gpt-image-2.5-flare`
3. `qwen-image-3.0-pro`，默认 2K

只有当前模型明确失败、没有产生图片，且原因不是余额、权限、审核或参数错误时才尝试下一模型。轮询超时和状态未知不自动降级。历史封面只在用户明确要求参考或复刻时加入。

### 智能剪辑与发布

智能剪辑使用实时模板列表、创建任务并查询状态；编辑模式需要在平台页面人工确认。发布先保存平台稿件，再针对一个账号提交一次。最终发布由用户电脑上的必火AI桌面客户端执行，因此 MCP 提交成功不能替代平台最终送达回执。

## 故障排查

- MCP 未连接或授权失效：重新连接 `agent-bihuoai` 并完成浏览器授权。
- 资源找不到：重新调用相应的 `list_*` 工具，确认资源属于当前账号。
- 余额、套餐或额度不足：到[必火全员IP营销平台](https://agent.bihuoai.com)处理后再继续。
- 请求频繁：降低并发并稍后重试。
- 异步任务超时：记录任务 ID，继续查询原任务，不重复创建。

## 安全

- 仓库不包含账号凭证、Cookie、个人形象 ID、声音 ID、私人 OSS 地址或发布账号 ID。
- 不把 OAuth 凭证写入 Skill、提示词、日志、任务状态或 Git 仓库。
- 私有 `BIHUOAI_USER_CONFIG.md`、任务回执和带签名的临时上传信息不得提交到公开仓库。
- 日志只保留任务 ID、状态和必要错误，不输出一次性上传签名。

## License

按仓库维护者公布的许可证使用；平台能力、账号权限、计费和内容规范以必火全员IP营销平台当前规则为准。
