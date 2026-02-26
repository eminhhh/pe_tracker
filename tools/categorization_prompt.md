# AI Prompt: PE Question Categorization

Use this prompt with your preferred LLM to classify only missing files from `data/questions/`.

## System Prompt
You are a strict data labeling assistant. Follow the schema exactly, output JSON Lines only, and do not include explanations.

## User Prompt
You will receive:
1. Candidate Project Euler question files.
2. Existing labeled records from `data/question_categories.jsonl` (may be partial).

Task:
1. Determine which candidate files are missing from existing records (match by exact `file` path).
2. For each missing file, assign exactly one `primary_branch`.
3. Add 0-3 `topic_tags`.
4. Output one JSON object per line for missing files only.

Allowed `primary_branch` values:
- Algebra
- Geometry
- Trigonometry
- Calculus
- Probability_Statistics
- Number_Theory
- Discrete_Math
- Linear_Algebra
- Analytic_Geometry
- Mixed_or_Interdisciplinary

Rules:
- Choose branch by dominant solving method.
- If no dominant method exists, use `Mixed_or_Interdisciplinary`.
- If uncertain, still choose best branch and include `needs_review` tag.
- Keep tags short snake_case.
- Do not solve questions.
- Never re-output files that already exist in `data/question_categories.jsonl`.
- If no files are missing, output nothing.
- Output JSON Lines only, no markdown.

Output schema (all fields required):
{"file":"data/questions/0001.txt","problem_id":1,"title":"...","primary_branch":"Number_Theory","topic_tags":["..."],"confidence":0.0}

Confidence guide:
- 0.85-1.00 clear branch
- 0.65-0.84 mostly clear
- 0.40-0.64 ambiguous

Now classify only missing files.

## Suggested Local Workflow
1. Build missing file list by comparing `data/questions/*.txt` with existing `data/question_categories.jsonl` records:

```bash
python3 - <<'PY'
from pathlib import Path
import json

questions = sorted(Path('data/questions').glob('*.txt'))
existing = set()
jsonl_path = Path('data/question_categories.jsonl')

if jsonl_path.exists():
    for line in jsonl_path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        file_path = obj.get('file')
        if isinstance(file_path, str):
            existing.add(file_path)

missing = [
    p.as_posix()
    for p in questions
    if p.as_posix() not in existing
]

out_path = Path('data/missing_question_files.txt')
out_path.write_text('\n'.join(missing) + ('\n' if missing else ''), encoding='utf-8')
print(f'missing={len(missing)} -> {out_path}')
PY
```

2. Send only files listed in `data/missing_question_files.txt` to your LLM with the system/user prompt above.

3. Save model output to a temporary file:

`data/question_categories.new.jsonl`

4. Validate JSONL quickly:

```bash
python3 - <<'PY'
import json
from pathlib import Path

path = Path('data/question_categories.new.jsonl')
if not path.exists():
    raise SystemExit('missing file: data/question_categories.new.jsonl')

ok = True
for i, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
    line = line.strip()
    if not line:
        continue
    try:
        obj = json.loads(line)
        required = {'file','problem_id','title','primary_branch','topic_tags','confidence'}
        if not required.issubset(obj):
            ok = False
            print(f'Line {i}: missing keys')
    except Exception as e:
        ok = False
        print(f'Line {i}: invalid JSON ({e})')

print('OK' if ok else 'FAILED')
PY
```

5. Append new records:

```bash
cat data/question_categories.new.jsonl >> data/question_categories.jsonl
```

6. Optional dedupe check (keeps first occurrence per file):

```bash
python3 - <<'PY'
import json
from pathlib import Path

path = Path('data/question_categories.jsonl')
seen = set()
lines = []
for line in path.read_text(encoding='utf-8').splitlines():
    raw = line.strip()
    if not raw:
        continue
    try:
        obj = json.loads(raw)
    except Exception:
        continue
    key = obj.get('file')
    if not isinstance(key, str) or key in seen:
        continue
    seen.add(key)
    lines.append(json.dumps(obj, ensure_ascii=True))

path.write_text('\n'.join(lines) + ('\n' if lines else ''), encoding='utf-8')
print(f'kept={len(lines)}')
PY
```
