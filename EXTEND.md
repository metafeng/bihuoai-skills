---
# default_avatar_id: 12345
# default_avatar_name: 你的形象名称
# default_voice_id: voice_请替换为你的声音ID
# default_voice_name: 你的声音名称
default_speed: 1.0
default_emotion: calm
tts_normalize: true

# 为某个形象配置专用声音。把12345换成真实形象ID。
# avatar_voice_12345: voice_该形象专用的声音ID

# 视频封面默认底图。可选值应与下方已配置的背景key一致。
# cover_default_background: hangzhou

# cover_background_hangzhou_name: 杭州背景封面
# cover_background_hangzhou_url: https://example.com/your-hangzhou-background.jpg
# cover_background_studio_name: 摄影棚背景封面
# cover_background_studio_url: https://example.com/your-studio-background.jpg
# cover_background_course_name: 课程现场背景封面
# cover_background_course_url: https://example.com/your-course-background.png

# 历史封面是可选素材，只在用户明确要求参考某张封面时使用。编号支持01至09。
# cover_case_01_name: 我的历史封面1
# cover_case_01_url: https://example.com/your-cover-case-01.png
# cover_case_02_name: 我的历史封面2
# cover_case_02_url: https://example.com/your-cover-case-02.png
---

# 私有扩展配置模板

这是可以直接复制的公开模板。Skill只读取文件顶部两个 `---` 之间的配置；以 `#` 开头的字段不会生效。复制到下面的私有位置，再替换成你自己账号的资源：

```text
~/.bihuoai-skills/bihuoai-digital-human/EXTEND.md
```

建议创建并限制权限：

```bash
mkdir -p ~/.bihuoai-skills/bihuoai-digital-human
cp ./EXTEND.md ~/.bihuoai-skills/bihuoai-digital-human/EXTEND.md
chmod 600 ~/.bihuoai-skills/bihuoai-digital-human/EXTEND.md
```

确认 ID、名称或 URL 后，删除对应配置行开头的 `#`。说明正文可以保留，不影响读取。

## 如何获得形象和声音

先使用当前账号的 Open Key 查询：

```bash
node bihuoai-digital-human/scripts/main.mjs list-avatars
node bihuoai-digital-human/scripts/main.mjs list-voices
```

把返回的真实 ID 和便于识别的名称写入私有文件，然后检查：

```bash
node bihuoai-digital-human/scripts/main.mjs show-defaults --verify
```

优先级为：命令参数 > 形象专用声音映射 > EXTEND.md 全局默认 > 环境变量。

## 如何更改封面底图

先通过 `bihuoai-material-upload` 上传你自己的图片，取得最终 OSS URL，再填写对应的 `cover_background_*_url`。配置完成后读取验证：

```bash
node bihuoai-video-cover/scripts/main.mjs assets
```

生成时可以使用：

```bash
--asset default
--asset 杭州背景
--asset 摄影棚背景
```

如果更换默认底图，只修改 `cover_default_background`，例如 `hangzhou`、`studio` 或 `course`。不要把包含个人照片、私人 OSS 地址、形象 ID、声音 ID 或 Open Key 的私有 EXTEND.md 提交到 Git 仓库。

普通封面生成默认只使用底图和提示词，不会自动使用历史封面。只有明确需要参考某张案例时才额外增加，例如：

```bash
--asset default --asset 历史封面1
```

## 如何切换封面模型

模型不是长期私有资料，使用命令参数选择：

```bash
# 只使用 Image 2
--model image-2

# 只使用千问3.0 Pro；默认即为2K
--model qwen-image-3.0-pro --image-size 2K
```

不提供 `--model` 时，默认先用 Image 2；只有符合安全降级条件时才尝试一次千问3.0 Pro。
