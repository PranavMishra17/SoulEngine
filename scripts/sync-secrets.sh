#!/usr/bin/env bash
#
# Push the provider and Supabase values from a local .env into Google Secret
# Manager, grant the Cloud Run runtime account access to each, and mirror the
# two values the Supabase keep-alive workflow needs into GitHub.
#
# Usage, from the repository root:
#
#   bash scripts/sync-secrets.sh
#
# .env is gitignored and stays local. Only these four names are read; anything
# else in the file is ignored. ENCRYPTION_KEY and BROKER_TOKEN_SECRET are
# deliberately NOT in this list -- they are generated once, live only in Secret
# Manager, and must never be regenerated after the first deploy (see ERR-023).
#
# Values are written with all whitespace stripped. A trailing newline or, on
# Windows, a carriage return inside an API key fails authentication in a way
# that looks exactly like a wrong key.

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:-soulengine-484220}"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
ENV_FILE="${1:-.env}"

NAMES=(SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY GEMINI_API_KEY)

if [ ! -f "$ENV_FILE" ]; then
  echo "No $ENV_FILE found. Create it from .env.example and fill in the values." >&2
  exit 1
fi

# Read one KEY=VALUE from the env file. Splits on the FIRST '=' only, because
# base64 keys can contain '='. Strips surrounding quotes and all whitespace.
read_env() {
  local key="$1"
  sed -n "s/^[[:space:]]*${key}=//p" "$ENV_FILE" \
    | tail -1 \
    | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" \
    | tr -d '[:space:]'
}

echo "Project: $PROJECT_ID"
echo "Runtime service account: $RUNTIME_SA"
echo

missing=0
for NAME in "${NAMES[@]}"; do
  VALUE="$(read_env "$NAME")"

  if [ -z "$VALUE" ]; then
    echo "  $NAME: not set in $ENV_FILE -- skipped"
    missing=1
    continue
  fi

  gcloud secrets create "$NAME" --replication-policy=automatic --quiet >/dev/null 2>&1 || true
  printf '%s' "$VALUE" | gcloud secrets versions add "$NAME" --data-file=- >/dev/null
  gcloud secrets add-iam-policy-binding "$NAME" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor" --quiet >/dev/null 2>&1 || true

  echo "  $NAME: stored (${#VALUE} chars) and readable by the runtime account"
done

# The keep-alive workflow talks to Supabase directly and never touches Google,
# so it needs its own copy of these two.
if command -v gh >/dev/null 2>&1; then
  for NAME in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY; do
    VALUE="$(read_env "$NAME")"
    if [ -n "$VALUE" ]; then
      printf '%s' "$VALUE" | gh secret set "$NAME" >/dev/null
      echo "  $NAME: mirrored to GitHub for the keep-alive workflow"
    fi
  done
else
  echo "  gh not found -- set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY as repository secrets by hand"
fi

echo
if [ "$missing" -eq 1 ]; then
  echo "Some values were missing. Fill them in and run this again; it is safe to re-run."
  exit 1
fi

echo "All four synced. Deploy with: git commit --allow-empty -m 'Deploy' && git push origin main"
