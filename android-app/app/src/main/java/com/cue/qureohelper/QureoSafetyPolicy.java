package com.cue.qureohelper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.Normalizer;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/** Fail-closed policy for QUREO question recognition, feedback, and bounded automation. */
final class QureoSafetyPolicy {
    private static final Pattern NEGATIVE_FEEDBACK = Pattern.compile(
            "\\b(?:incorrect(?:ly)?|wrong(?:ly)?|not\\s+(?:correct|right)|try\\s+again|answer\\s+is\\s+wrong|failed|failure|error)\\b"
                    + "|غير\\s+صحيح(?:ة)?|إجابة\\s+خاطئة|اجابة\\s+خاطئة|إجابة\\s+غير\\s+صحيحة|اجابة\\s+غير\\s+صحيحة"
                    + "|خطأ|خاطئ|خاطئة|ليست\\s+صحيحة|أعد\\s+المحاولة|اعد\\s+المحاولة|فشل|غير\\s+مقبول"
                    + "|不正解|誤り|間違い|まちがい|違います|正しくありません|失敗",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
    private static final Pattern POSITIVE_FEEDBACK = Pattern.compile(
            "(?:^|[.!?]\\s*)correct(?:[.!?,]|$)|\\b(?:well\\s+done|congratulations|completed\\s+successfully)\\b"
                    + "|\\b(?:(?:your|the)\\s+)?answer\\s+is\\s+correct\\b"
                    + "|إجابة\\s+صحيحة|اجابة\\s+صحيحة|الإجابة\\s+صحيحة|الاجابة\\s+صحيحة"
                    + "|أحسنت|احسنت|تم\\s+بنجاح|إجابة\\s+صائبة|اجابة\\s+صائبة"
                    + "|正解です|正解しました|正解[！!] ?",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);

    private QureoSafetyPolicy() {}

    static boolean hasExplicitAnswerSuccess(String feedback) {
        String text = normalize(feedback);
        return !text.isEmpty() && !NEGATIVE_FEEDBACK.matcher(text).find()
                && POSITIVE_FEEDBACK.matcher(text).find();
    }

    static boolean hasUnambiguousAnswerSuccess(String feedback, boolean feedbackAmbiguous) {
        return !feedbackAmbiguous && hasExplicitAnswerSuccess(feedback);
    }

    static boolean hasExplicitAnswerFailure(String feedback) {
        String text = normalize(feedback);
        return !text.isEmpty() && NEGATIVE_FEEDBACK.matcher(text).find();
    }

    static boolean exactAnswerMatches(String proposed, String observed) {
        if (proposed == null || observed == null || proposed.isEmpty()) return false;
        return proposed.replace("\r\n", "\n").replace('\r', '\n')
                .equals(observed.replace("\r\n", "\n").replace('\r', '\n'));
    }

    static String classifyQuestionType(JSONObject snapshot) {
        JSONArray choices = snapshot == null ? null : snapshot.optJSONArray("choices");
        JSONArray fields = snapshot == null ? null : snapshot.optJSONArray("fields");
        String[] buttons = strings(snapshot == null ? null : snapshot.optJSONArray("buttons"));
        int fieldCount = fields == null ? 0 : fields.length();
        boolean oneChoiceGroup = snapshot != null && snapshot.optInt("choiceGroupCount", 0) == 1
                && snapshot.optInt("checkboxCount", 0) == 0;
        if (oneChoiceGroup && choices != null && choices.length() >= 2 && choices.length() <= 6) {
            Set<String> labels = new HashSet<>();
            String kind = "";
            boolean valid = true;
            for (int i = 0; i < choices.length(); i++) {
                JSONObject choice = choices.optJSONObject(i);
                if (choice == null) { valid = false; break; }
                String label = normalize(choice.optString("label", ""));
                String controlKind = choice.optString("controlKind", "");
                if (label.isEmpty() || !("radio".equals(controlKind) || "select".equals(controlKind))
                        || !labels.add(label) || (!kind.isEmpty() && !kind.equals(controlKind))) {
                    valid = false;
                    break;
                }
                kind = controlKind;
            }
            boolean radioOnly = "radio".equals(kind) && fieldCount == 0;
            boolean selectOnly = "select".equals(kind) && fieldCount == 1
                    && fields != null && "select".equals(fields.optJSONObject(0) == null ? "" : fields.optJSONObject(0).optString("kind", ""));
            if (valid && (radioOnly || selectOnly) && findAutoSubmitControl("choice", buttons) != null) return "choice";
        }
        if ((choices != null && choices.length() > 0) || (snapshot != null
                && (snapshot.optInt("choiceGroupCount", 0) > 0 || snapshot.optInt("checkboxCount", 0) > 0))) return "unsupported";

        if (fields == null || fields.length() != 1) return "unsupported";
        JSONObject field = fields.optJSONObject(0);
        if (field == null) return "unsupported";
        String kind = field.optString("kind", "");
        String type = normalize(field.optString("type", ""));
        if ("code".equals(kind) || "editable".equals(kind) || "textarea".equals(kind) || "textarea".equals(type)) {
            return findAutoSubmitControl("code", buttons) == null ? "unsupported" : "code";
        }
        if ("input".equals(kind) && (type.isEmpty() || "text".equals(type) || "number".equals(type) || "search".equals(type))) {
            return findAutoSubmitControl("text", buttons) == null ? "unsupported" : "text";
        }
        return "unsupported";
    }

    static String findAutoSubmitControl(String questionType, String[] visibleButtons) {
        if ("code".equals(questionType)) {
            return uniqueVisible(new String[] {"run", "execute", "تشغيل", "تنفيذ", "実行"}, visibleButtons);
        }
        if (!("choice".equals(questionType) || "text".equals(questionType))) return null;
        String[] checkLabels = {"check", "check answer", "تحقق", "تحقق من الإجابة", "採点"};
        int checkCount = visibleMatchCount(checkLabels, visibleButtons);
        if (checkCount > 1) return null;
        if (checkCount == 1) return uniqueVisible(checkLabels, visibleButtons);
        return uniqueVisible(new String[] {"submit", "submit answer", "إرسال", "إرسال الإجابة", "回答する"}, visibleButtons);
    }

    static boolean isAllowedAnswerAction(JSONObject action, JSONObject snapshot, boolean fromLibrary) {
        if (action == null || snapshot == null) return false;
        String type = action.optString("type", "");
        String questionType = classifyQuestionType(snapshot);
        if (!fromLibrary) {
            double confidence = action.optDouble("confidence", -1);
            if (confidence < 0.95 || confidence > 1 || action.optString("reason", "").trim().length() < 8) return false;
            String candidate = "select".equals(type) ? action.optString("target", "") : action.optString("value", "");
            JSONObject crossCheck = action.optJSONObject("cross_check");
            if (crossCheck == null || !candidate.equals(crossCheck.optString("answer", ""))
                    || !isAllowedCrossCheckMethod(crossCheck.optString("method", ""))
                    || crossCheck.optString("check", "").trim().length() < 12) return false;
        }
        if ("select".equals(type) && "choice".equals(questionType)) {
            String target = normalize(action.optString("target", ""));
            JSONArray choices = snapshot.optJSONArray("choices");
            if (target.isEmpty() || choices == null) return false;
            for (int i = 0; i < choices.length(); i++) {
                JSONObject choice = choices.optJSONObject(i);
                if (choice != null && target.equals(normalize(choice.optString("label", "")))) return true;
            }
            return false;
        }
        if ("fill".equals(type) && ("text".equals(questionType) || "code".equals(questionType))) {
            JSONArray fields = snapshot.optJSONArray("fields");
            if (fields == null || fields.length() != 1) return false;
            JSONObject field = fields.optJSONObject(0);
            if (field == null) return false;
            String target = normalize(action.optString("target", ""));
            String label = normalize(field.optString("label", ""));
            String placeholder = normalize(field.optString("placeholder", ""));
            boolean targetMatches = target.isEmpty() || target.equals(label) || target.equals(placeholder);
            String value = action.optString("value", "");
            return targetMatches && !value.trim().isEmpty() && value.length() <= 5000;
        }
        return false;
    }

    static boolean isAllowedClickTarget(String target, String pageText, String[] visibleButtons, boolean successConfirmed) {
        String label = normalize(target);
        if (label.isEmpty() || !isVisibleButton(label, visibleButtons)) return false;

        boolean trackOption = "javascript".equals(label) || "java".equals(label) || "python".equals(label);
        if (trackOption) {
            String page = normalize(pageText);
            boolean selectionScreen = page.matches("(?s).*(choose|select|language|track|course|programming|اختر|اختيار|لغة|المسار|المقرر|البرمجة|コース|言語|選択).*");
            return selectionScreen && hasBothTrackChoices(visibleButtons);
        }

        boolean next = "next".equals(label) || "continue".equals(label)
                || "التالي".equals(label) || "متابعة".equals(label) || "次へ".equals(label);
        return next && successConfirmed;
    }

    private static boolean hasBothTrackChoices(String[] visibleButtons) {
        boolean java = false;
        boolean javascript = false;
        boolean python = false;
        if (visibleButtons == null) return false;
        for (String button : visibleButtons) {
            String normalized = normalize(button);
            java |= "java".equals(normalized);
            javascript |= "javascript".equals(normalized);
            python |= "python".equals(normalized);
        }
        return (javascript || java) && python;
    }

    private static boolean isVisibleButton(String target, String[] visibleButtons) {
        if (visibleButtons == null) return false;
        for (String button : visibleButtons) if (target.equals(normalize(button))) return true;
        return false;
    }

    private static String uniqueVisible(String[] candidates, String[] visibleButtons) {
        if (visibleButtons == null) return null;
        String found = null;
        for (String candidate : candidates) {
            for (String button : visibleButtons) {
                if (!candidate.equals(normalize(button))) continue;
                if (found != null) return null;
                found = button;
            }
        }
        return found;
    }

    private static int visibleMatchCount(String[] candidates, String[] visibleButtons) {
        if (visibleButtons == null) return 0;
        int count = 0;
        for (String candidate : candidates) {
            for (String button : visibleButtons) if (candidate.equals(normalize(button))) count++;
        }
        return count;
    }

    private static String[] strings(JSONArray array) {
        if (array == null) return new String[0];
        String[] result = new String[array.length()];
        for (int i = 0; i < array.length(); i++) result[i] = array.optString(i, "");
        return result;
    }

    private static boolean isAllowedCrossCheckMethod(String method) {
        return "recalculation".equals(method) || "rule_check".equals(method)
                || "code_trace".equals(method) || "independent_derivation".equals(method);
    }

    private static String normalize(String value) {
        return Normalizer.normalize(value == null ? "" : value, Normalizer.Form.NFKC)
                .toLowerCase(Locale.ROOT).replaceAll("\\s+", " ").trim();
    }
}
