// تحليل ملف إكسل المصاريف: أهمية كل تصنيف (أساسي / ممكن تقلل / ما إله داعي) وملاحظات وطرق توفير،
// بطلب ذكاء اصطناعي واحد لكل تصدير. الأرقام كلها محسوبة بالكود، والذكاء بس بيصنف وبيكتب الملاحظات.
// وفيها كمان إضافة تشارتات حقيقية لملف الإكسل (ExcelJS ما بيدعمها، فبنضيف ملفات الـ XML للـ zip).
import JSZip from "jszip";
import { generateSamBotAIFromParts, isSamBotAIAvailable } from "./samBotAI.js";
import { consumeAssistantQuota } from "./assistantQuota.js";
import { isOpenAIConfigured, openAIChatJSON } from "../services/broadcastService.js";

export const IMPORTANCE = {
  essential: { key: "essential", label: "🟢 أساسي", short: "أساسي", fill: "FFE2F0D9", font: "FF375623", color: "70AD47" },
  reducible: { key: "reducible", label: "🟡 ممكن تقلل", short: "ممكن تقلل", fill: "FFFFF2CC", font: "FF7F6000", color: "FFC000" },
  unnecessary: { key: "unnecessary", label: "🔴 ما إله داعي", short: "ما إله داعي", fill: "FFF8D7DA", font: "FF9C0006", color: "E74C3C" }
};
export const IMPORTANCE_ORDER = ["essential", "reducible", "unnecessary"];

const MAX_LABELS = 150;

function normalize(text) {
  return String(text || "").trim().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[ً-ْـ]/g, "").replace(/\s+/g, " ").toLowerCase();
}

const ESSENTIAL_WORDS = /(^|\s)(ال)?(بنزين|بنزينه|وقود|كاز|سولار|كهربا|كهرباء|ماي|مياه|اجار|ايجار|اجره البيت|سوبرماركت|سوبر|بقاله|خضار|خضره|خبز|لحمه|دجاج|دوا|دواء|ادويه|صيدليه|طبيب|دكتور|مستشفى|فحص|فاتوره|فواتير|نت|انترنت|تلفون|رصيد|مواصلات|تكسي|تاكسي|باص|اوبر|كريم|قسط|اقساط|مدرسه|جامعه|رسوم|تامين|غاز|ترخيص|صيانه)(?=\s|$)/;
const UNNECESSARY_WORDS = /(^|\s)(ال)?(دخان|سجاير|سجائر|ارجيله|اراجيل|معسل|فيب|شيبس|سناك|مشروب طاقه|ريد بول|قمار|رهان|شدات|جواهر|كوينز|يانصيب)(?=\s|$)/;

/** تصنيف بدون ذكاء اصطناعي من كلمات واضحة؛ اللي ما بنعرفه بيصير "ممكن تقلل". */
export function guessImportance(label) {
  const value = normalize(label);
  if (UNNECESSARY_WORDS.test(value)) return "unnecessary";
  if (ESSENTIAL_WORDS.test(value)) return "essential";
  return "reducible";
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function labelOf(item) {
  return item.label || "بدون تصنيف";
}

export function labelTotals(items) {
  const map = new Map();
  for (const item of items) {
    const key = labelOf(item);
    const entry = map.get(key) || { label: key, total: 0, count: 0 };
    entry.total += item.amount;
    entry.count += 1;
    map.set(key, entry);
  }
  return [...map.values()].map((e) => ({ ...e, total: round(e.total) })).sort((a, b) => b.total - a.total);
}

function parseJson(raw) {
  const source = String(raw || "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const match = source.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function cleanLines(value, max) {
  if (!Array.isArray(value)) return [];
  return value.map((line) => String(line || "").replace(/\s+/g, " ").trim()).filter(Boolean).map((line) => line.slice(0, 300)).slice(0, max);
}

/** يتحقق من رد الذكاء: بس تصنيفات موجودة وقيم أهمية معروفة. */
export function parseImportanceReply(raw, labels) {
  const value = parseJson(raw);
  if (!value || typeof value !== "object") return null;
  const known = new Set(labels);
  const importance = {};
  const source = value.labels && typeof value.labels === "object" ? value.labels : {};
  for (const [label, level] of Object.entries(source)) {
    if (known.has(label) && IMPORTANCE[level]) importance[label] = level;
  }
  return { importance, insights: cleanLines(value.insights, 6), tips: cleanLines(value.tips, 5) };
}

function instruction(currency) {
  return [
    "You are Sam, a practical personal finance assistant. The user writes Jordanian Arabic and lives in Jordan.",
    `You get the user's expense categories for a period (label, count, total in ${currency}) and the period totals.`,
    "1) Tag EVERY label with how necessary it is: \"essential\" (bills, rent, fuel, groceries, medicine, transport, internet, debts),",
    "\"reducible\" (useful but can be cut down: eating out, coffee, delivery, subscriptions, clothes, gifts),",
    "\"unnecessary\" (smoking, impulse buys, gaming purchases and similar). Judge by the label meaning and how often it repeats.",
    "2) insights: 3 to 5 short lines in Jordanian Arabic about where the money went, using ONLY the given numbers (no new calculations beyond simple shares).",
    "3) tips: 2 to 4 short, concrete saving tips in Jordanian Arabic tied to the user's own categories, with a realistic monthly saving estimate.",
    "Plain text lines, no markdown, no numbering at the start of a line. Keep labels exactly as given.",
    "Return JSON only: {\"labels\":{\"<label>\":\"essential|reducible|unnecessary\"},\"insights\":[\"...\"],\"tips\":[\"...\"]}"
  ].join("\n");
}

/** الملاحظات الأساسية من الكود لما ما يكون في ذكاء اصطناعي. */
function codeInsights(byLabel, byLevel, total, currency) {
  if (!total) return [];
  const pct = (value) => `${Math.round((value / total) * 100)}%`;
  const lines = [];
  const top = byLabel.slice(0, 3).map((e) => `${e.label} (${round(e.total)} ${currency}، ${pct(e.total)})`);
  if (top.length) lines.push(`أكثر اشي صرفت عليه: ${top.join("، ")}`);
  for (const key of IMPORTANCE_ORDER) {
    if (byLevel[key]) lines.push(`${IMPORTANCE[key].short}: ${round(byLevel[key])} ${currency} (${pct(byLevel[key])})`);
  }
  const frequent = byLabel.filter((e) => e.count >= 4).sort((a, b) => b.count - a.count)[0];
  if (frequent) lines.push(`${frequent.label} تكرر ${frequent.count} مرات، والمصاريف الصغيرة المتكررة أسهل مكان للتوفير.`);
  return lines;
}

/**
 * تحليل المصاريف للإكسل: Gemini أول (مجاني)، وإذا فشل OpenAI (مدفوع)، وإذا فشلوا الاثنين تصنيف بالكلمات.
 * يرجع { importance: {label: level}, byLevel, insights, tips, source: "gemini" | "openai" | "code" }.
 */
export async function analyzeExpensesForExport(items, sender, {
  title = "",
  currency = "دينار",
  ai = generateSamBotAIFromParts,
  aiAvailable = isSamBotAIAvailable,
  openai = openAIChatJSON,
  openaiAvailable = isOpenAIConfigured,
  quota = consumeAssistantQuota
} = {}) {
  const byLabel = labelTotals(items);
  const labels = byLabel.map((e) => e.label);
  const total = round(items.reduce((sum, item) => sum + item.amount, 0));
  const safe = (check) => { try { return Boolean(check()); } catch { return false; } };
  const gemini = safe(aiAvailable);
  const paid = safe(openaiAvailable);
  let allowed = false;
  if (labels.length && (gemini || paid)) allowed = (await quota(sender).catch(() => ({ allowed: false })))?.allowed === true;

  const system = instruction(currency);
  const payload = JSON.stringify({ period: title, total, count: items.length, labels: byLabel.slice(0, MAX_LABELS).map((e) => [e.label, e.count, e.total]) });
  let reply = null;
  let source = "code";
  if (allowed && gemini) {
    try {
      reply = parseImportanceReply(await ai({ systemInstruction: system, parts: [{ text: payload }], json: true, temperature: 0.2, maxOutputTokens: 1500 }), labels);
      if (reply) source = "gemini";
    } catch (error) {
      console.warn("Expense export analysis (Gemini) failed:", error.message);
    }
  }
  if (!reply && allowed && paid) {
    try {
      reply = parseImportanceReply(await openai({ system, user: payload, maxTokens: 1500, temperature: 0.2 }), labels);
      if (reply) source = "openai";
    } catch (error) {
      console.warn("Expense export analysis (OpenAI) failed:", error.message);
    }
  }
  const importance = {};
  for (const label of labels) importance[label] = reply?.importance[label] || guessImportance(label);
  const byLevel = { essential: 0, reducible: 0, unnecessary: 0 };
  for (const entry of byLabel) byLevel[importance[entry.label]] += entry.total;
  for (const key of IMPORTANCE_ORDER) byLevel[key] = round(byLevel[key]);
  const insights = reply?.insights.length ? reply.insights : codeInsights(byLabel, byLevel, total, currency);
  return { importance, byLevel, insights, tips: reply?.tips || [], source };
}

// ============================================
// تشارتات حقيقية جوا ملف الإكسل
// ============================================

function xml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function sheetRef(sheet, col, from, to) {
  return `'${sheet.replace(/'/g, "''")}'!$${col}$${from}:$${col}$${to}`;
}

function fill(color) {
  return `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr>`;
}

function caches(categories, values) {
  const str = `<c:strCache><c:ptCount val="${categories.length}"/>${categories.map((v, i) => `<c:pt idx="${i}"><c:v>${xml(v)}</c:v></c:pt>`).join("")}</c:strCache>`;
  const num = `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${Number(v) || 0}</c:v></c:pt>`).join("")}</c:numCache>`;
  return { str, num };
}

function titleXml(text) {
  return `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1300" b="1"/></a:pPr><a:r><a:rPr lang="ar-JO" sz="1300" b="1"/><a:t>${xml(text)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>`;
}

function chartSpace(body) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:roundedCorners val="0"/><c:chart>${body}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
}

function barChartXml(spec) {
  const { str, num } = caches(spec.categories, spec.values);
  const points = (spec.colors || []).map((color, idx) => (color ? `<c:dPt><c:idx val="${idx}"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/>${fill(color)}</c:dPt>` : "")).join("");
  return chartSpace(`${titleXml(spec.title)}<c:plotArea><c:layout/><c:barChart><c:barDir val="bar"/><c:grouping val="clustered"/><c:varyColors val="0"/>`
    + `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${xml(spec.seriesName)}</c:v></c:tx>${fill(spec.color || "2E75B6")}<c:invertIfNegative val="0"/>${points}`
    + `<c:dLbls><c:numFmt formatCode="#,##0.##" sourceLinked="0"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>`
    + `<c:cat><c:strRef><c:f>${xml(spec.categoryRef)}</c:f>${str}</c:strRef></c:cat><c:val><c:numRef><c:f>${xml(spec.valueRef)}</c:f>${num}</c:numRef></c:val></c:ser>`
    + `<c:gapWidth val="60"/><c:axId val="50010"/><c:axId val="50020"/></c:barChart>`
    + `<c:catAx><c:axId val="50010"/><c:scaling><c:orientation val="maxMin"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="50020"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`
    + `<c:valAx><c:axId val="50020"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:majorGridlines/><c:numFmt formatCode="#,##0" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="50010"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`
    + `</c:plotArea>`);
}

function pieChartXml(spec) {
  const { str, num } = caches(spec.categories, spec.values);
  const points = spec.colors.map((color, idx) => `<c:dPt><c:idx val="${idx}"/><c:bubble3D val="0"/>${fill(color)}</c:dPt>`).join("");
  return chartSpace(`${titleXml(spec.title)}<c:plotArea><c:layout/><c:pieChart><c:varyColors val="1"/>`
    + `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${xml(spec.seriesName)}</c:v></c:tx>${points}`
    + `<c:dLbls><c:numFmt formatCode="0%" sourceLinked="0"/><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/><c:showLeaderLines val="1"/></c:dLbls>`
    + `<c:cat><c:strRef><c:f>${xml(spec.categoryRef)}</c:f>${str}</c:strRef></c:cat><c:val><c:numRef><c:f>${xml(spec.valueRef)}</c:f>${num}</c:numRef></c:val></c:ser>`
    + `<c:firstSliceAng val="0"/></c:pieChart></c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>`);
}

function anchorXml(spec, index) {
  const [fromCol, fromRow, toCol, toRow] = spec.anchor;
  return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`
    + `<xdr:to><xdr:col>${toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>`
    + `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${index + 2}" name="Chart ${index + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>`
    + `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">`
    + `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${index + 1}"/>`
    + `</a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
}

/** مسار ملف الورقة (xl/worksheets/sheetN.xml) من اسمها. */
async function sheetPath(zip, sheetName) {
  const workbook = await zip.file("xl/workbook.xml").async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  const sheet = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((m) => m[0]).find((tag) => {
    const name = tag.match(/name="([^"]*)"/)?.[1] || "";
    return name.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">") === sheetName;
  });
  const rid = sheet?.match(/r:id="([^"]+)"/)?.[1];
  if (!rid) return null;
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((tag) => tag.includes(`Id="${rid}"`));
  const target = rel?.match(/Target="([^"]+)"/)?.[1];
  if (!target) return null;
  return target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
}

/**
 * يضيف تشارتات (bar أو pie) لورقة وحدة بملف xlsx جاهز. specs: [{ type, title, seriesName, categories, values, categoryRef, valueRef, colors, anchor:[fromCol, fromRow, toCol, toRow] }]
 */
export async function addChartsToWorkbook(buffer, sheetName, specs) {
  if (!specs.length) return buffer;
  const zip = await JSZip.loadAsync(buffer);
  const path = await sheetPath(zip, sheetName);
  if (!path || !zip.file(path)) return buffer;
  const existingCharts = Object.keys(zip.files).filter((name) => /^xl\/charts\/chart\d+\.xml$/.test(name)).length;
  const existingDrawings = Object.keys(zip.files).filter((name) => /^xl\/drawings\/drawing\d+\.xml$/.test(name)).length;
  const drawingNo = existingDrawings + 1;
  let types = await zip.file("[Content_Types].xml").async("string");
  const overrides = [];

  const drawingRels = [];
  specs.forEach((spec, index) => {
    const chartNo = existingCharts + index + 1;
    zip.file(`xl/charts/chart${chartNo}.xml`, spec.type === "pie" ? pieChartXml(spec) : barChartXml(spec));
    overrides.push(`<Override PartName="/xl/charts/chart${chartNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
    drawingRels.push(`<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartNo}.xml"/>`);
  });
  zip.file(`xl/drawings/drawing${drawingNo}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${specs.map(anchorXml).join("")}</xdr:wsDr>`);
  zip.file(`xl/drawings/_rels/drawing${drawingNo}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${drawingRels.join("")}</Relationships>`);
  overrides.push(`<Override PartName="/xl/drawings/drawing${drawingNo}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
  types = types.replace("</Types>", `${overrides.join("")}</Types>`);
  zip.file("[Content_Types].xml", types);

  // الربط بين الورقة والرسم
  const fileName = path.split("/").pop();
  const relsPath = path.replace(fileName, `_rels/${fileName}.rels`);
  let sheetRels = zip.file(relsPath) ? await zip.file(relsPath).async("string") : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  const relId = "rIdSamCharts";
  sheetRels = sheetRels.replace("</Relationships>", `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingNo}.xml"/></Relationships>`);
  zip.file(relsPath, sheetRels);

  let sheetXml = await zip.file(path).async("string");
  if (!/xmlns:r=/.test(sheetXml.slice(0, 1000))) {
    sheetXml = sheetXml.replace("<worksheet ", "<worksheet xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" ");
  }
  const drawingTag = `<drawing r:id="${relId}"/>`;
  // ترتيب العناصر بالـ schema: drawing قبل legacyDrawing و tableParts و extLst
  const before = ["<legacyDrawing", "<legacyDrawingHF", "<picture", "<oleObjects", "<controls", "<webPublishItems", "<tableParts", "<extLst", "</worksheet>"]
    .map((tag) => sheetXml.indexOf(tag)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  sheetXml = `${sheetXml.slice(0, before)}${drawingTag}${sheetXml.slice(before)}`;
  zip.file(path, sheetXml);

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export { sheetRef };
