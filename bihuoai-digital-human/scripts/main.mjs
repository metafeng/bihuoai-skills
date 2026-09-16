#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  MAIN_BASE, apiRequest, asBoolean, asNumber, dataOf, deepValue, downloadFile, fail,
  findByName, getAuth, listOf, loadEnvFiles, loadSkillSettings, parseArgs, poll, printJson, readTextArg, requireValue,
} from "../../bihuoai-video-pipeline/scripts/bihuo-client.mjs";
import { normalizeTtsText } from "./tts-normalize.mjs";

loadEnvFiles();
const args = parseArgs();
const action = args._[0] || "help";
const settings = loadSkillSettings("bihuoai-digital-human");

function configured(key, envKeys, fallback) {
  if (settings.values[key] !== undefined && settings.values[key] !== "") {
    return { value: settings.values[key], source: settings.file };
  }
  for (const envKey of envKeys) {
    if (process.env[envKey] !== undefined && process.env[envKey] !== "") {
      return { value: process.env[envKey], source: `env:${envKey}` };
    }
  }
  return { value: fallback, source: fallback === undefined ? null : "built-in" };
}

function avatarDefault() {
  const idKey = settings.values.default_avatar_id !== undefined ? "default_avatar_id" : "default_training_id";
  const id = configured(idKey, ["BIHUOAI_AVATAR_ID", "BIHUOAI_TRAINING_ID"], undefined);
  if (id.value !== undefined && id.value !== "") return { id: id.value, name: settings.values.default_avatar_name || null, source: id.source };
  const name = configured("default_avatar_name", ["BIHUOAI_AVATAR_NAME"], undefined);
  return { id: null, name: name.value || null, source: name.source };
}

function voiceDefault(avatarId) {
  const mappedKey = avatarId === undefined || avatarId === null ? null : `avatar_voice_${avatarId}`;
  if (mappedKey && settings.values[mappedKey] !== undefined && settings.values[mappedKey] !== "") {
    return { id: settings.values[mappedKey], name: null, source: settings.file, mappedFromAvatarId: asNumber(avatarId) };
  }
  const id = configured("default_voice_id", ["BIHUOAI_VOICE_ID"], undefined);
  if (id.value !== undefined && id.value !== "") return { id: id.value, name: settings.values.default_voice_name || null, source: id.source };
  const name = configured("default_voice_name", ["BIHUOAI_VOICE_NAME"], undefined);
  return { id: null, name: name.value || null, source: name.source };
}

function avatarVoiceMappings() {
  return Object.entries(settings.values)
    .filter(([key, value]) => /^avatar_voice_\d+$/.test(key) && value !== undefined && value !== "")
    .map(([key, value]) => ({ avatarId: asNumber(key.slice("avatar_voice_".length)), voiceId: String(value) }));
}

function ttsNormalizationEnabled() {
  if (asBoolean(args["no-tts-normalize"])) return false;
  if (args["tts-normalize"] !== undefined) return asBoolean(args["tts-normalize"], true);
  return asBoolean(configured("tts_normalize", ["BIHUOAI_TTS_NORMALIZE"], true).value, true);
}

function saveTtsText(text) {
  if (!args["tts-output"]) return undefined;
  const target = path.resolve(String(args["tts-output"]));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${String(text).trim()}\n`, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(target, 0o600);
  return target;
}

function prepareTtsText() {
  const originalText = requireValue(readTextArg(args), "--text 或 --text-file");
  const enabled = ttsNormalizationEnabled();
  const result = enabled
    ? normalizeTtsText(originalText)
    : { originalText, ttsText: originalText, changed: false, changes: [] };
  return { enabled, ...result, output: saveTtsText(result.ttsText) };
}

function normalizationSummary(result) {
  return {
    enabled: result.enabled,
    changed: result.changed,
    changes: result.changes,
    output: result.output,
  };
}

const request = (endpoint, options = {}) => apiRequest({ base: MAIN_BASE, endpoint, ...options });
const auth = () => getAuth(args);

async function listAvatars(scope = args.scope || "mine") {
  const isPublic = scope === "public";
  const payload = await request(isPublic ? "/training/list/public" : "/training/list", {
    method: "POST", ...auth(),
    body: { page: asNumber(args.page, 1), limit: asNumber(args["page-size"], 100), includeTeamShared: true },
  });
  return payload;
}

async function listVoices(scope = args.scope || "mine") {
  const isSystem = scope === "system";
  return request(isSystem ? "/voice-clone/system" : "/voice-clone/list", {
    method: "POST", ...auth(),
    body: { page: asNumber(args.page, 1), limit: asNumber(args["page-size"], 100), includeTeamShared: true },
  });
}

async function resolveAvatar() {
  if (args["avatar-id"]) return asNumber(args["avatar-id"]);
  const fallback = avatarDefault();
  if (!args["avatar-name"] && fallback.id !== null) return asNumber(fallback.id);
  const name = args["avatar-name"] || fallback.name;
  requireValue(name, "--avatar-id、--avatar-name，或 EXTEND.md 中的默认形象");
  const item = findByName(listOf(await listAvatars("mine")), name, ["trainingName", "name", "title"]);
  return asNumber(item.trainingId ?? item.id);
}

async function resolveVoice(avatarId) {
  if (args["voice-id"]) return String(args["voice-id"]);
  if (args["voice-name"]) {
    const item = findByName(listOf(await listVoices("mine")), args["voice-name"], ["localName", "voiceName", "name", "title"]);
    return String(item.voiceId ?? item.id);
  }
  const fallback = voiceDefault(avatarId);
  if (fallback.id !== null) return String(fallback.id);
  const name = fallback.name;
  requireValue(name, "--voice-id、--voice-name，或 EXTEND.md 中的默认声音");
  const item = findByName(listOf(await listVoices("mine")), name, ["localName", "voiceName", "name", "title"]);
  return String(item.voiceId ?? item.id);
}

async function showDefaults() {
  const avatar = avatarDefault();
  const voice = voiceDefault();
  const result = {
    configFile: settings.file || null,
    avatar: {
      id: avatar.id === null ? null : asNumber(avatar.id),
      name: avatar.name,
      source: avatar.source,
    },
    voice: {
      id: voice.id === null ? null : String(voice.id),
      name: voice.name,
      source: voice.source,
    },
    speed: asNumber(configured("default_speed", ["BIHUOAI_SPEED"], 1).value, 1),
    emotion: String(configured("default_emotion", ["BIHUOAI_EMOTION"], "calm").value),
    avatarVoiceMappings: avatarVoiceMappings(),
  };
  if (asBoolean(args.verify)) {
    const [avatars, voices] = await Promise.all([listAvatars("mine"), listVoices("mine")]);
    const avatarItem = listOf(avatars).find((item) => result.avatar.id !== null
      ? String(item.trainingId ?? item.id) === String(result.avatar.id)
      : String(item.trainingName ?? item.name ?? item.title ?? "") === String(result.avatar.name));
    const voiceItem = listOf(voices).find((item) => result.voice.id !== null
      ? String(item.voiceId ?? item.id) === result.voice.id
      : String(item.localName ?? item.voiceName ?? item.name ?? item.title ?? "") === String(result.voice.name));
    result.avatar.exists = Boolean(avatarItem);
    result.avatar.currentName = avatarItem?.trainingName ?? avatarItem?.name ?? avatarItem?.title ?? null;
    result.voice.exists = Boolean(voiceItem);
    result.voice.currentName = voiceItem?.localName ?? voiceItem?.voiceName ?? voiceItem?.name ?? voiceItem?.title ?? null;
  }
  return result;
}

async function detail(id) {
  return request(`/dh-video/detail/${id}`, { ...auth() });
}

function normalized(payload) {
  const data = dataOf(payload);
  return {
    id: deepValue(data, ["id", "dhVideoId"]),
    status: Number(deepValue(data, ["status"])),
    progress: deepValue(data, ["progress"]),
    videoUrl: deepValue(data, ["videoUrl", "resultUrl"]),
    coverUrl: deepValue(data, ["coverUrl", "coverImageUrl"]),
    data,
  };
}

async function create() {
  const title = args.title || `数字人视频-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}`;
  const trainingId = await resolveAvatar();
  const payload = {
    videoName: title,
    version: asNumber(args.version, 2),
    trainingId,
  };
  let textNormalization;
  if (args["audio-url"]) payload.audioUrl = String(args["audio-url"]);
  else {
    textNormalization = prepareTtsText();
    payload.text = textNormalization.ttsText;
    payload.voiceId = await resolveVoice(trainingId);
    payload.voiceExtra = {
      speed: asNumber(args.speed, asNumber(configured("default_speed", ["BIHUOAI_SPEED"], 1).value, 1)),
      languageBoost: args.language || "auto",
      emotion: args.emotion || String(configured("default_emotion", ["BIHUOAI_EMOTION"], "calm").value),
      soundEffects: args["sound-effects"] || null,
    };
  }
  if (asBoolean(args["dry-run"])) return { dryRun: true, payload, textNormalization };
  if (!asBoolean(args["confirm-create"])) throw new Error("数字人合成会消耗算力；确认后请增加 --confirm-create。可先用 --dry-run 查看参数。");
  const createdRaw = await request("/dh-video/create", { method: "POST", ...auth(), body: payload });
  const created = normalized(createdRaw);
  if (!created.id) throw new Error("创建成功但响应中没有找到作品 ID，请检查完整响应。 ");
  if (!asBoolean(args.wait)) return { created, ...(textNormalization ? { textNormalization: normalizationSummary(textNormalization) } : {}) };
  const final = normalized(await waitFor(created.id));
  let downloadedTo;
  if (args.download && final.status === 1) downloadedTo = await downloadFile(final.videoUrl, args.download);
  return { created, final, downloadedTo, ...(textNormalization ? { textNormalization: normalizationSummary(textNormalization) } : {}) };
}

async function waitFor(id) {
  return poll({
    fetcher: () => detail(id),
    isDone: (value) => [1, 2].includes(normalized(value).status),
    intervalMs: asNumber(args.interval, 5000),
    timeoutMs: asNumber(args.timeout, 1800) * 1000,
  });
}

async function main() {
  if (action === "help") return printJson({
    actions: ["normalize-text", "show-defaults", "list-avatars", "list-voices", "list", "detail", "create", "wait", "download"],
    example: "node scripts/main.mjs create --text-file script.txt --confirm-create --wait --download output.mp4",
  });
  if (action === "normalize-text") return printJson(prepareTtsText());
  if (action === "show-defaults") return printJson(await showDefaults());
  if (action === "list-avatars") return printJson(await listAvatars());
  if (action === "list-voices") return printJson(await listVoices());
  if (action === "list") return printJson(await request("/dh-video/list", { method: "POST", ...auth(), body: { page: asNumber(args.page, 1), limit: asNumber(args["page-size"], 20) } }));
  if (action === "detail") return printJson(await detail(requireValue(args.id, "--id")));
  if (action === "create") return printJson(await create());
  if (action === "wait") return printJson(normalized(await waitFor(requireValue(args.id, "--id"))));
  if (action === "download") {
    const work = normalized(await detail(requireValue(args.id, "--id")));
    return printJson({ downloadedTo: await downloadFile(work.videoUrl, requireValue(args.output, "--output")), work });
  }
  throw new Error(`未知动作: ${action}`);
}

main().catch(fail);
