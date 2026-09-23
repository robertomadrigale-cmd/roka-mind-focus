"use strict";

const PROVIDER_DEFAULTS = {
  openai: "gpt-4o",
  google: "gemini-2.5-flash",
  deepseek: "deepseek-chat"
};

const ALLOWED_MODELS = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"],
  google: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-flash"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"]
};

const MAX_PROMPT_LENGTH = 12000;
const MAX_MESSAGE_LENGTH = 4000;

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function parseAllowedEmails(value) {
  return String(value || "")
    .split(",")
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
}

function assertEmailAllowed(user, allowedEmailsValue) {
  const allowed = parseAllowedEmails(allowedEmailsValue);
  if (!allowed.length) return true;
  const email = String(user && user.email || "").toLowerCase();
  if (!email || user.email_verified !== true || !allowed.includes(email)) {
    throw httpError(403, "Tu cuenta no tiene acceso a la IA del servidor.");
  }
  return true;
}

function validatePayload(body, env = process.env) {
  const mode = body.mode === "report" ? "report" : "chat";
  const systemInstruction = cleanText(body.systemInstruction, 1600);
  const context = cleanText(body.context, MAX_PROMPT_LENGTH);
  const prompt = cleanText(body.prompt, MAX_PROMPT_LENGTH);
  const provider = cleanText(body.provider || env.AI_PROVIDER || "openai", 30);
  const model = cleanText(body.model || env.AI_MODEL || PROVIDER_DEFAULTS[provider], 120);
  const rawMessages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
  const messages = rawMessages.map(message => ({
    role: message && message.role === "assistant" ? "assistant" : "user",
    content: cleanText(message && message.content, MAX_MESSAGE_LENGTH)
  })).filter(message => message.content);

  if (mode === "report" && !prompt) throw httpError(400, "Falta el contenido del informe.");
  if (mode === "chat" && !messages.length) throw httpError(400, "La conversación está vacía.");
  if (!PROVIDER_DEFAULTS[provider]) throw httpError(400, "Proveedor de IA no soportado.");
  if (!ALLOWED_MODELS[provider].includes(model)) throw httpError(400, "Modelo de IA no permitido.");

  return { mode, systemInstruction, context, prompt, messages, provider, model };
}

module.exports = {
  ALLOWED_MODELS,
  PROVIDER_DEFAULTS,
  assertEmailAllowed,
  cleanText,
  httpError,
  parseAllowedEmails,
  validatePayload
};
