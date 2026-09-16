---
name: bihuoai-smart-clip
description: 使用必火AI智能剪辑，把已有数字人作品按模板生成剪辑任务，查询进度、处理人工审核节点并下载成片。用户提到智能剪辑、数字人二剪、剪辑模板、剪辑任务或等待确认时使用。
---

# 必火AI智能剪辑

本 Skill 接收数字人作品 ID，生成智能剪辑成片。不要在这里重新创建数字人。

认证只读取 `BIHUOAI_OPEN_KEY` 并发送 `x-open-key`，也可临时传 `--open-key`。不支持其他认证变量；不要记录或提交任何凭证。

## 标准流程

1. 先确认数字人任务已成功，并取得 `dhVideoId`。
2. 先实时查询当前账号可用模板。用户没有选择模板时停止，不使用其他账号的模板名称或编码。
3. 先用 `--dry-run` 核对模板、作品 ID、标题和封面模式。
4. 只有用户明确同意可能产生的算力消耗后，才增加 `--confirm-clip`。
5. 轮询在完成、失败或等待人工确认时停止。状态 `5` 必须交给用户检查，不得默认确认。
6. 只有得到明确确认后，才运行 `confirm-review --confirm-review`。

## 命令

```bash
SKILL_DIR=/Users/metafeng/.agents/skills/bihuoai-smart-clip
node "$SKILL_DIR/scripts/main.mjs" list-templates
node "$SKILL_DIR/scripts/main.mjs" list
node "$SKILL_DIR/scripts/main.mjs" create --dh-video-id 作品ID --template-name '你选择的模板名称' --dry-run
node "$SKILL_DIR/scripts/main.mjs" create --dh-video-id 作品ID --template-name '你选择的模板名称' --confirm-clip --wait --download ./剪辑成片.mp4
node "$SKILL_DIR/scripts/main.mjs" wait --id 剪辑任务ID
node "$SKILL_DIR/scripts/main.mjs" confirm-review --id 剪辑任务ID --config ./审核配置.json --confirm-review
```

复杂剪辑参数可使用 `--config ./任务配置.json` 直接提供完整请求体。

## 状态

- `-2` 预处理
- `-1` 就绪
- `4` 处理中
- `1` 完成
- `2` 失败
- `5` 等待人工确认

接口摘要见 [接口契约](../bihuoai-video-pipeline/references/api.md)。
