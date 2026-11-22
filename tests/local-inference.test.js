const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadWithMemory(memory) {
  const sandbox = { window: {}, navigator: { deviceMemory: memory } };
  const source = fs.readFileSync(path.join(__dirname, '../public/local-inference.js'), 'utf8');
  vm.runInNewContext(source, sandbox, { filename: 'local-inference.js' });
  return sandbox.window.QureoLocal;
}

test('low-memory guard rejects before importing the model runtime', async () => {
  const local = loadWithMemory(2);
  assert.equal(local.isLowMemory(), true);
  await assert.rejects(local.prepare(() => {}), /أقل من 4 GB/);
});

test('local inference rejects empty text before loading any model', async () => {
  const local = loadWithMemory(undefined);
  await assert.rejects(local.generate('   ', () => {}), /تحتاج نص السؤال/);
});
