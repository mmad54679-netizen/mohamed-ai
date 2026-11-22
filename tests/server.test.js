const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');
const TEST_APP_PASSWORD = 'TEST_ONLY_ASSISTANT_PASSWORD';

function authHeaders(headers = {}) {
  return { ...headers, Authorization: `Bearer ${TEST_APP_PASSWORD}` };
}

async function withServer(options, run) {
  const server = createServer({ logger: { warn() {} }, ...options, env: { APP_PASSWORD: TEST_APP_PASSWORD, ...(options.env || {}) } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

const testBody = { question: 'TEST_ONLY_PLACEHOLDER; no real lesson or account data' };

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('Gemini quota/error triggers exactly one sequential Groq fallback', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('generativelanguage.googleapis.com')) return jsonResponse(429, { error: { message: 'stubbed quota response' } });
    return jsonResponse(200, { choices: [{ message: { content: 'stubbed fallback answer' } }] });
  };
  await withServer({ env: { GEMINI_API_KEY: 'TEST_GEMINI_KEY', GROQ_API_KEY: 'TEST_GROQ_KEY', ENABLE_GROQ_FALLBACK: '1', PROVIDER_TIMEOUT_MS: '5000' }, fetchImpl }, async base => {
    const response = await fetch(`${base}/api/solve`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(testBody) });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.provider, 'groq');
    assert.equal(result.fallbackUsed, true);
    assert.deepEqual(result.attemptedProviders, ['gemini', 'groq']);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /gemini-3\.5-flash-lite/);
    assert.equal(calls[0].options.headers['x-goog-api-key'], 'TEST_GEMINI_KEY');
    assert.match(calls[1].url, /api\.groq\.com/);
    assert.equal(calls[1].options.headers.Authorization, 'Bearer TEST_GROQ_KEY');
  });
});

test('successful Gemini response does not call Groq', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse(200, { candidates: [{ content: { parts: [{ text: 'stubbed primary answer' }] } }] });
  };
  await withServer({ env: { GEMINI_API_KEY: 'TEST_GEMINI_KEY', GROQ_API_KEY: 'TEST_GROQ_KEY' }, fetchImpl }, async base => {
    const response = await fetch(`${base}/api/solve`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(testBody) });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.provider, 'gemini');
    assert.equal(result.fallbackUsed, false);
    assert.equal(calls, 1);
  });
});

test('mock mode returns a local preview and never invokes a provider', async () => {
  let calls = 0;
  await withServer({ env: { MOCK_MODE: '1' }, fetchImpl: async () => { calls += 1; throw new Error('should not be called'); } }, async base => {
    const response = await fetch(`${base}/api/solve`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(testBody) });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.provider, 'mock');
    assert.equal(calls, 0);
  });
});

test('no configured provider returns setup guidance without making a network call', async () => {
  let calls = 0;
  await withServer({ env: {}, fetchImpl: async () => { calls += 1; throw new Error('should not be called'); } }, async base => {
    const response = await fetch(`${base}/api/solve`, { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(testBody) });
    const result = await response.json();
    assert.equal(response.status, 503);
    assert.equal(result.code, 'NO_CLOUD_PROVIDERS');
    assert.equal(calls, 0);
  });
});

test('health preflight rejects a wrong assistant password and reports configured provider state after auth', async () => {
  await withServer({ env: { APP_PASSWORD: 'TEST_ONLY_ASSISTANT_PASSWORD', GEMINI_API_KEY: 'TEST_ONLY_GEMINI_KEY' } }, async base => {
    const wrong = await fetch(`${base}/api/health`, { headers: { Authorization: 'Bearer WRONG_TEST_ONLY' } });
    assert.equal(wrong.status, 401);
    assert.equal((await wrong.json()).code, 'APP_PASSWORD_REQUIRED');

    const authorized = await fetch(`${base}/api/health`, { headers: { Authorization: 'Bearer TEST_ONLY_ASSISTANT_PASSWORD' } });
    assert.equal(authorized.status, 200);
    const body = await authorized.json();
    assert.equal(body.passwordRequired, true);
    assert.equal(body.providers.gemini, true);
    assert.equal(body.providers.groq, false);
  });
});

test('Android app CORS is limited to its bundled origin', async () => {
  await withServer({ env: { MOCK_MODE: '1' } }, async base => {
    const allowed = await fetch(`${base}/api/solve`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://appassets.androidplatform.net',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://appassets.androidplatform.net');

    const denied = await fetch(`${base}/api/solve`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://untrusted.example', 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  });
});

test('production server refuses to start without APP_PASSWORD', () => {
  assert.throws(() => createServer({ env: { GEMINI_API_KEY: 'TEST_ONLY_KEY' } }), /APP_PASSWORD is required/);
});

test('static pages receive a restrictive CSP and anti-framing headers', async () => {
  await withServer({ env: { MOCK_MODE: '1' } }, async base => {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    const csp = response.headers.get('content-security-policy');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.match(await response.text(), /http-equiv="Content-Security-Policy"/);
  });
});
