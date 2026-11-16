#!/usr/bin/env bash
# Deploy an Edge Function through the management API.
# Usage: SUPABASE_ACCESS_TOKEN=sbp_... supabase/deploy-function.sh economy
set -euo pipefail
REF="${SUPABASE_PROJECT_REF:-cmjedgyaquekrtixmwbf}"
SLUG="$1"
DIR="$(cd "$(dirname "$0")" && pwd)/functions/$SLUG"
curl -sS --fail-with-body -X POST "https://api.supabase.com/v1/projects/$REF/functions/deploy?slug=$SLUG" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN:-proxy-injected}" \
  -F "metadata={\"entrypoint_path\":\"index.ts\",\"name\":\"$SLUG\",\"verify_jwt\":true};type=application/json" \
  -F "file=@$DIR/index.ts;filename=index.ts;type=application/typescript"
echo
