import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createXsamerHook, signXsamer, formatInquiry } from "../services/xsamerHook.js";

const SECRET = "test-secret";

async function withServer(hook, fn) {
  const server = http.createServer(async (req, res) => {
    if (!(await hook(req, res))) { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}

function post(base, body, { ts = Math.floor(Date.now() / 1000), sig } = {}) {
  const raw = JSON.stringify(body);
  return fetch(`${base}/hooks/xsamer`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-XSam-Timestamp": String(ts), "X-XSam-Signature": sig ?? `sha256=${signXsamer(SECRET, String(ts), raw)}` },
    body: raw,
  });
}

const inquiry = { id: "abc", name: "أحمد", email: "a@b.co", service: "Website Development", message: "مرحبا\nأريد موقعاً" };

test("valid signed inquiry is forwarded once, duplicates are ignored", async () => {
  const sent = [];
  const hook = createXsamerHook({ secret: SECRET, getSock: () => ({ sendMessage: async (jid, m) => sent.push([jid, m.text]) }) });
  await withServer(hook, async (base) => {
    assert.equal((await post(base, inquiry)).status, 200);
    assert.equal((await post(base, inquiry)).status, 200);
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0][1], /أحمد/);
  assert.match(sent[0][1], /Website Development/);
});

test("bad signature and stale timestamp are rejected", async () => {
  const hook = createXsamerHook({ secret: SECRET, getSock: () => ({ sendMessage: async () => {} }) });
  await withServer(hook, async (base) => {
    assert.equal((await post(base, inquiry, { sig: "sha256=00" })).status, 401);
    const old = Math.floor(Date.now() / 1000) - 3600;
    assert.equal((await post(base, inquiry, { ts: old })).status, 401);
  });
});

test("whatsapp offline returns 503 so the website can retry", async () => {
  const hook = createXsamerHook({ secret: SECRET, getSock: () => null });
  await withServer(hook, async (base) => {
    assert.equal((await post(base, inquiry)).status, 503);
  });
});

test("other paths are left for the dashboard", async () => {
  const hook = createXsamerHook({ secret: SECRET, getSock: () => null });
  await withServer(hook, async (base) => {
    assert.equal((await fetch(`${base}/dashboard`)).status, 404);
  });
});

test("format includes a dash when no service", () => {
  assert.match(formatInquiry({ ...inquiry, service: null }), /🛠 —/);
});
