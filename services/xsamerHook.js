import crypto from "node:crypto";
import { DEVELOPER_JID } from "../config.js";

// Contact-form messages from xsamer.com (XSam Studio). The website POSTs each inquiry to
// /hooks/xsamer, signed with HMAC-SHA256 over «<timestamp>.<raw body>» using XSAMER_HOOK_SECRET:
//   X-XSam-Timestamp: unix seconds      X-XSam-Signature: sha256=<hex>
// The bot checks the signature and the timestamp (±5 min), then forwards the message on WhatsApp
// to the developer (or to XSAMER_NOTIFY_JIDS, comma-separated, when set).
// The website stores every inquiry before calling us, so a non-200 here is safe: it can be retried.

const MAX_BODY = 16 * 1024;
const MAX_PER_MINUTE = 20;
const MAX_SKEW_SECONDS = 300;
const SEEN_LIMIT = 500;

export function signXsamer(secret, timestamp, rawBody) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

function validSignature(secret, timestamp, rawBody, header) {
  if (!secret || !header) return false;
  const expected = Buffer.from(`sha256=${signXsamer(secret, timestamp, rawBody)}`);
  const given = Buffer.from(String(header));
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function reply(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

const clip = (value, max) => String(value ?? "").trim().slice(0, max);

export function formatInquiry(inquiry) {
  const lines = [
    "📩 *طلب جديد من xsamer.com*",
    "",
    `👤 ${clip(inquiry.name, 120)}`,
    `✉️ ${clip(inquiry.email, 200)}`,
    `🛠 ${clip(inquiry.service, 120) || "—"}`,
    "",
    clip(inquiry.message, 3000),
  ];
  return lines.join("\n");
}

/** Returns a request handler; it answers only /hooks/xsamer and returns false for anything else. */
export function createXsamerHook({ getSock, secret = process.env.XSAMER_HOOK_SECRET, now = () => Date.now() }) {
  const recipients = (process.env.XSAMER_NOTIFY_JIDS || DEVELOPER_JID)
    .split(",")
    .map((j) => j.trim())
    .filter(Boolean);
  const seen = new Set();
  let windowStart = now();
  let sentInWindow = 0;

  return async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/hooks/xsamer") return false;
    if (req.method !== "POST") return reply(res, 405, { error: "POST only" }), true;
    if (!secret) return reply(res, 503, { error: "not configured" }), true;

    let raw = "";
    try {
      raw = await readBody(req);
    } catch {
      return reply(res, 413, { error: "too large" }), true;
    }

    const timestamp = String(req.headers["x-xsam-timestamp"] || "");
    const skew = Math.abs(now() / 1000 - Number(timestamp));
    if (!timestamp || !Number.isFinite(skew) || skew > MAX_SKEW_SECONDS) return reply(res, 401, { error: "stale" }), true;
    if (!validSignature(secret, timestamp, raw, req.headers["x-xsam-signature"])) return reply(res, 401, { error: "bad signature" }), true;

    let inquiry;
    try {
      inquiry = JSON.parse(raw);
    } catch {
      return reply(res, 400, { error: "bad body" }), true;
    }
    if (!clip(inquiry.message, 10)) return reply(res, 400, { error: "empty" }), true;

    // "Send again" from the website after a timeout must not produce a duplicate.
    const id = clip(inquiry.id, 100);
    if (id && seen.has(id)) return reply(res, 200, { ok: true, duplicate: true }), true;

    const t = now();
    if (t - windowStart > 60000) {
      windowStart = t;
      sentInWindow = 0;
    }
    if (sentInWindow >= MAX_PER_MINUTE) return reply(res, 429, { error: "too many" }), true;

    const sock = getSock();
    if (!sock) return reply(res, 503, { error: "whatsapp not connected" }), true;
    try {
      const text = formatInquiry(inquiry);
      for (const jid of recipients) await sock.sendMessage(jid, { text });
      sentInWindow++;
      if (id) {
        seen.add(id);
        if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value);
      }
      return reply(res, 200, { ok: true }), true;
    } catch (error) {
      console.warn("Xsamer inquiry forward failed:", error?.message);
      return reply(res, 503, { error: "send failed" }), true;
    }
  };
}
