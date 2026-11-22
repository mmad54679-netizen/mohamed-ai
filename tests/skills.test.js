const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');
const { skillStatus } = require('../skills/catalog');

const PASSWORD = 'TEST_ONLY_ASSISTANT_PASSWORD';

async function withServer(options, run) {
  const server = createServer({ logger: { warn() {} }, ...options, env: { APP_PASSWORD: PASSWORD, ...(options.env || {}) } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base); } finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test('skill catalog exposes built-in, optional, and connector-dependent states', () => {
  const skills = skillStatus({ GEMINI_API_KEY: 'TEST_ONLY_KEY' }, [
    { id: 'github', available: true },
    { id: 'google_drive', available: false },
    { id: 'gmail', available: false },
    { id: 'calendar', available: false },
    { id: 'web_search', available: false },
  ]);
  assert.equal(skills.find(item => item.id === 'conversation').state, 'available');
  assert.equal(skills.find(item => item.id === 'github_read').state, 'configured');
  assert.equal(skills.find(item => item.id === 'drive_read').state, 'needs_setup');
  assert.equal(skills.find(item => item.id === 'local_inference').state, 'optional');
  assert.equal(skills.find(item => item.id === 'image_analysis').state, 'available');
});

test('skills endpoint requires app password and returns the complete safe catalog', async () => {
  await withServer({ env: { MOCK_MODE: '1' } }, async base => {
    const denied = await fetch(`${base}/api/skills`);
    assert.equal(denied.status, 401);
    const response = await fetch(`${base}/api/skills`, { headers: { Authorization: `Bearer ${PASSWORD}` } });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(result.skills));
    assert.ok(result.skills.some(item => item.id === 'github_read'));
    assert.ok(result.skills.every(item => item.readOnly === true || item.id === 'qureo_safe' || item.id === 'export_share'));
  });
});
