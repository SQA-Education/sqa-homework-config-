# SQA Homework Config

Single source of truth for class dropdowns across all SQA homework repos.

## What this repo does

When you edit `classes.json` and commit, GitHub Actions automatically:

1. Reads the updated class list (section #, schedule, teacher) for each level
2. Connects to each homework repo listed under that level (e.g. `A1Class15`, `B2HWClass11`, etc.)
3. Replaces the class dropdown in that repo's `index.html` with the new options
4. Commits the change back to the repo

**Student URLs never change.** Each homework repo keeps its own GitHub Pages URL like `https://sqa-education.github.io/B2HWClass11/`.

## Files in this repo

| File | What it is |
|---|---|
| `classes.json` | The only file you edit each term. Lists every repo and its current class options. |
| `update_all_repos.js` | The script that does the work. Don't edit unless adjusting logic. |
| `.github/workflows/update-all.yml` | Tells GitHub when and how to run the script. |
| `README.md` | This file. |

## Each term — the only thing you do

1. Open this repo on github.com
2. Click `classes.json`
3. Click the pencil icon (top right of the file view)
4. Edit the `"section"`, `"schedule"`, and `"teacher"` values inside each level's `"classes"` array
5. Scroll down, type a commit message like `Term 3 2026 class list`
6. Click **Commit changes**

Wait about 1–2 minutes. Watch the green checkmark appear in the **Actions** tab. Every homework repo now has the new dropdown.

## Adding a new homework repo

Add the repo name to the `"repos"` array under its level, then commit. The next workflow run will include it.

## One-time setup (already done)

### 1. Personal Access Token (PAT) — gives the workflow permission to commit to other repos

1. Go to https://github.com/settings/personal-access-tokens (Fine-grained tokens)
2. Click **Generate new token**
3. Token name: `SQA Homework Updater`
4. Resource owner: **SQA-Education** (the organization)
5. Expiration: 1 year (set a calendar reminder to renew)
6. Repository access: **All repositories** (or pick the homework repos manually)
7. Permissions → Repository → **Contents: Read and Write**
8. Generate token → copy the token (starts with `github_pat_`)

### 2. Store the token as a repo secret

1. In THIS repo, go to **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Name: `SQA_PAT`
4. Value: paste the token
5. Click **Add secret**

The workflow now has permission to edit homework repos on your behalf.

## Manual run (to test, or for unscheduled updates)

1. Go to the **Actions** tab in this repo
2. Click **Update homework class dropdowns across all repos** in the left sidebar
3. Click **Run workflow** (top right)
4. Optionally select **Dry run = true** to preview without committing
5. Click the green **Run workflow** button

## Troubleshooting

**Workflow shows red ✗:** Click into the failed run → expand the "Run cross-repo updater" step. The log lists each repo and what happened.

**Common failures:**
- `HTTP 404` for a repo → repo name in `classes.json` is misspelled, repo was deleted, or PAT doesn't have access to it
- `HTTP 401/403` → PAT expired or doesn't have Contents: Read and Write permission
- `no index.html, skipped` → repo exists but has no `index.html` at the root; not an error, just informational
- `no class dropdown found, skipped` → file exists but doesn't have `<select id="studentClass">` or `<select id="className">`; not an error

**Quiz repos (B1Quiz3, B1Quiz4, B2Quiz3) are intentionally not in `classes.json`.** Add them later if needed.

## What the workflow does NOT touch

- Form submission code (Google Form entry IDs, fetch+FormData)
- Speech recognition patterns
- Scoring logic
- Curriculum content (reading passages, vocabulary, grammar, etc.)
- Anything outside the `<select>...</select>` block

This is deliberate. Those areas were stabilized in earlier audits and shouldn't be modified by automated tooling.
