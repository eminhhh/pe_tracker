#!/usr/bin/env python3
"""Build a compact question search index for client-side text search.

Usage:
  python3 tools/build_question_search_index.py
  python3 tools/build_question_search_index.py --out data/question_search_index.json
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from pathlib import Path


NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")
MULTISPACE_RE = re.compile(r"\s+")
HEADER_RE = re.compile(r"^Problem\s+\d+\s*:\s*(?P<title>.+?)\s*$", re.IGNORECASE)


def normalize_text(value: str) -> str:
    lowered = value.lower()
    normalized = NON_ALNUM_RE.sub(" ", lowered)
    normalized = MULTISPACE_RE.sub(" ", normalized).strip()
    return normalized


def load_topic_tags(categories_path: Path) -> dict[int, list[str]]:
    tags_by_problem: dict[int, list[str]] = {}
    if not categories_path.exists():
        return tags_by_problem

    for raw_line in categories_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue

        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue

        problem_id = int(payload.get("problem_id", 0) or 0)
        if problem_id < 1:
            continue

        raw_tags = payload.get("topic_tags")
        if not isinstance(raw_tags, list):
            continue

        tags = [tag.strip() for tag in raw_tags if isinstance(tag, str) and tag.strip()]
        tags_by_problem[problem_id] = tags[:6]

    return tags_by_problem


def extract_title_from_text(problem_text: str) -> str:
    first_line = problem_text.splitlines()[0].strip() if problem_text else ""
    matched = HEADER_RE.match(first_line)
    if not matched:
        return ""
    return matched.group("title").strip()


def build_index(
    questions_dir: Path, tags_by_problem: dict[int, list[str]]
) -> dict[str, dict[str, str]]:
    index: dict[str, dict[str, str]] = {}

    for question_file in sorted(questions_dir.glob("*.txt")):
        try:
            problem_id = int(question_file.stem)
        except ValueError:
            continue

        if problem_id < 1:
            continue

        text = question_file.read_text(encoding="utf-8")
        title = extract_title_from_text(text)
        tags = " ".join(tags_by_problem.get(problem_id, []))
        combined = f"{title} {text} {tags}".strip()
        index[str(problem_id)] = {"search_text": normalize_text(combined)}

    return index


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate question_search_index.json from local question files"
    )
    parser.add_argument(
        "--questions",
        default="data/questions",
        help="Directory with question .txt files",
    )
    parser.add_argument(
        "--categories",
        default="data/question_categories.jsonl",
        help="Path to question categories JSONL",
    )
    parser.add_argument(
        "--out",
        default="data/question_search_index.json",
        help="Path to output search index JSON",
    )
    args = parser.parse_args()

    questions_dir = Path(args.questions)
    categories_path = Path(args.categories)
    out_path = Path(args.out)

    if not questions_dir.exists():
        raise SystemExit(f"Questions directory not found: {questions_dir}")

    tags_by_problem = load_topic_tags(categories_path)
    index = build_index(questions_dir, tags_by_problem)

    payload: dict[str, object] = {
        "_meta": {
            "generated_at_utc": dt.datetime.now(dt.timezone.utc).strftime(
                "%Y-%m-%d %H:%M"
            ),
            "questions_count": len(index),
            "source_questions_dir": str(questions_dir),
            "source_categories": str(categories_path),
        }
    }
    payload.update(index)

    out_path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=True) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {len(index)} indexed questions to {out_path}")


if __name__ == "__main__":
    main()
