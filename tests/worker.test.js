import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.mjs';

const appOrigin = 'https://appassets.androidplatform.net';
const password = 'test-only-password';
const makeRequest = (path, { method = 'GET', body, auth, origin } = {}) => new Request(`https://worker.test${path}`, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(auth ? { Authorization: auth } : {}), ...(origin ? { Origin: origin } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const testSnapshot = { track: 'Java', snapshot: { url: 'https://me-portal.qureo.education/lesson', text: 'SYNTHETIC TEST ONLY', buttons: [], fields: [] } };

function withCrossCheck(action) {
  if (!['fill', 'select'].includes(action.type) || action.omitCrossCheck) return action;
  const candidate = action.type === 'select' ? action.target : action.value;
  return { ...action, cross_check: action.cross_check || {
    answer: candidate, method: 'recalculation', check: 'SYNTHETIC cross-check: 2 + 2 = 4.'
  } };
}

test('missing APP_PASSWORD fails closed for protected endpoints and health', async () => {
  for (const path of ['/api/solve', '/api/agent']) {
    const response = await worker.fetch(makeRequest(path, { method: 'POST', body: path.endsWith('solve') ? { question: 'synthetic' } : testSnapshot }), {});
    assert.equal(response.status, 503);
  }
  const health = await worker.fetch(makeRequest('/api/health'), {});
  assert.equal(health.status, 503);
});

test('health requires the app password and reveals provider state only after authorization', async () => {
  const env = { APP_PASSWORD: password, MOCK_MODE: '1' };
  const unauthorized = await worker.fetch(makeRequest('/api/health'), env);
  assert.equal(unauthorized.status, 401);
  const authorized = await worker.fetch(makeRequest('/api/health', { auth: `Bearer ${password}` }), env);
  assert.equal(authorized.status, 200);
  const body = await authorized.json();
  assert.equal(body.passwordRequired, true);
  assert.equal(body.providers.groq, false);
});

test('authorized solve returns strictly synthetic mock and never invokes fetch/provider', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('mock must not access network/provider'); };
  try {
    const response = await worker.fetch(makeRequest('/api/solve', { method: 'POST', auth: `Bearer ${password}`, body: { question: 'SYNTHETIC TEST ONLY' }, origin: appOrigin }), { APP_PASSWORD: password, MOCK_MODE: '1', GEMINI_API_KEY: 'not-used-test-value' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), appOrigin);
    const body = await response.json();
    assert.equal(body.provider, 'mock');
    assert.match(body.answer, /لم يُرسل السؤال إلى أي مزوّد/);
  } finally { globalThis.fetch = realFetch; }
});

test('authorized agent returns a safe synthetic ask-user plan with Android CORS', async () => {
  const response = await worker.fetch(makeRequest('/api/agent', { method: 'POST', auth: `Bearer ${password}`, body: testSnapshot, origin: appOrigin }), { APP_PASSWORD: password, MOCK_MODE: '1' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), appOrigin);
  assert.equal((await response.json()).plan.actions[0].type, 'ask_user');
});

test('Worker blocks answer/Check/Submit/Grade/Run clicks and done claims; navigation needs explicit context', async () => {
  const realFetch = globalThis.fetch;
  let currentPlan = '';
  globalThis.fetch = async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: currentPlan }] } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const scenarios = [
    { name: 'answer option', action: { type: 'click', target: '4' }, snapshot: { text: 'SYNTHETIC TEST ONLY', buttons: ['4', 'Check'], fields: [] }, expected: 'ask_user' },
    { name: 'Check', action: { type: 'click', target: 'Check' }, snapshot: { text: 'SYNTHETIC TEST ONLY', buttons: ['Check'], fields: [] }, expected: 'ask_user' },
    { name: 'Submit', action: { type: 'click', target: 'Submit' }, snapshot: { text: 'SYNTHETIC TEST ONLY', buttons: ['Submit'], fields: [] }, expected: 'ask_user' },
    { name: 'Grade', action: { type: 'click', target: 'Grade' }, snapshot: { text: 'SYNTHETIC TEST ONLY', buttons: ['Grade'], fields: [] }, expected: 'ask_user' },
    { name: 'Run', action: { type: 'click', target: 'Run' }, snapshot: { text: 'SYNTHETIC TEST ONLY', buttons: ['Run'], fields: [] }, expected: 'ask_user' },
    { name: 'done claim', action: { type: 'done' }, snapshot: { text: 'SYNTHETIC TEST ONLY', buttons: [], fields: [] }, expected: 'ask_user' },
    { name: 'password field', action: { type: 'fill', target: 'Password', value: 'SYNTHETIC ONLY' }, snapshot: { text: 'SYNTHETIC TEST ONLY', buttons: [], fields: [] }, expected: 'ask_user' },
    { name: 'generic name field', action: { type: 'fill', target: 'Name', value: 'SYNTHETIC ONLY' }, snapshot: { text: 'SYNTHETIC TEST ONLY', buttons: [], fields: [] }, expected: 'ask_user' },
    { name: 'track selection', action: { type: 'click', target: 'Java' }, snapshot: { text: 'Choose a programming language', buttons: ['Java', 'Python'], fields: [] }, expected: 'click' },
    { name: 'JavaScript track selection', action: { type: 'click', target: 'JavaScript' }, snapshot: { text: 'Choose a programming language', buttons: ['JavaScript', 'Python'], fields: [] }, expected: 'click' },
    { name: 'next without success', action: { type: 'click', target: 'Next' }, snapshot: { text: 'SYNTHETIC TEST ONLY', buttons: ['Next'], feedback: '', fields: [] }, expected: 'ask_user' },
    { name: 'model cannot request Next after success', action: { type: 'click', target: 'Next' }, snapshot: { text: 'SYNTHETIC TEST ONLY', buttons: ['Next'], feedback: 'Correct!', fields: [] }, expected: 'ask_user' },
  ];
  try {
    for (const scenario of scenarios) {
      currentPlan = JSON.stringify({ actions: [scenario.action], message: 'synthetic only' });
      const response = await worker.fetch(makeRequest('/api/agent', {
        method: 'POST', auth: `Bearer ${password}`,
        body: { track: 'Java', snapshot: { url: 'https://me-portal.qureo.education/lesson', ...scenario.snapshot } },
      }), { APP_PASSWORD: password, GEMINI_API_KEY: 'test-only-key', MOCK_MODE: '0' });
      assert.equal(response.status, 200, scenario.name);
      const result = await response.json();
      assert.equal(result.plan.actions.length, 1, scenario.name);
      assert.equal(result.plan.actions[0].type, scenario.expected, scenario.name);
    }
  } finally { globalThis.fetch = realFetch; }
});

test('Worker permits exact high-confidence synthetic answers and stops on ambiguity', async () => {
  const realFetch = globalThis.fetch;
  let currentPlan = '';
  globalThis.fetch = async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: currentPlan }] } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const choiceSnapshot = {
    url: 'https://me-portal.qureo.education/lesson-choice', text: 'SYNTHETIC TEST ONLY: What is 2 + 2?',
    buttons: ['Check'], fields: [], choices: [
      { controlKind: 'radio', label: '4', selected: false },
      { controlKind: 'radio', label: '5', selected: false },
    ], choiceGroupCount: 1, checkboxCount: 0,
  };
  const textSnapshot = {
    url: 'https://me-portal.qureo.education/lesson-text', text: 'SYNTHETIC TEST ONLY: Type the result of 2 + 2.',
    buttons: ['Submit'], fields: [{ kind: 'input', type: 'text', label: 'Answer', value: '' }],
    choices: [], choiceGroupCount: 0, checkboxCount: 0,
  };
  const cases = [
    { action: { type: 'select', target: '4', confidence: 0.99, reason: 'Two plus two is four.' }, snapshot: choiceSnapshot, expected: 'select' },
    { action: { type: 'fill', target: 'Answer', value: '4', confidence: 0.99, reason: 'Two plus two is four.' }, snapshot: textSnapshot, expected: 'fill' },
    { action: { type: 'select', target: 'four', confidence: 0.99, reason: 'Two plus two is four.' }, snapshot: choiceSnapshot, expected: 'ask_user' },
    { action: { type: 'select', target: '4', confidence: 0.80, reason: 'Maybe four.' }, snapshot: choiceSnapshot, expected: 'ask_user' },
    { action: { type: 'select', target: '4', confidence: 0.99, reason: 'Two plus two is four.' }, snapshot: { ...choiceSnapshot, choiceGroupCount: 2 }, expected: 'ask_user' },
    { action: { type: 'select', target: '4', confidence: 0.99, reason: 'Two plus two is four.', omitCrossCheck: true }, snapshot: choiceSnapshot, expected: 'ask_user' },
    { action: { type: 'fill', target: 'Answer', value: '4', confidence: 0.99, reason: 'Two plus two is four.', cross_check: { answer: '5', method: 'recalculation', check: 'SYNTHETIC cross-check says five.' } }, snapshot: textSnapshot, expected: 'ask_user' },
  ];
  try {
    for (const scenario of cases) {
      currentPlan = JSON.stringify({ actions: [withCrossCheck(scenario.action)], message: 'synthetic only' });
      const response = await worker.fetch(makeRequest('/api/agent', {
        method: 'POST', auth: `Bearer ${password}`,
        body: { track: 'Java', snapshot: scenario.snapshot },
      }), { APP_PASSWORD: password, GEMINI_API_KEY: 'test-only-key', MOCK_MODE: '0' });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.plan.actions[0].type, scenario.expected);
    }
  } finally { globalThis.fetch = realFetch; }
});

test('Worker never marks negated or contradictory feedback as success', async () => {
  const realFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (_url, options) => {
    captured = JSON.parse(options.body);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"actions":[{"type":"ask_user","message":"synthetic"}],"message":""}' }] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    for (const feedback of ['Incorrect! Correct answer is 4.', 'Correct answer: 4.', 'The correct answer is 4.', 'This is the correct option.', 'This is not correct.', 'Correct! But the answer failed.', 'correctly formatted source']) {
      const response = await worker.fetch(makeRequest('/api/agent', {
        method: 'POST', auth: `Bearer ${password}`,
        body: { track: 'Java', snapshot: { ...testSnapshot.snapshot, feedback, buttons: ['Check'], fields: [] } },
      }), { APP_PASSWORD: password, GEMINI_API_KEY: 'test-only-key', MOCK_MODE: '0' });
      assert.equal(response.status, 200);
      assert.match(captured.contents[0].parts[0].text, /"success":false/);
    }
    await worker.fetch(makeRequest('/api/agent', {
      method: 'POST', auth: `Bearer ${password}`,
      body: { track: 'Java', snapshot: { ...testSnapshot.snapshot, feedback: 'Correct!', feedbackAmbiguous: true, buttons: ['Check'], fields: [] } },
    }), { APP_PASSWORD: password, GEMINI_API_KEY: 'test-only-key', MOCK_MODE: '0' });
    assert.match(captured.contents[0].parts[0].text, /"success":false/);
    await worker.fetch(makeRequest('/api/agent', {
      method: 'POST', auth: `Bearer ${password}`,
      body: { track: 'Java', snapshot: { ...testSnapshot.snapshot, feedback: 'Correct!', buttons: ['Check'], fields: [] } },
    }), { APP_PASSWORD: password, GEMINI_API_KEY: 'test-only-key', MOCK_MODE: '0' });
    assert.match(captured.contents[0].parts[0].text, /"success":true/);
  } finally { globalThis.fetch = realFetch; }
});

test('agent scrubs personal identifiers before sending only bounded lesson data to Gemini', async () => {
  const realFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /generativelanguage\.googleapis\.com/);
    captured = JSON.parse(options.body);
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"actions":[{"type":"ask_user","message":"راجع السؤال"}],"message":"توقف"}' }] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const body = { track: 'Java', snapshot: {
    url: 'https://me-portal.qureo.education/lesson/123456789?student=student@example.com#private',
    text: 'Student name: SAMPLE PERSON\nName: SAMPLE PERSON\nStudent ID: 123456789\nWhat is the name of this synthetic variable? What does this code print?',
    buttons: ['Profile', 'Continue'],
    fields: [
      { kind: 'input', type: 'text', label: 'Email', value: 'student@example.com' },
      { kind: 'code', type: 'text', label: 'Code editor', value: 'console.log("synthetic");' },
    ],
    diamonds: '12 diamonds',
  } };
  try {
    const response = await worker.fetch(makeRequest('/api/agent', { method: 'POST', auth: `Bearer ${password}`, body }), { APP_PASSWORD: password, GEMINI_API_KEY: 'test-only-key', MOCK_MODE: '0' });
    assert.equal(response.status, 200);
    const prompt = captured.contents[0].parts[0].text;
    assert.doesNotMatch(prompt, /SAMPLE PERSON|123456789|student@example\.com|Profile|student=|#private/);
    assert.match(prompt, /What does this code print\?/);
    assert.match(prompt, /What is the name of this synthetic variable/);
    assert.match(prompt, /\[id\]/);
    assert.ok(prompt.includes('console.log(') && prompt.includes('synthetic'));
    assert.match(prompt, /Continue/);
    assert.match(prompt, /12/);
  } finally { globalThis.fetch = realFetch; }
});

test('Android preflight works for health, solve, agent; hostile origin rejected', async () => {
  for (const path of ['/api/health', '/api/solve', '/api/agent']) {
    const response = await worker.fetch(makeRequest(path, { method: 'OPTIONS', origin: appOrigin }), {});
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), appOrigin);
    assert.match(response.headers.get('access-control-allow-headers'), /Authorization/i);
  }
  const denied = await worker.fetch(makeRequest('/api/solve', { method: 'OPTIONS', origin: 'https://evil.example' }), {});
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});
