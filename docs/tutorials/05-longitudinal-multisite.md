# Tutorial 5: Longitudinal multi-site study operations

## Scenario

A longitudinal study receives monthly updates from multiple sites. The team
must ingest new waves while preserving site-level traceability.

## Level

Advanced

## Estimated time

75 to 90 minutes

## Skills trained

- Operate with branch strategy by site and by wave
- Run incremental update and Save cycles
- Maintain stable release branches while new data arrives
- Communicate operational status to collaborators

## Setup

1. Create branch families:
   - `site/a-wave-01`, `site/b-wave-01`
   - `site/a-wave-02`, `site/b-wave-02`
   - `integration/wave-01`, `integration/wave-02`
2. Add site-specific incoming files:
   - `incoming/site-a/wave-01.csv`
   - `incoming/site-b/wave-01.csv`
   - `incoming/site-a/wave-02.csv`
   - `incoming/site-b/wave-02.csv`
3. Keep `main` reserved for validated integration only.

## Walkthrough tasks

1. Process wave 1 on site branches and Save per site.
2. Merge site branches into `integration/wave-01`.
3. Validate integration and merge into `main`.
4. Repeat for wave 2 with the same discipline.
5. Use Update before each integration merge to reduce divergence.
6. Publish only after each wave integration passes review.

## Failure injection

- Simulate late correction from Site B after wave 1 merged.
- Apply correction on `site/b-wave-01` and forward-merge into
  `integration/wave-02` with explicit note.

## Completion criteria

- Each wave has a complete trace from site branch to integration branch.
- Main remains stable and reviewable at all times.
- Team can answer when and where each site update entered history.

## Debrief

- Which operational metrics matter most for longitudinal studies?
- How should your team announce wave readiness for integration?
