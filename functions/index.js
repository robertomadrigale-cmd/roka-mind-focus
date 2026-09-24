const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const {
  PROVIDER_DEFAULTS,
  assertEmailAllowed,
  httpError,
  validatePayload
} = require("./lib/validate");

initializeApp();
const db = getFirestore("rokazenfull");

const MAX_REQUESTS_PER_HOUR = 30;
const ALLOWED_ORIGINS = [
  "https://roka-zen-full.web.app",
  "https://roka-zen-full.firebaseapp.com",
  "http://127.0.0.1:4173",
  "http://localhost:4173"
];

exports.ai = onRequest({
  cors: ALLOWED_ORIGINS,
  region: "us-central1",
  secrets: ["OPENAI_API_KEY", "GEMINI_API_KEY", "DEEPSEEK_API_KEY"]
}, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido." });
    return;
  }

  try {
    const user = await verifyRequestUser(req);
    assertEmailAllowed(user, process.env.AI_ALLOWED_EMAILS);
    await enforceRateLimit(user.uid);
    const payload = validatePayload(req.body || {});
    const systemInstruction = buildSystemInstruction(payload.mode, payload.systemInstruction);
    const prompt = buildPrompt(payload);
    const result = await callProvider({ provider: payload.provider, model: payload.model, prompt, systemInstruction });
    res.json({ text: result.text, usage: result.usage || {} });
  } catch (error) {
    const status = Number(error.statusCode || 502);
    logger.error("AI gateway error", { status, error: error.message, stack: error.stack });
    const safeMessage = status < 500 ? error.message : "No se pudo completar la respuesta de IA. Intenta de nuevo más tarde.";
    res.status(status).json({ error: safeMessage });
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

async function callProvider({ provider, model, prompt, systemInstruction }) {
  if (provider === "openai") return callOpenAI({ model: model || PROVIDER_DEFAULTS.openai, prompt, systemInstruction });
  if (provider === "google") return callGemini({ model: model || PROVIDER_DEFAULTS.google, prompt, systemInstruction });
  if (provider === "deepseek") return callDeepSeek({ model: model || PROVIDER_DEFAULTS.deepseek, prompt, systemInstruction });
  throw httpError(400, "Proveedor no soportado por el gateway corporativo.");
}

async function callOpenAI({ model, prompt, systemInstruction }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY no está configurada.");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: "system", content: systemInstruction }, { role: "user", content: prompt }] })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    logger.error("OpenAI provider error", { status: response.status, error: data.error?.message || data });
    throw new Error("OpenAI no respondió correctamente.");
  }
  return {
    text: data.choices?.[0]?.message?.content || "",
    usage: {
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0
    }
  };
}

async function callGemini({ model, prompt, systemInstruction }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY no está configurada.");
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ system_instruction: { parts: [{ text: systemInstruction }] }, contents: [{ parts: [{ text: prompt }] }] })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    logger.error("Gemini provider error", { status: response.status, error: data.error?.message || data });
    throw new Error("Gemini no respondió correctamente.");
  }
  return {
    text: data.candidates?.[0]?.content?.parts?.[0]?.text || "",
    usage: {
      inputTokens: data.usageMetadata?.promptTokenCount || 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
      totalTokens: data.usageMetadata?.totalTokenCount || 0
    }
  };
}

async function callDeepSeek({ model, prompt, systemInstruction }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY no está configurada.");
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: [{ role: "system", content: systemInstruction }, { role: "user", content: prompt }] })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    logger.error("DeepSeek provider error", { status: response.status, error: data.error?.message || data });
    throw new Error("DeepSeek no respondió correctamente.");
  }
  return {
    text: data.choices?.[0]?.message?.content || "",
    usage: {
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0
    }
  };
}
