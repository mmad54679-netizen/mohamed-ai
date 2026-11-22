const test = require('node:test');
const assert = require('node:assert/strict');
const { checkAssistantServer } = require('../public/preflight');

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body };
}

test('preflight calls only /api/health with the assistant bearer token and accepts configured Gemini', async () => {
  let captured;
  const health = { ok: true, mockMode: false, providers: { gemini: true, groq: false } };
  const result = await checkAssistantServer({
    baseUrl: 'https://helper.example',
    appPassword: 'TEST_ONLY_ASSISTANT_PASSWORD',
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return response(200, health);
    },
  });
  assert.equal(captured.url, 'https://helper.example/api/health');
  assert.equal(captured.options.method, 'GET');
  assert.equal(captured.options.headers.Authorization, 'Bearer TEST_ONLY_ASSISTANT_PASSWORD');
  assert.equal(captured.options.cache, 'no-store');
  assert.equal(captured.options.redirect, 'error');
  assert.equal(result.providers.gemini, true);
});

test('preflight rejects a wrong assistant password before QUREO can open', async () => {
  await assert.rejects(
    checkAssistantServer({ baseUrl: 'https://helper.example', appPassword: 'WRONG_TEST_ONLY', fetchImpl: async () => response(401, { code: 'APP_PASSWORD_REQUIRED' }) }),
    /كلمة مرور المساعد غير صحيحة/,
  );
});

test('preflight rejects missing password and invalid URL without making a request', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return response(200, {}); };
  await assert.rejects(checkAssistantServer({ baseUrl: 'https://helper.example', appPassword: '', fetchImpl }), /كلمة مرور المساعد/);
  await assert.rejects(checkAssistantServer({ baseUrl: 'http://helper.example', appPassword: 'TEST_ONLY', fetchImpl }), /HTTPS/);
  await assert.rejects(checkAssistantServer({ baseUrl: 'https://helper.example/api', appPassword: 'TEST_ONLY', fetchImpl }), /HTTPS/);
  assert.equal(calls, 0);
});

test('preflight rejects mock or unconfigured providers instead of starting a dead-end session', async () => {
  await assert.rejects(
    checkAssistantServer({ baseUrl: 'https://helper.example', appPassword: 'TEST_ONLY', fetchImpl: async () => response(200, { ok: true, mockMode: true, providers: { gemini: true } }) }),
    /وضع الاختبار/,
  );
  await assert.rejects(
    checkAssistantServer({ baseUrl: 'https://helper.example', appPassword: 'TEST_ONLY', fetchImpl: async () => response(200, { ok: true, mockMode: false, providers: { gemini: false } }) }),
    /Gemini غير مهيّأ/,
  );
});

test('preflight gives a bounded timeout error without leaking credentials', async () => {
  const fetchImpl = async () => { const error = new Error('abort'); error.name = 'AbortError'; throw error; };
  await assert.rejects(
    checkAssistantServer({ baseUrl: 'https://helper.example', appPassword: 'DO_NOT_LEAK_TEST', fetchImpl }),
    error => error.message.includes('انتهت مهلة') && !error.message.includes('DO_NOT_LEAK_TEST'),
  );
});
