const $ = id => document.getElementById(id);
const question = $('question');
const imageInput = $('imageInput');
const previewWrap = $('previewWrap');
const preview = $('preview');
const status = $('status');
const solveBtn = $('solveBtn');
const answerCard = $('answerCard');
const answerText = $('answerText');
const chatTranscript = $('chatTranscript');
const DB_NAME = 'qureo-helper-local';
const DB_STORE = 'tasks';
const DB_KEY = 'active-task';
const LOCAL_PREPARED_KEY = 'qureoLocalModelPrepared';
const SERVER_BASE_KEY = 'qureoPrivateServerBaseUrl';
const DEFAULT_WORKER_URL = 'https://qureo-helper.qureo-helper.workers.dev';
const ASSISTANT_MODE_KEY = 'mohamedAiAssistantMode';
const REMEMBER_CHAT_KEY = 'mohamedAiRememberChat';
const CHAT_MEMORY_KEY = 'mohamedAiChatMemory';
const RESPONSE_STYLE_KEY = 'mohamedAiResponseStyle';
let responseStyle = localStorage.getItem(RESPONSE_STYLE_KEY) || 'balanced';
let assistantMode = localStorage.getItem(ASSISTANT_MODE_KEY) === 'qureo' ? 'qureo' : 'general';
const ANDROID_NATIVE = new URLSearchParams(window.location.search).get('native') === '1';
let imageData = '';
const imageLoadGuard = window.QureoImageLoadGuard();
let installPrompt = null;
let dbPromise;

$('appPassword').value = '';
const modeInputs = [...document.querySelectorAll('input[name=assistantMode]')];
function applyAssistantMode() {
  const isQureo = assistantMode === 'qureo';
  modeInputs.forEach(input => { input.checked = input.value === assistantMode; });
  $('qureoAutoCard').style.display = isQureo && ANDROID_NATIVE ? 'block' : 'none';
  $('solutionLibraryCard').style.display = isQureo && ANDROID_NATIVE ? 'block' : 'none';
  $('modePill').textContent = isQureo ? 'وضع QUREO' : 'مساعد عام';
  $('introTitle').textContent = isQureo ? 'أهلًا، أنا مساعد QUREO الآمن.' : 'أهلًا، أنا Mohamed AI.';
  $('introText').textContent = isQureo ? 'أرسل سؤال JavaScript أو Python أو صورة له. سأشرح لك، ولن أضغط إجابة إلا داخل الأنواع المدعومة وبعد تحقق محلي واضح.' : 'اسألني بالعربي عن الدراسة، البرمجة، الكتابة، الترجمة، التخطيط أو أي موضوع عام. أشرح بوضوح وأقول لك عندما لا أستطيع التحقق من معلومة.';
  $('introLimit').textContent = isQureo ? 'لا أخمّن — إذا كان السؤال ملتبسًا أتوقف' : 'لا أختلق المعلومات — اطلب مصادر أو تحقق من الأمور المهمة';
  $('questionLabel').textContent = isQureo ? 'سؤالك عن QUREO' : 'رسالتك';
  $('question').placeholder = isQureo ? 'اكتب سؤال JavaScript أو Python أو قلّي الجزء غير الواضح…' : 'اكتب سؤالك أو اطلب مني مهمة…';
  $('disclaimer').textContent = isQureo ? 'المحادثة تشرح فقط ولا تضغط الإجابة على QUREO. التشغيل الآلي محصور بالأنواع المدعومة.' : 'لا تضع كلمات المرور أو البيانات الحساسة في المحادثة.';
  $('chatHeading').textContent = isQureo ? 'محادثة QUREO' : 'المحادثة';
}
modeInputs.forEach(input => input.addEventListener('change', () => { assistantMode = input.value; localStorage.setItem(ASSISTANT_MODE_KEY, assistantMode); applyAssistantMode(); }));
applyAssistantMode();
$('clearPassword').addEventListener('click', () => { $('appPassword').value = ''; });
const responseStyleInput = $('responseStyle');
if (!['balanced', 'concise', 'detailed', 'steps'].includes(responseStyle)) responseStyle = 'balanced';
responseStyleInput.value = responseStyle;
responseStyleInput.addEventListener('change', () => { responseStyle = responseStyleInput.value; localStorage.setItem(RESPONSE_STYLE_KEY, responseStyle); });
const rememberChatToggle = $('rememberChatToggle');
rememberChatToggle.checked = localStorage.getItem(REMEMBER_CHAT_KEY) === 'yes';
rememberChatToggle.addEventListener('change', () => {
  localStorage.setItem(REMEMBER_CHAT_KEY, rememberChatToggle.checked ? 'yes' : 'no');
  if (!rememberChatToggle.checked) localStorage.removeItem(CHAT_MEMORY_KEY);
});
function persistChatMemory() {
  if (!rememberChatToggle.checked) return;
  try { localStorage.setItem(CHAT_MEMORY_KEY, JSON.stringify(chatHistory.slice(-20))); } catch {}
}
function restoreChatMemory() {
  if (!rememberChatToggle.checked) return;
  try {
    const saved = JSON.parse(localStorage.getItem(CHAT_MEMORY_KEY) || '[]');
    if (!Array.isArray(saved)) return;
    saved.filter(item => ['user', 'assistant'].includes(item?.role) && item?.text).forEach(item => {
      appendChatMessage(item.role, item.text, false);
      chatHistory.push({ role: item.role, text: String(item.text).slice(0, 1800) });
    });
  } catch {}
}
function clearChat() {
  chatHistory.length = 0;
  latestAssistantAnswer = '';
  localStorage.removeItem(CHAT_MEMORY_KEY);
  chatTranscript.querySelectorAll('.bubble, .answer-card').forEach(node => node.remove());
  appendChatMessage('assistant', 'تم مسح المحادثة. أنا جاهز لسؤالك الجديد.', false);
}
function exportChat() {
  const lines = chatHistory.map(item => `${item.role === 'user' ? 'أنت' : 'Mohamed AI'}: ${item.text}`);
  if (!lines.length) { setStatus('لا توجد محادثة لتصديرها.', true); return; }
  const blob = new Blob([lines.join('\n\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = 'mohamed-ai-chat.txt'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('clearChatBtn').addEventListener('click', clearChat);
$('exportChatBtn').addEventListener('click', exportChat);
if (ANDROID_NATIVE) {
  $('serverBox').style.display = 'block';
  $('serverBaseUrl').value = localStorage.getItem(SERVER_BASE_KEY) || DEFAULT_WORKER_URL;
  $('serverBaseUrl').addEventListener('input', () => localStorage.setItem(SERVER_BASE_KEY, $('serverBaseUrl').value.trim()));
}

$('startQureoAutoBtn').addEventListener('click', async () => {
  const startButton = $('startQureoAutoBtn');
  if (startButton.disabled) return;
  const username = $('qureoUsername').value.trim();
  const password = $('qureoPassword').value;
  const track = document.querySelector('input[name="qureoTrack"]:checked')?.value || '';
  const baseUrl = $('serverBaseUrl')?.value.trim() || '';
  const appPassword = $('appPassword').value.trim();
  const useSolutionLibrary = $('useSolutionLibrary').checked;
  if (!username || !password) { $('autoStatus').textContent = 'أدخل اسم المستخدم وكلمة مرور QUREO أولًا.'; return; }
  if (!['JavaScript', 'Java', 'Python'].includes(track)) { $('autoStatus').textContent = 'اختر JavaScript أو Python.'; return; }
  if (!window.CueQureo || typeof window.CueQureo.startQureoAutomation !== 'function') {
    $('autoStatus').textContent = 'ميزة التشغيل التلقائي متاحة داخل نسخة Android فقط.';
    return;
  }
  startButton.disabled = true;
  $('autoStatus').textContent = 'أفتح QUREO؛ يُفحص خادم المساعد مرة واحدة فقط. إن تعذّر الفحص، سيبقى تسجيل الدخول متاحًا دون إرسال نص الدرس إلى الخادم.';
  try {
    window.CueQureo.startQureoAutomation(username, password, track, baseUrl, appPassword, useSolutionLibrary);
    $('qureoUsername').value = '';
    $('qureoPassword').value = '';
    $('appPassword').value = '';
    $('autoStatus').textContent = `أُرسل طلب فتح QUREO لمسار ${track}. ستُمحى بيانات الدخول من شاشة التطبيق بعد الطلب.`;
  } catch {
    $('autoStatus').textContent = 'تعذّر فتح جلسة QUREO؛ أعد المحاولة.';
  } finally {
    startButton.disabled = false;
  }
});

function refreshSolutionLibraryCount() {
  if (!ANDROID_NATIVE || !window.CueQureo || typeof window.CueQureo.getSolutionCount !== 'function') return;
  const count = Number(window.CueQureo.getSolutionCount());
  $('solutionLibraryCount').textContent = `حلول محفوظة على هذا الجهاز: ${Number.isFinite(count) ? count : 0}. لا تُربط بحساب ولا تُرفع إلى الخادم؛ لا تُستخدم إلا عند التطابق الدقيق.`;
}
window.refreshSolutionLibraryCount = refreshSolutionLibraryCount;
$('refreshSolutionCountBtn').addEventListener('click', refreshSolutionLibraryCount);
$('clearSolutionLibraryBtn').addEventListener('click', () => {
  if (ANDROID_NATIVE && window.CueQureo?.clearSolutionLibrary) window.CueQureo.clearSolutionLibrary();
});
if (ANDROID_NATIVE) refreshSolutionLibraryCount();

function solveEndpoint() {
  const base = $('serverBaseUrl')?.value.trim() || '';
  if (!base) return ANDROID_NATIVE ? null : '/api/solve';
  let parsed;
  try { parsed = new URL(base); } catch { throw new Error('أدخل عنوانًا صحيحًا يبدأ بـ https://.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('استخدم عنوان خادم HTTPS فقط، من دون مسار أو بيانات دخول داخل الرابط.');
  }
  return `${parsed.origin}/api/solve`;
}

function setStatus(text, isError = false) {
  status.textContent = text;
  status.classList.toggle('error', isError);
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('التخزين المحلي غير متاح في هذا المتصفح.'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('تعذّر فتح التخزين المحلي.'));
  });
  return dbPromise;
}

async function putTask(task) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(task, DB_KEY);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('تعذّر حفظ المهمة.'));
    tx.onabort = () => reject(tx.error || new Error('أُوقف حفظ المهمة.'));
  });
}

async function saveTask(task) {
  try {
    await putTask(task);
    localStorage.removeItem('qureoPendingTask');
  } catch (error) {
    // Storage fallback preserves text only if the browser cannot store the image blob.
    const smallTask = { ...task, image: '', imageOmitted: Boolean(task.image) };
    try {
      localStorage.setItem('qureoPendingTask', JSON.stringify(smallTask));
    } catch {
      throw new Error('لم أستطع حفظ السؤال على الهاتف؛ تحقّق من مساحة التخزين ثم أعد المحاولة.');
    }
    if (task.image) $('savedHint').textContent = 'حُفظ نص السؤال فقط؛ الصورة كبيرة أو لم تتوفر مساحة كافية.';
  }
}

async function loadTask() {
  try {
    const db = await openDb();
    const value = await new Promise((resolve, reject) => {
      const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(DB_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    if (value) return value;
  } catch {}
  try { return JSON.parse(localStorage.getItem('qureoPendingTask') || 'null'); } catch { return null; }
}

async function removeTask() {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(DB_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
  localStorage.removeItem('qureoPendingTask');
  $('savedTaskBox').style.display = 'none';
}

function showSavedTask(task) {
  if (!task) {
    $('savedTaskBox').style.display = 'none';
    return;
  }
  $('savedTaskBox').style.display = 'block';
  $('savedHint').textContent = task.imageOmitted
    ? 'المهمة المحفوظة لا تتضمن الصورة؛ أعد اختيارها أو اكتب نص السؤال.'
    : 'تُحفظ المهمة على هذا الهاتف فقط إلى أن تنجح المعالجة أو تمسحها.';
}

function clearImage() {
  const pendingUrl = imageLoadGuard.invalidate();
  if (pendingUrl) URL.revokeObjectURL(pendingUrl);
  imageData = '';
  imageInput.value = '';
  preview.removeAttribute('src');
  previewWrap.style.display = 'none';
}

function loadImage(file) {
  const previousUrl = imageLoadGuard.invalidate();
  if (previousUrl) URL.revokeObjectURL(previousUrl);
  imageData = '';
  preview.removeAttribute('src');
  previewWrap.style.display = 'none';
  if (!file || !file.type.startsWith('image/')) { imageInput.value = ''; setStatus('اختَر ملف صورة صالحًا.', true); return; }
  if (file.size > 16 * 1024 * 1024) { imageInput.value = ''; setStatus('حجم الصورة كبير؛ خذ لقطة أصغر ثم جرّب.', true); return; }
  const localUrl = URL.createObjectURL(file);
  const { token } = imageLoadGuard.begin(localUrl);
  preview.src = localUrl;
  previewWrap.style.display = 'block';
  setStatus('جاري تجهيز الصورة…');
  const img = new Image();
  img.onload = () => {
    if (!imageLoadGuard.isCurrent(token)) { URL.revokeObjectURL(localUrl); return; }
    const maxSide = 1500;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) { clearImage(); setStatus('تعذّر تجهيز الصورة على هذا الهاتف.', true); return; }
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    imageData = canvas.toDataURL('image/jpeg', 0.82);
    URL.revokeObjectURL(localUrl);
    imageLoadGuard.finish(token, localUrl);
    setStatus('الصورة جاهزة.');
  };
  img.onerror = () => {
    if (!imageLoadGuard.isCurrent(token)) { URL.revokeObjectURL(localUrl); return; }
    clearImage();
    setStatus('لم أستطع قراءة الصورة؛ جرّب صورة أخرى.', true);
  };
  img.src = localUrl;
}

imageInput.addEventListener('change', () => loadImage(imageInput.files?.[0]));
$('removeImage').addEventListener('click', clearImage);

function updateLocalInfo(text) {
  $('localStatus').textContent = text;
}

function setAnswer(text, source) {
  latestAssistantAnswer = text;
  answerText.textContent = text;
  $('answerSource').textContent = source;
  const card = answerCard.cloneNode(true);
  card.removeAttribute('id');
  card.removeAttribute('aria-hidden');
  card.hidden = false;
  card.style.display = 'block';
  card.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
  card.querySelector('.answer-text').textContent = text;
  card.querySelector('.answer-source').textContent = source;
  const copyButton = card.querySelector('.answer-tools button:first-child');
  const shareButton = card.querySelector('.answer-tools button:last-child');
  copyButton.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text); copyButton.textContent = 'تم النسخ'; setTimeout(() => { copyButton.textContent = 'نسخ'; }, 1600); }
    catch { setStatus('تعذّر النسخ؛ حدّد الشرح وانسخه يدويًا.', true); }
  });
  shareButton.addEventListener('click', async () => {
    if (navigator.share) { try { await navigator.share({ title: assistantMode === 'qureo' ? 'شرح سؤال QUREO' : 'Mohamed AI', text }); } catch {} }
    else { try { await navigator.clipboard.writeText(text); setStatus('نُسخ الشرح؛ يمكنك لصقه في التطبيق الذي تريده.'); } catch { setStatus('المشاركة غير متاحة على هذا المتصفح.', true); } }
  });
  chatTranscript.appendChild(card);
  rememberChatEntry('assistant', text);
  chatTranscript.scrollTop = chatTranscript.scrollHeight;
}

let latestAssistantAnswer = '';
const chatHistory = [];

function rememberChatEntry(role, text) {
  chatHistory.push({ role, text: String(text || '').slice(0, 1800) });
  if (chatHistory.length > 20) chatHistory.splice(0, chatHistory.length - 20);
  persistChatMemory();
}

function appendChatMessage(role, text, remember = false) {
  const bubble = document.createElement('div');
  bubble.className = `bubble ${role}`;
  const label = document.createElement('span');
  label.className = 'bubble-label';
  label.textContent = role === 'user' ? 'أنت' : 'Mohamed AI';
  bubble.append(label, document.createTextNode(String(text || '')));
  chatTranscript.appendChild(bubble);
  if (remember) rememberChatEntry(role, text);
  chatTranscript.scrollTop = chatTranscript.scrollHeight;
}

function questionWithConversation(questionText, image) {
  const current = String(questionText || '').trim() || (image ? 'أرفقت صورة لسؤال QUREO.' : '');
  if (!chatHistory.length) return String(questionText || '');
  const remaining = Math.max(0, 11200 - current.length);
  if (!remaining) return current;
  const context = chatHistory.slice(-4).map(item => `${item.role === 'user' ? 'الطالب' : 'المساعد'}: ${item.text}`).join('\n');
  const header = assistantMode === 'qureo' ? '\n\nسياق مختصر من محادثة أسئلة QUREO السابقة:\n' : '\n\nسياق مختصر من المحادثة السابقة:\n';
  return `${current}${header}${context.slice(-remaining)}`;
}

function localIsPrepared() {
  return localStorage.getItem(LOCAL_PREPARED_KEY) === 'yes';
}

async function prepareLocal() {
  const button = $('prepareLocalBtn');
  if (QureoLocal.isLowMemory()) {
    updateLocalInfo('هذا الهاتف يبلّغ عن ذاكرة أقل من 4 GB؛ لم أبدأ التنزيل حفاظًا على استقرار المتصفح. تظل المهمة محفوظة للاستئناف عند عودة السحابة أو على جهاز أقوى.');
    return;
  }
  button.disabled = true;
  try {
    await QureoLocal.prepare(updateLocalInfo);
    localStorage.setItem(LOCAL_PREPARED_KEY, 'yes');
    updateLocalInfo('النموذج المحلي جاهز. يمكن استخدامه للنص عند انقطاع السحابة؛ لن تُرسل نصوصك إلى مزوّد النموذج في هذا المسار.');
    const saved = await loadTask();
    showSavedTask(saved);
  } catch (error) {
    updateLocalInfo(`${error.message || 'تعذّر تجهيز النموذج.'} لم تُحذف المهمة المحفوظة.`);
  } finally {
    button.disabled = false;
    button.textContent = 'إعادة تجهيز النموذج المحلي';
  }
}

$('prepareLocalBtn').addEventListener('click', prepareLocal);
$('clearSavedBtn').addEventListener('click', async () => {
  await removeTask();
  if (question.value || imageData) setStatus('مُسحت المهمة المحفوظة.');
});
$('resumeSavedBtn').addEventListener('click', async () => {
  const task = await loadTask();
  if (!task) { showSavedTask(null); return; }
  question.value = task.question || '';
  if (task.image) {
    imageData = task.image;
    preview.src = imageData;
    previewWrap.style.display = 'block';
  } else {
    clearImage();
  }
  await runTask({ question: task.question || '', image: task.image || '' });
});

async function runTask(task) {
  const text = String(task.question || '').trim();
  const image = task.image || '';
  if (!text && !image) { setStatus('اكتب السؤال أو أرفق صورة أولًا.', true); return; }
  const requestQuestion = questionWithConversation(text, image);

  const localPrepareWasDisabled = $('prepareLocalBtn').disabled;
  const finishRun = () => {
    solveBtn.disabled = false;
    $('prepareLocalBtn').disabled = localPrepareWasDisabled;
  };
  solveBtn.disabled = true;
  $('prepareLocalBtn').disabled = true;
  answerCard.style.display = 'none';
  const saved = { question: text, image, stage: 'processing', savedAt: Date.now() };
  try {
    await saveTask(saved);
    showSavedTask(saved);
  } catch (error) {
    setStatus(error.message, true);
    finishRun();
    return;
  }
  const userMessage = text || (assistantMode === 'qureo' ? 'أرفقت صورة لسؤال QUREO.' : 'أرفقت صورة للتحليل.');
  appendChatMessage('user', userMessage);
  rememberChatEntry('user', userMessage);

  let cloudFailure = '';
  setStatus(ANDROID_NATIVE && !$('serverBaseUrl').value.trim()
    ? 'لم يُضبط خادم سحابي؛ سأجرّب النموذج المحلي إن كان جاهزًا…'
    : 'أحاول Gemini ثم Groq بالتتابع…');
  try {
    const endpoint = solveEndpoint();
    if (!endpoint) throw new Error('لم يُضبط عنوان خادم سحابي.');
    const headers = { 'Content-Type': 'application/json' };
    const password = $('appPassword').value.trim();
    if (password) headers.Authorization = `Bearer ${password}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 85000);
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ question: requestQuestion, image, mode: assistantMode, responseStyle }),
        signal: controller.signal,
      });
    } finally { clearTimeout(timer); }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'تعذّر الحل السحابي.');
    await removeTask();
    const providerNames = { gemini: 'Gemini', groq: 'Groq', mock: 'وضع المعاينة' };
    const provider = providerNames[result.provider] || 'السحابة';
    setAnswer(result.answer || 'لم يصل شرح من النموذج.', `المعالجة عبر ${provider}${result.fallbackUsed ? ' بعد تعذّر المزود الأساسي' : ''}.`);
    setStatus('جهزت الإجابة المقترحة. راجع الشرح واختر بنفسك على QUREO.');
    finishRun();
    return;
  } catch (error) {
    cloudFailure = error.name === 'AbortError'
      ? 'استغرق الاتصال السحابي وقتًا طويلًا.'
      : (error.message || 'تعذّر الاتصال بالخادم.');
  }

  const canTryLocal = localIsPrepared() || QureoLocal.isReady();
  if (canTryLocal && !image) {
    try {
      setStatus(`${cloudFailure} أجرّب الآن النموذج المحلي على الهاتف…`);
      const answer = await QureoLocal.generate(requestQuestion, updateLocalInfo);
      await removeTask();
      setAnswer(answer, 'أُنتج الشرح على الهاتف دون إرسال نص السؤال إلى خدمة سحابية. النموذج صغير وقد يخطئ؛ تحقّق من الإجابة.');
      setStatus('اكتمل الشرح المحلي.');
      finishRun();
      return;
    } catch (error) {
      cloudFailure += ` تعذّرت المعالجة المحلية أيضًا: ${error.message || 'خطأ في النموذج المحلي.'}`;
    }
  } else if (image) {
    cloudFailure += ' النموذج المحلي نصّي ولا يقرأ الصور؛ اكتب نص السؤال أو أعد المحاولة عند عودة السحابة.';
  } else {
    cloudFailure += ' لتفعيل الاستمرار على الهاتف، جهّز النموذج المحلي مرة واحدة من الزر أعلاه؛ تنزيله الأول يحتاج إنترنت ومساحة تخزين.';
  }

  const stillSaved = await loadTask();
  showSavedTask(stillSaved || saved);
  setStatus(`${cloudFailure} بقيت المهمة محفوظة على الهاتف؛ اضغط «استئناف المهمة المحفوظة» بعد تجهيز النموذج أو عودة الاتصال.`, true);
  const waitingReply = `ما قدرت أجهز الرد الآن. ${cloudFailure} حفظت السؤال على الهاتف لتقدر تستأنفه لاحقًا.`;
  appendChatMessage('assistant', waitingReply);
  rememberChatEntry('assistant', waitingReply);
  finishRun();
}

solveBtn.addEventListener('click', () => runTask({ question: question.value, image: imageData }));
$('copyBtn').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(latestAssistantAnswer || answerText.textContent); $('copyBtn').textContent = 'تم النسخ'; setTimeout(() => $('copyBtn').textContent = 'نسخ', 1600); }
  catch { setStatus('تعذّر النسخ؛ حدّد الشرح وانسخه يدويًا.', true); }
});
$('shareBtn').addEventListener('click', async () => {
  const text = latestAssistantAnswer || answerText.textContent;
  if (navigator.share) { try { await navigator.share({ title: assistantMode === 'qureo' ? 'شرح سؤال QUREO' : 'Mohamed AI', text }); } catch {} }
  else { try { await navigator.clipboard.writeText(text); setStatus('نُسخ الشرح؛ يمكنك لصقه في التطبيق الذي تريده.'); } catch { setStatus('المشاركة غير متاحة على هذا المتصفح.', true); } }
});

window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('installBtn').style.display = 'inline-block'; });
$('installBtn').addEventListener('click', async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $('installBtn').style.display = 'none'; });

(async () => {
  if (QureoLocal.isLowMemory()) {
    updateLocalInfo('هذا الجهاز يبلّغ عن ذاكرة أقل من 4 GB؛ سأحفظ أي مهمة لكن لن أحمّل النموذج المحلي عليه.');
    $('prepareLocalBtn').disabled = true;
  } else if (localIsPrepared()) {
    updateLocalInfo('سبق تجهيز النموذج. عند تعذّر السحابة سيُحاول التطبيق تحميله من التخزين المحلي (وقد تُزيل المتصفحات الملفات المؤقتة).');
  } else {
    updateLocalInfo('اختياري: تنزيل أولي بحجم مئات الميغابايت، ثم يمكن محاولة معالجة النص على الهاتف. استخدم Wi‑Fi إن أمكن.');
  }
  restoreChatMemory();
  const saved = await loadTask();
  if (saved) {
    showSavedTask(saved);
    question.value = saved.question || '';
    if (saved.image) {
      imageData = saved.image;
      preview.src = imageData;
      previewWrap.style.display = 'block';
    }
    setStatus('وجدت مهمة محفوظة من محاولة سابقة. يمكنك استئنافها أو مسحها.');
  }
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
