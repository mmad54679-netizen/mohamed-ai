const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../server');

const PASSWORD = 'TEST_ONLY_ASSISTANT_PASSWORD';
const CREW_TOKEN = 'TEST_ONLY_CREW_TOKEN';
const META_TOKEN = 'TEST_ONLY_META_TOKEN';
const PROJECT_ID = '0123456789abcdef0123456789abcdef';
const ZIP = Buffer.from('PK\x03\x04TEST_ONLY_ZIP');

function serviceResponse(status, payload) {
  const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => name.toLowerCase() === 'content-length' ? String(bytes.length) : null },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}
async function withServer(options, run) {
  const server = createServer({ logger: { warn() {} }, ...options, env: { APP_PASSWORD: PASSWORD, ...(options.env || {}) } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
const headers = { Authorization: `Bearer ${PASSWORD}`, 'Content-Type': 'application/json' };
const crewEnv = { TEAM_SERVICE_URL: 'http://127.0.0.1:8081', TEAM_SERVICE_TOKEN: CREW_TOKEN, TEAM_SERVICE_ALLOW_HTTP: '1' };
const metaEnv = { METAGPT_SERVICE_URL: 'http://127.0.0.1:8082', METAGPT_SERVICE_TOKEN: META_TOKEN, METAGPT_SERVICE_ALLOW_HTTP: '1' };

test('team endpoint fails closed when not configured and rejects unauthenticated requests', async () => {
  let calls = 0;
  await withServer({ fetchImpl: async () => { calls++; throw new Error('unexpected'); } }, async base => {
    const noAuth = await fetch(`${base}/api/team`, { method: 'POST', body: JSON.stringify({ question: 'Build an app' }) });
    assert.equal(noAuth.status, 401);
    const notConfigured = await fetch(`${base}/api/team`, { method: 'POST', headers, body: JSON.stringify({ question: 'Build an app' }) });
    assert.equal(notConfigured.status, 503);
    assert.equal((await notConfigured.json()).code, 'TEAM_NOT_CONFIGURED');
    assert.equal(calls, 0);
  });
});

test('team mock mode returns a local preview without contacting either service', async () => {
  let calls = 0;
  await withServer({ env: { MOCK_MODE: '1', ...crewEnv, ...metaEnv }, fetchImpl: async () => { calls++; throw new Error('unexpected'); } }, async base => {
    const r = await fetch(`${base}/api/team`, { method: 'POST', headers, body: JSON.stringify({ question: 'Build a secure app', buildProject: true }) });
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.provider, 'mock');
    assert.equal(body.project, null);
    assert.match(body.answer, /لم تُنشأ أي ملفات/);
    assert.equal(calls, 0);
  });
});

test('team planning forwards only a bounded prompt with the private service bearer token', async () => {
  let request;
  await withServer({ env: crewEnv, fetchImpl: async (url, options) => {
    request = { url: String(url), options };
    return serviceResponse(200, { output: 'خطة مختصرة', team: [{ id: 'leader', display_name: 'ليث', role: 'Coordinator' }] });
  } }, async base => {
    const r = await fetch(`${base}/api/team`, { method: 'POST', headers, body: JSON.stringify({ question: 'Build a habit app' }) });
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.provider, 'app-team');
    assert.match(body.answer, /ليث/);
    assert.match(body.answer, /خطة مختصرة/);
    assert.equal(request.url, 'http://127.0.0.1:8081/run');
    assert.equal(request.options.headers.Authorization, `Bearer ${CREW_TOKEN}`);
    assert.deepEqual(JSON.parse(request.options.body), { prompt: 'Build a habit app' });
  });
});

test('team build calls MetaGPT only after explicit buildProject and returns a safe artifact ID', async () => {
  const requests = [];
  await withServer({ env: { ...crewEnv, ...metaEnv }, fetchImpl: async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('/run')) return serviceResponse(200, { output: 'خطة بناء', team: [{ id: 'leader', display_name: 'ليث', role: 'Coordinator' }] });
    if (String(url).endsWith('/build')) return serviceResponse(200, { projectId: PROJECT_ID, manifest: [{ path: 'README.md', size_bytes: 25 }] });
    if (String(url).endsWith(`/artifact/${PROJECT_ID}`)) return serviceResponse(200, ZIP);
    throw new Error('unexpected service URL');
  } }, async base => {
    const r = await fetch(`${base}/api/team`, { method: 'POST', headers, body: JSON.stringify({ question: 'Create a simple app', buildProject: true }) });
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.equal(body.project.id, PROJECT_ID);
    assert.equal(body.project.manifest[0].path, 'README.md');
    assert.match(body.answer, /لم تُدمج أو تُنشر/);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].url, 'http://127.0.0.1:8082/build');
    assert.equal(requests[1].options.headers.Authorization, `Bearer ${META_TOKEN}`);
    const metaIdea = JSON.parse(requests[1].options.body).idea;
    assert.match(metaIdea, /Create a simple app/);
    assert.match(metaIdea, /خلاصة خطة فريق CrewAI:[\s\S]*خطة بناء/);

    const archive = await fetch(`${base}/api/team/artifacts/${PROJECT_ID}`, { headers: { Authorization: `Bearer ${PASSWORD}` } });
    assert.equal(archive.status, 200);
    assert.equal(archive.headers.get('content-type'), 'application/zip');
    assert.equal(archive.headers.get('content-disposition'), `attachment; filename="${PROJECT_ID}.zip"`);
    assert.deepEqual(Buffer.from(await archive.arrayBuffer()), ZIP);
    assert.equal(requests[2].url, `http://127.0.0.1:8082/artifact/${PROJECT_ID}`);
    assert.equal(requests[2].options.headers.Authorization, `Bearer ${META_TOKEN}`);
  });
});

test('team build configuration and input validation prevent unwanted model calls', async () => {
  let calls = 0;
  await withServer({ env: crewEnv, fetchImpl: async () => { calls++; return serviceResponse(200, { output: 'should not run' }); } }, async base => {
    const missingMeta = await fetch(`${base}/api/team`, { method: 'POST', headers, body: JSON.stringify({ question: 'Build now', buildProject: true }) });
    assert.equal(missingMeta.status, 503);
    assert.equal((await missingMeta.json()).code, 'METAGPT_NOT_CONFIGURED');
    const image = await fetch(`${base}/api/team`, { method: 'POST', headers, body: JSON.stringify({ question: 'Build now', image: 'data:image/png;base64,AA==' }) });
    assert.equal(image.status, 415);
    const oversized = await fetch(`${base}/api/team`, { method: 'POST', headers, body: JSON.stringify({ question: 'x'.repeat(12001) }) });
    assert.equal(oversized.status, 413);
    assert.equal(calls, 0);
  });
  await withServer({ env: { ...crewEnv, ...metaEnv }, fetchImpl: async () => { calls++; return serviceResponse(200, { output: 'should not run' }); } }, async base => {
    const oversizedBuild = await fetch(`${base}/api/team`, { method: 'POST', headers, body: JSON.stringify({ question: 'x'.repeat(8001), buildProject: true }) });
    assert.equal(oversizedBuild.status, 413);
    assert.equal((await oversizedBuild.json()).code, 'METAGPT_IDEA_TOO_LONG');
    assert.equal(calls, 0);
  });
  await withServer({ env: { ...crewEnv, TEAM_SERVICE_URL: 'http://public.example:8081', TEAM_SERVICE_ALLOW_HTTP: '0' }, fetchImpl: async () => { calls++; } }, async base => {
    const r = await fetch(`${base}/api/team`, { method: 'POST', headers, body: JSON.stringify({ question: 'Build now' }) });
    assert.equal(r.status, 503);
    assert.equal(calls, 0);
  });
});

test('artifact download requires app authentication and validates project ID', async () => {
  let calls = 0;
  await withServer({ env: metaEnv, fetchImpl: async () => { calls++; return serviceResponse(200, ZIP); } }, async base => {
    assert.equal((await fetch(`${base}/api/team/artifacts/${PROJECT_ID}`)).status, 401);
    assert.equal((await fetch(`${base}/api/team/artifacts/not-an-id`, { headers: { Authorization: `Bearer ${PASSWORD}` } })).status, 404);
    assert.equal(calls, 0);
  });
});
