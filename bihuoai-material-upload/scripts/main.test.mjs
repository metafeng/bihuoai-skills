#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  inferType,
  inspectFile,
  resolveTypeAndBusiness,
  uploadMultipart,
} from "./main.mjs";

assert.equal(inferType("cover.JPG"), "image");
assert.equal(inferType("voice.mp3"), "audio");
assert.equal(inferType("movie.MOV"), "video");
assert.equal(inferType("brief.pdf"), "temp");
assert.deepEqual(resolveTypeAndBusiness({ fileName: "a.png" }), { type: "image", businessType: 2 });
assert.deepEqual(resolveTypeAndBusiness({ fileName: "a.bin", businessType: 4 }), { type: "video", businessType: 4 });
assert.throws(
  () => resolveTypeAndBusiness({ fileName: "a.png", type: "image", businessType: 3 }),
  /冲突/,
);
assert.throws(
  () => resolveTypeAndBusiness({ fileName: "a.bin", businessType: 1 }),
  /只支持 2、3、4、16/,
);

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "bihuo-material-upload-test-"));
const samplePath = path.join(tempDirectory, "sample.txt");
const sampleContent = "bihuoai material upload test\n";
fs.writeFileSync(samplePath, sampleContent, "utf8");

let requestBody = Buffer.alloc(0);
const server = http.createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    requestBody = Buffer.concat(chunks);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end('{"ok":true}');
  });
});

try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const file = await inspectFile({ file: samplePath, type: "temp", "file-name": "remote.txt" });
  const statusCode = await uploadMultipart({
    signed: {
      host: `http://127.0.0.1:${address.port}/upload`,
      key: "user/remote.txt",
      policy: "test-policy",
      OSSAccessKeyId: "test-access-id",
      signature: "test-signature",
      callback: "test-callback",
      "Content-Disposition": "attachment; filename=remote.txt",
    },
    file,
    timeoutSeconds: 5,
  });
  assert.equal(statusCode, 200);
  const text = requestBody.toString("utf8");
  for (const field of ["key", "policy", "OSSAccessKeyId", "signature", "callback", "Content-Disposition", "success_action_status", "file"]) {
    assert.match(text, new RegExp(`name="${field}"`));
  }
  assert.match(text, /user\/remote\.txt/);
  assert.match(text, /bihuoai material upload test/);
  process.stdout.write("material upload tests passed\n");
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}
