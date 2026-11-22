# External verification notes

These notes record public documentation and read-only endpoint observations only; no user credentials, QUREO account data, or answer submissions were used.

## Gemini model and free-tier status

- Google's official [Gemini API model catalog](https://aistudio.google.com/docs/models) lists the endpoint name `gemini-3.5-flash-lite` as a current Gemini 3 model.
- Google's official [Gemini API pricing page](https://aistudio.google.com/docs/pricing) lists `gemini-3.5-flash-lite` with free input and output tokens on the Free Tier; paid pricing is separate. The Worker configuration does not enable grounding or switch to a paid model.

## Existing deployed Worker (read-only observations)

- Endpoint: `https://qureo-helper.qureo-helper.workers.dev`.
- `OPTIONS /api/agent` from the Android WebView origin `https://appassets.androidplatform.net`, requesting `POST` with `authorization,content-type`, returned HTTP 204 and allowed the expected origin and headers.
- Unauthenticated `GET /api/health` returned HTTP 401 and `APP_PASSWORD_REQUIRED`; this is expected for a protected endpoint.
- On 2026-11-22, a fresh unauthenticated health check returned HTTP 401, and the Android-origin preflight returned HTTP 204. No assistant password or provider key was used, so the authenticated health payload and Gemini status were not checked.
- The deployed Worker was inspected in read-only mode in the prior audit; no secrets were read or changed and no deployment was performed. These observations do not establish that the deployed code has the 1.3.0 cross-check requirement or is compatible with the rebuilt APK. The updated Worker source remains local and un-deployed.

No QUREO account or lesson endpoint was accessed for these checks, and no Worker deployment or secret change was made.
