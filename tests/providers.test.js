const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');
const { validateBaseUrl } = require('../providers/openai-compat');

const ok = text => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: text } }] }) });
const fail = status => ({ ok: false, status, json: async () => ({}) });

async function run(env, fetchImpl, body = { question: 'TEST_ONLY_PLACEHOLDER' }) {
  const server = createServer({ logger: { warn() {} }, fetchImpl, env: { APP_PASSWORD: 'PW', KNOWLEDGE_FILE: '', ...env } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/solve`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer PW' }, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  } finally { await new Promise(r => server.close(r)); }
}

test('Ollama local model is used first and the answer comes back', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url, body: JSON.parse(options.body), headers: options.headers }); return ok('local answer'); };
  const { data } = await run({ OLLAMA_MODEL: 'qwen3:8b', GEMINI_API_KEY: 'K' }, fetchImpl);
  assert.equal(data.provider, 'ollama');
  assert.equal(data.answer, 'local answer');
  assert.equal(calls[0].url, 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(calls[0].body.model, 'qwen3:8b');
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(calls[0].body.messages[0].role, 'system');
});

test('chain falls through failing providers in PROVIDER_ORDER', async () => {
  const fetchImpl = async url => {
    if (url.includes('openrouter.ai')) return fail(429);
    if (url.includes('cerebras.ai')) return ok('cerebras answer');
    return fail(500);
  };
  const { data } = await run({ OPENROUTER_API_KEY: 'A', CEREBRAS_API_KEY: 'B', PROVIDER_ORDER: 'openrouter,cerebras' }, fetchImpl);
  assert.equal(data.provider, 'cerebras');
  assert.deepEqual(data.attemptedProviders, ['openrouter', 'cerebras']);
  assert.equal(data.fallbackUsed, true);
});

test('custom providers from CUSTOM_PROVIDERS work and image requests skip text-only providers', async () => {
  const custom = JSON.stringify([
    { name: 'texty', baseUrl: 'https://example.invalid/v1', model: 'm1', apiKeyEnv: 'TEXTY_KEY' },
    { name: 'visiony', baseUrl: 'https://vision.invalid/v1', model: 'm2', vision: true },
  ]);
  const seen = [];
  const fetchImpl = async url => { seen.push(url); return ok('vision answer'); };
  const image = 'data:image/png;base64,iVBORw0KGgo=';
  const { data } = await run({ CUSTOM_PROVIDERS: custom, TEXTY_KEY: 'x' }, fetchImpl, { question: 'ما هذا؟', image });
  assert.equal(data.provider, 'visiony');
  assert.deepEqual(seen, ['https://vision.invalid/v1/chat/completions']);
});

test('insecure or malformed provider URLs are rejected at startup', () => {
  assert.throws(() => validateBaseUrl('x', 'http://example.com/v1'), /https/);
  assert.throws(() => validateBaseUrl('x', 'not a url'), /valid URL/);
  assert.equal(validateBaseUrl('x', 'http://localhost:11434/v1/'), 'http://localhost:11434/v1');
  assert.throws(() => createServer({ env: { APP_PASSWORD: 'PW', CUSTOM_PROVIDERS: '{bad' } }), /valid JSON/);
});
