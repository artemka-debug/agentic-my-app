#!/usr/bin/env python3
"""Replace {{TOKEN}} placeholders in a template file. Values from JSON object on stdin."""

import json
import re
import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 3:
        print("usage: render_template.py <template_path> <out_path>", file=sys.stderr)
        sys.exit(2)
    template_path = Path(sys.argv[1])
    out_path = Path(sys.argv[2])
    data = json.loads(sys.stdin.read() or "{}")
    text = template_path.read_text(encoding="utf-8")
    for key, raw in data.items():
        placeholder = "{{" + key + "}}"
        val = raw if isinstance(raw, str) else json.dumps(raw, ensure_ascii=False)
        text = text.replace(placeholder, val)
    leftover = set(re.findall(r"\{\{([A-Za-z0-9_]+)\}\}", text))
    if leftover:
        print(f"warn: unresolved placeholders: {sorted(leftover)}", file=sys.stderr)
    out_path.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
