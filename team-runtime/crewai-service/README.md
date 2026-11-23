# CrewAI planning service

This directory contains the CrewAI coordinator/planning layer only. It exposes a small standard-library HTTP server; it does not import MetaGPT or connect to the separate MetaGPT backend. Crew members are AI agents with user-selected display names. The API identifies them as AI specialists and the service only returns planning text: it has no tools, file/code execution, or external side effects.

## Run

Python 3.12+ is recommended. Install dependencies with `python -m pip install -r requirements.txt`. Set a strong `SERVICE_TOKEN` before starting; requests to `POST /run` require `Authorization: Bearer <token>`. Use `MOCK_MODE=1` to exercise the HTTP/API behavior without a model provider or network. Production model calls use CrewAI's `Agent`, `Task`, `Crew`, `Process.sequential`, and `LLM` APIs.

```sh
cd /home/ubuntu/output/target-mohamed-ai/team-runtime/crewai-service
SERVICE_TOKEN='replace-with-secret' MOCK_MODE=1 python app.py
```

`GET /health` is unauthenticated and returns status plus the available specialist IDs and display names. `POST /run` accepts only JSON of the form `{"prompt":"Build a habit tracking app"}`. The prompt is truncated to `MAX_PROMPT_CHARS` (default 8,000; hard maximum 20,000), and request size is bounded by `MAX_BODY_BYTES` (default 12,000). Output includes selected role IDs/display names, concise team output, and mode. Selection is deterministic and bilingual: the coordinator is always present, then up to five specialists are selected by role-specific English and Arabic keyword matching. There is no caller-supplied role list. The roster covers product, architecture, UX/UI, frontend, backend, mobile, database/data, AI/ML, QA, security/privacy, cloud/DevOps, and technical documentation.

## Names and model configuration

Copy `roster.example.json` to a JSON file and set `ROSTER_FILE=/path/to/roster.json` to customize the fictional AI characters' display names. Its keys may only be `leader` plus the allowed specialist IDs: `product`, `architecture`, `design`, `frontend`, `backend`, `mobile`, `data`, `ai_ml`, `qa`, `security`, `devops`, and `docs`. Environment variables such as `NAME_LEADER` or `NAME_MOBILE` override file values. Names are trimmed and capped at 60 characters. These are explicitly AI personas, not claims about real people; no provider/model information is exposed in the user-facing roster.

For non-mock operation, configure provider credentials per CrewAI's provider requirements, commonly `OPENAI_API_KEY`. `CREWAI_MODEL` optionally sets the CrewAI model identifier (default `openai/gpt-4o-mini`); `LLM_API_KEY` and `LLM_BASE_URL` optionally provide explicit credentials or an OpenAI-compatible endpoint. Model identifiers and credentials are server configuration, not response roster fields. Provider packaging/configuration varies; install any provider-specific dependency required by the chosen model.

## Docker

Build from this directory with `docker build -t crewai-planner .`; run with `docker run --rm -p 8080:8080 -e SERVICE_TOKEN='replace-with-secret' -e MOCK_MODE=1 crewai-planner`. To mount a roster file, mount it read-only and set `ROSTER_FILE` to its container path. Avoid exposing this service publicly without TLS termination, secret management, and appropriate network controls.

## Limits

This is a bounded planning service, not an app builder/executor. Generated plans are advisory and must be reviewed by a person. Authentication is a shared bearer token; deploy behind a trusted proxy and use a high-entropy secret. The standard-library server is intentionally minimal and does not implement TLS, rate limiting, persistent jobs, or provider request timeouts. Specialist matching uses fixed keyword rules rather than model-based classification. `GET /health` exposes configured display names by design.

## API examples

```sh
curl http://localhost:8080/health
curl -X POST http://localhost:8080/run \
  -H 'Authorization: Bearer replace-with-secret' \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Plan a secure habit tracking web app with a frontend and backend"}'
```
