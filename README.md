# 必火AI Skills

面向必火AI的一套视频生产 Skills，将链接提取、素材上传、数字人合成、智能剪辑和视频发布拆分为独立能力，并提供可恢复的一站式编排流程。

> 本仓库不包含 Open Key、Cookie、生成视频或发布凭证。使用前需要配置自己的必火AI Open Key。

## Skill 组成

| Skill | 中文显示名称 | 作用 |
| --- | --- | --- |
| `bihuoai-link-extract` | 必火AI链接提取 | 提取视频口播文稿，并结合上下文校正 AI 术语 |
| `bihuoai-material-upload` | 必火AI素材上传 | 上传本地图片、音频、视频或临时文件并返回素材 URL |
| `bihuoai-digital-human` | 必火AI数字人合成 | 规范中文 TTS 朗读文本，创建数字人视频并下载成片 |
| `bihuoai-smart-clip` | 必火AI智能剪辑 | 查询模板，将数字人作品生成智能剪辑成片 |
| `bihuoai-publish` | 必火AI视频发布 | 查询发布账号、保存草稿、正式或定时发布 |
| `bihuoai-video-pipeline` | 必火AI视频全流程 | 串联合成、剪辑和发布，支持断点恢复 |

工作流：

```text
视频分享链接 → 链接提取（可选） → 数字人合成 → 智能剪辑（可选） → 视频发布（可选）
本地素材文件 → 素材上传 → 素材 URL → 数字人 / 智能剪辑 / 视频发布
```

## 服务地址

- 工作台：`https://agent.bihuoai.com`
- 主接口：`https://ai-api.aigcoem.com/v1`
- 智能剪辑：`https://ai-api.aigcoem.com/v1/ai-cut`

接口仍可能随平台升级而变化。出现登录正常但 API 返回异常时，应重新核对浏览器网络请求和当前前端资源。

## 环境要求

- Node.js 18 或更高版本
- 可访问必火AI工作台
- 当前账号有效的 Open Key
- Codex、Claude Code 或 WorkBuddy 等支持本地 Skills 的客户端

## 安装

克隆仓库：

```bash
git clone git@github.com:metafeng/bihuoai-skills.git
cd bihuoai-skills
```

建议保留本仓库作为唯一维护源，再把六个 Skill 软链接到客户端目录。以 Codex 为例：

```bash
mkdir -p ~/.codex/skills
for skill in \
  bihuoai-link-extract \
  bihuoai-material-upload \
  bihuoai-digital-human \
  bihuoai-smart-clip \
  bihuoai-publish \
  bihuoai-video-pipeline
do
  ln -s "$PWD/$skill" "$HOME/.codex/skills/$skill"
done
```

Claude Code 和 WorkBuddy 可分别链接到 `~/.claude/skills`、`~/.workbuddy/skills`。如果目标位置已存在同名目录，请先检查，不要直接覆盖。

## 配置 Open Key

Open Key 只保存在用户私有目录，不要写入仓库：

```bash
mkdir -p ~/.bihuoai-skills
chmod 700 ~/.bihuoai-skills
touch ~/.bihuoai-skills/.env
chmod 600 ~/.bihuoai-skills/.env
```

在 `~/.bihuoai-skills/.env` 中添加：

```text
BIHUOAI_OPEN_KEY=你的OpenKey
```

六个 Skill 只读取 `BIHUOAI_OPEN_KEY`，并发送请求头 `x-open-key`。也可以在单次命令使用 `--open-key`，但应避免让凭证进入终端历史。不支持其他认证变量或请求头。

也可以按需覆盖接口：

```text
BIHUOAI_API_BASE=https://ai-api.aigcoem.com/v1
BIHUOAI_CLIP_API_BASE=https://ai-api.aigcoem.com/v1/ai-cut
BIHUOAI_WEB_ORIGIN=https://agent.bihuoai.com
```

## 配置数字人默认资源

默认形象、声音、语速和情绪保存在用户私有配置中，不提交到仓库：

```text
~/.bihuoai-skills/bihuoai-digital-human/EXTEND.md
```

配置示例：

```yaml
---
default_avatar_id: 12345
default_avatar_name: 你的形象名称
default_voice_id: voice_请替换为你的声音ID
default_voice_name: 你的声音名称
default_speed: 1.0
default_emotion: calm
tts_normalize: true
avatar_voice_12345: voice_该形象专用的声音ID
---
```

示例中的 ID 和名称必须替换为 `list-avatars`、`list-voices` 返回的当前账号资源。`avatar_voice_<形象ID>` 可以让指定形象自动使用专用声音；没有映射时使用全局默认声音。优先级为：命令参数 > 形象专用声音映射 > EXTEND.md 全局默认 > 环境变量。公共 Skill 不内置任何用户的形象或声音，迁移账号或平台升级后应重新核验。

## 快速使用

### 1. 链接提取

先预演，再在确认可能产生计费后创建任务：

```bash
node bihuoai-link-extract/scripts/main.mjs extract \
  --url '视频分享链接' \
  --dry-run

node bihuoai-link-extract/scripts/main.mjs extract \
  --url '视频分享链接' \
  --confirm-extract --wait \
  --output ./提取文稿.raw.txt
```

接口原文应保存为 `提取文稿.raw.txt`。Skill 会结合标题、全文上下文和内置 AI 术语表生成 `提取文稿.txt` 校正版，并保留原始文件供追溯；存在歧义的专有名词不会被静默猜测。校正版可以作为数字人合成的 `--text-file` 输入。排队或处理超时不会自动重复创建任务。

通用术语表位于 `bihuoai-link-extract/references/ai-terminology.md`。用户自己的公司名、产品名或人名不要写入公共仓库，可在 `~/.bihuoai-skills/bihuoai-link-extract/EXTEND.md` 中通过 `terminology_file` 指向私有术语表。

### 2. 素材上传

上传需要本地文件路径。先检查并预演；真实上传必须显式确认：

```bash
node bihuoai-material-upload/scripts/main.mjs inspect \
  --file ./素材.mp4

node bihuoai-material-upload/scripts/main.mjs preflight \
  --file ./素材.mp4

node bihuoai-material-upload/scripts/main.mjs upload \
  --file ./素材.mp4 \
  --confirm-upload
```

脚本会自动判断图片、音频、视频或临时文件，计算 MD5，优先使用秒传；未命中时再流式上传到 OSS。成功输出的 `url` 可以直接交给数字人、剪辑或发布 Skill。临时签名字段不会写入命令输出。

### 3. 数字人合成

先查询当前账号资源：

```bash
node bihuoai-digital-human/scripts/main.mjs list-avatars
node bihuoai-digital-human/scripts/main.mjs list-voices
node bihuoai-digital-human/scripts/main.mjs show-defaults --verify
node bihuoai-digital-human/scripts/main.mjs normalize-text \
  --text '2020年有2个方案，第2个优先。' \
  --tts-output ./口播稿.朗读版.txt
```

文本驱动模式默认在合成前生成 TTS 朗读版：年份 `2020年` 转为“二零二零年”，数量 `2个` 转为“两个”，序数 `第2个` 转为“第二个”。无法判断用途的孤立数字保持原样，并继续生成，不会询问或阻塞。原始文案不会被覆盖；可用 `--no-tts-normalize` 关闭此功能。

先预演参数：

```bash
node bihuoai-digital-human/scripts/main.mjs create \
  --text '这是一条测试文案。' \
  --avatar-name '你的形象名称' \
  --voice-name '你的声音名称' \
  --dry-run
```

确认后创建并等待成片：

```bash
node bihuoai-digital-human/scripts/main.mjs create \
  --title '视频标题' \
  --text-file ./口播稿.txt \
  --tts-output ./口播稿.朗读版.txt \
  --avatar-name '你的形象名称' \
  --voice-name '你的声音名称' \
  --confirm-create --wait \
  --download ./数字人成片.mp4
```

### 4. 智能剪辑

```bash
node bihuoai-smart-clip/scripts/main.mjs list-templates

node bihuoai-smart-clip/scripts/main.mjs create \
  --dh-video-id 数字人作品ID \
  --template-name '你选择的模板名称' \
  --confirm-clip --wait \
  --download ./智能剪辑成片.mp4
```

如果任务返回状态 `5`，表示等待人工确认。不得默认确认，应先检查后再使用 `confirm-review --confirm-review`。

### 5. 视频发布

先查询平台和已绑定账号：

```bash
node bihuoai-publish/scripts/main.mjs list-platforms
node bihuoai-publish/scripts/main.mjs list-accounts
```

正式发布前必须确认标题、视频、封面、账号和时间：

```bash
node bihuoai-publish/scripts/main.mjs publish \
  --title '视频标题' \
  --video-url 'https://example.com/video.mp4' \
  --cover-url 'https://example.com/cover.jpg' \
  --target '平台编码:账号uniqueId' \
  --confirm-publish
```

### 6. 视频全流程

建议使用状态文件，避免中断后重复消耗算力：

```bash
node bihuoai-video-pipeline/scripts/main.mjs run \
  --title '视频标题' \
  --text-file ./口播稿.txt \
  --tts-output ./口播稿.朗读版.txt \
  --avatar-name '你的形象名称' \
  --voice-name '你的声音名称' \
  --template-name '你选择的模板名称' \
  --confirm-create --confirm-clip \
  --state-file ./视频任务状态.json
```

发布是独立授权。只同意生成或剪辑，不代表同意发布；只有提供目标账号并增加 `--confirm-publish` 才会提交发布。

## 安全设计

- 链接提取必须显式增加 `--confirm-extract`。
- 素材上传必须显式增加 `--confirm-upload`。
- 数字人合成必须显式增加 `--confirm-create`。
- 智能剪辑必须显式增加 `--confirm-clip`。
- 正式发布必须显式增加 `--confirm-publish`。
- 轮询超时不会自动创建新任务，避免重复扣费。
- 全流程状态文件不保存 Open Key，但可能包含私有视频 URL，不要提交到仓库。
- Open Key 可能被服务端撤销；认证失败时应重新生成凭证，不要把凭证写入错误日志或仓库。

## 目录结构

```text
.
├── bihuoai-link-extract/
│   └── references/ai-terminology.md
├── bihuoai-material-upload/
│   ├── references/api.md
│   └── scripts/main.mjs
├── bihuoai-digital-human/
│   ├── references/tts-text-normalization.md
│   └── scripts/tts-normalize.mjs
├── bihuoai-smart-clip/
├── bihuoai-publish/
└── bihuoai-video-pipeline/
    ├── references/api.md
    └── scripts/bihuo-client.mjs
```

五个业务 Skill 共用 `bihuoai-video-pipeline/scripts/bihuo-client.mjs`，因此六个目录应作为一整套安装和更新。

## 校验

```bash
for skill in bihuoai-*; do
  python3 ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py "$skill"
done
```

正式生成前建议先运行列表接口和 `--dry-run`。下载后的成片可以使用 `ffprobe` 检查时长、编码和分辨率。
