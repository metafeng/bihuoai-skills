# 必火AI接口契约

本文记录从必火AI工作台请求链路核对出的接口。2026-09-16 起正式认证只使用 Open Key；接口变更时应重新从平台文档或实际请求核对。

## 基础配置

- 主接口：`https://ai-api.aigcoem.com/v1`
- 智能剪辑：`https://ai-api.aigcoem.com/v1/ai-cut`
- 正式请求头：`x-open-key: <open-key>`、`Content-Type: application/json`、`lang: zh`
- 经销商识别还依赖 `Origin: https://agent.bihuoai.com` 和对应 `Referer`
- 返回 `10197` 表示当前 Open Key 未获该接口权限。停止该动作并报告具体接口，不自动重试、不自动切换其他凭证；开放范围可能因账号或 Key 而异。

## 数字人

- `POST /training/list`、`POST /training/list/public`
- `POST /voice-clone/list`、`POST /voice-clone/system`
- `POST /dh-video/create`、`POST /dh-video/list`
- `GET /dh-video/detail/:id`

文案模式请求体核心字段：`videoName`、`version`、`trainingId`、`text`、`voiceId`、`voiceExtra`。音频模式使用 `audioUrl`。

形象和声音 ID 属于各账号私有资源，不提供公共兜底值。用户可通过列表接口选择资源，并在 `~/.bihuoai-skills/bihuoai-digital-human/EXTEND.md` 中保存自己的默认形象和声音。

## 链接提取

- `POST /transcript/extract`，请求体为 `url` 和可选的 `mediaOnly: true`
- `POST /transcript/list`，请求体为 `page`、`limit`
- `GET /transcript/task/:taskId`

状态为 `4` 时排队、`-2` 时处理中、`1` 时成功、`2` 时失败。成功结果包含 `taskId`、`title` 和 `textContent`。链接提取可能计费，创建任务前必须明确确认；轮询超时不得自动重复创建。

## 素材上传

- `POST /oss/pre-upload`
- 请求体必需字段：`fileName`、`businessType`、`hash`；工作台固定发送 `from: 0`，素材库分组可选传 `groupId`
- 已确认业务类型：图片 `2`、音频 `3`、视频 `4`、临时文件 `16`
- 预上传未命中秒传时，使用响应中的 `host`、`key`、`policy`、`OSSAccessKeyId`、`signature`、`callback`、`Content-Disposition` 和文件执行 OSS 表单上传
- OSS 成功后使用响应的 `uploadUrl`，不要自行拼接地址

接口还接受 `1、7、8、9、15`，但当前前端没有稳定的公开语义，不应猜测或自动使用。临时 OSS 签名字段不得输出、保存或提交仓库。真实上传前必须明确确认。

## 智能剪辑

- `POST /clip-task`、`POST /clip-task/list`
- `GET /clip-task/:taskId`
- `POST /clip-task/:taskId/confirm`
- `POST /clip-video-template/list`

最小请求体包含 `template`、`workName`、`video: []`、`source.main.type: dh`、`source.main.dhVideoId` 和 `coverConfig`。模板编码必须来自当前账号实时模板列表，不提供跨账号默认模板。

## 视频发布

- `POST /publication-account/list`
- `GET /pub-platform`
- `POST /pub-article`、`POST /pub-article/list`
- `POST /publication/submit`、`POST /publication/list`
- `POST /publication/:id/retry`

视频稿件 `type` 为 `2`。每个发布目标提交 `articleId`、`platform`、`uniqueId`，可选 `scheduledAt`。

## 安全约束

- Open Key 从 `BIHUOAI_OPEN_KEY`、`--open-key` 或用户私有 `.env` 读取，不支持其他认证方式。
- 任何认证凭证都不输出、不写入状态文件、不提交仓库。
- 合成、剪辑、发布分别确认；不因轮询超时自动新建任务。
- 发布是外部副作用，必须展示目标并取得明确确认。
