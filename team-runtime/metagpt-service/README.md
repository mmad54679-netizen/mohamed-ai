# Isolated MetaGPT generation API

This directory contains a standalone Python 3.11 service. It writes generated projects only beneath `ARTIFACT_ROOT`, using one fresh private working directory per build. It does not publish, deploy, commit, or access a user's existing repository.

## Important security note

MetaGPT generation may execute commands and tests while creating a project. Run this service only inside a strongly isolated container with restricted network access, CPU/memory/process limits, a non-root user, and a dedicated writable artifact volume. Do not mount source repositories, host credentials, Docker sockets, or other sensitive host paths into it. The API requires LLM provider credentials/configuration for real generation; set MetaGPT's normal config (for example its `config2.yaml` or supported provider environment configuration) inside the container securely. Never bake credentials into the image. The service suppresses child-process output and returns generic generation errors to avoid leaking provider errors or secrets.

## API

All routes except `GET /health` require `Authorization: Bearer <SERVICE_BEARER_TOKEN>`. Set a long random token via secret injection. The token is compared in constant time. Do not expose this service directly to an untrusted network; use TLS and a trusted proxy/firewall.

`POST /build` accepts JSON `{"idea":"..."}`. Successful responses have the exact shape:

```json
{
  "projectId": "32-character-lowercase-hex-id",
  "manifest": [{"path":"README.md","size_bytes":123}],
  "downloadPath": "/artifact/32-character-lowercase-hex-id"
}
```

The manifest lists relative file names and byte sizes only; no host paths are returned. `GET /artifact/{projectId}` streams a ZIP containing only that generated project's regular files. `GET /projects/{projectId}` returns its manifest again. IDs are strict 32-character lowercase hex values; traversal strings are rejected as not found. The archive is created temporarily under the artifact root (not inside the project directory) and removed after streaming. Both archive input size and resulting ZIP size are capped.

## Configuration and limits

| Variable | Default | Purpose |
| --- | --- | --- |
| `SERVICE_BEARER_TOKEN` | unset | Required API token; without it generation/retrieval return 503 |
| `ARTIFACT_ROOT` | `/var/lib/metagpt/artifacts` | Dedicated artifact storage root |
| `MAX_BODY_BYTES` | `12000` | Maximum POST body |
| `MAX_IDEA_CHARS` | `10000` | Maximum idea length |
| `GENERATION_TIMEOUT_SECONDS` | `1800` | Worker subprocess timeout; timeout kills the worker |
| `MAX_ARCHIVE_BYTES` | 100 MiB | Maximum source payload and compressed ZIP size |
| `MAX_MANIFEST_FILES` | `2000` | Maximum regular files represented in a manifest |
| `METAGPT_MOCK` | `0` | Set to `1` for deterministic mock output without MetaGPT/provider credentials |

Generation uses a subprocess so the API can kill it on timeout. The parent call remains occupied while generating, so deploy with a bounded request concurrency and external resource limits. The API's body and artifact limits are application safeguards, not a substitute for container quotas.

## Run

Build and run the container with a persistent volume mounted only at `/var/lib/metagpt/artifacts`, and inject secrets at runtime:

```sh
docker build -t metagpt-service .
docker run --rm -p 127.0.0.1:8000:8000 \
  -e SERVICE_BEARER_TOKEN='replace-with-a-long-random-secret' \
  -e METAGPT_MOCK=1 \
  -v metagpt-artifacts:/var/lib/metagpt/artifacts \
  --memory=4g --cpus=2 --pids-limit=128 \
  metagpt-service
```

For a local Python 3.11 environment, use `python3.11 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt`; then run `uvicorn metagpt_service.app:app --host 127.0.0.1 --port 8000`. The dependency file keeps MetaGPT below 1.0 and pins the API framework dependencies; qualify and lock the full transitive dependency set for production builds.

## Mock verification

With Python 3.11 and the listed dependencies installed:

```sh
SERVICE_BEARER_TOKEN=test-token METAGPT_MOCK=1 ARTIFACT_ROOT=/tmp/metagpt-artifacts \
  uvicorn metagpt_service.app:app --host 127.0.0.1 --port 8000
curl -H 'Authorization: Bearer test-token' -H 'Content-Type: application/json' \
  -d '{"idea":"A sample project"}' http://127.0.0.1:8000/build
```

Use the returned `projectId` to GET `/artifact/{projectId}` with the same bearer header.

## MetaGPT API source

The worker invokes `metagpt.software_company.generate_repo(idea=..., project_path=..., project_name=..., inc=False, recover_path=None)`. In MetaGPT's official source, `generate_repo` accepts `project_path` and passes it to `config.update_via_cli`; the CLI parameter description identifies it as the project directory. The worker uses a unique, empty absolute workspace and explicitly disables incremental/recovery behavior. Source: [MetaGPT software_company.py](https://raw.githubusercontent.com/FoundationAgents/MetaGPT/main/metagpt/software_company.py).
