#!/usr/bin/env bash
# Apply a SQL file to the Supabase project through the management API.
# Usage: SUPABASE_ACCESS_TOKEN=sbp_... supabase/apply.sh supabase/migrations/0001_init.sql
set -euo pipefail
REF="${SUPABASE_PROJECT_REF:-cmjedgyaquekrtixmwbf}"
python3 -c 'import json,sys; print(json.dumps({"query": open(sys.argv[1]).read()}))' "$1" |
  curl -sS --fail-with-body -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-proxy-injected}" \
    -H 'Content-Type: application/json' --data-binary @-
echo
