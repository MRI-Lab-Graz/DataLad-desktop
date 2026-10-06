# Tutorial 6: Publication freeze, release, and hotfix

## Scenario

The project is ready for manuscript submission. You need a frozen release,
clear provenance, and a controlled path for urgent corrections.

## Level

Advanced

## Estimated time

60 to 80 minutes

## Skills trained

- Prepare a release freeze branch from stable integration
- Verify reproducibility evidence before release
- Handle post-freeze corrections through hotfix branch
- Keep main and release consistent after fixes

## Setup

1. Start from a clean, validated `main`.
2. Create branches:
   - `release/paper-v1`
   - `hotfix/paper-v1-erratum`
3. Prepare release artifacts:
   - `manuscript/results-summary.md`
   - `manuscript/methods.md`
   - `reproducibility/runbook.md`

## Walkthrough tasks

1. Create `release/paper-v1` from `main`.
2. Run final review of project status and changed files.
3. Save final release metadata update with message:
   - `release: freeze paper-v1 with reproducibility runbook`
4. Publish `release/paper-v1`.
5. Simulate discovery of a small numeric typo.
6. Create `hotfix/paper-v1-erratum` from release branch.
7. Apply typo fix and Save with message:
   - `hotfix: correct table value in results summary`
8. Save all changes first; Merge refuses to start with unsaved changes.
   - Switch to the release branch and merge the hotfix with **Merge Into Current Branch** and **Merge**.
   - Then switch to `main` and merge the release branch the same way.
   If the same file changed on both branches, the **Merge in progress** banner appears above **Files To Save**. For each file choose **Keep this branch's version**, **Keep `<branch>`'s version**, or edit the file yourself and choose **I fixed it myself**; then click **Finish Merge** (or **Cancel Merge** to go back).
9. On the release branch, open Time Machine and use **Mark As Version** on the submitted state (for example `paper-v1`).
10. Publish updated branches.

## Failure injection

- Intentionally apply the hotfix on `main` first.
- Recover by re-applying through `hotfix/paper-v1-erratum` and documenting why
  release-first fixes are required for auditability.

## Completion criteria

- Release branch represents a defensible paper snapshot.
- Hotfix path is traceable and merged back without divergence.
- Team can explain exactly which checkpoint underlies submitted results.

## Debrief

- What constitutes a release freeze in your discipline?
- Which release artifacts should be mandatory before submission?
