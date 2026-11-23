# Mohamed AI connectors

Mohamed AI uses an allowlisted connector registry. A connector is not considered connected until its server-side credential is configured and its health check succeeds.

## Planned and supported boundaries

- **GitHub**: read-only repository metadata and source files by default. The server endpoints are `/api/connectors/github/repos` and `/api/connectors/github/file?repo=owner/repo&path=README.md`; no write endpoint is exposed.
- **Google Drive / PDF / Word**: read-only file listing and download/export through `/api/connectors/google-drive/files` and `/api/connectors/google-drive/file?id=FILE_ID`; parsing happens in the server sandbox.
- **Gmail**: read-only mail search and metadata through `/api/connectors/gmail/messages?q=...`. Sending mail requires a separate explicit approval and is never enabled by a token alone.
- **Google Calendar**: read-only event lookup through `/api/connectors/calendar/events`. Creating or editing events requires explicit confirmation.
- **Web search**: read-only research results with source URLs through `/api/connectors/web-search?q=QUERY`; the current adapter expects a Bing Web Search API key in `WEB_SEARCH_API_KEY`, and makes no claim of live browsing when it is not configured.
- **Microphone and speech**: browser/Android permission only. Speech recognition fills the composer locally and speech synthesis reads the last answer locally; audio is not uploaded automatically.

Never put OAuth access tokens, API keys, or passwords in the Android app or Git repository. Configure them on the private server and expose only the minimum connector scopes. Permanent deletion is not a supported agent action; destructive operations must be replaced with trash/archive and explicit confirmation.

The registry reports availability only. It does not grant permission to send, delete, purchase, publish, or modify external data.

## GitHub: ربط مباشر داخل المحادثة (1.7)

- **القراءة التلقائية:** أي رابط `https://github.com/owner/repo` (أو ملف `/blob/branch/path`) داخل السؤال يجلب الخادم منه الوصف وREADME وقائمة الملفات (أو محتوى الملف) ويضيفها كمرجع للنموذج مع المصدر. أرسل `useGithub: false` لتعطيل ذلك. حد أقصى 3 روابط للرسالة، والمحتوى يُعامل كبيانات وليس تعليمات.
- **المستودعات الخاصة:** `GITHUB_TOKEN` يُستخدم فقط مع الملاك المذكورين في `GITHUB_ALLOWED_OWNERS` (مفصولين بفواصل). أي مالك آخر يُقرأ كمستودع عام بدون رمز، فلا يتسرب وصولك الخاص لباقي المستخدمين.
- **الكتابة (مغلقة افتراضيًا):** تتطلب `GITHUB_WRITE=1` وأن يكون المالك في القائمة وأن يرسل الطلب `confirm: true`:
  - `POST /api/connectors/github/issue` بجسم `{ "repo": "owner/repo", "title": "...", "body": "...", "confirm": true }`
  - `POST /api/connectors/github/comment` بجسم `{ "repo": "owner/repo", "number": 12, "body": "...", "confirm": true }`
- استخدم رمزًا دقيق الصلاحيات (Fine-grained) على المستودعات المطلوبة فقط: قراءة المحتوى، وللكتابة صلاحية Issues فقط.
- الدفع (commit/PR) غير مدعوم عمدًا في هذا الإصدار.
