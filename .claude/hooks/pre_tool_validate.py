#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""
PreToolUse hook — Data-Steward safety guardrails.

Blocks:
  - git push to main/master without confirmation
  - BigQuery DROP TABLE / DELETE FROM commands

Logs all Bash tool invocations to .claude/logs/tool_calls.log
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

def log_tool_call(tool_name: str, tool_input: dict) -> None:
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR", ".")
    log_dir = Path(project_dir) / ".claude" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "tool_calls.log"

    timestamp = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    # For Bash, log the command; for others, log the tool name only
    detail = tool_input.get("command", json.dumps(tool_input)[:200])
    entry = f"{timestamp}  [{tool_name}]  {detail}\n"

    with open(log_file, "a") as f:
        f.write(entry)


def block(reason: str) -> None:
    """Emit a Claude Code hook block response and exit."""
    print(json.dumps({"decision": "block", "reason": reason}))
    sys.exit(0)


def allow() -> None:
    print(json.dumps({"decision": "allow"}))
    sys.exit(0)


def main() -> None:
    hook_input = json.loads(sys.stdin.read())
    tool_name: str = hook_input.get("tool_name", "")
    tool_input: dict = hook_input.get("tool_input", {})

    log_tool_call(tool_name, tool_input)

    if tool_name != "Bash":
        allow()

    command: str = tool_input.get("command", "")
    cmd_lower = command.lower()

    # --- Guard: git push to main/master ---
    if "git push" in cmd_lower:
        # Check if pushing to a protected branch
        protected = ("main", "master")
        for branch in protected:
            # Patterns: "git push origin main", "git push --force origin main",
            # "git push origin HEAD:main", plain "git push" (default remote)
            if branch in cmd_lower.split():
                block(
                    f"Blocked: git push to '{branch}' requires explicit user approval. "
                    f"Please confirm you want to push to the protected branch."
                )
        # Plain "git push" with no branch specified — warn
        parts = cmd_lower.split()
        push_idx = next((i for i, p in enumerate(parts) if p == "push"), -1)
        if push_idx != -1:
            trailing = parts[push_idx + 1:]
            # Strip flags
            non_flag = [p for p in trailing if not p.startswith("-")]
            if len(non_flag) <= 1:
                # Only remote specified (or none) — could be pushing main implicitly
                block(
                    "Blocked: plain 'git push' may push to main/master. "
                    "Specify the branch explicitly and confirm it's not a protected branch."
                )

    # --- Guard: BigQuery destructive SQL ---
    dangerous_patterns = [
        ("drop table", "DROP TABLE"),
        ("delete from", "DELETE FROM"),
        ("truncate table", "TRUNCATE TABLE"),
        ("drop dataset", "DROP SCHEMA/DATASET"),
    ]
    for pattern, label in dangerous_patterns:
        if pattern in cmd_lower:
            block(
                f"Blocked: '{label}' detected in command. "
                f"Destructive BigQuery operations require explicit user confirmation. "
                f"Re-run after confirming intent with the user."
            )

    allow()


if __name__ == "__main__":
    main()
