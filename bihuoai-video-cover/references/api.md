# 必火AI图片生成接口

核对日期：2026-10-08。接口和模型配置是实时事实，异常时重新对照必火AI工作台请求，不凭本文件猜测。

## 地址与认证

```text
Base URL: https://ai-api.aigcoem.com/v1
x-open-key: <BIHUOAI_OPEN_KEY>
Content-Type: application/json
lang: zh
Origin: https://agent.bihuoai.com
Referer: https://agent.bihuoai.com/
```

Open Key保存在 `~/.bihuoai-skills/.env`：

```text
BIHUOAI_OPEN_KEY=你的OpenKey
```

## 接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/ai-media/model-options` | 获取当前图片和视频模型配置 |
| POST | `/ai-media/price-preview` | 预估本次生成消耗 |
| POST | `/ai-media` | 创建图片或视频任务 |
| POST | `/ai-media/list` | 查询任务列表 |
| GET | `/ai-media/:taskId` | 查询任务详情 |
| POST | `/ai-media/:taskId/rename` | 重命名任务 |
| DELETE | `/ai-media/:taskId` | 删除任务 |

## 封面请求体

Image 2：

```json
{
  "prompt": "完整封面提示词",
  "model": "image-2",
  "ratio": "9:16",
  "referImages": ["https://example.com/person.jpg"]
}
```

千问3.0 Pro：

```json
{
  "prompt": "完整封面提示词",
  "model": "qwen-image-3.0-pro",
  "ratio": "9:16",
  "imageSize": "2K",
  "referImages": ["https://example.com/person.jpg"]
}
```

- `prompt`与`model`必填，前端当前限制提示词不超过2000字符。
- `ratio`默认9:16；当前两个模型也支持1:1、16:9、4:3、3:4。
- `imageSize`只在模型配置明确返回该字段时发送。Image 2当前不发送；千问3.0 Pro默认2K。
- CLI可用 `--model image-2` 或 `--model qwen-image-3.0-pro` 显式选择单一模型。指定后只创建该模型任务；省略时才执行Image 2优先、千问安全降级的默认链路。
- `referImages`可省略。为保证备用模型兼容，本Skill最多传3张。

价格预估使用同一请求体，调用 `/ai-media/price-preview`。返回的 `amount` 单位由当前账号定义，不能擅自解释成人民币。

## 状态

当前前端状态枚举：

- `1`：成功，应同时存在 `url`。
- `2`：失败，查看 `errorMessage`。
- `4`、`-2`及其他未终结值：排队或处理中。

轮询超时只报告现有任务ID，不重新创建。只有Image 2明确失败或成功却无URL，且不是余额、权限、认证、审核或参数问题时，才自动创建一次千问3.0 Pro任务。

当前Open Key创建的任务可能已出现在 `/ai-media/list`，但 `GET /ai-media/:id` 同时返回 `10029 数据不存在`。脚本遇到这一情况会按记录ID或任务ID回查任务列表并继续轮询；不得因此重新创建任务。

## 素材上传

本地参考图先由同级 `bihuoai-material-upload` 上传到 `/oss/pre-upload` 返回的OSS地址。临时签名字段只在内存中使用；后续生成接口只接收最终URL。
