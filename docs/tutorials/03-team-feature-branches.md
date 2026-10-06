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
4. Save all changes first; Merge refuses to start with unsaved changes. In **Project Setup → Branch**, switch to `main`, choose `feature/preprocessing` under **Merge Into Current Branch** and click **Merge**.
5. Repeat for `feature/statistics`, then `feature/figures`.
6. Confirm final `main` status is clean and complete.

## Failure injection

- On two feature branches, edit the same line in `README.md`.
- Trigger a merge conflict during integration. If the same file changed on both branches, the **Merge in progress** banner appears above **Files To Save**. For each file choose **Keep this branch's version**, **Keep `<branch>`'s version**, or edit the file yourself and choose **I fixed it myself**; then click **Finish Merge** (or **Cancel Merge** to go back).
- Recover by choosing the scientifically correct wording (or editing it yourself), then finishing the merge.

## Completion criteria

- Each branch has a clear, single responsibility.
- Integration reaches clean `main` without unresolved conflicts.
- Team can explain why parallel branches reduced coordination risk.

## Debrief

- Which merge order was easiest and why?
- What branch naming rules should your team standardize?
