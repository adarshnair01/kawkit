#!/bin/bash
# Install the Kawkit worker as an always-on service on a Mac (run as the user that should own it):
#   cd worker && ./launchd/install.sh
# It stores the Supabase service key in the macOS Keychain, installs the pinned Python environment
# with uv, and registers a launchd agent that starts at login and restarts if it crashes.
set -euo pipefail

LABEL="online.adarshnair.kawkit-worker"
WORKER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/kawkit"
SUPABASE_URL="${KAWKIT_SUPABASE_URL:-https://cmjedgyaquekrtixmwbf.supabase.co}"
CONCURRENCY="${KAWKIT_CONCURRENCY:-2}"
CORES="${KAWKIT_CORES_PER_RUN:-4}"

if ! command -v uv >/dev/null 2>&1; then
  echo "Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi
UV="$(command -v uv)"

if ! security find-generic-password -s kawkit-worker -w >/dev/null 2>&1; then
  echo "Paste the Supabase secret key (Project Settings > API keys > secret key). It is stored only in your Keychain."
  read -r -s -p "Secret key: " KEY
  echo
  security add-generic-password -U -a "$USER" -s kawkit-worker -w "$KEY"
  unset KEY
fi

echo "Installing the Python environment..."
(cd "$WORKER_DIR" && "$UV" sync --locked --no-dev)

mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$WORKER_DIR/.venv/bin/python</string>
    <string>-m</string>
    <string>kawkit_worker.main</string>
  </array>
  <key>WorkingDirectory</key><string>$WORKER_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>KAWKIT_SUPABASE_URL</key><string>$SUPABASE_URL</string>
    <key>KAWKIT_CONCURRENCY</key><string>$CONCURRENCY</string>
    <key>KAWKIT_CORES_PER_RUN</key><string>$CORES</string>
    <key>KAWKIT_LOG_DIR</key><string>$LOG_DIR</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$LOG_DIR/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/launchd.err.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"
sleep 5
echo "Started. Recent log lines:"
tail -n 5 "$LOG_DIR/worker.jsonl" 2>/dev/null || tail -n 20 "$LOG_DIR/launchd.err.log" 2>/dev/null || true
echo
echo "Done. Update later with: git pull && ./launchd/restart.sh"
echo "For restarts after a power cut: System Settings > Energy > 'Start up automatically after a power failure',"
echo "and enable automatic login for this user so the agent starts without anyone at the keyboard."
