const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const main = read('android-app/app/src/main/java/com/cue/qureohelper/MainActivity.java');
const activity = read('android-app/app/src/main/java/com/cue/qureohelper/QureoActivity.java');
const launcher = read('android-app/app/src/main/assets/app.js');
const html = read('android-app/app/src/main/assets/index.html');

test('launcher has one native assistant-server preflight and no duplicate JavaScript check', () => {
  assert.equal((main.match(/verifyAssistantServer\(/g) || []).length, 2, 'one declaration plus one call');
  assert.doesNotMatch(launcher, /CueQureoPreflight\.checkAssistantServer/);
  assert.match(main, /reason \+ " فُتح QUREO في وضع تسجيل الدخول فقط/);
  assert.match(main, /عنوان خادم المساعد غير صالح؛ فُتح QUREO في وضع تسجيل الدخول فقط/);
});

test('Android control bar is below the WebView and fitted to system-bar insets', () => {
  const webViewIndex = activity.indexOf('root.addView(webView');
  const statusIndex = activity.indexOf('root.addView(statusView');
  const controlBarIndex = activity.indexOf('root.addView(bar);');
  assert.ok(webViewIndex >= 0 && webViewIndex < statusIndex && statusIndex < controlBarIndex);
  assert.match(activity, /root\.setOnApplyWindowInsetsListener/);
  assert.match(activity, /WindowInsets\.Type\.systemBars\(\)/);
  assert.match(activity, /getSystemWindowInsetBottom\(\)/);
});

test('answer confirmation polling remains bounded while post-action pauses stay short', () => {
  assert.match(activity, /MAX_ANSWER_RESULT_POLLS = 12/);
  assert.match(activity, /POLL_MS = 1500L/);
  assert.match(activity, /ACTION_VERIFY_MS = 450L/);
  assert.match(activity, /LOGIN_RETRY_MS = 600L/);
  assert.doesNotMatch(activity, /scheduleInspect\((?:3000|5000)\)/);
});

test('learning-login chooser is limited to the real portal, one exact visible control and one click', () => {
  assert.match(activity, /location\.hostname==='me-portal\.qureo\.education'&&path==='\/login'/);
  assert.match(activity, /if\(!pws\.length&&!opened/);
  assert.match(activity, /Go to Learning Login/);
  assert.match(activity, /انتقل إلى تسجيل الدخول للتعلم/);
  assert.match(activity, /choices\.length===1/);
  assert.match(activity, /learningLoginOpened = true/);
});

test('launcher accurately limits automatic-solving claims and discloses model-error limits', () => {
  assert.match(html, /التشغيل الآلي محدود بأنواع وأسئلة وأزرار مدعومة/);
  assert.match(html, /لا يضمن إكمال كل الدروس/);
  assert.match(html, /درجة الثقة أو التحقق النصي ليسا برهانًا/);
  assert.doesNotMatch(html, /لن يضغط Check أو Submit|تضغط Check بنفسك|اضغط Check\/Submit بنفسك/);
});

test('home screen is an Arabic conversational assistant limited to QUREO solving', () => {
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(html, /مساعد عربي عام مع وضع QUREO آمن/);
  assert.match(html, /value="general" checked/);
  assert.match(html, /value="qureo"/);
  assert.match(html, /id="openManusToggle"/);
  assert.match(html, /id="qureoUsername"/);
  assert.match(html, /id="qureoPassword"/);
  assert.match(html, /id="startQureoAutoBtn"/);
  assert.match(html, /id="chatTranscript"/);
  assert.match(html, /id="solveBtn"/);
  assert.match(html, /لحل أسئلة جديدة آليًا، يلزم أيضًا تهيئة خادم المساعد وكلمة مروره/);
  assert.match(html, /value="JavaScript" checked> JavaScript/);
  assert.doesNotMatch(html, /اختار Java أو Python/);
});

test('chat follows short conversational context in memory without persisting the transcript', () => {
  assert.match(launcher, /const chatHistory = \[\]/);
  assert.match(launcher, /chatHistory\.slice\(-4\)/);
  assert.match(launcher, /if \(chatHistory\.length > 20\) chatHistory\.splice/);
  assert.match(launcher, /mohamedAiRememberChat/);
  assert.match(launcher, /function persistChatMemory\(\)/);
});
