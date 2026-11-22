const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer, DEFAULT_GEMINI_MODEL, DEFAULT_GROQ_MODEL } = require('../server');

test('paid or unapproved Gemini model override is rejected', () => {
  assert.throws(() => createServer({ env: { APP_PASSWORD: 'TEST_ONLY', GEMINI_MODEL: 'paid-model-placeholder' } }), /locked to the free-tier model/);
  assert.doesNotThrow(() => createServer({ env: { APP_PASSWORD: 'TEST_ONLY', GEMINI_MODEL: DEFAULT_GEMINI_MODEL } }));
});

test('paid or unapproved Groq model override is rejected', () => {
  assert.throws(() => createServer({ env: { APP_PASSWORD: 'TEST_ONLY', GROQ_MODEL: 'paid-model-placeholder' } }), /locked to the free-tier model/);
  assert.doesNotThrow(() => createServer({ env: { APP_PASSWORD: 'TEST_ONLY', GROQ_MODEL: DEFAULT_GROQ_MODEL } }));
});
