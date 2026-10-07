# 封面输入规格

普通用户不需要填写JSON。收到自然语言后，在内部归一化为下面的信息，再填入母提示词。

```json
{
  "content": {
    "title": "企业AI化，先打好三层地基",
    "subtitle": "",
    "highlight_words": ["企业AI化", "三层地基"]
  },
  "canvas": {
    "aspect_ratio": "9:16",
    "safe_zone": "center_3:4",
    "platform": "视频号"
  },
  "layout_type": "workflow",
  "person": {
    "source": "image_1",
    "preserve_face": true,
    "preserve_clothing": true,
    "preserve_pose": true,
    "visual_weight_target": "25%-35%"
  },
  "assets": [
    {"source": "image_2", "role": "official_logo", "must_preserve_exactly": true}
  ],
  "visual_relation": {
    "type": "workflow",
    "nodes": ["标准化", "数据化", "智能化"]
  },
  "style": {
    "background": "white_or_light_gray",
    "text_color": "black",
    "accent_color": "red"
  },
  "cleanup": {"remove_objects": []}
}
```

## 归一化规则

- 标题是主要输入；有人物或真实场景要求时，人物/底图也是必需输入。
- `layout_type`取 `hero / comparison / workflow / tutorial / opinion`，未指定时根据内容判断。
- `highlight_words`默认选1–2个，不删除标题其余文字。
- `assets`最多3张参考图，角色可为 `base_person / official_logo / official_mascot / product_screenshot / scene_evidence / style_reference`。
- 图片顺序不固定，必须根据本次实际顺序编号，不能假设第二张总是Logo。
- 节点、数字、结论和产品关系只来自本次输入。
- 无副标题不补造，无官方素材不生成假Logo。
- `preserve_face`等字段是提示词约束，不是API参数或结果保证。
- 默认只生成1张；Image 2失败时的千问任务是失败降级，不是第二个设计版本。

## 给用户的简短填写模板

```text
请用 $bihuoai-video-cover 做一张短视频封面。

主标题：
副标题：可选
人物/视频底图：我上传的第几张图
补充素材：说明每张图是Logo、截图还是风格参考
关系或步骤：可选
需要强调：1–2个词，可选
需要删除：可选
配色或额外要求：可选
```
