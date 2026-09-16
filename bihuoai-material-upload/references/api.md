# 必火AI素材上传接口

核对日期：2026-09-17。接口可能随平台升级变化，异常时应重新对照必火AI工作台的实际请求。

## 1. 申请 OSS 上传签名

`POST https://ai-api.aigcoem.com/v1/oss/pre-upload`

请求头：

```text
x-open-key: <BIHUOAI_OPEN_KEY>
Content-Type: application/json
lang: zh
Origin: https://agent.bihuoai.com
Referer: https://agent.bihuoai.com/
```

请求体：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `fileName` | 是 | OSS 目标文件名，只传文件名，不传本地路径 |
| `businessType` | 是 | 已确认：图片 `2`、音频 `3`、视频 `4`、临时文件 `16` |
| `hash` | 是 | 文件内容的 MD5，小写十六进制；缺失时服务端返回“上传缺少文件 hash(md5)” |
| `from` | 前端固定 | 当前工作台传 `0` |
| `groupId` | 否 | 素材库分组 ID；普通上传不需要 |

服务端枚举校验还接受 `1、7、8、9、15`，但当前公开前端没有稳定的名称映射。本 Skill 不使用这些未知值。

签名成功时 `statusCode` 为 `0`，`data` 包含：

- `expire`
- `policy`
- `signature`
- `OSSAccessKeyId`
- `host`
- `callback`
- `dir`
- `key`
- `uploadUrl`
- `Content-Disposition`

如果相同 MD5 的对象已经存在，响应可能改为 `exists: true` 和 `url`，此时无需再次上传文件。

注意：该接口在参数错误时可能返回 HTTP 201，但 JSON 内部是 `statusCode: 400`。必须同时判断 HTTP 状态与业务状态。

## 2. 上传文件到 OSS

向预上传响应的 `host` 执行 `POST multipart/form-data`，字段顺序不作为契约，但字段名称必须保持：

```text
key
policy
OSSAccessKeyId
signature
callback
Content-Disposition
success_action_status=200
file=<二进制文件>
```

成功条件为 OSS HTTP 2xx。成功后使用预上传响应的 `uploadUrl` 作为最终 URL；不要从 `host` 和 `key` 自行拼接。

`policy` 当前包含 `content-length-range: 0..4194304000`，即约 4,000 MiB。工作台通用上传器的默认本地限制更严格：图片 5 MiB、音频 25 MiB、视频 25 MiB、临时文件 20 MiB；个别页面会按业务放宽。

## 3. 安全约束

- `policy`、`signature`、`OSSAccessKeyId`、`callback` 都是临时敏感字段，只在内存中用于本次上传。
- 不在日志、JSON 输出、状态文件或异常信息中打印上述字段。
- Open Key 只从 `BIHUOAI_OPEN_KEY`、用户私有 `.env` 或一次性 `--open-key` 读取。
- 上传超时或 OSS 返回非 2xx 时不自动重新申请签名或重传，由用户检查后重新执行。
