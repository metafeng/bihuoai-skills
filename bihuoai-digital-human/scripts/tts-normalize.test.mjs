import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTtsText } from "./tts-normalize.mjs";

const cases = [
  ["2020年我们成立了公司。", "二零二零年我们成立了公司。"],
  ["历时2020年。", "历时两千零二十年。"],
  ["一共有2020个人。", "一共有两千零二十个人。"],
  ["准备2个方案，邀请2位老师。", "准备两个方案，邀请两位老师。"],
  ["这是第2个问题。", "这是第二个问题。"],
  ["使用2.0版本，效率提升2.5倍。", "使用二点零版本，效率提升二点五倍。"],
  ["完成率达到20%。", "完成率达到百分之二十。"],
  ["会议时间是2026年9月1日2:05。", "会议时间是二零二六年九月一日两点零五分。"],
  ["覆盖2020—2023年。", "覆盖二零二零至二零二三年。"],
  ["手机号：13800138000。", "手机号：一三八零零一三八零零零。"],
  ["暂时无法判断2020和2的含义。", "暂时无法判断2020和2的含义。"],
];

for (const [source, expected] of cases) {
  test(source, () => assert.equal(normalizeTtsText(source).ttsText, expected));
}
