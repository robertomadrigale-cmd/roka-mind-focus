const GATEWAY_ENDPOINT = '/api/ai';

export async function callAIGateway({
  mode = 'chat',
  prompt = '',
  messages = [],
  context = '',
  systemInstruction = '',
  authToken = '',
  provider = '',
  model = '',
  clientApiKey = ''
}) {
  const payload = { mode, prompt, messages, context, systemInstruction, provider, model, clientApiKey };
  const gatewayPayload = { mode, prompt, messages, context, systemInstruction, provider, model };
  // Con llave propia se llama directo al proveedor desde el navegador (OpenAI, Gemini y DeepSeek permiten CORS).
  if (clientApiKey && ['openai', 'google', 'deepseek'].includes(provider)) {
    return callDirectProvider(payload);
  }

  try {
    const response = await fetch(GATEWAY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
      body: JSON.stringify(gatewayPayload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No se pudo conectar con el gateway de IA.');
    if (!String(data.text || '').trim()) throw new Error('El Coach devolvió una respuesta vacía. Intenta nuevamente.');
    return { text: String(data.text || ''), usage: data.usage || null, route: 'gateway /api/ai' };
  } catch (error) {
    if (!clientApiKey) {
      throw new Error('Falta API key o backend activo. Ve a Perfil > Conexión IA, pega tu llave y presiona Guardar llave.');
    }
    return callDirectProvider(payload);
  }
}

function buildConversationPrompt({ mode, prompt, messages, context }) {
  if (mode === 'report') return prompt;
  const conversation = messages
    .map(message => `${message.role === 'assistant' ? 'COACH' : 'USUARIO'}: ${message.content}`)
    .join('\n\n');
  return `CONTEXTO AUTORIZADO:\n${context || 'Sin contexto adicional.'}\n\nCONVERSACIÓN:\n${conversation}\n\nResponde al último mensaje del usuario.`;
}

async function callDirectProvider(payload) {
  const provider = payload.provider || 'openai';
  if (provider === 'google') return callDirectGemini(payload);
  if (provider === 'deepseek') return callDirectDeepSeek(payload);
  return callDirectOpenAI(payload);
}

async function callDirectOpenAI(payload) {
  const input = buildConversationPrompt(payload);
  let response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${payload.clientApiKey}`
      },
      body: JSON.stringify({
        model: payload.model || 'gpt-4o',
        instructions: payload.systemInstruction || 'Responde en español con claridad.',
        input
      })
    });
  } catch (error) {
    throw new Error('No se pudo conectar con OpenAI. Revisa tu conexión a internet e intenta de nuevo.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error?.message || 'OpenAI no respondió correctamente.');
  const text = data.output_text || (data.output || [])
    .flatMap(item => item.content || [])
    .map(part => part.text || '')
    .join('\n')
    .trim();
  if (!text) throw new Error('OpenAI devolvió una respuesta vacía.');
  return {
    text,
    route: 'directo OpenAI',
    usage: {
      inputTokens: data.usage?.input_tokens || 0,
      outputTokens: data.usage?.output_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0
    }
  };
}

async function callDirectGemini(payload) {
  const input = buildConversationPrompt(payload);
  const model = payload.model || 'gemini-2.5-flash';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': payload.clientApiKey },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: payload.systemInstruction || 'Responde en español con claridad.' }] },
      contents: [{ parts: [{ text: input }] }]
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error?.message || 'Gemini no respondió correctamente.');
  const text = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('\n').trim() || '';
  if (!text) throw new Error('Gemini devolvió una respuesta vacía.');
  return {
    text,
    route: 'directo Gemini',
    usage: {
      inputTokens: data.usageMetadata?.promptTokenCount || 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount || 0,
      totalTokens: data.usageMetadata?.totalTokenCount || 0
    }
  };
}

async function callDirectDeepSeek(payload) {
  const input = buildConversationPrompt(payload);
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${payload.clientApiKey}`
    },
    body: JSON.stringify({
      model: payload.model || 'deepseek-chat',
      messages: [
        { role: 'system', content: payload.systemInstruction || 'Responde en español con claridad.' },
        { role: 'user', content: input }
      ]
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error?.message || 'DeepSeek no respondió correctamente.');
  const text = data.choices?.[0]?.message?.content || '';
  if (!String(text || '').trim()) throw new Error('DeepSeek devolvió una respuesta vacía.');
  return {
    text,
    route: 'directo DeepSeek',
    usage: {
      inputTokens: data.usage?.prompt_tokens || 0,
      outputTokens: data.usage?.completion_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0
    }
  };
}
