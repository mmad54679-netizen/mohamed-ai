#!/usr/bin/env python3
"""Small authenticated HTTP bridge for an installed FoundationAgents/OpenManus checkout.
Run inside an isolated container/VM. By default, only non-mutating conversation tools are exposed.
"""
import asyncio
import hmac
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ.get("OPENMANUS_TOKEN", "")
HOST = os.environ.get("OPENMANUS_HOST", "127.0.0.1")
PORT = int(os.environ.get("OPENMANUS_PORT", "8091"))
MAX_BODY = 30_000

if len(TOKEN) < 24:
    raise SystemExit("Set OPENMANUS_TOKEN to a random secret of at least 24 characters.")

async def run_agent(prompt: str, max_steps: int) -> str:
    from app.agent.manus import Manus
    # Create without remote MCP initialization. Built-in Python execution and file editing
    # are deliberately removed. Enable extra tools only after reviewing the isolation model.
    agent = Manus(max_steps=max_steps)
    agent._initialized = True
    safe_names = {"ask_human", "terminate"}
    allowed_tools = tuple(tool for tool in agent.available_tools.tools if tool.name in safe_names)
    agent.available_tools.tools = allowed_tools
    agent.available_tools.tool_map = {tool.name: tool for tool in allowed_tools}
    try:
        result = await agent.run(prompt)
        return str(result or "").strip()
    finally:
        await agent.cleanup()

class Handler(BaseHTTPRequestHandler):
    def respond(self, status, payload):
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        if self.path != "/health":
            return self.respond(404, {"error": "Not found"})
        if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + TOKEN):
            return self.respond(401, {"error": "Unauthorized"})
        return self.respond(200, {"ok": True, "engine": "OpenManus", "safeMode": True})

    def do_POST(self):
        if self.path != "/run":
            return self.respond(404, {"error": "Not found"})
        if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + TOKEN):
            return self.respond(401, {"error": "Unauthorized"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 2 or length > MAX_BODY:
                return self.respond(413, {"error": "Request body size is invalid"})
            body = json.loads(self.rfile.read(length))
            prompt = str(body.get("prompt", "")).strip()
            if not prompt or len(prompt) > 12_000:
                return self.respond(400, {"error": "Prompt must contain 1 to 12000 characters"})
            steps = max(1, min(8, int(body.get("max_steps", 8))))
            answer = asyncio.run(asyncio.wait_for(run_agent(prompt, steps), timeout=100))
            if not answer:
                return self.respond(502, {"error": "OpenManus returned no text"})
            return self.respond(200, {"answer": answer[:24_000]})
        except asyncio.TimeoutError:
            return self.respond(504, {"error": "OpenManus timed out"})
        except Exception:
            # Do not send exception details, credentials, or local paths to callers.
            return self.respond(502, {"error": "OpenManus request failed"})

    def log_message(self, fmt, *args):
        print("openmanus-bridge: request handled", flush=True)

if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"OpenManus bridge listening on {HOST}:{PORT}; safe tool allow-list active", flush=True)
    server.serve_forever()
