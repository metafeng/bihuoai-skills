#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import {
  MAIN_BASE,
  WEB_ORIGIN,
  apiRequest,
  asBoolean,
  asNumber,
  dataOf,
  fail,
  getAuth,
  loadEnvFiles,
  parseArgs,
  printJson,
  requireValue,
} from "../../bihuoai-video-pipeline/scripts/bihuo-client.mjs";

loadEnvFiles();

const BUSINESS_TYPES = Object.freeze({ image: 2, audio: 3, video: 4, temp: 16 });
const TYPE_BY_BUSINESS = new Map(Object.entries(BUSINESS_TYPES).map(([type, value]) => [value, type]));
const DEFAULT_LIMIT_MIB = Object.freeze({ image: 5, audio: 25, video: 25, temp: 20 });
const SERVICE_MAX_MIB = 4000;
const MIB = 1024 * 1024;

const EXTENSIONS = Object.freeze({
  image: new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif", ".heic", ".heif"]),
  audio: new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus", ".wma"]),
  video: new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".wmv", ".flv", ".mpeg", ".mpg"]),
});

const MIME_TYPES = Object.freeze({
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".avif": "image/avif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/opus",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
});

export function inferType(fileName) {
  const extension = path.extname(String(fileName)).toLowerCase();
  for (const type of ["image", "audio", "video"]) {
    if (EXTENSIONS[type].has(extension)) return type;
  }
  return "temp";
}

function normalizeType(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const aliases = new Map([
    ["image", "image"], ["img", "image"], ["图片", "image"],
    ["audio", "audio"], ["声音", "audio"], ["音频", "audio"],
    ["video", "video"], ["视频", "video"],
    ["temp", "temp"], ["file", "temp"], ["document", "temp"], ["文件", "temp"], ["文档", "temp"],
  ]);
  const normalized = aliases.get(String(value).trim().toLowerCase());
  if (!normalized) throw new Error(`不支持的素材类型: ${value}。请使用 image、audio、video 或 temp。`);
  return normalized;
}

export function resolveTypeAndBusiness({ fileName, type, businessType }) {
  const explicitType = normalizeType(type);
  let explicitBusiness;
  if (businessType !== undefined && businessType !== null && businessType !== "") {
    explicitBusiness = Number(businessType);
    if (!TYPE_BY_BUSINESS.has(explicitBusiness)) {
      throw new Error(`businessType ${businessType} 尚未确认公开语义。本 Skill 只支持 2、3、4、16。`);
    }
  }
  const businessTypeName = explicitBusiness === undefined ? undefined : TYPE_BY_BUSINESS.get(explicitBusiness);
  if (explicitType && businessTypeName && explicitType !== businessTypeName) {
    throw new Error(`--type ${explicitType} 与 --business-type ${explicitBusiness} 冲突。`);
  }
  const resolvedType = explicitType || businessTypeName || inferType(fileName);
  return { type: resolvedType, businessType: BUSINESS_TYPES[resolvedType] };
}

function validateRemoteFileName(value, extension) {
  if (value === undefined || value === null || value === "") {
    return `${Date.now()}_${randomBytes(3).toString("hex")}${extension}`;
  }
  const fileName = String(value).trim();
  if (!fileName || fileName === "." || fileName === "..") throw new Error("--file-name 不能为空。");
  if (fileName.includes("/") || fileName.includes("\\") || /[\r\n]/.test(fileName)) {
    throw new Error("--file-name 只能是文件名，不能包含路径或换行。");
  }
  return fileName;
}

async function md5File(filePath) {
  const hash = createHash("md5");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function normalizeGroupId(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number(text);
  return text;
}

export async function inspectFile(args) {
  const localPath = path.resolve(String(requireValue(args.file, "--file")));
  const stat = fs.statSync(localPath);
  if (!stat.isFile()) throw new Error(`不是文件: ${localPath}`);
  if (stat.size <= 0) throw new Error("文件为空，无法计算 MD5 或上传。");

  const extension = path.extname(localPath).toLowerCase();
  const resolved = resolveTypeAndBusiness({
    fileName: localPath,
    type: args.type,
    businessType: args["business-type"],
  });
  const defaultLimitMiB = DEFAULT_LIMIT_MIB[resolved.type];
  const maxSizeMiB = asNumber(args["max-size-mb"], defaultLimitMiB);
  if (!(maxSizeMiB > 0) || maxSizeMiB > SERVICE_MAX_MIB) {
    throw new Error(`--max-size-mb 必须大于 0 且不超过 ${SERVICE_MAX_MIB}。`);
  }
  if (stat.size > maxSizeMiB * MIB) {
    throw new Error(`文件大小 ${(stat.size / MIB).toFixed(2)} MiB，超过当前 ${maxSizeMiB} MiB 限制。确认业务允许后可使用 --max-size-mb 放宽。`);
  }

  const uploadFileName = validateRemoteFileName(args["file-name"], extension);
  const md5 = await md5File(localPath);
  const groupId = normalizeGroupId(args["group-id"]);
  return {
    localPath,
    originalFileName: path.basename(localPath),
    uploadFileName,
    extension,
    mimeType: MIME_TYPES[extension] || "application/octet-stream",
    sizeBytes: stat.size,
    sizeMiB: Number((stat.size / MIB).toFixed(3)),
    type: resolved.type,
    businessType: resolved.businessType,
    defaultLimitMiB,
    maxSizeMiB,
    serviceMaxMiB: SERVICE_MAX_MIB,
    md5,
    ...(groupId === undefined ? {} : { groupId }),
  };
}

function requestBody(file) {
  return {
    fileName: file.uploadFileName,
    businessType: file.businessType,
    hash: file.md5,
    from: 0,
    ...(file.groupId === undefined ? {} : { groupId: file.groupId }),
  };
}

async function preUpload(args, file) {
  const payload = await apiRequest({
    base: MAIN_BASE,
    endpoint: "/oss/pre-upload",
    method: "POST",
    body: requestBody(file),
    ...getAuth(args),
  });
  const data = dataOf(payload);
  if (!data || typeof data !== "object") throw new Error("预上传接口没有返回有效 data。");
  if (data.exists === true) {
    if (!data.url) throw new Error("服务端返回 exists=true，但没有返回秒传 URL。");
    return data;
  }
  const required = ["host", "key", "policy", "OSSAccessKeyId", "signature", "callback", "Content-Disposition", "uploadUrl"];
  const missing = required.filter((key) => !data[key]);
  if (missing.length) throw new Error(`预上传响应缺少字段: ${missing.join(", ")}`);
  return data;
}

function expirySummary(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const text = String(value);
  const seconds = Number(text);
  if (Number.isFinite(seconds) && text.length === 10) return new Date(seconds * 1000).toISOString();
  return text;
}

function safePreflight(file, signed) {
  return {
    preflight: true,
    uploaded: false,
    deduplicated: signed.exists === true,
    ready: signed.exists === true ? Boolean(signed.url) : true,
    ...(signed.exists === true ? { url: signed.url } : {}),
    ...(expirySummary(signed.expire) ? { expiresAt: expirySummary(signed.expire) } : {}),
    file,
    request: requestBody(file),
    hiddenFields: ["policy", "signature", "OSSAccessKeyId", "callback", "Content-Disposition"],
  };
}

function escapeDisposition(value) {
  return String(value).replace(/[\r\n]/g, " ").replace(/"/g, "'");
}

function textPart(boundary, name, value) {
  return Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${escapeDisposition(name)}"\r\n\r\n${String(value)}\r\n`, "utf8");
}

function fileHeader(boundary, fileName, mimeType) {
  return Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${escapeDisposition(fileName)}"\r\nContent-Type: ${mimeType}\r\n\r\n`, "utf8");
}

async function writeChunk(request, chunk) {
  if (request.write(chunk)) return;
  await once(request, "drain");
}

function ossErrorMessage(raw) {
  const code = raw.match(/<Code>([^<]+)<\/Code>/)?.[1];
  const message = raw.match(/<Message>([^<]+)<\/Message>/)?.[1];
  return [code, message].filter(Boolean).join(": ") || "OSS 上传失败";
}

export async function uploadMultipart({ signed, file, timeoutSeconds }) {
  const target = new URL(signed.host);
  const boundary = `----bihuoai-${randomBytes(16).toString("hex")}`;
  const fields = [
    ["key", signed.key],
    ["policy", signed.policy],
    ["OSSAccessKeyId", signed.OSSAccessKeyId],
    ["signature", signed.signature],
    ["callback", signed.callback],
    ["Content-Disposition", signed["Content-Disposition"]],
    ["success_action_status", "200"],
  ];
  const prefix = fields.map(([name, value]) => textPart(boundary, name, value));
  const binaryHeader = fileHeader(boundary, file.originalFileName, file.mimeType);
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const contentLength = prefix.reduce((sum, part) => sum + part.length, 0) + binaryHeader.length + file.sizeBytes + footer.length;
  const transport = target.protocol === "https:" ? https : http;

  let request;
  const responsePromise = new Promise((resolve, reject) => {
    request = transport.request(target, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": String(contentLength),
        Origin: WEB_ORIGIN,
        Referer: `${WEB_ORIGIN}/`,
      },
    }, (response) => {
      const chunks = [];
      let captured = 0;
      response.on("data", (chunk) => {
        if (captured < 64 * 1024) {
          const remaining = 64 * 1024 - captured;
          chunks.push(chunk.subarray(0, remaining));
          captured += Math.min(chunk.length, remaining);
        }
      });
      response.on("end", () => resolve({
        statusCode: response.statusCode || 0,
        raw: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
    request.setTimeout(timeoutSeconds * 1000, () => request.destroy(new Error(`OSS 上传超时（${timeoutSeconds} 秒）`)));
  });

  for (const part of prefix) await writeChunk(request, part);
  await writeChunk(request, binaryHeader);

  let uploaded = 0;
  let lastPercent = -1;
  for await (const chunk of fs.createReadStream(file.localPath)) {
    await writeChunk(request, chunk);
    uploaded += chunk.length;
    const percent = Math.floor((uploaded / file.sizeBytes) * 100);
    if (process.stderr.isTTY && (percent === 100 || percent >= lastPercent + 5)) {
      process.stderr.write(`\r上传进度 ${percent}%`);
      lastPercent = percent;
    }
  }
  if (process.stderr.isTTY && lastPercent >= 0) process.stderr.write("\n");
  request.end(footer);

  const response = await responsePromise;
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`OSS 上传 HTTP ${response.statusCode}: ${ossErrorMessage(response.raw)}`);
  }
  return response.statusCode;
}

async function runUpload(args, file) {
  if (asBoolean(args["dry-run"])) {
    return { dryRun: true, uploaded: false, file, request: requestBody(file) };
  }
  if (!asBoolean(args["confirm-upload"])) {
    throw new Error("真实上传会在必火AI OSS 中创建文件；确认后请增加 --confirm-upload。可先用 --dry-run 查看参数。");
  }

  const signed = await preUpload(args, file);
  if (signed.exists === true) {
    return { uploaded: true, deduplicated: true, url: signed.url, file };
  }

  const timeoutSeconds = asNumber(args.timeout, 300);
  if (!(timeoutSeconds > 0)) throw new Error("--timeout 必须大于 0。");
  const ossStatus = await uploadMultipart({ signed, file, timeoutSeconds });
  return {
    uploaded: true,
    deduplicated: false,
    url: signed.uploadUrl,
    ossStatus,
    file,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const action = args._[0] || "help";
  if (action === "help") {
    return printJson({
      actions: ["inspect", "preflight", "upload"],
      businessTypes: BUSINESS_TYPES,
      defaultLimitsMiB: DEFAULT_LIMIT_MIB,
      serviceMaxMiB: SERVICE_MAX_MIB,
      examples: {
        inspect: "node scripts/main.mjs inspect --file ./素材.mp4",
        preflight: "node scripts/main.mjs preflight --file ./素材.mp4",
        upload: "node scripts/main.mjs upload --file ./素材.mp4 --confirm-upload",
      },
    });
  }

  if (!["inspect", "preflight", "upload"].includes(action)) throw new Error(`未知动作: ${action}`);
  const file = await inspectFile(args);
  if (action === "inspect") return printJson({ inspected: true, uploaded: false, file, request: requestBody(file) });
  if (action === "preflight") return printJson(safePreflight(file, await preUpload(args, file)));
  return printJson(await runUpload(args, file));
}

const direct = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (direct) main().catch(fail);
