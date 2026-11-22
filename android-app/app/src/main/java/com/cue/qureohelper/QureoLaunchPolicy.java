package com.cue.qureohelper;

/** Pure decision policy for falling back to QUREO sign-in without sending lessons to an unverified helper. */
final class QureoLaunchPolicy {
    private QureoLaunchPolicy() {}

    static boolean shouldUseLoginOnly(String serverBase, String helperPassword, String healthError) {
        return serverBase == null || serverBase.trim().isEmpty()
                || helperPassword == null || helperPassword.trim().isEmpty()
                || healthError != null;
    }
}
