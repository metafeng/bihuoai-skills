#!/usr/bin/env node
// Uses Codex's OAuth-managed MCP transport; never reads credential stores.
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const SERVER = 'agent-bihuoai';
const CREATES = { create_digital_human_video: 'digitalHuman', create_clip_task: 'clip' };
const AUTH_FAILURE = /unauthorized|unauthenticated|invalid_grant|expired|revoked|forbidden|授权.*(失效|过期|撤销)|权限不足/i;
export class ToolError extends Error {}
export function unwrap(response) {
  const blocks = response.content?.filter(x => x.type === 'text') ?? [];
  const data = blocks.map(x => { try { return JSON.parse(x.text); } catch { return x.text; } });
  const result = data.length === 1 ? data[0] : (response.structuredContent ?? data);
  if (response.isError || result?.status === 'error') throw new ToolError(result?.message ?? JSON.stringify(result));
  return result;
}
export async function atomicState(file, state) {
  state.updatedAt = new Date().toISOString();
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(tmp, file);
  await fs.chmod(file, 0o600);
}
export class McpBroker {
  constructor({ codex = 'codex', timeoutMs = 60000 } = {}) {
    this.codex = codex; this.timeoutMs = timeoutMs; this.pending = new Map(); this.sequence = 0;
  }
  async connect() {
    this.child = spawn(this.codex, ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
    // Do not forward runtime stderr, which may contain unrelated local diagnostics.
    this.child.stderr.resume();
    this.child.on('error', error => this.rejectPending(error));
    this.child.on('exit', () => this.rejectPending(new Error('Codex MCP broker disconnected')));
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      let msg; try { msg = JSON.parse(line); } catch { return; }
      const waiter = this.pending.get(msg.id); if (!waiter) return;
      this.pending.delete(msg.id); clearTimeout(waiter.timer);
      msg.error ? waiter.reject(new Error(JSON.stringify(msg.error))) : waiter.resolve(msg.result);
    });
    await this.rpc('initialize', {
      clientInfo: { name: 'bihuoai-video-pipeline', title: '必火AI视频全流程', version: '2.0' },
      capabilities: { experimentalApi: true, requestAttestation: false }
    });
    this.child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    const inventory = await this.rpc('mcpServerStatus/list', { serverName: SERVER, detail: 'toolsAndAuthOnly' });
    const server = inventory.data?.find(x => x.name === SERVER);
    if (!server || server.toolsError || !Object.keys(server.tools ?? {}).length)
      throw new Error(server?.toolsError ?? 'No configured, usable agent-bihuoai MCP tools');
    this.tools = server.tools;
    // An ephemeral MCP runtime only: no turn/start, model execution, saved chat or subagent.
    const context = await this.rpc('thread/start', { ephemeral: true, cwd: process.cwd() });
    this.contextId = context.thread.id;
    await this.call('get_usage_guide');
    return this;
  }
  rejectPending(error) {
    for (const waiter of this.pending.values()) { clearTimeout(waiter.timer); waiter.reject(error); }
    this.pending.clear();
  }
  rpc(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timed out: ${method}; outcome may be unknown`)); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
  }
  async call(tool, args = {}) {
    if (!this.tools?.[tool]) throw new Error(`Tool unavailable: ${tool}`);
    const reply = await this.rpc('mcpServer/tool/call', {
      threadId: this.contextId, server: SERVER, tool, arguments: args
    });
    return unwrap(reply);
  }
  close() { this.rejectPending(new Error('Broker closed')); this.lines?.close(); this.child?.kill(); }
}
export function terminalResult(stage, data) {
  if (stage === 'clip' && data.clipStatus === 5) return { status: 'awaiting_confirmation' };
  if (data.isTerminal !== true) return { status: 'processing' };
  const url = stage === 'digitalHuman' ? data.videoUrl : data.outputMp4Url;
  const success = stage === 'digitalHuman' ? (data.status === 1 || data.status === 'success') : data.clipStatus === 1;
  if (success && url) return { status: 'success', videoUrl: url };
  return { status: 'failed', error: data.error ?? data.resultDesc ?? 'Terminal task has no successful result URL' };
}
export async function createAndRecord(client, tool, args, state, persist) {
  const stage = CREATES[tool];
  if (!stage) throw new Error('This helper only creates digital-human and clip tasks; use bound MCP tools for other stages');
  state[stage] ??= { status: 'pending' };
  const task = state[stage];
  if (state.authorization?.[stage] !== true) throw new Error(`Missing existing user authorization for ${stage}`);
  if (stage === 'digitalHuman' && !['confirmed', 'confirmed_input', 'finalized_by_agent'].includes(state.copywriting?.status))
    throw new Error('Finalize or confirm the copy before paid digital-human creation');
  if (task.taskId || ['submitting', 'unknown', 'failed'].includes(task.status))
    throw new Error(`Do not recreate ${stage}; recover the original task or obtain explicit retry authorization`);
  if (stage === 'clip' && args.mode !== 'auto') throw new Error('Unattended clipping requires mode=auto');
  if (stage === 'clip' && (!args.mainVideoUrl || ['script', 'voiceId', 'trainingId'].some(key => args[key] !== undefined)))
    throw new Error('Resume clipping must use the existing mainVideoUrl without another digital-human synthesis');
  task.status = 'submitting'; task.submittedAt = new Date().toISOString(); await persist(state);
  try {
    const reply = await client.call(tool, args);
    const id = stage === 'digitalHuman' ? reply.dhVideoId : reply.taskId;
    if (!id) throw new Error('Create response has no task ID; recover with list_my_tasks before any retry');
    task.taskId = id; task.status = 'processing'; task.creationResponse = reply;
    await persist(state); // Save ID before returning control or starting any wait.
    return reply;
  } catch (error) {
    // If persistence fails after getting an ID, retain it in memory for a recovery write.
    task.status = task.taskId ? 'processing' : (error instanceof ToolError ? 'failed' : 'unknown');
    task.error = error.message; await persist(state); throw error;
  }
}
async function readWithRetry(client, tool, args, wait) {
  for (let attempt = 0; ; attempt++) {
    try { return await client.call(tool, args); }
    catch (error) { if (error instanceof ToolError || AUTH_FAILURE.test(error.message) || attempt >= 2) throw error; await wait(15000); }
  }
}
async function verifyTemplate(client, state, wait) {
  if (!state.clip.templateCode) throw new Error('Missing previously selected templateCode');
  if (state.cover && !['skipped', 'success'].includes(state.cover.status))
    throw new Error('Finish the requested cover stage before unattended resume');
  const result = await readWithRetry(client, 'list_clip_templates', { keyword: state.clip.templateCode, limit: 50 }, wait);
  const template = result.templates?.find(x => x.code === state.clip.templateCode);
  if (!template) throw new Error('Selected template is not available in the current account');
  if (template.requireCover && !state.cover?.imageUrl) throw new Error('Selected template requires a completed, authorized cover');
}
export async function resumePipeline({ state, persist, client, deliver, wait = ms => sleep(ms), pollSeconds = 45, maxWaitSeconds = 0, emit = () => {} }) {
  if (!Number.isFinite(pollSeconds) || pollSeconds < 15 || pollSeconds > 55) throw new Error('poll-seconds must be between 15 and 55');
  if (!Number.isFinite(maxWaitSeconds) || maxWaitSeconds < 0) throw new Error('max-wait-seconds must be zero or positive');
  if (state.cover && !['skipped', 'success'].includes(state.cover.status)) throw new Error('Finish the requested cover stage before unattended resume');
  const started = Date.now();
  let lastEvent = '';
  const beforeQuery = async task => {
    const timestamp = Date.parse(task.lastCheckedAt ?? task.submittedAt ?? '');
    if (Number.isFinite(timestamp)) {
      const remaining = 15000 - (Date.now() - timestamp);
      if (remaining > 0) await wait(remaining);
    }
  };
  for (;;) {
    if (maxWaitSeconds && Date.now() - started >= maxWaitSeconds * 1000) {
      state.status = 'waiting'; await persist(state); emit({ status: 'waiting', reason: 'time_limit', resumable: true }); return state;
    }
    if (state.digitalHuman?.taskId && state.digitalHuman.status !== 'success') {
      if (state.digitalHuman.status === 'failed') throw new Error('Original digital-human task failed; do not recreate automatically');
      await beforeQuery(state.digitalHuman);
      const data = await readWithRetry(client, 'get_dh_video_status', { dhVideoId: state.digitalHuman.taskId }, wait);
      Object.assign(state.digitalHuman, terminalResult('digitalHuman', data), { lastStatus: data, lastCheckedAt: new Date().toISOString() });
      await persist(state);
      if (state.digitalHuman.status === 'failed') throw new Error(state.digitalHuman.error);
    }
    const clipWanted = state.clip && state.clip.status !== 'skipped';
    if (clipWanted && !state.clip.taskId && state.digitalHuman?.status === 'success') {
      await verifyTemplate(client, state, wait);
      await createAndRecord(client, 'create_clip_task', {
        templateCode: state.clip.templateCode, mainVideoUrl: state.digitalHuman.videoUrl,
        workName: state.title, mode: 'auto',
        ...(state.clip.userPrompt ? { userPrompt: state.clip.userPrompt } : {}),
        ...(state.cover?.imageUrl ? { coverUrl: state.cover.imageUrl } : {})
      }, state, persist);
      // No immediate same-task status polling after creation.
      await wait(pollSeconds * 1000);
    }
    if (clipWanted && state.clip.taskId && state.clip.status !== 'success') {
      if (state.clip.status === 'failed') throw new Error('Original clip task failed; do not recreate automatically');
      await beforeQuery(state.clip);
      const data = await readWithRetry(client, 'get_clip_task_status', { taskId: state.clip.taskId }, wait);
      Object.assign(state.clip, terminalResult('clip', data), { lastStatus: data, lastCheckedAt: new Date().toISOString() });
      await persist(state);
      if (state.clip.status === 'awaiting_confirmation') { state.status = 'awaiting_confirmation'; await persist(state); emit({ stage: 'clip', status: state.status }); return state; }
      if (state.clip.status === 'failed') throw new Error(state.clip.error);
    }
    const finalStage = clipWanted ? state.clip : state.digitalHuman;
    if (finalStage?.status === 'success' && finalStage.videoUrl) {
      state.delivery = await deliver(finalStage, state); state.status = 'complete'; await persist(state);
      emit({ status: 'complete', delivery: state.delivery }); return state;
    }
    if (!state.digitalHuman?.taskId && !state.clip?.taskId) throw new Error('No task to resume; submit an authorized digital-human task first');
    const active = clipWanted && state.clip.taskId ? 'clip' : 'digitalHuman';
    const event = JSON.stringify({ stage: active, status: state[active]?.status ?? 'processing' });
    if (event !== lastEvent) { emit(JSON.parse(event)); lastEvent = event; }
    await wait(pollSeconds * 1000);
  }
}
export async function downloadAndCheck(stage, state, directory, signal) {
  const url = new URL(stage.videoUrl); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Result must be an HTTP(S) URL');
  const taskName = String(stage.taskId).replace(/[^a-zA-Z0-9_-]/g, '_');
  let file = path.join(directory, `video-${taskName}.mp4`);
  let bytes = 0;
  if (stage.localPath && path.isAbsolute(stage.localPath)) {
    try { const info = await fs.stat(stage.localPath); if (info.isFile() && info.size > 0) { file = stage.localPath; bytes = info.size; } } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!bytes) {
    const response = await fetch(url, { signal }); if (!response.ok) throw new Error(`Download HTTP ${response.status}; rerun resume without recreating tasks`);
    const data = Buffer.from(await response.arrayBuffer()); if (!data.length) throw new Error('Empty video download');
    await fs.writeFile(file + '.part', data, { mode: 0o600 }); await fs.rename(file + '.part', file); bytes = data.length;
  }
  stage.localPath = file;
  const result = { localPath: file, taskId: stage.taskId, bytes, checks: ['nonempty_local_file'] };
  try {
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file], { encoding: 'utf8' }));
    const video = probe.streams?.find(x => x.codec_type === 'video');
    if (!video || !(Number(probe.format?.duration) > 0)) throw new Error('No valid video stream or duration');
    Object.assign(result, { durationSeconds: Number(probe.format.duration), width: video.width, height: video.height });
    execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', file, '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 120000 });
    result.checks.push('media_probe', 'full_decode');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    result.limitation = 'ffprobe or ffmpeg unavailable; full media validation not completed';
  }
  return result;
}
function options(argv) {
  const [command, ...rest] = argv; const out = { command, positional: [] };
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) { const key = rest[i].slice(2); if (!rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error(`Missing value for --${key}`); out[key] = rest[++i]; }
    else out.positional.push(rest[i]);
  }
  return out;
}
async function main() {
  if (!process.argv[2] || ['--help', 'help'].includes(process.argv[2])) {
    console.log('Usage: node pipeline-runtime.mjs tools [--tool NAME]\n       node pipeline-runtime.mjs call TOOL [--json /path/args.json] [--state /path/state.json]\n       node pipeline-runtime.mjs resume --state /path/state.json [--poll-seconds 45] [--max-wait-seconds 0]\nOptional: --codex-bin /path/to/codex. No credentials or platform API options.'); return;
  }
  const opts = options(process.argv.slice(2)); if (!['tools', 'call', 'resume'].includes(opts.command)) throw new Error('Unknown command');
  const allowed = new Set(['command', 'positional', 'state', 'json', 'tool', 'codex-bin', 'poll-seconds', 'max-wait-seconds']);
  for (const key of Object.keys(opts)) if (!allowed.has(key)) throw new Error(`Unsupported option --${key}`);
  const file = opts.state ? path.resolve(opts.state) : null;
  if ((opts.command === 'resume' || CREATES[opts.positional[0]]) && !file) throw new Error('A private --state file is required');
  let lock, client; const abort = new AbortController();
  const stop = () => { abort.abort(); client?.close(); }; process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    if (file) { lock = await fs.open(file + '.lock', 'wx', 0o600); await lock.writeFile(String(process.pid)); }
    const state = file ? JSON.parse(await fs.readFile(file, 'utf8')) : null;
    const persist = s => atomicState(file, s);
    for (let attempt = 0; ; attempt++) {
      client = new McpBroker({ codex: opts['codex-bin'] ?? 'codex' });
      try { await client.connect(); break; }
      catch (error) { client.close(); if (attempt >= 2 || abort.signal.aborted || AUTH_FAILURE.test(error.message)) throw error; await sleep(15000, null, { signal: abort.signal }); }
    }
    if (opts.command === 'tools') {
      if (opts.tool && !client.tools[opts.tool]) throw new Error(`Tool unavailable: ${opts.tool}`);
      console.log(JSON.stringify(opts.tool ? client.tools[opts.tool] : client.tools, null, 2));
    } else if (opts.command === 'call') {
      const tool = opts.positional[0]; const args = opts.json ? JSON.parse(await fs.readFile(opts.json, 'utf8')) : {};
      const data = CREATES[tool] ? await createAndRecord(client, tool, args, state, persist) :
        (/^(get_|list_|search_)/.test(tool) ? await client.call(tool, args) : (() => { throw new Error('Unsupported mutation; use the bound MCP tool with existing authorization'); })());
      console.log(JSON.stringify(data, null, 2));
    } else {
      await resumePipeline({ state, persist, client, pollSeconds: Number(opts['poll-seconds'] ?? 45), maxWaitSeconds: Number(opts['max-wait-seconds'] ?? 0),
        wait: ms => sleep(ms, null, { signal: abort.signal }), deliver: (stage, s) => downloadAndCheck(stage, s, path.dirname(file), abort.signal), emit: x => console.log(JSON.stringify(x)) });
    }
  } finally { client?.close(); if (lock) { await lock.close(); await fs.unlink(file + '.lock'); } process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(await fs.realpath(process.argv[1])).href)
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
