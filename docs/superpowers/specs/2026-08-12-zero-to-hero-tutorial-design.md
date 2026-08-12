---
title: Zero-to-Hero Tutorial + ReadTheDocs for DataLad Desktop
status: approved
date: 2026-08-12
---

# Zero-to-Hero Tutorial + ReadTheDocs for DataLad Desktop

## Why this exists

`docs/tutorials/00`-`06` already cover the full skill progression for DataLad
Desktop (create a project → checkpoint discipline → metadata hygiene → branch
collaboration → nested/multimodal datasets → longitudinal multi-site ops →
release/hotfix), but they're written as an instructor-led workshop rubric
(Scenario / Skills trained / Walkthrough tasks / Failure injection /
Completion criteria / Debrief) — good for a facilitated session, not for
someone learning alone.

The target audience is scientific staff: students, professors, and future-me
— people who need to actually understand *why* a step matters, not just
execute it. The reference point for "done well" is the sibling project
prism-studio's docs (`https://github.com/MRI-Lab-Graz/prism-studio/tree/main/docs`):
a self-paced, persona-driven tutorial track with a card-based "pick a reason
to be here" picker (three character archetypes, remembered via
`localStorage`, called back to in each chapter) sitting on top of full
step-by-step walkthroughs with screenshots.

**Explicit constraint:** prism-studio is a *style* reference only. No content
（datasets, scenarios, persona bios, screen names) is reused from it — this
repo's tutorial is entirely new content about DataLad Desktop's own features.

## Scope

**In scope:**
- Rewrite `docs/tutorials/00`-`06` in place into self-paced, persona-driven,
  screenshot-illustrated chapters — same 7-chapter order and skill
  progression, narrative format instead of workshop rubric.
- A new persona-picker mechanism (`docs/_static/persona.js` + CSS), built
  fresh for this repo — same UX pattern as prism-studio's, new
  implementation, new characters.
- `docs/tutorials/README.md` becomes the landing page: persona picker +
  chapter card grid (icon, outcome, time estimate), replacing the current
  plain numbered list. The existing branch-model glossary and assessment
  rubric survive as a condensed appendix rather than being deleted.
- A full screenshot pass: launch the app, capture every screen the rewritten
  chapters reference, light + dark, named
  `datalad-desktop-<page>-<step>-<light|dark>.png`.
- A fresh ReadTheDocs project for this repo (separate from prism-studio's).
- Release-process wiring: a version-pinned docs link
  (`https://datalad-desktop.readthedocs.io/en/v<tag>/`) added automatically
  to future GitHub Release bodies, plus an RTD build trigger on release.

**Out of scope:**
- No dual-track (instructor-led workshop + self-paced tutorial) split — the
  existing files are rewritten in place, not duplicated. Facilitation-style
  content (timing-per-audience, failure-injection scripts) is condensed into
  an appendix, not preserved as its own track.
- No new tutorial tiers beyond the existing 7-chapter arc.
- No reuse of prism-studio content, personas, or wording.

## Current status (as of 2026-08-12)

The RTD side is done and verified:
- `docs/conf.py`, `.readthedocs.yaml`, `docs/requirements.txt`, `docs/index.md`,
  `docs/_static/` scaffolded (Sphinx + MyST + shibuya theme, matching
  prism-studio's stack) and committed (`33b7597`).
- RTD project imported at slug `datalad-desktop`
  (`https://app.readthedocs.org/projects/datalad-desktop/`).
- `RTD_API_TOKEN` / `RTD_PROJECT_SLUG` GitHub secrets added.
- `latest` version builds clean and is live:
  `https://datalad-desktop.readthedocs.io/en/latest/`.
- `stable` version currently fails to build — expected, not a bug: it builds
  against the `v0.3.0` tag, which predates the docs scaffold
  (`docs/conf.py` doesn't exist at that commit). Resolves itself the next
  time a release tag is cut with the scaffold included.

Everything else below — persona mechanism, chapter rewrites, screenshots,
release-workflow wiring — is not yet started.

## Chapter mapping

Each rewritten chapter keeps its current topic and file name, grounded in
real, current UI (verified against `src/gui/renderer/index.html` element
IDs, not assumed):

| # | Chapter | Core UI covered |
|---|---|---|
| 00 | Create Your First Project | `check-env` (Check Setup), `create-project`, first Save |
| 01 | First Checkpoint | working-tree view (staged/unstaged/conflicts), Save with a message |
| 02 | Cleaning Metadata | per-project `.gitignore` rules (`ignore-rules-*`) |
| 03 | Team Feature Branches | `create-branch` / `switch-branch`, dirty-state guard, Project Setup area |
| 04 | Multimodal Project Integration | nested sub-datasets (`refresh-datasets`), `get-data` |
| 05 | Longitudinal Multi-Site Study Operations | `update-project`, Studies Server (SSH) browse/install |
| 06 | Publication Freeze, Release, Hotfix | `publish-project`, release/hotfix branch model |

Each chapter, in the new format, includes:
- A one-paragraph "why this matters" grounded in a real researcher failure
  mode (lost data, broken provenance, merge conflict panic), not generic
  praise for version control.
- Numbered step-by-step walkthrough against the actual current UI, with a
  screenshot per major step.
- A persona callback note (see below).
- A troubleshooting section replacing the old "Failure injection" exercise:
  the same intentional mistake, shown as "if you do X, here's the warning
  you'll see and how to recover" with a screenshot of the actual warning.
- Time estimate and "what's next" link, matching the existing pattern from
  `docs/tutorials/00-create-first-project.md`.

## Persona mechanism

Three archetypes (new bios, DataLad-Desktop-specific, no wording reused from
prism-studio):

- **The enthusiastic student** — first real research project, building
  good version-control habits from commit one, before bad habits set in.
- **The skeptical PI** — burned once by an untracked, unrecoverable
  dataset; now every project in the lab starts in DataLad Desktop, no
  exceptions.
- **Future-you** — eighteen months from now, needs to explain exactly
  what changed, when, and why, to a reviewer or a new lab member.

Mechanism (new implementation, same pattern as prism-studio's `persona.js`):
a card grid on `docs/tutorials/README.md`, selection stored in
`localStorage`, chapters render a `[data-persona-note]` block matching the
stored choice. Pure enhancement — every page works fully without JS.

## Screenshot plan

No screenshots exist in this repo today. Full pass, this round:
- Launch the app per the project's `run` skill (mind the
  `ELECTRON_RUN_AS_NODE` env var gotcha for a real Electron launch, not a
  Node-mode launch).
- One screenshot per major step referenced in the 7 rewritten chapters,
  light + dark where the app's theme toggle affects the screen.
- Store under `docs/_static/screenshots/`, matching prism-studio's
  directory convention for consistency across the org's doc sites.

## Release-process wiring

`build-os-artifacts.yml`'s `publish-release` job currently uses
`action-gh-release@v2` with `generate_release_notes: true` and no custom
body. Add a step before release creation that:
1. Triggers an RTD build for `stable` and `latest` via the RTD API
   (`RTD_API_TOKEN` / `RTD_PROJECT_SLUG` secrets, already in place).
2. Composes a short header (`📖 Docs for this version:
   https://datalad-desktop.readthedocs.io/en/v<tag>/`) and passes it as
   `body`, combined with `generate_release_notes: true` — exact combination
   behavior (does GitHub's auto-generated body append after a custom `body`,
   or does one override the other?) gets verified against a real release
   during implementation, not assumed here.

## Execution order

1. Persona mechanism (JS/CSS) + `docs/tutorials/README.md` landing page rewrite
2. Chapters 00-06 rewritten in place, one at a time
3. Full screenshot pass, wired into the finished chapters
4. Release-workflow wiring (versioned RTD link + build trigger)
5. Clean Sphinx build with `fail_on_warning: true` (currently `false` in
   `.readthedocs.yaml` — flip once the rewritten content passes clean) +
   full link check
