---
name: bihuoai-publish
description: 使用必火AI发布中心查询已绑定账号和平台、保存视频草稿、正式发布或定时发布并查询发布记录。用户提到必火AI发布、视频分发、绑定账号、定时发布、重试发布或发布记录时使用。
---

# 必火AI视频发布

发布属于对外操作。默认只查询账号和平台，不默认创建草稿，更不默认提交发布。

认证只读取 `BIHUOAI_OPEN_KEY` 并发送 `x-open-key`，也可临时传 `--open-key`。不支持其他认证变量；不要记录或提交任何凭证。

## 标准流程

1. 运行 `list-accounts` 和 `list-platforms`，把账号名称、平台和 `uniqueId` 展示给用户选择。
2. 发布前核对标题、视频 URL、封面、摘要、目标账号和定时时间。
3. 只保存平台内草稿时，要求用户明确同意并增加 `--confirm-save`。
4. 正式发布或定时发布时，必须再次取得明确确认，并增加 `--confirm-publish`。
5. 一个 `--target` 对应一个账号；多个目标逐个提交并分别返回结果。

## 命令

```bash
SKILL_DIR=/Users/metafeng/.agents/skills/bihuoai-publish
node "$SKILL_DIR/scripts/main.mjs" list-accounts
node "$SKILL_DIR/scripts/main.mjs" list-platforms
node "$SKILL_DIR/scripts/main.mjs" list-publications
node "$SKILL_DIR/scripts/main.mjs" create-draft --title '标题' --video-url 'https://...' --cover-url 'https://...' --summary '摘要' --confirm-save
node "$SKILL_DIR/scripts/main.mjs" publish --title '标题' --video-url 'https://...' --cover-url 'https://...' --target '平台编码:账号uniqueId' --confirm-publish
node "$SKILL_DIR/scripts/main.mjs" publish --article-id 稿件ID --target '平台编码:账号uniqueId' --scheduled-at '2026-08-26T10:00:00+08:00' --confirm-publish
```

重试和删除记录也分别需要 `--confirm-retry`、`--confirm-delete`。不要猜平台编码或账号 ID，必须来自当前账号的实时列表。

接口摘要见 [接口契约](../bihuoai-video-pipeline/references/api.md)。
