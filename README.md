# Project Euler Tracker

Simple shared tracker for Project Euler problem.

## What it does

- Sign in with display name + 4-digit PIN
- Display names are unique; same name can be reused only with matching PIN
- PIN is stored as hash (`pinHash`) in Firestore, never as raw PIN
- Browser remembers only display name (PIN is not persisted)
- Show one global board for everyone
- Filter board with `My solves` (problems solved by current login)
- Filter by level range (`Min level`/`Max level`) and math branch (`All branches` or a specific branch)
- Track `status`, `solvedCount`, and `lastSolvedAt`
- Allow removing only your own solve logs
- Read levels from `data/levels.json` (not Firestore)
- Read branch categories from `data/question_categories.jsonl` when available

Allowed status labels:

- `assignment`
- `solved in lecture`
- `solved`
- `unsolved`

## Quick setup

1. Create Firebase project.
2. Enable `Authentication -> Anonymous`.
3. Enable `Firestore Database`.
4. Paste your Firebase config in `app.js`.
5. Copy `firebase.rules` into Firestore Rules and click Publish.
6. Deploy this folder on GitHub Pages.

Note: this app tracks only group progress (no personal dashboard).

## GitHub Pages auto-deploy

This repo includes `.github/workflows/deploy-pages.yml`.

- On every push to `main`, it deploys the site to GitHub Pages.
- It injects an asset version (`?v=<commit-sha>`) into `index.html` so `app.js` and `style.css` always bypass stale browser cache after deploy.

## Automated data refresh workflow

This repo also includes `.github/workflows/refresh-pe-data.yml`.

- Runs daily (and manually via workflow dispatch).
- Regenerates `data/levels.json`, downloads missing files in `data/questions`, and rebuilds `data/question_search_index.json`.
- Commits and pushes data updates automatically.

Before using it, add repository secret:

- `PE_PJ_COOKIE` -> value of your `__Host-PHPSESSID` cookie.

At runtime, GitHub Actions writes this to `.env/projecteuler_server.env`.

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
