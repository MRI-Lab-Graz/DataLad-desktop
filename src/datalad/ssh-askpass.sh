#!/bin/sh
# Invoked by ssh (via SSH_ASKPASS/SSH_ASKPASS_REQUIRE=force) instead of an
# interactive terminal prompt — see setSshPassword() in process-runner.js.
printf '%s' "$DATALAD_DESKTOP_SSH_PASSWORD"
