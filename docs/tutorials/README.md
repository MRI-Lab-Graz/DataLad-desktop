# Tutorials: Progressive Research Demos

This tutorial pack is designed for workshops, onboarding, and self-study.
It starts with a single-researcher workflow and builds up to publication-grade
multi-branch collaboration.

## How to use this pack

- Run tutorials in order from 1 to 6.
- Each tutorial has a scientific story, setup, tasks, one intentional failure,
  and clear completion criteria.
- Keep the app in its default novice-friendly mode unless a step explicitly
  asks for Project Setup branch actions.

## Learning path

1. [Tutorial 00: Create your first project](00-create-first-project.md)
2. [Tutorial 1: First checkpoint in a small project](01-first-checkpoint.md)
3. [Tutorial 2: Data cleaning and metadata discipline](02-cleaning-metadata.md)
4. [Tutorial 3: Team collaboration with feature branches](03-team-feature-branches.md)
5. [Tutorial 4: Multi-modal project integration](04-multimodal-project.md)
6. [Tutorial 5: Longitudinal multi-site study operations](05-longitudinal-multisite.md)
7. [Tutorial 6: Publication freeze, release, and hotfix](06-publication-freeze-release.md)

## Audience and outcomes

- New users learn safe Save, Update, and Publish behavior quickly.
- Research teams learn branch-based collaboration without Git internals.
- Advanced users learn governance patterns for large, complex studies.

## Suggested facilitation

- Beginner audience: run 00 to 3 in one half-day session.
- Mixed audience: run 00, 2, 4, and 6 in one day.
- Advanced audience: run 3 to 6 over two sessions with discussion between runs.

## Standard branch model used in advanced tutorials

- `main`: stable shared line.
- `feature/*`: isolated scientific tasks.
- `integration/*`: branch that combines parallel work before release.
- `release/*`: frozen state used for manuscript or external delivery.
- `hotfix/*`: urgent correction merged back into release and main.

## Assessment rubric

Use these checks after each tutorial:

- State awareness: user can explain current project status.
- Safe save behavior: user avoids saving with unresolved conflicts.
- Branch hygiene: user can keep task work isolated.
- Reproducibility: user can describe why this checkpoint is traceable.
