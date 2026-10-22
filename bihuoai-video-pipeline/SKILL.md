---
name: bihuoai-video-pipeline
description: 通过必火全员IP营销平台 MCP 把选题、参考素材或口播稿制作成视频。明确要求成片时连续完成文案、数字人、所需剪辑和下载；要求先审稿时分阶段执行。支持连接恢复和原任务续跑，发布保持独立授权。
---

# 必火AI视频全流程

本 Skill 编排同系列文案、链接提取、数字人、封面、素材上传、剪辑和发布技能。所有平台操作通过 `agent-bihuoai` MCP；OAuth 由客户端管理，不读取或保存平台凭证。

```text
选题 / 素材 → 文案定稿 → TTS 朗读版 → 数字人 → 所需封面与剪辑 → 下载、检查、交付
```

## 先判断执行方式

### 直接交付成片

用户明确要求“给我成片”“完成数字人合成与剪辑”“全自动”“直接生成”或“不需要再确认”，且没有要求先审稿时，使用 `executionMode=auto`。不必额外要求用户写出“全自动”。

- 本次请求授权所需文案定稿、数字人，以及用户已要求的剪辑、封面或链接提取；将范围记入 `authorization`。未要求的付费阶段跳过，不增加封面、重画、第二版本或额外实测。
- 付费调用前查当前价格，简要说明实际资源、档位及费用影响；已有相应制作授权时以进度说明告知并继续，不再要求同一授权的第二次确认。遵守用户预算上限；超出上限或增加付费范围时再询问。
- 使用 `bihuoai-copywriting` 写稿、核实必要事实、保存并自主选定标题，记为 `copywriting.status=finalized_by_agent`。可展示文稿，但不以审稿回复作为继续条件。
- 向子 Skill 传递模式、授权、文稿路径及核验后的资源。预检照常执行，已有授权不因进入子阶段而失效。
- 数字人成功后直接进入已授权剪辑，使用 `mode=auto`，持续查询、下载、检查和交付。任务提交、进度100%或一次轮询超时都不是任务终点。
- 定稿后不在下游静默改写；需要改变含义或重新付费合成时说明原因。不能为追求接近目标时长擅自再生成一条收费视频。

### 先审稿或分阶段制作

用户说“先看文案”“确认后再合成”“只写稿”或明确要求逐步确认时，用 `executionMode=review`，只执行已要求的阶段。展示完整文稿并等确认后，再进入获授权的付费步骤。后续改为“直接全部做完”时，更新模式与授权，沿用已有结果继续。

**发布始终独立。** “全流程”“给我成片”不包含发布；“不发布”时固定 `publication.status=skipped`。只有明确要求发布才进入发布预检，并按 `bihuoai-publish` 对最终视频、封面、标题、账号和时间取得发布确认。

## 连接与资源

1. 优先用会话内 MCP 工具，首次使用先调 `get_usage_guide`，不猜字段。
2. 找不到工具时检查客户端配置及连接错误，区分未配置、授权失效与已配置但网络失败、工具未加载。不能只因会话工具列表为空就要求重新登录。
3. Codex 可运行本地命令时，按 [连接恢复与续跑](references/runtime.md) 使用客户端托管的 MCP 连接。配套脚本只经 Codex App Server 调用 MCP，不读取凭证、不直连业务接口、不启动新的模型任务。其他客户端使用其已支持的刷新方式。
4. 只读连接恢复最多重试3次，间隔至少15秒；明确的授权、余额、权限错误不盲目重试。恢复失败时说明实际错误与已完成阶段；确需登录时才读取 `https://agent.bihuoai.com/oauth/mcp-install` 引导授权。
5. 形象、声音、模型、模板及账号ID均来自当前账号实时列表。精确名称无结果时放宽关键词、查看同来源列表并处理分页；唯一匹配的简称可对应完整名称。无匹配或多个候选无法区分时才询问，不偷偷更换资源。
6. 本次选择优先于私有配置；未指定项可用 `bihuoai-digital-human` 的私有默认值并实时核验。没有私有档位时用 LITE；有 `default_video_version: 2` 时按 PRO 预检与估费。未指定模板时可用已核验的私有默认模板；没有唯一可用选择时再询问。

## 连续制作

1. 在工作区私有输出目录创建或恢复 `state.json`，先检查已有任务，禁止从头重跑。记录输入、目标时长、所需阶段、模式、授权、资源及文稿路径。
2. 分享链接按 `bihuoai-link-extract` 提取并保留原稿，本地素材按 `bihuoai-material-upload` 上传。素材不直接当作已确认的成稿。
3. 新文案必须使用 `bihuoai-copywriting`；要求沿用的完整文案记为 `confirmed_input`。保存标题、正文和发布描述，按模式自主定稿或等待审稿。缺少文案 Skill 时停止新稿创作，已有定稿仍可继续。
4. 按 `bihuoai-digital-human` 保存 TTS 朗读版，只规范明确的数字读法，不覆盖原文；预检形象、声音、档位、语速、语种和文本差异。执行获授权的 `create_digital_human_video`，取得 `dhVideoId` 后立刻原子保存，再等待。
5. 用 `get_dh_video_status` 查原任务；终态成功并返回 `videoUrl` 后才能进入下一步。处理中即使 `progress=100` 也继续等。
6. 仅在用户要求，或模板必需且已授权时按 `bihuoai-video-cover` 制作封面，保存任务和图片并查看实际结果。模板必需但未授权的封面属于新增付费范围，说明后再处理。
7. 剪辑前用 `list_clip_templates` 核验模板及封面要求。已有原片时传 `mainVideoUrl`，不要再传 `script/voiceId/trainingId` 重复合成，不把 `dhVideoId` 当URL。传模板所需字段及 `mode=auto`，创建后立刻保存 `taskId`。
8. 用 `get_clip_task_status` 查原任务。自动流程不主动选择需要人审的编辑模式；已有任务进入待人工确认时如实说明，不代替用户确认、不重建任务。
9. 默认每30–55秒查一次，绝不短于15秒；简洁说明进度，避免重复解释同一百分比。读取失败可有限重试；付费创建不能因断线、超时或返回不明而重试。
10. 最后阶段终态成功且返回结果URL后，下载最终MP4到输出目录，保留原片、文稿和任务记录；核验文件非空、媒体时长、画幅和可解码性，环境支持时抽查画面与字幕。报告实测时长，不把目标时长当成实测，不把抽查说成全片人工审看。
11. 返回可播放或下载的成片及简短结果。环境不能下载或检查时交付真实结果链接并说明限制，不假称已保存。按“不发布”的要求结束，不调用发布工具。

## 状态与恢复

```json
{
  "title": "视频标题",
  "source": {},
  "executionMode": "auto",
  "authorization": {"source": "user_request", "copywriting": "auto_finalize", "digitalHuman": true, "cover": false, "clip": true, "publication": false},
  "copywriting": {"status": "finalized_by_agent", "documentPath": null, "ttsPath": null},
  "digitalHuman": {"status": "pending", "taskId": null, "videoUrl": null},
  "cover": {"status": "skipped", "taskId": null, "imageUrl": null},
  "clip": {"status": "pending", "taskId": null, "templateCode": null, "videoUrl": null, "localPath": null},
  "publication": {"status": "skipped", "articleId": null, "submissions": []},
  "updatedAt": null
}
```

- 状态不含 OAuth、Cookie、密钥或一次性上传信息；私有资源URL也不提交公共仓库。
- 付费创建前先写 `status=submitting`；返回ID后原子保存。返回前断线时记录 `unknown`，用 `list_my_tasks` 按标题、类型和时间找回；不能唯一对应时说明问题，不再创建一条碰碰运气。
- 已有ID只查原任务，不因处理中、进度100%、超时或重启而重建。明确失败先保存错误；重新付费需要授权，除非此前明确授权了有限次数的重试。
- `scripts/pipeline-runtime.mjs resume --state /绝对路径/state.json` 可接续原任务查询及已授权的“数字人成功 → 创建一次剪辑 → 下载检查”，详见 [运行说明](references/runtime.md)。脚本只支持数字人和剪辑链，不自动补做封面或发布；必需封面尚未完成时先由编排层处理。
- 用户停止时保存并停止。等待平台不构成完成，也不能凭空承诺后台会继续。受执行时限约束退出时报告可恢复状态，不声称已交付。

## 完成判定

各阶段以对应工具的终态成功及真实结果URL为准；自动成片以所需阶段成功并交付可用文件或真实链接为准。发布提交成功不能替代外部平台的最终发布回执。
