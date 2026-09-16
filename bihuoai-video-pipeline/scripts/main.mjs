#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { asArray, asBoolean, deepValue, fail, loadEnvFiles, parseArgs, printJson, requireValue } from "./bihuo-client.mjs";

loadEnvFiles();
const args = parseArgs();
const action = args._[0] || "help";
const suiteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scripts = {
  digitalHuman: path.join(suiteDir, "bihuoai-digital-human", "scripts", "main.mjs"),
  smartClip: path.join(suiteDir, "bihuoai-smart-clip", "scripts", "main.mjs"),
  publish: path.join(suiteDir, "bihuoai-publish", "scripts", "main.mjs"),
};

function add(cli, flag, value) {
  if (value === undefined || value === null || value === false || value === "") return;
  cli.push(`--${flag}`);
  if (value !== true) cli.push(String(value));
}

async function runScript(script, cli) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...cli], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || `子流程退出码 ${code}`));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error(`子流程没有返回有效 JSON: ${stdout.slice(0, 300)}`)); }
    });
  });
}

function statePath() {
  return args["state-file"] ? path.resolve(String(args["state-file"])) : null;
}

function loadState() {
  const file = statePath();
  if (!file || !fs.existsSync(file)) return { version: 1, updatedAt: new Date().toISOString() };
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function saveState(state) {
  state.updatedAt = new Date().toISOString();
  const file = statePath();
  if (file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  }
}

function idFrom(value, keys) {
  const id = deepValue(value, keys);
  if (id === undefined || id === null) throw new Error(`响应中没有找到 ${keys.join("/")}`);
  return id;
}

function mediaFrom(value) {
  return {
    videoUrl: deepValue(value, ["outputMp4Url", "videoUrl", "resultUrl", "outputUrl", "previewVideoUrl"]),
    coverUrl: deepValue(value, ["coverUrl", "coverImageUrl"]),
  };
}

async function runPipeline() {
  const state = loadState();
  if (!state.digitalHuman) {
    const cli = ["create", "--wait"];
    for (const key of ["title", "text", "text-file", "tts-output", "tts-normalize", "audio-url", "avatar-id", "avatar-name", "voice-id", "voice-name", "version", "speed", "emotion", "language", "timeout", "interval", "open-key"]) add(cli, key, args[key]);
    add(cli, "no-tts-normalize", args["no-tts-normalize"]);
    add(cli, "confirm-create", args["confirm-create"]);
    add(cli, "dry-run", args["dry-run"]);
    add(cli, "download", args["digital-human-output"]);
    const digitalHuman = await runScript(scripts.digitalHuman, cli);
    if (asBoolean(args["dry-run"])) return { ...state, digitalHuman };
    state.digitalHuman = digitalHuman;
    saveState(state);
  }

  const dhId = args["dh-video-id"] || idFrom(state.digitalHuman, ["dhVideoId", "id"]);
  let finalMedia = mediaFrom(state.digitalHuman);
  if (!asBoolean(args["skip-clip"]) && !state.smartClip) {
    const cli = ["create", "--wait", "--dh-video-id", String(dhId)];
    for (const key of ["title", "template", "template-name", "config", "max-lines", "bgm", "bgm-auto-match", "timeout", "interval", "open-key"]) add(cli, key, args[key]);
    add(cli, "confirm-clip", args["confirm-clip"]);
    add(cli, "dry-run", args["dry-run"]);
    add(cli, "download", args["clip-output"]);
    const smartClip = await runScript(scripts.smartClip, cli);
    if (asBoolean(args["dry-run"])) return { ...state, smartClip };
    state.smartClip = smartClip;
    saveState(state);
    const clipStatus = Number(deepValue(state.smartClip, ["status"]));
    if (clipStatus === 5) {
      state.needsReview = true;
      saveState(state);
      return state;
    }
    finalMedia = mediaFrom(state.smartClip);
  } else if (state.smartClip) finalMedia = mediaFrom(state.smartClip);

  if (asArray(args.target).length && !state.publish) {
    requireValue(finalMedia.videoUrl, "成品视频 URL");
    const cli = ["publish"];
    for (const key of ["title", "scheduled-at", "open-key"]) add(cli, key, args[key]);
    add(cli, "video-url", finalMedia.videoUrl);
    add(cli, "cover-url", args["cover-url"] || finalMedia.coverUrl);
    for (const summary of asArray(args.summary)) add(cli, "summary", summary);
    for (const target of asArray(args.target)) add(cli, "target", target);
    add(cli, "confirm-publish", args["confirm-publish"]);
    state.publish = await runScript(scripts.publish, cli);
    saveState(state);
  }
  return state;
}

async function main() {
  if (action === "help") return printJson({
    actions: ["run", "show-state"],
    stages: ["数字人合成", "智能剪辑（可跳过）", "视频发布（提供 target 时启用）"],
    safetyFlags: ["--confirm-create", "--confirm-clip", "--confirm-publish"],
  });
  if (action === "run") return printJson(await runPipeline());
  if (action === "show-state") return printJson(loadState());
  throw new Error(`未知动作: ${action}`);
}

main().catch(fail);
