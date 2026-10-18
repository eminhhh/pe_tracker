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
- Read the group board from one realtime `publicStats/problemSummary` aggregate doc instead of all problem docs
- Read leaderboard rankings from hourly server-updated per-user aggregate docs instead of every solve log
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
- `publicStats/problemSummary` stores group solved counts/statuses so the board reads one shared doc instead of every `problems` doc.
- `leaderboardUsers` stores aggregate `solvedCount` and `score` per display name so leaderboard reads scale with user count, not solve count.
- Browser clients cannot write `publicStats` or `leaderboardUsers`; Cloud Functions maintain them with the Firebase Admin SDK.
- Legacy users with unsalted `pinHash` are migrated to salted `pinHash` + `pinSalt` on next successful login.
- This is still a client-only 4-digit PIN model; for stronger protection use backend-verified auth.

## GitHub Pages auto-deploy

This repo includes `.github/workflows/deploy-pages.yml`.

- On every push to `main`, it deploys the site to GitHub Pages.
- It injects an asset version (`?v=<commit-sha>`) into `index.html` so `app.js` and `style.css` always bypass stale browser cache after deploy.

## Automated data refresh workflow

This repo also includes `.github/workflows/refresh-pe-data.yml`.

- Runs daily at `00:00` UTC (and manually via workflow dispatch).
- Regenerates `data/levels.json`, downloads missing files in `data/questions`, and rebuilds `data/question_search_index.json`.
- Commits and pushes data updates automatically when changes are detected.
- Deploys GitHub Pages in the same workflow run when data was updated.

Before using it, add repository secret:

- `PE_PJ_COOKIE` -> value of your `__Host-PHPSESSID` cookie, or the full `Cookie` request header from a signed-in `https://projecteuler.net/progress` request.

GitHub Actions passes this secret directly as the `PJ_COOKIE` environment variable. It takes precedence over local dotenv files.

If the refresh works locally but Actions returns HTTP 401/403:

The script checks the public `/about` page without cookies after a 401/403. If that is also rejected, the problem extends beyond the authenticated progress page. A valid cookie can still fail from a restricted network. A [Project Euler administrator discussed hosting-provider filtering in an earlier report of this exact pattern](https://projecteuler.chat/viewtopic.php?t=7487); that incident was reported resolved in 2023, so it is supporting context rather than proof of a current block.

To use a working network for the refresh job:

1. On a trusted Linux machine where the script works, [register a self-hosted GitHub Actions runner](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners) and give it a unique label such as `pe-refresh`. Keep the runner online for scheduled jobs.
2. Under **Settings → Secrets and variables → Actions → Variables**, add repository variable `PE_REFRESH_RUNNER` with value `pe-refresh` (or your chosen label).
3. Keep the existing `PE_PJ_COOKIE` secret and run **Refresh Project Euler Data** manually again. Only the refresh job uses the selected runner; Pages deployment stays on a GitHub-hosted runner. Removing the variable restores `ubuntu-latest`.

If the public page succeeds, the failure is specific to `/progress` or its request; it still does not prove that a cookie known to work locally is invalid. For sessions that require additional cookies, `PE_PJ_COOKIE` can contain the full single-line **Cookie request header** from a signed-in `/progress` request (not the response `Set-Cookie` header). Cookie values are credentials; keep them in secrets and out of logs or commits.

## Firestore aggregate functions

Cloud Functions keep Firestore reads low:

- `syncProblemSummaryOnSolveWrite` updates `publicStats/problemSummary` shortly after a solve is created or deleted.
- `syncProblemSummaryOnProblemWrite` refreshes one summary entry when admin problem metadata changes.
- `updateLeaderboardUsers` runs hourly and rebuilds `leaderboardUsers` from `solveEvents`; it also reconciles `publicStats/problemSummary`.

Deploy after enabling Blaze and Cloud Scheduler:

`firebase deploy --only firestore:rules,functions:updateLeaderboardUsers,functions:syncProblemSummaryOnSolveWrite,functions:syncProblemSummaryOnProblemWrite --project petracker-a65e6`

After first deploy, run the scheduled function once from the Firebase/Google Cloud console or wait for the next hourly run so `publicStats/problemSummary` is created from existing data.

## Categorization prompt

`tools/categorization_prompt.md` contains the LLM prompt/workflow for classifying missing question files into branches and tags.

Use it together with `data/question_categories.jsonl` when you want to update or extend category metadata.

## Build `levels.json` from Project Euler web progress

Run from project root:

`python3 tools/build_levels_json.py`

Optional arguments:

`python3 tools/build_levels_json.py --output data/levels.json`

### Cookie setup (`.env` folder)

This script reads cookies in this order (later sources override earlier ones):

1. `.env/projecteuler_server.env`
2. `.env/projecteuler.env` (overrides server file when both exist)
3. `PJ_COOKIE` environment variable (used by GitHub Actions)

1. Copy `.env/projecteuler.env.example` to `.env/projecteuler.env`.
2. Set the cookie value from your browser session:
   - `PJ_COOKIE` -> value of `__Host-PHPSESSID`, or a single-line `Cookie` request header such as `__Host-PHPSESSID=session; DYNSRV=server` (placeholder values)

`PJ_COOKIE` is required to access the authenticated progress page. Full headers preserve explicit cookie names (including `PHPSESSID` if that is what your browser sends). The script ignores the browser's `filter_type` cookie so a solved/unsolved filter cannot omit problems from the generated data.

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
