import axios from "axios";
let httpClient = axios;
export function setHttpClient(client) { httpClient = client; }
import { getUrlInfo, generateWAMessage, proto } from '@whiskeysockets/baileys';
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

function normalizeMediaUrl(value) {
  const text = String(value || '').trim();
  const markdown = text.match(/^\[https?:\/\/[^\]]+\]\((https?:\/\/[^)]+)\)$/i);
  return markdown?.[1] || text;
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
  // Support both normal APIs and series services
  if (api.type !== 'series') {
    const endpoint = new URL(interpolate(api.endpoint, variables));
    if (api.queryTemplate) for (const [key, value] of new URLSearchParams(interpolate(api.queryTemplate, variables))) endpoint.searchParams.set(key, value);
    if (endpoint.protocol !== "https:") throw new Error("يسمح فقط بروابط HTTPS");
    const headers = decryptDashboardValue(api.encryptedHeaders) || {};
    const data = interpolate(decryptDashboardValue(api.encryptedBody) || undefined, variables);
    const agent = await publicHttpsAgent(endpoint.toString());
    try {
        const response = await httpClient({
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
  throw new Error('Series services should be executed via runSeriesService');
}

export function mapResponseFields(item, mapping) {
  if (!item || typeof item !== 'object') return {};
  const mapped = {};
  for (const [key, field] of Object.entries(mapping || {})) {
    if (!field) continue;
    mapped[key] = readDashboardPath(item, String(field));
  }
  return mapped;
}

export async function runSeriesService(service, variables, sessionStore = null, userId) {
  if (!service || service.type !== 'series' || !service.seriesConfig) throw new Error('خدمة سلسلة غير صالحة');
  const sc = service.seriesConfig;
  // Step 1: Search
  const searchEndpoint = new URL(interpolate(sc.searchRequest.endpoint || service.endpoint || '', variables));
  if (sc.searchRequest.queryTemplate) for (const [k,v] of new URLSearchParams(interpolate(sc.searchRequest.queryTemplate, variables))) searchEndpoint.searchParams.set(k, v);
  const headers = decryptDashboardValue(sc.searchRequest.encryptedHeaders) || {};
  const data = interpolate(decryptDashboardValue(sc.searchRequest.encryptedBody) || undefined, variables);
  const agent = await publicHttpsAgent(searchEndpoint.toString());
  try {
      const searchResp = await httpClient({ method: sc.searchRequest.method || 'GET', url: searchEndpoint.toString(), headers, data, timeout: sc.searchRequest.timeoutMs || service.timeoutMs, httpsAgent: agent, proxy: false, validateStatus: s => s >= 200 && s < 300, responseType: 'json' });
    const rawItems = Array.isArray(searchResp.data) ? searchResp.data : (searchResp.data?.results || searchResp.data?.items || searchResp.data);
    const limit = sc.general?.resultLimit || 6;
    const items = Array.isArray(rawItems) ? rawItems.slice(0, limit) : [];
    const normalized = items.map(it => mapResponseFields(it, sc.searchResponseMapping || {}));
      // store user session search results so selection can be done later
      if (userId) {
        const sess = { serviceId: service._id?.toString?.() || service._id, results: normalized, expires: Date.now() + 5 * 60 * 1000 };
        if (sessionStore && typeof sessionStore.set === 'function') sessionStore.set(userId, sess);
        try { seriesSessions.set(userId, sess); } catch (e) { /* fallback: ensure storeSeriesSession used when seriesSessions not ready */ storeSeriesSession(userId, sess, sessionStore); }
      }
    return { step: 'search', results: normalized };
  } finally { agent.destroy(); }
}

  // In-memory store for user series sessions (sender JID -> {serviceId, results, expires})
  const seriesSessions = new Map();

  export function getSeriesSession(userId) {
    const session = seriesSessions.get(userId);
    if (!session) return null;
    if (session.expires < Date.now()) { seriesSessions.delete(userId); return null; }
    return session;
  }

  // Store session internally if sessionStore not provided
  function storeSeriesSession(userId, value, sessionStore) {
    if (sessionStore && typeof sessionStore.set === 'function') return sessionStore.set(userId, value);
    seriesSessions.set(userId, value);
  }

  // Select a result and run the download/polling flow, then send via sock
  export async function selectSeriesResult(userId, index, sock, jid, msg) {
    const session = getSeriesSession(userId);
    if (!session) throw new Error('No active series session');
    const serviceId = session.serviceId;
    const results = session.results || [];
    if (index < 0 || index >= results.length) throw new Error('Invalid selection');
    // load service config (support both query objects and direct returns)
    const maybeQuery = DashboardApi.findById(serviceId);
    let service;
    if (maybeQuery && typeof maybeQuery.lean === 'function') {
      service = await maybeQuery.lean();
    } else {
      service = await maybeQuery;
    }
    if (!service || service.type !== 'series' || !service.seriesConfig) throw new Error('Service not found or invalid');
    const sc = service.seriesConfig;
    const selected = results[index];
    const mappedSource = selected.sourceUrl || selected.sourceurl || selected.source || selected.video_link || selected.url || null;
    if (!mappedSource) throw new Error('Selected item has no source URL');
    // Build download request variables
    const variables = { sourceUrl: mappedSource, query: msg?.text || '', args: [] };

    // Prepare download endpoint and params
    const downloadEndpoint = new URL(interpolate(sc.downloadRequest.endpoint || service.endpoint || '', variables));
    if (sc.downloadRequest.queryTemplate) for (const [k,v] of new URLSearchParams(interpolate(sc.downloadRequest.queryTemplate, variables))) downloadEndpoint.searchParams.set(k, v);
    const headers = decryptDashboardValue(sc.downloadRequest.encryptedHeaders) || {};
    const data = interpolate(decryptDashboardValue(sc.downloadRequest.encryptedBody) || undefined, variables);
    const agent = await publicHttpsAgent(downloadEndpoint.toString());
    try {
      const initialWait = sc.processing?.initialWaitMs || 20000;
      const pollInterval = sc.processing?.pollIntervalMs || 10000;
      const maxPreparation = sc.processing?.maxPreparationMs || 300000;
      const pendingStatuses = Array.isArray(sc.processing?.pendingStatusCodes) ? sc.processing.pendingStatusCodes : [404];
      const start = Date.now();
      // initial request
      let resp;
      try {
          resp = await httpClient({ method: sc.downloadRequest.method || 'GET', url: downloadEndpoint.toString(), headers, data, timeout: sc.downloadRequest.timeoutMs || service.timeoutMs, httpsAgent: agent, proxy: false, validateStatus: s => s >= 200 && s < 300, responseType: 'json' });
      } catch (err) {
        // if 404 or pending, proceed to polling
        if (!err.response || !pendingStatuses.includes(err.response.status)) throw err;
        // else set resp to null and continue to polling
        resp = null;
      }
      if (!resp) {
        // wait initial delay
        await new Promise(r => setTimeout(r, initialWait));
        // poll until ready or timeout
        while (Date.now() - start < maxPreparation) {
          try {
              const attempt = await httpClient({ method: sc.downloadRequest.method || 'GET', url: downloadEndpoint.toString(), headers, data, timeout: sc.downloadRequest.timeoutMs || service.timeoutMs, httpsAgent: agent, proxy: false, validateStatus: s => s >= 200 && s < 300, responseType: 'json' });
            resp = attempt; break;
          } catch (err) {
            if (!err.response || !pendingStatuses.includes(err.response.status)) throw err;
            await new Promise(r => setTimeout(r, pollInterval));
          }
        }
      }
      if (!resp) throw new Error('Generated file not ready in time');
      const raw = resp.data;
      // Map download response fields
      const mapped = mapResponseFields(raw, sc.downloadResponseMapping || {});
      const downloadUrl = mapped.downloadUrl || mapped.url || raw.url || null;
      if (!downloadUrl) throw new Error('Download URL not found in downloader response');
      // send video via Baileys
      await sock.sendMessage(jid, { video: { url: downloadUrl }, caption: `Here is your file: ${selected.title || ''}` });
      // cleanup session
      seriesSessions.delete(userId);
      return { ok: true, url: downloadUrl };
    } finally { agent.destroy(); }
  }

export async function youtubeReplyPreview(reply, data, fetchThumbnail = async url => {
  const agent = await publicHttpsAgent(url);
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000,
      maxRedirects: 0, proxy: false, httpsAgent: agent, maxContentLength: 512 * 1024 });
    const bytes = Buffer.from(response.data);
    return bytes[0] === 0xff && bytes[1] === 0xd8 ? bytes : undefined;
  } finally { agent.destroy(); }
}) {
  const id = /https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})(?=$|[\s&#])/.exec(reply)?.[1];
  const video = id && Array.isArray(data?.videos) && data.videos.find(item => item.video_id === id);
  if (!video) return undefined;
  const url = `https://www.youtube.com/watch?v=${id}`;
  const preview = { 'canonical-url': url, 'matched-text': url,
    title: String(video.title || 'YouTube').slice(0, 250),
    description: [video.author, video.video_length].filter(Boolean).join(' | ').slice(0, 300) };
  // A failed thumbnail must not prevent delivery of the search result.
  try { preview.jpegThumbnail = await fetchThumbnail(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`); }
  catch { /* Keep the title and link when the image is unavailable. */ }
  return preview;
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
    let apiResult = null;
    if (command.apiId) {
      // If the configured API is a series service, start the series flow
      if (command.apiId.type === 'series' || command.apiId?.seriesConfig) {
        apiResult = await runSeriesService(command.apiId, { query, args }, undefined, sender);
      } else {
        apiResult = await runConfiguredApi(command.apiId, { query, args });
      }
    }
    const rawData = ["text", "image_url", "video_url", "audio_url"].includes(apiResult?.responseType) ? apiResult.data : null;
    const apiValue = apiResult && apiResult.step === 'search' ? apiResult.results : readDashboardPath(rawData, command.responsePath);
    const reply = applyTemplate(command.responseTemplate || "تم التنفيذ.", {
      sender,
      pushName: msg.pushName,
      apiValue,
      query,
      args
    });
    if (["image_url", "video_url", "audio_url"].includes(apiResult?.responseType)) {
      const mediaUrl = normalizeMediaUrl(typeof apiResult.data === 'string' ? apiResult.data : apiValue);
      if (!/^https:\/\//i.test(String(mediaUrl || ''))) throw new Error('نتيجة الوسائط ليست رابط HTTPS');
      const mediaType = apiResult.responseType.replace('_url','');
      await sock.sendMessage(jid, { [mediaType]: { url: mediaUrl }, ...(mediaType === 'audio' ? { mimetype: 'audio/mpeg', ptt: true } : { caption: reply || undefined }) });
    } else if (apiResult && apiResult.responseType !== "text") {
      const payload = apiResult.data;
      await sock.sendMessage(jid, { [apiResult.responseType]: Buffer.isBuffer(payload) ? payload : Buffer.from(payload), caption: reply || undefined });
    } else {
      const videoUrl = /https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}(?=$|[\s&#])/.exec(reply)?.[0];
      if (videoUrl && sock.relayMessage && sock.user?.id) {
        let linkPreview;
        try {
          linkPreview = await getUrlInfo(videoUrl, {
            thumbnailWidth: 192, fetchOpts: { timeout: 5000 },
            uploadImage: sock.waUploadToServer
          });
        } catch { /* Search metadata remains available if the page cannot be fetched. */ }
        linkPreview ||= await youtubeReplyPreview(reply, rawData);
        if (linkPreview) {
          const message = await generateWAMessage(jid, { text: reply, linkPreview }, { userJid: sock.user.id });
          message.message.extendedTextMessage.previewType = proto.Message.ExtendedTextMessage.PreviewType.VIDEO;
          await sock.relayMessage(jid, message.message, { messageId: message.key.id });
        } else await sock.sendMessage(jid, { text: reply });
      } else await sock.sendMessage(jid, { text: reply });
    }
  } catch (error) {
    console.warn(`⚠️ Dashboard command ${command.trigger} failed: ${error.message}`);
    await sock.sendMessage(jid, { text: "تعذر تنفيذ الأمر الآن." });
  }
  return true;
}
