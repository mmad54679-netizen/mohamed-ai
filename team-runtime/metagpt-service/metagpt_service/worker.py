from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def main() -> int:
    try:
        request = json.loads(sys.stdin.buffer.read(16_000).decode("utf-8"))
        idea = request["idea"]
        project_path = Path(os.environ["METAGPT_PROJECT_PATH"]).resolve()
        if os.environ.get("METAGPT_MOCK") == "1":
            project_path.mkdir(parents=True, exist_ok=True)
            (project_path / "README.md").write_text(f"# Mock generated project\n\nIdea: {idea}\n", encoding="utf-8")
            return 0
        from metagpt.software_company import generate_repo
        # MetaGPT documents project_path as its output/workspace location. Pass an
        # absolute, fresh directory and never enable incremental/recovery mode.
        generate_repo(idea=idea, project_path=str(project_path), project_name="generated", inc=False, recover_path=None)
        return 0
    except Exception:
        # Do not print exception text; provider errors can contain credentials.
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
