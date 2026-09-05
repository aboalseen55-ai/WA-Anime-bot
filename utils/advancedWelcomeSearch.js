import { generateSamBotAIJson } from "./samBotAI.js";

function cleanText(value, limit = 100) {
  return String(value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function parseJson(text) {
  const source = String(text || "")
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const match = source.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export async function resolveAdvancedWelcomeSearch(characterInput, animeInput) {
  const fallbackCharacter = cleanText(characterInput);
  const fallbackAnime = cleanText(animeInput);
  const fallbackQuery = `${fallbackCharacter} ${fallbackAnime} anime character`.trim();
  if (!fallbackCharacter || !fallbackAnime) {
    return { characterName: fallbackCharacter, animeName: fallbackAnime, searchQuery: fallbackQuery };
  }

  const raw = await generateSamBotAIJson({
    systemInstruction: [
      "Return only valid JSON.",
      "Normalize an anime character name and its anime title for an image search.",
      "Understand Arabic, English, Arabic transliteration, spelling variations, and mixed input.",
      "Use the most common canonical English spelling when confident, otherwise preserve the supplied text.",
      "Never invent a different character or anime.",
      "Schema: {\"characterName\":\"...\",\"animeName\":\"...\",\"searchQuery\":\"canonical character canonical anime anime character\"}."
    ].join(" "),
    prompt: `character:${fallbackCharacter}\nanime:${fallbackAnime}`,
    maxOutputTokens: 80,
    temperature: 0
  });
  const parsed = parseJson(raw);
  const characterName = cleanText(parsed?.characterName || fallbackCharacter);
  const animeName = cleanText(parsed?.animeName || fallbackAnime);
  const searchQuery = cleanText(parsed?.searchQuery || `${characterName} ${animeName} anime character`, 180);

  return { characterName, animeName, searchQuery };
}
