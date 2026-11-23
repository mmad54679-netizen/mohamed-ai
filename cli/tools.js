// أدوات الوكيل: قراءة وبحث وتعديل وتشغيل أوامر داخل مجلد المشروع فقط، مع نظام موافقات.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SECRET_FILE = /(^|[\\/])(\.env(\..*)?|id_rsa|id_ed25519|.*\.pem|.*\.key|.*\.p12|\.npmrc|\.netrc|credentials(\.json)?)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', '.gradle', 'build', '.wrangler', 'dist']);
const MAX_READ_CHARS = 20000;
const MAX_OUTPUT_CHARS = 12000;

const BLOCKED_COMMANDS = [
  /\brm\s+-[a-z]*(rf|fr)[a-z]*\s+(\/|~|\$HOME|\*|\.\.)/i,
  /\bsudo\b/, /\bmkfs\b/, /:\(\)\s*\{/, />\s*\/dev\/(sd|nvme)/,
  /\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/i,
  /\bchmod\s+-R\s+777\s+\//, /\b(shutdown|reboot|halt)\b/,
  /\bgit\s+push\b[^\n]*(--force|-f\b)/,
];

function realRoot(root) { return fs.realpathSync(path.resolve(root)); }

// يحوّل مسارًا نسبيًا لمسار مطلق داخل المشروع، ويمنع الخروج منه (بما فيه عبر الروابط الرمزية).
function resolveInside(root, target) {
  const base = realRoot(root);
  const abs = path.resolve(base, String(target || '.'));
  let probe = abs;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const real = fs.realpathSync(probe);
  const rel = path.relative(base, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('المسار خارج مجلد المشروع.');
  return abs;
}

const isSecret = p => SECRET_FILE.test(p);
const clip = (text, max = MAX_OUTPUT_CHARS) => (text.length <= max ? text : `${text.slice(0, max * 0.6)}\n... [تم اقتطاع ${text.length - max} حرفًا] ...\n${text.slice(-max * 0.4)}`);
const looksBinary = buf => buf.subarray(0, 4000).includes(0);

function walk(dir, visit, depth = 0) {
  if (depth > 12) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(full, visit, depth + 1); }
    else if (visit(full) === false) return;
  }
}

function createTools({ root, approve = async () => false, mode = 'ask', allowPush = false, env = process.env }) {
  const base = realRoot(root);
  const rel = abs => path.relative(base, abs) || '.';
  const needsApproval = kind => mode === 'yolo' ? false : (mode === 'auto-edit' ? kind === 'command' : true);
  const ask = async (kind, summary, detail) => (needsApproval(kind) ? approve({ kind, summary, detail }) : true);

  const impl = {
    async list_dir({ path: p = '.' }) {
      const abs = resolveInside(base, p);
      const names = fs.readdirSync(abs, { withFileTypes: true })
        .filter(e => !SKIP_DIRS.has(e.name))
        .map(e => e.name + (e.isDirectory() ? '/' : '')).sort().slice(0, 200);
      return names.join('\n') || '(مجلد فارغ)';
    },

    async read_file({ path: p, start_line, end_line }) {
      const abs = resolveInside(base, p);
      if (isSecret(abs)) throw new Error('قراءة ملفات الأسرار (.env وغيرها) ممنوعة.');
      const buf = fs.readFileSync(abs);
      if (looksBinary(buf)) throw new Error('ملف ثنائي؛ لا يمكن عرضه كنص.');
      const lines = buf.toString('utf8').split('\n');
      const from = Math.max(1, Number(start_line) || 1);
      const to = Math.min(lines.length, Number(end_line) || lines.length);
      const numbered = lines.slice(from - 1, to).map((line, i) => `${from + i}\t${line}`).join('\n');
      return clip(numbered, MAX_READ_CHARS);
    },

    async grep({ pattern, path: p = '.' }) {
      if (!pattern || String(pattern).length > 200) throw new Error('نمط البحث مطلوب (200 حرف كحد أقصى).');
      let re;
      try { re = new RegExp(pattern, 'i'); } catch { throw new Error('تعبير نمطي غير صالح.'); }
      const start = resolveInside(base, p);
      const hits = [];
      const scan = file => {
        if (hits.length >= 100) return false;
        if (isSecret(file)) return true;
        try {
          if (fs.statSync(file).size > 1024 * 1024) return true;
          const buf = fs.readFileSync(file);
          if (looksBinary(buf)) return true;
          buf.toString('utf8').split('\n').forEach((line, i) => {
            if (hits.length < 100 && re.test(line)) hits.push(`${rel(file)}:${i + 1}: ${line.trim().slice(0, 200)}`);
          });
        } catch { /* تجاهل */ }
        return true;
      };
      if (fs.statSync(start).isDirectory()) walk(start, scan); else scan(start);
      return hits.join('\n') || 'لا نتائج.';
    },

    async edit_file({ path: p, old_str, new_str }) {
      const abs = resolveInside(base, p);
      if (isSecret(abs)) throw new Error('تعديل ملفات الأسرار ممنوع.');
      const text = fs.readFileSync(abs, 'utf8');
      const count = old_str ? text.split(old_str).length - 1 : 0;
      if (count !== 1) throw new Error(count === 0 ? 'old_str غير موجود في الملف.' : `old_str يظهر ${count} مرات؛ وسّعه ليصبح فريدًا.`);
      if (!(await ask('edit', `تعديل ${rel(abs)}`, `- ${clip(old_str, 600)}\n+ ${clip(String(new_str ?? ''), 600)}`))) return 'رفض المستخدم هذا التعديل.';
      fs.writeFileSync(abs, text.replace(old_str, () => String(new_str ?? '')));
      return `تم تعديل ${rel(abs)}.`;
    },

    async write_file({ path: p, content }) {
      const abs = resolveInside(base, p);
      if (isSecret(abs)) throw new Error('الكتابة في ملفات الأسرار ممنوعة.');
      const exists = fs.existsSync(abs);
      if (!(await ask('edit', `${exists ? 'استبدال' : 'إنشاء'} ${rel(abs)} (${String(content).length} حرف)`, clip(String(content), 800)))) return 'رفض المستخدم كتابة الملف.';
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, String(content));
      return `${exists ? 'تم استبدال' : 'تم إنشاء'} ${rel(abs)}.`;
    },

    async run_command({ command, timeout_seconds = 60 }) {
      const cmd = String(command || '').trim();
      if (!cmd) throw new Error('الأمر فارغ.');
      if (/\bgit\s+push\b/.test(cmd) && !allowPush) throw new Error('git push معطّل؛ شغّل الأداة بالخيار --allow-push إن أردته.');
      if (BLOCKED_COMMANDS.some(re => re.test(cmd))) throw new Error('الأمر محظور لأسباب أمنية.');
      if (!(await ask('command', `تشغيل: ${cmd}`, ''))) return 'رفض المستخدم تشغيل الأمر.';
      const limit = Math.max(1, Math.min(300, Number(timeout_seconds) || 60)) * 1000;
      // لا نمرّر المفاتيح والرموز السرية لعمليات الأوامر
      const safeEnv = Object.fromEntries(Object.entries(env).filter(([k]) => !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(k)));
      return new Promise(resolve => {
        const child = spawn(cmd, { cwd: base, shell: true, env: safeEnv });
        let out = '';
        let timedOut = false;
        const collect = chunk => { if (out.length < 200000) out += chunk.toString(); };
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);
        const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, limit);
        child.on('close', code => { clearTimeout(timer); resolve(`${timedOut ? '[انتهت المهلة] ' : ''}رمز الخروج: ${code}\n${clip(out)}`); });
        child.on('error', error => { clearTimeout(timer); resolve(`فشل التشغيل: ${error.message}`); });
      });
    },
  };

  async function execute(name, args) {
    if (!impl[name]) return `أداة غير معروفة: ${name}`;
    try { return String(await impl[name](args || {})); } catch (error) { return `خطأ: ${error.message}`; }
  }
  return { execute, names: Object.keys(impl) };
}

const TOOL_DEFS = [
  { name: 'list_dir', description: 'اعرض محتويات مجلد داخل المشروع.', properties: { path: { type: 'string' } } },
  { name: 'read_file', description: 'اقرأ ملفًا نصيًا مع أرقام الأسطر. استخدم start_line وend_line للملفات الطويلة.', properties: { path: { type: 'string' }, start_line: { type: 'integer' }, end_line: { type: 'integer' } }, required: ['path'] },
  { name: 'grep', description: 'ابحث بتعبير نمطي (غير حساس للحالة) في الملفات.', properties: { pattern: { type: 'string' }, path: { type: 'string' } }, required: ['pattern'] },
  { name: 'edit_file', description: 'استبدل نصًا فريدًا في ملف. old_str يجب أن يظهر مرة واحدة بالضبط. اقرأ الملف أولًا.', properties: { path: { type: 'string' }, old_str: { type: 'string' }, new_str: { type: 'string' } }, required: ['path', 'old_str', 'new_str'] },
  { name: 'write_file', description: 'أنشئ ملفًا جديدًا أو استبدله بالكامل.', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
  { name: 'run_command', description: 'شغّل أمر shell داخل مجلد المشروع (اختبارات، git، بناء). بدون تفاعل.', properties: { command: { type: 'string' }, timeout_seconds: { type: 'integer' } }, required: ['command'] },
].map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: { type: 'object', properties: t.properties, required: t.required || [] } } }));

module.exports = { createTools, TOOL_DEFS, resolveInside, BLOCKED_COMMANDS };
