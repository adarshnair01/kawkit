#!/bin/bash
# After `git pull`: refresh the environment and restart the service.
set -euo pipefail
cd "$(dirname "$0")/.."
uv sync --locked --no-dev
LABEL="online.adarshnair.kawkit-worker"
if ! launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo "The service is not registered; running the installer."
  exec ./launchd/install.sh
fi
launchctl kickstart -k "gui/$(id -u)/$LABEL"
echo "Restarted."
