#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""
PostToolUse hook — Data-Steward post-edit validation.

Triggered after Write or Edit tool calls.

Checks:
  - Python files: run ruff check (warn-only, non-blocking)
  - YAML files under /prompts/: validate required keys
  - Cube model output files: validate cube() root expression
"""

import json
import os
import re
import subprocess
import sys
from pathlib import Path


def warn(message: str) -> None:
    """Non-blocking warning — surfaces in Claude's context but does not stop execution."""
    print(json.dumps({"decision": "warn", "message": message}))
    sys.exit(0)


def allow() -> None:
    print(json.dumps({"decision": "allow"}))
    sys.exit(0)


def check_python_file(file_path: Path) -> str | None:
    """Run ruff check on a Python file. Returns warning string or None."""
    result = subprocess.run(
        ["ruff", "check", str(file_path)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        output = (result.stdout + result.stderr).strip()
        # Truncate to avoid flooding context
        lines = output.splitlines()[:20]
        return "ruff:\n" + "\n".join(lines)
    return None


def check_yaml_prompt_file(file_path: Path) -> str | None:
    """Validate that a prompt YAML has required keys."""
    try:
        # Minimal YAML key check without external dependencies
        content = file_path.read_text()
        required_keys = ["system_prompt", "user_prompt", "model"]
        missing = [k for k in required_keys if not re.search(rf"^{k}\s*:", content, re.MULTILINE)]
        if missing:
            return f"Prompt YAML missing required keys: {missing}. Required: {required_keys}"
    except Exception as e:
        return f"Could not validate YAML: {e}"
    return None


def check_cube_model_file(file_path: Path) -> str | None:
    """Validate that a Cube model JS file has a cube() root expression."""
    try:
        content = file_path.read_text()
        if not re.search(r"^\s*cube\s*\(", content, re.MULTILINE):
            return (
                "Cube model file does not contain a `cube(` root expression. "
                "Cube.js will fail to load this model. Check the LLM output."
            )
    except Exception as e:
        return f"Could not validate Cube model: {e}"
    return None


def main() -> None:
    hook_input = json.loads(sys.stdin.read())
    tool_name: str = hook_input.get("tool_name", "")
    tool_input: dict = hook_input.get("tool_input", {})

    if tool_name not in ("Write", "Edit"):
        allow()

    file_path_str: str = tool_input.get("file_path", "")
    if not file_path_str:
        allow()

    file_path = Path(file_path_str)
    suffix = file_path.suffix.lower()
    warnings: list[str] = []

    # --- Python file: ruff check ---
    if suffix == ".py":
        if issue := check_python_file(file_path):
            warnings.append(f"[ruff] {file_path.name}: {issue}")

    # --- YAML prompt files ---
    elif suffix in (".yaml", ".yml"):
        project_dir = os.environ.get("CLAUDE_PROJECT_DIR", ".")
        prompts_dir = Path(project_dir) / "prompts"
        # Only validate YAML files inside the /prompts/ directory
        try:
            file_path.resolve().relative_to(prompts_dir.resolve())
            if issue := check_yaml_prompt_file(file_path):
                warnings.append(f"[prompt-yaml] {file_path.name}: {issue}")
        except ValueError:
            pass  # Not under /prompts/, skip

    # --- Cube model JS files ---
    elif suffix == ".js":
        project_dir = os.environ.get("CLAUDE_PROJECT_DIR", ".")
        cube_model_dir = Path(project_dir) / "cube" / "model"
        try:
            file_path.resolve().relative_to(cube_model_dir.resolve())
            if issue := check_cube_model_file(file_path):
                warnings.append(f"[cube-model] {file_path.name}: {issue}")
        except ValueError:
            pass  # Not a Cube model file, skip

    if warnings:
        warn("\n".join(warnings))
    else:
        allow()


if __name__ == "__main__":
    main()
