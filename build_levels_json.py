#!/usr/bin/env python3
"""Build levels.json from a saved Project Euler progress HTML page.

Usage:
  python3 build_levels_json.py
  python3 build_levels_json.py --input data/pe_data.html --output data/levels.json
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from html import unescape
from pathlib import Path


PROBLEM_ANCHOR_RE = re.compile(
    r'<a\s+href="problem=(?P<id>\d+)">(?P<body>.*?)</a>',
    re.IGNORECASE | re.DOTALL,
)

TOOLTIP_RE = re.compile(
    r'<span\s+class="tooltiptext_narrow">(?P<tooltip>.*?)</span>',
    re.IGNORECASE | re.DOTALL,
)

DIFFICULTY_RE = re.compile(r"Difficulty\s*level\s*:\s*(\d+)", re.IGNORECASE)
TITLE_RE = re.compile(r"<div>\s*&quot;(.*?)&quot;\s*</div>", re.IGNORECASE | re.DOTALL)
HTML_UPDATED_RE = re.compile(
    r"Logged in as\s*<strong>.*?</strong><br>(?P<value>[^<]+)<br>",
    re.IGNORECASE | re.DOTALL,
)


def parse_levels(html_text: str) -> tuple[dict[str, dict[str, object]], int]:
    result: dict[str, dict[str, object]] = {}
    max_problem_id = 0

    for match in PROBLEM_ANCHOR_RE.finditer(html_text):
        problem_id = int(match.group("id"))
        if problem_id < 1:
            continue
        max_problem_id = max(max_problem_id, problem_id)

        body = match.group("body")
        tooltip_match = TOOLTIP_RE.search(body)
        tooltip = tooltip_match.group("tooltip") if tooltip_match else ""

        difficulty_match = DIFFICULTY_RE.search(tooltip)
        difficulty = int(difficulty_match.group(1)) if difficulty_match else None

        title_match = TITLE_RE.search(tooltip)
        title = ""
        if title_match:
            title = unescape(title_match.group(1)).strip()

        result[str(problem_id)] = {
            "difficulty": difficulty,
            "title": title,
        }

    if max_problem_id == 0:
        return {}, 0

    # Fill missing problem IDs explicitly so the app never guesses 0.
    for problem_id in range(1, max_problem_id + 1):
        key = str(problem_id)
        if key not in result:
            result[key] = {"difficulty": None, "title": ""}

    # Keep numeric ordering in the output file.
    ordered = {str(i): result[str(i)] for i in range(1, max_problem_id + 1)}
    return ordered, max_problem_id


def parse_html_updated_utc(html_text: str) -> str | None:
    match = HTML_UPDATED_RE.search(html_text)
    if not match:
        return None

    raw_value = unescape(match.group("value")).strip()
    try:
        parsed = dt.datetime.strptime(raw_value, "%a, %d %b %Y, %H:%M")
    except ValueError:
        return None

    # Source timezone is not explicitly included in exported HTML.
    # We store it as UTC-normalized string for UI consistency.
    parsed_utc = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed_utc.strftime("%Y-%m-%d %H:%M")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate levels.json from pe_data.html"
    )
    parser.add_argument(
        "--input", default="data/pe_data.html", help="Path to source HTML"
    )
    parser.add_argument(
        "--output", default="data/levels.json", help="Path to output JSON"
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)

    html_text = input_path.read_text(encoding="utf-8")
    levels, max_problem_id = parse_levels(html_text)
    html_updated_utc = parse_html_updated_utc(html_text)

    output_payload: dict[str, object] = {
        "_meta": {
            "last_updated_utc": html_updated_utc,
            "generated_at_utc": dt.datetime.now(dt.timezone.utc).strftime(
                "%Y-%m-%d %H:%M"
            ),
            "source": str(input_path),
            "max_problem_number": max_problem_id,
        }
    }
    output_payload.update(levels)

    output_path.write_text(
        json.dumps(output_payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8"
    )

    missing_count = sum(1 for item in levels.values() if item["difficulty"] is None)
    print(f"Wrote {len(levels)} problems to {output_path}")
    print(f"Missing difficulty (stored as null): {missing_count}")


if __name__ == "__main__":
    main()
