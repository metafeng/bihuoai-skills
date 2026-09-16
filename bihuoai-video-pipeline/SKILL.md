---
name: bihuoai-video-pipeline
description: 编排必火AI数字人合成、智能剪辑和视频发布三个 Skill，从口播文案生成数字人视频，可选剪辑、下载、保存断点并在明确确认后发布。用户要求一站式完成必火AI视频全流程、批量串联或从失败阶段恢复时使用。
---

# 必火AI视频全流程

本 Skill 是编排层，依赖同级三个 Skill：`bihuoai-digital-human`、`bihuoai-smart-clip`、`bihuoai-publish`。共享客户端也存放在本 Skill 中，四个目录应作为一套安装。

整条流程只读取 `BIHUOAI_OPEN_KEY`，以 `x-open-key` 透传到每个子 Skill；也支持一次性 `--open-key`。不支持其他认证变量，状态文件不得保存任何凭证。

## 工作流

```text
口播文案 → TTS 朗读版规范化 → 数字人合成 → 智能剪辑（可跳过） → 视频发布（可跳过）
```

每个有副作用的阶段使用独立确认：

- 数字人合成：`--confirm-create`
- 智能剪辑：`--confirm-clip`
- 正式发布：`--confirm-publish`

用户只同意生成视频，不代表同意发布。发布前仍需展示最终视频、封面、标题、目标账号和定时时间并单独确认。

## 推荐执行方式

先整体预演：

```bash
SKILL_DIR=/Users/metafeng/.agents/skills/bihuoai-video-pipeline
node "$SKILL_DIR/scripts/main.mjs" run --text-file ./口播稿.txt --tts-output ./口播稿.朗读版.txt --title '视频标题' --dry-run --state-file ./必火视频任务.json
```

确认后生成并剪辑：

```bash
node "$SKILL_DIR/scripts/main.mjs" run \
  --text-file ./口播稿.txt \
  --tts-output ./口播稿.朗读版.txt \
  --title '视频标题' \
  --avatar-name '你的形象名称' \
  --voice-name '你的声音名称' \
  --template-name '你选择的模板名称' \
  --confirm-create --confirm-clip \
  --digital-human-output ./数字人原片.mp4 \
  --clip-output ./最终成片.mp4 \
  --state-file ./必火视频任务.json
```

确认发布后，在同一命令增加一个或多个 `--target '平台:uniqueId' --confirm-publish`。不需要剪辑时增加 `--skip-clip`。

文本驱动模式默认继承数字人 Skill 的 TTS 规范化：能确定的年份、数量、日期等转换为中文朗读文本；无法判断的数字保留原样并继续，不询问用户。原始文案不覆盖，`--tts-output` 可保存朗读版；需要完全禁用时增加 `--no-tts-normalize`。

## 断点与恢复

- 始终建议提供 `--state-file`。脚本在每个成功阶段后保存任务 ID、结果和更新时间，权限设为当前用户可读写。
- 再次运行同一命令时，会跳过状态文件里已有的阶段，避免重复生成。
- 智能剪辑返回状态 `5` 时，流程写入 `needsReview` 并停止；人工确认后再继续。
- 使用 `show-state --state-file 文件` 查看进度。
- 状态文件不保存 Open Key，但可能含私有视频 URL，不要提交到公开仓库。

详细接口和用户配置机制见 [references/api.md](references/api.md)。
