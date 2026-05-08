from __future__ import annotations

from pathlib import Path
from typing import Any


def build_intake_from_spec(spec_path: Path) -> dict[str, Any]:
    text = spec_path.read_text(encoding="utf-8", errors="replace").strip()
    return {
        "source": {
            "type": "local_spec",
            "path": str(spec_path.resolve()),
        },
        "summary": f"Local spec: {spec_path.name}",
        "labels": [],
        "stakeholders": {},
        "source_fragments": [
            {
                "id": "SRC-001",
                "kind": "spec_excerpt",
                "quote": text or "(empty file)",
            },
        ],
    }
