# Researcher Workflow (MVP)

## Primary user story

A researcher opens DataLad Desktop and selects one of their projects. They review changes, write a commit message, and commit work. Sometimes they create a branch. If file content is missing, they click **Get Data**. If they need remote updates, they click **Update Project**. When done, they click **Publish**.

## UX rules

1. Keep the product center on the project, not the filesystem.
2. Keep one active project at a time.
3. Preserve standard GitHub Desktop commit/history/branch workflows.
4. Show DataLad controls only for DataLad-enabled projects.
5. Keep Git-only projects uncluttered by DataLad-specific UI.
6. Keep language researcher-friendly; avoid annex/sibling internals unless required for recovery.

## Project classification in UI

Each active project should display one classification badge:

- **Git**
- **Dataset**
- **Superdataset**

## DataLad action surface in MVP

For DataLad-enabled projects, the compact action group should include:

- **Get Data**
- **Update Project**
- **Publish**

Clone/Install should live in onboarding and project-opening flow, not as a permanent toolbar action.
