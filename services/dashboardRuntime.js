import axios from "axios";
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

function readPath(value, path) {
  if (!path) return value;
  return path.split(".").filter(Boolean).reduce((current, key) => current?.[key], value);
}

function stringifyApiResult(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value).slice(0, 2500);
}

function applyTemplate(template, { sender, pushName, apiValue }) {
  return String(template || "")
    .replaceAll("{name}", pushName || "صديقي")
    .replaceAll("{jid}", sender || "")
    .replaceAll("{api}", stringifyApiResult(apiValue));
}

async function runConfiguredApi(api) {
  if (!api?.enabled) throw new Error("واجهة API غير مفعلة");
  const endpoint = new URL(api.endpoint);
  if (endpoint.protocol !== "https:") throw new Error("يسمح فقط بروابط HTTPS");
  const headers = decryptDashboardValue(api.encryptedHeaders) || {};
  const data = decryptDashboardValue(api.encryptedBody) || undefined;
  const response = await axios({
    method: api.method,
    url: endpoint.toString(),
    headers,
    data,
    timeout: api.timeoutMs,
    maxRedirects: 0,
    validateStatus: (status) => status >= 200 && status < 300
  });
  return response.data;
}

export async function handleDashboardCommand(sock, jid, sender, text, msg) {
  if (!String(text || "").startsWith("/")) return false;
  const trigger = String(text).trim().split(/\s+/)[0].toLowerCase();
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
    const apiData = command.apiId ? await runConfiguredApi(command.apiId) : null;
    const apiValue = readPath(apiData, command.responsePath);
    const reply = applyTemplate(command.responseTemplate || "تم التنفيذ.", {
      sender,
      pushName: msg.pushName,
      apiValue
    });
    await sock.sendMessage(jid, { text: reply });
  } catch (error) {
    console.warn(`⚠️ Dashboard command ${command.trigger} failed: ${error.message}`);
    await sock.sendMessage(jid, { text: "تعذر تنفيذ الأمر الآن." });
  }
  return true;
}
