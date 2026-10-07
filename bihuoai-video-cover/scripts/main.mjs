#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  MAIN_BASE,
  apiRequest,
  asArray,
  asBoolean,
  asNumber,
  dataOf,
  deepValue,
  downloadFile,
  fail,
  getAuth,
  loadEnvFiles,
  loadSkillSettings,
  parseArgs,
  poll,
  printJson,
  readTextArg,
  requireValue,
} from "../../bihuoai-video-pipeline/scripts/bihuo-client.mjs";

loadEnvFiles();

export const PRIMARY_MODEL = "image-2";
export const FALLBACK_MODEL = "qwen-image-3.0-pro";
export const DEFAULT_RATIO = "9:16";
export const DEFAULT_FALLBACK_SIZE = "2K";
export const MAX_REFERENCE_IMAGES = 3;

const SUCCESS = 1;
const FAILED = 2;
const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const materialUploadScript = path.resolve(scriptDir, "../../bihuoai-material-upload/scripts/main.mjs");

const request = (endpoint, options = {}) => apiRequest({ base: MAIN_BASE, endpoint, ...options });

const BACKGROUND_SPECS = Object.freeze([
  { key: "hangzhou", nameKey: "cover_background_hangzhou_name", urlKey: "cover_background_hangzhou_url", aliases: ["杭州", "杭州背景", "杭州背景封面"] },
  { key: "studio", nameKey: "cover_background_studio_name", urlKey: "cover_background_studio_url", aliases: ["摄影棚", "摄影棚背景", "摄影棚背景封面"] },
  { key: "course", nameKey: "cover_background_course_name", urlKey: "cover_background_course_url", aliases: ["课程", "课程现场", "课程现场背景", "课程现场背景封面"] },
]);

function normalizeAssetName(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

export function buildCoverAssetCatalog(values = {}, configFile = null) {
  const backgrounds = BACKGROUND_SPECS.map((spec) => ({
    kind: "background",
    key: spec.key,
    name: String(values[spec.nameKey] || spec.aliases.at(-1)),
    url: values[spec.urlKey] ? String(values[spec.urlKey]) : null,
    aliases: [spec.key, ...spec.aliases],
  })).filter((item) => item.url);
  const cases = [];
  for (let index = 1; index <= 9; index += 1) {
    const number = String(index).padStart(2, "0");
    const name = values[`cover_case_${number}_name`];
    const url = values[`cover_case_${number}_url`];
    if (!url) continue;
    cases.push({
      kind: "case",
      key: `case-${number}`,
      number,
      name: String(name || `历史封面${number}`),
      url: String(url),
      aliases: [`case-${number}`, `case${number}`, `case${index}`, number, String(index), `案例${number}`, `案例${index}`, `历史封面${number}`, `历史封面${index}`],
    });
  }
  return {
    configFile,
    defaultBackground: String(values.cover_default_background || "hangzhou"),
    backgrounds,
    cases,
  };
}

export function resolveCoverAssets(requested, catalog) {
  const values = asArray(requested).map((item) => String(item).trim()).filter(Boolean);
  if (!values.length) return [];
  const all = [...catalog.backgrounds, ...catalog.cases];
  const aliases = new Map();
  for (const item of all) {
    for (const alias of [item.key, item.name, ...item.aliases]) aliases.set(normalizeAssetName(alias), item);
  }
  const defaultItem = catalog.backgrounds.find((item) => item.key === catalog.defaultBackground)
    || aliases.get(normalizeAssetName(catalog.defaultBackground));
  for (const alias of ["default", "默认", "默认背景", "默认底图"]) {
    if (defaultItem) aliases.set(normalizeAssetName(alias), defaultItem);
  }
  return values.map((value) => {
    const item = aliases.get(normalizeAssetName(value));
    if (!item) throw new Error(`私有封面素材中没有找到“${value}”。请先运行 assets 查看可用名称。`);
    return item;
  }).filter((item, index, items) => items.findIndex((other) => other.url === item.url) === index);
}

function configuredCoverAssets(requested) {
  const settings = loadSkillSettings("bihuoai-digital-human");
  const catalog = buildCoverAssetCatalog(settings.values, settings.file || null);
  return { catalog, selected: resolveCoverAssets(requested, catalog) };
}

export function normalizeWork(payload) {
  const data = dataOf(payload);
  const statusValue = deepValue(data, ["status"]);
  const recordId = deepValue(data, ["id"]);
  const taskId = deepValue(data, ["taskId"]);
  return {
    id: taskId ?? recordId,
    recordId,
    taskId,
    status: statusValue === undefined || statusValue === null ? undefined : Number(statusValue),
    type: deepValue(data, ["type"]),
    model: deepValue(data, ["model"]),
    url: deepValue(data, ["url", "imageUrl", "resultUrl"]),
    coverUrl: deepValue(data, ["coverUrl"]),
    errorMessage: deepValue(data, ["errorMessage", "error", "failReason", "message"]),
    data,
  };
}

export function isTerminal(work) {
  return [SUCCESS, FAILED].includes(Number(work?.status));
}

export function validatePrompt(value) {
  const prompt = String(requireValue(value, "--prompt 或 --prompt-file")).trim();
  if (!prompt) throw new Error("生成提示词不能为空。");
  if (prompt.length > 2000) throw new Error(`生成提示词长度为 ${prompt.length}，超过接口 2000 字符限制。`);
  return prompt;
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

export function splitReferences(values) {
  const localPaths = [];
  const urls = [];
  for (const raw of asArray(values)) {
    const value = String(raw).trim();
    if (!value) continue;
    if (isHttpUrl(value)) urls.push(value);
    else localPaths.push(path.resolve(value));
  }
  const uniqueLocal = [...new Set(localPaths)];
  const uniqueUrls = [...new Set(urls)];
  if (uniqueLocal.length + uniqueUrls.length > MAX_REFERENCE_IMAGES) {
    throw new Error(`最多使用 ${MAX_REFERENCE_IMAGES} 张参考图，以确保 Image 2 失败时可切换到千问 3.0 Pro。`);
  }
  return { localPaths: uniqueLocal, urls: uniqueUrls };
}

export function modelChain(modelOptions, requestedModel = null) {
  const images = Array.isArray(modelOptions?.image) ? modelOptions.image : [];
  const enabled = new Map(images.filter((item) => item?.enabled !== false).map((item) => [item.model, item]));
  if (requestedModel) {
    const model = String(requestedModel).trim();
    if (![PRIMARY_MODEL, FALLBACK_MODEL].includes(model)) {
      throw new Error(`不支持指定模型 ${model}；可选：${PRIMARY_MODEL}、${FALLBACK_MODEL}`);
    }
    if (!enabled.has(model)) {
      throw new Error(`当前账号没有开放指定模型 ${model}。`);
    }
    return [enabled.get(model)];
  }
  const chain = [PRIMARY_MODEL, FALLBACK_MODEL].filter((model) => enabled.has(model));
  if (!chain.length) {
    throw new Error("当前账号没有开放 Image 2 或千问 3.0 Pro，无法按本 Skill 的模型策略生成封面。");
  }
  return chain.map((model) => enabled.get(model));
}

export function buildPayload({ prompt, modelOption, ratio = DEFAULT_RATIO, referImages = [], imageSize = DEFAULT_FALLBACK_SIZE }) {
  const supportedRatios = Array.isArray(modelOption?.ratio) ? modelOption.ratio : [];
  if (supportedRatios.length && !supportedRatios.includes(ratio)) {
    throw new Error(`${modelOption.name || modelOption.model} 不支持比例 ${ratio}；可用比例：${supportedRatios.join("、")}`);
  }
  const payload = {
    prompt: validatePrompt(prompt),
    model: modelOption.model,
    ratio,
    ...(referImages.length ? { referImages } : {}),
  };
  if (Array.isArray(modelOption.imageSize) && modelOption.imageSize.length) {
    if (!modelOption.imageSize.includes(imageSize)) {
      throw new Error(`${modelOption.name || modelOption.model} 不支持 ${imageSize}；可用尺寸：${modelOption.imageSize.join("、")}`);
    }
    payload.imageSize = imageSize;
  }
  return payload;
}

function stringifyFailure(errorMessage) {
  if (errorMessage === undefined || errorMessage === null) return "";
  if (typeof errorMessage === "string") return errorMessage;
  try { return JSON.stringify(errorMessage); } catch { return String(errorMessage); }
}

export function shouldFallback(work) {
  if (Number(work?.status) !== FAILED && work?.url) return false;
  const message = stringifyFailure(work?.errorMessage);
  // Changing models cannot fix account, billing, moderation, or malformed-input failures.
  if (/(余额|积分|额度|欠费|充值|quota|credit|balance|认证|登录|权限|open.?key|token|审核|违规|敏感|违禁|policy|moderation|prompt.*invalid|参数)/i.test(message)) {
    return false;
  }
  return Number(work?.status) === FAILED || (Number(work?.status) === SUCCESS && !work?.url);
}

async function modelOptions(args) {
  return dataOf(await request("/ai-media/model-options", { ...getAuth(args) }));
}

async function inspectLocalReference(filePath) {
  if (!fs.existsSync(materialUploadScript)) {
    throw new Error(`缺少必火AI素材上传 Skill：${materialUploadScript}`);
  }
  const { stdout } = await execFileAsync(process.execPath, [materialUploadScript, "inspect", "--file", filePath, "--type", "image"], {
    maxBuffer: 2 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function uploadLocalReference(filePath) {
  const { stdout } = await execFileAsync(process.execPath, [
    materialUploadScript,
    "upload",
    "--file", filePath,
    "--type", "image",
    "--confirm-upload",
  ], {
    maxBuffer: 2 * 1024 * 1024,
    timeout: 6 * 60 * 1000,
  });
  const result = JSON.parse(stdout);
  if (!result?.url) throw new Error(`参考图上传成功但没有返回 URL：${filePath}`);
  return { file: filePath, url: result.url, deduplicated: result.deduplicated === true };
}

async function prepareReferences(args, { upload = false } = {}) {
  const privateAssets = configuredCoverAssets(args.asset);
  const combined = [
    ...asArray(args.reference),
    ...asArray(args["reference-url"]),
    ...privateAssets.selected.map((item) => item.url),
  ];
  const { localPaths, urls } = splitReferences(combined);
  const inspected = [];
  for (const filePath of localPaths) inspected.push(await inspectLocalReference(filePath));
  if (!upload) return { localPaths, urls, inspected, uploaded: [], selectedAssets: privateAssets.selected };
  const uploaded = [];
  for (const filePath of localPaths) uploaded.push(await uploadLocalReference(filePath));
  return {
    localPaths,
    urls: [...urls, ...uploaded.map((item) => item.url)],
    inspected,
    uploaded,
    selectedAssets: privateAssets.selected,
  };
}

async function pricePreview(payload, args) {
  return dataOf(await request("/ai-media/price-preview", {
    method: "POST",
    ...getAuth(args),
    body: payload,
  }));
}

async function createTask(payload, args) {
  return normalizeWork(await request("/ai-media", {
    method: "POST",
    ...getAuth(args),
    body: payload,
  }));
}

async function detailFromList(id, args) {
  const wanted = String(id);
  for (let page = 1; page <= 10; page += 1) {
    const payload = await request("/ai-media/list", {
      method: "POST",
      ...getAuth(args),
      body: { page, limit: 100, type: 1 },
    });
    const data = dataOf(payload);
    const items = Array.isArray(data?.list) ? data.list : [];
    const item = items.find((entry) => String(entry?.id) === wanted || String(entry?.taskId) === wanted);
    if (item) return normalizeWork({ data: item });
    if (!data?.totalPages || page >= Number(data.totalPages)) break;
  }
  throw new Error(`任务列表中没有找到 ${id}。`);
}

async function detail(id, args) {
  try {
    return normalizeWork(await request(`/ai-media/${encodeURIComponent(String(id))}`, { ...getAuth(args) }));
  } catch (error) {
    if (!/API 10029|数据不存在/.test(String(error?.message || error))) throw error;
    return detailFromList(id, args);
  }
}

async function waitFor(id, args) {
  return poll({
    fetcher: () => detail(id, args),
    isDone: isTerminal,
    intervalMs: asNumber(args.interval, 5000),
    timeoutMs: asNumber(args.timeout, 900) * 1000,
  });
}

function defaultOutput() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve("output", "video-covers", `${stamp}-必火AI视频封面.png`);
}

function verifyDownloadedImage(filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size <= 0) throw new Error(`下载结果为空：${filePath}`);
  const fd = fs.openSync(filePath, "r");
  const head = Buffer.alloc(12);
  fs.readSync(fd, head, 0, head.length, 0);
  fs.closeSync(fd);
  const png = head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const webp = head.subarray(0, 4).toString("ascii") === "RIFF" && head.subarray(8, 12).toString("ascii") === "WEBP";
  if (!png && !jpeg && !webp) throw new Error(`下载结果不是可识别的 PNG、JPEG 或 WebP：${filePath}`);
  return { path: filePath, sizeBytes: stat.size, format: png ? "png" : jpeg ? "jpeg" : "webp" };
}

function publicWork(work) {
  return {
    id: work.id,
    recordId: work.recordId,
    taskId: work.taskId,
    status: work.status,
    model: work.model,
    url: work.url,
    errorMessage: work.errorMessage,
  };
}

async function dryRun(args, prompt, chain, references) {
  const estimates = [];
  for (const option of chain) {
    const payload = buildPayload({
      prompt,
      modelOption: option,
      ratio: String(args.ratio || DEFAULT_RATIO),
      referImages: references.urls,
      imageSize: String(args["image-size"] || DEFAULT_FALLBACK_SIZE),
    });
    const price = await pricePreview(payload, args);
    estimates.push({ model: option.model, name: option.name, payload, amount: price?.amount ?? null });
  }
  return {
    dryRun: true,
    willUpload: references.localPaths,
    remoteReferences: references.urls,
    selectedPrivateAssets: references.selectedAssets.map((item) => ({ key: item.key, name: item.name, url: item.url })),
    inspectedReferences: references.inspected.map((item) => item.file),
    modelOrder: chain.map((item) => item.model),
    estimates,
    note: "amount 的计价单位由当前必火AI账号定义；只有首选模型失败且失败原因允许降级时才创建备用任务。",
  };
}

// Nonblocking creation for durable host workflows. A receipt is written before
// the paid call and immediately after it returns; hosts never repeat an unknown call.
async function create(args) {
  const prompt = validatePrompt(readTextArg(args, "prompt", "prompt-file"));
  const chain = modelChain(await modelOptions(args), args.model);
  const plan = await prepareReferences(args, { upload: false });
  if (asBoolean(args["dry-run"])) return dryRun(args, prompt, chain, plan);
  if (!asBoolean(args["confirm-generate"])) throw new Error("封面生成需要 --confirm-generate 确认算力消耗。");
  const receiptFile = args["receipt-file"] && path.resolve(String(args["receipt-file"]));
  if (receiptFile && fs.existsSync(receiptFile)) {
    const receipt = JSON.parse(fs.readFileSync(receiptFile, "utf8"));
    if (receipt.work?.id) return receipt;
    throw new Error("该封面请求已有提交回执，结果待核对，禁止重复创建。");
  }
  const references = await prepareReferences(args, { upload: true });
  const option = chain[0];
  const payload = buildPayload({prompt, modelOption:option, ratio:String(args.ratio || DEFAULT_RATIO), referImages:references.urls, imageSize:String(args["image-size"] || DEFAULT_FALLBACK_SIZE)});
  const price = await pricePreview(payload, args);
  const receipt = {model:option.model, estimatedAmount:price?.amount ?? null, phase:"submitting", createdAt:new Date().toISOString()};
  const save = () => {
    if (!receiptFile) return;
    fs.mkdirSync(path.dirname(receiptFile), {recursive:true, mode:0o700});
    fs.writeFileSync(receiptFile + ".tmp", JSON.stringify(receipt), {mode:0o600});
    fs.renameSync(receiptFile + ".tmp", receiptFile);
  };
  save();
  const work = await createTask(payload, args);
  receipt.work = publicWork(work); receipt.phase = work.id ? "created" : "uncertain"; save();
  if (!work.id) throw new Error("平台未返回封面任务 ID，结果待核对，请勿重复生成。");
  return receipt;
}

async function generate(args) {
  const prompt = validatePrompt(readTextArg(args, "prompt", "prompt-file"));
  const options = await modelOptions(args);
  const chain = modelChain(options, args.model);
  const referencePlan = await prepareReferences(args, { upload: false });
  if (asBoolean(args["dry-run"])) return dryRun(args, prompt, chain, referencePlan);
  if (!asBoolean(args["confirm-generate"])) {
    throw new Error("封面生成会上传指定参考图并消耗必火AI算力；确认后请增加 --confirm-generate。可先用 --dry-run 查看模型、参数和费用预估。");
  }

  const references = await prepareReferences(args, { upload: true });
  const attempts = [];
  for (let index = 0; index < chain.length; index += 1) {
    const option = chain[index];
    const payload = buildPayload({
      prompt,
      modelOption: option,
      ratio: String(args.ratio || DEFAULT_RATIO),
      referImages: references.urls,
      imageSize: String(args["image-size"] || DEFAULT_FALLBACK_SIZE),
    });
    const estimated = await pricePreview(payload, args);
    const created = await createTask(payload, args);
    if (!created.id) throw new Error(`${option.name || option.model} 创建成功但响应中没有任务 ID，停止以避免重复创建。`);
    const final = isTerminal(created) ? created : await waitFor(created.id, args);
    attempts.push({ model: option.model, estimatedAmount: estimated?.amount ?? null, created: publicWork(created), final: publicWork(final) });

    if (Number(final.status) === SUCCESS && final.url) {
      const output = path.resolve(String(args.output || defaultOutput()));
      await downloadFile(final.url, output);
      return {
        generated: true,
        fallbackUsed: index > 0,
        model: option.model,
        output: verifyDownloadedImage(output),
        work: publicWork(final),
        selectedPrivateAssets: references.selectedAssets.map((item) => ({ key: item.key, name: item.name, url: item.url })),
        uploadedReferences: references.uploaded,
        attempts,
      };
    }

    const canTryFallback = option.model === PRIMARY_MODEL && chain[index + 1]?.model === FALLBACK_MODEL && shouldFallback(final);
    if (!canTryFallback) {
      throw new Error(`${option.name || option.model} 未生成可下载图片：${stringifyFailure(final.errorMessage) || `状态 ${final.status}`}。为避免重复计费，未继续创建其他任务。任务 ID：${final.id}`);
    }
  }
  throw new Error("Image 2 和千问 3.0 Pro 均未返回可下载图片。");
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const action = args._[0] || "help";
  if (action === "help") return printJson({
    actions: ["assets", "models", "price", "list", "detail", "create", "generate", "wait", "download"],
    defaultModelOrder: [PRIMARY_MODEL, FALLBACK_MODEL],
    defaultRatio: DEFAULT_RATIO,
    maxReferenceImages: MAX_REFERENCE_IMAGES,
    example: "node scripts/main.mjs generate --prompt-file ./cover-prompt.txt --asset 杭州背景 --dry-run",
  });
  if (action === "assets") return printJson(configuredCoverAssets().catalog);
  if (action === "models") return printJson(await modelOptions(args));
  if (action === "list") return printJson(await request("/ai-media/list", {
    method: "POST",
    ...getAuth(args),
    body: { page: asNumber(args.page, 1), limit: asNumber(args["page-size"], 20), type: 1 },
  }));
  if (action === "detail") return printJson(publicWork(await detail(requireValue(args.id, "--id"), args)));
  if (action === "wait") return printJson(publicWork(await waitFor(requireValue(args.id, "--id"), args)));
  if (action === "download") {
    const work = await detail(requireValue(args.id, "--id"), args);
    if (Number(work.status) !== SUCCESS || !work.url) throw new Error("任务尚未成功，或没有可下载图片 URL。");
    const output = path.resolve(String(args.output || defaultOutput()));
    await downloadFile(work.url, output);
    return printJson({ work: publicWork(work), output: verifyDownloadedImage(output) });
  }
  if (action === "price") {
    const prompt = validatePrompt(readTextArg(args, "prompt", "prompt-file"));
    const chain = modelChain(await modelOptions(args), args.model);
    const privateAssets = configuredCoverAssets(args.asset);
    const references = splitReferences([
      ...asArray(args.reference),
      ...asArray(args["reference-url"]),
      ...privateAssets.selected.map((item) => item.url),
    ]);
    if (references.localPaths.length) throw new Error("price 只接受已上传的 --reference-url；本地图片请使用 generate --dry-run 检查。");
    const result = [];
    for (const option of chain) {
      const payload = buildPayload({ prompt, modelOption: option, ratio: String(args.ratio || DEFAULT_RATIO), referImages: references.urls, imageSize: String(args["image-size"] || DEFAULT_FALLBACK_SIZE) });
      result.push({ model: option.model, ...(await pricePreview(payload, args)) });
    }
    return printJson(result);
  }
  if (action === "create") return printJson(await create(args));
  if (action === "generate") return printJson(await generate(args));
  throw new Error(`未知动作: ${action}`);
}

const direct = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (direct) main().catch(fail);
