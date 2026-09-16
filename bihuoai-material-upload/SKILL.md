---
name: bihuoai-material-upload
description: 使用必火AI为本地图片、音频、视频或临时文件申请 OSS 上传签名，计算 MD5、处理秒传并返回可复用的素材 URL。用户提到必火AI素材上传、本地文件转 URL、OSS 预上传或为数字人、剪辑、发布准备文件时使用。
---

# 必火AI素材上传

本 Skill 负责把本地文件上传到必火AI使用的 OSS，并返回后续数字人、剪辑或发布接口可直接使用的 URL。它不创建数字人任务、不剪辑视频，也不发布到外部平台。

## 需要用户提供的内容

- 必填：本地文件路径。
- 通常自动判断：素材类型 `image`、`audio`、`video` 或 `temp`。
- 可选：远端文件名、素材库 `groupId`、自定义大小上限。
- 真实上传前必须确认。用户明确说“上传这个文件”视为上传授权；仅询问参数、检查文件或查看预演时不得上传。

正式接口只使用 `x-open-key`，对应环境变量为 `BIHUOAI_OPEN_KEY`。凭证放在 `~/.bihuoai-skills/.env`，不要写入 Skill、项目文件或命令输出。脚本复用同系列 `bihuoai-video-pipeline/scripts/bihuo-client.mjs`，安装时应保留这两个 Skill 的同级目录结构。

## 已验证的素材类型

| 类型 | businessType | 前端标准限制 |
| --- | ---: | ---: |
| 图片 | 2 | 5 MiB |
| 音频 | 3 | 25 MiB |
| 视频 | 4 | 25 MiB |
| 临时文件/文档 | 16 | 20 MiB |

签名策略当前允许的服务端上限为 4,000 MiB。部分工作台页面会覆盖前端标准限制，例如长视频；只有用户明确需要时才使用 `--max-size-mb` 放宽，且不得超过服务端上限。

接口还接受 `1、7、8、9、15`，但当前前端没有提供稳定的公开语义。本 Skill 不猜测这些值，也不自动使用。详细契约见 [素材上传接口](references/api.md)。

## 标准流程

1. 先运行 `inspect` 或 `upload --dry-run`。脚本检查文件、推断类型、执行大小校验并计算 MD5，全程不访问上传接口。
2. 如需验证账号权限和签名字段，运行 `preflight`。它只申请临时签名，不上传文件，也不会输出 policy、signature、callback 或 Open Key。
3. 核对本地路径、类型、`businessType`、远端文件名、大小和 MD5。
4. 用户已明确要求上传时，运行 `upload --confirm-upload`。
5. 服务端返回 `exists: true` 时使用秒传 URL；否则将签名字段和文件以 `multipart/form-data` 流式 POST 到 OSS。
6. 只把最终 `url` 交给后续 Skill。失败或超时不自动重试，避免同一文件产生多个对象。

## 命令

```bash
SKILL_DIR="${BIHUOAI_SKILLS_HOME:-$HOME/.agents/skills}/bihuoai-material-upload"

# 只检查本地文件，不联网
node "$SKILL_DIR/scripts/main.mjs" inspect --file ./素材.mp4

# 申请临时签名并验证账号权限，但不上传
node "$SKILL_DIR/scripts/main.mjs" preflight --file ./素材.mp4

# 查看真实上传将使用的参数
node "$SKILL_DIR/scripts/main.mjs" upload --file ./素材.mp4 --dry-run

# 用户确认后上传
node "$SKILL_DIR/scripts/main.mjs" upload \
  --file ./素材.mp4 \
  --confirm-upload
```

常用可选参数：

- `--type image|audio|video|temp`：覆盖自动类型判断。
- `--business-type 2|3|4|16`：直接指定已验证的业务类型；与 `--type` 冲突时停止。
- `--file-name 文件名.ext`：指定 OSS 远端文件名，不能包含路径。
- `--group-id 分组ID`：用于素材库分组；普通上传可省略。
- `--max-size-mb 数字`：放宽或收紧本地大小校验，最大 4,000。
- `--timeout 秒数`：OSS 上传超时，默认 300 秒。

## 输出与边界

- `inspect` 输出本地路径、类型、大小、MD5、远端文件名和请求体摘要。
- `preflight` 只输出签名是否就绪、是否可秒传及过期时间；不泄露临时 OSS 凭证。
- `upload` 成功后输出 `url`、`deduplicated` 和文件摘要，供其他 Skill 接续。
- 空文件、目录、不支持的业务类型、超过限制的文件直接停止。
- 不读取或上传用户未明确指定的文件，不扫描整个目录，不自动发布上传结果。
