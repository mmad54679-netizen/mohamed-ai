const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');
const PASSWORD = 'TEST_ONLY_ASSISTANT_PASSWORD';
const TOKEN = 'TEST_ONLY_OPENMANUS_BRIDGE_TOKEN';
function response(status, body) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }
async function withServer(options, run) {
  const server = createServer({ logger: { warn() {} }, ...options, env: { APP_PASSWORD: PASSWORD, ...(options.env || {}) } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
}
const headers = { Authorization: `Bearer ${PASSWORD}`, 'Content-Type': 'application/json' };
test('OpenManus is unavailable unless configured and does not call arbitrary URLs', async () => {
  let called = false;
  await withServer({ fetchImpl: async () => { called = true; throw new Error('unexpected'); } }, async base => {
    const r = await fetch(`${base}/api/openmanus`, { method: 'POST', headers, body: JSON.stringify({ question: 'hello' }) });
    assert.equal(r.status, 503);
    assert.equal((await r.json()).code, 'OPENMANUS_NOT_CONFIGURED');
    assert.equal(called, false);
  });
});
test('OpenManus proxy sends bounded prompt only with private bearer and returns answer', async () => {
  let request;
  await withServer({ env: { OPENMANUS_URL: 'http://127.0.0.1:8091', OPENMANUS_TOKEN: TOKEN }, fetchImpl: async (url, options) => {
    request = { url: String(url), options };
    return response(200, { answer: 'إجابة تجريبية' });
  } }, async base => {
    const r = await fetch(`${base}/api/openmanus`, { method: 'POST', headers, body: JSON.stringify({ question: 'TEST_ONLY_PROMPT' }) });
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.provider, 'openmanus');
    assert.equal(body.answer, 'إجابة تجريبية');
    assert.equal(request.url, 'http://127.0.0.1:8091/run');
    assert.equal(request.options.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(JSON.parse(request.options.body).prompt, 'TEST_ONLY_PROMPT');
  });
});
test('OpenManus rejects unauthenticated, oversized, image, and insecure remote calls', async () => {
  let calls = 0;
  const env = { OPENMANUS_URL: 'http://127.0.0.1:8091', OPENMANUS_TOKEN: TOKEN };
  await withServer({ env, fetchImpl: async () => { calls++; return response(200, { answer: 'x' }); } }, async base => {
    assert.equal((await fetch(`${base}/api/openmanus`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"question":"hi"}' })).status, 401);
    assert.equal((await fetch(`${base}/api/openmanus`, { method: 'POST', headers, body: JSON.stringify({ question: 'hi', image: 'data:image/png;base64,AA==' }) })).status, 415);
    assert.equal((await fetch(`${base}/api/openmanus`, { method: 'POST', headers, body: JSON.stringify({ question: 'x'.repeat(12001) }) })).status, 413);
    assert.equal(calls, 0);
  });
  await withServer({ env: { OPENMANUS_URL: 'http://external.invalid', OPENMANUS_TOKEN: TOKEN }, fetchImpl: async () => { calls++; } }, async base => {
    const r = await fetch(`${base}/api/openmanus`, { method: 'POST', headers, body: JSON.stringify({ question: 'hello' }) });
    assert.equal(r.status, 503);
    assert.equal(calls, 0);
  });
});
