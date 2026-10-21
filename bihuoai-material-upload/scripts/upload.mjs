#!/usr/bin/env node
/**
 * 配合 MCP 工具 prepare_file_upload 上传一个明确指定的本地文件。
 * 只使用 Node 内置模块，要求 Node.js 18 或更高版本。
 *
 *   node upload.mjs stat <文件>
 *   node upload.mjs put <文件> <prepare_file_upload 返回的 upload JSON 或 JSON 文件>
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';

function out(value, code = 0) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exit(code);
}

function fail(message) {
  out({ status: 'error', message }, 1);
}

function md5Of(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5');
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

function readUploadTicket(argument) {
  const raw = fs.existsSync(argument) ? fs.readFileSync(argument, 'utf8') : argument;
  let ticket;
  try {
    ticket = JSON.parse(raw);
  } catch {
    fail('上传信息不是合法 JSON');
  }
  if (ticket && ticket.upload) ticket = ticket.upload;
  const required = [
    'host',
    'key',
    'policy',
    'OSSAccessKeyId',
    'signature',
    'callback',
    'contentType',
    'contentDisposition',
  ];
  for (const field of required) {
    if (!ticket || typeof ticket[field] !== 'string' || !ticket[field]) {
      fail(`上传信息缺少字段 ${field}`);
    }
  }
  return ticket;
}

async function fileBlob(file, type) {
  if (typeof fs.openAsBlob === 'function') return fs.openAsBlob(file, { type });
  return new Blob([fs.readFileSync(file)], { type });
}

async function put(file, ticket) {
  const form = new FormData();
  form.append('key', ticket.key);
  form.append('policy', ticket.policy);
  form.append('OSSAccessKeyId', ticket.OSSAccessKeyId);
  form.append('signature', ticket.signature);
  form.append('callback', ticket.callback);
  form.append('Content-Disposition', ticket.contentDisposition);
  form.append('Content-Type', ticket.contentType);
  form.append('success_action_status', '200');
  form.append('file', await fileBlob(file, ticket.contentType), path.basename(file));

  const response = await fetch(ticket.host, { method: 'POST', body: form });
  const text = await response.text();
  if (response.status !== 200) {
    fail(`上传失败（HTTP ${response.status}）：${text.slice(0, 300)}`);
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    fail(`平台没有返回预期结果：${text.slice(0, 300)}`);
  }
  if (body.statusCode !== 0) {
    fail(`平台登记文件失败：${body.message || text.slice(0, 300)}`);
  }
  out({
    status: 'success',
    url: (body.data && body.data.url) || `${ticket.host}/${ticket.key}`,
  });
}

async function main() {
  const [command, file, ticketArgument] = process.argv.slice(2);
  if (!['stat', 'put'].includes(command) || !file) {
    fail('用法：node upload.mjs stat <文件> | node upload.mjs put <文件> <上传信息>');
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    fail(`找不到文件：${file}`);
  }
  if (command === 'stat') {
    out({
      fileName: path.basename(file),
      size: fs.statSync(file).size,
      md5: await md5Of(file),
    });
  }
  if (!ticketArgument) fail('put 缺少 prepare_file_upload 返回的上传信息');
  await put(file, readUploadTicket(ticketArgument));
}

main().catch((error) => fail(error && error.message ? error.message : String(error)));
