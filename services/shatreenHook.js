import crypto from "node:crypto";
import { DEVELOPER_JID } from "../config.js";
import { instagramDaySection } from "./shatreenComments.js";

// Notifications from شاطرين (shatreen.com): the platform POSTs a ready-worded message to
// /hooks/shatreen with «Authorization: Bearer SHATREEN_HOOK_SECRET», and the bot sends it on
// WhatsApp to the developer (or to SHATREEN_NOTIFY_JIDS, comma-separated, when set). The evening
// summary comes with «kind: "daily"», and the bot adds the day's Instagram comments under it.

const MAX_BODY = 8 * 1024;
const MAX_PER_MINUTE = 30;

function sameSecret(given, expected) {
  if (!given || !expected) return false;
  const a = crypto.createHash("sha256").update(String(given)).digest();
  const b = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
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

/** Returns a request handler; it answers only /hooks/shatreen and returns false for anything else. */
export function createShatreenHook({ getSock }) {
  const recipients = (process.env.SHATREEN_NOTIFY_JIDS || DEVELOPER_JID)
    .split(",")
    .map((j) => j.trim())
    .filter(Boolean);
  let windowStart = Date.now();
  let sentInWindow = 0;

  return async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/hooks/shatreen") return false;
    if (req.method !== "POST") return reply(res, 405, { error: "POST only" }), true;
    const given = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!sameSecret(given, process.env.SHATREEN_HOOK_SECRET)) return reply(res, 403, { error: "forbidden" }), true;

    const now = Date.now();
    if (now - windowStart > 60000) {
      windowStart = now;
      sentInWindow = 0;
    }
    if (sentInWindow >= MAX_PER_MINUTE) return reply(res, 429, { error: "too many" }), true;

    let text = "";
    let kind = "";
    try {
      const body = JSON.parse(await readBody(req));
      text = String(body.text || "").slice(0, 3000);
      kind = String(body.kind || "");
    } catch {
      return reply(res, 400, { error: "bad body" }), true;
    }
    if (kind === "daily" && text.trim()) {
      try {
        text += "\n" + (await instagramDaySection());
      } catch (error) {
        console.warn("Shatreen Instagram summary failed:", error?.message);
      }
    }
    if (!text.trim()) return reply(res, 400, { error: "empty" }), true;

    const sock = getSock();
    if (!sock) return reply(res, 503, { error: "whatsapp not connected" }), true;
    try {
      for (const jid of recipients) await sock.sendMessage(jid, { text });
      sentInWindow++;
      return reply(res, 200, { ok: true }), true;
    } catch (error) {
      console.warn("Shatreen notification failed:", error?.message);
      return reply(res, 503, { error: "send failed" }), true;
    }
  };
}
