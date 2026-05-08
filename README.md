# Project Euler Tracker

Simple shared tracker for Project Euler problems.

## What it does

- Sign in with display name + 4-digit PIN
- Display names are unique; same name can be reused only with matching PIN
- PIN is stored as salted PBKDF2 hash (`pinHash` + `pinSalt`) in Firestore, never as raw PIN
- Filter board with `My solves` (problems solved by current login)
- Switch between tracker and anonymous tile leaderboard views
- Filter by level range (`Min level`/`Max level`) and math branch (`All branches` or a specific branch)
- Track `status`, `solvedCount`, and `lastSolvedAt`
- Allow removing only your own solve logs
- Read branch categories from `data/question_categories.jsonl` when available
- Search by question number or text using `data/question_search_index.json`

Allowed status labels:

- `assignment`
- `solved in lecture`
- `solved`
- `unsolved`

UI note:

- Level `0` unsolved problems are shown as `not eligible for final` in the board/legend.

## Quick setup

1. Create Firebase project.
2. Enable `Authentication -> Anonymous`.
3. Enable `Firestore Database`.
4. Paste your Firebase config in `app.js`.
5. Copy `firebase.rules` into Firestore Rules and click Publish.
6. Deploy this folder on GitHub Pages.

## Security notes (client-only auth)

- `displayNames` allows document reads (`get`) but blocks collection listing (`list`) to reduce hash scraping risk.
- Legacy users with unsalted `pinHash` are migrated to salted `pinHash` + `pinSalt` on next successful login.
- This is still a client-only 4-digit PIN model; for stronger protection use backend-verified auth.

## GitHub Pages auto-deploy

This repo includes `.github/workflows/deploy-pages.yml`.

- On every push to `main`, it deploys the site to GitHub Pages.
- It injects an asset version (`?v=<commit-sha>`) into `index.html` so `app.js` and `style.css` always bypass stale browser cache after deploy.

## Automated data refresh workflow

This repo also includes `.github/workflows/refresh-pe-data.yml`.

- Runs every 3 hours at minute `00` UTC (and manually via workflow dispatch).
- Regenerates `data/levels.json`, downloads missing files in `data/questions`, and rebuilds `data/question_search_index.json`.
- Commits and pushes data updates automatically when changes are detected.
- Deploys GitHub Pages in the same workflow run when data was updated.

Before using it, add repository secret:

- `PE_PJ_COOKIE` -> value of your `__Host-PHPSESSID` cookie.

At runtime, GitHub Actions writes this to `.env/projecteuler_server.env` and uses it for the refresh scripts.

## Categorization prompt

`tools/categorization_prompt.md` contains the LLM prompt/workflow for classifying missing question files into branches and tags.

Use it together with `data/question_categories.jsonl` when you want to update or extend category metadata.

## Build `levels.json` from Project Euler web progress

Run from project root:

`python3 tools/build_levels_json.py`

Optional arguments:

`python3 tools/build_levels_json.py --output data/levels.json`

### Cookie setup (`.env` folder)

This script reads cookies in this order:

1. `.env/projecteuler_server.env`
2. `.env/projecteuler.env` (overrides server file when both exist)

1. Copy `.env/projecteuler.env.example` to `.env/projecteuler.env`.
2. Set the cookie value from your browser session:
   - `PJ_COOKIE` -> value of `__Host-PHPSESSID`

`PJ_COOKIE` is required to access the authenticated progress page.

What it does:

- Fetches problem metadata from `https://projecteuler.net/progress`
- Auto-detects the latest available problem number
- Rebuilds `data/levels.json` from `1..max_problem_number`
- Stores per-problem `solved_by` counts from the PE tooltip
- Writes `_meta.last_updated_utc`, `_meta.generated_at_utc`, and `_meta.max_problem_number`

## Download question text files

Download minimal Project Euler statements into `data/questions`:

`python3 tools/download_questions.py`

Optional examples:

`python3 tools/download_questions.py --start 1 --end 100`

`python3 tools/download_questions.py --force`

## Build question search index

Build the text-search index used by the main search bar (`#` + title/body/tags):

`python3 tools/build_question_search_index.py`

Optional argument:

`python3 tools/build_question_search_index.py --out data/question_search_index.json`
