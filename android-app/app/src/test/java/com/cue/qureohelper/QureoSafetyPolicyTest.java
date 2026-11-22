package com.cue.qureohelper;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public final class QureoSafetyPolicyTest {
    @Test
    public void recognizesOnlyClearPositiveAnswerFeedbackAndRejectsNegationFirst() {
        assertTrue(QureoSafetyPolicy.hasExplicitAnswerSuccess("Correct!"));
        assertTrue(QureoSafetyPolicy.hasExplicitAnswerSuccess("The answer is correct."));
        assertTrue(QureoSafetyPolicy.hasExplicitAnswerSuccess("Well done!"));
        assertTrue(QureoSafetyPolicy.hasExplicitAnswerSuccess("إجابة صحيحة"));
        assertTrue(QureoSafetyPolicy.hasExplicitAnswerSuccess("أحسنت"));
        assertTrue(QureoSafetyPolicy.hasExplicitAnswerSuccess("正解です"));
        assertTrue(QureoSafetyPolicy.hasExplicitAnswerSuccess("正解！"));
        assertFalse(QureoSafetyPolicy.hasUnambiguousAnswerSuccess("Correct!", true));
        assertTrue(QureoSafetyPolicy.hasUnambiguousAnswerSuccess("Correct!", false));

        for (String feedback : new String[] {
                "", "Please try again later.", "The lesson continues.",
                "Correct answer: 4.", "The correct answer is 4.", "This is the correct option.",
                "Incorrect! Try again.", "incorrectly marked correct", "This is not correct.",
                "This is not right; correct output is shown.", "Correct! Actually, incorrect.",
                "Wrong answer.", "Correct, but error: the submission failed.",
                "إجابة غير صحيحة", "خطأ، أعد المحاولة", "不正解です", "正しくありません",
        }) {
            assertFalse("must not confirm: " + feedback, QureoSafetyPolicy.hasExplicitAnswerSuccess(feedback));
        }
        for (String failure : new String[] {"Incorrect!", "not right", "error", "فشل", "不正解です"}) {
            assertTrue("must identify failure: " + failure, QureoSafetyPolicy.hasExplicitAnswerFailure(failure));
        }
    }

    @Test
    public void recognizesOnlyUnambiguousSyntheticQuestionLayouts() throws Exception {
        assertEquals("choice", QureoSafetyPolicy.classifyQuestionType(radioSnapshot()));
        assertEquals("choice", QureoSafetyPolicy.classifyQuestionType(selectSnapshot()));
        assertEquals("text", QureoSafetyPolicy.classifyQuestionType(textSnapshot()));
        assertEquals("code", QureoSafetyPolicy.classifyQuestionType(codeSnapshot()));

        JSONObject checkbox = radioSnapshot();
        checkbox.put("checkboxCount", 1);
        assertEquals("unsupported", QureoSafetyPolicy.classifyQuestionType(checkbox));
        JSONObject multipleGroups = radioSnapshot();
        multipleGroups.put("choiceGroupCount", 2);
        assertEquals("unsupported", QureoSafetyPolicy.classifyQuestionType(multipleGroups));
        JSONObject ambiguousChoices = radioSnapshot();
        ambiguousChoices.put("fields", new JSONArray().put(new JSONObject().put("kind", "input").put("type", "text")));
        assertEquals("unsupported", QureoSafetyPolicy.classifyQuestionType(ambiguousChoices));
        JSONObject noCheck = textSnapshot();
        noCheck.put("buttons", new JSONArray().put("Next"));
        assertEquals("unsupported", QureoSafetyPolicy.classifyQuestionType(noCheck));
        JSONObject twoFields = textSnapshot();
        twoFields.getJSONArray("fields").put(new JSONObject().put("kind", "input").put("type", "text"));
        assertEquals("unsupported", QureoSafetyPolicy.classifyQuestionType(twoFields));
        JSONObject noRun = codeSnapshot();
        noRun.put("buttons", new JSONArray().put("Check"));
        assertEquals("unsupported", QureoSafetyPolicy.classifyQuestionType(noRun));
    }

    @Test
    public void validatesExactAnswerTargetConfidenceAndVisibleControl() throws Exception {
        JSONObject choice = selectAction("4", 0.99);
        assertTrue(QureoSafetyPolicy.isAllowedAnswerAction(choice, radioSnapshot(), false));
        assertFalse(QureoSafetyPolicy.isAllowedAnswerAction(selectAction("4 or 5", 0.99), radioSnapshot(), false));
        assertFalse(QureoSafetyPolicy.isAllowedAnswerAction(selectAction("4", 0.80), radioSnapshot(), false));
        assertEquals("Check", QureoSafetyPolicy.findAutoSubmitControl("choice", new String[] {"4", "5", "Check"}));
        assertEquals("Submit", QureoSafetyPolicy.findAutoSubmitControl("text", new String[] {"Submit"}));
        assertEquals("Run", QureoSafetyPolicy.findAutoSubmitControl("code", new String[] {"Run"}));
        assertEquals(null, QureoSafetyPolicy.findAutoSubmitControl("code", new String[] {"Run", "Execute"}));
        assertEquals(null, QureoSafetyPolicy.findAutoSubmitControl("choice", new String[] {"Check", "Check answer"}));

        JSONObject text = fillAction("Answer", "4", 0.99);
        assertTrue(QureoSafetyPolicy.isAllowedAnswerAction(text, textSnapshot(), false));
        assertFalse(QureoSafetyPolicy.isAllowedAnswerAction(fillAction("Other", "4", 0.99), textSnapshot(), false));
        JSONObject missingCrossCheck = fillAction("Answer", "4", 0.99);
        missingCrossCheck.remove("cross_check");
        assertFalse(QureoSafetyPolicy.isAllowedAnswerAction(missingCrossCheck, textSnapshot(), false));
        JSONObject mismatchedCrossCheck = fillAction("Answer", "4", 0.99);
        mismatchedCrossCheck.getJSONObject("cross_check").put("answer", "5");
        assertFalse(QureoSafetyPolicy.isAllowedAnswerAction(mismatchedCrossCheck, textSnapshot(), false));
        assertTrue(QureoSafetyPolicy.isAllowedAnswerAction(new JSONObject().put("type", "fill").put("target", "Answer").put("value", "4"), textSnapshot(), true));
    }

    @Test
    public void loginRetriesAreBoundedAndOnlyForIncompleteOrAmbiguousFormStates() {
        assertTrue(QureoLoginPolicy.shouldRetryFormObservation("no_password", 1));
        assertTrue(QureoLoginPolicy.shouldRetryFormObservation("no_username", 23));
        assertTrue(QureoLoginPolicy.shouldRetryFormObservation("ambiguous_form", 3));
        assertTrue(QureoLoginPolicy.shouldRetryFormObservation("no_submit", 4));
        assertFalse(QureoLoginPolicy.shouldRetryFormObservation("not_login", 1));
        assertFalse(QureoLoginPolicy.shouldRetryFormObservation("no_submit", QureoLoginPolicy.MAX_FORM_OBSERVATIONS));
        assertFalse(QureoLoginPolicy.shouldRetryFormObservation("no_password", -1));

        assertTrue(QureoLoginPolicy.shouldWaitForLoginTransition(true, false, 19));
        assertFalse(QureoLoginPolicy.shouldWaitForLoginTransition(false, false, 1));
        assertFalse(QureoLoginPolicy.shouldWaitForLoginTransition(true, true, 1));
        assertFalse(QureoLoginPolicy.shouldWaitForLoginTransition(true, false, QureoLoginPolicy.MAX_RESULT_OBSERVATIONS));
    }

    @Test
    public void helperValidationFailureFallsBackToLoginOnly() {
        assertTrue(QureoLaunchPolicy.shouldUseLoginOnly("", "helper-password", null));
        assertTrue(QureoLaunchPolicy.shouldUseLoginOnly("https://helper.example", "", null));
        assertTrue(QureoLaunchPolicy.shouldUseLoginOnly("https://helper.example", "helper-password", "HTTP 401"));
        assertTrue(QureoLaunchPolicy.shouldUseLoginOnly(null, null, null));
        assertFalse(QureoLaunchPolicy.shouldUseLoginOnly("https://helper.example", "helper-password", null));
    }

    @Test
    public void allowsTrackChoiceOnlyOnTrackSelectorAndNextOnlyAfterSuccess() {
        String[] trackButtons = { "JavaScript", "Python" };
        assertTrue(QureoSafetyPolicy.isAllowedClickTarget("JavaScript", "Choose a programming language", trackButtons, false));
        assertFalse(QureoSafetyPolicy.isAllowedClickTarget("Java", "Choose a programming language", trackButtons, false));
        assertTrue(QureoSafetyPolicy.isAllowedClickTarget("Python", "Choose a programming language", trackButtons, false));
        assertFalse(QureoSafetyPolicy.isAllowedClickTarget("JavaScript", "What does JavaScript print?", trackButtons, false));
        assertFalse(QureoSafetyPolicy.isAllowedClickTarget("JavaScript", "Choose a programming language", new String[] { "JavaScript" }, false));
        String[] legacyTrackButtons = { "Java", "Python" };
        assertTrue(QureoSafetyPolicy.isAllowedClickTarget("Java", "Choose a programming language", legacyTrackButtons, false));

        String[] answerButtons = { "4", "Check", "Submit", "Next" };
        assertFalse(QureoSafetyPolicy.isAllowedClickTarget("4", "Choose the answer", answerButtons, false));
        assertFalse(QureoSafetyPolicy.isAllowedClickTarget("Check", "Choose the answer", answerButtons, false));
        assertFalse(QureoSafetyPolicy.isAllowedClickTarget("Submit", "Choose the answer", answerButtons, false));
        assertFalse(QureoSafetyPolicy.isAllowedClickTarget("Next", "Choose the answer", answerButtons, false));
        assertTrue(QureoSafetyPolicy.isAllowedClickTarget("Next", "Correct!", answerButtons, true));
        assertFalse(QureoSafetyPolicy.isAllowedClickTarget("Grade", "Correct!", new String[] { "Grade" }, true));
    }

    @Test
    public void cachesOnlyTheExactProposalThatQureoAccepted() {
        assertTrue(QureoSafetyPolicy.exactAnswerMatches("print(1)\n", "print(1)\r\n"));
        assertFalse(QureoSafetyPolicy.exactAnswerMatches("print(1)", "print(2)"));
        assertFalse(QureoSafetyPolicy.exactAnswerMatches("", "some answer"));
        assertFalse(QureoSafetyPolicy.exactAnswerMatches("answer", null));
    }

    @Test
    public void cacheFingerprintIncludesVisibleChoiceLabels() throws Exception {
        JSONObject first = new JSONObject().put("text", "SYNTHETIC TEST ONLY: choose one")
                .put("buttons", new JSONArray().put("Check"))
                .put("choiceGroupCount", 1).put("checkboxCount", 0)
                .put("choices", new JSONArray()
                        .put(new JSONObject().put("controlKind", "radio").put("label", "A"))
                        .put(new JSONObject().put("controlKind", "radio").put("label", "B")));
        JSONObject second = new JSONObject().put("text", "SYNTHETIC TEST ONLY: choose one")
                .put("buttons", new JSONArray().put("Check"))
                .put("choiceGroupCount", 1).put("checkboxCount", 0)
                .put("choices", new JSONArray()
                        .put(new JSONObject().put("controlKind", "radio").put("label", "C"))
                        .put(new JSONObject().put("controlKind", "radio").put("label", "D")));
        assertFalse(SolutionLibrary.fingerprint("Java", first).equals(SolutionLibrary.fingerprint("Java", second)));
        assertFalse(SolutionLibrary.fingerprint("Java", first).equals(SolutionLibrary.fingerprint("JavaScript", first)));
        assertFalse(SolutionLibrary.fingerprint("Python", first).equals(SolutionLibrary.fingerprint("JavaScript", first)));
    }

    private static JSONObject radioSnapshot() throws JSONException {
        return new JSONObject().put("choiceGroupCount", 1).put("checkboxCount", 0)
                .put("buttons", new JSONArray().put("Check"))
                .put("fields", new JSONArray())
                .put("choices", new JSONArray()
                        .put(new JSONObject().put("controlKind", "radio").put("label", "4").put("selected", false))
                        .put(new JSONObject().put("controlKind", "radio").put("label", "5").put("selected", false)));
    }

    private static JSONObject selectSnapshot() throws JSONException {
        JSONObject field = new JSONObject().put("kind", "select").put("type", "select").put("label", "Answer");
        return new JSONObject().put("choiceGroupCount", 1).put("checkboxCount", 0)
                .put("buttons", new JSONArray().put("Submit"))
                .put("fields", new JSONArray().put(field))
                .put("choices", new JSONArray()
                        .put(new JSONObject().put("controlKind", "select").put("label", "4"))
                        .put(new JSONObject().put("controlKind", "select").put("label", "5")));
    }

    private static JSONObject textSnapshot() throws JSONException {
        return new JSONObject().put("choiceGroupCount", 0).put("checkboxCount", 0)
                .put("buttons", new JSONArray().put("Check"))
                .put("fields", new JSONArray().put(new JSONObject().put("kind", "input").put("type", "text")
                        .put("label", "Answer").put("placeholder", "Type answer").put("value", "4")))
                .put("choices", new JSONArray());
    }

    private static JSONObject codeSnapshot() throws JSONException {
        return new JSONObject().put("choiceGroupCount", 0).put("checkboxCount", 0)
                .put("buttons", new JSONArray().put("Run"))
                .put("fields", new JSONArray().put(new JSONObject().put("kind", "code").put("type", "textarea")
                        .put("label", "Code editor").put("value", "System.out.println(4);")))
                .put("choices", new JSONArray());
    }

    private static JSONObject selectAction(String target, double confidence) throws JSONException {
        return new JSONObject().put("type", "select").put("target", target).put("confidence", confidence)
                .put("reason", "The expression evaluates to four.")
                .put("cross_check", new JSONObject().put("answer", target).put("method", "recalculation")
                        .put("check", "Synthetic cross-check: two plus two is four."));
    }

    private static JSONObject fillAction(String target, String value, double confidence) throws JSONException {
        return new JSONObject().put("type", "fill").put("target", target).put("value", value)
                .put("confidence", confidence).put("reason", "The visible question gives this result.")
                .put("cross_check", new JSONObject().put("answer", value).put("method", "recalculation")
                        .put("check", "Synthetic cross-check: two plus two is four."));
    }
}
