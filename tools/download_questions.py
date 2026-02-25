#!/usr/bin/env python3
"""Download Project Euler minimal problem statements as plain text files.

Usage:
  python3 tools/download_questions.py
  python3 tools/download_questions.py --start 1 --end 50
  python3 tools/download_questions.py --force
"""

from __future__ import annotations

import argparse
import json
import re
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path


class MinimalToTextParser(HTMLParser):
    """Convert simple HTML content from /minimal endpoint to plain text."""

    BLOCK_TAGS = {
        "p",
        "div",
        "section",
        "article",
        "header",
        "footer",
        "br",
        "ul",
        "ol",
        "li",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "table",
        "tr",
    }

    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self._ignore_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        lower = tag.lower()
        if lower in {"script", "style"}:
            self._ignore_depth += 1
            return
        if self._ignore_depth > 0:
            return
        if lower == "li":
            self.parts.append("\n- ")
            return
        if lower in self.BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        lower = tag.lower()
        if lower in {"script", "style"} and self._ignore_depth > 0:
            self._ignore_depth -= 1
            return
        if self._ignore_depth > 0:
            return
        if lower in {"li", *self.BLOCK_TAGS}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._ignore_depth > 0:
            return
        if not data:
            return
        text = re.sub(r"\s+", " ", data)
        if text.strip():
            self.parts.append(text)


def normalize_text(value: str) -> str:
    lines = []
    for raw_line in value.splitlines():
        line = re.sub(r"\s+", " ", raw_line).strip()
        if line:
            lines.append(line)
    return "\n".join(lines).strip()


def html_to_text(html: str) -> str:
    parser = MinimalToTextParser()
    parser.feed(html)
    parser.close()
    combined = "".join(parser.parts)
    return normalize_text(combined)


def load_problem_index(levels_path: Path) -> list[tuple[int, str]]:
    payload = json.loads(levels_path.read_text(encoding="utf-8"))
    indexed: list[tuple[int, str]] = []

    for key, value in payload.items():
        if key == "_meta":
            continue
        try:
            problem_id = int(key)
        except ValueError:
            continue
        if problem_id < 1:
            continue
        title = ""
        if isinstance(value, dict):
            raw_title = value.get("title", "")
            if isinstance(raw_title, str):
                title = raw_title.strip()
        indexed.append((problem_id, title))

    indexed.sort(key=lambda item: item[0])
    return indexed


def fetch_minimal_html(url: str, timeout_seconds: float) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "pe-tracker-question-downloader/1.0",
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout_seconds) as response:
        encoding = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(encoding, errors="replace")


def download_one_problem(
    problem_id: int,
    title: str,
    out_path: Path,
    timeout_seconds: float,
    retries: int,
) -> None:
    url = f"https://projecteuler.net/minimal={problem_id}"
    last_error: Exception | None = None

    for attempt in range(1, retries + 1):
        try:
            html = fetch_minimal_html(url, timeout_seconds)
            text = html_to_text(html)
            header = f"Problem {problem_id}"
            if title:
                header = f"{header}: {title}"
            body = f"{header}\nSource: {url}\n\n{text}\n"
            out_path.write_text(body, encoding="utf-8")
            return
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            last_error = error
            if attempt == retries:
                break
            time.sleep(min(2.0 * attempt, 5.0))

    raise RuntimeError(f"Failed after {retries} attempts: {last_error}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Download Project Euler minimal statements as .txt files"
    )
    parser.add_argument(
        "--levels", default="data/levels.json", help="Path to levels.json"
    )
    parser.add_argument("--out", default="data/questions", help="Output directory")
    parser.add_argument(
        "--start", type=int, default=None, help="First problem id to include"
    )
    parser.add_argument(
        "--end", type=int, default=None, help="Last problem id to include"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Redownload even if .txt file already exists",
    )
    parser.add_argument(
        "--delay", type=float, default=0.25, help="Delay between requests (seconds)"
    )
    parser.add_argument(
        "--timeout", type=float, default=20.0, help="HTTP timeout in seconds"
    )
    parser.add_argument("--retries", type=int, default=3, help="Retries per problem")
    args = parser.parse_args()

    levels_path = Path(args.levels)
    out_dir = Path(args.out)

    if not levels_path.exists():
        raise SystemExit(f"levels.json not found: {levels_path}")

    out_dir.mkdir(parents=True, exist_ok=True)
    index = load_problem_index(levels_path)

    if args.start is not None:
        index = [item for item in index if item[0] >= args.start]
    if args.end is not None:
        index = [item for item in index if item[0] <= args.end]

    total = len(index)
    if total == 0:
        print("No problems matched the selected range.")
        return

    downloaded = 0
    skipped = 0
    failed = 0

    for position, (problem_id, title) in enumerate(index, start=1):
        target = out_dir / f"{problem_id:04d}.txt"
        if target.exists() and not args.force:
            skipped += 1
            print(f"[{position}/{total}] skip {target.name}")
            continue

        try:
            download_one_problem(
                problem_id=problem_id,
                title=title,
                out_path=target,
                timeout_seconds=args.timeout,
                retries=max(1, args.retries),
            )
            downloaded += 1
            print(f"[{position}/{total}] ok   {target.name}")
        except Exception as error:  # noqa: BLE001
            failed += 1
            print(f"[{position}/{total}] fail {target.name}: {error}")

        if args.delay > 0:
            time.sleep(args.delay)

    print(
        f"Done. downloaded={downloaded}, skipped={skipped}, failed={failed}, total={total}"
    )


if __name__ == "__main__":
    main()
