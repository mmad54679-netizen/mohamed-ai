// مزوّدون يدعمون صيغة OpenAI (Ollama وOpenRouter وCerebras وGroq وأي خادم مخصص).
// يضيف تعدد المزوّدين دون تغيير باقي الخادم: كل مزوّد يُرجع { name, model, run }.

const PRESETS = [
  { name: 'ollama', keyEnv: null, baseEnv: 'OLLAMA_BASE_URL', defaultBase: 'http://127.0.0.1:11434/v1', modelEnv: 'OLLAMA_MODEL', defaultModel: '', needsEnable: 'OLLAMA_MODEL', vision: false },
  { name: 'openrouter', keyEnv: 'OPENROUTER_API_KEY', defaultBase: 'https://openrouter.ai/api/v1', modelEnv: 'OPENROUTER_MODEL', defaultModel: 'openrouter/free', vision: false },
  { name: 'cerebras', keyEnv: 'CEREBRAS_API_KEY', defaultBase: 'https://api.cerebras.ai/v1', modelEnv: 'CEREBRAS_MODEL', defaultModel: 'gpt-oss-120b', vision: false },
];

function validateBaseUrl(name, value) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`Provider ${name}: baseUrl is not a valid URL.`); }
  const local = ['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error(`Provider ${name}: baseUrl must be https (http is allowed only for localhost).`);
  }
  return value.replace(/\/+$/, '');
}

async function callOpenAICompat({ fetchWithTimeout, parseResponse, fetchImpl, name, baseUrl, apiKey, model, vision, question, image, timeoutMs, systemPrompt, maxOutputTokens = 1200, ProviderError }) {
  if (image && !vision) throw new ProviderError(name, 415); // لا يدعم الصور، ننتقل للمزوّد التالي
  const userContent = [{ type: 'text', text: question || 'اشرح ما يظهر في الصورة المرفقة.' }];
  if (image) userContent.push({ type: 'image_url', image_url: { url: image } });
  const response = await fetchWithTimeout(fetchImpl, `${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: maxOutputTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: vision || image ? userContent : userContent[0].text },
      ],
    }),
  }, name, timeoutMs);
  return parseResponse(response, name);
}

function buildOpenAICompatProviders({ env, fetchImpl, timeoutMs, deps }) {
  const list = [];
  const make = ({ name, baseUrl, apiKey, model, vision }) => ({
    name, model,
    run: input => callOpenAICompat({ ...deps, ...input, fetchImpl, name, baseUrl, apiKey, model, vision, timeoutMs }),
  });

  for (const preset of PRESETS) {
    const key = preset.keyEnv ? env[preset.keyEnv] : '';
    const model = env[preset.modelEnv] || preset.defaultModel;
    const enabled = preset.keyEnv ? Boolean(key) : Boolean(env[preset.needsEnable]);
    if (!enabled || !model) continue;
    const baseUrl = validateBaseUrl(preset.name, env[preset.baseEnv] || preset.defaultBase);
    list.push(make({ name: preset.name, baseUrl, apiKey: key, model, vision: env[`${preset.name.toUpperCase()}_VISION`] === '1' }));
  }

  if (env.CUSTOM_PROVIDERS) {
    let parsed;
    try { parsed = JSON.parse(env.CUSTOM_PROVIDERS); } catch { throw new Error('CUSTOM_PROVIDERS must be valid JSON.'); }
    if (!Array.isArray(parsed)) throw new Error('CUSTOM_PROVIDERS must be a JSON array.');
    for (const item of parsed.slice(0, 10)) {
      const name = String(item.name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30);
      if (!name || !item.model || !item.baseUrl) throw new Error('Each custom provider needs name, baseUrl and model.');
      if (list.some(p => p.name === name)) throw new Error(`Duplicate provider name: ${name}`);
      const apiKey = item.apiKeyEnv ? env[String(item.apiKeyEnv)] || '' : '';
      list.push(make({ name, baseUrl: validateBaseUrl(name, String(item.baseUrl)), apiKey, model: String(item.model), vision: item.vision === true }));
    }
  }
  return list;
}

// ترتيب المزوّدين: PROVIDER_ORDER (مفصولة بفواصل)، وما لم يُذكر يأتي بعدها بترتيبه الأصلي.
function orderProviders(providers, orderEnv) {
  const wanted = String(orderEnv || 'ollama,gemini,groq,openrouter,cerebras').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const byName = new Map(providers.map(p => [p.name, p]));
  const ordered = [];
  for (const name of wanted) if (byName.has(name)) { ordered.push(byName.get(name)); byName.delete(name); }
  return [...ordered, ...byName.values()];
}

module.exports = { buildOpenAICompatProviders, orderProviders, validateBaseUrl, PRESETS };
