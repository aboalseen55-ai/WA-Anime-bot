// Incoming WhatsApp messages for one business account: batches a customer's quick messages,
// asks the agent for a reply, answers by voice when the customer spoke, and alerts the owner on hand-off.
import { buildAgentInstruction, buildConversationText, buildOwnerAlert, buildSummaryAlert, buildSummaryInstruction, buildSummaryPrompt, HISTORY_LIMIT, parseAgentReply, phoneFromJid, toSpokenText, isNewConversation } from './agent.js';
import { tenantSettings } from './tenantSettings.js';
import { TenantContact } from '../../database/tenantModels.js';

const MB = 1024 * 1024;
const MAX_AUDIO_SECONDS = 180;
const MAX_IMAGE_BYTES = 6 * MB;
const MAX_IMAGES = 3;
const BATCH_DELAY_MS = Number(process.env.TENANT_BATCH_DELAY_MS || 3500);
const OWNER_ALERT_COOLDOWN_MS = 30 * 60 * 1000;
const SENT_IDS_LIMIT = 500;

export const mongoContactStore = {
  async get(tenantId, jid) {
    return TenantContact.findOne({ tenantId, jid }).lean();
  },
  async save(tenantId, jid, { set = {}, push = [] }) {
    const update = { $set: set };
    if (push.length) update.$push = { history: { $each: push, $slice: -HISTORY_LIMIT * 2 } };
    if (push.some(item => item.role === 'customer')) update.$inc = { messageCount: push.filter(item => item.role === 'customer').length };
    await TenantContact.updateOne({ tenantId, jid }, update, { upsert: true });
  },
  // conversations that went quiet and whose summary was not sent yet
  async dueSummaries(tenantId, quietSince) {
    return TenantContact.find({
      tenantId,
      conversationStartedAt: { $ne: null },
      lastMessageAt: { $lte: quietSince },
      $expr: { $or: [{ $eq: ['$summarySentAt', null] }, { $lt: ['$summarySentAt', '$conversationStartedAt'] }] }
    }).limit(20).lean();
  }
};

function unwrap(message) {
  let inner = message || {};
  for (let guard = 0; guard < 5; guard += 1) {
    const next = inner.ephemeralMessage?.message || inner.viewOnceMessage?.message || inner.viewOnceMessageV2?.message || inner.documentWithCaptionMessage?.message;
    if (!next) break;
    inner = next;
  }
  return inner;
}

export function readIncoming(message) {
  const inner = unwrap(message);
  const text = inner.conversation || inner.extendedTextMessage?.text || inner.imageMessage?.caption || inner.videoMessage?.caption || '';
  if (inner.audioMessage) return { kind: 'audio', text: '', node: inner.audioMessage, mimetype: inner.audioMessage.mimetype || 'audio/ogg', seconds: Number(inner.audioMessage.seconds) || 0 };
  if (inner.imageMessage) return { kind: 'image', text, node: inner.imageMessage, mimetype: inner.imageMessage.mimetype || 'image/jpeg', bytes: Number(inner.imageMessage.fileLength) || 0 };
  if (inner.videoMessage) return { kind: 'video', text };
  if (inner.documentMessage) return { kind: 'document', text: inner.documentMessage.caption || '' };
  if (inner.locationMessage) return { kind: 'location', text: `[أرسل موقع: ${inner.locationMessage.degreesLatitude}, ${inner.locationMessage.degreesLongitude}]` };
  if (text) return { kind: 'text', text };
  return null;
}

export function isCustomerChat(jid) {
  return /@(s\.whatsapp\.net|lid)$/.test(String(jid || ''));
}

/**
 * Builds the handler for one tenant. deps are injectable for tests:
 * getTenant() -> tenant doc, generate({systemInstruction, parts}) -> raw text,
 * createVoice(text, {voiceId}) -> {audio, mimetype}|null, download(msg) -> Buffer, store, now, delayMs.
 */
export function createTenantMessageHandler({ getTenant, getSock, generate, createVoice, download, store = mongoContactStore, now = () => Date.now(), batchDelayMs = BATCH_DELAY_MS, typingDelay = defaultTypingDelay, log = console }) {
  const pending = new Map();
  const sentIds = new Set();
  const lastAlert = new Map();

  function rememberSent(sent) {
    const id = sent?.key?.id;
    if (!id) return;
    sentIds.add(id);
    if (sentIds.size > SENT_IDS_LIMIT) sentIds.delete(sentIds.values().next().value);
  }

  async function send(jid, content) {
    const sent = await getSock().sendMessage(jid, content);
    rememberSent(sent);
    return sent;
  }

  async function onOwnerMessage(tenant, msg) {
    const jid = msg.key.remoteJid;
    // the owner answered by hand: drop what the bot was about to say in this chat
    const waiting = pending.get(jid);
    if (waiting?.timer) clearTimeout(waiting.timer);
    pending.delete(jid);
    const incoming = readIncoming(msg.message);
    const settings = tenantSettings(tenant);
    const set = {};
    if (settings.pauseHours > 0) set.pausedUntil = new Date(now() + settings.pauseHours * 3600_000);
    await store.save(String(tenant._id), jid, { set, push: incoming?.text ? [{ role: 'owner', text: incoming.text.slice(0, 2000), at: new Date(now()) }] : [] });
  }

  async function flush(jid) {
    const batch = pending.get(jid);
    pending.delete(jid);
    if (!batch) return;
    const tenant = await getTenant();
    if (!tenant?.enabled) return;
    const settings = tenantSettings(tenant);
    const tenantId = String(tenant._id);
    const contact = (await store.get(tenantId, jid)) || { jid, history: [] };
    const pushName = batch.pushName || contact.pushName || '';
    const phone = contact.phone || batch.phone || '';
    const texts = batch.items.map(item => item.text).filter(Boolean);
    const customerNote = texts.join('\n') || batch.items.map(item => (item.kind === 'audio' ? '[رسالة صوتية]' : item.kind === 'image' ? '[صورة]' : `[${item.kind}]`)).join(' ');

    if (contact.pausedUntil && new Date(contact.pausedUntil).getTime() > now()) {
      await store.save(tenantId, jid, { set: { pushName, phone, lastMessageAt: new Date(now()) }, push: [{ role: 'customer', text: customerNote.slice(0, 2000), at: new Date(now()) }] });
      return;
    }

    const parts = [];
    const voice = batch.items.some(item => item.kind === 'audio');
    let images = 0;
    for (const item of batch.items) {
      const tooBig = (item.kind === 'audio' && item.seconds > MAX_AUDIO_SECONDS) || (item.kind === 'image' && (item.bytes > MAX_IMAGE_BYTES || images >= MAX_IMAGES));
      if (!['audio', 'image'].includes(item.kind) || tooBig) continue;
      try {
        const buffer = await download(item.msg);
        parts.push({ inlineData: { mimeType: item.mimetype.split(';')[0], data: buffer.toString('base64') } });
        if (item.kind === 'image') images += 1;
      } catch (error) {
        log.warn?.(`Tenant ${tenant.slug}: media download failed:`, error.message);
      }
    }

    const view = { ...contact, pushName };
    parts.push({ text: buildConversationText({ contact: view, incomingTexts: texts, now: now() }) });
    const result = parseAgentReply(await generate({ systemInstruction: buildAgentInstruction(settings, { voice }), parts }));
    if (!result) {
      log.warn?.(`Tenant ${tenant.slug}: the AI returned no reply for a customer message.`);
      await store.save(tenantId, jid, { set: { pushName, phone, lastMessageAt: new Date(now()) }, push: [{ role: 'customer', text: customerNote.slice(0, 2000), at: new Date(now()) }] });
      return;
    }

    const sock = getSock();
    if (!sock) return;
    try { await sock.sendPresenceUpdate(voice ? 'recording' : 'composing', jid); } catch { /* optional */ }
    await typingDelay(result.reply);

    let sentVoice = false;
    if (voice && settings.voiceReplies && createVoice) {
      const note = await createVoice(toSpokenText(result.reply), { voiceId: settings.voiceId });
      if (note?.audio) {
        await send(jid, { audio: note.audio, mimetype: note.mimetype, ptt: true });
        sentVoice = true;
      }
    }
    if (!sentVoice) await send(jid, { text: result.reply });
    try { await sock.sendPresenceUpdate('paused', jid); } catch { /* optional */ }

    const at = new Date(now());
    const set = { pushName, phone, lastMessageAt: at };
    if (isNewConversation(contact, now())) set.conversationStartedAt = at;
    if (result.customerArabicName && !contact.arabicName) set.arabicName = result.customerArabicName;
    const heard = result.heard && voice ? `🎤 ${result.heard}` : '';
    const customerText = [texts.join('\n'), heard].filter(Boolean).join('\n') || customerNote;

    if (result.handoff) {
      set.handoffAt = at;
      set.handoffSummary = result.handoffSummary;
      const last = lastAlert.get(jid) || 0;
      if (now() - last > OWNER_ALERT_COOLDOWN_MS && settings.ownerNumbers.length) {
        lastAlert.set(jid, now());
        const alert = buildOwnerAlert({ businessName: settings.businessName || tenant.name, contact: { ...view, phone, arabicName: set.arabicName || contact.arabicName }, summary: result.handoffSummary });
        for (const number of settings.ownerNumbers) {
          try { await send(`${number}@s.whatsapp.net`, { text: alert }); } catch (error) { log.warn?.(`Tenant ${tenant.slug}: owner alert failed:`, error.message); }
        }
      }
    }

    await store.save(tenantId, jid, {
      set,
      push: [
        { role: 'customer', text: customerText.slice(0, 2000), at },
        { role: 'agent', text: result.reply.slice(0, 2000), at }
      ]
    });
  }

  async function onMessages({ messages, type }) {
    if (type !== 'notify') return;
    const tenant = await getTenant();
    if (!tenant?.enabled) return;
    const settings = tenantSettings(tenant);
    for (const msg of messages || []) {
      const jid = msg?.key?.remoteJid;
      if (!msg?.message || !isCustomerChat(jid)) continue;
      if (msg.key.fromMe) {
        if (sentIds.has(msg.key.id)) continue;
        await onOwnerMessage(tenant, msg);
        continue;
      }
      if (!settings.botEnabled) continue;
      const phone = phoneFromJid(jid) || phoneFromJid(msg.key.remoteJidAlt) || phoneFromJid(msg.key.senderPn);
      if (phone && settings.ownerNumbers.includes(phone)) continue;
      const incoming = readIncoming(msg.message);
      if (!incoming) continue;
      const batch = pending.get(jid) || { items: [], timer: null };
      batch.items.push({ ...incoming, msg });
      batch.pushName = msg.pushName || batch.pushName;
      batch.phone = phone || batch.phone;
      if (batch.timer) clearTimeout(batch.timer);
      batch.timer = setTimeout(() => {
        flush(jid).catch(error => log.error?.(`Tenant ${tenant.slug}: reply failed:`, error.message));
      }, batchDelayMs);
      batch.timer.unref?.();
      pending.set(jid, batch);
    }
  }

  /** Sends the owner an AI summary of each conversation once it has been quiet for summaryAfterMinutes. */
  async function sweepSummaries() {
    const tenant = await getTenant();
    if (!tenant?.enabled || !getSock() || !store.dueSummaries) return 0;
    const settings = tenantSettings(tenant);
    if (!settings.summaryAfterMinutes || !settings.ownerNumbers.length) return 0;
    const tenantId = String(tenant._id);
    const due = await store.dueSummaries(tenantId, new Date(now() - settings.summaryAfterMinutes * 60_000));
    let sent = 0;
    for (const contact of due) {
      // mark first so a failing AI call does not retry the same chat every minute
      await store.save(tenantId, contact.jid, { set: { summarySentAt: new Date(now()) } });
      const summary = String(await generate({ systemInstruction: buildSummaryInstruction(settings), parts: [{ text: buildSummaryPrompt(contact) }], json: false }) || '').trim();
      if (!summary) continue;
      const text = buildSummaryAlert({ businessName: settings.businessName || tenant.name, contact, summary: summary.slice(0, 1500) });
      for (const number of settings.ownerNumbers) {
        try { await send(`${number}@s.whatsapp.net`, { text }); sent += 1; } catch (error) { log.warn?.(`Tenant ${tenant.slug}: summary send failed:`, error.message); }
      }
    }
    return sent;
  }

  return { onMessages, flush, rememberSent, sweepSummaries, pending };
}

function defaultTypingDelay(text) {
  const ms = Math.min(1200 + String(text || '').length * 35, 6000);
  return new Promise(resolve => setTimeout(resolve, ms));
}

export { isNewConversation };
