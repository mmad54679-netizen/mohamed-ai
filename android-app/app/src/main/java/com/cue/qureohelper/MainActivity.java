package com.cue.qureohelper;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewClientCompat;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 24;
    private static final String START_URL = "https://appassets.androidplatform.net/assets/index.html?native=1";
    private static final String APP_ASSET_HOST = "appassets.androidplatform.net";

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private WebViewAssetLoader assetLoader;
    private final ExecutorService preflightExecutor = Executors.newSingleThreadExecutor();
    private volatile boolean launchPending;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView = new WebView(this);
        webView.setBackgroundColor(0xFFF4F6FB);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }

        webView.setWebViewClient(new WebViewClientCompat() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                return assetLoader.shouldInterceptRequest(Uri.parse(url));
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return !request.isForMainFrame() || !isBundledAppUri(uri);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                    return true;
                } catch (ActivityNotFoundException | IllegalArgumentException exception) {
                    fileCallback = null;
                    callback.onReceiveValue(null);
                    return false;
                }
            }
        });

        // This bridge is exposed only on the bundled appassets page. QUREO opens in a
        // separate WebView Activity with no JavaScript bridge attached.
        webView.addJavascriptInterface(new QureoBridge(), "CueQureo");

        setContentView(webView);
        if (savedInstanceState != null && webView.restoreState(savedInstanceState) != null) {
            return;
        }
        webView.loadUrl(START_URL);
    }

    private static boolean isBundledAppUri(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && APP_ASSET_HOST.equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getUserInfo() == null
                && "/assets/index.html".equals(uri.getPath());
    }

    private final class QureoBridge {
        @JavascriptInterface
        public void startQureoAutomation(String username, String password, String track, String serverBaseUrl, String appPassword, boolean useSolutionLibrary) {
            runOnUiThread(() -> {
                if (launchPending) return;
                if (username == null || username.trim().isEmpty() || password == null || password.isEmpty()) {
                    showLaunchError("أدخل بيانات دخول QUREO أولًا.");
                    return;
                }
                if (!"JavaScript".equals(track) && !"Java".equals(track) && !"Python".equals(track)) {
                    showLaunchError("اختر JavaScript أو Python.");
                    return;
                }
                try {
                    String serverValue = "";
                    String initialStatus = "";
                    String rawServer = serverBaseUrl == null ? "" : serverBaseUrl.trim();
                    if (!rawServer.isEmpty()) {
                        Uri server = Uri.parse(rawServer);
                        if ("https".equals(server.getScheme()) && server.getHost() != null && server.getUserInfo() == null
                                && (server.getPath() == null || server.getPath().isEmpty() || "/".equals(server.getPath()))
                                && server.getQuery() == null && server.getFragment() == null) {
                            serverValue = server.buildUpon().path("").build().toString();
                        } else {
                            initialStatus = "عنوان خادم المساعد غير صالح؛ فُتح QUREO في وضع تسجيل الدخول فقط، ولم يُرسل نص الدرس إلى هذا العنوان.";
                        }
                    }
                    if (serverValue.isEmpty()) {
                        launchQureo(username, password, track, "", "", useSolutionLibrary, initialStatus);
                        return;
                    }
                    final String validatedServer = serverValue;
                    final String validatedAppPassword = appPassword == null ? "" : appPassword;
                    if (validatedAppPassword.trim().isEmpty()) {
                        launchQureo(username, password, track, "", "", useSolutionLibrary,
                                "لم تُدخل كلمة مرور المساعد؛ فُتح QUREO في وضع تسجيل الدخول فقط.");
                        return;
                    }
                    launchPending = true;
                    preflightExecutor.execute(() -> {
                        String error = verifyAssistantServer(validatedServer, validatedAppPassword);
                        runOnUiThread(() -> {
                            launchPending = false;
                            if (isFinishing() || isDestroyed()) return;
                            if (QureoLaunchPolicy.shouldUseLoginOnly(validatedServer, validatedAppPassword, error)) {
                                String reason = error == null ? "تعذّر التحقق من خادم المساعد." : error;
                                launchQureo(username, password, track, "", "", useSolutionLibrary,
                                        reason + " فُتح QUREO في وضع تسجيل الدخول فقط، ولم يُرسل نص الدرس إلى الخادم.");
                                return;
                            }
                            launchQureo(username, password, track, validatedServer, validatedAppPassword, useSolutionLibrary, "");
                        });
                    });
                } catch (RuntimeException ignored) {
                    launchQureo(username, password, track, "", "", useSolutionLibrary,
                            "تعذّر التحقق من إعداد خادم المساعد؛ فُتح QUREO في وضع تسجيل الدخول فقط.");
                }
            });
        }

        @JavascriptInterface
        public int getSolutionCount() {
            return SolutionLibrary.count(MainActivity.this);
        }

        @JavascriptInterface
        public void clearSolutionLibrary() {
            runOnUiThread(() -> new AlertDialog.Builder(MainActivity.this)
                    .setTitle("مسح مكتبة الحلول؟")
                    .setMessage("سيُحذف من هذا الجهاز فقط كل حل محفوظ، ولن يتغير أي تقدم في QUREO.")
                    .setNegativeButton("إلغاء", null)
                    .setPositiveButton("مسح", (dialog, which) -> {
                        SolutionLibrary.clear(MainActivity.this);
                        if (webView != null) webView.evaluateJavascript("window.refreshSolutionLibraryCount&&window.refreshSolutionLibraryCount()", null);
                    })
                    .show());
        }
    }

    private void launchQureo(String username, String password, String track, String serverBaseUrl,
                             String appPassword, boolean useSolutionLibrary, String serverStatus) {
        Intent intent = new Intent(MainActivity.this, QureoActivity.class);
        intent.putExtra(QureoActivity.EXTRA_USERNAME, username.trim());
        intent.putExtra(QureoActivity.EXTRA_PASSWORD, password);
        intent.putExtra(QureoActivity.EXTRA_TRACK, track);
        intent.putExtra(QureoActivity.EXTRA_SERVER, serverBaseUrl);
        intent.putExtra(QureoActivity.EXTRA_APP_PASSWORD, appPassword);
        intent.putExtra(QureoActivity.EXTRA_USE_LIBRARY, useSolutionLibrary);
        intent.putExtra(QureoActivity.EXTRA_SERVER_STATUS, serverStatus);
        startActivity(intent);
    }

    private String verifyAssistantServer(String baseUrl, String appPassword) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(baseUrl + "/api/health");
            if (!"https".equalsIgnoreCase(url.getProtocol())) return "لا أرسل كلمة مرور المساعد إلا إلى خادم HTTPS.";
            connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(6000);
            connection.setReadTimeout(6000);
            connection.setRequestProperty("Authorization", "Bearer " + appPassword);
            connection.setRequestProperty("Accept", "application/json");
            int code = connection.getResponseCode();
            if (code >= 300 && code < 400) return "رفضت تحويل الخادم حفاظًا على كلمة مرور المساعد.";
            InputStream stream = code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream();
            StringBuilder text = new StringBuilder();
            if (stream != null) {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) {
                        if (text.length() + line.length() > 16000) return "استجابة فحص الخادم أكبر من المتوقع؛ لم أفتح QUREO.";
                        text.append(line);
                    }
                }
            }
            JSONObject body = new JSONObject(text.toString());
            if (code == 401 || "APP_PASSWORD_REQUIRED".equals(body.optString("code"))) return "كلمة مرور المساعد غير صحيحة؛ لم أفتح QUREO.";
            if (code < 200 || code >= 300) return "رفض خادم المساعد الفحص (HTTP " + code + ")؛ لم أفتح QUREO.";
            if (!body.optBoolean("passwordRequired") || body.optBoolean("mockMode")) return "الخادم غير محمي بكلمة مرور أو يعمل بوضع الاختبار؛ لم أفتح QUREO.";
            JSONObject providers = body.optJSONObject("providers");
            if (providers == null || !providers.optBoolean("gemini")) return "Gemini غير مهيأ على الخادم؛ لم أفتح QUREO.";
            return null;
        } catch (Exception ignored) {
            return "تعذّر التحقق الآمن من الخادم؛ راجع عنوان HTTPS وكلمة مرور المساعد. لم أفتح QUREO.";
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void showLaunchError(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST && fileCallback != null) {
            Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            fileCallback.onReceiveValue(results);
            fileCallback = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        preflightExecutor.shutdownNow();
        if (fileCallback != null) {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
        }
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
