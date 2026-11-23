// ذاكرة معرفة بسيطة: تخزين نصوص مع مصدرها، واسترجاع الأقرب لسؤال المستخدم (بدون مكتبات خارجية).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_ENTRIES = 2000;
const MAX_TEXT = 1500;
const KINDS = new Set(['web', 'taught', 'feedback', 'verified']);

function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه');
}

const STOPWORDS = new Set(['في', 'من', 'على', 'الي', 'الى', 'ما', 'هو', 'هي', 'عن', 'مع', 'كيف', 'هل', 'ماذا', 'the', 'is', 'of', 'to', 'and', 'in', 'a']);

function tokens(text) {
  return normalize(text).split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 1 && !STOPWORDS.has(word));
}

function createKnowledgeStore({ file = '' } = {}) {
  let entries = [];
  if (file) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(parsed)) entries = parsed.slice(-MAX_ENTRIES);
    } catch { /* ملف جديد */ }
  }

  function persist() {
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(entries));
      fs.renameSync(tmp, file);
    } catch { /* الذاكرة تبقى تعمل حتى لو فشل الحفظ */ }
  }

  function add({ text, source = '', kind = 'taught' }) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    if (clean.length < 20) return null;
    if (!KINDS.has(kind)) kind = 'taught';
    const id = crypto.createHash('sha256').update(normalize(clean)).digest('hex').slice(0, 16);
    const existing = entries.find(entry => entry.id === id);
    if (existing) return existing;
    const entry = { id, text: clean, source: String(source).slice(0, 500), kind, created: new Date().toISOString(), uses: 0 };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) {
      // الأقل استخدامًا والأقدم يُحذف أولًا
      entries.sort((a, b) => (b.uses - a.uses) || (b.created > a.created ? 1 : -1));
      entries = entries.slice(0, MAX_ENTRIES);
    }
    persist();
    return entry;
  }

  function search(query, limit = 3) {
    const q = [...new Set(tokens(query))];
    if (!q.length || !entries.length) return [];
    const df = new Map();
    const docs = entries.map(entry => {
      const set = new Set(tokens(entry.text));
      for (const word of set) df.set(word, (df.get(word) || 0) + 1);
      return set;
    });
    const scored = entries.map((entry, i) => {
      let score = 0;
      let matches = 0;
      for (const word of q) if (docs[i].has(word)) { matches += 1; score += 1 + Math.log(entries.length / df.get(word)); }
      return { entry, matches, score: score / Math.sqrt(q.length) };
    }).filter(item => item.matches >= 2 && item.score >= 1).sort((a, b) => b.score - a.score).slice(0, limit);
    for (const item of scored) item.entry.uses += 1;
    if (scored.length) persist();
    return scored.map(item => ({ ...item.entry, score: Number(item.score.toFixed(2)) }));
  }

  function remove(id) {
    const before = entries.length;
    entries = entries.filter(entry => entry.id !== id);
    if (entries.length !== before) persist();
    return entries.length !== before;
  }

  return { add, search, remove, size: () => entries.length };
}

module.exports = { createKnowledgeStore, MAX_ENTRIES, MAX_TEXT };
