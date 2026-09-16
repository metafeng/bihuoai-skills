---
name: bihuoai-link-extract
description: 使用必火AI从视频分享链接提取标题和口播文稿，并基于上下文校正 AI 术语和明显的 ASR 同音错误，同时保留原始转写。用户提到链接提取、视频文案提取、分享链接转文字或提取字幕时使用。
---

# 必火AI链接提取

本 Skill 接收视频分享链接或包含链接的分享文本，提取标题和口播文稿，并将接口返回的原始转写整理为可直接使用的上下文校正版。提取结果可作为数字人合成或视频全流程的文案输入，但本 Skill 不创建数字人视频、不剪辑、不发布。

认证只读取 `BIHUOAI_OPEN_KEY` 并发送请求头 `x-open-key`，也可临时传 `--open-key`。不支持其他认证变量；凭证不得写入 Skill、输出文件或仓库。

## 标准流程

1. 运行 `list` 可查看账号已有的提取历史；只读动作不会创建新任务。
2. 新链接先用 `extract --dry-run` 核对请求参数。
3. 链接提取可能按“文案提取”计费，命中平台缓存时可能不扣费。只有用户明确同意后才增加 `--confirm-extract`。
4. 创建后使用 `--wait` 或 `wait --id` 轮询。成功状态为 `1`，失败状态为 `2`；排队 `4` 和处理中 `-2` 均继续等待。
5. 使用 `--output` 将接口原始转写保存为 UTF-8 文本；未成功时不写空文件。
6. 提取成功后读取 [AI 术语与转写校正规则](references/ai-terminology.md)，结合标题、全文语义和相邻句校正术语、固定搭配及明显同音错误。
7. 默认向用户交付校正版，同时保留原始转写。用户只指定 `文稿.txt` 时，接口原文保存为 `文稿.raw.txt`，校正版保存为 `文稿.txt`。

## 上下文校正

校正不是润色或改写。先识别句子谈论的产品、公司和技术领域，再判断发音相近的词是否应替换为标准术语。

- **高置信度**：标准术语与原词发音接近，且标题、上下文或同一段落有明确证据时直接校正。例如办公智能体语境中的“乌克巴里”校正为 `WorkBuddy`，“外部癌症去调上下文”校正为“外部 Agent 去调上下文”。
- **中等置信度**：存在两个以上合理候选时不静默替换；保留原词并在交付说明中写 `疑似：候选词`。
- **低置信度**：没有充分上下文时保留原词，不凭行业常识补造人名、产品名、数字或观点。
- 统一官方拼写和大小写，如 `WorkBuddy`、`Agent`、`ChatGPT`、`DeepSeek`、`MCP`、`RAG`。
- 可修复不会改变原意的断句、重复字和固定搭配，如“接接入”→“接入”、“头把交易”→“头把交椅”、“见分小”→“见分晓”。
- 不删除口语信息，不扩写观点，不改变数字、时间、立场和因果关系。专有名词无法确认时必须标注，而不是猜测。

如果发生了实质校正，交付时简要列出关键修改；简单的大小写、标点和重复字无需逐项报告。用户明确要求“原始文稿”时只返回原始转写，不执行校正。

## 自定义术语

公共术语表不应收录某个用户的私有人名、公司名或内部产品名。需要长期识别专属词汇时，可创建：

```text
~/.bihuoai-skills/bihuoai-link-extract/EXTEND.md
```

示例：

```yaml
---
terminology_file: /绝对路径/我的术语表.md
preserve_raw: true
---
```

执行上下文校正前读取 `terminology_file`。自定义术语表优先于公共词表，但仍须通过上下文核对；配置文件和私有术语表不得提交到公共仓库。

## 命令

```bash
SKILL_DIR=/Users/metafeng/.agents/skills/bihuoai-link-extract
node "$SKILL_DIR/scripts/main.mjs" list
node "$SKILL_DIR/scripts/main.mjs" detail --id 任务ID
node "$SKILL_DIR/scripts/main.mjs" extract --url '视频分享链接' --dry-run
node "$SKILL_DIR/scripts/main.mjs" extract --url '视频分享链接' --confirm-extract --wait --output ./提取文稿.raw.txt
node "$SKILL_DIR/scripts/main.mjs" wait --id 任务ID --output ./提取文稿.raw.txt
```

`--media-only` 会向接口增加 `mediaOnly: true`。常用参数还有 `--page 1`、`--page-size 30`、`--interval 2000`、`--timeout 180`。

## 输出和边界

- CLI 返回 JSON，包括 `taskId`、`status`、`title`、`textContent`、错误信息和原始转写输出路径。
- 不把创建任务当作提取成功；必须等到状态 `1` 并确认 `textContent` 非空。
- 轮询超时不自动创建第二个任务，避免重复计费。
- 原始转写是校正依据，不覆盖、不伪装成接口原文；校正版必须使用单独文件。
- 不在日志、状态文件或仓库中保存 Open Key。

接口摘要见 [接口契约](../bihuoai-video-pipeline/references/api.md)。
