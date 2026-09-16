#!/usr/bin/env node
import {
  MAIN_BASE, apiRequest, asArray, asBoolean, asNumber, dataOf, deepValue, fail,
  getAuth, loadEnvFiles, parseArgs, printJson, requireValue,
} from "../../bihuoai-video-pipeline/scripts/bihuo-client.mjs";

loadEnvFiles();
const args = parseArgs();
const action = args._[0] || "help";
const request = (endpoint, options = {}) => apiRequest({ base: MAIN_BASE, endpoint, ...getAuth(args), ...options });

function pagingBody() {
  return { page: asNumber(args.page, 1), limit: asNumber(args["page-size"], 20) };
}

function articlePayload() {
  return {
    title: requireValue(args.title, "--title"),
    type: 2,
    content: requireValue(args["video-url"], "--video-url"),
    coverImageUrl: args["cover-url"] || "",
    summaries: asArray(args.summary).map(String),
  };
}

async function createDraft() {
  if (!asBoolean(args["confirm-save"]) && !asBoolean(args["confirm-publish"])) {
    throw new Error("创建草稿会写入账号数据；确认后请增加 --confirm-save。正式发布可直接使用 --confirm-publish。");
  }
  return request("/pub-article", { method: "POST", body: articlePayload() });
}

function parseTarget(value) {
  const text = String(value);
  const index = text.indexOf(":");
  if (index < 1 || index === text.length - 1) throw new Error(`发布目标格式错误: ${text}，应为 platform:uniqueId`);
  return { platform: text.slice(0, index), uniqueId: text.slice(index + 1) };
}

async function publish() {
  if (!asBoolean(args["confirm-publish"])) {
    throw new Error("正式发布会向外部平台发送内容；确认标题、视频、封面、账号和发布时间后，请增加 --confirm-publish。");
  }
  const targets = asArray(args.target).map(parseTarget);
  if (!targets.length) throw new Error("至少提供一个 --target platform:uniqueId。先运行 list-accounts 获取账号。 ");
  let articleId = args["article-id"];
  let draft;
  if (!articleId) {
    draft = await createDraft();
    articleId = deepValue(dataOf(draft), ["id", "articleId"]);
  }
  if (!articleId) throw new Error("没有取得稿件 ID，无法提交发布。");
  const submissions = [];
  for (const target of targets) {
    submissions.push(await request("/publication/submit", {
      method: "POST",
      body: { articleId: asNumber(articleId), ...target, ...(args["scheduled-at"] ? { scheduledAt: args["scheduled-at"] } : {}) },
    }));
  }
  return { articleId: asNumber(articleId), draft, submissions };
}

async function main() {
  if (action === "help") return printJson({
    actions: ["list-accounts", "list-platforms", "list-content", "list-publications", "create-draft", "publish", "retry", "delete-publication"],
    targetFormat: "--target platform:uniqueId（可重复）",
  });
  if (action === "list-accounts") return printJson(await request("/publication-account/list", { method: "POST", body: pagingBody() }));
  if (action === "list-platforms") return printJson(await request("/pub-platform"));
  if (action === "list-content") return printJson(await request("/pub-article/list", { method: "POST", body: { ...pagingBody(), type: 2 } }));
  if (action === "list-publications") return printJson(await request("/publication/list", { method: "POST", body: pagingBody() }));
  if (action === "create-draft") return printJson(await createDraft());
  if (action === "publish") return printJson(await publish());
  if (action === "retry") {
    if (!asBoolean(args["confirm-retry"])) throw new Error("确认重试发布后请增加 --confirm-retry。");
    return printJson(await request(`/publication/${requireValue(args.id, "--id")}/retry`, { method: "POST", body: {} }));
  }
  if (action === "delete-publication") {
    if (!asBoolean(args["confirm-delete"])) throw new Error("确认删除发布记录后请增加 --confirm-delete。");
    return printJson(await request(`/publication/${requireValue(args.id, "--id")}`, { method: "DELETE" }));
  }
  throw new Error(`未知动作: ${action}`);
}

main().catch(fail);
