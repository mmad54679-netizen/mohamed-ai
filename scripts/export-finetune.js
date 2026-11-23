#!/usr/bin/env node
// يحوّل التقييمات «المفيدة» المحفوظة في الذاكرة إلى ملف JSONL جاهز للـ fine-tuning (صيغة messages).
// الاستخدام: node scripts/export-finetune.js [data/knowledge.json] [out.jsonl]
const fs = require('node:fs');
const path = require('node:path');

const input = process.argv[2] || path.join(__dirname, '..', 'data', 'knowledge.json');
const output = process.argv[3] || path.join(__dirname, '..', 'data', 'finetune.jsonl');
const SYSTEM = 'أنت Mohamed AI، مساعد عربي دقيق ومفيد. أجب بوضوح ولا تخترع معلومات.';

const entries = JSON.parse(fs.readFileSync(input, 'utf8'));
const rows = [];
for (const entry of entries) {
  if (entry.kind !== 'feedback' && entry.kind !== 'verified') continue;
  const match = String(entry.text).match(/^سؤال:\s*(.+?)\s*—\s*إجابة مفيدة:\s*([\s\S]+)$/);
  if (!match) continue;
  rows.push(JSON.stringify({ messages: [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: match[1] },
    { role: 'assistant', content: match[2] },
  ] }));
}
fs.writeFileSync(output, rows.join('\n') + (rows.length ? '\n' : ''));
console.log(`تم تصدير ${rows.length} مثالًا إلى ${output}`);
if (rows.length < 200) console.log('تنبيه: أقل من 200 مثال غالبًا لا يكفي لتحسين ملموس؛ اجمع المزيد وراجعها يدويًا قبل التدريب.');
