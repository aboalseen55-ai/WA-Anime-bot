import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

function getKey() {
  const value = String(process.env.DASHBOARD_ENCRYPTION_KEY || "").trim();
  if (!value) return null;
  return crypto.createHash("sha256").update(value).digest();
}

export function isDashboardEncryptionConfigured() {
  return Boolean(getKey());
}

export function encryptDashboardValue(value) {
  const key = getKey();
  if (!key) throw new Error("DASHBOARD_ENCRYPTION_KEY is not configured");
  if (!value) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptDashboardValue(value) {
  if (!value) return null;
  const key = getKey();
  if (!key) throw new Error("DASHBOARD_ENCRYPTION_KEY is not configured");
  const raw = Buffer.from(value, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8"));
}
