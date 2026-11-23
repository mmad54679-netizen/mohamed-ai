"""Bounded CrewAI planning service. No tools, execution, or MetaGPT integration."""
from __future__ import annotations

import json
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

MAX_BODY_BYTES = int(os.getenv("MAX_BODY_BYTES", "12000"))
MAX_PROMPT_CHARS = min(max(int(os.getenv("MAX_PROMPT_CHARS", "8000")), 256), 20000)
MAX_ROSTER_NAME_CHARS = 60
ROLES: dict[str, dict[str, Any]] = {
    "product": {"title": "Product Specialist", "terms": ("product", "feature", "user", "requirement", "mvp", "scope", "app", "application", "تطبيق", "بناء", "مستخدم", "ميزة", "متطلبات", "فكرة")},
    "architecture": {"title": "Software Architect", "terms": ("architecture", "system design", "scalab", "database", "api", "integration", "software", "system", "app", "application", "معمارية", "هندسة", "نظام", "برنامج", "تطبيق", "بنية")},
    "design": {"title": "UX/UI Designer", "terms": ("design", "ui", "ux", "accessibility", "wireframe", "visual", "تصميم", "واجهة", "تجربة المستخدم", "سهولة الاستخدام", "ألوان")},
    "frontend": {"title": "Frontend Engineer", "terms": ("frontend", "front-end", "web", "browser", "react", "interface", "page", "واجهة", "موقع", "ويب", "صفحة", "متصفح")},
    "backend": {"title": "Backend Engineer", "terms": ("backend", "back-end", "server", "endpoint", "auth", "api", "خلفية", "خادم", "مصادقة", "تسجيل الدخول", "واجهة برمجية")},
    "mobile": {"title": "Mobile Engineer", "terms": ("mobile", "android", "ios", "flutter", "react native", "موبايل", "جوال", "هاتف", "أندرويد", "اندرويد", "تطبيق هاتف")},
    "data": {"title": "Database and Data Engineer", "terms": ("database", "sql", "postgres", "mysql", "mongodb", "data model", "قاعدة البيانات", "قواعد البيانات", "بيانات", "تخزين")},
    "ai_ml": {"title": "AI and ML Engineer", "terms": ("artificial intelligence", "machine learning", "llm", "model", " ai ", "ذكاء اصطناعي", "تعلم آلي", "نموذج", "روبوت", "توليدي")},
    "qa": {"title": "QA Automation Engineer", "terms": ("test", "qa", "quality", "validation", "acceptance", "reliability", "اختبار", "اختبارات", "جودة", "تحقق", "فحص")},
    "security": {"title": "Security and Privacy Engineer", "terms": ("security", "privacy", "threat", "permission", "secure", "vulnerability", "أمن", "أمان", "آمن", "خصوصية", "صلاحيات", "تهديد", "ثغرة", "حماية")},
    "devops": {"title": "Cloud and DevOps Engineer", "terms": ("devops", "deployment", "deploy", "cloud", "hosting", "docker", "infrastructure", "ci/cd", "نشر", "سحابة", "استضافة", "عمليات", "حاوية")},
    "docs": {"title": "Technical Documentation Specialist", "terms": ("documentation", "readme", "manual", "technical writing", "توثيق", "مستندات", "دليل", "شرح الاستخدام")},
}
DEFAULT_NAMES = {
    "leader": "آدم", "product": "سلمى", "architecture": "عمر", "design": "ليلى",
    "frontend": "نور", "backend": "يحيى", "mobile": "جود", "data": "مروان",
    "ai_ml": "مريم", "qa": "يوسف", "security": "آية", "devops": "زياد", "docs": "إيمان",
}


def load_roster() -> dict[str, str]:
    names = dict(DEFAULT_NAMES)
    roster_path = os.getenv("ROSTER_FILE")
    if roster_path:
        data = json.loads(Path(roster_path).read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("Roster must be a JSON object mapping allowed IDs to names")
        for key, value in data.items():
            if key not in DEFAULT_NAMES or not isinstance(value, str):
                raise ValueError("Roster contains an unknown ID or invalid display name")
            cleaned = re.sub(r"[\r\n\x00-\x1f]", " ", value).strip()[:MAX_ROSTER_NAME_CHARS]
            if not cleaned:
                raise ValueError("Roster names must not be empty")
            names[key] = cleaned
    for key in DEFAULT_NAMES:
        env_value = os.getenv("NAME_" + key.upper().replace("-", "_"))
        if env_value:
            names[key] = re.sub(r"[\r\n\x00-\x1f]", " ", env_value).strip()[:MAX_ROSTER_NAME_CHARS]
    return names


def choose_roles(prompt: str) -> list[str]:
    """Deterministic bilingual matching: always leader, then at most five specialists."""
    text = prompt.casefold()
    matches = []
    for key, info in ROLES.items():
        terms = info["terms"]
        score = sum(1 for term in terms if term in text)
        if score:
            matches.append((key, score))
    matches.sort(key=lambda pair: (-pair[1], list(ROLES).index(pair[0])))
    return ["leader", *(key for key, _ in matches[:5])]


def mock_output(prompt: str, selected: list[str], names: dict[str, str]) -> str:
    team = ", ".join(names[k] for k in selected)
    return (f"Planning team: {team}.\n\n"
            f"Goal: {prompt[:500]}\n\n"
            "Proposed next steps:\n1. Confirm the target users and the smallest useful release.\n"
            "2. Outline the system boundaries, core screens, and data/API needs.\n"
            "3. Build the application in small, reviewable increments.\n"
            "4. Test key user journeys and address security and accessibility risks.\n"
            "5. Deploy only after an authorized human reviews and approves the plan.")


def crew_output(prompt: str, selected: list[str], names: dict[str, str]) -> str:
    # Lazy import keeps mock mode usable without installed CrewAI/provider packages.
    from crewai import Agent, Crew, LLM, Process, Task

    model = os.getenv("CREWAI_MODEL", "openai/gpt-4o-mini")
    api_key = os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY")
    base_url = os.getenv("LLM_BASE_URL")
    llm_args: dict[str, Any] = {"model": model}
    if api_key:
        llm_args["api_key"] = api_key
    if base_url:
        llm_args["base_url"] = base_url
    llm = LLM(**llm_args)

    descriptions = {
        "leader": ("App-Building Team Coordinator", "Turn the user's app idea into a clear, feasible, ordered implementation plan."),
        **{key: (info["title"], f"Contribute a concise, practical {info['title'].lower()} perspective to the application plan.") for key, info in ROLES.items()},
    }
    agents = {}
    for key in selected:
        role, goal = descriptions[key]
        agents[key] = Agent(
            role=role, goal=goal,
            backstory=(f"You are an AI {role.lower()} with the user-selected display name {names[key]!r}. "
                       "You are not a human and must not claim to be one. Provide planning advice only. Never invent facts, versions, costs, sources, or completed work; label assumptions and unknowns explicitly."),
            llm=llm, tools=[], allow_delegation=False, allow_code_execution=False,
            max_iter=2, max_retry_limit=0, verbose=False,
        )
    tasks = []
    for index, key in enumerate(selected):
        if key == "leader":
            description = ("Plan a small, maintainable application from this user request. Identify the objective, "
                           "assumptions, major components, implementation sequence, and a few acceptance checks. "
                           "Never invent current vendor capabilities, versions, prices, sources, or facts not supplied. Mark assumptions and unknowns clearly, ask for missing critical requirements instead of guessing, and do not claim any work was actually performed. Respond in the user's language, using Arabic if the request is Arabic. Request: " + prompt)
            expected = "A concise actionable application plan with ordered steps and assumptions."
        else:
            description = (f"For the user's application request, provide the most important {descriptions[key][0]} "
                           f"considerations. Be concrete and concise, then recommend any necessary adjustment to the plan. "
                           f"Do not invent facts, versions, costs, or sources. Mark assumptions and uncertainty instead of guessing. "
                           f"Respond in the user's language, using Arabic if the request is Arabic. Request: {prompt}")
            expected = "A concise specialist contribution with concrete recommendations."
        tasks.append(Task(description=description, expected_output=expected, agent=agents[key]))
    tasks.append(Task(
        description=("As the team coordinator, synthesize the preceding plan and specialist contributions into one "
                     "coherent, prioritized application plan. Resolve conflicts, list key assumptions and risks, and "
                     "identify which implementation work should be done first. Respond in the user's language, "
                     "using Arabic if the request is Arabic. Do not repeat unsupported claims as facts or invent sources, "
                     "versions, costs, or test results. Separate confirmed requirements from assumptions and unknowns. "
                     "Do not claim the app has been built or deployed."),
        expected_output="A concise, coherent, prioritized application plan that integrates all selected specialist contributions.",
        agent=agents["leader"],
    ))
    result = Crew(agents=list(agents.values()), tasks=tasks, process=Process.sequential,
                  verbose=False, memory=False).kickoff()
    return str(getattr(result, "raw", result)).strip()[:12000]


class Handler(BaseHTTPRequestHandler):
    server_version = "CrewAIPlanner/1.0"

    def respond(self, status: int, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:
        if self.path != "/health":
            self.respond(404, {"error": "not_found"})
            return
        try:
            names = load_roster()
        except Exception:
            self.respond(503, {"error": "service_unavailable"})
            return
        self.respond(200, {"status": "ok", "mode": "mock" if os.getenv("MOCK_MODE", "0").lower() in ("1", "true", "yes") else "crewai",
                           "roles": [{"id": key, "display_name": names[key], "role": "Coordinator" if key == "leader" else ROLES[key]["title"]} for key in DEFAULT_NAMES]})

    def do_POST(self) -> None:
        if self.path != "/run":
            self.respond(404, {"error": "not_found"})
            return
        token = os.getenv("SERVICE_TOKEN", "")
        if not token:
            self.respond(503, {"error": "service_not_configured"})
            return
        if self.headers.get("Authorization", "") != "Bearer " + token:
            self.respond(401, {"error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY_BYTES:
            self.respond(413 if length > MAX_BODY_BYTES else 400, {"error": "invalid_content_length"})
            return
        if self.headers.get_content_type() != "application/json":
            self.respond(415, {"error": "application_json_required"})
            return
        try:
            body = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.respond(400, {"error": "invalid_json"})
            return
        if not isinstance(body, dict) or not isinstance(body.get("prompt"), str):
            self.respond(400, {"error": "prompt_must_be_a_string"})
            return
        prompt = body["prompt"].strip()
        if not prompt:
            self.respond(400, {"error": "prompt_must_not_be_empty"})
            return
        prompt = prompt[:MAX_PROMPT_CHARS]
        try:
            names = load_roster()
            selected = choose_roles(prompt)
            is_mock = os.getenv("MOCK_MODE", "0").lower() in ("1", "true", "yes")
            output = mock_output(prompt, selected, names) if is_mock else crew_output(prompt, selected, names)
        except Exception as exc:
            print(f"run failed: {type(exc).__name__}", flush=True)
            self.respond(502, {"error": "planning_failed"})
            return
        self.respond(200, {"team": [{"id": key, "display_name": names[key], "role": "Coordinator" if key == "leader" else ROLES[key]["title"]} for key in selected],
                           "output": output, "mode": "mock" if is_mock else "crewai"})

    def log_message(self, fmt: str, *args: Any) -> None:
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)


def main() -> None:
    if not os.getenv("SERVICE_TOKEN"):
        raise SystemExit("SERVICE_TOKEN must be set")
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8080"))
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    print(f"CrewAI planning service listening on {host}:{port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
