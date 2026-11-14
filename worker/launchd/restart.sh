#!/bin/bash
# After `git pull`: refresh the environment and restart the service.
set -euo pipefail
cd "$(dirname "$0")/.."
uv sync --locked --no-dev
launchctl kickstart -k "gui/$(id -u)/online.adarshnair.kawkit-worker"
echo "Restarted."
