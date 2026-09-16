---
name: bihuoai-digital-human
description: 使用必火AI查询数字人形象和克隆声音，在合成前将数字、日期和数量转换为适合中文 TTS 的朗读文本，再按文案或音频创建、查询并下载数字人视频。用户提到必火AI数字人、形象ID、声音ID、口播视频或数字人作品时使用。
---

# 必火AI数字人合成

本 Skill 是系列中的第一步。只负责数字人合成，不承担剪辑和外部发布。

## 首次配置

不要把 Open Key 写进脚本、SKILL.md 或项目仓库。正式接口只使用 `x-open-key`，对应环境变量为 `BIHUOAI_OPEN_KEY`。用户私有配置目录为：

```bash
mkdir -p ~/.bihuoai-skills
chmod 700 ~/.bihuoai-skills
touch ~/.bihuoai-skills/.env
chmod 600 ~/.bihuoai-skills/.env
```

然后在该文件中增加一行 `BIHUOAI_OPEN_KEY=你的OpenKey`。

命令行可临时使用 `--open-key`。不支持其他认证变量或请求头；公开过的凭证应视为已暴露并及时轮换。

用户默认形象、声音、语速和情绪保存在 `~/.bihuoai-skills/bihuoai-digital-human/EXTEND.md`。优先级为：命令参数 > EXTEND.md > 环境变量 > 通用参数默认值。形象和声音属于账号私有资源，本 Skill 不提供跨账号兜底 ID；运行 `show-defaults --verify` 可读取默认值并核对它们是否仍存在于当前账号。

先运行 `list-avatars` 和 `list-voices` 获取当前账号的真实资源，再创建或更新 EXTEND.md：

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

示例值必须替换，不能复制其他用户的形象、声音或模板。形象和声音既可通过 ID 指定，也可仅保留名称并由脚本从当前账号实时解析；优先保存 ID，并同时保存名称用于人工辨认。`avatar_voice_<形象ID>` 可为某个形象指定专用声音；用户在命令中明确传入声音时，命令参数仍优先。

## 标准流程

1. 用户没有明确形象或声音时，先列出当前账号资源；优先展示中文名称和对应 ID。
2. 用户未指定形象或声音时，读取其私有 EXTEND.md；选中形象存在 `avatar_voice_<形象ID>` 映射时优先使用专用声音，否则使用全局默认声音。仍未配置则停止并提示用户选择，不猜测其他账号的资源 ID。
3. 文本驱动模式先生成 TTS 朗读版文案。按 [TTS 朗读文本规范化](references/tts-text-normalization.md) 处理年份、日期、数量、序数、小数、百分比、时间和编号；能确定时转换为中文汉字，无法判断时保留原数字并继续，不询问用户、不阻塞生成。音频驱动模式跳过此步骤。
4. 先用 `--dry-run` 输出合成参数和 `textNormalization`，核对朗读版文案、形象、声音、语速和版本。
5. 只有用户明确同意消耗算力后，才增加 `--confirm-create`。
6. 长任务使用 `--wait`；成功后按用户要求下载。失败时返回作品 ID 和服务端错误，不自动重复创建。

## TTS 朗读版文案

- 默认启用数字语境规范化，真正提交接口的是 `ttsText`，原始文案不覆盖。
- `2020年`转换为“二零二零年”，`2020个人`转换为“两千零二十个人”。
- `2个`转换为“两个”，`第2个`转换为“第二个”，`2.0版本`转换为“二点零版本”。
- 孤立的 `2020`、`2` 或无法识别用途的型号保留原样，直接继续生成。
- 使用 `normalize-text` 可离线预览；增加 `--tts-output ./朗读版.txt` 可单独保存。用户明确要求不转换时增加 `--no-tts-normalize`。

## 命令

```bash
SKILL_DIR=/Users/metafeng/.agents/skills/bihuoai-digital-human
node "$SKILL_DIR/scripts/main.mjs" list-avatars
node "$SKILL_DIR/scripts/main.mjs" list-voices
node "$SKILL_DIR/scripts/main.mjs" show-defaults --verify
node "$SKILL_DIR/scripts/main.mjs" normalize-text --text-file ./口播稿.txt --tts-output ./口播稿.朗读版.txt
node "$SKILL_DIR/scripts/main.mjs" list
node "$SKILL_DIR/scripts/main.mjs" detail --id 作品ID
node "$SKILL_DIR/scripts/main.mjs" create --text-file ./口播稿.txt --tts-output ./口播稿.朗读版.txt --avatar-name '你的形象名称' --voice-name '你的声音名称' --dry-run
node "$SKILL_DIR/scripts/main.mjs" create --title '视频标题' --text-file ./口播稿.txt --tts-output ./口播稿.朗读版.txt --confirm-create --wait --download ./数字人成片.mp4
```

音频驱动模式使用 `--audio-url`，此时不发送文案和声音 ID，也不执行 TTS 文本规范化。常用参数还有 `--version 2`、`--speed 1`、`--emotion calm`、`--timeout 1800`。

## 输出和边界

- 状态：`-2` 等待、`0` 处理中、`1` 成功、`2` 失败。
- 所有脚本结果输出为 JSON，供全流程 Skill 接续。
- `normalize-text` 是离线只读预处理，不调用接口、不消耗算力；歧义数字保留原文。
- 不在列表、详情等只读动作中触发生成。
- 不把失败任务当成功，也不因轮询超时重复扣费。

接口摘要见 [接口契约](../bihuoai-video-pipeline/references/api.md)。
