const DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const SMALL_UNITS = ["", "十", "百", "千"];
const BIG_UNITS = ["", "万", "亿", "兆"];

export function digitsToChinese(value) {
  return String(value).replace(/\d/g, (digit) => DIGITS[Number(digit)]);
}

function groupToChinese(group) {
  const digits = String(group).padStart(4, "0");
  let result = "";
  let pendingZero = false;
  for (let index = 0; index < 4; index += 1) {
    const digit = Number(digits[index]);
    const unit = SMALL_UNITS[3 - index];
    if (digit === 0) {
      if (result && digits.slice(index + 1).match(/[1-9]/)) pendingZero = true;
      continue;
    }
    if (pendingZero) result += "零";
    result += `${DIGITS[digit]}${unit}`;
    pendingZero = false;
  }
  return result;
}

function preferLiang(text, raw) {
  if (BigInt(raw) === 2n) return "两";
  return text
    .replace(/^二(?=[百千万亿兆])/, "两")
    .replace(/([零万亿兆])二(?=[百千万亿兆])/g, "$1两");
}

export function integerToChinese(value, { liang = false } = {}) {
  const raw = String(value).replace(/^\+/, "");
  if (!/^\d+$/.test(raw) || raw.length > 16) return String(value);
  const normalized = raw.replace(/^0+(?=\d)/, "");
  if (normalized === "0") return "零";

  const groups = [];
  for (let end = normalized.length; end > 0; end -= 4) {
    groups.unshift(normalized.slice(Math.max(0, end - 4), end));
  }
  if (groups.length > BIG_UNITS.length) return String(value);

  let result = "";
  let skippedGroup = false;
  for (let index = 0; index < groups.length; index += 1) {
    const groupNumber = Number(groups[index]);
    const bigUnit = BIG_UNITS[groups.length - 1 - index];
    if (groupNumber === 0) {
      if (result) skippedGroup = true;
      continue;
    }
    if (result && (skippedGroup || groupNumber < 1000) && !result.endsWith("零")) result += "零";
    result += `${groupToChinese(groupNumber)}${bigUnit}`;
    skippedGroup = false;
  }
  result = result.replace(/^一十/, "十");
  return liang ? preferLiang(result, normalized) : result;
}

function numberToChinese(value, options = {}) {
  const raw = String(value).replace(/,/g, "");
  if (!raw.includes(".")) return integerToChinese(raw, options);
  const [integer, fraction] = raw.split(".");
  if (!/^\d+$/.test(integer) || !/^\d+$/.test(fraction)) return String(value);
  return `${integerToChinese(integer)}点${digitsToChinese(fraction)}`;
}

function apply(text, regex, type, replacer, changes) {
  return text.replace(regex, (...args) => {
    const match = args[0];
    const offset = args.at(-2);
    const whole = args.at(-1);
    const groups = args.slice(1, -2);
    const replacement = replacer({ match, groups, offset, whole });
    if (!replacement || replacement === match) return match;
    changes.push({ type, from: match, to: replacement });
    return replacement;
  });
}

const CLASSIFIERS = "个|位|名|次|年|天|小时|分钟|秒|条|件|份|本|家|台|套|种|只|张|辆|场|期|章|页|人|倍|元|块钱|万元|亿元|公里|千米|米|厘米|毫米|公斤|千克|克|岁";
const DURATION_YEAR_CONTEXT = /(历时|长达|持续|经过|已有|共计|一共|约|超过|不到|整整)\s*$/;

export function normalizeTtsText(input) {
  const originalText = String(input ?? "");
  const changes = [];
  let text = originalText;

  text = apply(text, /(?<!\d)(\d{4})\s*[-—–~至到]\s*(\d{4})年/g, "year-range", ({ groups }) => (
    `${digitsToChinese(groups[0])}至${digitsToChinese(groups[1])}年`
  ), changes);

  text = apply(text, /(?<!\d)(\d{4})年(\d{1,2})月(\d{1,2})(日|号)/g, "date", ({ groups }) => (
    `${digitsToChinese(groups[0])}年${integerToChinese(groups[1])}月${integerToChinese(groups[2])}${groups[3]}`
  ), changes);

  text = apply(text, /(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/g, "date", ({ groups }) => (
    `${digitsToChinese(groups[0])}年${integerToChinese(groups[1])}月${integerToChinese(groups[2])}日`
  ), changes);

  text = apply(text, /(?<!\d)(\d{1,2})月(\d{1,2})(日|号)/g, "month-day", ({ groups }) => (
    `${integerToChinese(groups[0])}月${integerToChinese(groups[1])}${groups[2]}`
  ), changes);

  text = apply(text, /(?<!\d)(\d{4})年/g, "year", ({ groups, offset, whole }) => {
    const previous = whole.slice(Math.max(0, offset - 12), offset);
    return DURATION_YEAR_CONTEXT.test(previous)
      ? `${integerToChinese(groups[0], { liang: true })}年`
      : `${digitsToChinese(groups[0])}年`;
  }, changes);

  text = apply(text, /(?<!\d)(\d{1,2}):(\d{2})(?!\d)/g, "time", ({ groups }) => {
    const hour = integerToChinese(String(Number(groups[0])), { liang: true });
    const minuteNumber = Number(groups[1]);
    const minute = minuteNumber < 10
      ? `零${integerToChinese(String(minuteNumber))}`
      : integerToChinese(groups[1]);
    return `${hour}点${minute}分`;
  }, changes);

  text = apply(text, /(?<!\d)(\d+(?:\.\d+)?)\s*[%％]/g, "percentage", ({ groups }) => (
    `百分之${numberToChinese(groups[0])}`
  ), changes);

  text = apply(text, /第(\d+)/g, "ordinal", ({ groups }) => `第${integerToChinese(groups[0])}`, changes);

  text = apply(text, /([￥¥])\s*(\d+(?:\.\d+)?)/g, "currency", ({ groups }) => (
    `${numberToChinese(groups[1], { liang: !groups[1].includes(".") })}元`
  ), changes);

  text = apply(text, new RegExp(`(?<![\\d.])(\\d+)\\s*[-—–~至到]\\s*(\\d+)(?=\\s*(?:${CLASSIFIERS}))`, "g"), "quantity-range", ({ groups }) => (
    `${integerToChinese(groups[0], { liang: true })}到${integerToChinese(groups[1], { liang: true })}`
  ), changes);

  text = apply(text, new RegExp(`(?<![\\d.])(\\d+\\.\\d+)(?=\\s*(?:${CLASSIFIERS}|版本|版))`, "g"), "decimal", ({ groups }) => (
    numberToChinese(groups[0])
  ), changes);

  text = apply(text, /(手机号|手机号码|联系电话|电话|编号|订单号|验证码)([：:\s]*)(\d{4,})/g, "digit-sequence", ({ groups }) => (
    `${groups[0]}${groups[1]}${digitsToChinese(groups[2])}`
  ), changes);

  text = apply(text, new RegExp(`(?<![\\d.])(\\d+)(?=\\s*(?:${CLASSIFIERS}))`, "g"), "quantity", ({ groups }) => (
    integerToChinese(groups[0], { liang: true })
  ), changes);

  return { originalText, ttsText: text, changed: text !== originalText, changes };
}
