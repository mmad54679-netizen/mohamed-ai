package com.cue.qureohelper;

/** Bounded retry rules for synthetic and live QUREO login-state observations. */
final class QureoLoginPolicy {
    static final int MAX_FORM_OBSERVATIONS = 24;
    static final int MAX_RESULT_OBSERVATIONS = 20;

    private QureoLoginPolicy() {}

    static boolean shouldRetryFormObservation(String kind, int observations) {
        if (observations < 0 || observations >= MAX_FORM_OBSERVATIONS) return false;
        return "no_password".equals(kind) || "no_username".equals(kind)
                || "no_submit".equals(kind) || "ambiguous_form".equals(kind);
    }

    static boolean shouldWaitForLoginTransition(boolean visiblePasswordForm, boolean loginRejected, int observations) {
        return visiblePasswordForm && !loginRejected && observations >= 0
                && observations < MAX_RESULT_OBSERVATIONS;
    }
}
