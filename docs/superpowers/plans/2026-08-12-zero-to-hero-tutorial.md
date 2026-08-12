# Zero-to-Hero Tutorial + RTD Release Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `docs/tutorials/00`-`06` from an instructor-led workshop rubric into a self-paced, persona-driven "zero to hero" tutorial (new persona-picker mechanism, screenshots, troubleshooting sections), and wire the already-working ReadTheDocs pipeline into the release process.

**Architecture:** A `localStorage`-backed persona picker (`docs/_static/persona.js` + `docs/_static/custom.css`) drives per-chapter callback notes via `[data-persona-note]` blocks — pure progressive enhancement, every page works without JS. Each of the 7 chapters keeps its existing topic/scenario and time estimate but is restructured into a fixed template (why-it-matters → prerequisites → persona note → walkthrough with screenshots → troubleshooting → checklist → what's next). Release automation gets a new step in the existing `publish-release` job that triggers an RTD build and drops a version-pinned docs link into the GitHub Release body.

**Tech Stack:** Sphinx + MyST (already scaffolded, `docs/conf.py`), vanilla JS/CSS (no new npm dependencies — matches this repo's zero-dependency posture), GitHub Actions (`softprops/action-gh-release@v2`, already in use).

## Global Constraints

- No content, wording, or persona bios copied from prism-studio — same UX *mechanism* only, entirely new implementation and text. (spec, "Explicit constraint")
- No new npm/pip dependencies — vanilla JS/CSS for the persona picker, matching the repo's existing zero-dependency posture.
- Every chapter keeps its current file name, topic, and time estimate — only the format changes.
- Screenshot files: `docs/_static/screenshots/datalad-desktop-<page>-<step>-<light|dark>.png`.
- `.readthedocs.yaml` has `fail_on_warning: false` today — stays that way until Task 12 (final QA), which flips it to `true` only after a clean build.
- Merges are taught via Power User Mode's console (`git merge <branch>`), explicitly flagged as leaving guided territory — not a GUI action, because none exists. Decided 2026-08-12 after confirming no `merge` UI action exists in `src/gui/renderer/index.html` or `app.js`.

---

## File Structure

- Create: `docs/_static/persona.js` — persona picker logic (selection, `localStorage`, note-matching), ~90 lines, adapted mechanism only.
- Create: `docs/_static/custom.css` — persona card grid, chapter card grid, note-block visibility styling.
- Modify: `docs/conf.py` — register the two new static assets.
- Rewrite: `docs/tutorials/README.md` — landing page: persona picker, chapter card grid, condensed appendix.
- Rewrite: `docs/tutorials/00-create-first-project.md` through `docs/tutorials/06-publication-freeze-release.md` — 7 files, new template.
- Create: `docs/_static/screenshots/*.png` — one directory, populated in Task 10.
- Modify: `.github/workflows/build-os-artifacts.yml` — `publish-release` job gets an RTD-trigger step and a docs-link body step.
- Modify: `.readthedocs.yaml` — `fail_on_warning: false` → `true` (Task 12 only).

---

### Task 1: Persona picker mechanism

**Files:**
- Create: `docs/_static/persona.js`
- Create: `docs/_static/custom.css`
- Modify: `docs/conf.py`

**Interfaces:**
- Produces: storage key `"dldPersona"` (values: `"student"`, `"pi"`, `"future"`); DOM contract every later chapter/landing-page task must follow — a card grid `<div class="dld-persona-card" data-persona="...">`, a hint element `id="dldPersonaHint"`, and per-chapter note groups `<div data-persona-note>` containing `.dld-persona-note-content[data-persona="..."]` children plus an optional `[data-persona-empty]` fallback.

- [ ] **Step 1: Write `docs/_static/persona.js`**

```javascript
// Tutorial persona picker: lets a reader pick one of three framing stories
// on tutorials/README.md, remembers the choice (localStorage), and shows
// the matching flavor note in each chapter page. Pure enhancement — every
// page works fully without it.
(function () {
    "use strict";

    var STORAGE_KEY = "dldPersona";
    var PERSONA_META = {
        student: { icon: "👩🏽‍🎓", label: "The eager student" },
        pi: { icon: "👨🏿‍🔬", label: "The careful PI" },
        future: { icon: "🧑🏻", label: "Future you" }
    };

    function getSelectedPersona() {
        try {
            return window.localStorage.getItem(STORAGE_KEY);
        } catch (err) {
            return null;
        }
    }

    function setSelectedPersona(persona) {
        try {
            window.localStorage.setItem(STORAGE_KEY, persona);
        } catch (err) {
            // Private browsing / storage disabled — selection just won't persist.
        }
    }

    function applyPickerState(persona) {
        var cards = document.querySelectorAll(".dld-persona-card");
        if (!cards.length) return;
        cards.forEach(function (card) {
            var isSelected = card.getAttribute("data-persona") === persona;
            card.classList.toggle("is-selected", isSelected);
            card.setAttribute("aria-pressed", isSelected ? "true" : "false");
        });
        var hint = document.getElementById("dldPersonaHint");
        if (hint) {
            var meta = persona && PERSONA_META[persona];
            hint.textContent = meta
                ? "Selected: " + meta.icon + " " + meta.label + " — chapters ahead will speak to it. Click another card to switch."
                : "Pick one — chapters ahead will speak to it.";
        }
    }

    function applyNoteState(persona) {
        document.querySelectorAll("[data-persona-note]").forEach(function (group) {
            var empty = group.querySelector("[data-persona-empty]");
            var matched = false;
            group.querySelectorAll(".dld-persona-note-content").forEach(function (node) {
                var isMatch = node.getAttribute("data-persona") === persona;
                node.hidden = !isMatch;
                if (isMatch) matched = true;
            });
            if (empty) empty.hidden = matched;
        });
    }

    function refresh() {
        var persona = getSelectedPersona();
        applyPickerState(persona);
        applyNoteState(persona);
    }

    function selectFromCard(card) {
        var persona = card.getAttribute("data-persona");
        if (!persona) return;
        setSelectedPersona(persona);
        refresh();
    }

    function bindPicker() {
        document.querySelectorAll(".dld-persona-card").forEach(function (card) {
            card.addEventListener("click", function () {
                selectFromCard(card);
            });
            card.addEventListener("keydown", function (event) {
                if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
                    event.preventDefault();
                    selectFromCard(card);
                }
            });
        });
    }

    document.addEventListener("DOMContentLoaded", function () {
        bindPicker();
        refresh();
    });
})();
```

- [ ] **Step 2: Write `docs/_static/custom.css`**

```css
/* Persona picker grid (tutorials/README.md) */
.dld-persona-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
  margin: 1.5rem 0;
}

.dld-persona-card {
  position: relative;
  border: 1px solid var(--sy-c-border, #d0d7de);
  border-radius: 0.75rem;
  padding: 1rem 1.25rem;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.dld-persona-card:hover {
  border-color: var(--sy-c-primary, #2563eb);
}

.dld-persona-card.is-selected {
  border-color: var(--sy-c-primary, #2563eb);
  box-shadow: 0 0 0 2px var(--sy-c-primary, #2563eb) inset;
}

.dld-persona-card-check {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  opacity: 0;
}

.dld-persona-card.is-selected .dld-persona-card-check {
  opacity: 1;
}

.dld-persona-card-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.dld-persona-icon {
  font-size: 1.5rem;
}

.dld-persona-title {
  font-weight: 600;
}

.dld-persona-hint {
  font-size: 0.9rem;
  opacity: 0.8;
}

/* Chapter card grid (tutorials/README.md) */
.dld-chapter-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1rem;
  margin: 1.5rem 0;
}

.dld-chapter-card {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  border: 1px solid var(--sy-c-border, #d0d7de);
  border-radius: 0.75rem;
  padding: 1rem 1.25rem;
  text-decoration: none;
  color: inherit;
}

.dld-chapter-card:hover {
  border-color: var(--sy-c-primary, #2563eb);
}

.dld-chapter-icon {
  font-weight: 700;
  font-size: 1.1rem;
}

.dld-chapter-time {
  font-size: 0.85rem;
  opacity: 0.7;
}

/* Per-chapter persona callback note */
[data-persona-note] {
  border-left: 3px solid var(--sy-c-primary, #2563eb);
  padding: 0.75rem 1rem;
  margin: 1.25rem 0;
  background: var(--sy-c-bg-secondary, rgba(37, 99, 235, 0.06));
  border-radius: 0 0.5rem 0.5rem 0;
}

[data-persona-note] p {
  margin: 0;
}
```

- [ ] **Step 3: Wire the assets into `docs/conf.py`**

Modify `docs/conf.py` — after the existing `html_title = "DataLad Desktop Documentation"` line, add:

```python
html_static_path = ["_static"]
html_css_files = ["custom.css"]
html_js_files = ["persona.js"]
```

(`html_static_path = ["_static"]` already exists earlier in the file from the scaffold — do not duplicate the assignment, just add `html_css_files` and `html_js_files` as new lines near it.)

- [ ] **Step 4: Build and verify**

```bash
source /tmp/rtd-venv/bin/activate 2>/dev/null || python3 -m venv /tmp/rtd-venv && source /tmp/rtd-venv/bin/activate
pip install -q -r docs/requirements.txt
sphinx-build -b html docs /tmp/rtd-build-check
grep -q "persona.js" /tmp/rtd-build-check/index.html && grep -q "custom.css" /tmp/rtd-build-check/index.html && echo "ASSETS LINKED OK"
```

Expected: build succeeds, no new warnings beyond the pre-existing baseline, `ASSETS LINKED OK` printed.

- [ ] **Step 5: Commit**

```bash
git add docs/_static/persona.js docs/_static/custom.css docs/conf.py
git commit -m "feat(docs): add persona picker mechanism for tutorials"
```

---

### Task 2: Landing page rewrite (`docs/tutorials/README.md`)

**Files:**
- Modify: `docs/tutorials/README.md` (full rewrite)

**Interfaces:**
- Consumes: `.dld-persona-card` / `.dld-persona-grid` / `#dldPersonaHint` / `.dld-chapter-grid` / `.dld-chapter-card` contract from Task 1.
- Produces: the persona bios and chapter list every chapter task (3-9) links back to via "What's next".

- [ ] **Step 1: Replace the full content of `docs/tutorials/README.md`**

```markdown
# Tutorial: Zero to Hero with DataLad Desktop

A self-paced, start-from-zero walkthrough for someone who has never opened
DataLad Desktop before. Seven chapters take you from an empty folder through
solo checkpoint discipline, team branching, multimodal integration, and a
publication-ready release — one running project, `pilot-study-001`, carried
through the early chapters, expanding into realistic team scenarios as the
skills build.

**Time:** ~5-6 hours across all seven chapters if done back to back; most
people spread it over a few sessions. **Outcome:** comfortable, confident use
of every DataLad Desktop guided action (Save, Get Data, Update, Publish,
branches) plus a clear sense of when and how to reach for Power User Mode.

## Pick a reason to be here

None of this affects the instructions below — skip it entirely if you'd
rather just get started. But seven chapters go down easier with a "why"
attached. **Click one to select it** — your pick is remembered (in this
browser only) and the chapters ahead will call back to it directly:

<div class="dld-persona-grid" id="dldPersonaGrid">

<div class="dld-persona-card" data-persona="student" role="button" tabindex="0" aria-pressed="false">
<span class="dld-persona-card-check" aria-hidden="true">&check;</span>
<div class="dld-persona-card-header">
<span class="dld-persona-icon">👩🏽‍🎓</span>
<span class="dld-persona-title">The eager student</span>
</div>
<span class="dld-persona-text">

You're running your first real research project, `pilot-study-001`, and
you've just heard the lab horror story about a labmate who lost three weeks
of analysis to an overwritten spreadsheet. You want to build good checkpoint
habits before you have anything worth losing.

</span>
</div>

<div class="dld-persona-card" data-persona="pi" role="button" tabindex="0" aria-pressed="false">
<span class="dld-persona-card-check" aria-hidden="true">&check;</span>
<div class="dld-persona-card-header">
<span class="dld-persona-icon">👨🏿‍🔬</span>
<span class="dld-persona-title">The careful PI</span>
</div>
<span class="dld-persona-text">

Two years ago a postdoc's laptop died mid-analysis, and the only backup was
a Dropbox folder three weeks stale. Every project in your lab starts in
DataLad Desktop now, no exceptions. `pilot-study-001` is the newest one, and
you're walking it yourself before handing it to the next student.

</span>
</div>

<div class="dld-persona-card" data-persona="future" role="button" tabindex="0" aria-pressed="false">
<span class="dld-persona-card-check" aria-hidden="true">&check;</span>
<div class="dld-persona-card-header">
<span class="dld-persona-icon">🧑🏻</span>
<span class="dld-persona-title">Future you</span>
</div>
<span class="dld-persona-text">

It's eighteen months from now. A reviewer wants to know exactly how
`participants_clean.tsv` was produced, or a labmate is picking up
`pilot-study-001` after you've moved to a new project, and you have exactly
one sentence of memory left about what changed and why. Everything in this
tutorial is what today-you does so future-you doesn't have to guess.

</span>
</div>

</div>

<p class="dld-persona-hint" id="dldPersonaHint">Pick one — chapters ahead will speak to it.</p>

<div class="dld-chapter-grid">
  <a class="dld-chapter-card" href="00-create-first-project.html">
    <span class="dld-chapter-icon">0</span>
    <span class="dld-chapter-title">Create Your First Project</span>
    <span class="dld-chapter-outcome">A DataLad-tracked project with a first checkpoint</span>
    <span class="dld-chapter-time">~15-25 min</span>
  </a>
  <a class="dld-chapter-card" href="01-first-checkpoint.html">
    <span class="dld-chapter-icon">1</span>
    <span class="dld-chapter-title">First Checkpoint</span>
    <span class="dld-chapter-outcome">A clean, well-scoped Save with a message future-you can trust</span>
    <span class="dld-chapter-time">~20-30 min</span>
  </a>
  <a class="dld-chapter-card" href="02-cleaning-metadata.html">
    <span class="dld-chapter-icon">2</span>
    <span class="dld-chapter-title">Cleaning Metadata</span>
    <span class="dld-chapter-outcome">Data edits and analysis edits kept in separate, traceable checkpoints</span>
    <span class="dld-chapter-time">~30-40 min</span>
  </a>
  <a class="dld-chapter-card" href="03-team-feature-branches.html">
    <span class="dld-chapter-icon">3</span>
    <span class="dld-chapter-title">Team Feature Branches</span>
    <span class="dld-chapter-outcome">Three isolated feature branches merged cleanly into main</span>
    <span class="dld-chapter-time">~45-60 min</span>
  </a>
  <a class="dld-chapter-card" href="04-multimodal-project.html">
    <span class="dld-chapter-icon">4</span>
    <span class="dld-chapter-title">Multimodal Project Integration</span>
    <span class="dld-chapter-outcome">Imaging, clinical, and survey branches integrated into one checkpoint</span>
    <span class="dld-chapter-time">~60-75 min</span>
  </a>
  <a class="dld-chapter-card" href="05-longitudinal-multisite.html">
    <span class="dld-chapter-icon">5</span>
    <span class="dld-chapter-title">Longitudinal Multi-Site Operations</span>
    <span class="dld-chapter-outcome">Two sites, two waves, one traceable integration history</span>
    <span class="dld-chapter-time">~75-90 min</span>
  </a>
  <a class="dld-chapter-card" href="06-publication-freeze-release.html">
    <span class="dld-chapter-icon">6</span>
    <span class="dld-chapter-title">Publication Freeze &amp; Hotfix</span>
    <span class="dld-chapter-outcome">A frozen release branch with a traceable post-freeze correction</span>
    <span class="dld-chapter-time">~60-80 min</span>
  </a>
</div>

## Prerequisites

- DataLad Desktop installed and launchable — see the [Installation](../../README.md#download--install) instructions if you haven't done this yet.
- No prior DataLad or Git knowledge assumed — chapters explain checkpoints,
  branches, and remotes in plain language as they come up.

## Running this with a group?

Chapters 0-2 work well as a half-day beginner session; 3-6 (branches
onward) suit a second, intermediate/advanced session. Each chapter's
"Check yourself" section doubles as a facilitator debrief prompt if you're
running this live rather than solo.

## Reference: standard branch model used from Chapter 3 onward

- `main` — stable shared line.
- `feature/*` — isolated scientific tasks.
- `integration/*` — branch that combines parallel work before release.
- `release/*` — frozen state used for manuscript or external delivery.
- `hotfix/*` — urgent correction merged back into release and main.

## What's next

- [Roadmap](../roadmap.md)
- [Researcher workflow & UX rules](../product/researcher-workflow.md)
```

- [ ] **Step 2: Build and verify**

```bash
source /tmp/rtd-venv/bin/activate
sphinx-build -b html docs /tmp/rtd-build-check 2>&1 | grep -iE "warning|error" || echo "CLEAN"
```

Expected: no new warnings beyond the pre-existing baseline (chapter links will warn "document not included in toctree" only if `docs/index.md`'s toctree hasn't picked up the renamed structure — it already references `tutorials/README` and each chapter file by existing name, so this should stay clean).

- [ ] **Step 3: Commit**

```bash
git add docs/tutorials/README.md
git commit -m "docs(tutorials): rewrite landing page with persona picker and chapter grid"
```

---

### Task 3: Rewrite Chapter 00 — Create Your First Project

**Files:**
- Modify: `docs/tutorials/00-create-first-project.md` (full rewrite)

**Interfaces:**
- Consumes: persona note contract from Task 1; UI element IDs `check-env` (Check Setup), `pick-create-project-path` / `create-project` (Create Project panel), `save-project` (Save action).
- Produces: screenshot filenames referenced by Task 10: `datalad-desktop-check-setup-light.png`, `datalad-desktop-check-setup-dark.png`, `datalad-desktop-create-project-light.png`, `datalad-desktop-create-project-dark.png`, `datalad-desktop-first-save-light.png`, `datalad-desktop-first-save-dark.png`, `datalad-desktop-empty-folder-warning-light.png`.

- [ ] **Step 1: Replace the full content of `docs/tutorials/00-create-first-project.md`**

```markdown
# Chapter 0: Create Your First Project

You're starting a brand-new scientific project and want a safe, reproducible
foundation before any data cleaning or analysis happens. This chapter takes
you from an empty folder to a DataLad-tracked project with its first
checkpoint saved.

**Time:** 15-25 minutes.

## What you'll need

- DataLad Desktop installed and launchable.
- A path for a new, empty folder — for example `~/projects/pilot-study-001`.
  It must not already contain files: DataLad initializes version-control
  structure in the target folder, and if it already has content, DataLad
  can't safely tell which files belong to the new project's baseline.
- One short project note ready to write once the project exists — a
  one-sentence study purpose, and who owns it.

<div data-persona-note>
<p data-persona-empty hidden>Pick a persona on the <a href="README.html">tutorial landing page</a> and this note will speak directly to you.</p>
<div class="dld-persona-note-content" data-persona="student">

This is the habit that pays off later: starting version control on day one,
before there's anything worth losing, instead of retrofitting it after a
scare.

</div>
<div class="dld-persona-note-content" data-persona="pi">

This is the step you now require of everyone in your lab before they touch
data — five minutes now instead of a Dropbox-folder disaster in two years.

</div>
<div class="dld-persona-note-content" data-persona="future">

Eighteen months from now, this is the moment you'll be glad you didn't skip:
the first checkpoint is the anchor everything else in this project's
history hangs off.

</div>
</div>

## Walkthrough

1. Launch DataLad Desktop. In the app header, click **Check Setup**.

   ![Check Setup panel showing Python 3, DataLad, and git-annex status](../_static/screenshots/datalad-desktop-check-setup-light.png)

2. Confirm Python 3, DataLad, and git-annex all report **OK**. If something's
   missing, the panel names exactly what and links to the fix — resolve that
   before continuing.
3. In **Create Project**, use the folder picker to choose your new, empty
   project path (e.g. `~/projects/pilot-study-001`).

   ![Create Project panel with a project path selected](../_static/screenshots/datalad-desktop-create-project-light.png)

4. Click **Create Project**.
5. Verify the project opens and its classification badge reads **Dataset**
   or **Superdataset** (not plain **Git**) — that confirms DataLad tracking
   is active, not just a plain Git repo.
6. Outside the app, add one line to the project's `README.md` describing the
   pilot's aim (e.g. "Pilot study on X, PI: <name>, started <date>").
7. Return to DataLad Desktop. The changed-file list picks up the edit
   automatically — no manual refresh needed.
8. Save the checkpoint with the message:

   ```text
   init: create project skeleton and first note
   ```

   ![First Save with a commit message entered](../_static/screenshots/datalad-desktop-first-save-light.png)

## If something goes wrong

**Tried Create Project on a non-empty folder?** DataLad Desktop warns before
it lets this happen — read the warning, cancel, and pick (or make) an empty
folder instead. If you want to see exactly what the warning says, try it
once on purpose:

![Warning dialog when creating a project in a non-empty folder](../_static/screenshots/datalad-desktop-empty-folder-warning-light.png)

Recover by choosing an empty folder and repeating project creation — nothing
from the failed attempt carries over.

## Check yourself

- [ ] Check Setup shows all required tools available.
- [ ] Project creation succeeded and the classification badge reads Dataset
      or Superdataset.
- [ ] A first Save checkpoint exists with a clear, intent-describing message.

## What's next

[Chapter 1: First Checkpoint](01-first-checkpoint.html) — go deeper on
reading the working-tree view and writing Save messages that hold up over
time.
```

- [ ] **Step 2: Build and verify**

```bash
source /tmp/rtd-venv/bin/activate
sphinx-build -b html docs /tmp/rtd-build-check 2>&1 | grep -iE "warning|error" || echo "CLEAN"
```

Expected: `CLEAN` (image warnings are expected and fine until Task 10 populates `docs/_static/screenshots/` — Sphinx doesn't error on missing image files, it only warns if `nitpicky` mode is on, which it isn't here).

- [ ] **Step 3: Commit**

```bash
git add docs/tutorials/00-create-first-project.md
git commit -m "docs(tutorials): rewrite chapter 0 as self-paced with persona notes"
```

---

### Task 4: Rewrite Chapter 01 — First Checkpoint

**Files:**
- Modify: `docs/tutorials/01-first-checkpoint.md` (full rewrite)

**Interfaces:**
- Consumes: persona note contract from Task 1; UI element IDs `changed-files-select-all`/`changed-files-select-none`, `save-project`, `save-checkpoint-panel`, `save-guidance`, `recent-commits-output`, `last-commit-meta`.
- Produces: screenshots `datalad-desktop-working-tree-light.png`, `datalad-desktop-file-selection-light.png`, `datalad-desktop-save-message-light.png`, `datalad-desktop-recent-commits-light.png`, `datalad-desktop-scratch-file-warning-light.png`.

- [ ] **Step 1: Replace the full content of `docs/tutorials/01-first-checkpoint.md`**

```markdown
# Chapter 1: First Checkpoint

Continuing `pilot-study-001` from Chapter 0: you now have real files with
real changes to inspect and save — the working-tree view, file selection,
and the discipline of a Save message that means something six months from
now.

**Time:** 20-30 minutes.

## What you'll need

- The project from [Chapter 0](00-create-first-project.html), open in
  DataLad Desktop.
- Inside the project folder, add:
  - `data/raw/participants.tsv`
  - `analysis/notebook.ipynb`
- Make two edits: add one line to `README.md` describing the pilot's aim (if
  you haven't already), and change one value in `participants.tsv`.
- Leave one scratch file untracked on purpose: `notes/todo.txt`.

<div data-persona-note>
<p data-persona-empty hidden>Pick a persona on the <a href="README.html">tutorial landing page</a> and this note will speak directly to you.</p>
<div class="dld-persona-note-content" data-persona="student">

This is where the habit actually forms: not every edit belongs in history,
and deciding that on purpose — instead of saving everything blindly — is
the whole skill.

</div>
<div class="dld-persona-note-content" data-persona="pi">

A Save message like "updates" tells you nothing a year from now. This
chapter is where you'd correct a student's first sloppy commit message, so
pay attention to what "good" looks like here.

</div>
<div class="dld-persona-note-content" data-persona="future">

`notes/todo.txt` should never make it into scientific history — you won't
remember what half your scratch notes meant, and neither will anyone
reviewing this project later.

</div>
</div>

## Walkthrough

1. Open the project in DataLad Desktop. Confirm the classification badge
   (Git, Dataset, or Superdataset) still matches what you saw in Chapter 0.
2. Review the working-tree view: changed, staged, unstaged, and untracked
   files are all listed automatically as files change on disk — no manual
   refresh needed.

   ![Working-tree view listing changed and untracked files](../_static/screenshots/datalad-desktop-working-tree-light.png)

3. Select only the research-relevant files for Save: `README.md`,
   `data/raw/participants.tsv`. Use the file-selection checkboxes (or
   **select all** / **select none** as a starting point, then narrow down).

   ![File selection with scratch file left unchecked](../_static/screenshots/datalad-desktop-file-selection-light.png)

4. Leave `notes/todo.txt` unselected.
5. Write a Save message in this format:

   ```text
   pilot: update participant table and project summary
   ```

   ![Save message entry before committing the checkpoint](../_static/screenshots/datalad-desktop-save-message-light.png)

6. Click **Save**.
7. Re-check the working-tree status: the two selected files should now be
   clean, and `notes/todo.txt` should still show as untracked.
8. Glance at the recent-commit list to confirm your checkpoint landed with
   the message you expect.

   ![Recent commits list showing the new checkpoint](../_static/screenshots/datalad-desktop-recent-commits-light.png)

## If something goes wrong

**Accidentally included `notes/todo.txt` in a Save?** It happens — try it
once on purpose to see what recovery looks like:

![Warning or diff view showing an unintended scratch file included in Save](../_static/screenshots/datalad-desktop-scratch-file-warning-light.png)

Recover with a second, explicit Save that removes the scratch content from
tracked history, following your project's policy for what belongs in
history versus what doesn't. Don't try to silently undo the first
checkpoint — a visible correction is more auditable than an erased mistake.

## Check yourself

- [ ] You can explain why each file you saved belongs in the project's
      history.
- [ ] Save completed without any conflict warnings.
- [ ] The working-tree status matches what you expect: clean for saved
      files, untracked for `notes/todo.txt`.

## What's next

[Chapter 2: Cleaning Metadata](02-cleaning-metadata.html) — split data edits
from analysis edits into separate, traceable checkpoints.
```

- [ ] **Step 2: Build and verify**

```bash
source /tmp/rtd-venv/bin/activate
sphinx-build -b html docs /tmp/rtd-build-check 2>&1 | grep -iE "warning|error" || echo "CLEAN"
```

Expected: `CLEAN`.

- [ ] **Step 3: Commit**

```bash
git add docs/tutorials/01-first-checkpoint.md
git commit -m "docs(tutorials): rewrite chapter 1 as self-paced with persona notes"
```

---

### Task 5: Rewrite Chapter 02 — Cleaning Metadata

**Files:**
- Modify: `docs/tutorials/02-cleaning-metadata.md` (full rewrite)

**Interfaces:**
- Consumes: persona note contract from Task 1; UI element IDs `ignore-rules-add-os-junk`, `ignore-rules-apply`, `ignore-rules-scope-select-all`/`ignore-rules-scope-select-none`, `save-project`.
- Produces: screenshots `datalad-desktop-ignore-rules-light.png`, `datalad-desktop-scoped-save-1-light.png`, `datalad-desktop-scoped-save-2-light.png`, `datalad-desktop-mixed-checkpoint-warning-light.png`.

- [ ] **Step 1: Replace the full content of `docs/tutorials/02-cleaning-metadata.md`**

```markdown
# Chapter 2: Cleaning Metadata

Continuing `pilot-study-001`: you're cleaning incoming tabular data and
updating metadata, and the goal is to keep data cleaning separate from
analysis edits — each with its own traceable checkpoint — while also
keeping OS junk files out of history entirely.

**Time:** 30-40 minutes.

## What you'll need

- The project from [Chapter 1](01-first-checkpoint.html), with these
  pending changes staged in your working folder (not yet saved):
  - `data/raw/participants.tsv` — fix a couple of missing values.
  - `data/clean/participants_clean.tsv` — a new cleaned table.
  - `metadata/data-dictionary.md` — variable descriptions.
  - `analysis/notebook.ipynb` — a small, unrelated exploratory edit.

<div data-persona-note>
<p data-persona-empty hidden>Pick a persona on the <a href="README.html">tutorial landing page</a> and this note will speak directly to you.</p>
<div class="dld-persona-note-content" data-persona="student">

Mixing "I cleaned the data" and "I explored a plot idea" into one commit
is an easy first mistake — this chapter is where you learn to catch
yourself doing it.

</div>
<div class="dld-persona-note-content" data-persona="pi">

Reviewers and collaborators read your checkpoint history like a lab
notebook. A messy one with cross-topic commits is exactly the kind of thing
that erodes trust in a dataset.

</div>
<div class="dld-persona-note-content" data-persona="future">

Separating cleaning from analysis means that when you need to answer "what
exactly changed in the cleaning step," you can point at one checkpoint —
not dig through a commit that also touched three unrelated things.

</div>
</div>

## Walkthrough

1. Open your project's per-project ignore rules. Click **Add common OS junk
   patterns** to pick up `.DS_Store`, `Thumbs.db`, and similar noise files
   automatically.

   ![Ignore rules panel with OS junk patterns added](../_static/screenshots/datalad-desktop-ignore-rules-light.png)

2. Apply the ignore rules. Confirm OS junk files disappear from the
   working-tree view entirely (not just get deselected).
3. Review all pending changes in the working-tree view: the two data/
   metadata files and the one notebook edit should all show as changed.
4. Select only `data/raw/participants.tsv`, `data/clean/participants_clean.tsv`,
   and `metadata/data-dictionary.md` — leave the notebook edit unselected.
5. Save this checkpoint with the message:

   ```text
   cleaning: normalize participant table and update dictionary
   ```

   ![First scoped Save containing only data and metadata edits](../_static/screenshots/datalad-desktop-scoped-save-1-light.png)

6. Verify the notebook change is still pending (unsaved) in the working-tree
   view.
7. Select `analysis/notebook.ipynb` and save a second checkpoint:

   ```text
   analysis: exploratory cell update after cleaning
   ```

   ![Second scoped Save containing only the notebook edit](../_static/screenshots/datalad-desktop-scoped-save-2-light.png)

8. Confirm both checkpoints exist in the recent-commit list, each with a
   message that names exactly what it contains.

## If something goes wrong

**Accidentally mixed the notebook edit into the cleaning checkpoint?** Try
it once on purpose:

![Save confirmation showing an unintended cross-topic file included](../_static/screenshots/datalad-desktop-mixed-checkpoint-warning-light.png)

Recover by documenting, in your next checkpoint's message, why the mix
happened and what it cost you in reviewability — then redo the split with
additional Save checkpoints going forward. There's no clean way to
un-mix a checkpoint after the fact; the fix is discipline on the next one.

## Check yourself

- [ ] Data provenance and analysis provenance live in separate checkpoints.
- [ ] Each Save message clearly states its scientific intent.
- [ ] The working-tree status matches the file grouping you intended.

## What's next

[Chapter 3: Team Feature Branches](03-team-feature-branches.html) — this is
where multiple people (or multiple parallel tasks) start working on
`pilot-study-001` at once, and where you'll meet Power User Mode for the
first time.
```

- [ ] **Step 2: Build and verify**

```bash
source /tmp/rtd-venv/bin/activate
sphinx-build -b html docs /tmp/rtd-build-check 2>&1 | grep -iE "warning|error" || echo "CLEAN"
```

Expected: `CLEAN`.

- [ ] **Step 3: Commit**

```bash
git add docs/tutorials/02-cleaning-metadata.md
git commit -m "docs(tutorials): rewrite chapter 2 as self-paced with persona notes"
```

---

### Task 6: Rewrite Chapter 03 — Team Feature Branches

**Files:**
- Modify: `docs/tutorials/03-team-feature-branches.md` (full rewrite)

**Interfaces:**
- Consumes: persona note contract from Task 1; UI element IDs `create-branch`, `new-branch-name`, `switch-branch`, `branch-select`, `branch-status`, `refresh-branches`, `console-run`, `project-nav-tile-console`.
- Produces: screenshots `datalad-desktop-create-branch-light.png`, `datalad-desktop-branch-switch-light.png`, `datalad-desktop-power-user-toggle-light.png`, `datalad-desktop-console-merge-light.png`, `datalad-desktop-merge-conflict-light.png`.
- Produces (narrative): this is the chapter every later chapter (04-06) points back to for "how to enable Power User Mode" — don't re-explain the toggle in 04-06, just link back here.

- [ ] **Step 1: Replace the full content of `docs/tutorials/03-team-feature-branches.md`**

```markdown
# Chapter 3: Team Feature Branches

Three people (or three parallel tasks) work on `pilot-study-001` at once:
preprocessing, statistics, and figures. The goal is to keep each task
isolated on its own branch and integrate without stepping on each other's
work — and this is also where you'll meet **Power User Mode**, because
DataLad Desktop's guided UI covers branch creation and switching, but not
merging.

**Time:** 45-60 minutes.

## What you'll need

- The project from [Chapter 2](02-cleaning-metadata.html).
- Three branches created from `main`: `feature/preprocessing`,
  `feature/statistics`, `feature/figures`.
- One file per branch to keep responsibilities clear:
  `scripts/preprocess.py` (preprocessing), `analysis/stats.R` (statistics),
  `figures/plot.ipynb` (figures).
- One shared file likely to conflict: `README.md`.

<div data-persona-note>
<p data-persona-empty hidden>Pick a persona on the <a href="README.html">tutorial landing page</a> and this note will speak directly to you.</p>
<div class="dld-persona-note-content" data-persona="student">

Power User Mode looks intimidating the first time — it's a real terminal
with no safety net. That's fine. You're using it for exactly one job
(merging), on a project you can afford to get wrong while you're still
learning.

</div>
<div class="dld-persona-note-content" data-persona="pi">

This is the one place in the app where you'd want to sit next to a student
the first time — not because it's dangerous to the project (merges are
recoverable), but because an unguarded console is a different mental mode
than the rest of the app.

</div>
<div class="dld-persona-note-content" data-persona="future">

Three isolated branches, cleanly merged, means future-you (or a
collaborator) can look at the history and see exactly which checkpoint
introduced preprocessing changes versus statistics versus figures — instead
of one tangled mess.

</div>
</div>

## Walkthrough

1. In **Project Setup**, create `feature/preprocessing` from `main`.

   ![Create Branch panel with a new feature branch name entered](../_static/screenshots/datalad-desktop-create-branch-light.png)

2. Switch to `feature/preprocessing` and Save your preprocessing edits.
3. Switch to `feature/statistics` (create it first if you haven't) and Save
   your statistics edits.

   ![Branch switcher showing the active branch](../_static/screenshots/datalad-desktop-branch-switch-light.png)

4. Switch to `feature/figures` (create it first if you haven't) and Save
   your figure edits.
5. Now you need to merge three branches into `main` — DataLad Desktop's
   guided UI doesn't have a Merge button, so this is where **Power User
   Mode** comes in. Enable it via the toggle in Settings.

   ![Power User Mode toggle in Settings](../_static/screenshots/datalad-desktop-power-user-toggle-light.png)

   This gives you a real command console scoped to your project's folder —
   whatever you type runs with no allowlist or GUI guardrail. That's the
   trade: full Git power, zero training wheels. Use it for this one job and
   step back out when you're done.

6. In the console, switch to `main` (if the app's branch switcher doesn't
   already have you there) and run:

   ```bash
   git merge feature/preprocessing
   ```

   ![Power User console running a merge command](../_static/screenshots/datalad-desktop-console-merge-light.png)

7. Repeat for `feature/statistics`:

   ```bash
   git merge feature/statistics
   ```

8. Repeat for `feature/figures`:

   ```bash
   git merge feature/figures
   ```

9. Switch back to the guided UI and confirm `main`'s status is clean and
   contains all three sets of changes.

## If something goes wrong

**Two branches edited the same line in `README.md`?** That's a merge
conflict, and it's the most common thing you'll hit here. Try it once on
purpose: edit the same `README.md` line differently on two feature
branches before merging both.

![Merge conflict shown in the console output](../_static/screenshots/datalad-desktop-merge-conflict-light.png)

Recover by opening the conflicted file, choosing the scientifically correct
wording (not just picking one side blindly), removing Git's conflict
markers, then:

```bash
git add README.md
git commit
```

Switch back to the guided UI afterward — DataLad Desktop's branch actions
are blocked while a conflict is unresolved, so you'll see that reflected
until the commit above completes.

## Check yourself

- [ ] Each branch had a clear, single responsibility.
- [ ] `main` ended up clean, with no unresolved conflicts.
- [ ] You can explain why parallel branches reduced coordination risk
      compared to everyone editing `main` directly.

## What's next

[Chapter 4: Multimodal Project Integration](04-multimodal-project.html) —
apply the same branch-and-merge discipline to a project combining imaging,
clinical, and survey data.
```

- [ ] **Step 2: Build and verify**

```bash
source /tmp/rtd-venv/bin/activate
sphinx-build -b html docs /tmp/rtd-build-check 2>&1 | grep -iE "warning|error" || echo "CLEAN"
```

Expected: `CLEAN`.

- [ ] **Step 3: Commit**

```bash
git add docs/tutorials/03-team-feature-branches.md
git commit -m "docs(tutorials): rewrite chapter 3 as self-paced, introduce Power User Mode for merges"
```

---

### Task 7: Rewrite Chapter 04 — Multimodal Project Integration

**Files:**
- Modify: `docs/tutorials/04-multimodal-project.md` (full rewrite)

**Interfaces:**
- Consumes: persona note contract from Task 1; Power User Mode merge pattern established in Task 6 (link back, don't re-explain the toggle); UI element IDs `refresh-datasets`, `get-data`, `save-project`, `publish-project`.
- Produces: screenshots `datalad-desktop-nested-datasets-light.png`, `datalad-desktop-get-data-light.png`, `datalad-desktop-integration-save-light.png`, `datalad-desktop-mismatched-id-light.png`.

- [ ] **Step 1: Replace the full content of `docs/tutorials/04-multimodal-project.md`**

```markdown
# Chapter 4: Multimodal Project Integration

A study combining imaging, clinical, and survey data. Work is split by
modality across branches, then integrated for a unified analysis
checkpoint — and because some modalities include large files, you'll also
use **Get Data** to fetch content that isn't downloaded locally yet.

**Time:** 60-75 minutes.

## What you'll need

- The project from [Chapter 3](03-team-feature-branches.html), with
  branches `feature/imaging-qc`, `feature/clinical-harmonization`,
  `feature/survey-scoring`, and `integration/multimodal-v1` created from
  `main`.
- Power User Mode already enabled (see
  [Chapter 3](03-team-feature-branches.html#walkthrough) if you turned it
  off).
- Representative files per branch: `imaging/qc/report.md`,
  `clinical/harmonized/cohort.csv`, `survey/scored/responses.csv`, and
  `analysis/integration-notes.md` on the integration branch.

<div data-persona-note>
<p data-persona-empty hidden>Pick a persona on the <a href="README.html">tutorial landing page</a> and this note will speak directly to you.</p>
<div class="dld-persona-note-content" data-persona="student">

Nested datasets can feel abstract until you actually watch a modality's
data appear on disk only when you ask for it with Get Data — that's the
moment it clicks why this matters for large files.

</div>
<div class="dld-persona-note-content" data-persona="pi">

A mismatched subject ID across modalities is exactly the kind of silent
error that ruins an analysis three weeks later. Catching it at integration
time, with a recorded fix, is the entire point of this chapter.

</div>
<div class="dld-persona-note-content" data-persona="future">

When someone asks "which checkpoint is where imaging, clinical, and survey
data first lined up correctly," you want a one-word answer: this
integration checkpoint, right here.

</div>
</div>

## Walkthrough

1. Open the project and confirm you can see each modality's nested
   structure in the dataset view — imaging, clinical, and survey each
   behave as their own tracked sub-dataset.

   ![Nested sub-dataset structure in the project view](../_static/screenshots/datalad-desktop-nested-datasets-light.png)

2. If any modality shows content that isn't materialized locally yet
   (common for large imaging files), click **Get Data** to fetch it before
   working with it.

   ![Get Data action fetching content for a modality](../_static/screenshots/datalad-desktop-get-data-light.png)

3. On `feature/imaging-qc`, Save the QC report.
4. On `feature/clinical-harmonization`, Save the harmonized cohort file.
5. On `feature/survey-scoring`, Save the scored responses file.
6. Switch to `integration/multimodal-v1`. In the Power User Mode console
   (see [Chapter 3](03-team-feature-branches.html#walkthrough) if you need
   a refresher), merge all three:

   ```bash
   git merge feature/imaging-qc
   git merge feature/clinical-harmonization
   git merge feature/survey-scoring
   ```

7. Switch back to the guided UI and review the working-tree status for any
   changes you didn't expect.
8. Add `analysis/integration-notes.md` explaining your alignment
   assumptions (e.g. which subject ID scheme each modality uses and how
   they map to each other).
9. Save the integration checkpoint:

   ```text
   integration: combine imaging clinical survey v1
   ```

   ![Integration checkpoint Save with a descriptive message](../_static/screenshots/datalad-desktop-integration-save-light.png)

10. Click **Publish** to push the integration branch to your shared remote.

## If something goes wrong

**One modality has a mismatched subject identifier** (e.g. `sub-01` in
imaging but `subj_1` in clinical)? Introduce one on purpose to see what
catching it looks like:

![A mismatched identifier surfaced during integration review](../_static/screenshots/datalad-desktop-mismatched-id-light.png)

Recover by correcting the identifier in the source modality's file (not by
papering over it in the integration notes), then record the fix and its
rationale in `analysis/integration-notes.md` before re-saving.

## Check yourself

- [ ] The integration branch contains all three modalities with no
      unexplained drift.
- [ ] Status was clean before Publish.
- [ ] You can point to the exact checkpoint where all three modalities
      first aligned.

## What's next

[Chapter 5: Longitudinal Multi-Site Study Operations](05-longitudinal-multisite.html)
— scale this same discipline across multiple sites and multiple waves of
incoming data.
```

- [ ] **Step 2: Build and verify**

```bash
source /tmp/rtd-venv/bin/activate
sphinx-build -b html docs /tmp/rtd-build-check 2>&1 | grep -iE "warning|error" || echo "CLEAN"
```

Expected: `CLEAN`.

- [ ] **Step 3: Commit**

```bash
git add docs/tutorials/04-multimodal-project.md
git commit -m "docs(tutorials): rewrite chapter 4 as self-paced with persona notes"
```

---

### Task 8: Rewrite Chapter 05 — Longitudinal Multi-Site Study Operations

**Files:**
- Modify: `docs/tutorials/05-longitudinal-multisite.md` (full rewrite)

**Interfaces:**
- Consumes: persona note contract from Task 1; Power User Mode merge pattern from Task 6; UI element IDs `update-project`, `publish-project`, `create-branch`, `switch-branch`.
- Produces: screenshots `datalad-desktop-update-project-light.png`, `datalad-desktop-site-branches-light.png`, `datalad-desktop-late-correction-light.png`.

- [ ] **Step 1: Replace the full content of `docs/tutorials/05-longitudinal-multisite.md`**

```markdown
# Chapter 5: Longitudinal Multi-Site Study Operations

A longitudinal study receives monthly updates from multiple sites. The goal
is to ingest new waves of data while preserving exactly which site
contributed what, and when — using **Update Project** to stay in sync with
collaborators' work on the shared remote.

**Time:** 75-90 minutes.

## What you'll need

- The project from [Chapter 4](04-multimodal-project.html).
- Power User Mode already enabled.
- Branch families: `site/a-wave-01`, `site/b-wave-01`, `site/a-wave-02`,
  `site/b-wave-02`, `integration/wave-01`, `integration/wave-02`.
- Site-specific incoming files: `incoming/site-a/wave-01.csv`,
  `incoming/site-b/wave-01.csv`, `incoming/site-a/wave-02.csv`,
  `incoming/site-b/wave-02.csv`.
- Keep `main` reserved for validated integration only — never Save directly
  to `main` in this chapter.

<div data-persona-note>
<p data-persona-empty hidden>Pick a persona on the <a href="README.html">tutorial landing page</a> and this note will speak directly to you.</p>
<div class="dld-persona-note-content" data-persona="student">

This is the first time the branch discipline from Chapter 3 has to hold up
under real pressure — multiple sites, multiple waves, and a `main` that has
to stay trustworthy the whole time.

</div>
<div class="dld-persona-note-content" data-persona="pi">

This is close to how a real multi-site study actually runs. If your lab
coordinates with external sites, this chapter is the template to adapt.

</div>
<div class="dld-persona-note-content" data-persona="future">

"When and where did Site B's wave 1 data enter history" should be a
one-checkpoint answer, even after a late correction complicates the
timeline.

</div>
</div>

## Walkthrough

1. Before each integration merge, click **Update Project** to pull the
   latest changes from the shared remote and reduce divergence from
   collaborators' work.

   ![Update Project action pulling changes from the shared remote](../_static/screenshots/datalad-desktop-update-project-light.png)

2. On `site/a-wave-01`, Save Site A's wave 1 data.
3. On `site/b-wave-01`, Save Site B's wave 1 data.

   ![Site-specific branches each holding one site's wave of data](../_static/screenshots/datalad-desktop-site-branches-light.png)

4. Switch to `integration/wave-01`. In the Power User Mode console, merge
   both:

   ```bash
   git merge site/a-wave-01
   git merge site/b-wave-01
   ```

5. Validate the integration (review status, confirm both sites' data is
   present and correctly attributed), then switch to `main` and merge
   `integration/wave-01`.
6. Repeat steps 2-5 for wave 2, using `site/a-wave-02`,
   `site/b-wave-02`, and `integration/wave-02`.
7. Click **Publish** only after each wave's integration has passed your
   review — not before.

## If something goes wrong

**A late correction arrives from Site B after wave 1 already merged into
`main`?** This happens in real longitudinal studies. Simulate it:

![A late site correction being applied and forward-merged](../_static/screenshots/datalad-desktop-late-correction-light.png)

Recover by applying the correction on `site/b-wave-01` (not on `main`
directly, and not by rewriting the already-merged history), then
forward-merging that fix into `integration/wave-02` with an explicit note
in your Save message explaining it's a retroactive correction to wave 1
data. `main`'s existing history stays untouched and honest about what was
known at each point in time.

## Check yourself

- [ ] Each wave has a complete trace from site branch to integration
      branch to `main`.
- [ ] `main` remained stable and reviewable at every point.
- [ ] You can answer exactly when and where each site's update entered
      history.

## What's next

[Chapter 6: Publication Freeze, Release, and Hotfix](06-publication-freeze-release.html)
— freeze this project for manuscript submission and handle a post-freeze
correction the traceable way.
```

- [ ] **Step 2: Build and verify**

```bash
source /tmp/rtd-venv/bin/activate
sphinx-build -b html docs /tmp/rtd-build-check 2>&1 | grep -iE "warning|error" || echo "CLEAN"
```

Expected: `CLEAN`.

- [ ] **Step 3: Commit**

```bash
git add docs/tutorials/05-longitudinal-multisite.md
git commit -m "docs(tutorials): rewrite chapter 5 as self-paced with persona notes"
```

---

### Task 9: Rewrite Chapter 06 — Publication Freeze, Release, and Hotfix

**Files:**
- Modify: `docs/tutorials/06-publication-freeze-release.md` (full rewrite)

**Interfaces:**
- Consumes: persona note contract from Task 1; Power User Mode merge pattern from Task 6; UI element IDs `create-branch`, `switch-branch`, `save-project`, `publish-project`, `tm-history-output`, `tm-detail`, `tm-branch-from-here`.
- Produces: screenshots `datalad-desktop-release-branch-light.png`, `datalad-desktop-time-machine-light.png`, `datalad-desktop-hotfix-save-light.png`, `datalad-desktop-hotfix-on-main-warning-light.png`.

- [ ] **Step 1: Replace the full content of `docs/tutorials/06-publication-freeze-release.md`**

```markdown
# Chapter 6: Publication Freeze, Release, and Hotfix

`pilot-study-001` is ready for manuscript submission. You need a frozen
release, clear provenance back to the exact checkpoint the results came
from, and a controlled, traceable path for urgent post-freeze corrections.

**Time:** 60-80 minutes.

## What you'll need

- A clean, validated `main` (the end state of
  [Chapter 5](05-longitudinal-multisite.html)).
- Power User Mode already enabled.
- Branches: `release/paper-v1`, `hotfix/paper-v1-erratum`.
- Release artifacts: `manuscript/results-summary.md`,
  `manuscript/methods.md`, `reproducibility/runbook.md`.

<div data-persona-note>
<p data-persona-empty hidden>Pick a persona on the <a href="README.html">tutorial landing page</a> and this note will speak directly to you.</p>
<div class="dld-persona-note-content" data-persona="student">

This is the payoff chapter: everything you've been doing since Chapter 0
exists so that this moment — freezing exactly what a paper's results are
based on — is trivial instead of a scramble.

</div>
<div class="dld-persona-note-content" data-persona="pi">

A release branch with a reproducibility runbook is what you'd want to be
able to hand a reviewer, or a new lab member three years from now, with no
extra explanation needed.

</div>
<div class="dld-persona-note-content" data-persona="future">

This is the chapter where you use the Time Machine view to actually point
at the checkpoint your submitted results came from — not just claim you
could find it.

</div>
</div>

## Walkthrough

1. From a clean, validated `main`, create `release/paper-v1`.

   ![Release branch created from main](../_static/screenshots/datalad-desktop-release-branch-light.png)

2. Run a final review of project status and every changed file before
   freezing anything.
3. Save the release metadata update:

   ```text
   release: freeze paper-v1 with reproducibility runbook
   ```

4. Click **Publish** on `release/paper-v1`.
5. Open the **Time Machine** history view and confirm you can identify the
   exact checkpoint this release represents — this is the checkpoint you'd
   cite if asked "what exactly did the submitted results come from."

   ![Time Machine view showing project history with the release checkpoint](../_static/screenshots/datalad-desktop-time-machine-light.png)

6. Now simulate discovering a small numeric typo in
   `manuscript/results-summary.md` after submission. Create
   `hotfix/paper-v1-erratum` from the **release** branch (not from `main`).
7. Apply the typo fix and Save:

   ```text
   hotfix: correct table value in results summary
   ```

   ![Hotfix Save on the erratum branch](../_static/screenshots/datalad-desktop-hotfix-save-light.png)

8. In the Power User Mode console, merge the hotfix into the release
   branch, then merge the release branch into `main`:

   ```bash
   git checkout release/paper-v1
   git merge hotfix/paper-v1-erratum
   git checkout main
   git merge release/paper-v1
   ```

9. Switch back to the guided UI and click **Publish** on both updated
   branches.

## If something goes wrong

**Applied the hotfix directly on `main` first, instead of through
`hotfix/paper-v1-erratum`?** Try it once on purpose to see why this
matters:

![Warning or inconsistent state from applying a hotfix directly on main](../_static/screenshots/datalad-desktop-hotfix-on-main-warning-light.png)

Recover by reverting the direct `main` edit, then re-applying the same fix
properly through `hotfix/paper-v1-erratum` as in the walkthrough above.
Release-first fixes exist so there's one auditable path from "typo found"
to "typo fixed everywhere it needs to be" — a direct edit on `main` breaks
that trail even if the end result looks the same.

## Check yourself

- [ ] The release branch represents a defensible, frozen snapshot of the
      paper's results.
- [ ] The hotfix path is traceable and merged back without divergence
      between `release/paper-v1` and `main`.
- [ ] You can explain, and point to in the Time Machine view, exactly which
      checkpoint underlies the submitted results.

## What's next

You've completed the full DataLad Desktop skill progression, from an empty
folder to a citable, correctable published release. From here:

- [Roadmap](../roadmap.md) — what's planned next for the app.
- [Researcher workflow & UX rules](../product/researcher-workflow.md) — the
  product principles behind the guided actions you've been using.
```

- [ ] **Step 2: Build and verify**

```bash
source /tmp/rtd-venv/bin/activate
sphinx-build -b html docs /tmp/rtd-build-check 2>&1 | grep -iE "warning|error" || echo "CLEAN"
```

Expected: `CLEAN`.

- [ ] **Step 3: Commit**

```bash
git add docs/tutorials/06-publication-freeze-release.md
git commit -m "docs(tutorials): rewrite chapter 6 as self-paced with persona notes"
```

---

### Task 10: Screenshot capture pass

**Files:**
- Create: `docs/_static/screenshots/*.png` (all filenames referenced by Tasks 3-9 — 28 light-mode screenshots total; dark-mode variants are stretch, capture if the app's theme toggle makes it quick, otherwise light-only is acceptable per spec's "where the app's theme toggle affects the screen" qualifier)

**Interfaces:**
- Consumes: every screenshot filename listed in the "Produces" line of Tasks 3-9 — the full list to capture.

- [ ] **Step 1: Launch the app for screenshot capture**

Use the project's `run` skill to launch a real Electron window (not
Node-mode — mind the `ELECTRON_RUN_AS_NODE` environment variable, which
must be unset for a real GUI launch, per this repo's known CI/launch
gotcha).

- [ ] **Step 2: Set up a scratch project for screenshots**

Create a throwaway project at a temp path (e.g.
`/tmp/pilot-study-001-screenshots`) and walk it through Chapters 0-2's
setup steps so the app is in a realistic state (a few files, one checkpoint
saved) before capturing Chapter 0/1/2 screens. For Chapters 3-6, create the
branches named in each chapter's "What you'll need" section as you go.

- [ ] **Step 3: Capture each screenshot**

For each filename listed in Tasks 3-9's "Produces" line, navigate the app
to the matching state and capture the screen, saving directly to
`docs/_static/screenshots/<exact-filename-from-the-task>.png`. Match the
exact filenames — the chapter markdown already references them verbatim.

- [ ] **Step 4: Build and verify no missing images**

```bash
source /tmp/rtd-venv/bin/activate
sphinx-build -b html docs /tmp/rtd-build-check 2>&1 | grep -i "image file not readable" | tee /tmp/missing-images.txt
test ! -s /tmp/missing-images.txt && echo "ALL IMAGES PRESENT"
```

Expected: `ALL IMAGES PRESENT` (empty `missing-images.txt` means every
`![...](...)` reference in the 7 chapters resolved to a real file).

- [ ] **Step 5: Commit**

```bash
git add docs/_static/screenshots/
git commit -m "docs(tutorials): add screenshot pass for all seven chapters"
```

---

### Task 11: Release-workflow wiring (RTD build trigger + versioned docs link)

**Files:**
- Modify: `.github/workflows/build-os-artifacts.yml:185-195` (the `publish-release` job's release-creation step)

**Interfaces:**
- Consumes: `RTD_API_TOKEN` / `RTD_PROJECT_SLUG` GitHub repo secrets (already added, per the RTD scaffolding verification earlier).

- [ ] **Step 1: Add a "Compose release body" step before the existing release-creation step**

In `.github/workflows/build-os-artifacts.yml`, insert this new step
immediately before the existing `- name: Create GitHub Release and upload assets` step (currently at line 185):

```yaml
      - name: Compose release body with docs link
        run: |
          printf '%s\n\n' "📖 **Docs for this version:** https://datalad-desktop.readthedocs.io/en/${GITHUB_REF_NAME}/" > release_body.md

      - name: Trigger ReadTheDocs build
        env:
          RTD_API_TOKEN: ${{ secrets.RTD_API_TOKEN }}
          RTD_PROJECT_SLUG: ${{ secrets.RTD_PROJECT_SLUG }}
        run: |
          curl --fail --show-error --silent -X POST \
            -H "Authorization: Token ${RTD_API_TOKEN}" \
            "https://readthedocs.org/api/v3/projects/${RTD_PROJECT_SLUG}/versions/stable/builds/"
          curl --fail --show-error --silent -X POST \
            -H "Authorization: Token ${RTD_API_TOKEN}" \
            "https://readthedocs.org/api/v3/projects/${RTD_PROJECT_SLUG}/versions/latest/builds/"
```

- [ ] **Step 2: Update the existing release-creation step to use the composed body**

Modify the existing step (originally at line 185-195) to add `body_path`
alongside the existing `generate_release_notes: true`:

```yaml
      - name: Create GitHub Release and upload assets
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
          body_path: release_body.md
          files: |
            release-assets/**/*.dmg
            release-assets/**/*.zip
            release-assets/**/*.exe
            release-assets/**/*.blockmap
            release-assets/**/*.AppImage
            release-assets/**/*.yml
```

- [ ] **Step 3: Verify the body-composition logic locally (the only part testable without cutting a real tag)**

```bash
GITHUB_REF_NAME="v0.3.1" bash -c 'printf "%s\n\n" "📖 **Docs for this version:** https://datalad-desktop.readthedocs.io/en/${GITHUB_REF_NAME}/" > /tmp/release_body_test.md && cat /tmp/release_body_test.md'
```

Expected output: `📖 **Docs for this version:** https://datalad-desktop.readthedocs.io/en/v0.3.1/`

- [ ] **Step 4: Validate the workflow YAML syntax**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/build-os-artifacts.yml'))" && echo "YAML VALID"
```

Expected: `YAML VALID`.

- [ ] **Step 5: Note the real end-to-end check for next release**

This step's actual behavior (whether `action-gh-release` combines a custom
`body_path` with `generate_release_notes: true` by prepending, appending,
or overriding) can only be confirmed on the next real tag push — same
caveat already noted in the design spec. After the next release, run
`gh release view <tag>` and confirm the docs link appears in the body
alongside the auto-generated notes; adjust if the combination behaves
unexpectedly.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/build-os-artifacts.yml
git commit -m "ci(release): trigger RTD build and add versioned docs link to release body"
```

---

### Task 12: Final QA pass

**Files:**
- Modify: `.readthedocs.yaml` (flip `fail_on_warning`)

**Interfaces:**
- Consumes: all content from Tasks 1-10.

- [ ] **Step 1: Run a full clean build with warnings-as-errors locally first**

```bash
source /tmp/rtd-venv/bin/activate
sphinx-build -b html -W docs /tmp/rtd-build-final 2>&1 | tail -40
```

Fix any warning surfaced (broken cross-reference, orphaned document not in
a toctree, malformed MyST syntax) before proceeding — do not flip the
`.readthedocs.yaml` flag until this command exits 0.

- [ ] **Step 2: Link check**

```bash
source /tmp/rtd-venv/bin/activate
sphinx-build -b linkcheck docs /tmp/rtd-linkcheck 2>&1 | tail -40
cat /tmp/rtd-linkcheck/output.txt 2>/dev/null | grep -v "^.*: line.*ok$"
```

Review any non-"ok" line — broken external links (e.g. to
`datalad.org`) or unresolved internal cross-references. Fix internal ones;
note external ones that are outside this repo's control.

- [ ] **Step 3: Flip `fail_on_warning` to `true` in `.readthedocs.yaml`**

```yaml
sphinx:
  configuration: docs/conf.py
  fail_on_warning: true
```

- [ ] **Step 4: Commit and push**

```bash
git add .readthedocs.yaml
git commit -m "docs: enforce clean builds now that the tutorial rewrite is complete"
git push origin main
```

- [ ] **Step 5: Verify the pushed build succeeds on RTD**

Check `https://app.readthedocs.org/projects/datalad-desktop/builds/` for
the new build triggered by the push — confirm it completes green with
`fail_on_warning: true` now enforced, then confirm
`https://datalad-desktop.readthedocs.io/en/latest/` reflects the full
rewritten tutorial (landing page persona grid, all 7 chapters, screenshots
rendering).

---

## Self-Review Notes

- **Spec coverage:** persona mechanism (Task 1), landing page (Task 2), all
  7 chapters (Tasks 3-9), screenshot pass (Task 10), release-workflow
  wiring (Task 11), final QA/`fail_on_warning` flip (Task 12) — every
  section of the 2026-08-12 design spec has a corresponding task.
- **Merge-gap decision** (confirmed with user 2026-08-12, not in the
  original spec): Chapter 3 introduces Power User Mode as the path for
  merges, since no GUI merge action exists; Chapters 4-6 reuse that pattern
  by linking back rather than re-explaining it.
- **Type/interface consistency:** the `dldPersona` storage key, `.dld-*`
  CSS class names, and `[data-persona-note]` / `.dld-persona-note-content`
  DOM contract from Task 1 are used identically in Task 2 and all of Tasks
  3-9 — no naming drift between tasks.
