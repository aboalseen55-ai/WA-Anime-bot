// بديل OpenAI لما Gemini يفشل (ضغط 503، رصيد، مفتاح). بيحوّل نفس الطلب (نص/صوت/صورة/PDF) لصيغة OpenAI.
// Env: OPENAI_API_KEY، SAM_BOT_OPENAI_MODEL (افتراضي gpt-4.1-mini)، OPENAI_TRANSCRIBE_MODEL (افتراضي gpt-4o-mini-transcribe)
const OPENAI_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";

export function isOpenAIFallbackConfigured() {
  return Boolean(String(process.env.OPENAI_API_KEY || "").trim())
    && String(process.env.SAM_BOT_OPENAI_FALLBACK || "").trim().toLowerCase() !== "false";
}

export function openAIFallbackModel() {
  return String(process.env.SAM_BOT_OPENAI_MODEL || "").trim() || DEFAULT_OPENAI_MODEL;
}

async function request(path, init, { fetchImpl = globalThis.fetch, timeoutMs = 30000 } = {}) {
  const response = await fetchImpl(`${OPENAI_URL}/${path}`, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Authorization: `Bearer ${String(process.env.OPENAI_API_KEY || "").trim()}`, ...(init.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${data?.error?.message || "request failed"}`);
  return data;
}

function audioExtension(mimeType) {
  if (/ogg|opus/.test(mimeType)) return "ogg";
  if (/mp4|m4a|aac/.test(mimeType)) return "m4a";
  if (/mpeg|mp3/.test(mimeType)) return "mp3";
  if (/wav/.test(mimeType)) return "wav";
  return "webm";
}

async function transcribe({ mimeType, data }, options) {
  const form = new FormData();
  form.append("file", new Blob([Buffer.from(data, "base64")], { type: mimeType }), `voice.${audioExtension(mimeType)}`);
  form.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe");
  const result = await request("audio/transcriptions", { method: "POST", body: form }, options);
  return String(result.text || "").trim();
}

/** بيحوّل parts تبعت Gemini لـ content تبع OpenAI. الصوت بيتفرّغ لنص أول لأنه موديلات الشات ما بتسمع. */
export async function toOpenAIContent(prompt, options = {}) {
  if (!Array.isArray(prompt)) return String(prompt || "");
  const content = [];
  for (const part of prompt) {
    if (typeof part === "string") {
      content.push({ type: "text", text: part });
    } else if (part?.text) {
      content.push({ type: "text", text: part.text });
    } else if (part?.inlineData) {
      const mimeType = String(part.inlineData.mimeType || "").split(";")[0];
      const { data } = part.inlineData;
      if (mimeType.startsWith("audio/")) {
        const transcript = await (options.transcribeImpl || transcribe)({ mimeType, data }, options);
        content.push({ type: "text", text: `Voice note (automatic transcript): ${transcript || "[silent or unintelligible]"}` });
      } else if (mimeType.startsWith("image/")) {
        content.push({ type: "image_url", image_url: { url: `data:${mimeType};base64,${data}` } });
      } else if (mimeType === "application/pdf") {
        content.push({ type: "file", file: { filename: "document.pdf", file_data: `data:application/pdf;base64,${data}` } });
      }
    }
  }
  return content;
}

export async function generateOpenAIFallback({ systemInstruction, prompt, temperature, maxOutputTokens, json = false, timeoutMs = 30000, fetchImpl, transcribeImpl }) {
  const options = { fetchImpl, timeoutMs, transcribeImpl };
  const system = [systemInstruction, json ? "Respond with a valid JSON object only." : ""].filter(Boolean).join("\n");
  const body = {
    model: openAIFallbackModel(),
    temperature,
    max_completion_tokens: maxOutputTokens,
    messages: [{ role: "system", content: system }, { role: "user", content: await toOpenAIContent(prompt, options) }],
    ...(json ? { response_format: { type: "json_object" } } : {})
  };
  const data = await request("chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }, options);
  return String(data?.choices?.[0]?.message?.content || "");
}
