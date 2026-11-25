# 必火 AI 豆包商店插件

本目录是豆包商店专用插件源文件和开发期打包工具，不修改仓库其他客户端的独立技能，不安装到当前用户的个人技能目录。

插件统一为一个远程 MCP 服务、一个顶层技能以及按需加载的参考流程。插件包内不包含本地运行脚本、静态鉴权配置或开发期工具。

## 构建

在项目根目录执行：

```bash
python3 bihuoai-skills/integrations/doubao/release.py --out outputs/doubao-plugin/release-1.1.2
```

结果包括候选 ZIP 和自查结果。静态通过不等于服务端或豆包客户端验收通过；任何未验证项目都保留为阻断，不输出“可提审”的误导结论。

隐私政策只填写实际已上线且核实适用的 HTTPS 地址，写入 release.json 的 privacyPolicyUrl 后重建。候选包缺少该地址时会被报告为静态阻断。

开发期只读网络检查：

```bash
python3 bihuoai-skills/integrations/doubao/probe_oauth.py --out outputs/doubao-plugin/release-1.1.2/oauth-probe.json
```

该检查不读取凭据、不注册客户端、不请求授权、不调用付费业务，仅请求生产 MCP 的未授权初始化及公开 OAuth 元数据。网络失败标为不可验证，不认定服务宕机。

## 发布前服务端事项

详见 backend-contract.json。工具总数、真实 DCR/OAuth 回调、接口端审核、幂等及客户端端到端测试不能通过重打 ZIP 解决。

官方技能规范在 2026-11-23 明确 metadata.icon 为可选，缺省可继承插件图标；本版本仍为统一入口显式提供官方品牌 PNG，兼容伙伴手册的更严检查。不要把旧报告中的“未声明技能图标”继续视为当前官方规范的必填缺陷。

未自动提交审核。

