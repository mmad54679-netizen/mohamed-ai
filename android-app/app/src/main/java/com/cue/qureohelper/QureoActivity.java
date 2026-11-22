package com.cue.qureohelper;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.HashSet;
import java.util.Locale;

public final class QureoActivity extends Activity {
    static final String EXTRA_USERNAME = "qureo_user";
    static final String EXTRA_PASSWORD = "qureo_pass";
    static final String EXTRA_TRACK = "qureo_track";
    static final String EXTRA_SERVER = "private_server";
    static final String EXTRA_APP_PASSWORD = "helper_password";
    static final String EXTRA_USE_LIBRARY = "use_solution_library";
    static final String EXTRA_SERVER_STATUS = "assistant_server_status";

    private static final String START_URL = "https://me-portal.qureo.education/login";
    private static final int MAX_PLANS = 500;
    private static final int MAX_ANSWER_RESULT_POLLS = 12;
    private static final long POLL_MS = 1500L;
    private static final long PAGE_READY_MS = 450L;
    private static final long LOGIN_RETRY_MS = 600L;
    private static final long ACTION_VERIFY_MS = 450L;
    private static final long NAVIGATION_VERIFY_MS = 900L;
    private static final long WAIT_ACTION_MS = 1500L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final HashSet<String> usedCacheKeys = new HashSet<>();
    private final HashSet<String> attemptedQuestionKeys = new HashSet<>();
    private final HashSet<String> delayedNextQuestionKeys = new HashSet<>();
    private final HashSet<String> advancedQuestionKeys = new HashSet<>();
    private WebView webView;
    private TextView statusView;
    private Button pauseButton;
    private Button stopButton;

    private String username;
    private String password;
    private String track;
    private String serverBase;
    private String appPassword;
    private String serverStatus;
    private String lastObservedDiamonds = "";
    private String lastSnapshot = "";
    private String pendingQuestionKey = "";
    private String pendingQuestionText = "";
    private String pendingQuestionUrl = "";
    private String pendingFeedbackBaseline = "";
    private String lastSuccessfulQuestionText = "";
    private String lastSuccessfulQuestionUrl = "";
    private JSONArray pendingAnswerActions = new JSONArray();
    private int repeatedSnapshots;
    private int plansRun;
    private int solutionsSaved;
    private int pageRevision;
    private int loginWaits;
    private int loginResultWaits;
    private boolean loginSubmitted;
    private boolean loginAttemptInFlight;
    private boolean learningLoginOpened;
    private boolean requestInFlight;
    private boolean paused;
    private boolean stopped;
    private boolean completed;
    private boolean useSolutionLibrary;
    private boolean autoSubmitPending;
    private boolean awaitingAnswerResult;
    private int answerResultPolls;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        username = getIntent().getStringExtra(EXTRA_USERNAME);
        password = getIntent().getStringExtra(EXTRA_PASSWORD);
        track = getIntent().getStringExtra(EXTRA_TRACK);
        serverBase = normalizeServer(getIntent().getStringExtra(EXTRA_SERVER));
        appPassword = getIntent().getStringExtra(EXTRA_APP_PASSWORD);
        serverStatus = getIntent().getStringExtra(EXTRA_SERVER_STATUS);
        useSolutionLibrary = getIntent().getBooleanExtra(EXTRA_USE_LIBRARY, true);
        getIntent().replaceExtras(new Bundle());

        if (username == null || username.trim().isEmpty() || password == null || password.isEmpty()
                || !("JavaScript".equals(track) || "Java".equals(track) || "Python".equals(track))) {
            username = null;
            password = null;
            appPassword = null;
            finish();
            return;
        }
        if (serverBase == null) {
            serverBase = "";
            appPassword = "";
            if (serverStatus == null || serverStatus.trim().isEmpty()) {
                serverStatus = "عنوان خادم المساعد غير صالح؛ هذه الجلسة ستسمح بتسجيل الدخول فقط.";
            }
        }

        buildScreen();
        webView.loadUrl(START_URL);
    }

    private void buildScreen() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(244, 246, 251));

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(10, 8, 10, 8);
        bar.setBackgroundColor(Color.WHITE);

        pauseButton = new Button(this);
        pauseButton.setText("إيقاف مؤقت");
        pauseButton.setOnClickListener(v -> togglePause());
        bar.addView(pauseButton, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));

        stopButton = new Button(this);
        stopButton.setText("إيقاف");
        stopButton.setOnClickListener(v -> stopAutomation(false));
        bar.addView(stopButton, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));

        statusView = new TextView(this);
        statusView.setTextColor(Color.rgb(35, 53, 85));
        statusView.setTextSize(13);
        statusView.setPadding(14, 10, 14, 10);
        statusView.setMaxLines(2);
        statusView.setEllipsize(TextUtils.TruncateAt.END);
        statusView.setBackgroundColor(Color.rgb(238, 243, 255));
        if (serverBase.isEmpty()) {
            statusView.setText("تسجيل الدخول إلى QUREO متاح؛ الحل السحابي متوقف لهذه الجلسة. "
                    + (useSolutionLibrary ? "قد تعمل الإجابات المطابقة المحفوظة محليًا." : "مكتبة الحلول متوقفة."));
        } else {
            statusView.setText("جار فتح QUREO لمسار " + track + "… بيانات الدخول لا تُرسل إلى خادم الحل. "
                    + (useSolutionLibrary ? "سيُعاد استخدام التطابقات المحفوظة على هذا الجهاز." : "مكتبة الحلول متوقفة لهذه الجلسة."));
        }

        webView = new WebView(this);
        webView.setBackgroundColor(Color.WHITE);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.setSafeBrowsingEnabled(true);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !isQureoUri(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !isQureoUri(Uri.parse(url));
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                pageRevision++;
                loginAttemptInFlight = false;
                if (isQureoUri(Uri.parse(url))) setStatus("جار تحميل صفحة QUREO لمسار " + track + "…");
                else setStatus("أوقفت الانتقال إلى موقع خارج QUREO.");
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (!isQureoUri(Uri.parse(url)) || stopped || paused) return;
                handler.postDelayed(QureoActivity.this::inspectPage, PAGE_READY_MS);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) setStatus("تعذّر تحميل صفحة QUREO. تحقّق من الإنترنت ثم أعد المحاولة.");
            }
        });
        root.addView(webView, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));
        root.addView(statusView);
        root.addView(bar);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int top;
            int bottom;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets systemBars = insets.getInsets(android.view.WindowInsets.Type.systemBars());
                top = systemBars.top;
                bottom = systemBars.bottom;
            } else {
                top = insets.getSystemWindowInsetTop();
                bottom = insets.getSystemWindowInsetBottom();
            }
            view.setPadding(view.getPaddingLeft(), top, view.getPaddingRight(), bottom);
            return insets;
        });
        setContentView(root);
        root.requestApplyInsets();
    }

    private static String normalizeServer(String raw) {
        if (raw == null || raw.trim().isEmpty()) return "";
        try {
            Uri uri = Uri.parse(raw.trim());
            if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null
                    || (uri.getPath() != null && !uri.getPath().isEmpty() && !"/".equals(uri.getPath()))
                    || uri.getQuery() != null || uri.getFragment() != null) return null;
            return uri.buildUpon().path("").build().toString().replaceAll("/$", "");
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    private static boolean isQureoUri(Uri uri) {
        if (uri == null || !"https".equals(uri.getScheme())) return false;
        String host = uri.getHost();
        return host != null && ("qureo.education".equals(host) || host.endsWith(".qureo.education"));
    }

    private void inspectPage() {
        if (stopped || paused || requestInFlight || webView == null) return;
        String currentUrl = webView.getUrl();
        if (currentUrl == null || !isQureoUri(Uri.parse(currentUrl))) {
            setStatus("انتظر صفحة QUREO؛ لا يتم التحكم في أي موقع آخر.");
            scheduleInspect(POLL_MS);
            return;
        }
        if (username != null && password != null && !loginSubmitted) {
            tryAutoLogin();
            return;
        }
        webView.evaluateJavascript(snapshotScript(), result -> {
            if (stopped || paused || result == null) return;
            try {
                Object decoded = new JSONTokener(result).nextValue();
                if (!(decoded instanceof String)) throw new JSONException("Snapshot was not a string");
                JSONObject snapshot = new JSONObject((String) decoded);
                if (snapshot.optBoolean("verification")) {
                    paused = true;
                    updatePauseButton();
                    setStatus("ظهرت خطوة تحقق أمني. أكملها يدويًا على صفحة QUREO ثم اضغط «متابعة».");
                    return;
                }
                if (!snapshot.optBoolean("passwordForm") && loginSubmitted) {
                    loginSubmitted = false;
                    loginResultWaits = 0;
                }
                if (snapshot.optBoolean("passwordForm")) {
                    if (snapshot.optBoolean("loginRejected")) {
                        loginSubmitted = false;
                        username = null;
                        password = null;
                        pauseForManualReview("رفضت صفحة QUREO بيانات الدخول أو بقيت على نموذجها؛ لم أعد المحاولة تلقائيًا. راجعها يدويًا.");
                        return;
                    }
                    int observations = ++loginResultWaits;
                    if (loginSubmitted && QureoLoginPolicy.shouldWaitForLoginTransition(true, false, observations)) {
                        setStatus("أُرسل نموذج الدخول؛ أنتظر اكتمال انتقال QUREO إلى المسار…");
                        scheduleInspect(LOGIN_RETRY_MS);
                        return;
                    }
                    paused = true;
                    updatePauseButton();
                    setStatus("لم يظهر انتقال واضح بعد تسجيل الدخول. أكمل نموذج QUREO يدويًا ثم اضغط «متابعة»؛ لم أرسل كلمة المرور إلى خادم الحل.");
                    return;
                }
                lastObservedDiamonds = snapshot.optString("diamonds", lastObservedDiamonds);
                String questionKey = SolutionLibrary.fingerprint(track, snapshot);
                if (autoSubmitPending) {
                    automaticallySubmitAnswer(snapshot, questionKey);
                    return;
                }
                if (awaitingAnswerResult) {
                    handleAnswerResult(snapshot, questionKey);
                    return;
                }
                String stableText = SolutionLibrary.stableQuestionText(snapshot);
                String snapshotUrl = snapshot.optString("url", "");
                if (!lastSuccessfulQuestionText.isEmpty()) {
                    if (lastSuccessfulQuestionUrl.equals(snapshotUrl) && lastSuccessfulQuestionText.equals(stableText)) {
                        advanceAfterAnswerSuccess(snapshot, pageRevision, true);
                        return;
                    }
                    lastSuccessfulQuestionText = "";
                    lastSuccessfulQuestionUrl = "";
                }
                if (attemptedQuestionKeys.contains(questionKey)) {
                    pauseForManualReview("توقفت هذه المحاولة بالفعل ولم يظهر تأكيد نجاح جديد؛ لن أعيد إرسال الإجابة. راجع الصفحة يدويًا.");
                    return;
                }
                boolean trackSelector = isTrackSelector(snapshot);
                String questionType = QureoSafetyPolicy.classifyQuestionType(snapshot);
                if (!trackSelector && "unsupported".equals(questionType)) {
                    pauseForManualReview("نوع السؤال أو عناصره غير مدعوم أو ملتبس؛ لم أخمّن ولم أرسل إجابة. راجع السؤال يدويًا.");
                    return;
                }
                if (useSolutionLibrary && !usedCacheKeys.contains(questionKey)) {
                    JSONObject cachedPlan = SolutionLibrary.find(QureoActivity.this, track, questionKey);
                    if (cachedPlan != null) {
                        usedCacheKeys.add(questionKey);
                        JSONObject cachedResponse = new JSONObject();
                        cachedResponse.put("plan", cachedPlan);
                        cachedResponse.put("provider", "المكتبة المحلية");
                        applyPlan(cachedResponse, snapshot, questionKey, pageRevision, true);
                        return;
                    }
                }
                String fingerprint = snapshot.optString("url") + "\n" + snapshot.optString("title") + "\n" + snapshot.optString("text")
                        + "\n" + snapshot.optJSONArray("buttons") + "\n" + snapshot.optJSONArray("fields");
                if (fingerprint.equals(lastSnapshot)) repeatedSnapshots++;
                else repeatedSnapshots = 0;
                lastSnapshot = fingerprint;
                if (repeatedSnapshots >= 5) {
                    pauseForManualReview("لم يتغير محتوى الصفحة بعد عدة محاولات؛ أوقفت التخمين. راجع صفحة QUREO ثم اضغط «متابعة» أو أوقف التشغيل.");
                    return;
                }
                requestPlan(snapshot, pageRevision, questionKey);
            } catch (Exception error) {
                setStatus("تعذّر قراءة محتوى الصفحة بأمان؛ أوقفت التشغيل دون إرسال إجابة.");
                paused = true;
                updatePauseButton();
            }
        });
    }

    private void tryAutoLogin() {
        if (loginAttemptInFlight) return;
        loginWaits++;
        int attemptRevision = pageRevision;
        String userLiteral = JSONObject.quote(username);
        String passLiteral = JSONObject.quote(password);
        String script = "(function(u,p,opened){"
                + "const vis=e=>!!e&&!!(e.getClientRects().length)&&getComputedStyle(e).visibility!=='hidden';"
                + "const txt=e=>String((e&&(e.innerText||e.value||e.getAttribute('aria-label')||e.title))||'').trim();"
                + "const body=(document.body&&document.body.innerText)||'';"
                + "const path=location.pathname||'';"
                + "const urlLogin=/(?:^|\\/)(?:login|sign.?in|auth(?:enticate)?)(?:\\/|$)/i.test(path);"
                + "const loginText=/login|sign\\s*in|log\\s*in|ログイン|دخول|تسجيل\\s*الدخول/i.test(body);"
                + "const loginContext=urlLogin||loginText;"
                + "const pws=[...document.querySelectorAll('input[type=password]')].filter(e=>vis(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true');"
                + "if(!pws.length&&!opened&&location.hostname==='me-portal.qureo.education'&&path==='/login'){"
                + "const choices=[...document.querySelectorAll('button')].filter(e=>vis(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'&&/^Go to Learning Login\\s*\\/\\s*انتقل إلى تسجيل الدخول للتعلم$/i.test(txt(e).replace(/\\s+/g,' ')));"
                + "if(choices.length===1){choices[0].click();return JSON.stringify({kind:'learning_login_opened'});}}"
                + "if(!pws.length)return JSON.stringify({kind:loginContext?'no_password':'not_login'});"
                + "if(pws.length!==1)return JSON.stringify({kind:'ambiguous_form'});"
                + "const pw=pws[0],form=pw.form||pw.closest('form')||document;"
                + "if(!loginContext)return JSON.stringify({kind:'not_login_form'});"
                + "const fields=[...form.querySelectorAll('input')].filter(e=>vis(e)&&!e.disabled&&e!==pw&&['text','email','search','number','tel',''].includes((e.type||'').toLowerCase()));"
                + "const tagged=fields.filter(e=>/username|user-name|user_name|student|login|email|account/i.test([e.autocomplete,e.name,e.id,e.placeholder,e.getAttribute('aria-label')].join(' ')));"
                + "const userField=tagged.length===1?tagged[0]:(tagged.length===0&&fields.length===1?fields[0]:null);"
                + "if(!userField)return JSON.stringify({kind:'no_username'});"
                + "const submitters=[...form.querySelectorAll('button,input[type=submit],input[type=button],[role=button]')].filter(e=>vis(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true');"
                + "const explicit=submitters.filter(e=>/login|sign\\s*in|log\\s*in|continue|next|ログイン|دخول|تسجيل الدخول/i.test(txt(e)));"
                + "const native=submitters.filter(e=>e.type==='submit');"
                + "const submit=explicit.length===1?explicit[0]:(explicit.length===0&&native.length===1?native[0]:null);"
                + "if(!submit)return JSON.stringify({kind:'no_submit'});"
                + "const set=(e,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');if(d&&d.set)d.set.call(e,v);else e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};"
                + "set(userField,u);set(pw,p);submit.click();return JSON.stringify({kind:'submitted'});"
                + "}) (" + userLiteral + "," + passLiteral + "," + learningLoginOpened + ")";
        loginAttemptInFlight = true;
        webView.evaluateJavascript(script, result -> {
            if (attemptRevision != pageRevision) return;
            loginAttemptInFlight = false;
            if (stopped || paused) return;
            String decoded = decodeJsString(result);
            String kind = "";
            try { kind = new JSONObject(decoded).optString("kind", ""); }
            catch (JSONException ignored) {}
            if ("learning_login_opened".equals(kind)) {
                learningLoginOpened = true;
                setStatus("فتحت اختيار تسجيل الدخول للتعلّم؛ أنتظر نموذج QUREO.");
                scheduleInspect(LOGIN_RETRY_MS);
            } else if ("submitted".equals(kind)) {
                loginSubmitted = true;
                loginResultWaits = 0;
                username = null;
                password = null;
                setStatus("أُرسلت بيانات الدخول إلى نموذج QUREO فقط؛ أنتظر تحميل المسار. لم تُرسل إلى مزوّد الذكاء الاصطناعي.");
                scheduleInspect(PAGE_READY_MS);
            } else if ("not_login".equals(kind)) {
                username = null;
                password = null;
                loginSubmitted = true;
                loginResultWaits = 0;
                setStatus("لا تعرض صفحة QUREO نموذج دخول؛ أتحقق من الجلسة الحالية دون إرسال البيانات.");
                scheduleInspect(300);
            } else if (QureoLoginPolicy.shouldRetryFormObservation(kind, loginWaits)) {
                setStatus("أنتظر اكتمال نموذج QUREO؛ لن أرسل البيانات إلا عند تمييز حقول دخول وزر واحد بوضوح…");
                scheduleInspect(LOGIN_RETRY_MS);
            } else {
                username = null;
                password = null;
                paused = true;
                updatePauseButton();
                setStatus("لم أتعرف بأمان على نموذج دخول QUREO؛ أدخل البيانات يدويًا في الصفحة ثم اضغط «متابعة». لم أرسل بيانات الدخول.");
            }
        });
    }

    private static String snapshotScript() {
        return "(function(){"
                + "const vis=e=>!!e&&!!(e.getClientRects().length)&&getComputedStyle(e).visibility!=='hidden';"
                + "const clean=s=>String(s||'').replace(/\\s+/g,' ').trim();"
                + "const root=document.querySelector('[role=main],main,article')||document.body;"
                + "const privacy=/welcome|logged in as|student.?name|full.?name|display.?name|^\\s*name\\s*:|user.?name|user.?id|profile|account settings|email|الاسم الكامل|اسم الطالب|اسم المستخدم|ملف شخصي|بيانات الطالب|تسجيل الخروج/i;"
                + "const clone=root?root.cloneNode(true):document.body.cloneNode(true);"
                + "clone.querySelectorAll('header,nav,footer,aside,[class*=profile],[id*=profile],[class*=account],[id*=account],[class*=avatar],[class*=user-menu]').forEach(e=>e.remove());"
                + "const bodyText=(clone.innerText||'').split(/\\n+/).map(s=>s.trim()).filter(s=>s&&!privacy.test(s)&&!/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/i.test(s)).join('\\n').slice(0,12000);"
                + "const outside='header,nav,footer,aside,[class*=profile],[id*=profile],[class*=account],[id*=account]';"
                + "const buttons=[...document.querySelectorAll('button,input[type=button],input[type=submit],[role=button],[role=option],a,label')].filter(e=>vis(e)&&!e.closest(outside)).map(e=>clean(e.innerText||e.value||e.getAttribute('aria-label')||e.title)).filter(s=>s&&!privacy.test(s)).slice(0,80);"
                + "const fields=[...root.querySelectorAll('input:not([type=password]):not([type=hidden]),textarea,select,[contenteditable=true],[role=textbox]')].filter(e=>vis(e)&&!e.closest('[class*=profile],[id*=profile],[class*=account],[id*=account]')).slice(0,50).map(e=>{"
                + "const labels=e.labels?[...e.labels].map(x=>x.innerText):[];"
                + "const label=clean([e.getAttribute('aria-label'),e.getAttribute('aria-labelledby')?document.getElementById(e.getAttribute('aria-labelledby'))?.innerText:'',...labels,e.closest('label')?.innerText,e.getAttribute('name'),e.id].filter(Boolean).join(' ')).slice(0,120);"
                + "const tag=e.tagName.toLowerCase(),type=(e.type||'').toLowerCase();let kind=tag==='textarea'?'textarea':tag==='select'?'select':e.isContentEditable?'code':'input';"
                + "const item={kind,type,label,placeholder:clean(e.getAttribute('placeholder')).slice(0,120),value:clean(e.value||e.innerText||'').slice(0,5000)};"
                + "if(tag==='select')item.options=[...e.options].slice(0,30).map(o=>clean(o.text));"
                + "if(tag==='textarea'||e.isContentEditable||/monaco|codemirror|editor/i.test(String(e.className||''))){item.kind='code';}"
                + "return item;}).filter(f=>!privacy.test((f.label||'')+' '+(f.placeholder||'')));"
                + "const radioEls=[...root.querySelectorAll('input[type=radio],[role=radio]')].filter(e=>(vis(e)||vis(e.closest('label')))&&!e.closest('[class*=profile],[id*=profile],[class*=account],[id*=account]'));"
                + "const checkboxCount=[...root.querySelectorAll('input[type=checkbox],[role=checkbox]')].filter(e=>vis(e)||vis(e.closest('label'))).length;"
                + "const groupOf=e=>e.getAttribute('name')||e.closest('fieldset')?.id||e.closest('[role=radiogroup]')?.id||'';"
                + "const radioGroups=[...new Set(radioEls.map(groupOf))];let choices=[];let choiceGroupCount=radioEls.length?(radioGroups.includes('')?99:radioGroups.length):0;"
                + "if(radioEls.length){choices=radioEls.map(e=>{const label=clean([e.getAttribute('aria-label'),e.labels?[...e.labels].map(x=>x.innerText).join(' '):'',e.closest('label')?.innerText,e.parentElement?.innerText].filter(Boolean).join(' ')).slice(0,160);return {controlKind:'radio',label,selected:e.checked||e.getAttribute('aria-checked')==='true'};});}"
                + "else{const selects=[...root.querySelectorAll('select')].filter(vis);choiceGroupCount=selects.length;if(selects.length===1){choices=[...selects[0].options].filter(o=>!o.disabled&&clean(o.text)).slice(0,8).map(o=>({controlKind:'select',label:clean(o.text).slice(0,160),selected:o.selected}));}}"
                + "const text=(document.body&&document.body.innerText)||'';"
                + "const diamonds=(text.match(/[^\\n]{0,32}(?:diamond|diamonds|💎|ماسة|ماس|جوهرة|جواهر)[^\\n]{0,32}/gi)||[]).slice(0,4).join(' | ');"
                + "const verification=/captcha|recaptcha|two.?factor|verification code|security check|رمز التحقق|تحقق أمني/i.test(text)||!!document.querySelector('iframe[src*=captcha],[class*=captcha],[id*=captcha]');"
                + "const feedbackItems=[...new Set([...root.querySelectorAll('[role=alert],[aria-live=true],[class*=success],[class*=result]')].filter(vis).map(e=>clean(e.innerText||'')).filter(Boolean))].slice(0,8);"
                + "const feedback=feedbackItems.join(' ').slice(0,1000);const feedbackAmbiguous=feedbackItems.length>1;"
                + "const feedbackText=feedback.toLowerCase().replace(/\\s+/g,' ').trim();"
                + "const negative=/(\\b(?:incorrect(?:ly)?|wrong(?:ly)?|not\\s+(?:correct|right)|try\\s+again|answer\\s+is\\s+wrong|failed|failure|error)\\b|غير\\s+صحيح(?:ة)?|إجابة\\s+خاطئة|اجابة\\s+خاطئة|إجابة\\s+غير\\s+صحيحة|اجابة\\s+غير\\s+صحيحة|خطأ|خاطئ|خاطئة|ليست\\s+صحيحة|أعد\\s+المحاولة|اعد\\s+المحاولة|فشل|غير\\s+مقبول|不正解|誤り|間違い|まちがい|違います|正しくありません|失敗)/i;"
                + "const positive=/(?:^|[.!?]\\s*)correct(?:[.!?,]|$)|\\b(?:well\\s+done|congratulations|completed\\s+successfully)\\b|\\b(?:(?:your|the)\\s+)?answer\\s+is\\s+correct\\b|إجابة\\s+صحيحة|اجابة\\s+صحيحة|الإجابة\\s+صحيحة|الاجابة\\s+صحيحة|أحسنت|احسنت|تم\\s+بنجاح|إجابة\\s+صائبة|اجابة\\s+صائبة|正解です|正解しました|正解[！!]/i;"
                + "const success=!feedbackAmbiguous&&positive.test(feedbackText)&&!negative.test(feedbackText);"
                + "const loginRejected=/invalid (?:username|password|credentials)|incorrect (?:username|password)|wrong password|account not found|could not sign in|login failed|كلمة المرور غير صحيحة|بيانات الدخول غير صحيحة|اسم المستخدم أو كلمة المرور|تعذر تسجيل الدخول|تعذّر تسجيل الدخول|فشل تسجيل الدخول|ログインに失敗|パスワードが違います/i.test(text);"
                + "const passwordForm=[...document.querySelectorAll('input[type=password]')].some(e=>vis(e));"
                + "return JSON.stringify({url:location.origin+location.pathname,title:'QUREO lesson',text:bodyText,buttons,fields,choices,choiceGroupCount,checkboxCount,diamonds,verification,passwordForm,loginRejected,feedback,feedbackAmbiguous,success});"
                + "})()";
    }

    private boolean isTrackSelector(JSONObject snapshot) {
        String[] buttons = buttonLabels(snapshot);
        return QureoSafetyPolicy.isAllowedClickTarget("JavaScript", snapshot.optString("text", ""), buttons, false)
                || QureoSafetyPolicy.isAllowedClickTarget("Java", snapshot.optString("text", ""), buttons, false)
                || QureoSafetyPolicy.isAllowedClickTarget("Python", snapshot.optString("text", ""), buttons, false);
    }

    private static String[] buttonLabels(JSONObject snapshot) {
        JSONArray buttons = snapshot == null ? null : snapshot.optJSONArray("buttons");
        String[] result = new String[buttons == null ? 0 : buttons.length()];
        for (int i = 0; i < result.length; i++) result[i] = buttons.optString(i, "");
        return result;
    }

    private void pauseForManualReview(String message) {
        paused = true;
        updatePauseButton();
        setStatus(message);
    }

    private void handleAnswerResult(JSONObject snapshot, String currentKey) {
        boolean sameQuestion = isSamePendingQuestion(snapshot, currentKey);
        String feedback = snapshot.optString("feedback", "");
        boolean newFeedback = isNewFeedback(snapshot);
        if (sameQuestion && newFeedback && QureoSafetyPolicy.hasExplicitAnswerFailure(feedback)) {
            awaitingAnswerResult = false;
            clearPendingSolution();
            pauseForManualReview("QUREO أكد أن الإجابة غير صحيحة. لم أحفظها ولن أعيد إرسالها؛ راجع السؤال أو عدّل الإجابة يدويًا.");
            return;
        }
        if (sameQuestion && newFeedback && QureoSafetyPolicy.hasUnambiguousAnswerSuccess(
                feedback, snapshot.optBoolean("feedbackAmbiguous", false))) {
            String stableText = SolutionLibrary.stableQuestionText(snapshot);
            String url = snapshot.optString("url", "");
            awaitingAnswerResult = false;
            maybeSavePendingSolution(snapshot, currentKey);
            lastSuccessfulQuestionText = stableText;
            lastSuccessfulQuestionUrl = url;
            setStatus("QUREO أكد نجاح الإجابة؛ أبحث عن انتقال آمن للسؤال التالي.");
            advanceAfterAnswerSuccess(snapshot, pageRevision, true);
            return;
        }
        if (!sameQuestion) {
            awaitingAnswerResult = false;
            clearPendingSolution();
            pauseForManualReview("تغيّر السؤال قبل ظهور نتيجة واضحة؛ لم أحفظ الإجابة ولم أتابع تلقائيًا.");
            return;
        }
        if (++answerResultPolls >= MAX_ANSWER_RESULT_POLLS) {
            awaitingAnswerResult = false;
            clearPendingSolution();
            pauseForManualReview("لم يعرض QUREO تأكيد نجاح أو فشل واضحًا بعد الفحص؛ أوقفت المحاولة دون حفظ أو إعادة إرسال.");
            return;
        }
        setStatus("أنتظر نتيجة QUREO الواضحة؛ لن أعيد إرسال الإجابة.");
        scheduleInspect(POLL_MS);
    }

    private void automaticallySubmitAnswer(JSONObject snapshot, String currentKey) {
        if (pendingQuestionKey.isEmpty() || !isSamePendingQuestion(snapshot, currentKey)
                || attemptedQuestionKeys.contains(pendingQuestionKey)) {
            clearPendingSolution();
            pauseForManualReview("تعذّر ربط الإجابة بالسؤال الحالي بثقة؛ لم أضغط فحصًا أو إرسالًا.");
            return;
        }
        String feedback = snapshot.optString("feedback", "");
        boolean baselineHadOutcome = QureoSafetyPolicy.hasExplicitAnswerSuccess(pendingFeedbackBaseline)
                || QureoSafetyPolicy.hasExplicitAnswerFailure(pendingFeedbackBaseline);
        boolean newFeedback = isNewFeedback(snapshot);
        if (!baselineHadOutcome && newFeedback && QureoSafetyPolicy.hasExplicitAnswerFailure(feedback)) {
            attemptedQuestionKeys.add(pendingQuestionKey);
            clearPendingSolution();
            pauseForManualReview("ظهر فشل صريح بعد اختيار الإجابة؛ لن أعيد الإرسال ولن أحفظها.");
            return;
        }
        if (!baselineHadOutcome && newFeedback && QureoSafetyPolicy.hasUnambiguousAnswerSuccess(
                feedback, snapshot.optBoolean("feedbackAmbiguous", false))) {
            String stableText = SolutionLibrary.stableQuestionText(snapshot);
            String url = snapshot.optString("url", "");
            attemptedQuestionKeys.add(pendingQuestionKey);
            maybeSavePendingSolution(snapshot, currentKey);
            lastSuccessfulQuestionText = stableText;
            lastSuccessfulQuestionUrl = url;
            setStatus("أكد QUREO نجاح الإجابة عند اختيارها؛ أنتقل فقط بعد هذا التأكيد الصريح.");
            advanceAfterAnswerSuccess(snapshot, pageRevision, true);
            return;
        }
        if (baselineHadOutcome || QureoSafetyPolicy.hasExplicitAnswerSuccess(feedback)
                || QureoSafetyPolicy.hasExplicitAnswerFailure(feedback)) {
            attemptedQuestionKeys.add(pendingQuestionKey);
            clearPendingSolution();
            pauseForManualReview("توجد نتيجة قديمة أو غير مرتبطة بالمحاولة الحالية؛ لم أرسل الإجابة لتجنّب نجاح زائف.");
            return;
        }
        JSONObject action = pendingAnswerActions.optJSONObject(0);
        String questionType = QureoSafetyPolicy.classifyQuestionType(snapshot);
        if (pendingAnswerActions.length() != 1 || action == null
                || !QureoSafetyPolicy.isAllowedAnswerAction(action, snapshot, true)
                || !pendingAnswersStillMatch(snapshot)) {
            attemptedQuestionKeys.add(pendingQuestionKey);
            clearPendingSolution();
            pauseForManualReview("لم أتحقق من وجود إجابة واحدة مطابقة داخل عنصر مدعوم؛ لم أرسلها إلى QUREO.");
            return;
        }
        String control = QureoSafetyPolicy.findAutoSubmitControl(questionType, buttonLabels(snapshot));
        if (control == null) {
            attemptedQuestionKeys.add(pendingQuestionKey);
            clearPendingSolution();
            pauseForManualReview("لم أتعرف على زر فحص/تشغيل وحيد وآمن لهذا السؤال؛ لم أضغط أي زر.");
            return;
        }
        String targetQuestionKey = pendingQuestionKey;
        int targetPageRevision = pageRevision;
        attemptedQuestionKeys.add(targetQuestionKey);
        autoSubmitPending = false;
        awaitingAnswerResult = true;
        answerResultPolls = 0;
        setStatus("أدخلت إجابة لنوع مدعوم؛ أتحقق من الزر الظاهر قبل تشغيل/فحص الإجابة تلقائيًا.");
        webView.evaluateJavascript(autoSubmitControlScript(questionType, control), result -> {
            if (stopped || webView == null || paused) return;
            if (pageRevision != targetPageRevision || !awaitingAnswerResult
                    || !targetQuestionKey.equals(pendingQuestionKey)) {
                clearPendingSolution();
                pauseForManualReview("تغيّرت صفحة السؤال أثناء الفحص؛ أوقفت المتابعة ولم أعد إرسال الإجابة.");
                return;
            }
            if (!actionResultsSucceeded(decodeJsString(result), 1)) {
                awaitingAnswerResult = false;
                clearPendingSolution();
                pauseForManualReview("لم أتمكن من الضغط على زر الفحص/التشغيل المحدد بوضوح؛ لن أعيد المحاولة تلقائيًا.");
                return;
            }
            setStatus("أُرسلت الإجابة مرة واحدة إلى زر الفحص/التشغيل الظاهر؛ أنتظر تأكيد QUREO.");
            scheduleInspect(ACTION_VERIFY_MS);
        });
    }

    private void advanceAfterAnswerSuccess(JSONObject snapshot, int revision, boolean successConfirmed) {
        String url = snapshot.optString("url", "");
        String stableText = SolutionLibrary.stableQuestionText(snapshot);
        String successKey = url + "\n" + stableText;
        if (url.isEmpty() || stableText.isEmpty()) {
            pauseForManualReview("تأكد نجاح الإجابة، لكن لم أتمكن من تحديد السؤال الحالي بأمان؛ لم أتابع.");
            return;
        }
        if (advancedQuestionKeys.contains(successKey)) {
            pauseForManualReview("لم تنتقل الصفحة بعد نقرة Next/Continue الوحيدة؛ أوقفت النقر لتجنّب تخطي سؤال.");
            return;
        }
        String[] labels = {"Next", "Continue", "التالي", "متابعة", "次へ"};
        String next = null;
        for (String label : labels) {
            if (QureoSafetyPolicy.isAllowedClickTarget(label, snapshot.optString("text", ""), buttonLabels(snapshot), successConfirmed)) {
                next = label;
                break;
            }
        }
        if (next == null) {
            if (delayedNextQuestionKeys.add(successKey)) {
                setStatus("تأكد نجاح الإجابة؛ أنتظر انتقال QUREO التلقائي إلى الصفحة التالية.");
                scheduleInspect(POLL_MS);
            } else {
                pauseForManualReview("تأكد نجاح الإجابة، لكن لم يظهر زر Next/Continue وحيد؛ لم أخمّن طريقة الانتقال.");
            }
            return;
        }
        JSONArray action = new JSONArray();
        JSONObject click = new JSONObject();
        try { click.put("type", "click"); click.put("target", next); action.put(click); }
        catch (JSONException error) {
            pauseForManualReview("تعذّر تجهيز انتقال السؤال التالي بأمان.");
            return;
        }
        advancedQuestionKeys.add(successKey);
        webView.evaluateJavascript(applyActionsScript(action), result -> {
            if (stopped || webView == null || revision != pageRevision) return;
            if (!actionResultsSucceeded(decodeJsString(result), 1)) {
                pauseForManualReview("تأكد نجاح الإجابة، لكن تعذّر تنفيذ زر Next/Continue الظاهر؛ أوقفت الانتقال.");
                return;
            }
            setStatus("انتقلت بعد تأكيد QUREO للنجاح؛ أفحص السؤال التالي.");
            scheduleInspect(NAVIGATION_VERIFY_MS);
        });
    }

    private static String autoSubmitControlScript(String questionType, String control) {
        String q = JSONObject.quote(questionType);
        String c = JSONObject.quote(control);
        return "(function(q,t){const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/\\s+/g,' ').trim();"
                + "const vis=e=>!!e&&!!(e.getClientRects().length)&&getComputedStyle(e).visibility!=='hidden';"
                + "const allowed=q==='code'?['run','execute','تشغيل','تنفيذ','実行']:['check','check answer','تحقق','تحقق من الإجابة','採点','submit','submit answer','إرسال','إرسال الإجابة','回答する'];"
                + "if(!allowed.includes(norm(t)))return JSON.stringify({results:[{ok:false}]});"
                + "const label=e=>String((e&&(e.innerText||e.value||e.getAttribute('aria-label')||e.title))||'').trim();"
                + "const els=[...document.querySelectorAll('button,input[type=button],input[type=submit],[role=button]')].filter(e=>vis(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'&&norm(label(e))===norm(t));"
                + "if(els.length!==1)return JSON.stringify({results:[{ok:false}]});els[0].scrollIntoView({block:'center'});els[0].click();return JSON.stringify({results:[{ok:true}]});})("+q+","+c+")";
    }

    private boolean maybeSavePendingSolution(JSONObject snapshot, String currentKey) {
        if (pendingQuestionKey.isEmpty()) return false;
        if (isSamePendingQuestion(snapshot, currentKey)
                && isNewFeedback(snapshot)
                && QureoSafetyPolicy.hasUnambiguousAnswerSuccess(snapshot.optString("feedback", ""),
                snapshot.optBoolean("feedbackAmbiguous", false))) {
            if (useSolutionLibrary && hasReusableAnswer(pendingAnswerActions) && pendingAnswersStillMatch(snapshot)
                    && SolutionLibrary.save(this, track, pendingQuestionKey, pendingAnswerActions)) {
                solutionsSaved++;
                setStatus("تأكد نجاح إجابة؛ حُفظ الحل محليًا لهذه البصمة فقط. لا يوجد اسم حساب في المكتبة.");
            } else {
                setStatus("أكد QUREO النجاح، لكن لم أحفظ الحل لأنني لم أتحقق من تطابق الاقتراح مع القيمة المقبولة.");
            }
            clearPendingSolution();
            return true;
        }
        if (!isSamePendingQuestion(snapshot, currentKey)) clearPendingSolution();
        return false;
    }

    private boolean isSamePendingQuestion(JSONObject snapshot, String currentKey) {
        if (pendingQuestionKey.isEmpty() || !pendingQuestionUrl.equals(snapshot.optString("url", ""))) return false;
        return pendingQuestionKey.equals(currentKey)
                || (!pendingQuestionText.isEmpty() && pendingQuestionText.equals(SolutionLibrary.stableQuestionText(snapshot)));
    }

    private boolean isNewFeedback(JSONObject snapshot) {
        String current = normalizeFeedback(snapshot.optString("feedback", ""));
        String baseline = normalizeFeedback(pendingFeedbackBaseline);
        return !current.isEmpty() && !current.equals(baseline);
    }

    private static String normalizeFeedback(String text) {
        return (text == null ? "" : text).toLowerCase(Locale.ROOT).replaceAll("\\s+", " ").trim();
    }

    private boolean pendingAnswersStillMatch(JSONObject snapshot) {
        JSONArray fields = snapshot.optJSONArray("fields");
        JSONArray choices = snapshot.optJSONArray("choices");
        if (pendingAnswerActions.length() == 0) return false;
        for (int i = 0; i < pendingAnswerActions.length(); i++) {
            JSONObject action = pendingAnswerActions.optJSONObject(i);
            if (action == null) return false;
            String type = action.optString("type", "");
            String target = normalizeFeedback(action.optString("target", ""));
            if ("select".equals(type)) {
                if (choices == null || choices.length() < 2) return false;
                int selected = 0;
                int selectedTarget = 0;
                for (int j = 0; j < choices.length(); j++) {
                    JSONObject choice = choices.optJSONObject(j);
                    if (choice == null || !choice.optBoolean("selected", false)) continue;
                    selected++;
                    if (target.equals(normalizeFeedback(choice.optString("label", "")))) selectedTarget++;
                }
                if (selected != 1 || selectedTarget != 1) return false;
                continue;
            }
            if (!"fill".equals(type) || fields == null || fields.length() != 1) return false;
            JSONObject field = fields.optJSONObject(0);
            if (field == null || !field.has("value")) return false;
            String label = normalizeFeedback(field.optString("label", ""));
            String placeholder = normalizeFeedback(field.optString("placeholder", ""));
            boolean targetMatches = target.isEmpty() || target.equals(label) || target.equals(placeholder);
            if (!targetMatches || !QureoSafetyPolicy.exactAnswerMatches(action.optString("value", ""), field.optString("value", ""))) return false;
        }
        return true;
    }

    private void rememberCandidateActions(String questionKey, JSONObject snapshot, JSONArray actions) {
        if (questionKey == null || questionKey.isEmpty()) return;
        String url = snapshot.optString("url", "");
        String stableText = SolutionLibrary.stableQuestionText(snapshot);
        if (!pendingQuestionKey.isEmpty() && !pendingQuestionKey.equals(questionKey)
                && (!pendingQuestionUrl.equals(url) || !pendingQuestionText.equals(stableText))) clearPendingSolution();
        if (pendingQuestionKey.isEmpty()) {
            pendingQuestionKey = questionKey;
            pendingQuestionText = stableText;
            pendingQuestionUrl = url;
            pendingFeedbackBaseline = snapshot.optString("feedback", "");
        }
        for (int i = 0; i < actions.length() && pendingAnswerActions.length() < 8; i++) {
            JSONObject action = actions.optJSONObject(i);
            if (action == null) continue;
            String type = action.optString("type", "");
            String target = action.optString("target", "").trim();
            if ("fill".equals(type) || "select".equals(type)) {
                if (target.matches("(?i).*(user.?name|student.?name|full.?name|display.?name|(?:^|\\b)name(?:\\b|$)|email|password|student.?id|phone|address|profile|اسم المستخدم|اسم الطالب|الاسم(?: الكامل)?|كلمة المرور|البريد|الهاتف|العنوان|بيانات الطالب).*$")) continue;
                addPendingAction(action);
            }
        }
    }

    private void addPendingAction(JSONObject action) {
        String type = action.optString("type", "");
        String target = action.optString("target", "");
        for (int i = 0; i < pendingAnswerActions.length(); i++) {
            JSONObject old = pendingAnswerActions.optJSONObject(i);
            if (old != null && type.equals(old.optString("type")) && target.equals(old.optString("target"))) {
                try { pendingAnswerActions.put(i, action); } catch (JSONException ignored) {}
                return;
            }
        }
        pendingAnswerActions.put(action);
    }

    private static boolean hasReusableAnswer(JSONArray actions) {
        for (int i = 0; i < actions.length(); i++) {
            JSONObject action = actions.optJSONObject(i);
            if (action != null && ("fill".equals(action.optString("type")) || "select".equals(action.optString("type")))) return true;
        }
        return false;
    }

    private void clearPendingSolution() {
        pendingQuestionKey = "";
        pendingQuestionText = "";
        pendingQuestionUrl = "";
        pendingFeedbackBaseline = "";
        pendingAnswerActions = new JSONArray();
        autoSubmitPending = false;
        awaitingAnswerResult = false;
        answerResultPolls = 0;
    }

    private void requestPlan(JSONObject snapshot, int revision, String questionKey) {
        if (requestInFlight || paused || stopped) return;
        if (serverBase == null || serverBase.isEmpty()) {
            paused = true;
            updatePauseButton();
            String reason = serverStatus == null || serverStatus.trim().isEmpty()
                    ? "لم يُضبط خادم HTTPS للمساعد."
                    : serverStatus.trim();
            setStatus("تسجيل الدخول متاح، لكن الحل الآلي متوقف: " + reason + " لم أرسل نص الدرس إلى خادم غير متحقق.");
            return;
        }
        if (++plansRun > MAX_PLANS) {
            paused = true;
            updatePauseButton();
            setStatus("بلغت حد الأمان لهذه الجلسة؛ أوقفت التشغيل. راجع التقدم ثم ابدأ جلسة جديدة عند الحاجة.");
            return;
        }
        requestInFlight = true;
        setStatus("أحلّل صفحة المسار " + track + " آمنًا (خطوة " + plansRun + ").");
        network.execute(() -> {
            try {
                JSONObject response = sendAgentRequest(snapshot);
                runOnUiThread(() -> {
                    requestInFlight = false;
                    if (stopped || paused || revision != pageRevision) return;
                    applyPlan(response, snapshot, questionKey, revision, false);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    requestInFlight = false;
                    if (stopped) return;
                    paused = true;
                    updatePauseButton();
                    setStatus(error.getMessage() == null ? "تعذّر الاتصال بالخادم الخاص؛ أوقفت التشغيل دون تغيير الصفحة." : error.getMessage());
                });
            }
        });
    }

    private JSONObject sendAgentRequest(JSONObject snapshot) throws IOException, JSONException {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(serverBase + "/api/agent").openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(45000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "CueQureoHelper/1.3.0 (Android app)");
            if (appPassword != null && !appPassword.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + appPassword);
            JSONObject request = new JSONObject();
            request.put("track", track);
            JSONObject serverSnapshot = new JSONObject(snapshot.toString());
            JSONArray serverFields = serverSnapshot.optJSONArray("fields");
            if (serverFields != null) {
                for (int i = 0; i < serverFields.length(); i++) {
                    JSONObject field = serverFields.optJSONObject(i);
                    if (field != null && !"code".equals(field.optString("kind"))) field.remove("value");
                }
            }
            request.put("snapshot", serverSnapshot);
            byte[] body = request.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream output = connection.getOutputStream()) { output.write(body); }
            int code = connection.getResponseCode();
            InputStream stream = code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream();
            String responseText = readStream(stream);
            JSONObject response = new JSONObject(responseText);
            if (code == 401) throw new IOException("كلمة مرور المساعد غير صحيحة. ارجع إلى شاشة التطبيق وأدخلها في حقل «كلمة مرور المساعد» لا في حقل «كلمة مرور QUREO».");
            if (code < 200 || code >= 300) throw new IOException(response.optString("error", "أوقف الخادم الطلب."));
            return response;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String readStream(InputStream stream) throws IOException {
        if (stream == null) return "{}";
        StringBuilder out = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) out.append(line);
        }
        return out.toString();
    }

    private void applyPlan(JSONObject response, JSONObject snapshot, String questionKey, int revision, boolean fromLibrary) {
        JSONObject plan = response.optJSONObject("plan");
        JSONArray actions = plan == null ? null : plan.optJSONArray("actions");
        String provider = response.optString("provider", "الخادم الخاص");
        if (actions == null || actions.length() == 0) {
            paused = true;
            updatePauseButton();
            setStatus("لم تصل خطة واضحة من " + provider + ". راجع صفحة QUREO يدويًا.");
            return;
        }
        if (actions.length() > 1) {
            paused = true;
            updatePauseButton();
            setStatus("وصلت خطة متعددة الخطوات؛ أوقفتها دون تنفيذ أي إجراء. راجع السؤال يدويًا.");
            return;
        }
        JSONArray executable = new JSONArray();
        for (int i = 0; i < actions.length(); i++) {
            JSONObject action = actions.optJSONObject(i);
            if (action == null) continue;
            String type = action.optString("type", "");
            if ("done".equals(type)) {
                if (!isExplicitCourseCompletion(snapshot.optString("feedback", ""))) {
                    paused = true;
                    updatePauseButton();
                    setStatus("قال النموذج إن المسار انتهى، لكن صفحة QUREO لا تعرض تأكيدًا واضحًا لاكتمال المسار كله؛ أوقفت التشغيل لتتحقق يدويًا.");
                    return;
                }
                completed = true;
                stopped = true;
                handler.removeCallbacksAndMessages(null);
                String diamonds = lastObservedDiamonds.isEmpty() ? "لم يظهر عدّاد الماسات في الصفحة المقروءة." : "الماسات الظاهرة: " + lastObservedDiamonds;
                setStatus("أعلن النظام اكتمال مسار " + track + ". " + diamonds);
                pauseButton.setEnabled(false);
                return;
            }
            if ("ask_user".equals(type)) {
                paused = true;
                updatePauseButton();
                setStatus("تحتاج هذه الخطوة إلى مراجعتك؛ لم أرسل إجابة إلى QUREO.");
                return;
            }
            if ("wait".equals(type)) {
                setStatus("أنتظر تغيّر نتيجة QUREO؛ لم أرسل إجابة.");
                scheduleInspect(WAIT_ACTION_MS);
                return;
            }
            if ("fill".equals(type) || "select".equals(type)) {
                String target = action.optString("target", "").trim();
                if (target.matches("(?i).*(password|user.?name|student.?name|full.?name|display.?name|(?:^|\\b)name(?:\\b|$)|email|student.?id|phone|address|profile|كلمة المرور|اسم المستخدم|اسم الطالب|الاسم(?: الكامل)?|البريد|الهاتف|العنوان|بيانات الطالب).*$")) {
                    paused = true;
                    updatePauseButton();
                    setStatus("أوقفت محاولة تعبئة حقل غير مخصص للإجابة.");
                    return;
                }
                if (!QureoSafetyPolicy.isAllowedAnswerAction(action, snapshot, fromLibrary)) {
                    String reason = !fromLibrary && action.optJSONObject("cross_check") == null
                            ? "لم يرفق خادم المساعد إعادة فحص مطابقة؛ قد تكون نسخته أقدم من صيغة الخطط المطلوبة."
                            : "الإجابة أو إعادة فحصها لا تطابق نوع السؤال أو عنصرًا ظاهرًا ووحيدًا.";
                    pauseForManualReview(reason + " لم أغيّر الصفحة.");
                    return;
                }
                executable.put(action);
            } else if ("click".equals(type)) {
                JSONArray visible = snapshot.optJSONArray("buttons");
                String[] visibleButtons = new String[visible == null ? 0 : visible.length()];
                for (int j = 0; j < visibleButtons.length; j++) visibleButtons[j] = visible.optString(j, "");
                boolean confirmedSuccess = QureoSafetyPolicy.hasExplicitAnswerSuccess(snapshot.optString("feedback", ""));
                String clickTarget = action.optString("target", "").trim();
                boolean modelNextClick = "next".equalsIgnoreCase(clickTarget) || "continue".equalsIgnoreCase(clickTarget)
                        || "التالي".equals(clickTarget) || "متابعة".equals(clickTarget) || "次へ".equals(clickTarget);
                if (modelNextClick || !QureoSafetyPolicy.isAllowedClickTarget(clickTarget,
                        snapshot.optString("text", ""), visibleButtons, confirmedSuccess)) {
                    pauseForManualReview("أوقفت نقرة طلبها النموذج؛ انتقال السؤال التالي لا يحدث إلا بعد تأكيد جديد من QUREO.");
                    return;
                }
                executable.put(action);
            } else {
                paused = true;
                updatePauseButton();
                setStatus("الخطة تحتوي إجراءً غير مسموح؛ أوقفتها دون تغيير الإجابة.");
                return;
            }
        }
        if (executable.length() == 0) {
            paused = true;
            updatePauseButton();
            setStatus("لا توجد خطوة آمنة واضحة؛ أوقفت التخمين واطلب مراجعة السؤال يدويًا.");
            return;
        }
        JSONArray safeActions = executable;
        String statusPrefix = "ينفّذ خطوة مسموحة عبر " + provider + "…";
        setStatus(statusPrefix);
        executeActionsInOrder(safeActions, 0, questionKey, snapshot, revision, fromLibrary, statusPrefix);
    }

    private void executeActionsInOrder(JSONArray actions, int index, String questionKey, JSONObject snapshot,
                                       int revision, boolean fromLibrary, String statusPrefix) {
        if (stopped || paused || webView == null || revision != pageRevision) return;
        if (index >= actions.length()) {
            scheduleInspect(ACTION_VERIFY_MS);
            return;
        }
        JSONObject action = actions.optJSONObject(index);
        if (action == null) {
            paused = true;
            updatePauseButton();
            setStatus("الخطة تحتوي إجراءً غير صالح؛ أوقفت التشغيل ولم أحفظه.");
            return;
        }
        JSONArray singleAction = new JSONArray();
        singleAction.put(action);
        webView.evaluateJavascript(applyActionsScript(singleAction), result -> {
            if (stopped || paused || webView == null || revision != pageRevision) return;
            if (!actionResultsSucceeded(decodeJsString(result), 1)) {
                paused = true;
                updatePauseButton();
                setStatus("لم أتمكن من تنفيذ الإجراء بوضوح؛ أوقفت التشغيل ولم أحفظ خطة غير مؤكدة في مكتبة الحلول.");
                return;
            }
            String actionType = action.optString("type", "");
            if ("fill".equals(actionType) || "select".equals(actionType)) {
                rememberCandidateActions(questionKey, snapshot, singleAction);
                autoSubmitPending = true;
                setStatus("أُدخلت إجابة لنوع مدعوم؛ أتحقق من قيمتها والزر الظاهر قبل إرسالها للفحص.");
                scheduleInspect(ACTION_VERIFY_MS);
                return;
            }
            if (index + 1 >= actions.length()) {
                setStatus(statusPrefix);
                scheduleInspect(ACTION_VERIFY_MS);
                return;
            }
            handler.postDelayed(() -> executeActionsInOrder(actions, index + 1, questionKey, snapshot,
                    revision, fromLibrary, statusPrefix), 350);
        });
    }

    private static boolean actionResultsSucceeded(String source, int expectedCount) {
        if (expectedCount <= 0) return false;
        try {
            JSONArray results = new JSONObject(source).optJSONArray("results");
            if (results == null || results.length() != expectedCount) return false;
            for (int i = 0; i < results.length(); i++) {
                JSONObject result = results.optJSONObject(i);
                if (result == null || !result.optBoolean("ok", false)) return false;
            }
            return true;
        } catch (JSONException ignored) {
            return false;
        }
    }

    private static boolean isExplicitCourseCompletion(String source) {
        String text = (source == null ? "" : source).toLowerCase(Locale.ROOT).replaceAll("\\s+", " ");
        boolean english = text.matches("(?s).*\\b(?:all lessons|all units|all chapters|entire course|full course|course|track|learning path|curriculum)\\b.{0,50}\\b(?:completed|complete|finished)\\b.*")
                || text.matches("(?s).*\\b(?:completed|finished)\\b.{0,50}\\b(?:course|track|learning path|curriculum|all lessons|all units)\\b.*");
        boolean arabic = text.contains("اكتمل المسار") || text.contains("اكتملت جميع الدروس")
                || text.contains("تم إكمال المسار") || text.contains("تم إكمال جميع الدروس")
                || text.contains("أكملت جميع الدروس") || text.contains("اكتمل المقرر");
        boolean japanese = text.contains("すべてのレッスンが完了") || text.contains("すべてのレッスンを完了")
                || text.contains("コースを修了") || text.contains("全課程を修了");
        return english || arabic || japanese;
    }

    private static String applyActionsScript(JSONArray actions) {
        return "(function(actions){"
                + "const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/\\s+/g,' ').trim();"
                + "const vis=e=>!!e&&!!(e.getClientRects().length)&&getComputedStyle(e).visibility!=='hidden';"
                + "const dangerous=/logout|log out|sign.?out|delete|remove account|password|account settings|تسجيل الخروج|حذف الحساب|كلمة المرور|إعدادات الحساب/i;"
                + "const sensitive=/password|user.?name|student.?name|full.?name|display.?name|(?:^|\\b)name(?:\\b|$)|email|student.?id|phone|address|profile|كلمة المرور|اسم المستخدم|اسم الطالب|الاسم(?: الكامل)?|البريد|الهاتف|العنوان|بيانات الطالب/i;"
                + "const allText=e=>String((e&&(e.innerText||e.value||e.getAttribute('aria-label')||e.title))||'').trim();"
                + "const results=[];"
                + "for(const a of actions){try{if(a.type==='fill'){"
                + "const describe=e=>{const id=e.id||'';const lab=e.labels?[...e.labels].map(x=>x.innerText):[];return norm([e.getAttribute('aria-label'),e.getAttribute('placeholder'),e.getAttribute('name'),id,e.className,e.closest('label')?.innerText,...lab].filter(Boolean).join(' '));};"
                + "const items=[...document.querySelectorAll('input:not([type=password]):not([type=hidden]):not([type=button]):not([type=submit]),textarea,select,[contenteditable=true],[role=textbox]')].filter(e=>vis(e)&&!sensitive.test(describe(e)));"
                + "const t=norm(a.target);let ranked=items.map(e=>({e,d:describe(e)})).map(x=>({e:x.e,score:!t?0:(x.d===t?100:x.d.includes(t)?80:t.includes(x.d)&&x.d.length>2?55:0)})).filter(x=>!t||x.score>0).sort((x,y)=>y.score-x.score);"
                + "if(!t&&items.length===1)ranked=[{e:items[0],score:1}];if(!ranked.length){results.push({ok:false,error:'not_found',type:a.type});break;}"
                + "if(ranked.length>1&&ranked[0].score===ranked[1].score){results.push({ok:false,error:'ambiguous',type:a.type});break;}"
                + "const e=ranked[0].e;if(e.tagName==='SELECT'){const opt=[...e.options].find(o=>norm(o.text)===norm(a.value)||norm(o.value)===norm(a.value));if(!opt){results.push({ok:false,error:'not_found',type:a.type});break;}e.value=opt.value;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}"
                + "else if(e.isContentEditable){e.focus();e.textContent=a.value;e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:a.value}));}"
                + "else{e.focus();const proto=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const d=Object.getOwnPropertyDescriptor(proto,'value');if(d&&d.set)d.set.call(e,a.value);else e.value=a.value;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}"
                + "e.scrollIntoView({block:'center'});results.push({ok:true,type:a.type});"
                + "}else if(a.type==='select'){const target=norm(a.target);if(!target||sensitive.test(target)){results.push({ok:false,error:'blocked',type:a.type});break;}"
                + "const labelOf=e=>norm([e.getAttribute('aria-label'),e.labels?[...e.labels].map(x=>x.innerText).join(' '):'',e.closest('label')?.innerText,e.parentElement?.innerText].filter(Boolean).join(' '));"
                + "const radios=[...document.querySelectorAll('input[type=radio],[role=radio]')].filter(e=>(vis(e)||vis(e.closest('label')))&&labelOf(e)===target);"
                + "if(radios.length===1){const e=radios[0];e.scrollIntoView({block:'center'});if(e.matches('input[type=radio]')){e.click();if(!e.checked){e.checked=true;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}}else e.click();results.push({ok:true,type:a.type});}"
                + "else if(radios.length>1){results.push({ok:false,error:'ambiguous',type:a.type});break;}else{const selects=[...document.querySelectorAll('select')].filter(vis);if(selects.length!==1){results.push({ok:false,error:'ambiguous',type:a.type});break;}const e=selects[0],opts=[...e.options].filter(o=>norm(o.text)===target);if(opts.length!==1){results.push({ok:false,error:opts.length?'ambiguous':'not_found',type:a.type});break;}e.value=opts[0].value;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));results.push({ok:true,type:a.type});}"
                + "}else if(a.type==='click'){const target=norm(a.target);if(!/^(?:javascript|java|python|next|continue|التالي|متابعة|次へ)$/.test(target)||dangerous.test(target)){results.push({ok:false,error:'blocked',type:a.type});break;}"
                + "const els=[...document.querySelectorAll('button,a,[role=button],[tabindex]:not([role=option])')].filter(vis);"
                + "const ranked=els.map(e=>{const label=norm(allText(e));const href=e.href||e.closest('a')?.href||'';const score=label===target?100:label.includes(target)?75:target.includes(label)&&label.length>2?50:0;return {e,label,href,score};}).filter(x=>x.score>0).sort((x,y)=>y.score-x.score);"
                + "if(!ranked.length){results.push({ok:false,error:'not_found',type:a.type});break;}if(ranked.length>1&&ranked[0].score===ranked[1].score){results.push({ok:false,error:'ambiguous',type:a.type});break;}"
                + "const x=ranked[0];if(x.href){try{const u=new URL(x.href,location.href);if(u.protocol!=='https:'||!(u.hostname==='qureo.education'||u.hostname.endsWith('.qureo.education'))){results.push({ok:false,error:'blocked',type:a.type});break;}}catch{results.push({ok:false,error:'blocked',type:a.type});break;}}"
                + "x.e.scrollIntoView({block:'center'});if(x.e.matches('input[type=radio],input[type=checkbox]')){x.e.checked=true;x.e.dispatchEvent(new Event('input',{bubbles:true}));x.e.dispatchEvent(new Event('change',{bubbles:true}));}else x.e.click();results.push({ok:true,type:a.type});"
                + "}else{results.push({ok:false,error:'blocked',type:a.type});break;}}catch(e){results.push({ok:false,error:'blocked'});break;}}"
                + "return JSON.stringify({results});})(" + actions.toString() + ")";
    }

    private void togglePause() {
        if (stopped) return;
        paused = !paused;
        updatePauseButton();
        if (paused) setStatus("أوقفت التشغيل مؤقتًا. صفحة QUREO بقيت مفتوحة.");
        else {
            setStatus("استؤنف التشغيل؛ سأفحص صفحة QUREO من جديد.");
            scheduleInspect(400);
        }
    }

    private void updatePauseButton() {
        if (pauseButton != null) pauseButton.setText(paused ? "متابعة" : "إيقاف مؤقت");
    }

    private void stopAutomation(boolean finished) {
        stopped = true;
        paused = true;
        handler.removeCallbacksAndMessages(null);
        if (webView != null) webView.stopLoading();
        if (!finished) setStatus("أوقفت التشغيل. لم أحذف تقدم QUREO أو أسجل الخروج.");
        if (pauseButton != null) pauseButton.setEnabled(false);
        if (stopButton != null) stopButton.setEnabled(false);
        username = null;
        password = null;
        appPassword = null;
        network.shutdownNow();
    }

    private void scheduleInspect(long delay) {
        if (stopped || paused) return;
        handler.removeCallbacks(inspectRunnable);
        handler.postDelayed(inspectRunnable, delay);
    }

    private final Runnable inspectRunnable = this::inspectPage;

    private void setStatus(String text) {
        if (statusView != null) statusView.setText(text);
    }

    private static String decodeJsString(String result) {
        if (result == null) return "";
        try {
            Object value = new JSONTokener(result).nextValue();
            return value instanceof String ? (String) value : String.valueOf(value);
        } catch (Exception ignored) {
            return result;
        }
    }

    @Override
    public void onBackPressed() {
        stopAutomation(false);
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        stopAutomation(false);
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
