# AI Prompt: PE Question Categorization (Batch)

Use this prompt with your preferred LLM to classify every file in `data/questions/`.

## System Prompt
You are a strict data labeling assistant. Follow the schema exactly, output JSON Lines only, and do not include explanations.

## User Prompt
You will receive multiple Project Euler question files.

Task:
1. For each file, assign exactly one `primary_branch`.
2. Add 0-3 `topic_tags`.
3. Output one JSON object per line.

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
- Output JSON Lines only, no markdown.

Output schema (all fields required):
{"file":"data/questions/0001.txt","problem_id":1,"title":"...","primary_branch":"Number_Theory","topic_tags":["..."],"confidence":0.0}

Confidence guide:
- 0.85-1.00 clear branch
- 0.65-0.84 mostly clear
- 0.40-0.64 ambiguous

Now classify all provided files.

## Suggested Local Workflow
1. Build a file list:

```bash
python3 - <<'PY'
from pathlib import Path
for p in sorted(Path('data/questions').glob('*.txt')):
    print(p.as_posix())
PY
```

2. Send file contents to your LLM with the system/user prompt above.

3. Save model output to:

`data/question_categories.jsonl`

4. Validate JSONL quickly:

```bash
python3 - <<'PY'
import json
from pathlib import Path
path = Path('data/question_categories.jsonl')
ok = True
for i, line in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
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
