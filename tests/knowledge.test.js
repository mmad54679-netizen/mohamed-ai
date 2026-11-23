const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createKnowledgeStore } = require('../knowledge/store');
const { createServer } = require('../server');

test('store: adds, dedupes, ignores too-short text and finds Arabic matches', () => {
  const store = createKnowledgeStore();
  assert.equal(store.add({ text: 'قصير' }), null);
  const a = store.add({ text: 'الحلقة for في بايثون تكرر مجموعة أوامر على كل عنصر في القائمة', source: 'doc' });
  const b = store.add({ text: 'الحلقة for في بايثون تكرر مجموعة أوامر على كل عنصر في القائمة' });
  assert.equal(a.id, b.id);
  assert.equal(store.size(), 1);
  store.add({ text: 'عاصمة فرنسا هي باريس وهي أكبر مدنها وتقع على نهر السين' });
  const hits = store.search('كيف تعمل الحلقة for في بايثون؟');
  assert.equal(hits[0].source, 'doc');
  assert.deepEqual(store.search('موضوع غير موجود نهائيا xyzzy'), []);
});

test('store: persists to disk and reloads', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kb-')), 'kb.json');
  createKnowledgeStore({ file }).add({ text: 'المتغير في جافاسكربت يعرّف بالكلمة let أو const حسب الحاجة' });
  assert.equal(createKnowledgeStore({ file }).size(), 1);
});

test('API: teach, search and delete knowledge; feedback is not learned by default', async () => {
  const server = createServer({ logger: { warn() {} }, env: { APP_PASSWORD: 'PW', MOCK_MODE: '1' } });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const h = { 'Content-Type': 'application/json', Authorization: 'Bearer PW' };
  try {
    assert.equal((await fetch(`${base}/api/knowledge`)).status, 401);
    const saved = await (await fetch(`${base}/api/knowledge`, { method: 'POST', headers: h, body: JSON.stringify({ text: 'الدالة في بايثون تعرّف بالكلمة def ثم الاسم والمعاملات' }) })).json();
    assert.equal(saved.saved, true);
    const found = await (await fetch(`${base}/api/knowledge?q=${encodeURIComponent('تعريف الدالة في بايثون')}`, { headers: h })).json();
    assert.equal(found.results.length, 1);
    const fb = await (await fetch(`${base}/api/feedback`, { method: 'POST', headers: h, body: JSON.stringify({ helpful: true, question: 'س', answer: 'ج' }) })).json();
    assert.equal(fb.learned, false);
    const del = await (await fetch(`${base}/api/knowledge?id=${saved.id}`, { method: 'DELETE', headers: h })).json();
    assert.equal(del.removed, true);
  } finally { await new Promise(r => server.close(r)); }
});
