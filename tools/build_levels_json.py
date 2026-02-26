#!/usr/bin/env python3
"""Build levels.json from the Project Euler progress page.

Usage:
  python3 tools/build_levels_json.py
  python3 tools/build_levels_json.py --output data/levels.json

Cookie is loaded from .env/projecteuler.env (fallback: .env/projecteuler_server.env).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from html import unescape
from pathlib import Path

import requests


PROBLEM_ANCHOR_RE = re.compile(
    r'<a\s+href="problem=(?P<id>\d+)">(?P<body>.*?)</a>',
    re.IGNORECASE | re.DOTALL,
)

TOOLTIP_RE = re.compile(
    r'<span\s+class="tooltiptext_narrow">(?P<tooltip>.*?)</span>',
    re.IGNORECASE | re.DOTALL,
)

DIFFICULTY_RE = re.compile(r"Difficulty\s*level\s*:\s*(\d+)", re.IGNORECASE)
SOLVED_BY_RE = re.compile(r"Solved\s+by\s+([\d,]+)", re.IGNORECASE)
TITLE_RE = re.compile(r"<div>\s*&quot;(.*?)&quot;\s*</div>", re.IGNORECASE | re.DOTALL)
HTML_UPDATED_RE = re.compile(
    r"Logged in as\s*<strong>.*?</strong><br>(?P<value>[^<]+)<br>",
    re.IGNORECASE | re.DOTALL,
)

PROGRESS_URL = "https://projecteuler.net/progress"
ENV_FILE_PATHS = [
    Path(".env/projecteuler_server.env"),
    Path(".env/projecteuler.env"),
]


def load_env_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}

    env: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        cleaned = value.strip().strip('"').strip("'")
        env[key.strip()] = cleaned
    return env


def build_cookies() -> dict[str, str]:
    env: dict[str, str] = {}
    for env_path in ENV_FILE_PATHS:
        env.update(load_env_file(env_path))

    cookies: dict[str, str] = {}

    pj_cookie = env.get("PJ_COOKIE", "").strip()
    if pj_cookie:
        cookies["__Host-PHPSESSID"] = pj_cookie

    return cookies


def fetch_progress_html() -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:150.0) Gecko/20100101 Firefox/150.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en",
        "DNT": "1",
        "Sec-GPC": "1",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Priority": "u=0, i",
        "Pragma": "no-cache",
        "Cache-Control": "no-cache",
    }

    response = requests.get(
        PROGRESS_URL,
        cookies=build_cookies(),
        headers=headers,
        timeout=30,
    )
    response.raise_for_status()
    return response.text


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

        solved_by_match = SOLVED_BY_RE.search(tooltip)
        solved_by = None
        if solved_by_match:
            solved_by_raw = solved_by_match.group(1).replace(",", "")
            if solved_by_raw.isdigit():
                solved_by = int(solved_by_raw)

        title_match = TITLE_RE.search(tooltip)
        title = ""
        if title_match:
            title = unescape(title_match.group(1)).strip()

        result[str(problem_id)] = {
            "difficulty": difficulty,
            "solved_by": solved_by,
            "title": title,
        }

    if max_problem_id == 0:
        return {}, 0

    for problem_id in range(1, max_problem_id + 1):
        key = str(problem_id)
        if key not in result:
            result[key] = {"difficulty": None, "solved_by": None, "title": ""}

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

    parsed_utc = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed_utc.strftime("%Y-%m-%d %H:%M")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate levels.json from Project Euler progress page"
    )
    parser.add_argument(
        "--output", default="data/levels.json", help="Path to output JSON"
    )
    args = parser.parse_args()

    output_path = Path(args.output)

    html_text = fetch_progress_html()
    levels, max_problem_id = parse_levels(html_text)
    html_updated_utc = parse_html_updated_utc(html_text)

    if max_problem_id == 0:
        raise SystemExit(
            "No Project Euler problems found in fetched HTML. "
            "Add PJ_COOKIE to .env/projecteuler.env "
            "(or .env/projecteuler_server.env) if authentication is required."
        )

    output_payload: dict[str, object] = {
        "_meta": {
            "last_updated_utc": html_updated_utc,
            "generated_at_utc": dt.datetime.now(dt.timezone.utc).strftime(
                "%Y-%m-%d %H:%M"
            ),
            "source": PROGRESS_URL,
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
