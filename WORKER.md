# Cloudflare Worker status

The configured service URL remains `https://qureo-helper.qureo-helper.workers.dev`. The Android app still requires the existing helper-service password for authenticated cloud solving. No Worker, secret, account credential, or deployment setting was changed during this work.

## Version 1.4.1 source status

The app home page is now an Arabic-only QUREO conversation interface. It offers JavaScript and Python (with legacy Java retained separately for compatibility) plus the manual question/image helper. Up to four prior chat messages can be included in the next request; the transcript is held in memory for the current app session and is not persisted as chat history. Existing local task recovery remains unchanged.

The local `worker.mjs` and Node `server.js` prompts now limit manual help to QUREO programming questions and instruct responses in Arabic. The `worker.mjs` source was **not deployed**. Its live health/provider state and plan format have not been checked. If the live Worker returns an older plan without the required `cross_check`, the Android client will stop before submitting an answer. The old Worker URL and configured secrets remain untouched. Do not assume the live service uses the updated prompt or parser.

The user’s QUREO username/password alone can open the QUREO page, but new cloud plans also require a valid HTTPS helper URL and helper-service password. If the service cannot be authenticated or validated, the app falls back to login-only mode and does not send the lesson snapshot to that endpoint. Previously confirmed exact local solutions may still work if enabled.

## What the automation recognizes

The app reads page content and visible answer controls from QUREO’s DOM; it is not a general visual page-understanding system. Automatic answering is limited to one clear radio/dropdown group with 2–6 choices, one text/number field, or one code editor, with a recognized Check/Submit/Run control. The model must provide a candidate and a matching cross-check, but that is not proof that the answer is right. The client independently checks the page and continues only after fresh, unambiguous success feedback from QUREO. It stops on ambiguity, unsupported controls, explicit failure, or unclear feedback, and never retries an answer automatically. It cannot promise to complete every lesson or course.

A real QUREO account was opened in the desktop browser, but no answer was submitted and the app itself was not run on a device. The real portal presents a learning-login choice before the login form. The account's available tracks are JavaScript and Python. The launcher, local validators, and Node/Worker source now accept JavaScript as its own track; cache fingerprints do not merge it with legacy Java. The current JavaScript lesson presents a custom code editor and a button labeled «تشغيل الكود», which the existing automatic action whitelist does not support. The real dashboard's generic course cards and chapter navigation also have not been safely automated. Live automatic solving, grading, and course completion remain untested. All code tests use synthetic material. The app is not tested against the current live Worker or a real Android device; the updated Worker source was not deployed.

## Release record

- Android package: `com.cue.qureohelper`.
- App version: `1.4.1` (`versionCode 9`), Debug build, minimum Android API 24, target API 35.
- APK: `/workspace/qureo-helper-android-v1.4.1-debug.apk` (7,775,538 bytes; SHA-256 `7e61b616a170e660ec3fd09b87b711527fd5fb191ca76e0c9cdaae42ea8829d3`).
- APK metadata verified: `com.cue.qureohelper`, versionCode 9, versionName 1.4.1, minSdk 24, targetSdk 35. APK v2 Debug signature verified, 4-byte alignment verified, and ZIP integrity passed.
- Source archive: `/workspace/qureo-helper-source-v1.4.1.zip` (build caches, local settings, APKs, and `.wrangler` state excluded).
- Tests: Node suite 45/45 passed; dedicated Worker suite 9/9 passed; Android JVM unit tests 8/8 passed; Debug APK assembly succeeded.
- A real QUREO login and read-only lesson inspection were completed in a desktop browser; no real QUREO answer, live Worker request, or Android device/emulator session was exercised.
