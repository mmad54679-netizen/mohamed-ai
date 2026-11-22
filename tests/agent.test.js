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
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

const snapshot = {
  url: 'https://me-portal.qureo.education/course/lesson-17',
  title: 'Synthetic lesson',
  text: 'SYNTHETIC TEST ONLY: choose the correct output for 2 + 2.',
  buttons: ['4', '5', 'Check'],
  fields: [],
  diamonds: '',
};

const syntheticChoiceSnapshot = {
  url: 'https://me-portal.qureo.education/course/lesson-choice',
  title: 'Synthetic lesson',
  text: 'SYNTHETIC TEST ONLY: What is 2 + 2?',
  buttons: ['Check'],
  fields: [],
  choices: [
    { controlKind: 'radio', label: '4', selected: false },
    { controlKind: 'radio', label: '5', selected: false },
  ],
  choiceGroupCount: 1,
  checkboxCount: 0,
};

const syntheticTextSnapshot = {
  url: 'https://me-portal.qureo.education/course/lesson-text',
  title: 'Synthetic lesson',
  text: 'SYNTHETIC TEST ONLY: Type the result of 2 + 2.',
  buttons: ['Submit'],
  fields: [{ kind: 'input', type: 'text', label: 'Answer', placeholder: '', value: '' }],
  choices: [],
  choiceGroupCount: 0,
  checkboxCount: 0,
};

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function withCrossCheck(action) {
  if (!['fill', 'select'].includes(action.type) || action.omitCrossCheck) return action;
  const candidate = action.type === 'select' ? action.target : action.value;
  return { ...action, cross_check: action.cross_check || {
    answer: candidate, method: 'recalculation', check: 'SYNTHETIC cross-check: 2 + 2 = 4.'
  } };
}

test('mock agent returns a pause plan and never mutates or solves a real lesson', async () => {
  let calls = 0;
  await withServer({ env: { MOCK_MODE: '1' }, fetchImpl: async () => { calls++; throw new Error('provider must not be called'); } }, async base => {
    const response = await fetch(`${base}/api/agent`, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ track: 'Java', snapshot }),
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.provider, 'mock');
    assert.equal(result.plan.actions[0].type, 'ask_user');
    assert.equal(calls, 0);
  });
});

test('agent rejects off-domain pages and credential-bearing requests before provider calls', async () => {
  let calls = 0;
  await withServer({ env: { GEMINI_API_KEY: 'TEST_ONLY_KEY' }, fetchImpl: async () => { calls++; throw new Error('provider must not be called'); } }, async base => {
    const offDomain = await fetch(`${base}/api/agent`, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ track: 'Java', snapshot: { ...snapshot, url: 'https://example.invalid/lesson' } }),
    });
    assert.equal(offDomain.status, 400);

    const credentials = await fetch(`${base}/api/agent`, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ track: 'Java', snapshot, username: 'TEST_ACCOUNT', password: 'TEST_PASSWORD' }),
    });
    assert.equal(credentials.status, 400);
    assert.equal(calls, 0);
  });
});

test('agent uses Gemini but collapses a multi-action plan into review without exposing its clicks', async () => {
  let calls = 0;
  const planText = JSON.stringify({
    actions: [
      { type: 'click', target: '4' },
      { type: 'click', target: 'Check' },
    ],
    message: 'Synthetic fixture plan',
  });
  const fetchImpl = async (url, options) => {
    calls++;
    assert.match(url, /generativelanguage.googleapis.com/);
    const request = JSON.parse(options.body);
    const prompt = request.contents[0].parts[0].text;
    assert.match(prompt, /SYNTHETIC TEST ONLY/);
    assert.doesNotMatch(prompt, /TEST_PASSWORD|TEST_ACCOUNT/);
    return jsonResponse(200, { candidates: [{ content: { parts: [{ text: planText }] } }] });
  };
  await withServer({ env: { GEMINI_API_KEY: 'TEST_ONLY_KEY' }, fetchImpl }, async base => {
    const response = await fetch(`${base}/api/agent`, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ track: 'Java', snapshot }),
    });
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.provider, 'gemini');
    assert.equal(result.plan.actions.length, 1);
    assert.equal(result.plan.actions[0].type, 'ask_user');
    assert.equal(calls, 1);
  });
});

test('agent blocks answer and grading clicks, done claims, and sensitive fields while permitting only qualified navigation', async () => {
  let currentPlan = '';
  const fetchImpl = async () => jsonResponse(200, {
    candidates: [{ content: { parts: [{ text: currentPlan }] } }],
  });
  const scenarios = [
    { name: 'answer option', action: { type: 'click', target: '4' }, snapshot: { ...snapshot, buttons: ['4', 'Check'] }, expected: 'ask_user' },
    { name: 'Check', action: { type: 'click', target: 'Check' }, snapshot: { ...snapshot, buttons: ['Check'] }, expected: 'ask_user' },
    { name: 'Submit', action: { type: 'click', target: 'Submit' }, snapshot: { ...snapshot, buttons: ['Submit'] }, expected: 'ask_user' },
    { name: 'Grade', action: { type: 'click', target: 'Grade' }, snapshot: { ...snapshot, buttons: ['Grade'] }, expected: 'ask_user' },
    { name: 'Run', action: { type: 'click', target: 'Run' }, snapshot: { ...snapshot, buttons: ['Run'] }, expected: 'ask_user' },
    { name: 'done claim', action: { type: 'done' }, snapshot, expected: 'ask_user' },
    { name: 'password field', action: { type: 'fill', target: 'Password', value: 'SYNTHETIC ONLY' }, snapshot, expected: 'ask_user' },
    { name: 'generic name field', action: { type: 'fill', target: 'Name', value: 'SYNTHETIC ONLY' }, snapshot, expected: 'ask_user' },
    { name: 'track selection', action: { type: 'click', target: 'Java' }, snapshot: { ...snapshot, text: 'Choose a programming language', buttons: ['Java', 'Python'] }, expected: 'click' },
    { name: 'JavaScript track selection', action: { type: 'click', target: 'JavaScript' }, snapshot: { ...snapshot, text: 'Choose a programming language', buttons: ['JavaScript', 'Python'] }, expected: 'click' },
    { name: 'next without success', action: { type: 'click', target: 'Next' }, snapshot: { ...snapshot, buttons: ['Next'], feedback: '' }, expected: 'ask_user' },
    { name: 'model cannot request Next even after success', action: { type: 'click', target: 'Next' }, snapshot: { ...snapshot, buttons: ['Next'], feedback: 'Correct!' }, expected: 'ask_user' },
  ];
  await withServer({ env: { GEMINI_API_KEY: 'TEST_ONLY_KEY' }, fetchImpl }, async base => {
    for (const scenario of scenarios) {
      currentPlan = JSON.stringify({ actions: [scenario.action], message: 'synthetic only' });
      const response = await fetch(`${base}/api/agent`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ track: 'Java', snapshot: scenario.snapshot }),
      });
      assert.equal(response.status, 200, scenario.name);
      const result = await response.json();
      assert.equal(result.plan.actions.length, 1, scenario.name);
      assert.equal(result.plan.actions[0].type, scenario.expected, scenario.name);
    }
  });
});

test('agent accepts JavaScript as a distinct track but rejects the real unsupported run-code button', async () => {
  let prompt = '';
  const fetchImpl = async (_url, options) => {
    prompt = JSON.parse(options.body).contents[0].parts[0].text;
    return jsonResponse(200, { candidates: [{ content: { parts: [{ text: '{"actions":[{"type":"ask_user","message":"synthetic"}],"message":""}' }] } }] });
  };
  await withServer({ env: { GEMINI_API_KEY: 'TEST_ONLY_KEY' }, fetchImpl }, async base => {
    const response = await fetch(`${base}/api/agent`, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ track: 'JavaScript', snapshot }),
    });
    assert.equal(response.status, 200);
    assert.match(prompt, /JavaScript/);

    const codeQuestion = { url: 'https://me-portal.qureo.education/chapter/90031/lecture/90031010', text: 'SYNTHETIC TEST ONLY: define sum', buttons: ['تشغيل الكود'], fields: [{ kind: 'code', type: 'textarea', label: 'Code editor' }], choices: [], choiceGroupCount: 0, checkboxCount: 0 };
    const codeResponse = await fetch(`${base}/api/agent`, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ track: 'JavaScript', snapshot: codeQuestion }),
    });
    assert.equal(codeResponse.status, 200);
    assert.equal((await codeResponse.json()).plan.actions[0].type, 'ask_user');
  });
});

test('agent permits exact high-confidence synthetic choice/text answers and stops on ambiguity', async () => {
  let currentPlan = '';
  const fetchImpl = async () => jsonResponse(200, {
    candidates: [{ content: { parts: [{ text: currentPlan }] } }],
  });
  const cases = [
    { name: 'exact visible choice', action: { type: 'select', target: '4', confidence: 0.99, reason: 'The sum of two and two is four.' }, snapshot: syntheticChoiceSnapshot, expected: 'select' },
    { name: 'exact unique text field', action: { type: 'fill', target: 'Answer', value: '4', confidence: 0.99, reason: 'Two plus two equals four.' }, snapshot: syntheticTextSnapshot, expected: 'fill' },
    { name: 'low confidence', action: { type: 'select', target: '4', confidence: 0.80, reason: 'Maybe this option.' }, snapshot: syntheticChoiceSnapshot, expected: 'ask_user' },
    { name: 'not an exact choice', action: { type: 'select', target: 'four', confidence: 0.99, reason: 'The sum is four.' }, snapshot: syntheticChoiceSnapshot, expected: 'ask_user' },
    { name: 'multiple radio groups', action: { type: 'select', target: '4', confidence: 0.99, reason: 'The sum is four.' }, snapshot: { ...syntheticChoiceSnapshot, choiceGroupCount: 2 }, expected: 'ask_user' },
    { name: 'missing cross-check', action: { type: 'select', target: '4', confidence: 0.99, reason: 'The sum of two and two is four.', omitCrossCheck: true }, snapshot: syntheticChoiceSnapshot, expected: 'ask_user' },
    { name: 'cross-check disagrees with answer', action: { type: 'fill', target: 'Answer', value: '4', confidence: 0.99, reason: 'Two plus two equals four.', cross_check: { answer: '5', method: 'recalculation', check: 'SYNTHETIC cross-check says five.' } }, snapshot: syntheticTextSnapshot, expected: 'ask_user' },
  ];
  await withServer({ env: { GEMINI_API_KEY: 'TEST_ONLY_KEY' }, fetchImpl }, async base => {
    for (const scenario of cases) {
      currentPlan = JSON.stringify({ actions: [withCrossCheck(scenario.action)], message: 'synthetic only' });
      const response = await fetch(`${base}/api/agent`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ track: 'Java', snapshot: scenario.snapshot }),
      });
      const result = await response.json();
      assert.equal(response.status, 200, scenario.name);
      assert.equal(result.plan.actions[0].type, scenario.expected, scenario.name);
      if (scenario.expected === 'select') assert.equal(result.plan.actions[0].target, '4');
      if (scenario.expected === 'fill') assert.equal(result.plan.actions[0].value, '4');
    }
  });
});

test('agent treats incorrect, negated, or contradictory feedback as not successful', async () => {
  let prompt = '';
  const fetchImpl = async (_url, options) => {
    prompt = JSON.parse(options.body).contents[0].parts[0].text;
    return jsonResponse(200, { candidates: [{ content: { parts: [{ text: '{"actions":[{"type":"ask_user","message":"synthetic"}],"message":""}' }] } }] });
  };
  await withServer({ env: { GEMINI_API_KEY: 'TEST_ONLY_KEY' }, fetchImpl }, async base => {
    for (const feedback of ['Incorrect! Correct answer is 4.', 'Correct answer: 4.', 'The correct answer is 4.', 'This is the correct option.', 'This is not correct.', 'Correct! But the answer failed.', 'correctly formatted source']) {
      const response = await fetch(`${base}/api/agent`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ track: 'Java', snapshot: { ...snapshot, feedback } }),
      });
      assert.equal(response.status, 200);
      assert.match(prompt, /"success":false/);
    }
    await fetch(`${base}/api/agent`, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ track: 'Java', snapshot: { ...snapshot, feedback: 'Correct!', feedbackAmbiguous: true } }),
    });
    assert.match(prompt, /"success":false/);
    await fetch(`${base}/api/agent`, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ track: 'Java', snapshot: { ...snapshot, feedback: 'Correct!' } }),
    });
    assert.match(prompt, /"success":true/);
  });
});

test('agent redacts common account identifiers and sends only the diamond count', async () => {
  let prompt = '';
  const fetchImpl = async (_url, options) => {
    prompt = JSON.parse(options.body).contents[0].parts[0].text;
    return jsonResponse(200, { candidates: [{ content: { parts: [{ text: '{"actions":[{"type":"wait"}],"message":"synthetic"}' }] } }] });
  };
  const privateLookingSnapshot = {
    ...snapshot,
    url: 'https://me-portal.qureo.education/student/123456789/lesson-17',
    title: 'Sample Student dashboard',
    text: 'Welcome, Sample Student\nName: Sample Student\nEmail: learner@example.test\nStudent ID: 123456789\nPhone: +20 100 000 0000\nQuestion: What is the name of the variable? Choose 4 or 5.',
    fields: [{ kind: 'input', type: 'password', label: 'Password', value: 'TEST_ONLY_PASSWORD' }, { kind: 'input', type: 'text', label: 'Student ID' }],
    buttons: ['Student profile', 'Check'],
    diamonds: 'Sample Student has 42 diamonds',
  };
  await withServer({ env: { GEMINI_API_KEY: 'TEST_ONLY_KEY' }, fetchImpl }, async base => {
    const response = await fetch(`${base}/api/agent`, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ track: 'Java', snapshot: privateLookingSnapshot }),
    });
    assert.equal(response.status, 200);
    assert.doesNotMatch(prompt, /Sample Student|learner@example\.test|123456789|100 000 0000|TEST_ONLY_PASSWORD/);
    assert.match(prompt, /What is the name of the variable/);
    assert.match(prompt, /QUREO lesson/);
    assert.match(prompt, /42/);
  });
});

test('Groq remains disabled when a key exists unless the explicit fallback flag is set', async () => {
  let calls = 0;
  await withServer({ env: { GROQ_API_KEY: 'TEST_ONLY_GROQ_KEY' }, fetchImpl: async () => { calls++; throw new Error('provider must not be called'); } }, async base => {
    const health = await fetch(`${base}/api/health`, { headers: authHeaders() }).then(response => response.json());
    assert.equal(health.providers.groq, false);
    const response = await fetch(`${base}/api/agent`, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ track: 'Python', snapshot }),
    });
    assert.equal(response.status, 503);
    assert.equal(calls, 0);
  });
});
