---
name: bihuoai-link-extract
description: 通过必火全员IP营销平台 MCP 从视频分享链接提取标题和口播文稿，并基于上下文校正 AI 术语和明显的 ASR 同音错误，同时保留平台原始转写。用户提到链接提取、视频文案提取、分享链接转文字或提取字幕时使用。
---

# 必火AI链接提取

本 Skill 只负责从分享链接得到可追溯文稿，不创建数字人、不剪辑、不发布。平台能力通过 `agent-bihuoai` MCP 调用。

## 全流程授权衔接

由 `bihuoai-video-pipeline` 调用且本次授权已覆盖链接提取时，说明提取对象与费用影响后直接执行，不重复索要同一确认。会话工具未加载时可用全流程 Skill 的客户端托管 MCP 恢复方式，不读取凭证。单独调用时沿用下方授权规则。

## 连接规则

- 使用客户端已完成 OAuth 授权的 `agent-bihuoai` MCP，不处理任何平台凭证。
- MCP 不可用时按 `https://agent.bihuoai.com/oauth/mcp-install` 引导用户连接，不回退到直连接口。
- 工具字段或支持平台不明确时先调用 `get_usage_guide`。

## 标准流程

1. 从用户输入中提取真实分享 URL，保留原始分享文本供追溯。
2. 调用 `extract_content`。若工具说明标注会扣费，先说明本次提取对象和费用影响，取得明确确认后再调用。
3. 将平台返回的标题、原始转写、来源 URL 和任务信息原样保存。用户指定 `文稿.txt` 时，原文保存为 `文稿.raw.txt`。
4. 确认原始转写非空，再读取 [AI 术语与转写校正规则](references/ai-terminology.md)。结合标题、全文主题、相邻句和语法生成 `文稿.txt` 校正版。
5. 若私有配置中存在 `terminology_file`，读取该术语表作为额外候选；仍然必须有上下文证据。
6. 交付校正版、原始版和关键校正摘要。用户明确只要原文时，不生成校正版。

## 上下文校正

- 高置信度：发音相近且上下文唯一支持时直接校正，例如办公智能体语境中的“乌克巴里”→`WorkBuddy`。
- `Agent` 只在 AI 执行、工具调用、上下文等语境中校正；医学等其他语境不得替换。
- `GEO` 只在生成式引擎优化、AI 搜索、答案引用等语境中把 `GU` 校正为 `GEO`。
- 两个以上候选都合理时保留原词，并标记 `疑似：候选词`。
- 可修复标点、明显重复字和不会改变原意的固定搭配，不润色观点，不扩写信息。
- 不改变数字、时间、人物关系、否定、因果和立场。

## 私有术语配置

可在私有 `BIHUOAI_USER_CONFIG.md` 中设置：

```yaml
---
terminology_file: /绝对路径/我的术语表.md
preserve_raw: true
---
```

macOS / Linux 使用 `~/.bihuoai-skills/bihuoai-digital-human/BIHUOAI_USER_CONFIG.md`；Windows 使用 `%USERPROFILE%\.bihuoai-skills\bihuoai-digital-human\BIHUOAI_USER_CONFIG.md`。不要把私有人名、公司名或内部产品名提交到公共仓库。

## 边界

- 平台原始转写永不被校正版覆盖。
- 接口返回或任务提交不等于内容有效；必须验证正文非空。
- 超时或状态未知时查原任务，不重复创建。
- 校正结果必须明确标为校正版，不能伪装成平台原文。
