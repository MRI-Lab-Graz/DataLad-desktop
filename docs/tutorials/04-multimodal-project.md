# Tutorial 4: Multi-modal project integration

## Scenario

A study combines imaging, clinical, and survey data. Work is split by modality
and then integrated for a unified analysis checkpoint.

## Level

Intermediate to advanced

## Estimated time

60 to 75 minutes

## Skills trained

- Manage complex projects with modality-specific components
- Track changes across nested structures
- Integrate parallel branches into a dedicated integration branch
- Validate project state before Publish

## Setup

1. Create branches:
   - `feature/imaging-qc`
   - `feature/clinical-harmonization`
   - `feature/survey-scoring`
   - `integration/multimodal-v1`
2. Prepare representative files:
   - `imaging/qc/report.md`
   - `clinical/harmonized/cohort.csv`
   - `survey/scored/responses.csv`
   - `analysis/integration-notes.md`

## Walkthrough tasks

1. Complete one Save on each feature branch with modality-specific changes.
2. Switch to `integration/multimodal-v1`.
3. Merge all three feature branches into integration.
4. Review status for unexpected cross-modality edits.
5. Add integration notes explaining alignment assumptions.
6. Save integration checkpoint with message:
   - `integration: combine imaging clinical survey v1`
7. Publish integration branch to shared remote.

## Failure injection

- Introduce a mismatched subject identifier in one modality file.
- Detect mismatch during integration review.
- Recover by correcting the identifier and recording the fix rationale.

## Completion criteria

- Integration branch contains all modalities with no unexplained drift.
- Status is clean before Publish.
- Team can point to the exact checkpoint where modalities first align.

## Debrief

- What checks should be mandatory before multimodal integration?
- Where should data contract assumptions be documented?
