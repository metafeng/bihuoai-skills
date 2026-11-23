#!/usr/bin/env python3
"""Read-only public OAuth preflight; no credentials, DCR registration or paid calls."""
from __future__ import annotations
import argparse, datetime, ipaddress, json, re, socket, ssl
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler, HTTPSHandler
from urllib.error import HTTPError, URLError

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None

def validate_https(url):
    u=urlsplit(url)
    if u.scheme!="https" or not u.hostname or u.username or u.password or u.fragment:
        raise ValueError("元数据端点必须是无凭据、无片段的HTTPS地址")
    addresses={a[4][0] for a in socket.getaddrinfo(u.hostname,u.port or 443,type=socket.SOCK_STREAM)}
    if not addresses or any(not ipaddress.ip_address(a).is_global for a in addresses):
        raise ValueError("NETWORK_PUBLIC_UNVERIFIED: DNS未返回全公网地址，可能为当前环境偏差")
    return u

def fetch(url,body=None):
    validate_https(url)
    context=ssl.create_default_context()
    context.minimum_version=ssl.TLSVersion.TLSv1_2
    opener=build_opener(NoRedirect(),HTTPSHandler(context=context))
    headers={"Accept":"application/json, text/event-stream"}
    if body is not None:headers["Content-Type"]="application/json"
    req=Request(url,data=json.dumps(body).encode() if body is not None else None,headers=headers,method="POST" if body is not None else "GET")
    try:
        response=opener.open(req,timeout=15)
    except HTTPError as e:
        response=e
    with response:
        status=response.code
        if 300<=status<400:
            raise ValueError("BLOCKED: 元数据和探测请求不跟随重定向")
        text=response.read(1024*1024).decode("utf-8","replace")
        return status,dict(response.headers),text

def analyze_metadata(mcp_url,prm,asm):
    checks=[]
    def check(code,okay,detail):checks.append({"id":code,"status":"PASS" if okay else "FAIL","detail":detail})
    def supports(key,required):
        values=asm.get(key)
        return isinstance(values,list) and all(isinstance(v,str) for v in values) and required in values
    servers=prm.get("authorization_servers",[])
    check("OAUTH_RESOURCE",prm.get("resource")==mcp_url,"PRM resource逐字符一致")
    check("OAUTH_ISSUER_MATCH",isinstance(servers,list) and bool(servers) and asm.get("issuer")==servers[0],"ASM issuer与选中授权服务器逐字符一致")
    check("OAUTH_CAPABILITIES",isinstance(asm.get("registration_endpoint"),str) and bool(asm["registration_endpoint"]),"声明DCR入口")
    check("OAUTH_CODE",supports("response_types_supported","code"),"声明授权码响应，类型为字符串数组")
    check("OAUTH_GRANT",supports("grant_types_supported","authorization_code"),"声明授权码授予，类型为字符串数组")
    check("OAUTH_PKCE",supports("code_challenge_methods_supported","S256"),"声明PKCE S256，类型为字符串数组")
    auth=asm.get("token_endpoint_auth_methods_supported")
    check("OAUTH_NONE",isinstance(auth,list) and all(isinstance(a,str) for a in auth) and "none" in auth,"公共客户端认证方法")
    check("OAUTH_TOKEN_AUTH_UNIQUE",isinstance(auth,list) and all(isinstance(a,str) for a in auth) and len(auth)==len(set(auth)),"认证方法不重复")
    scope=asm.get("scopes_supported")
    check("OAUTH_SCOPE",scope is None or isinstance(scope,list) and all(isinstance(a,str) for a in scope),"声明scope时类型正确")
    for key in ("registration_endpoint","authorization_endpoint","token_endpoint","jwks_uri","introspection_endpoint"):
        if key in asm or key in {"registration_endpoint","authorization_endpoint","token_endpoint"}:
            try:validate_https(asm.get(key));valid=True
            except (ValueError,OSError,TypeError):valid=False
            check("OAUTH_ENDPOINT_SAFETY",valid,key)
    return checks

def probe(url):
    result={"checkedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"mcpUrl":url,"readOnly":True,"checks":[],"limitations":["不注册客户端、不交换令牌、不请求用户凭据、不调用付费业务","元数据通过不等于DCR、PKCE运行时及豆包客户端端到端验收通过"]}
    try:
        status,headers,_=fetch(url,{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"bihuoai-doubao-preflight","version":"1.1.0"}}})
        challenge=next((v for k,v in headers.items() if k.lower()=="www-authenticate"),"")
        match=re.search(r'resource_metadata="([^"]+)"',challenge)
        result["checks"].append({"id":"OAUTH_CHALLENGE_STATUS","status":"PASS" if status==401 and re.match(r"^Bearer\s",challenge,re.I) and match else "FAIL","detail":{"httpStatus":status,"resourceMetadataPresent":bool(match)}})
        u=urlsplit(url)
        prm_url=match.group(1) if match else u.scheme+"://"+u.netloc+"/.well-known/oauth-protected-resource"+u.path
        ps,ph,pt=fetch(prm_url)
        ct=next((v for k,v in ph.items() if k.lower()=="content-type"),"")
        if ps!=200 or "json" not in ct:raise ValueError("PRM未返回200 JSON")
        prm=json.loads(pt)
        servers=prm.get("authorization_servers",[])
        if not isinstance(servers,list) or not servers:raise ValueError("PRM缺少授权服务器")
        auth_url=servers[0]
        au=urlsplit(auth_url)
        asm_url=au.scheme+"://"+au.netloc+"/.well-known/oauth-authorization-server"+au.path
        ast,ah,at=fetch(asm_url)
        act=next((v for k,v in ah.items() if k.lower()=="content-type"),"")
        if ast!=200 or "json" not in act:raise ValueError("ASM未返回200 JSON")
        asm=json.loads(at)
        result["checks"]+=analyze_metadata(url,prm,asm)
        result["publicMetadata"]={"prmUrl":prm_url,"asmUrl":asm_url,"prm":prm,"asm":asm}
        result["status"]="PASS_METADATA_ONLY" if all(x["status"]=="PASS" for x in result["checks"]) else "BLOCKED"
    except (OSError,ValueError,URLError,json.JSONDecodeError) as e:
        result["status"]="UNVERIFIED"
        result["error"]=type(e).__name__+": "+str(e)
        result["limitations"].append("当前环境无法完成探测，不据此认定生产服务故障")
    return result

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--url",default="https://agent.bihuoai.com/v1/mcp")
    parser.add_argument("--out",required=True,type=Path)
    args=parser.parse_args()
    result=probe(args.url)
    args.out.parent.mkdir(parents=True,exist_ok=True)
    args.out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"status":result["status"],"out":str(args.out),"checks":len(result["checks"]),"error":result.get("error")},ensure_ascii=False))

