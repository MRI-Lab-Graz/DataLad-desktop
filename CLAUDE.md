# Repo rules

## Priorities (when they conflict, the lower number wins)

1. **Security.** Most important. Fail closed; no convenience that weakens the trust gate, validation or SECURITY.md.
2. **Usability.** Easy for students and scientists: plain words, few clicks, no jargon.
3. **Windows first.** The app is mainly used on Windows. Check Windows behaviour (paths, cmd.exe quoting, non-ASCII names, CI Windows job) before macOS/Linux.

## Workflow

- In every chat, start by using the `superpowers` skills (and `ponytail`, see below).
- Always use TDD (red, green, refactor) for every new feature and function: write the failing test first, then the implementation. Tests run with `npm test` (Node built-in runner).
- Before every merge (PR into `main`), always run the `ponytail:ponytail-audit` skill over the changes and handle or consciously decline its findings.
