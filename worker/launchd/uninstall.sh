#!/bin/bash
# Stop the service and remove its Keychain entry.
set -euo pipefail
LABEL="online.adarshnair.kawkit-worker"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
security delete-generic-password -s kawkit-worker >/dev/null 2>&1 || true
echo "Removed."
