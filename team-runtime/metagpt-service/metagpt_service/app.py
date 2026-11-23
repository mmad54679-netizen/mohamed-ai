from __future__ import annotations

import hmac
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
import zipfile
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

ARTIFACT_ROOT = Path(os.environ.get("ARTIFACT_ROOT", "/var/lib/metagpt/artifacts")).resolve()
TOKEN = os.environ.get("SERVICE_BEARER_TOKEN", "")
MOCK = os.environ.get("METAGPT_MOCK", "0").lower() in {"1", "true", "yes"}
BODY_LIMIT = int(os.environ.get("MAX_BODY_BYTES", "12000"))
IDEA_LIMIT = int(os.environ.get("MAX_IDEA_CHARS", "10000"))
GENERATION_TIMEOUT = int(os.environ.get("GENERATION_TIMEOUT_SECONDS", "1800"))
ARCHIVE_LIMIT = int(os.environ.get("MAX_ARCHIVE_BYTES", str(100 * 1024 * 1024)))
MANIFEST_LIMIT = int(os.environ.get("MAX_MANIFEST_FILES", "2000"))
PROJECT_ID_RE = re.compile(r"\A[0-9a-f]{32}\Z")

app = FastAPI(title="Isolated MetaGPT Service", docs_url=None, redoc_url=None)


class BuildRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    idea: str = Field(min_length=1, max_length=10000)


@app.middleware("http")
async def limit_body(request: Request, call_next):
    raw_length = request.headers.get("content-length")
    if raw_length:
        try:
            if int(raw_length) > BODY_LIMIT:
                return JSONResponse(status_code=413, content={"detail": "Request body too large"})
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid Content-Length")
    if request.method == "POST" and request.url.path == "/build":
        body = await request.body()
        if len(body) > BODY_LIMIT:
            return JSONResponse(status_code=413, content={"detail": "Request body too large"})
        request._body = body
    return await call_next(request)


def require_bearer(authorization: Annotated[str | None, Header()] = None) -> None:
    if not TOKEN:
        raise HTTPException(status_code=503, detail="Service authentication is not configured")
    expected = f"Bearer {TOKEN}"
    if authorization is None or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Unauthorized", headers={"WWW-Authenticate": "Bearer"})


def project_dir(project_id: str) -> Path:
    if not PROJECT_ID_RE.fullmatch(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    target = (ARTIFACT_ROOT / project_id).resolve()
    if target.parent != ARTIFACT_ROOT or not target.is_dir():
        raise HTTPException(status_code=404, detail="Project not found")
    return target


def make_manifest(directory: Path) -> list[dict[str, object]]:
    files: list[dict[str, object]] = []
    for root, dirs, names in os.walk(directory, followlinks=False):
        base = Path(root)
        dirs[:] = [d for d in dirs if not (base / d).is_symlink()]
        for name in names:
            item = base / name
            if item.is_symlink() or not item.is_file():
                continue
            if len(files) >= MANIFEST_LIMIT:
                raise HTTPException(status_code=413, detail="Generated project exceeds manifest limit")
            files.append({"path": item.relative_to(directory).as_posix(), "size_bytes": item.stat().st_size})
    files.sort(key=lambda x: str(x["path"]))
    return files


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/build", dependencies=[Depends(require_bearer)])
def build(payload: BuildRequest):
    idea = payload.idea
    if not idea.strip() or len(idea) > IDEA_LIMIT:
        raise HTTPException(status_code=422, detail="Idea is empty or exceeds the configured limit")
    ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)
    project_id = uuid.uuid4().hex
    work_dir = Path(tempfile.mkdtemp(prefix=f"{project_id}-", dir=ARTIFACT_ROOT)).resolve()
    try:
        proc = subprocess.Popen(
            [sys.executable, "-m", "metagpt_service.worker"],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            cwd=str(Path(__file__).resolve().parent.parent),
            env={**os.environ, "METAGPT_PROJECT_PATH": str(work_dir), "METAGPT_MOCK": "1" if MOCK else "0"},
        )
        try:
            proc.communicate(json.dumps({"idea": idea}).encode("utf-8"), timeout=GENERATION_TIMEOUT)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.communicate()
            raise HTTPException(status_code=504, detail="Project generation timed out")
        if proc.returncode != 0:
            raise HTTPException(status_code=502, detail="Project generation failed")
        files = make_manifest(work_dir)
        if not files:
            raise HTTPException(status_code=502, detail="Generation produced no files")
        final_dir = ARTIFACT_ROOT / project_id
        work_dir.rename(final_dir)
        return {"projectId": project_id, "manifest": files, "downloadPath": f"/artifact/{project_id}"}
    except HTTPException:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise
    except Exception:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise HTTPException(status_code=502, detail="Project generation failed") from None


@app.get("/projects/{project_id}", dependencies=[Depends(require_bearer)])
def get_project(project_id: str):
    directory = project_dir(project_id)
    return {"project_id": project_id, "files": make_manifest(directory)}


@app.get("/artifact/{project_id}", dependencies=[Depends(require_bearer)])
def download_archive(project_id: str):
    directory = project_dir(project_id)
    archive_path = ARTIFACT_ROOT / f".{project_id}-{uuid.uuid4().hex}.zip"
    total = 0
    files: list[Path] = []
    for root, dirs, names in os.walk(directory, followlinks=False):
        base = Path(root)
        dirs[:] = [d for d in dirs if not (base / d).is_symlink()]
        for name in names:
            item = base / name
            if item.is_symlink() or not item.is_file():
                continue
            total += item.stat().st_size
            files.append(item)
            if total > ARCHIVE_LIMIT:
                raise HTTPException(status_code=413, detail="Project exceeds archive size limit")
    temp_archive = archive_path
    try:
        with zipfile.ZipFile(temp_archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for item in files:
                archive.write(item, item.relative_to(directory).as_posix())
        if temp_archive.stat().st_size > ARCHIVE_LIMIT:
            raise HTTPException(status_code=413, detail="Archive exceeds size limit")
        def chunks():
            try:
                with temp_archive.open("rb") as stream:
                    while chunk := stream.read(1024 * 1024):
                        yield chunk
            finally:
                temp_archive.unlink(missing_ok=True)
        return StreamingResponse(chunks(), media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{project_id}.zip"'})
    except HTTPException:
        temp_archive.unlink(missing_ok=True)
        raise
    except Exception:
        temp_archive.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Could not prepare project archive") from None
