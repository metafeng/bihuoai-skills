import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { apiRequest, getAuth } from "./bihuo-client.mjs";

async function captureRequest(credentials, payload = { code: 0, data: { ok: true } }) {
  let captured;
  const server = http.createServer((request, response) => {
    captured = request.headers;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    await apiRequest({ base: `http://127.0.0.1:${port}`, endpoint: "/probe", ...credentials });
    return captured;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("command Open Key is normalized", () => {
  assert.deepEqual(getAuth({ "open-key": "x-open-key: oa_test" }), { openKey: "oa_test" });
});

test("Open Key uses x-open-key", async () => {
  const headers = await captureRequest({ openKey: "oa_test" });
  assert.equal(headers["x-open-key"], "oa_test");
});

test("Open Key permission errors identify the blocked endpoint", async () => {
  await assert.rejects(
    () => captureRequest({ openKey: "oa_test" }, { statusCode: 10197, message: "not open" }),
    /当前 Open Key 未获 GET \/probe 的开放权限/,
  );
});
