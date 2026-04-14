#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""
UserPromptSubmit hook — inject session context.

Prepends the current date and git branch to every user prompt so Claude
always has working-branch awareness without being asked.
"""

import json
import os
import subprocess
import sys
from datetime import date


def get_git_branch() -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            cwd=os.environ.get("CLAUDE_PROJECT_DIR", "."),
            timeout=3,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return "unknown"


def main() -> None:
    hook_input = json.loads(sys.stdin.read())
    original_prompt: str = hook_input.get("prompt", "")

    today = date.today().isoformat()
    branch = get_git_branch()

    context_header = (
        f"[Session context — today: {today}, git branch: {branch}]\n\n"
    )

    modified_prompt = context_header + original_prompt

    print(json.dumps({"prompt": modified_prompt}))
    sys.exit(0)


if __name__ == "__main__":
    main()
