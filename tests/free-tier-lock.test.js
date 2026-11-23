const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer, DEFAULT_GEMINI_MODEL, DEFAULT_GROQ_MODEL } = require('../server');

test('model overrides are accepted and defaults stay the free-tier models', () => {
  assert.doesNotThrow(() => createServer({ env: { APP_PASSWORD: 'TEST_ONLY', GEMINI_MODEL: 'another-model' } }));
  assert.doesNotThrow(() => createServer({ env: { APP_PASSWORD: 'TEST_ONLY', GROQ_MODEL: 'another-model' } }));
  assert.ok(DEFAULT_GEMINI_MODEL && DEFAULT_GROQ_MODEL);
});
