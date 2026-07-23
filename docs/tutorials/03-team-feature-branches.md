# Tutorial 3: Team collaboration with feature branches

## Scenario

Three team members work in parallel on preprocessing, statistics, and figures.
The team must avoid conflicts on main while integrating safely.

## Level

Intermediate

## Estimated time

45 to 60 minutes

## Skills trained

- Create and switch branches in Project Setup
- Isolate work in feature branches
- Integrate feature branches in controlled order
- Resolve simple branch-level conflicts

## Setup

1. Create these branches from `main`:
   - `feature/preprocessing`
   - `feature/statistics`
   - `feature/figures`
2. Seed file responsibilities:
   - preprocessing edits `scripts/preprocess.py`
   - statistics edits `analysis/stats.R`
   - figures edits `figures/plot.ipynb`
3. Add one shared file likely to conflict:
   - `README.md`

## Walkthrough tasks

1. Switch to `feature/preprocessing` and Save preprocessing edits.
2. Switch to `feature/statistics` and Save statistics edits.
3. Switch to `feature/figures` and Save figure edits.
4. Merge `feature/preprocessing` into `main`.
5. Merge `feature/statistics` into `main`.
6. Merge `feature/figures` into `main`.
7. Confirm final `main` status is clean and complete.

## Failure injection

- On two feature branches, edit the same line in `README.md`.
- Trigger a merge conflict during integration.
- Recover by choosing the scientifically correct wording and re-saving.

## Completion criteria

- Each branch has a clear, single responsibility.
- Integration reaches clean `main` without unresolved conflicts.
- Team can explain why parallel branches reduced coordination risk.

## Debrief

- Which merge order was easiest and why?
- What branch naming rules should your team standardize?
