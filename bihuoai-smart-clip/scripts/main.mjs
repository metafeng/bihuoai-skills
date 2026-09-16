#!/usr/bin/env node
import {
  CLIP_BASE, apiRequest, asBoolean, asNumber, dataOf, deepValue, downloadFile, fail,
  findByName, getAuth, listOf, loadEnvFiles, parseArgs, poll, printJson, readJsonFile, requireValue,
} from "../../bihuoai-video-pipeline/scripts/bihuo-client.mjs";

loadEnvFiles();
const args = parseArgs();
const action = args._[0] || "help";
const request = (endpoint, options = {}) => apiRequest({ base: CLIP_BASE, endpoint, ...options });
const auth = () => getAuth(args);

async function templates() {
  return request("/clip-video-template/list", {
    method: "POST", ...auth(),
    body: { page: asNumber(args.page, 1), limit: asNumber(args["page-size"], 100) },
  });
}

async function resolveTemplate() {
  if (args.template) return String(args.template);
  requireValue(args["template-name"], "--template 或 --template-name；先运行 list-templates 查询当前账号可用模板");
  const item = findByName(listOf(await templates()), args["template-name"], ["name", "title", "templateName"]);
  return String(item.code ?? item.templateCode ?? item.id);
}

async function detail(id) {
  return request(`/clip-task/${id}`, { ...auth() });
}

function normalized(payload) {
  const data = dataOf(payload);
  return {
    id: deepValue(data, ["id", "taskId", "clipTaskId"]),
    status: Number(deepValue(data, ["status"])),
    progress: deepValue(data, ["progress"]),
    videoUrl: deepValue(data, ["outputMp4Url", "videoUrl", "resultUrl", "outputUrl", "previewVideoUrl"]),
    coverUrl: deepValue(data, ["coverUrl", "coverImageUrl"]),
    data,
  };
}

async function waitFor(id) {
  return poll({
    fetcher: () => detail(id),
    isDone: (value) => [1, 2, 5].includes(normalized(value).status),
    intervalMs: asNumber(args.interval, 5000),
    timeoutMs: asNumber(args.timeout, 1800) * 1000,
  });
}

async function create() {
  let payload;
  if (args.config) payload = readJsonFile(args.config);
  else {
    payload = {
      template: await resolveTemplate(),
      workName: args.title || `智能剪辑-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}`,
      video: [],
      source: { main: { type: "dh", dhVideoId: asNumber(requireValue(args["dh-video-id"], "--dh-video-id")) } },
      coverConfig: { mode: args["cover-mode"] || "auto" },
    };
    if (args["max-lines"]) payload.maxLines = asNumber(args["max-lines"]);
    if (args.bgm) payload.bgm = args.bgm;
    if (args["bgm-auto-match"] !== undefined) payload.bgmAutoMatch = asBoolean(args["bgm-auto-match"]);
  }
  if (asBoolean(args["dry-run"])) return { dryRun: true, payload };
  if (!asBoolean(args["confirm-clip"])) throw new Error("智能剪辑可能消耗算力；确认后请增加 --confirm-clip。可先用 --dry-run 查看参数。");
  const createdRaw = await request("/clip-task", { method: "POST", ...auth(), body: payload });
  const created = normalized(createdRaw);
  if (!created.id) throw new Error("创建成功但响应中没有找到剪辑任务 ID。");
  if (!asBoolean(args.wait)) return { created };
  const final = normalized(await waitFor(created.id));
  let downloadedTo;
  if (args.download && final.status === 1) downloadedTo = await downloadFile(final.videoUrl, args.download);
  return { created, final, downloadedTo, needsReview: final.status === 5 };
}

async function main() {
  if (action === "help") return printJson({
    actions: ["list-templates", "list", "detail", "create", "wait", "download", "confirm-review"],
    statuses: { "-2": "预处理", "-1": "就绪", "4": "处理中", "1": "完成", "2": "失败", "5": "等待人工确认" },
  });
  if (action === "list-templates") return printJson(await templates());
  if (action === "list") return printJson(await request("/clip-task/list", { method: "POST", ...auth(), body: { page: asNumber(args.page, 1), limit: asNumber(args["page-size"], 20) } }));
  if (action === "detail") return printJson(await detail(requireValue(args.id, "--id")));
  if (action === "create") return printJson(await create());
  if (action === "wait") return printJson(normalized(await waitFor(requireValue(args.id, "--id"))));
  if (action === "download") {
    const work = normalized(await detail(requireValue(args.id, "--id")));
    return printJson({ downloadedTo: await downloadFile(work.videoUrl, requireValue(args.output, "--output")), work });
  }
  if (action === "confirm-review") {
    if (!asBoolean(args["confirm-review"])) throw new Error("这是人工审核确认动作；确认后请增加 --confirm-review。");
    const body = args.config ? readJsonFile(args.config) : {};
    return printJson(await request(`/clip-task/${requireValue(args.id, "--id")}/confirm`, { method: "POST", ...auth(), body }));
  }
  throw new Error(`未知动作: ${action}`);
}

main().catch(fail);
