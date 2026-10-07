import test from "node:test";
import assert from "node:assert/strict";
import {
  FALLBACK_MODEL,
  PRIMARY_MODEL,
  buildPayload,
  buildCoverAssetCatalog,
  isTerminal,
  modelChain,
  normalizeWork,
  resolveCoverAssets,
  shouldFallback,
  splitReferences,
  validatePrompt,
} from "./main.mjs";

const options = {
  image: [
    { model: PRIMARY_MODEL, name: "Image 2", enabled: true, ratio: ["9:16", "1:1"] },
    { model: FALLBACK_MODEL, name: "千问 3.0 Pro", enabled: true, ratio: ["9:16", "1:1"], imageSize: ["1K", "2K"] },
  ],
};

test("uses Image 2 first and Qwen Pro second", () => {
  assert.deepEqual(modelChain(options).map((item) => item.model), [PRIMARY_MODEL, FALLBACK_MODEL]);
});

test("skips disabled primary model", () => {
  const changed = structuredClone(options);
  changed.image[0].enabled = false;
  assert.deepEqual(modelChain(changed).map((item) => item.model), [FALLBACK_MODEL]);
});

test("can explicitly select Qwen Pro without creating an Image 2 attempt", () => {
  assert.deepEqual(modelChain(options, FALLBACK_MODEL).map((item) => item.model), [FALLBACK_MODEL]);
  assert.throws(() => modelChain(options, "unknown-model"), /不支持指定模型/);
});

test("omits imageSize for Image 2 and includes 2K for Qwen Pro", () => {
  const primary = buildPayload({ prompt: "测试封面", modelOption: options.image[0], referImages: [] });
  const fallback = buildPayload({ prompt: "测试封面", modelOption: options.image[1], referImages: ["https://example.com/a.png"] });
  assert.equal(primary.model, PRIMARY_MODEL);
  assert.equal("imageSize" in primary, false);
  assert.equal(fallback.imageSize, "2K");
  assert.deepEqual(fallback.referImages, ["https://example.com/a.png"]);
});

test("caps reference images at three for fallback compatibility", () => {
  assert.throws(() => splitReferences(["a.png", "b.png", "c.png", "d.png"]), /最多使用 3 张/);
});

test("falls back for terminal provider failure but not billing or moderation", () => {
  assert.equal(shouldFallback({ status: 2, errorMessage: "provider failed" }), true);
  assert.equal(shouldFallback({ status: 1, url: null }), true);
  assert.equal(shouldFallback({ status: 2, errorMessage: "余额不足" }), false);
  assert.equal(shouldFallback({ status: 2, errorMessage: "内容审核不通过" }), false);
});

test("does not treat processing as terminal", () => {
  assert.equal(isTerminal({ status: -2 }), false);
  assert.equal(isTerminal({ status: 4 }), false);
  assert.equal(isTerminal({ status: 1 }), true);
  assert.equal(isTerminal({ status: 2 }), true);
});

test("normalizes task response", () => {
  const work = normalizeWork({ data: { taskId: "t-1", status: 1, model: PRIMARY_MODEL, url: "https://example.com/result.png" } });
  assert.deepEqual({ id: work.id, status: work.status, model: work.model, url: work.url }, {
    id: "t-1",
    status: 1,
    model: PRIMARY_MODEL,
    url: "https://example.com/result.png",
  });
  assert.equal(work.recordId, undefined);
  assert.equal(work.taskId, "t-1");
});

test("rejects prompts longer than API limit", () => {
  assert.equal(validatePrompt("  一句话  "), "一句话");
  assert.throws(() => validatePrompt("字".repeat(2001)), /2000/);
});

test("resolves private cover assets by default, alias, number, and name", () => {
  const catalog = buildCoverAssetCatalog({
    cover_default_background: "hangzhou",
    cover_background_hangzhou_name: "杭州背景封面",
    cover_background_hangzhou_url: "https://example.com/hangzhou.jpg",
    cover_case_01_name: "企业AI化三层地基",
    cover_case_01_url: "https://example.com/case-01.png",
  }, "/private/EXTEND.md");
  assert.equal(resolveCoverAssets("默认背景", catalog)[0].url, "https://example.com/hangzhou.jpg");
  assert.equal(resolveCoverAssets("杭州背景", catalog)[0].key, "hangzhou");
  assert.equal(resolveCoverAssets("历史封面1", catalog)[0].key, "case-01");
  assert.equal(resolveCoverAssets("企业AI化三层地基", catalog)[0].url, "https://example.com/case-01.png");
  assert.throws(() => resolveCoverAssets("不存在的素材", catalog), /没有找到/);
});

test("default asset selection never adds a historical cover implicitly", () => {
  const catalog = buildCoverAssetCatalog({
    cover_default_background: "hangzhou",
    cover_background_hangzhou_url: "https://example.com/hangzhou.jpg",
    cover_case_01_url: "https://example.com/case-01.png",
  });
  assert.deepEqual(resolveCoverAssets("default", catalog).map((item) => item.key), ["hangzhou"]);
});
