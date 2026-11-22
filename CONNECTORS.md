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
