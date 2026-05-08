from __future__ import annotations

from typing import Any


def build_intake_from_prompt(prompt: str) -> dict[str, Any]:
    prompt = prompt.strip()
    return {
        "source": {
            "type": "manual_prompt",
            "url": None,
        },
        "summary": (prompt[:120] + "…") if len(prompt) > 120 else prompt,
        "labels": [],
        "stakeholders": {},
        "source_fragments": [
            {
                "id": "SRC-001",
                "kind": "user_prompt",
                "quote": prompt,
            },
        ],
    }
