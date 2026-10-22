---
name: bihuoai-video-pipeline
description: 通过必火全员IP营销平台 MCP 编排文案创作、数字人合成、智能剪辑和视频发布，从选题、想法、参考链接或已确认口播稿生成视频，可选封面、下载和发布，并保存任务状态支持断点恢复。用户要求一站式完成必火AI视频全流程或从失败阶段恢复时使用。
---

# 必火AI视频全流程

本 Skill 是编排层，复用同系列文案创作、链接提取、数字人、素材上传、视频封面、智能剪辑和发布规则。所有平台动作通过 `agent-bihuoai` MCP 完成。

```text
选题 / 想法 / 分享链接 → 必火AI文案创作 → 用户确认文案 → TTS 朗读版 → 数字人合成 → 封面（可选） → 智能剪辑（可选） → 发布（可选）
```

## 连接规则

- 使用客户端已完成 OAuth 授权的 `agent-bihuoai` MCP，不处理任何平台凭证。
- MCP 不可用时按 `https://agent.bihuoai.com/oauth/mcp-install` 引导连接，不回退到直连接口。
- 首次使用或工具字段不清楚时先调用 `get_usage_guide`。
- 形象、声音、模型、模板和发布账号 ID 都从当前账号的实时列表取得，不猜、不跨账号复用。

## 独立确认

以下阶段分别确认，前一步授权不自动覆盖后一步：

1. 链接提取或其他标注会扣费的内容处理。
2. 数字人合成。
3. 封面生图。
4. 智能剪辑。
5. 正式或定时发布。

批量任务可以一次说明总数量和费用影响后确认，但仍要逐个保存任务 ID。发布前必须再次展示最终视频、封面、标题、目标账号和定时时间。

## 标准流程

1. 创建本地状态文件，先记录输入来源、标题和各阶段为 `pending`。状态文件不得包含账号凭证或一次性上传信息。
2. 输入是分享链接时先按 `bihuoai-link-extract` 提取并保留原始文稿；输入是本地文件时按 `bihuoai-material-upload` 得到 URL。提取结果和用户资料只是文案素材，不直接当作最终口播稿。
3. 用户提供选题、想法或参考素材时，必须调用 `bihuoai-copywriting` 生成标题、口播正文和发布描述；不得由全流程 Skill 自行临时撰写。用户已经提供并明确确认口播稿时，记录为 `confirmed_input` 并跳过改写。
4. 展示完整文案并让用户确认。文案未确认时，不进入会产生费用的数字人、封面或剪辑阶段。确认后的正文写入状态文件或关联文稿路径，后续阶段不得静默改写。
5. 按 `bihuoai-digital-human` 生成朗读版，实时选择形象和声音，确认后调用 `create_digital_human_video`。立即保存 `dhVideoId`。
6. 用 `get_dh_video_status` 查询原任务；成功后保存 `videoUrl`。
7. 用户需要封面时按 `bihuoai-video-cover` 独立预检、确认、创建和质检，保存生图任务 ID 与封面 URL。
8. 用户需要剪辑时调用 `list_clip_templates` 选模板，确认后 `create_clip_task`，保存任务 ID，并用 `get_clip_task_status` 查询。编辑模式等待用户在平台页面确认。
9. 用户需要发布时先调用 `create_pub_article` 保存稿件；展示最终预检并取得独立确认后，对每个账号分别调用 `submit_publication`。
10. 每个异步任务至少间隔 15 秒查询。完成、失败、待人工确认或用户停止时更新状态文件。

如果本机没有安装 `bihuoai-copywriting`，在需要写新文案时停止并提示安装，不得退回到没有规则约束的临时写作。已经确认的口播稿仍可继续进入视频阶段。

## 状态文件

建议结构：

```json
{
  "title": "视频标题",
  "source": {},
  "copywriting": {"status": "pending", "mode": null, "documentPath": null, "confirmedAt": null},
  "digitalHuman": {"status": "pending", "taskId": null, "videoUrl": null},
  "cover": {"status": "skipped", "taskId": null, "imageUrl": null},
  "clip": {"status": "skipped", "taskId": null, "videoUrl": null},
  "publication": {"status": "skipped", "articleId": null, "submissions": []},
  "updatedAt": null
}
```

- 每次创建成功拿到任务 ID 后立刻原子更新状态文件，再开始等待。
- 重启后先读状态文件，并查询已有任务；已存在任务 ID 时绝不重新创建。
- 状态未知、客户端断线或轮询超时都不是重建依据。
- 状态文件可能含私有媒体 URL，应保存在工作区私有位置，不提交公共仓库。

## 完成判定

- 数字人、封面和剪辑分别以对应状态工具返回成功且存在结果 URL 为准。
- 发布提交成功不等于外部平台发布成功；最终状态需要平台记录或桌面客户端回执。
- 任一阶段失败时保留已有成果和任务 ID，从失败阶段继续，不回滚或重跑已完成阶段。
