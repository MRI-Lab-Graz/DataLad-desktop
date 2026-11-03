# Repo rules

## Priorities (when they conflict, the lower number wins)

1. **Security.** Most important. Fail closed; no convenience that weakens the trust gate, validation or SECURITY.md.
2. **Usability.** Easy for students and scientists: plain words, few clicks, no jargon.
3. **Windows first.** The app is mainly used on Windows. Check Windows behaviour (paths, cmd.exe quoting, non-ASCII names, CI Windows job) before macOS/Linux.

## Workflow

- In every chat, start by using the `superpowers` skills (and `ponytail`, see below).
- **TDD, all the time, no exceptions:** red, green, refactor for every feature, bug fix, refactor and behaviour change. Write the failing test first and watch it fail for the right reason, then write the minimal code. No production code without a failing test first; a bug gets a reproducing test before its fix. Tests run with `npm test` (Node built-in runner).
- Before every merge (PR into `main`), always run the `ponytail:ponytail-audit` skill over the changes and handle or consciously decline its findings.
- Before every merge, also run the `security-review` skill (security is priority 1) and the `superpowers:verification-before-completion` skill: run the checks and read the CI results before saying anything is done or green.
