# Codex 连接恢复与任务续跑

仅在会话未加载工具但本机已有 `agent-bihuoai` MCP，或需要原任务续跑时读取。正常会话直接使用已暴露的 MCP 工具即可。脚本需要 Node.js 18+ 及支持相应 App Server 方法的 Codex；不适用于没有 Codex 的其他客户端。

## 连接恢复

先用 `codex mcp list --json` 核实该服务的配置和授权状态，必要时查看当前对话相关的连接错误。`auth_status=o_auth` 表示已配置 OAuth，不证明当前请求一定可用；一次网络失败也不证明必须重新登录。

脚本通过 Codex 的 `initialize`、`mcpServerStatus/list`、临时 MCP 运行上下文及 `mcpServer/tool/call` 复用客户端管理的 OAuth。临时上下文不启动模型、不创建持久聊天、不恢复或抢占正在写入的用户对话。它不是绕过 MCP 的业务 API 客户端，也不打开或解析凭证文件。

```bash
node scripts/pipeline-runtime.mjs tools --tool create_digital_human_video
node scripts/pipeline-runtime.mjs call get_usage_guide
```

以输出的当前 `inputSchema` 为准。其他只读工具也可用 `call`，参数放 UTF-8 JSON 文件后传 `--json /绝对路径/args.json`。脚本启动连接最多尝试3次，间隔15秒；真实的授权失效或权限错误立即返回。临时 OAuth 元数据网络发现失败不直接当作授权失效。

如果客户端没有所需 App Server 方法，报告不支持，不更改客户端配置或登录状态，不读取凭证。若正常 MCP 工具仍可用，继续用正常工具；全部不可用时才说明缺口。只有必须登录时读取平台最新安装说明，引导用户完成浏览器授权。

## 创建与状态文件

文案创作、事实核对、TTS 规范化、资源实时核验和费用说明由编排层完成。将用户实际授权及选定资源记入工作区私有 `state.json`，不要直接把示例中的布尔值当作用户授权。

支持的付费创建只有数字人和剪辑；CLI 不支持发布、删除、重画等其他写入操作。创建命令必须传已有授权的 `--state`，同一状态文件使用排他锁。脚本先保存 `submitting`，再创建一次，拿到ID立即原子写入。

```bash
node scripts/pipeline-runtime.mjs call create_digital_human_video \
  --json /绝对路径/dh-args.json --state /绝对路径/state.json
```

`dh-args.json` 包含当前 MCP 要求的 `videoName`、`version`、`trainingId`、`text`、`voiceId`、`speed`、`languageBoost`，取值来自本次预检，不使用公共固定人物或音色ID。已有任务ID或状态为 `submitting/unknown/failed` 时脚本拒绝再次创建。

- 网络超时或没有收到任务ID：保留 `unknown`，用 `list_my_tasks` 按类型、标题、创建时间查找；唯一核实后补回任务ID继续，不清空状态直接重试。
- 明确失败：保存错误，未经新授权不再次付费；有明确重试授权时由编排层保存上一轮回执，在新的尝试记录中提交，不能覆盖旧任务信息。
- 进程异常退出留下 `.lock`：先确认锁内进程已结束，再移除锁文件。不能在活跃进程运行时删锁；不因清理锁而清理任务ID。
- 状态文件含私有媒体URL，只放私有输出目录。公共仓库只放程序和无账号数据的说明。

## 数字人完成后自动剪辑并下载

状态文件已有数字人任务ID，且剪辑已获授权、所选 `templateCode` 已核验时：

```bash
node scripts/pipeline-runtime.mjs resume --state /绝对路径/state.json
```

脚本查询原数字人任务，拿到终态成功及URL后实时复核模板，创建一次 `mode=auto` 剪辑，保存ID，继续查询并下载。剪辑只传 `mainVideoUrl`，不重复合成数字人。已有剪辑ID则只查询原任务。数字人、剪辑均已成功时只下载检查，不创建新任务。

- 默认每45秒轮询；可用 `--poll-seconds` 设置15–55秒。重新运行也尊重最近提交或查询的15秒最小间隔。
- 默认等待至终态或明确错误。需要给本次进程设上限时用 `--max-wait-seconds`；到时保存 `waiting` 并返回可恢复状态，不代表成片完成。编排层若仍有执行时间应继续同一任务。
- 只读请求临时断线最多重试3次，间隔15秒；付费创建绝不自动重试。待人工确认返回 `awaiting_confirmation`，不替用户确认，不重建任务。
- 所需封面未完成时拒绝自动剪辑；先由编排层处理封面。未要求剪辑时把该阶段设为 `skipped`，脚本可直接下载数字人结果。
- 下载到状态文件旁的 `video-任务ID.mp4`；有 `ffprobe` 和 `ffmpeg` 时检查真实时长、尺寸及完整解码。缺少检查程序时明确记录未完成的检查。画面与字幕抽查仍由编排层在可用环境中执行。
- 程序不执行发布，即使状态文件中有发布授权也不会调用发布工具。用户明确要求发布时回到单独的发布预检。

也可用 `--codex-bin /绝对路径/codex` 指定已安装的客户端程序；这不是模型或账号选择，不修改用户默认模型。脚本只调用管理与 MCP 方法，绝不调用 `turn/start`。
