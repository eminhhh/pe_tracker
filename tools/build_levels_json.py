#!/usr/bin/env python3
"""Build levels.json from the Project Euler progress page.

Usage:
  python3 tools/build_levels_json.py
  python3 tools/build_levels_json.py --output data/levels.json

PJ_COOKIE is read from the environment, falling back to .env/projecteuler.env
and .env/projecteuler_server.env. Accepts a session value or a Cookie header.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
from http.cookies import CookieError, SimpleCookie
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

DIFFICULTY_RE = re.compile(r"Difficulty\s*:\s*Level\s*(\d+)", re.IGNORECASE)
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
AUTH_HELP = (
    "PE_PJ_COOKIE in GitHub Actions (PJ_COOKIE locally) accepts the session cookie "
    "value or the full Cookie request header from a signed-in /progress request."
)


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
    # CI credentials must take precedence over any local dotenv files.
    if "PJ_COOKIE" in os.environ:
        env["PJ_COOKIE"] = os.environ["PJ_COOKIE"]

    pj_cookie = env.get("PJ_COOKIE", "").strip()
    if not pj_cookie:
        raise SystemExit("PJ_COOKIE is missing or empty. " + AUTH_HELP)

    # Preserve the original setup where PJ_COOKIE contains only a PHP session ID.
    if re.fullmatch(r"[A-Za-z0-9,-]+", pj_cookie):
        return {"__Host-PHPSESSID": pj_cookie}

    # Also accept name=value pairs copied from the browser's Cookie request header.
    cookie_header = re.sub(r"^Cookie:\s*", "", pj_cookie, flags=re.IGNORECASE)
    parsed: SimpleCookie = SimpleCookie()
    try:
        if "\r" in cookie_header or "\n" in cookie_header:
            raise CookieError("Multiline cookie header")
        parsed.load(cookie_header)
    except CookieError:
        raise SystemExit("PJ_COOKIE is not a valid single-line Cookie header. " + AUTH_HELP) from None
    cookies = {name: morsel.value for name, morsel in parsed.items()}
    if not cookies:
        raise SystemExit("PJ_COOKIE is not a session value or Cookie header. " + AUTH_HELP)
    # Browser filter preferences could otherwise produce an incomplete metadata file.
    cookies.pop("filter_type", None)
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
    if response.status_code in (401, 403):
        # A public-page rejection is evidence of a broader access problem, rather
        # than a reason to keep replacing a known-good login cookie. Use a fresh
        # request so no credentials or response cookies are sent with this probe.
        try:
            public_response = requests.get(
                "https://projecteuler.net/about", headers=headers, timeout=15
            )
        except requests.RequestException:
            public_status = "The public-page access check could not connect. "
        else:
            public_status = (
                f"The public /about page returned HTTP {public_response.status_code} "
                "without cookies. "
            )
            if public_response.status_code in (401, 403):
                raise SystemExit(
                    f"Project Euler rejected /progress (HTTP {response.status_code}). "
                    + public_status
                    + "This also affects a page that does not require PE_PJ_COOKIE. "
                    "Check runner network/hosting-provider filtering. Run the refresh "
                    "on a trusted self-hosted runner on a working network by setting "
                    "the PE_REFRESH_RUNNER repository variable to its unique label."
                )
        raise SystemExit(
            f"Project Euler rejected /progress (HTTP {response.status_code}). "
            + public_status
            + "The cause could be login-specific rejection or request filtering; "
            "this does not establish that the cookie is invalid. "
            + AUTH_HELP
        )
    response.raise_for_status()
    if response.url.split("?", 1)[0].rstrip("/") != PROGRESS_URL:
        raise SystemExit("Project Euler redirected away from /progress. " + AUTH_HELP)
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
            + AUTH_HELP
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
