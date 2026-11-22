package com.cue.qureohelper;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.Normalizer;
import java.util.Locale;

/** Private, device-local answer cache. It intentionally stores no account identity or credentials. */
public final class SolutionLibrary {
    private static final String PREFS = "qureo_private_solution_library_v2";
    private static final String LEGACY_PREFS_V1 = "qureo_private_solution_library_v1";
    private static final String DATA_KEY = "solutions";
    private static final String LEGACY_MIGRATED_KEY = "legacy_v1_cleared";
    private static final int MAX_ENTRIES = 300;
    private static final int MAX_PLAN_CHARS = 8000;

    private SolutionLibrary() {}

    public static synchronized String fingerprint(String track, JSONObject snapshot) throws Exception {
        StringBuilder source = new StringBuilder();
        source.append(track).append('\n').append(normalize(snapshot.optString("text", ""))).append('\n');
        JSONArray buttons = snapshot.optJSONArray("buttons");
        if (buttons != null) {
            for (int i = 0; i < buttons.length(); i++) source.append("button:").append(normalize(buttons.optString(i, ""))).append('\n');
        }
        JSONArray fields = snapshot.optJSONArray("fields");
        if (fields != null) {
            for (int i = 0; i < fields.length(); i++) {
                JSONObject field = fields.optJSONObject(i);
                if (field == null) continue;
                source.append("field:").append(normalize(field.optString("kind", ""))).append('|')
                        .append(normalize(field.optString("label", ""))).append('|')
                        .append(normalize(field.optString("placeholder", ""))).append('\n');
                JSONArray options = field.optJSONArray("options");
                if (options != null) for (int j = 0; j < options.length(); j++) {
                    source.append("option:").append(normalize(options.optString(j, ""))).append('\n');
                }
            }
        }
        source.append("choice-groups:").append(snapshot.optInt("choiceGroupCount", 0)).append('\n')
                .append("checkboxes:").append(snapshot.optInt("checkboxCount", 0)).append('\n');
        JSONArray choices = snapshot.optJSONArray("choices");
        if (choices != null) {
            for (int i = 0; i < choices.length(); i++) {
                JSONObject choice = choices.optJSONObject(i);
                if (choice != null) source.append("choice:").append(normalize(choice.optString("controlKind", "")))
                        .append('|').append(normalize(choice.optString("label", ""))).append('\n');
            }
        }
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] bytes = digest.digest(source.toString().getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) hex.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return hex.toString();
    }

    static String stableQuestionText(JSONObject snapshot) {
        if (snapshot == null) return "";
        String text = normalize(snapshot.optString("text", ""));
        String feedback = normalize(snapshot.optString("feedback", ""));
        if (!feedback.isEmpty()) text = text.replace(feedback, " ").replaceAll("\\s+", " ").trim();
        return text;
    }

    public static synchronized JSONObject find(Context context, String track, String fingerprint) {
        JSONArray entries = readEntries(context);
        for (int i = entries.length() - 1; i >= 0; i--) {
            JSONObject entry = entries.optJSONObject(i);
            if (entry != null && track.equals(entry.optString("track")) && fingerprint.equals(entry.optString("key"))) {
                JSONObject savedPlan = entry.optJSONObject("plan");
                if (savedPlan == null) return null;
                JSONArray savedActions = savedPlan.optJSONArray("actions");
                if (savedActions == null || savedActions.length() == 0) return null;
                JSONArray safeActions = new JSONArray();
                for (int j = 0; j < savedActions.length(); j++) {
                    JSONObject action = savedActions.optJSONObject(j);
                    if (action == null) return null;
                    String type = action.optString("type", "");
                    if (!"fill".equals(type) && !"select".equals(type)) return null;
                    String target = action.optString("target", "").trim();
                    String value = action.optString("value", "");
                    if (target.length() > 160 || value.length() > 5000 || isSensitiveTarget(target)
                            || ("fill".equals(type) && value.isEmpty()) || ("select".equals(type) && target.isEmpty())) return null;
                    JSONObject clean = new JSONObject();
                    try {
                        clean.put("type", type);
                        clean.put("target", target);
                        if ("fill".equals(type)) clean.put("value", value);
                    } catch (JSONException ignored) {
                        return null;
                    }
                    safeActions.put(clean);
                }
                JSONObject copy = new JSONObject();
                try {
                    copy.put("actions", safeActions);
                    copy.put("message", "استخدمت حلًا محفوظًا محليًا مطابقًا لهذا السؤال والمسار.");
                    return copy;
                } catch (Exception ignored) {
                    return null;
                }
            }
        }
        return null;
    }

    public static synchronized boolean save(Context context, String track, String fingerprint, JSONArray answerActions) {
        if (!("JavaScript".equals(track) || "Java".equals(track) || "Python".equals(track)) || fingerprint == null || fingerprint.isEmpty()
                || answerActions == null || answerActions.length() == 0) return false;
        try {
            JSONObject safePlan = new JSONObject();
            JSONArray safeActions = new JSONArray();
            for (int i = 0; i < answerActions.length(); i++) {
                JSONObject action = answerActions.optJSONObject(i);
                if (action == null) continue;
                String type = action.optString("type", "");
                if (!"fill".equals(type) && !"select".equals(type)) continue;
                String target = action.optString("target", "").trim();
                String value = action.optString("value", "");
                if (target.length() > 160 || value.length() > 5000 || isSensitiveTarget(target)
                        || ("fill".equals(type) && value.isEmpty()) || ("select".equals(type) && target.isEmpty())) continue;
                JSONObject safe = new JSONObject();
                safe.put("type", type);
                safe.put("target", target);
                if ("fill".equals(type)) safe.put("value", value);
                safeActions.put(safe);
            }
            if (safeActions.length() == 0) return false;
            safePlan.put("actions", safeActions);
            if (safePlan.toString().length() > MAX_PLAN_CHARS) return false;

            JSONArray entries = readEntries(context);
            JSONArray updated = new JSONArray();
            for (int i = 0; i < entries.length(); i++) {
                JSONObject old = entries.optJSONObject(i);
                if (old != null && (!fingerprint.equals(old.optString("key")) || !track.equals(old.optString("track")))) updated.put(old);
            }
            JSONObject entry = new JSONObject();
            entry.put("key", fingerprint);
            entry.put("track", track);
            entry.put("plan", safePlan);
            entry.put("savedAt", System.currentTimeMillis());
            updated.put(entry);
            JSONArray capped = new JSONArray();
            int start = Math.max(0, updated.length() - MAX_ENTRIES);
            for (int i = start; i < updated.length(); i++) capped.put(updated.opt(i));
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(DATA_KEY, root(capped).toString()).apply();
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    public static synchronized int count(Context context) {
        return readEntries(context).length();
    }

    public static synchronized void clear(Context context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(DATA_KEY).apply();
    }

    private static JSONObject root(JSONArray entries) throws JSONException {
        JSONObject root = new JSONObject();
        root.put("version", 2);
        root.put("entries", entries);
        return root;
    }

    private static JSONArray readEntries(Context context) {
        clearLegacyCacheOnce(context);
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String raw = prefs.getString(DATA_KEY, "");
        if (raw == null || raw.isEmpty()) return new JSONArray();
        try {
            JSONObject root = new JSONObject(raw);
            JSONArray entries = root.optJSONArray("entries");
            if (root.optInt("version", -1) != 2 || entries == null) {
                prefs.edit().remove(DATA_KEY).apply();
                return new JSONArray();
            }
            return entries;
        } catch (JSONException ignored) {
            prefs.edit().remove(DATA_KEY).apply();
            return new JSONArray();
        }
    }

    private static void clearLegacyCacheOnce(Context context) {
        SharedPreferences current = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (current.getBoolean(LEGACY_MIGRATED_KEY, false)) return;
        context.getSharedPreferences(LEGACY_PREFS_V1, Context.MODE_PRIVATE).edit().clear().apply();
        current.edit().putBoolean(LEGACY_MIGRATED_KEY, true).apply();
    }

    private static boolean isSensitiveTarget(String target) {
        return target.matches("(?i).*(password|user.?name|student.?name|full.?name|display.?name|(?:^|\\b)name(?:\\b|$)|email|student.?id|phone|address|profile|كلمة المرور|اسم المستخدم|اسم الطالب|الاسم(?: الكامل)?|البريد|الهاتف|العنوان|بيانات الطالب).*");
    }

    private static String normalize(String text) {
        return Normalizer.normalize(text == null ? "" : text, Normalizer.Form.NFKC)
                .toLowerCase(Locale.ROOT).replaceAll("\\s+", " ").trim();
    }
}
