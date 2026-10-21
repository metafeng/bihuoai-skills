---
name: bihuoai-material-upload
description: 通过必火全员IP营销平台 MCP 为本地图片、音频、视频或文档准备上传，计算文件摘要、处理秒传并返回可供数字人、生图、剪辑和发布使用的公网素材 URL。用户提到必火AI素材上传、本地文件转 URL 或为平台工具准备文件时使用。
---

# 必火AI素材上传

本 Skill 是 MCP 文件工具的薄封装：只负责把用户明确指定的本地文件转换成平台可用的公网 URL，不创建数字人、图片、剪辑或发布任务。

## 连接规则

- 使用客户端已完成 OAuth 授权的 `agent-bihuoai` MCP。
- Skill 不处理平台登录凭证。上传脚本只接收 `prepare_file_upload` 返回的一次性上传信息。
- MCP 不可用时按 `https://agent.bihuoai.com/oauth/mcp-install` 引导用户连接，不回退到旧接口。

## 输入

- 必填：一个明确的本地文件路径。
- 可选：素材库分组或保存名称。
- 不扫描目录，不读取未点名文件，不上传整个文件夹。
- 用户明确说“上传这个文件”视为本次上传授权；只询问参数或检查文件时不得上传。

## 标准流程

1. 检查路径确实是普通文件。
2. 使用 Node 18 及以上执行：

```bash
node scripts/upload.mjs stat "/绝对路径/素材文件"
```

3. 将输出的 `fileName`、`size`、`md5` 原样传给 MCP 工具 `prepare_file_upload`。
4. 若返回 `exists: true`，直接使用返回的 `url`，不要重复上传。
5. 否则把返回的 `upload` 对象保存到权限受限的临时 JSON 文件，再执行：

```bash
node scripts/upload.mjs put "/绝对路径/素材文件" "/临时目录/upload-ticket.json"
```

6. 成功后立即删除临时 JSON，只保留最终 `url`。一次性上传信息过期时重新调用 `prepare_file_upload`，不要自行拼接字段。
7. 用户明确要求存入素材库时，再使用 `list_media_assets`、`create_media_group` 或 `save_media_asset`；是否创建分组或保存资产需要单独确认。

Windows 上同样可用 Node 命令，例如：

```powershell
node scripts\upload.mjs stat "C:\路径\素材.mp4"
node scripts\upload.mjs put "C:\路径\素材.mp4" "$env:TEMP\upload-ticket.json"
```

## 输出和边界

- `stat` 只输出文件名、字节数和 MD5，不联网。
- `put` 只向 MCP 返回的上传地址发送指定文件。
- 不在聊天、日志、状态文件或 Git 中保留一次性上传信息。
- 平台回调成功并返回 URL 才算上传完成；HTTP 成功但平台登记失败不能当作成功。
- 失败时如实返回错误；除上传信息过期外不自动重试。
