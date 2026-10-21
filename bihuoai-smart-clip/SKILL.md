---
name: bihuoai-smart-clip
description: 通过必火全员IP营销平台 MCP 查询剪辑模板，把已有主视频或数字人成片生成智能剪辑任务，并查询进度、处理编辑确认和交付成片。用户提到智能剪辑、数字人二剪、剪辑模板或剪辑任务时使用。
---

# 必火AI智能剪辑

本 Skill 接收已有视频，不在这里重新创建数字人。

## 连接规则

- 使用客户端已完成 OAuth 授权的 `agent-bihuoai` MCP，不处理任何平台凭证。
- MCP 不可用时按 `https://agent.bihuoai.com/oauth/mcp-install` 引导连接。
- 工具参数变化时先调用 `get_usage_guide`。

## 标准流程

1. 确认已有可用的 `mainVideoUrl`，或数字人任务已成功并取得视频 URL。本地视频先用 `bihuoai-material-upload`。
2. 调用 `list_clip_templates`，展示名称和 `templateCode`。用户未选择时停止，不使用其他账号或历史任务的模板编码。
3. 根据模板要求准备 `script`、`voiceId`、`trainingId`、`avatarUrl`、`materialUrls` 或 `mainVideoUrl`；只传当前模板实际需要的字段。
4. 展示预检：模板、主视频、标题、模式和补充素材。工具说明标注会扣费时，取得明确确认后调用 `create_clip_task`。
5. 默认 `mode=auto`。需要人工调整时用编辑模式；任务进入待确认后调用 `open_web_page` 打开平台剪辑页，由用户检查和确认。
6. 保存任务 ID，用 `get_clip_task_status` 查询，未完成时间隔不少于 15 秒。
7. 成功后返回成片 URL；失败时保留任务 ID和平台错误。超时或未知状态不重新创建。

## 边界

- 不把数字人作品 ID 当作成片 URL；按当前工具字段传入正确来源。
- 编辑模式的人工确认不能由 Skill 擅自代替。
- 只读模板和状态查询不得触发创建。
- 剪辑完成后不自动发布。
