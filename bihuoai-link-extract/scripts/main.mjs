#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  MAIN_BASE, apiRequest, asBoolean, asNumber, dataOf, deepValue, fail, getAuth,
  loadEnvFiles, parseArgs, poll, printJson, requireValue,
} from "../../bihuoai-video-pipeline/scripts/bihuo-client.mjs";

loadEnvFiles();
const args = parseArgs();
const action = args._[0] || "help";
const request = (endpoint, options = {}) => apiRequest({ base: MAIN_BASE, endpoint, ...getAuth(args), ...options });

function normalized(payload) {
  const data = dataOf(payload);
  return {
    taskId: deepValue(data, ["taskId", "id"]),
    status: Number(deepValue(data, ["status"])),
    title: deepValue(data, ["title"]),
    textContent: deepValue(data, ["textContent", "transcript", "text"]),
    message: deepValue(data, ["message"]),
    errorMessage: deepValue(data, ["errorMessage", "error"]),
    data,
  };
}

async function detail(id) {
  return request(`/transcript/task/${id}`);
}

async function waitFor(id) {
  return poll({
    fetcher: () => detail(id),
    isDone: (value) => [1, 2].includes(normalized(value).status),
    intervalMs: asNumber(args.interval, 2000),
    timeoutMs: asNumber(args.timeout, 180) * 1000,
  });
}

function saveText(work) {
  if (!args.output) return undefined;
  if (work.status !== 1 || !String(work.textContent || "").trim()) {
    throw new Error("提取任务尚未成功或文稿为空，不写入输出文件。");
  }
  const target = path.resolve(String(args.output));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${String(work.textContent).trim()}\n`, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(target, 0o600);
  return target;
}

async function extract() {
  const body = {
    url: String(requireValue(args.url, "--url")),
    ...(asBoolean(args["media-only"]) ? { mediaOnly: true } : {}),
  };
  if (asBoolean(args["dry-run"])) return { dryRun: true, endpoint: "/transcript/extract", body };
  if (!asBoolean(args["confirm-extract"])) {
    throw new Error("链接提取可能按文案提取计费；确认后请增加 --confirm-extract。可先用 --dry-run 查看参数。");
  }
  const created = normalized(await request("/transcript/extract", { method: "POST", body }));
  if (!created.taskId) throw new Error("接口响应中没有找到 taskId，请检查完整响应。");
  if (!asBoolean(args.wait)) return { created };
  const final = normalized(await waitFor(created.taskId));
  return { created, final, output: saveText(final) };
}

async function main() {
  if (action === "help") return printJson({
    actions: ["list", "detail", "extract", "wait"],
    statuses: { "4": "排队", "-2": "处理中", "1": "成功", "2": "失败" },
    example: "node scripts/main.mjs extract --url '视频分享链接' --dry-run",
  });
  if (action === "list") return printJson(await request("/transcript/list", {
    method: "POST",
    body: { page: asNumber(args.page, 1), limit: asNumber(args["page-size"], 30) },
  }));
  if (action === "detail") return printJson(normalized(await detail(requireValue(args.id, "--id"))));
  if (action === "extract") return printJson(await extract());
  if (action === "wait") {
    const final = normalized(await waitFor(requireValue(args.id, "--id")));
    return printJson({ final, output: saveText(final) });
  }
  throw new Error(`未知动作: ${action}`);
}

main().catch(fail);
