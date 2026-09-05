import axios from "axios";

const GIPHY_ENDPOINT = "https://api.giphy.com/v1/gifs/search";

export function isGiphyConfigured() {
  return Boolean(String(process.env.GIPHY_API_KEY || "").trim());
}

export async function findRomanticGif(query) {
  const apiKey = String(process.env.GIPHY_API_KEY || "").trim();
  if (!apiKey) return null;

  try {
    const response = await axios.get(GIPHY_ENDPOINT, {
      params: {
        api_key: apiKey,
        q: String(query || "cute love reaction").slice(0, 100),
        rating: "pg-13",
        limit: 10,
        lang: "en"
      },
      timeout: 12000
    });

    const options = (response.data?.data || [])
      .map((gif) => gif.images?.fixed_height?.url || gif.images?.original?.url)
      .filter((url) => /^https:\/\//i.test(String(url || "")));

    return options.length ? options[Math.floor(Math.random() * options.length)] : null;
  } catch (error) {
    console.warn(`⚠️ GIPHY request failed: ${error.message}`);
    return null;
  }
}
