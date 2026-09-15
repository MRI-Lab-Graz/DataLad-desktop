@echo off
rem Windows counterpart to ssh-askpass.sh — see setSshPassword() in process-runner.js.
rem Delayed expansion (!VAR!) substitutes after the line is parsed, so cmd's own
rem operators (& | < > ^ %) inside the password are printed literally instead of
rem being interpreted or (for %) double-expanded/truncated.
setlocal EnableDelayedExpansion
echo(!DATALAD_DESKTOP_SSH_PASSWORD!
