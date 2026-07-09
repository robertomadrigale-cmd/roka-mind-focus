const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");

const PROVIDER_DEFAULTS = {
  openai: "gpt-4o",
  google: "gemini-1.5-pro",
  deepseek: "deepseek-chat"
};

exports.ai = onRequest({ cors: true, region: "us-central1", secrets: ["OPENAI_API_KEY", "GEMINI_API_KEY", "DEEPSEEK_API_KEY"] }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Metodo no permitido." });
    return;
  }

  const { provider, model, prompt, systemInstruction } = req.body || {};
  if (!provider || !prompt) {
    res.status(400).json({ error: "Faltan provider o prompt." });
    return;
  }

  try {
    const text = await callProvider({ provider, model, prompt, systemInstruction: systemInstruction || "" });
    res.json({ text });
  } catch (error) {
    logger.error("AI gateway error", { provider, error: error.message });
    res.status(502).json({ error: error.message });
  }
});

async function callProvider({ provider, model, prompt, systemInstruction }) {
  if (provider === "openai") {
    return callOpenAI({ model: model || PROVIDER_DEFAULTS.openai, prompt, systemInstruction });
  }
  if (provider === "google") {
    return callGemini({ model: model || PROVIDER_DEFAULTS.google, prompt, systemInstruction });
  }
  if (provider === "deepseek") {
    return callDeepSeek({ model: model || PROVIDER_DEFAULTS.deepseek, prompt, systemInstruction });
  }
  throw new Error("Proveedor no soportado por el gateway corporativo.");
}

async function callOpenAI({ model, prompt, systemInstruction }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY no esta configurada.");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: "system", content: systemInstruction }, { role: "user", content: prompt }] })
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || "OpenAI no respondio correctamente.");
  return data.choices?.[0]?.message?.content || "";
}

async function callGemini({ model, prompt, systemInstruction }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY no esta configurada.");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system_instruction: { parts: [{ text: systemInstruction }] }, contents: [{ parts: [{ text: prompt }] }] })
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || "Gemini no respondio correctamente.");
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function callDeepSeek({ model, prompt, systemInstruction }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY no esta configurada.");
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: "system", content: systemInstruction }, { role: "user", content: prompt }] })
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || "DeepSeek no respondio correctamente.");
  return data.choices?.[0]?.message?.content || "";
}
