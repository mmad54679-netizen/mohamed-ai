#!/usr/bin/env node
// تقييم جودة الردود: يرسل أسئلة ثابتة إلى خادم يعمل ويفحص الكلمات المطلوبة والممنوعة.
// الاستخدام:  APP_URL=https://your-server APP_PASSWORD=... node scripts/eval.js
const fs = require('node:fs');
const path = require('node:path');

const base = (process.env.APP_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const password = process.env.APP_PASSWORD || '';
const questions = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tests', 'eval', 'questions.json'), 'utf8'));

function grade(q, answer) {
  const problems = [];
  for (const w of q.must_include || []) if (!answer.includes(w)) problems.push(`ينقصه: ${w}`);
  if (q.must_include_any && !q.must_include_any.some(w => answer.includes(w))) problems.push(`لا يحوي أيًا من: ${q.must_include_any.join(' | ')}`);
  for (const w of q.must_not_include || []) if (answer.includes(w)) problems.push(`يحوي ممنوعًا: ${w}`);
  return problems;
}

(async () => {
  let passed = 0;
  for (const q of questions) {
    try {
      const res = await fetch(`${base}/api/solve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(password ? { Authorization: `Bearer ${password}` } : {}) },
        body: JSON.stringify({ question: q.question, mode: q.mode }),
      });
      const data = await res.json();
      const problems = res.ok ? grade(q, String(data.answer || '')) : [`HTTP ${res.status}`];
      if (!problems.length) { passed++; console.log(`✔ ${q.id}`); }
      else console.log(`✘ ${q.id}: ${problems.join('; ')}`);
    } catch (e) {
      console.log(`✘ ${q.id}: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 2500)); // احترام حدود الطبقة المجانية
  }
  console.log(`\nالنتيجة: ${passed}/${questions.length}`);
  process.exit(passed === questions.length ? 0 : 1);
})();
