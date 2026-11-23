#!/usr/bin/env python3
"""Development-only builder and static checks for the Doubao store package."""
from __future__ import annotations
import argparse, copy, hashlib, ipaddress, json, re, shutil, stat, unicodedata, zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit
import yaml
from PIL import Image

ROOT = Path(__file__).resolve().parent
NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
BAD_DISPLAY = re.compile(r"mcp|cli|agent|连接器|智能体", re.I)
MIXED = re.compile(r"[\u3400-\u9fff][A-Za-z0-9]|[A-Za-z0-9][\u3400-\u9fff]")
SECRET = re.compile(r"oa_[a-fA-F0-9]{32,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|-----BEGIN .*PRIVATE KEY-----")
INTERNAL = re.compile(r"(?<![\w.])(?:localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|fdae:)", re.I)
LINK = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")
class StrictLoader(yaml.SafeLoader):
    pass

def unique_yaml(loader, node, deep=False):
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in result:
            raise ValueError("Duplicate YAML key: " + str(key))
        result[key] = loader.construct_object(value_node, deep=deep)
    return result
StrictLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_yaml)

def https_public_literal(value):
    if not isinstance(value, str) or not value or len(value.encode()) > 1024:
        return False
    u = urlsplit(value)
    if u.scheme != "https" or not u.hostname or u.username or u.password or u.fragment:
        return False
    if u.hostname.lower() == "localhost":
        return False
    try:
        return ipaddress.ip_address(u.hostname).is_global
    except ValueError:
        return "." in u.hostname

def frontmatter(text):
    if not text.startswith("---\n"):
        raise ValueError("Missing YAML frontmatter")
    parts = text.split("---", 2)
    if len(parts) != 3:
        raise ValueError("Unclosed YAML frontmatter")
    meta = yaml.load(parts[1], Loader=StrictLoader)
    if not isinstance(meta, dict):
        raise ValueError("Frontmatter must be an object")
    return meta, parts[2]

def validate_archive(path):
    failures = []
    with zipfile.ZipFile(path) as z:
        infos = z.infolist()
        names = [i.filename for i in infos]
        seen = set()
        for info in infos:
            p = PurePosixPath(info.filename)
            if p.is_absolute() or ".." in p.parts or "\\" in info.filename:
                failures.append("ZIP_PATH:" + info.filename)
            canonical = unicodedata.normalize("NFC", info.filename).casefold()
            if canonical in seen:
                failures.append("ZIP_COLLISION:" + info.filename)
            seen.add(canonical)
            if stat.S_ISLNK(info.external_attr >> 16):
                failures.append("ZIP_SYMLINK:" + info.filename)
            if info.flag_bits & 1:
                failures.append("ZIP_ENCRYPTION:" + info.filename)
            if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                failures.append("ZIP_COMPRESSION:" + info.filename)
            if info.file_size > 2 * 1024 * 1024:
                failures.append("PKG_FILE_SIZE:" + info.filename)
        roots = {n.split("/")[0] for n in names}
        if roots != {"plugin.json", "mcp.json", "skills", "com.doubao"}:
            failures.append("PKG_ROOT")
        for name in names:
            parent = PurePosixPath(name).parent
            while str(parent) != ".":
                if str(parent) in names:
                    failures.append("ZIP_CONFLICT:" + name)
                parent = parent.parent
        if path.stat().st_size > 16 * 1024 * 1024:
            failures.append("PKG_ZIP_SIZE")
        if len(infos) > 1024:
            failures.append("PKG_ENTRIES")
        if sum(i.file_size for i in infos) > 8 * 1024 * 1024:
            failures.append("PKG_TOTAL")
    return failures

def validate_package(package):
    package = package.resolve()
    checks = []
    def check(code, passed, detail):
        checks.append({"id":code, "status":"PASS" if passed else "FAIL", "detail":detail})
    def icon(path, code):
        try:
            with Image.open(path) as im:
                im.load()
                okay = im.size == (512,512) and im.format in {"PNG","JPEG"} and path.stat().st_size <= 500*1024 and path.suffix.lower() in {".png",".jpg",".jpeg"}
            check(code, okay, str(path.relative_to(package)))
        except Exception as e:
            check(code, False, str(e))
    def display(value, path):
        check("COPY_BYTES", isinstance(value,str) and 0 < len(value.encode()) < 64, path)
        check("NAME_TERMS", isinstance(value,str) and not BAD_DISPLAY.search(value), path)
        if value == "必火AI":
            checks.append({"id":"COPY_SPACE_USER_OVERRIDE","status":"USER_OVERRIDE","detail":path+"：用户明确指定品牌连续写法“必火AI”，不按通用中英文空格规则判定通过"})
        else:
            check("COPY_SPACE", isinstance(value,str) and not MIXED.search(value), path)
    def local_file(current, target, code):
        okay = isinstance(target,str) and target.startswith("./")
        resolved = (current / target).resolve() if isinstance(target,str) else current
        okay = okay and resolved.is_relative_to(current.resolve()) and resolved.is_file()
        check(code, okay, target)
        return resolved if okay else None

    manifest = json.loads((package/"plugin.json").read_text())
    mcp = json.loads((package/"mcp.json").read_text())
    ext = manifest.get("extensions",{}).get("com.doubao",{})
    servers = mcp.get("mcpServers",{})
    check("PLUGIN_NAME", bool(NAME.fullmatch(manifest.get("name",""))) and len(manifest.get("name","").encode())<64, manifest.get("name"))
    check("MANIFEST_FIELDS", set(manifest)<= {"name","version","description","extensions","$schema"}, sorted(manifest))
    check("DISPLAY_FIELDS", set(ext)<= {"displayName","displayDescription","icon","chatIcon","mcpServers","privacyPolicyUrl"}, sorted(ext))
    check("SERVER_KEYS", set(servers)==set(ext.get("mcpServers",{})) and len(servers)==1, sorted(servers))
    for field in ("displayName","displayDescription"):
        value=ext.get(field,{})
        check("DISPLAY_MAP", isinstance(value,dict) and bool(value) and all(re.fullmatch("[a-z]{2}",k) and isinstance(v,str) and v.strip() for k,v in value.items()),field)
        for lang,text in value.items():
            if field=="displayName": display(text,field+"/"+lang)
            else: check("COPY_BYTES",len(text.encode())<=1024,field+"/"+lang)
    check("DESCRIPTION_BYTES",0<len(manifest.get("description","").encode())<=1024,"plugin.description")
    check("PRIVACY_POLICY_URL",https_public_literal(ext.get("privacyPolicyUrl")),ext.get("privacyPolicyUrl") or "尚未核实真实隐私政策地址")
    check("STATIC_AUTH",not (package/"com.doubao/auth").exists(),"OAuth DCR，包中不包含静态鉴权")
    for field in ("icon","chatIcon"):
        f=local_file(package,ext.get(field),"ICON_PATH")
        if f: icon(f,field.upper())
    for name,server in servers.items():
        check("SERVER_NAME",bool(NAME.fullmatch(name)) and len(name.encode())<64,name)
        u=urlsplit(server.get("url",""))
        check("MCP_TRANSPORT",server.get("type")=="streamable-http" and not any(k in server for k in ("command","args")) and set(server)<={"type","url"},name)
        check("MCP_URL",https_public_literal(server.get("url")) and not u.query and "?" not in server.get("url","") and "&" not in server.get("url",""),server.get("url"))
        presentation=ext.get("mcpServers",{}).get(name,{})
        check("SERVER_DISPLAY_KEYS",set(presentation)<= {"displayName","displayDescription","icon"},name)
        for value in presentation.get("displayName",{}).values():display(value,name)
        descriptions=presentation.get("displayDescription",{})
        check("SERVER_DESCRIPTION",bool(descriptions) and all(isinstance(x,str) and 0<len(x.encode())<=1024 for x in descriptions.values()),name)
        f=local_file(package,presentation.get("icon"),"SERVER_ICON_PATH")
        if f:icon(f,"SERVER_ICON")
    skill_files=sorted((package/"skills").glob("*/SKILL.md"))
    check("SKILL_COUNT",1<=len(skill_files)<=5,len(skill_files))
    check("SINGLE_ENTRY",len(skill_files)==1,"一个路由入口，内部参考流程不独立加载")
    for f in skill_files:
        meta,body=frontmatter(f.read_text())
        name=meta.get("name","")
        check("SKILL_NAME",name==f.parent.name and bool(NAME.fullmatch(name)) and len(name.encode())<64,name)
        check("SKILL_DESCRIPTION",isinstance(meta.get("description"),str) and 0<len(meta["description"].encode())<=1024,name)
        md=meta.get("metadata",{})
        check("SKILL_METADATA",isinstance(md,dict) and all(isinstance(v,str) for v in md.values()),name)
        display(md.get("display_name"),name)
        check("SKILL_DISPLAY_DESCRIPTION",isinstance(md.get("display_description"),str) and 0<len(md["display_description"].encode())<=1024,name)
        img=local_file(f.parent,md.get("icon"),"SKILL_ICON_PATH")
        if img:icon(img,"SKILL_ICON")
        for textfile in f.parent.rglob("*.md"):
            text=textfile.read_text()
            for target in LINK.findall(text):
                if "://" in target or target.startswith("#"):continue
                dest=(f.parent/target).resolve()
                check("SKILL_REFERENCE",dest.is_relative_to(f.parent.resolve()) and dest.is_file(),str(textfile.relative_to(package))+":"+target)
    check("NO_RUNTIME_SCRIPTS",not any(p.is_file() for suffix in ("*.mjs","*.js","*.py","*.sh") for p in package.rglob(suffix)),"开发工具不进入插件包")
    forbidden_steps=re.compile(r"(?m)^\s*(?:node\s|npm\s+(?:install|i)\b|python3?\s|curl\s)")
    for f in package.rglob("*"):
        if not f.is_file():continue
        check("NO_SYMLINK",not f.is_symlink(),str(f.relative_to(package)))
        if f.suffix in {".md",".json",".yaml",".mjs",".py",".sh",".js"}:
            text=f.read_text()
            check("INTERNAL_ADDRESS",not INTERNAL.search(text),str(f.relative_to(package)))
            check("CREDENTIAL",not SECRET.search(text),str(f.relative_to(package)))
            check("NO_RUNTIME_COMMAND",not forbidden_steps.search(text),str(f.relative_to(package)))
    return checks

def build(out):
    config=json.loads((ROOT/"release.json").read_text())
    source=ROOT/"plugin"
    package=out/("bihuoai-plugin-v"+config["version"])
    if package.exists():shutil.rmtree(package)
    shutil.copytree(source,package)
    manifest=json.loads((package/"plugin.json").read_text())
    manifest["version"]=config["version"]
    if config.get("privacyPolicyUrl"):
        manifest["extensions"]["com.doubao"]["privacyPolicyUrl"]=config["privacyPolicyUrl"]
    (package/"plugin.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n")
    checks=validate_package(package)
    archive=out/("bihuoai-doubao-plugin-v"+config["version"]+".zip")
    with zipfile.ZipFile(archive,"w",zipfile.ZIP_DEFLATED) as z:
        for f in sorted(package.rglob("*")):
            if f.is_file():z.write(f,f.relative_to(package).as_posix())
    zip_errors=validate_archive(archive)
    checks.append({"id":"ZIP_INTEGRITY","status":"FAIL" if zip_errors else "PASS","detail":zip_errors or "安全路径、体积和压缩方式通过"})
    blockers=[c for c in checks if c["status"]=="FAIL"]
    runtime=[
      {"id":"TOOL_COUNT","status":"UNKNOWN","detail":"须用生产服务授权后 tools/list 的全部分页核实不超过30；历史2026-11-17为60"},
      {"id":"OAUTH_DCR","status":"UNKNOWN","detail":"须核实生产元数据及豆包全新用户首次授权，安装说明目前列出WorkBuddy回调"},
      {"id":"SERVER_CONTENT_SAFETY","status":"UNKNOWN","detail":"包内已补编排规则；接口端输入输出审核和幂等仍需真实证据"},
      {"id":"CLIENT_E2E","status":"UNKNOWN","detail":"新包须在豆包客户端从授权到生成结果验收，历史本地预授权不代替"}
    ]
    report={"version":config["version"],"archive":str(archive.resolve()),"sha256":hashlib.sha256(archive.read_bytes()).hexdigest(),"bytes":archive.stat().st_size,"staticPassed":not blockers,"readyForSubmission":False,"candidateOnly":True,"staticChecks":checks,"staticBlockers":blockers,"runtimeChecks":runtime}
    (out/"preflight.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    lines=["# 必火 AI 豆包插件修改与自查结果","", "版本："+config["version"],"", "**状态：已修改包体；候选包，尚不可标为完成提审验收。**","",
      "## 已完成","",
      "- 保留一个远程 MCP；8 个原顶层技能收敛为一个入口，按需读取内部流程。",
      "- 保留文案、链接提取、素材处理、数字人、封面、剪辑和发布流程；重写原先的跨技能安装依赖。",
      "- 插件、连接器及技能展示名按用户明确要求统一为“必火AI”，显式提供官方品牌 512×512 PNG 图标。品牌连续写法作为用户覆盖项单独记录，不冒充通用空格规则通过。",
      "- 采用 OAuth DCR 配置，移除密钥版鉴权目录和运行期本地脚本。",
      "- 补充输入/输出内容安全、权益检查、分阶段费用确认、发布独立确认与任务恢复。",
      "- 本地上传没有可用服务链路时明确转素材页操作，不把上传准备接口当成已完成上传。","",
      "## 静态检查","", "通过：" + str(sum(c["status"]=="PASS" for c in checks)) + "；未通过："+str(len(blockers))+"。",""]
    for c in blockers:lines.append("- "+c["id"]+"："+str(c["detail"]))
    lines+=["","## 服务端及客户端仍需验证",""]
    for c in runtime:lines.append("- "+c["id"]+"："+c["detail"])
    shutil.copyfile(ROOT/"backend-handoff.md",out/"backend-handoff.md")
    lines+=["","## 已核实地址","", "- 产品：https://agent.bihuoai.com","- MCP：https://agent.bihuoai.com/v1/mcp","- 隐私政策："+str(config.get("privacyPolicyUrl")),"",
      "## 交付文件","", "- 插件候选："+archive.name,"- 逐项机器检查：preflight.json","- 服务端联调：backend-handoff.md","- 生产只读探测：oauth-probe.json（如已运行）","",
      "本构建命令不会上传或提交审核；后台实际状态见对应评测报告。修改本插件不等于部署生产 MCP 服务。","",
      "规范核对补充：2026-11-23 官方技能规范将 metadata.icon 列为可选；旧报告将其列为必填不准确。本包仍提供该图标以满足更严格的伙伴自查。",""]
    (out/"CHANGE_REPORT.md").write_text("\n".join(lines))
    return report

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--out",type=Path,required=True)
    args=parser.parse_args()
    args.out.mkdir(parents=True,exist_ok=True)
    result=build(args.out.resolve())
    print(json.dumps({k:result[k] for k in ("archive","sha256","bytes","staticPassed","readyForSubmission","staticBlockers")},ensure_ascii=False))

