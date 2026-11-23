// مزوّدو الدردشة مع دعم استدعاء الأدوات (صيغة OpenAI). كلهم مجانيون أو محليون حسب إعدادك.
const { PRESETS, validateBaseUrl, orderProviders } = require('../providers/openai-compat.js');

async function chatCompletion({ fetchImpl, baseUrl, apiKey, model, messages, tools, timeoutMs = 90000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, tools, tool_choice: 'auto', temperature: 0.2, max_tokens: 4096 }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`HTTP ${response.status}${body?.error?.message ? `: ${String(body.error.message).slice(0, 120)}` : ''}`);
    const message = body?.choices?.[0]?.message;
    if (!message) throw new Error('رد فارغ');
    return message;
  } finally { clearTimeout(timer); }
}

function buildChatProviders(env = process.env, fetchImpl = globalThis.fetch) {
  const list = [];
  const add = (name, baseUrl, apiKey, model) => list.push({
    name, model,
    chat: ({ messages, tools }) => chatCompletion({ fetchImpl, baseUrl: validateBaseUrl(name, baseUrl), apiKey, model, messages, tools }),
  });
  for (const preset of PRESETS) {
    const key = preset.keyEnv ? env[preset.keyEnv] : '';
    const model = env[preset.modelEnv] || preset.defaultModel;
    if (!(preset.keyEnv ? key : env[preset.needsEnable]) || !model) continue;
    add(preset.name, env[preset.baseEnv] || preset.defaultBase, key, model);
  }
  if (env.GROQ_API_KEY && env.GROQ_MODEL) add('groq', 'https://api.groq.com/openai/v1', env.GROQ_API_KEY, env.GROQ_MODEL);
  if (env.GEMINI_API_KEY && env.GEMINI_MODEL) add('gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', env.GEMINI_API_KEY, env.GEMINI_MODEL);
  if (env.CUSTOM_PROVIDERS) {
    for (const item of JSON.parse(env.CUSTOM_PROVIDERS).slice(0, 10)) {
      add(String(item.name), String(item.baseUrl), item.apiKeyEnv ? env[item.apiKeyEnv] : '', String(item.model));
    }
  }
  return orderProviders(list, env.PROVIDER_ORDER);
}

module.exports = { buildChatProviders, chatCompletion };
