import axios from "axios";
import { publicHttpsAgent } from './dashboardApiSafety.js';
import { isReservedCommand } from './dashboardData.js';
import DashboardCommand from "../database/dashboardCommandModel.js";
import DashboardApi from "../database/dashboardApiModel.js";
import { decryptDashboardValue } from "./dashboardCrypto.js";
import { DEVELOPER_JIDS, getKingdomIdFromGroupJid } from "../config.js";
import { isModerator } from "../commands/adminSystem.js";

function normalizeJid(jid = "") {
  return String(jid).split(":")[0];
}

function isDeveloper(jid) {
  const user = normalizeJid(jid).split("@")[0];
  return DEVELOPER_JIDS.some((developer) => normalizeJid(developer).split("@")[0] === user);
}

export function readDashboardPath(value, path) {
  if (!path) return value;
  if (path.split('.').some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) throw new Error('مسار غير صالح');
  return path.split(".").filter(Boolean).reduce((current, key) => current?.[key], value);
}

function stringifyApiResult(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value).slice(0, 2500);
}

function applyTemplate(template, { sender, pushName, apiValue, query, args }) {
  return String(template || "")
    .replaceAll("{name}", pushName || "صديقي")
    .replaceAll("{jid}", sender || "")
    .replaceAll("{query}", query || "")
    .replaceAll("{args}", args || "")
    .replaceAll("{api}", stringifyApiResult(apiValue));
}

function interpolate(value, variables) {
  if (typeof value === "string") return value.replace(/\{(query|args|arg(\d+))\}/g, (_, key, index) => key === "query" || key === "args" ? variables[key] || "" : variables.args?.[Number(index) - 1] || "");
  if (Array.isArray(value)) return value.map(item => interpolate(item, variables));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item, variables)]));
  return value;
}

export async function runConfiguredApi(api, variables) {
  if (!api?.enabled) throw new Error("واجهة API غير مفعلة");
  const endpoint = new URL(interpolate(api.endpoint, variables));
  if (api.queryTemplate) for (const [key, value] of new URLSearchParams(interpolate(api.queryTemplate, variables))) endpoint.searchParams.set(key, value);
  if (endpoint.protocol !== "https:") throw new Error("يسمح فقط بروابط HTTPS");
  const headers = decryptDashboardValue(api.encryptedHeaders) || {};
  const data = interpolate(decryptDashboardValue(api.encryptedBody) || undefined, variables);
  const agent = await publicHttpsAgent(endpoint.toString());
  try {
  const response = await axios({
    method: api.method,
    url: endpoint.toString(),
    headers,
    data,
    timeout: api.timeoutMs,
    maxRedirects: 0,
    proxy: false,
    httpsAgent: agent,
    maxContentLength: 1024 * 1024,
    maxBodyLength: 120000,
    responseType: ["text", "image_url", "video_url", "audio_url"].includes(api.responseType) ? "json" : "arraybuffer",
    validateStatus: (status) => status >= 200 && status < 300
  });
  return { data: response.data, responseType: api.responseType };
  } finally { agent.destroy(); }
}

export async function handleDashboardCommand(sock, jid, sender, text, msg) {
  if (!String(text || "").startsWith("/")) return false;
  const trigger = String(text).trim().split(/\s+/)[0].toLowerCase();
  const args = String(text).trim().split(/\s+/).slice(1);
  const query = args.join(" ");
  if (isReservedCommand(trigger)) return false;
  const command = await DashboardCommand.findOne({ trigger, enabled: true }).populate("apiId");
  if (!command) return false;

  const kingdom = getKingdomIdFromGroupJid(jid);
  if (command.permission === "developer" && !isDeveloper(sender)) {
    await sock.sendMessage(jid, { text: "هذا الأمر خاص بالمطور فقط." });
    return true;
  }
  if (command.permission === "moderator" && !isDeveloper(sender) && !(await isModerator(sender, kingdom))) {
    await sock.sendMessage(jid, { text: "هذا الأمر للمشرفين فقط." });
    return true;
  }

  try {
    const apiResult = command.apiId ? await runConfiguredApi(command.apiId, { query, args }) : null;
    const rawData = ["text", "image_url", "video_url", "audio_url"].includes(apiResult?.responseType) ? apiResult.data : null;
    const apiValue = readDashboardPath(rawData, command.responsePath);
    const reply = applyTemplate(command.responseTemplate || "تم التنفيذ.", {
      sender,
      pushName: msg.pushName,
      apiValue,
      query,
      args
    });
    if (["image_url", "video_url", "audio_url"].includes(apiResult?.responseType)) {
      const mediaUrl = typeof apiResult.data === 'string' ? apiResult.data : apiValue;
      if (!/^https:\/\//i.test(String(mediaUrl || ''))) throw new Error('نتيجة الوسائط ليست رابط HTTPS');
      const mediaType = apiResult.responseType.replace('_url','');
      await sock.sendMessage(jid, { [mediaType]: { url: mediaUrl }, ...(mediaType === 'audio' ? { mimetype: 'audio/mpeg', ptt: true } : { caption: reply || undefined }) });
    } else if (apiResult?.responseType !== "text") {
      const payload = apiResult.data;
      await sock.sendMessage(jid, { [apiResult.responseType]: Buffer.isBuffer(payload) ? payload : Buffer.from(payload), caption: reply || undefined });
    } else await sock.sendMessage(jid, { text: reply });
  } catch (error) {
    console.warn(`⚠️ Dashboard command ${command.trigger} failed: ${error.message}`);
    await sock.sendMessage(jid, { text: "تعذر تنفيذ الأمر الآن." });
  }
  return true;
}
