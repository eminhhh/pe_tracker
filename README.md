# Project Euler Tracker

Simple shared tracker for Project Euler problem.

## What it does

- Sign in with display name + 4-digit PIN
- Display names are unique; same name can be reused only with matching PIN
- Show one global board for everyone
- Track `status`, `solvedCount`, and `lastSolvedAt`
- Allow removing one solve count when needed
- Read levels from `data/levels.json` (not Firestore)

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
- It also runs `python3 build_levels_json.py` only if `data/pe_data.html` exists in the checked-out source.

Because `data/pe_data.html` is ignored in this repo, the normal flow is:

1. Regenerate `data/levels.json` locally.
2. Commit updated `data/levels.json`.
3. Push to `main`.

Then GitHub Actions deploys the updated site automatically.

## Build `levels.json` from PE HTML

Run from project root:

`python3 build_levels_json.py`

Optional arguments:

`python3 build_levels_json.py --input data/pe_data.html --output data/levels.json`

What it does:

- Reads problem metadata from `data/pe_data.html`
- Auto-detects the latest available problem number
- Rebuilds `data/levels.json` from `1..max_problem_number`
- Writes `_meta.last_updated_utc`, `_meta.generated_at_utc`, and `_meta.max_problem_number`

If new Project Euler problems are released, replace `data/pe_data.html` with a newer export and run the same command again.
