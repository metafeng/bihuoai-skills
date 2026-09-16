import fs from "node:fs";
import os from "node:os";
import path from "node:path";

loadEnvFiles();

export const MAIN_BASE = process.env.BIHUOAI_API_BASE || "https://ai-api.aigcoem.com/v1";
export const CLIP_BASE = process.env.BIHUOAI_CLIP_API_BASE || `${MAIN_BASE}/ai-cut`;
export const WEB_ORIGIN = process.env.BIHUOAI_WEB_ORIGIN || "https://agent.bihuoai.com";

export function loadEnvFiles() {
  const xdg = process.env.XDG_CONFIG_HOME;
  const candidates = [
    path.join(os.homedir(), ".bihuoai-skills", ".env"),
    xdg ? path.join(xdg, "bihuoai-skills", ".env") : null,
    path.join(process.cwd(), ".bihuoai-skills", ".env"),
  ].filter(Boolean);
  const merged = {};
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      merged[match[1]] = value;
    }
  }
  for (const [key, value] of Object.entries(merged)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function loadSkillSettings(skillName) {
  const xdg = process.env.XDG_CONFIG_HOME;
  const candidates = [
    path.join(os.homedir(), ".bihuoai-skills", skillName, "EXTEND.md"),
    xdg ? path.join(xdg, "bihuoai-skills", skillName, "EXTEND.md") : null,
    path.join(process.cwd(), ".bihuoai-skills", skillName, "EXTEND.md"),
  ].filter(Boolean);
  const values = {};
  let file;
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    const text = fs.readFileSync(candidate, "utf8");
    const frontmatter = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/)?.[1];
    if (!frontmatter) continue;
    for (const raw of frontmatter.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*$/);
      if (!match) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) value = Number(value);
      else if (["true", "false"].includes(value.toLowerCase())) value = value.toLowerCase() === "true";
      values[match[1]] = value;
    }
    file = candidate;
  }
  return { values, file };
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) {
      args._.push(item);
      continue;
    }
    const eq = item.indexOf("=");
    const key = item.slice(2, eq > -1 ? eq : undefined);
    let value = eq > -1 ? item.slice(eq + 1) : true;
    if (eq === -1 && argv[i + 1] && !argv[i + 1].startsWith("--")) value = argv[++i];
    if (args[key] === undefined) args[key] = value;
    else args[key] = Array.isArray(args[key]) ? [...args[key], value] : [args[key], value];
  }
  return args;
}

export function asArray(value) {
  if (value === undefined || value === null || value === false) return [];
  return Array.isArray(value) ? value : [value];
}

export function asNumber(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`不是有效数字: ${value}`);
  return number;
}

export function asBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
}

export function requireValue(value, label) {
  if (value === undefined || value === null || value === "") throw new Error(`缺少参数: ${label}`);
  return value;
}

export function getAuth(args = {}, { required = true } = {}) {
  const openKey = args["open-key"] || process.env.BIHUOAI_OPEN_KEY;
  if (openKey) {
    return { openKey: String(openKey).replace(/^x-open-key\s*:\s*/i, "").trim() };
  }
  if (!required) return {};
  throw new Error("缺少认证凭证。请设置 BIHUOAI_OPEN_KEY，也可在 ~/.bihuoai-skills/.env 中配置。不要把凭证写入 Skill 文件。");
}

export async function apiRequest({ base = MAIN_BASE, endpoint, method = "GET", body, openKey }) {
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    lang: "zh",
    Origin: WEB_ORIGIN,
    Referer: `${WEB_ORIGIN}/`,
  };
  const auth = openKey
    ? { openKey: String(openKey).replace(/^x-open-key\s*:\s*/i, "").trim() }
    : getAuth();
  headers["x-open-key"] = auth.openKey;
  const response = await fetch(`${base}${endpoint}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await response.text();
  let payload;
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { raw }; }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${safeMessage(payload)}`);
  const code = payload?.statusCode ?? payload?.code;
  if (code !== undefined && Number(code) !== 0 && Number(code) !== 200) {
    if (Number(code) === 10197 && auth.openKey) {
      throw new Error(`API 10197: 当前 Open Key 未获 ${method} ${endpoint} 的开放权限；不要重复请求或自动改用其他凭证。`);
    }
    throw new Error(`API ${code}: ${safeMessage(payload)}`);
  }
  return payload;
}

function safeMessage(payload) {
  return payload?.message || payload?.msg || payload?.resultDesc || payload?.raw || "请求失败";
}

export function dataOf(payload) {
  return payload?.data ?? payload?.result ?? payload;
}

export function listOf(payload) {
  const data = dataOf(payload);
  if (Array.isArray(data)) return data;
  for (const key of ["list", "records", "rows", "items", "data"]) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
}

export function findByName(items, name, fields = ["name", "title", "videoName", "voiceName", "trainingName"]) {
  const wanted = String(name).trim().toLowerCase();
  const exact = items.find((item) => fields.some((field) => String(item?.[field] || "").trim().toLowerCase() === wanted));
  if (exact) return exact;
  const fuzzy = items.filter((item) => fields.some((field) => String(item?.[field] || "").toLowerCase().includes(wanted)));
  if (fuzzy.length === 1) return fuzzy[0];
  if (fuzzy.length > 1) throw new Error(`名称“${name}”匹配到 ${fuzzy.length} 项，请改用 ID 或更精确名称。`);
  throw new Error(`没有找到名称为“${name}”的数据。`);
}

export function deepValue(value, keys) {
  const wanted = new Set(keys);
  const seen = new Set();
  function walk(node) {
    if (!node || typeof node !== "object" || seen.has(node)) return undefined;
    seen.add(node);
    for (const [key, child] of Object.entries(node)) if (wanted.has(key) && child !== undefined && child !== null) return child;
    for (const child of Object.values(node)) {
      const found = walk(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  return walk(value);
}

export async function poll({ fetcher, isDone, intervalMs = 5000, timeoutMs = 30 * 60 * 1000, onProgress }) {
  const started = Date.now();
  while (true) {
    const value = await fetcher();
    if (onProgress) onProgress(value);
    if (isDone(value)) return value;
    if (Date.now() - started >= timeoutMs) throw new Error(`等待超时（${Math.round(timeoutMs / 1000)} 秒）`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function downloadFile(url, destination) {
  requireValue(url, "下载地址");
  const target = path.resolve(destination);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}`);
  fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  return target;
}

export function readTextArg(args, directKey = "text", fileKey = "text-file") {
  if (args[fileKey]) return fs.readFileSync(path.resolve(String(args[fileKey])), "utf8").trim();
  return args[directKey];
}

export function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(path.resolve(String(file)), "utf8"));
}

export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function fail(error) {
  process.stderr.write(`${error?.message || error}\n`);
  process.exitCode = 1;
}
