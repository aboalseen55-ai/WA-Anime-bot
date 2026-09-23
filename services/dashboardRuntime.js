import axios from "axios";
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
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
  if (typeof value === "string") return value.replace(/\{(query|args|sourceUrl|videoId|arg(\d+))\}/g, (_, key, index) => index ? variables.args?.[Number(index) - 1] || "" : Array.isArray(variables[key]) ? variables[key].join(' ') : variables[key] || "");
  if (Array.isArray(value)) return value.map(item => interpolate(item, variables));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item, variables)]));
  return value;
}

export function seriesRequestUrl(request, variables) {
  const encoded = Object.fromEntries(Object.entries(variables).map(([key, value]) => [key,
    Array.isArray(value) ? value.map(item => encodeURIComponent(item)) : encodeURIComponent(value || '')]));
  const template = request.endpoint.replace(/%7B(query|args|sourceUrl|videoId|arg\d+)%7D/gi, '{$1}');
  const endpoint = new URL(interpolate(template, encoded));
  for (const [key, value] of new URLSearchParams(request.queryTemplate || '')) {
    endpoint.searchParams.set(key, interpolate(value, variables));
  }
  return endpoint;
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

export async function runSeriesService(service, variables, sessionStore = null, userId, chatId, commandId) {
  if (!service?.enabled || service.type !== 'series' || !service.seriesConfig) throw new Error('خدمة سلسلة غير مفعلة أو غير صالحة');
  const sc = service.seriesConfig;
  // Step 1: Search
  const searchEndpoint = seriesRequestUrl({ ...sc.searchRequest, endpoint: sc.searchRequest.endpoint || service.endpoint }, variables);
  const headers = decryptDashboardValue(sc.searchRequest.encryptedHeaders) || {};
  const data = interpolate(decryptDashboardValue(sc.searchRequest.encryptedBody) || undefined, variables);
  const agent = await publicHttpsAgent(searchEndpoint.toString());
  try {
      const searchResp = await httpClient({ maxRedirects: 0, maxContentLength: 1024 * 1024, maxBodyLength: 120000, method: sc.searchRequest.method || 'GET', url: searchEndpoint.toString(), headers, data, timeout: sc.searchRequest.timeoutMs || service.timeoutMs, httpsAgent: agent, proxy: false, validateStatus: s => s >= 200 && s < 300, responseType: 'json' });
    const rawItems = Array.isArray(searchResp.data) ? searchResp.data : (searchResp.data?.videos || searchResp.data?.results || searchResp.data?.items || searchResp.data?.data);
    const limit = sc.general?.resultLimit || 6;
    const items = Array.isArray(rawItems) ? rawItems.slice(0, limit) : [];
    const normalized = items.map(it => mapResponseFields(it, sc.searchResponseMapping || {}));
      // store user session search results so selection can be done later
      if (userId) {
        const key = JSON.stringify([chatId, userId]);
        for (const [id, old] of seriesSessions) if (old.expires < Date.now()) seriesSessions.delete(id);
        if (seriesSessions.size >= 1000 && !seriesSessions.has(key)) throw new Error('عدد الجلسات النشطة كبير؛ حاول لاحقًا');
        const sess = { chatId, commandId, serviceId: service._id?.toString?.() || service._id, results: normalized, expires: Date.now() + 5 * 60 * 1000 };
        if (sessionStore && typeof sessionStore.set === 'function') sessionStore.set(key, sess);
        seriesSessions.set(key, sess);
      }
    return { step: 'search', results: normalized };
  } finally { agent.destroy(); }
}

  // In-memory store for user series sessions (sender JID -> {serviceId, results, expires})
  const seriesSessions = new Map();

  export function getSeriesSession(userId, chatId) {
    const key = JSON.stringify([chatId, userId]);
    const session = seriesSessions.get(key);
    if (!session) return null;
    if (session.expires < Date.now()) { seriesSessions.delete(key); return null; }
    return session;
  }

  // Store session internally if sessionStore not provided
  function storeSeriesSession(userId, value, sessionStore) {
    if (sessionStore && typeof sessionStore.set === 'function') return sessionStore.set(userId, value);
    seriesSessions.set(userId, value);
  }

  // Select a result and run the download/polling flow, then send via sock
  const activeSelections = new Set();
  export async function selectSeriesResult(userId, index, sock, jid, msg) {
    const key = JSON.stringify([jid, userId]);
    if (activeSelections.has(key)) throw new Error('هناك طلب جارٍ بالفعل');
    if (activeSelections.size >= 2) throw new Error('الخدمة مشغولة؛ حاول لاحقًا');
    activeSelections.add(key);
    try { return await executeSeriesSelection(userId, index, sock, jid, msg); }
    finally { activeSelections.delete(key); }
  }
  async function executeSeriesSelection(userId, index, sock, jid, msg) {
    const session = getSeriesSession(userId, jid);
    if (!session) throw new Error('No active series session');
    const command = session.commandId && await DashboardCommand.findById(session.commandId);
    if (!command?.enabled || String(command.apiId) !== String(session.serviceId)) throw new Error('الأمر غير متاح');
    if (command.permission === 'developer' && !isDeveloper(userId)) throw new Error('الأمر خاص بالمطور');
    if (command.permission === 'moderator' && !isDeveloper(userId) && !(await isModerator(userId, getKingdomIdFromGroupJid(jid)))) throw new Error('الأمر للمشرفين');
    const serviceId = session.serviceId;
    const results = session.results || [];
    if (!Number.isInteger(index) || index < 0 || index >= results.length) throw new Error('Invalid selection');
    // load service config (support both query objects and direct returns)
    const maybeQuery = DashboardApi.findById(serviceId);
    let service;
    if (maybeQuery && typeof maybeQuery.lean === 'function') {
      service = await maybeQuery.lean();
    } else {
      service = await maybeQuery;
    }
    if (!service?.enabled || service.type !== 'series' || !service.seriesConfig) throw new Error('Service disabled or invalid');
    const sc = service.seriesConfig;
    const selected = results[index];
    const mappedSource = selected.sourceUrl || selected.sourceurl || selected.source || selected.video_link || selected.url || null;
    const videoId = selected.videoId || selected.video_id;
    if (!mappedSource && !videoId) throw new Error('Selected item has no source URL or video ID');
    // Build download request variables
    const variables = { sourceUrl: mappedSource || `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, videoId, query: msg?.text || '', args: [] };

    // Prepare download endpoint and params
    const downloadEndpoint = seriesRequestUrl({ ...sc.downloadRequest, endpoint: sc.downloadRequest.endpoint || service.endpoint }, variables);
    const headers = decryptDashboardValue(sc.downloadRequest.encryptedHeaders) || {};
    const data = interpolate(decryptDashboardValue(sc.downloadRequest.encryptedBody) || undefined, variables);
    const agent = await publicHttpsAgent(downloadEndpoint.toString());
    try {
      const resp = await httpClient({ maxRedirects: 0, maxContentLength: 1024 * 1024, maxBodyLength: 120000, method: sc.downloadRequest.method || 'GET', url: downloadEndpoint.toString(), headers, data, timeout: sc.downloadRequest.timeoutMs || service.timeoutMs || 12000, httpsAgent: agent, proxy: false, validateStatus: s => s >= 200 && s < 300, responseType: 'json' });
      const raw = resp.data;
      // Map download response fields
      const mapped = mapResponseFields(raw, sc.downloadResponseMapping || {});
      const downloadUrl = normalizeMediaUrl(mapped.downloadUrl || mapped.url || raw?.file || raw?.url);
      if (!downloadUrl) throw new Error('Download URL not found in downloader response');
      await sock.sendMessage(jid, { text: 'جارٍ تجهيز الفيديو؛ قد يستغرق حتى خمس دقائق.' });
      await sendPreparedSeriesVideo([downloadUrl, normalizeMediaUrl(mapped.backupUrl || raw?.reserved_file)].filter(Boolean), sc.processing, async path => {
        await sock.sendMessage(jid, { video: { url: path }, mimetype: 'video/mp4', caption: String(selected.title || '').slice(0, 500) });
      });
      // cleanup session
      if (getSeriesSession(userId, jid) === session) seriesSessions.delete(JSON.stringify([jid, userId]));
      return { ok: true, url: downloadUrl };
    } finally { agent.destroy(); }
  }

export async function sendPreparedSeriesVideo(urls, processing = {}, send, maxBytes = 150 * 1024 * 1024) {
  const deadline = Date.now() + Math.min(300000, Math.max(1, processing.maxPreparationMs ?? 300000));
  const directory = await mkdtemp(join(tmpdir(), 'bot-video-'));
  const path = join(directory, 'video.mp4');
  let firstWait = true;
  try {
    while (Date.now() < deadline) {
      for (const url of new Set(urls)) {
        if (Date.now() >= deadline) break;
        const agent = await publicHttpsAgent(url);
        let response;
        try {
          response = await httpClient({ method: 'GET', url, httpsAgent: agent, proxy: false,
            maxRedirects: 0, timeout: Math.max(1, Math.min(30000, deadline - Date.now())),
            signal: AbortSignal.timeout(120000),
            responseType: 'stream', validateStatus: status => status === 404 || status === 200 });
          if (response.status === 404) { response.data.destroy(); continue; }
          if (!String(response.headers?.['content-type'] || '').toLowerCase().startsWith('video/')) throw new Error('الاستجابة ليست ملف فيديو');
          if (Number(response.headers?.['content-length']) > maxBytes) throw new Error('الفيديو يتجاوز حد 150 ميجابايت');
          let bytes = 0;
          const limiter = new Transform({ transform(chunk, encoding, callback) {
            bytes += chunk.length;
            callback(bytes > maxBytes ? new Error('الفيديو يتجاوز حد 150 ميجابايت') : null, chunk);
          } });
          await pipeline(response.data, limiter, createWriteStream(path, { flags: 'w' }));
          if (!bytes) throw new Error('ملف الفيديو فارغ');
          await send(path);
          return;
        } finally { response?.data?.destroy(); agent.destroy(); }
      }
      const delay = firstWait ? (processing.initialWaitMs ?? 20000) : (processing.pollIntervalMs ?? 10000);
      firstWait = false;
      await new Promise(resolve => setTimeout(resolve, Math.max(1, Math.min(delay, deadline - Date.now()))));
    }
    throw new Error('انتهت مهلة تجهيز الفيديو؛ حاول لاحقًا');
  } finally { await rm(directory, { recursive: true, force: true }); }
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
      if (command.apiId.type === 'series') {
        apiResult = await runSeriesService(command.apiId, { query, args }, undefined, sender, jid, command._id);
      } else {
        apiResult = await runConfiguredApi(command.apiId, { query, args });
      }
    }
    if (apiResult?.step === 'search') {
      const list = apiResult.results.map((item, index) => `${index + 1}. ${String(item.title || 'Video').slice(0, 200)}`).join('\n');
      await sock.sendMessage(jid, { text: list ? `${list}\n\nأرسل رقم الفيديو لتنزيله.` : 'لم أجد نتائج.' });
      return true;
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
