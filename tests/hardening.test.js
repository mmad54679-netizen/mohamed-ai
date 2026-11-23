const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');
const PASSWORD = 'TEST_ONLY_ASSISTANT_PASSWORD';

async function withServer(env, run) {
  const server = createServer({ logger: { warn() {} }, env: { APP_PASSWORD: PASSWORD, MOCK_MODE: '1', ...env } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  }
}

const post = (base, auth) => fetch(`${base}/api/solve`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
  body: JSON.stringify({ question: 'TEST_ONLY_PLACEHOLDER' }),
});

test('wrong, empty and prefix-only passwords are rejected; correct one accepted', async () => {
  await withServer({}, async base => {
    assert.equal((await post(base, '')).status, 401);
    assert.equal((await post(base, 'Bearer wrong')).status, 401);
    assert.equal((await post(base, `Bearer ${PASSWORD.slice(0, -1)}`)).status, 401);
    assert.equal((await post(base, `Bearer ${PASSWORD}`)).status, 200);
  });
});

test('/api/solve is rate limited per IP', async () => {
  await withServer({ RATE_LIMIT_PER_MIN: '3' }, async base => {
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await post(base, `Bearer ${PASSWORD}`)).status);
    assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  });
});
