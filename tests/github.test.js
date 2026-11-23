const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');
const { parseGithubRefs } = require('../connectors/github');

const b64 = text => Buffer.from(text, 'utf8').toString('base64');

test('parseGithubRefs finds repos, files and dedupes', () => {
  const refs = parseGithubRefs('شوف https://github.com/acme/tool.git وكمان https://github.com/acme/tool/blob/main/src/a.js و https://github.com/acme/tool.git');
  assert.equal(refs.length, 2);
  assert.deepEqual(refs[0], { owner: 'acme', repo: 'tool', ref: '', path: '' });
  assert.deepEqual(refs[1], { owner: 'acme', repo: 'tool', ref: 'main', path: 'src/a.js' });
  assert.deepEqual(parseGithubRefs('بدون روابط'), []);
});

async function call(env, fetchImpl, route, body, method = 'POST') {
  const server = createServer({ logger: { warn() {} }, fetchImpl, env: { APP_PASSWORD: 'PW', KNOWLEDGE_FILE: '', ...env } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${route}`, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer PW' }, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  } finally { await new Promise(r => server.close(r)); }
}

test('chat pulls README from a GitHub link into the model prompt; token is NOT sent for non-allowlisted owners', async () => {
  const seen = [];
  const fetchImpl = async (url, options = {}) => {
    if (url.startsWith('https://api.github.com')) {
      seen.push({ url, auth: options.headers?.Authorization });
      if (url.endsWith('/repos/acme/tool')) return { ok: true, status: 200, json: async () => ({ full_name: 'acme/tool', description: 'أداة تجريبية', language: 'JavaScript', default_branch: 'main' }) };
      if (url.includes('/readme')) return { ok: true, status: 200, json: async () => ({ encoding: 'base64', content: b64('README_MARKER_XYZ') }) };
      return { ok: true, status: 200, json: async () => ([{ name: 'index.js', type: 'file' }]) };
    }
    const payload = JSON.parse(options.body);
    seen.push({ system: payload.messages[0].content });
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'تم' } }] }) };
  };
  const { data } = await call({ OLLAMA_MODEL: 'm', GITHUB_TOKEN: 'SECRET' }, fetchImpl, '/api/solve', { question: 'اشرح https://github.com/acme/tool' });
  assert.deepEqual(data.sources, ['https://github.com/acme/tool']);
  const prompt = seen.find(item => item.system).system;
  assert.ok(prompt.includes('README_MARKER_XYZ') && prompt.includes('أداة تجريبية'));
  assert.ok(seen.filter(item => item.url).every(item => item.auth === undefined), 'token must not leak to non-allowlisted owner');
});

test('allowlisted owner uses the token', async () => {
  const auths = [];
  const fetchImpl = async (url, options = {}) => {
    if (url.startsWith('https://api.github.com')) { auths.push(options.headers?.Authorization); return { ok: true, status: 200, json: async () => ({ full_name: 'acme/tool', default_branch: 'main' }) }; }
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
  };
  await call({ OLLAMA_MODEL: 'm', GITHUB_TOKEN: 'SECRET', GITHUB_ALLOWED_OWNERS: 'acme' }, fetchImpl, '/api/solve', { question: 'https://github.com/acme/tool' });
  assert.ok(auths.includes('Bearer SECRET'));
});

test('writes are blocked unless enabled, allowlisted and confirmed', async () => {
  const fetchImpl = async (url, options = {}) => ({ ok: true, status: 201, json: async () => ({ number: 7, html_url: 'https://github.com/acme/tool/issues/7' }) });
  const body = { repo: 'acme/tool', title: 'مشكلة', body: 'تفاصيل', confirm: true };
  assert.equal((await call({}, fetchImpl, '/api/connectors/github/issue', body)).data.code, 'GITHUB_WRITE_DISABLED');
  const base = { GITHUB_WRITE: '1', GITHUB_TOKEN: 'T' };
  assert.equal((await call(base, fetchImpl, '/api/connectors/github/issue', body)).data.code, 'GITHUB_OWNER_NOT_ALLOWED');
  const env = { ...base, GITHUB_ALLOWED_OWNERS: 'acme' };
  assert.equal((await call(env, fetchImpl, '/api/connectors/github/issue', { ...body, confirm: false })).data.code, 'CONFIRMATION_REQUIRED');
  const ok = await call(env, fetchImpl, '/api/connectors/github/issue', body);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.number, 7);
});
