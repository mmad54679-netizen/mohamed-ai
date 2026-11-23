// تكامل GitHub المباشر: قراءة سياق المستودعات المذكورة في المحادثة، وكتابة محدودة (Issue/تعليق) بموافقة صريحة.
const API = 'https://api.github.com';
const MAX_REFS = 3;
const MAX_FILE_CHARS = 12000;
const MAX_README_CHARS = 8000;

function parseGithubRefs(text) {
  const refs = [];
  const seen = new Set();
  const pattern = /https?:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})(?:\/(?:blob|tree)\/([A-Za-z0-9._-]{1,120})(?:\/([A-Za-z0-9._\/-]{1,300}))?)?/g;
  for (const match of String(text || '').matchAll(pattern)) {
    const owner = match[1];
    const repo = match[2].replace(/\.git$/, '').replace(/[.]+$/, '');
    if (!repo) continue;
    const ref = match[3] || '';
    const filePath = (match[4] || '').replace(/\/+$/, '');
    const key = `${owner}/${repo}@${ref}:${filePath}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ owner, repo, ref, path: filePath });
    if (refs.length >= MAX_REFS) break;
  }
  return refs;
}

function allowedOwners(env) {
  return String(env.GITHUB_ALLOWED_OWNERS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

// الرمز السري يُستخدم فقط مع الملاك المسموحين صراحةً؛ غير ذلك قراءة عامة بدون رمز.
function tokenFor(owner, env) {
  return env.GITHUB_TOKEN && allowedOwners(env).includes(owner.toLowerCase()) ? env.GITHUB_TOKEN : '';
}

async function ghFetch({ fetchImpl, token, endpoint, method = 'GET', body, timeoutMs = 10000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${API}${endpoint}`, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'mohamed-ai',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.message || `GitHub ${response.status}`), { status: response.status });
    return data;
  } finally { clearTimeout(timer); }
}

const decode = file => (file.encoding === 'base64' ? Buffer.from(file.content || '', 'base64').toString('utf8') : String(file.content || ''));
const q = value => encodeURIComponent(value);
const pathQuery = filePath => filePath.split('/').map(q).join('/');

async function fetchRepoContext({ fetchImpl, env, ref }) {
  const token = tokenFor(ref.owner, env);
  const base = `/repos/${q(ref.owner)}/${q(ref.repo)}`;
  const refQuery = ref.ref ? `?ref=${q(ref.ref)}` : '';
  const source = `https://github.com/${ref.owner}/${ref.repo}${ref.path ? `/blob/${ref.ref || 'HEAD'}/${ref.path}` : ''}`;
  try {
    if (ref.path) {
      const file = await ghFetch({ fetchImpl, token, endpoint: `${base}/contents/${pathQuery(ref.path)}${refQuery}` });
      if (Array.isArray(file)) {
        return { source, text: `مجلد ${ref.owner}/${ref.repo}/${ref.path}: ${file.slice(0, 50).map(f => f.name + (f.type === 'dir' ? '/' : '')).join(', ')}` };
      }
      if (file.type !== 'file' || Number(file.size || 0) > 500 * 1024) return null;
      return { source, text: `ملف ${ref.owner}/${ref.repo}/${ref.path}:\n${decode(file).slice(0, MAX_FILE_CHARS)}` };
    }
    const [info, readme, tree] = await Promise.all([
      ghFetch({ fetchImpl, token, endpoint: base }),
      ghFetch({ fetchImpl, token, endpoint: `${base}/readme${refQuery}` }).catch(() => null),
      ghFetch({ fetchImpl, token, endpoint: `${base}/contents${refQuery}` }).catch(() => []),
    ]);
    const names = Array.isArray(tree) ? tree.slice(0, 40).map(f => f.name + (f.type === 'dir' ? '/' : '')).join(', ') : '';
    const text = [
      `مستودع ${info.full_name}${info.private ? ' (خاص)' : ''}: ${info.description || 'بدون وصف'}`,
      `اللغة: ${info.language || 'غير محددة'} | الفرع الافتراضي: ${info.default_branch}`,
      names ? `الملفات في الجذر: ${names}` : '',
      readme ? `README:\n${decode(readme).slice(0, MAX_README_CHARS)}` : '',
    ].filter(Boolean).join('\n');
    return { source, text };
  } catch { return null; }
}

function checkWrite({ env, owner, repo, confirm }) {
  if (env.GITHUB_WRITE !== '1') throw Object.assign(new Error('الكتابة على GitHub غير مفعّلة على الخادم (GITHUB_WRITE=1).'), { status: 403, code: 'GITHUB_WRITE_DISABLED' });
  if (!env.GITHUB_TOKEN) throw Object.assign(new Error('تكامل GitHub غير مهيأ على الخادم.'), { status: 503, code: 'GITHUB_NOT_CONFIGURED' });
  if (!allowedOwners(env).includes(String(owner).toLowerCase())) throw Object.assign(new Error('المالك غير موجود في GITHUB_ALLOWED_OWNERS.'), { status: 403, code: 'GITHUB_OWNER_NOT_ALLOWED' });
  if (confirm !== true) throw Object.assign(new Error('يلزم تأكيد صريح (confirm: true) قبل أي كتابة.'), { status: 400, code: 'CONFIRMATION_REQUIRED' });
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(String(repo))) throw Object.assign(new Error('اسم المستودع غير صالح.'), { status: 400 });
}

async function createIssue({ fetchImpl, env, owner, repo, title, body, confirm }) {
  checkWrite({ env, owner, repo, confirm });
  const cleanTitle = String(title || '').trim().slice(0, 200);
  if (!cleanTitle) throw Object.assign(new Error('عنوان الـ Issue مطلوب.'), { status: 400 });
  const issue = await ghFetch({ fetchImpl, token: env.GITHUB_TOKEN, endpoint: `/repos/${q(owner)}/${q(repo)}/issues`, method: 'POST', body: { title: cleanTitle, body: String(body || '').slice(0, 20000) } });
  return { number: issue.number, url: issue.html_url };
}

async function commentOnIssue({ fetchImpl, env, owner, repo, number, body, confirm }) {
  checkWrite({ env, owner, repo, confirm });
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1) throw Object.assign(new Error('رقم الـ Issue غير صالح.'), { status: 400 });
  const text = String(body || '').trim().slice(0, 20000);
  if (!text) throw Object.assign(new Error('نص التعليق مطلوب.'), { status: 400 });
  const comment = await ghFetch({ fetchImpl, token: env.GITHUB_TOKEN, endpoint: `/repos/${q(owner)}/${q(repo)}/issues/${n}/comments`, method: 'POST', body: { body: text } });
  return { url: comment.html_url };
}

module.exports = { parseGithubRefs, fetchRepoContext, createIssue, commentOnIssue, allowedOwners };
