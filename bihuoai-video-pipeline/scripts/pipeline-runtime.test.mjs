import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { terminalResult, createAndRecord, resumePipeline, atomicState, unwrap } from './pipeline-runtime.mjs';

const source = 'https://media.example/source.mp4';
const output = 'https://media.example/final.mp4';
const stateFor = () => ({ title: 'Example', executionMode: 'auto', authorization: { digitalHuman: true, clip: true, publication: false }, copywriting: { status: 'finalized_by_agent' }, digitalHuman: { taskId: 123, status: 'processing' }, cover: { status: 'skipped' }, clip: { status: 'pending', templateCode: 'example-template' }, publication: { status: 'skipped' } });
const goodDh = { status: 1, isTerminal: true, videoUrl: source };
const goodClip = { status: 'success', isTerminal: true, clipStatus: 1, outputMp4Url: output };
const template = { templates: [{ code: 'example-template', requireCover: false }] };
const deliver = async stage => ({ localPath: '/example/video.mp4', taskId: stage.taskId });

test('CLI entrypoint works through a filesystem alias or symlink', () => {
  const script = fileURLToPath(new URL('./pipeline-runtime.mjs', import.meta.url));
  const alias = process.platform === 'darwin' ? script.replace(/^\/private\/tmp\//, '/tmp/') : script;
  assert.match(execFileSync(process.execPath, [alias, '--help'], { encoding: 'utf8' }), /Usage: node pipeline-runtime/);
});

test('100 percent, wrapper success and early URLs do not count as completion', () => {
  assert.equal(terminalResult('digitalHuman', { status: 0, progress: 100, isTerminal: false, videoUrl: source }).status, 'processing');
  assert.equal(terminalResult('clip', { status: 'success', clipStatus: 4, isTerminal: false, outputMp4Url: output }).status, 'processing');
  assert.equal(terminalResult('digitalHuman', { status: 1, isTerminal: true }).status, 'failed');
});
test('create saves submitting first and task ID before returning', async () => {
  const state = stateFor(); state.digitalHuman = { status: 'pending' }; const snapshots = [];
  const result = await createAndRecord({ call: async () => { assert.equal(snapshots.at(-1).digitalHuman.status, 'submitting'); return { dhVideoId: 456 }; } }, 'create_digital_human_video', {}, state, async s => snapshots.push(structuredClone(s)));
  assert.equal(result.dhVideoId, 456); assert.equal(snapshots.at(-1).digitalHuman.taskId, 456);
});
test('uncertain paid creation is never automatically repeated', async () => {
  const state = stateFor(); state.digitalHuman = { status: 'pending' }; let calls = 0;
  const client = { call: async () => { calls++; throw new Error('network timeout'); } };
  await assert.rejects(createAndRecord(client, 'create_digital_human_video', {}, state, async () => {}), /timeout/);
  assert.equal(state.digitalHuman.status, 'unknown');
  await assert.rejects(createAndRecord(client, 'create_digital_human_video', {}, state, async () => {}), /Do not recreate/);
  assert.equal(calls, 1);
});
test('pending human review prevents digital-human creation', async () => {
  const state = stateFor(); state.copywriting.status = 'awaiting_confirmation'; state.digitalHuman = { status: 'pending' };
  await assert.rejects(createAndRecord({ call: () => assert.fail('must not create') }, 'create_digital_human_video', {}, state, async () => {}), /Finalize or confirm/);
});
test('continuously completes original DH, one clip and delivery without publication', async () => {
  const state = stateFor(); const calls = []; const waits = []; let dhReads = 0, clipReads = 0;
  const client = { call: async (tool, args) => {
    calls.push({ tool, args });
    if (tool === 'get_dh_video_status') return ++dhReads === 1 ? { status: 0, isTerminal: false, progress: 100 } : goodDh;
    if (tool === 'list_clip_templates') return template;
    if (tool === 'create_clip_task') return { taskId: 'clip-example' };
    if (tool === 'get_clip_task_status') return ++clipReads === 1 ? { status: 'success', clipStatus: 4, isTerminal: false } : goodClip;
    assert.fail(`unexpected tool ${tool}`);
  } };
  await resumePipeline({ state, client, persist: async () => {}, wait: async ms => waits.push(ms), deliver });
  assert.equal(state.status, 'complete');
  assert.equal(calls.filter(x => x.tool === 'create_clip_task').length, 1);
  const args = calls.find(x => x.tool === 'create_clip_task').args;
  assert.equal(args.mainVideoUrl, source); assert.equal(args.mode, 'auto'); assert.equal(args.script, undefined);
  assert.ok(waits.some(x => x >= 15000));
  assert.ok(calls.every(x => !/publication|pub_article|create_digital/.test(x.tool)));
});
test('existing completed tasks are delivered without creating or querying again', async () => {
  const state = stateFor(); Object.assign(state.digitalHuman, { status: 'success', videoUrl: source }); Object.assign(state.clip, { taskId: 'clip-example', status: 'success', videoUrl: output });
  await resumePipeline({ state, client: { call: () => assert.fail('no remote call needed') }, persist: async () => {}, deliver });
  assert.equal(state.status, 'complete');
});
test('existing clip is queried without rebuilding original digital-human or clip', async () => {
  const state = stateFor(); Object.assign(state.digitalHuman, { status: 'success', videoUrl: source }); state.clip.taskId = 'clip-example'; state.clip.status = 'processing';
  const calls = []; await resumePipeline({ state, client: { call: async tool => { calls.push(tool); return goodClip; } }, persist: async () => {}, deliver });
  assert.deepEqual(calls, ['get_clip_task_status']);
});
test('missing clip authorization never creates a paid task', async () => {
  const state = stateFor(); state.authorization.clip = false; Object.assign(state.digitalHuman, { status: 'success', videoUrl: source });
  await assert.rejects(resumePipeline({ state, client: { call: async tool => { assert.equal(tool, 'list_clip_templates'); return template; } }, persist: async () => {}, deliver }), /Missing existing user authorization/);
});
test('requested incomplete cover blocks unattended clip creation', async () => {
  const state = stateFor(); state.cover.status = 'processing';
  await assert.rejects(resumePipeline({ state, client: { call: () => assert.fail('must wait for cover') }, persist: async () => {}, deliver }), /cover stage/);
});
test('editing task returns needs-confirmation instead of faking completion', async () => {
  const state = stateFor(); state.digitalHuman.status = 'success'; state.clip.taskId = 'clip-example';
  await resumePipeline({ state, client: { call: async () => ({ clipStatus: 5, isTerminal: false }) }, persist: async () => {}, deliver: () => assert.fail('no file') });
  assert.equal(state.status, 'awaiting_confirmation');
});
test('explicit terminal failure preserves task ID without paid retry', async () => {
  const state = stateFor();
  await assert.rejects(resumePipeline({ state, client: { call: async tool => { assert.equal(tool, 'get_dh_video_status'); return { status: -1, isTerminal: true, resultDesc: 'render failed' }; } }, persist: async () => {}, deliver }), /render failed/);
  assert.equal(state.digitalHuman.taskId, 123); assert.equal(state.digitalHuman.status, 'failed');
});
test('temporary read failure is retried only as a read, at least 15 seconds apart', async () => {
  const state = stateFor(); state.clip.status = 'skipped'; let reads = 0; const waits = [];
  await resumePipeline({ state, client: { call: async tool => { assert.equal(tool, 'get_dh_video_status'); if (++reads === 1) throw new Error('network disconnected'); return goodDh; } }, persist: async () => {}, wait: async ms => waits.push(ms), deliver });
  assert.equal(reads, 2); assert.equal(waits[0], 15000); assert.equal(state.status, 'complete');
});
test('atomic state roundtrip is private and leaves valid JSON', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bihuo-state-test-'));
  try { const file = path.join(dir, 'state.json'); const state = stateFor(); await atomicState(file, state); assert.equal(JSON.parse(await readFile(file, 'utf8')).title, 'Example'); if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600); }
  finally { await rm(dir, { recursive: true, force: true }); }
});
test('server-declared errors are errors even in a valid transport envelope', () => {
  assert.throws(() => unwrap({ content: [{ type: 'text', text: '{"status":"error","message":"balance insufficient"}' }] }), /balance insufficient/);
});
