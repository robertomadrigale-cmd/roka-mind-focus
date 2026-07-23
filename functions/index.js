const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore("rokazenfull");

const PROVIDER_DEFAULTS = {
  openai: "gpt-4o",
  google: "gemini-2.5-flash",
  deepseek: "deepseek-chat"
};

const MAX_REQUESTS_PER_HOUR = 30;
const MAX_PROMPT_LENGTH = 12000;
const MAX_MESSAGE_LENGTH = 4000;

exports.ai = onRequest({ cors: true, region: "us-central1", secrets: ["OPENAI_API_KEY", "GEMINI_API_KEY", "DEEPSEEK_API_KEY"] }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Metodo no permitido." });
    return;
  }

  try {
    const user = await verifyRequestUser(req);
    await enforceRateLimit(user.uid);
    const payload = validatePayload(req.body || {});
    const provider = payload.provider || process.env.AI_PROVIDER || "openai";
    const model = payload.model || process.env.AI_MODEL || PROVIDER_DEFAULTS[provider];
    const systemInstruction = buildSystemInstruction(payload.mode, payload.systemInstruction);
    const prompt = buildPrompt(payload);
    const result = await callProvider({ provider, model, prompt, systemInstruction, clientApiKey: payload.clientApiKey });
    res.json({
      text: result.text,
      usage: result.usage || {}
    });
  } catch (error) {
    const status = Number(error.statusCode || 502);
    logger.error("AI gateway error", { status, error: error.message });
    res.status(status).json({ error: error.message });
  }
});

async function verifyRequestUser(req) {
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) throw httpError(401, "Inicia sesión para usar el Coach.");
  try {
    return await getAuth().verifyIdToken(header.slice(7));
  } catch (error) {
    throw httpError(401, "La sesión no es válida o expiró.");
  }
}

async function enforceRateLimit(uid) {
  const hourBucket = Math.floor(Date.now() / 3600000);
  const ref = db.doc(`users/${uid}/aiUsage/${hourBucket}`);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const count = snapshot.exists ? Number(snapshot.data().count || 0) : 0;
    if (count >= MAX_REQUESTS_PER_HOUR) throw httpError(429, "Alcanzaste el límite temporal del Coach. Intenta nuevamente más tarde.");
    transaction.set(ref, { count: count + 1, hourBucket, updatedAt: new Date().toISOString() }, { merge: true });
  });
}

function validatePayload(body) {
  const mode = body.mode === "report" ? "report" : "chat";
  const systemInstruction = cleanText(body.systemInstruction, 1600);
  const context = cleanText(body.context, MAX_PROMPT_LENGTH);
  const prompt = cleanText(body.prompt, MAX_PROMPT_LENGTH);
  const provider = cleanText(body.provider, 30);
  const model = cleanText(body.model, 120);
  const clientApiKey = cleanText(body.clientApiKey, 600);
  const rawMessages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
  const messages = rawMessages.map(message => ({
    role: message && message.role === "assistant" ? "assistant" : "user",
    content: cleanText(message && message.content, MAX_MESSAGE_LENGTH)
  })).filter(message => message.content);
  if (mode === "report" && !prompt) throw httpError(400, "Falta el contenido del informe.");
  if (mode === "chat" && !messages.length) throw httpError(400, "La conversación está vacía.");
  if (provider && !PROVIDER_DEFAULTS[provider]) throw httpError(400, "Proveedor de IA no soportado.");
  return { mode, systemInstruction, context, prompt, messages, provider, model, clientApiKey };
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function buildSystemInstruction(mode, customInstruction) {
  const base = mode === "report"
    ? "Eres el analista de ROKA Mind Focus. Responde en español con Markdown seguro y exactamente estas secciones: ## Resumen ejecutivo, ## Hallazgos, ## Evidencia utilizada, ## Plan de acción y ## Siguientes pasos. Distingue hechos de inferencias, explica límites y usa acciones concretas. No presentes inferencias psicológicas o astrológicas como diagnósticos clínicos."
    : "Eres el Coach de ejecución de ROKA Mind Focus. Responde en español, con claridad, brevedad y una acción concreta. Evita motivación genérica y no presentes inferencias como diagnósticos clínicos.";
  return `${base}\n${customInstruction}`.slice(0, 2400);
}

function buildPrompt(payload) {
  if (payload.mode === "report") return payload.prompt;
  const conversation = payload.messages.map(message => `${message.role === "assistant" ? "COACH" : "USUARIO"}: ${message.content}`).join("\n\n");
  return `CONTEXTO AUTORIZADO POR EL USUARIO:\n${payload.context || "Sin contexto adicional."}\n\nCONVERSACIÓN:\n${conversation}\n\nResponde al último mensaje del usuario.`;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function callProvider({ provider, model, prompt, systemInstruction, clientApiKey }) {
  if (provider === "openai") {
    return callOpenAI({ model: model || PROVIDER_DEFAULTS.openai, prompt, systemInstruction, clientApiKey });
  }
  if (provider === "google") {
    return callGemini({ model: model || PROVIDER_DEFAULTS.google, prompt, systemInstruction, clientApiKey });
  }
  if (provider === "deepseek") {
    return callDeepSeek({ model: model || PROVIDER_DEFAULTS.deepseek, prompt, systemInstruction, clientApiKey });
  }
  throw new Error("Proveedor no soportado por el gateway corporativo.");
}

async function callOpenAI({ model, prompt, systemInstruction, clientApiKey }) {
  const apiKey = clientApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY no esta configurada.");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: "system", content: systemInstruction }, { role: "user", content: prompt }] })
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || "OpenAI no respondio correctamente.");
  return {
    text: data.choices?.[0]?.message?.content || "",
    usage: {
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0
    }
  };
}

async function callGemini({ model, prompt, systemInstruction, clientApiKey }) {
  const apiKey = clientApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY no esta configurada.");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system_instruction: { parts: [{ text: systemInstruction }] }, contents: [{ parts: [{ text: prompt }] }] })
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || "Gemini no respondio correctamente.");
  return {
    text: data.candidates?.[0]?.content?.parts?.[0]?.text || "",
    usage: {
      inputTokens: data.usageMetadata?.promptTokenCount || 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
      totalTokens: data.usageMetadata?.totalTokenCount || 0
    }
  };
}

async function callDeepSeek({ model, prompt, systemInstruction, clientApiKey }) {
  const apiKey = clientApiKey || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY no esta configurada.");
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: "system", content: systemInstruction }, { role: "user", content: prompt }] })
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || "DeepSeek no respondio correctamente.");
  return {
    text: data.choices?.[0]?.message?.content || "",
    usage: {
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0
    }
  };
}
