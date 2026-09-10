# Deployment

SoulEngine runs as a single Node service on **Google Cloud Run**, with
**Supabase** behind it for Postgres, auth and image storage. Both sit inside
free tiers. Deploys happen automatically on every push to `main`.

It replaces a Render deployment that no longer exists. Nothing carries over
from it, so section 3 sets up a **new** Supabase project from scratch.

- Container: [`Dockerfile`](Dockerfile)
- Deploy pipeline: [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
- Supabase keep-alive: [`.github/workflows/keep-supabase-awake.yml`](.github/workflows/keep-supabase-awake.yml)

**Section 3 is copy-paste runnable.** Set five values once in 3.3 and every
later block uses them. Run the blocks in **Git Bash**, not PowerShell — they use
bash syntax (`$VAR`, loops, `read`). Git Bash ships with Git for Windows.

---

## 1. What was wrong

**Supabase paused itself, then went away.** A free Supabase project is paused
after seven consecutive days with no database activity, and only a human can
restore it. The original SoulEngine project was paused and is now gone from the
account entirely, so there is no data to migrate and no key to preserve. Section
3 builds a fresh one.

The app could never have prevented that pause on its own: the host scales to
zero, so a quiet week is a week with no queries. Section 5 covers the fix.

**The deploy was failing invisibly.** GitHub Actions was green on every push. The
old workflow's last step was a bare `curl -X POST "$RENDER_DEPLOY_HOOK_URL"`
whose response was never checked, so a failing deploy could never turn CI red.

The new pipeline closes that hole: it deploys inline and then polls
`/api/health` on the live URL, so a broken deploy fails the run.

## 2. Why Cloud Run

The service is a stateful Node process that holds WebSocket connections for
voice, which rules out serverless platforms that only do request/response
(Vercel, Netlify, Cloudflare Workers without a rewrite).

| Option | Free? | Fit |
| --- | --- | --- |
| **Cloud Run** | Always-free tier: 2M requests, 180k vCPU-seconds, 360k GiB-seconds per month | **Chosen.** Real WebSockets, scales to zero, 1-3s cold start |
| Render free | Free, 750 instance-hours/month | Sleeps after 15 min idle, ~50s cold start, no persistent disk |
| Oracle Cloud Always Free | Free forever, never sleeps | Genuinely always-on, but you administer a VM: Node, nginx, TLS, restarts |
| Fly.io | No dependable free tier any more | Would cost money |

Cold starts are acceptable here, which is what makes scale-to-zero the right
trade: the service costs nothing while nobody is using it.

### Why the database stays on Supabase

Neon is the obvious alternative, and its headline advantage is real: its compute
auto-suspends when idle but **resumes on the next connection**, so there is no
paused state a human has to clear. Neon now also offers auth and object storage,
so it could in principle cover all three jobs Supabase does here.

It is still the wrong move, because the schema and the code are welded to
Supabase specifically:

| Bound to Supabase | Count |
| --- | --- |
| `auth.uid()` calls in RLS policies | 37, across five files in `sql/` |
| `.from('table')` PostgREST call sites | 56 |
| Storage modules importing `supabase-js` | 11, in `src/storage/supabase/` |
| Foreign keys into the `auth.users` table | [`sql/01-schema.sql`](sql/01-schema.sql) |
| Supabase's `storage.` schema | [`sql/03-storage.sql`](sql/03-storage.sql) |

Neon has neither `auth.uid()` nor `auth.users`, so every policy would have to be
rewritten and the PostgREST client swapped for a Postgres driver across 56 call
sites. That is a rewrite of the authorization layer, which is the worst place to
introduce new bugs for an operational convenience.

And the convenience is already bought: the keep-alive in section 5 queries the
database every three days, well inside the seven-day window. Same outcome, no
migration. Revisit Neon only if the storage layer is being rewritten anyway.

**Billing must be enabled on the GCP project even to use the free tier** — a card
on file. Section 7 covers capping spend so that stays theoretical.

---

## 3. Setup, step by step

### 3.0 What is already provisioned

Google Cloud is done. Project **`soulengine-484220`** (number `436058560797`)
already has all of this, so **skip 3.3 through 3.5 and 3.7 through 3.9**:

| Done | Detail |
| --- | --- |
| Billing | Enabled |
| APIs | Cloud Run, Artifact Registry, Secret Manager, IAM Credentials, Cloud Resource Manager |
| Image registry | `us-central1-docker.pkg.dev/soulengine-484220/soulengine` |
| Deploy identity | `github-deployer@soulengine-484220.iam.gserviceaccount.com` with `run.admin`, `artifactregistry.writer`, `iam.serviceAccountUser` |
| Keyless GitHub auth | Pool `github`, provider locked to `PranavMishra17/SoulEngine` |
| `ENCRYPTION_KEY` | Generated (64 hex chars) and stored in Secret Manager |
| `BROKER_TOKEN_SECRET` | Generated, distinct from the above, stored |
| GitHub secrets | `GCP_PROJECT_ID`, `GCP_SERVICE_ACCOUNT`, `GCP_WORKLOAD_IDENTITY_PROVIDER` set; the stale `RENDER_DEPLOY_HOOK_URL` removed |

**What is left:** create the Supabase project (3.1), then put four values in
`.env` and run one script (3.6).


### 3.1 Create a new Supabase project and load the schema

There is nothing to migrate — the old project is gone — so this builds a clean
one.

1. Open <https://supabase.com/dashboard> and sign in.
2. Click **New project**. Name it `soulengine`, pick a region near you, and let
   it generate a database password (you will not need it; the app authenticates
   with the service role key). Click **Create new project** and wait ~2 minutes.
3. Open the **SQL Editor** in the left sidebar.
4. Run the seven files in [`sql/`](sql/) **in numbered order**, one at a time:
   open the file, paste the whole contents into a new query, press **Run**, wait
   for success, then move to the next.

   | Order | File | Creates |
   | --- | --- | --- |
   | 1 | `sql/01-schema.sql` | The 11 tables |
   | 2 | `sql/02-rls-policies.sql` | Row-level security on all of them |
   | 3 | `sql/03-storage.sql` | The bucket for NPC profile images |
   | 4 | `sql/04-definition-history.sql` | NPC version history |
   | 5 | `sql/05-usage-tracking.sql` | Per-project usage counters |
   | 6 | `sql/06-waitlist.sql` | The Unity waitlist table |
   | 7 | `sql/07-session-and-integrity.sql` | Session persistence + constraints |

   Order matters: later files add columns and policies to tables the earlier ones
   create. The statements are idempotent, so re-running one is safe.

5. Confirm it worked — **Table Editor** should list `projects`,
   `npc_definitions`, `npc_instances`, `project_secrets` and the rest.
6. Now collect the keys. **Project Settings** (the gear, bottom left) then
   **API**, and copy three values:
   - **Project URL** -> `SUPABASE_URL` (looks like `https://abcdefgh.supabase.co`)
   - **anon / public** key -> `SUPABASE_ANON_KEY`
   - **service_role / secret** key -> `SUPABASE_SERVICE_ROLE_KEY` (click to reveal)

Keep them to hand for step 3.6.

### 3.2 The two application secrets (already done)

`ENCRYPTION_KEY` and `BROKER_TOKEN_SECRET` are generated and stored in Secret
Manager for `soulengine-484220`. Nothing to do. They are 64 hex characters each,
distinct from one another, and the Cloud Run runtime account can read both.

Read one back if you ever need it:

```bash
gcloud secrets versions access latest --secret=ENCRYPTION_KEY --project=soulengine-484220
```

If you ever regenerate them, strip whitespace explicitly — on Windows a bare
`openssl rand -hex 32 | tr -d '
'` leaves a carriage return inside the value:

```bash
openssl rand -hex 32 | tr -dc '0-9a-f' | gcloud secrets versions add ENCRYPTION_KEY --data-file=-
```

> **`ENCRYPTION_KEY` must never change after the first deploy.** It encrypts
> every provider API key in `project_secrets`. Change it and every stored key
> becomes permanently unreadable and every conversation fails, with no way back.
> That is ERR-023 in [`ERRORS.md`](ERRORS.md).

### 3.3 Create the Google Cloud project

1. Install the gcloud CLI if you have not: <https://cloud.google.com/sdk/docs/install-sdk>
   (Windows installer, then reopen Git Bash).
2. Open <https://console.cloud.google.com/projectcreate>, sign in with your Google
   account, name the project `soulengine`, and click **Create**. Note the
   **Project ID** it generates — usually `soulengine-XXXXXX`, not the name.
3. Open <https://console.cloud.google.com/billing>, click **Link a billing
   account**, and add a card. Required even for the free tier. New accounts get
   $300 of credit for 90 days; the always-free allowances continue after that.
4. Log the CLI in:

```bash
gcloud auth login
```

### 3.4 Set your five values

Edit the first line only — the rest are already correct for this repo.

```bash
export GCP_PROJECT_ID="soulengine-XXXXXX"          # <- paste your Project ID from 3.3
export GITHUB_REPO="PranavMishra17/SoulEngine"
export REGION="us-central1"
export SERVICE="soulengine"
export REPOSITORY="soulengine"

gcloud config set project "$GCP_PROJECT_ID"
export PROJECT_NUMBER="$(gcloud projects describe "$GCP_PROJECT_ID" --format='value(projectNumber)')"
export DEPLOYER="github-deployer@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
export RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "Project $GCP_PROJECT_ID (number $PROJECT_NUMBER) — deployer $DEPLOYER"
```

That last line must print a real project number. If it is blank, the project id
is wrong or `gcloud auth login` did not complete.

> Everything below reuses these variables. If you close the terminal, re-run this
> block before continuing.

### 3.5 Enable services and create the registry

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com \
  cloudresourcemanager.googleapis.com

gcloud artifacts repositories create "$REPOSITORY" \
  --repository-format=docker \
  --location="$REGION" \
  --description="SoulEngine container images"
```

### 3.6 Put the four remaining values in .env, then sync

Paste these four into **`.env` in the repository root** (gitignored, stays
local). Three come from Supabase step 3.1; the fourth is your Gemini key:

```
SUPABASE_URL=https://YOURPROJECT.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
GEMINI_API_KEY=AIza...
```

Then push them into Secret Manager and mirror the two the keep-alive needs into
GitHub:

```bash
bash scripts/sync-secrets.sh
```

The script strips whitespace from every value, grants the Cloud Run runtime
account read access to each secret, and is safe to re-run. It reads only those
four names and never touches `ENCRYPTION_KEY` or `BROKER_TOKEN_SECRET`.

### 3.7 Create the deploy identity

```bash
gcloud iam service-accounts create github-deployer \
  --display-name="GitHub Actions deployer"

# The deployer may ship revisions, push images, and act as the runtime account.
for ROLE in roles/run.admin roles/artifactregistry.writer roles/iam.serviceAccountUser; do
  gcloud projects add-iam-policy-binding "$GCP_PROJECT_ID" \
    --member="serviceAccount:${DEPLOYER}" --role="$ROLE" --condition=None --quiet
done

# The RUNTIME account is a different account, and it is the one that reads the
# secrets at request time. Missing this is the most common setup failure.
for NAME in SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY \
            ENCRYPTION_KEY BROKER_TOKEN_SECRET GEMINI_API_KEY; do
  gcloud secrets add-iam-policy-binding "$NAME" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor" --quiet
done
```

### 3.8 Let GitHub authenticate without a stored key

Workload Identity Federation mints a short-lived token per workflow run, so no
long-lived credential is ever stored in the repository.

```bash
gcloud iam workload-identity-pools create github \
  --location=global --display-name="GitHub"

gcloud iam workload-identity-pools providers create-oidc github \
  --location=global \
  --workload-identity-pool=github \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository == '${GITHUB_REPO}'"

gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${GITHUB_REPO}"

export WIF_PROVIDER="$(gcloud iam workload-identity-pools providers describe github \
  --location=global --workload-identity-pool=github --format='value(name)')"

echo "$WIF_PROVIDER"
```

The `--attribute-condition` is the security boundary, not a formality: without it
any repository on GitHub could impersonate this service account.

### 3.9 Give GitHub its secrets

`gh` is already authenticated in this repo, so this needs no browser. Run it from
the repository directory.

```bash
gh secret set GCP_PROJECT_ID --body "$GCP_PROJECT_ID"
gh secret set GCP_WORKLOAD_IDENTITY_PROVIDER --body "$WIF_PROVIDER"
gh secret set GCP_SERVICE_ACCOUNT --body "$DEPLOYER"

# The keep-alive workflow talks to Supabase directly and never touches Google,
# so it needs its own copy of these two.
printf 'Paste SUPABASE_URL again: ' && read -rs V && echo && gh secret set SUPABASE_URL --body "$V"
printf 'Paste SUPABASE_SERVICE_ROLE_KEY again: ' && read -rs V && echo && gh secret set SUPABASE_SERVICE_ROLE_KEY --body "$V"
unset V

gh secret delete RENDER_DEPLOY_HOOK_URL 2>/dev/null || true
gh secret list
```

If you would rather click: <https://github.com/PranavMishra17/SoulEngine/settings/secrets/actions>

### 3.10 Deploy and check

```bash
git commit --allow-empty -m "Trigger first Cloud Run deploy"
git push origin main

gh run watch
```

When it goes green:

```bash
export URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
echo "$URL"
curl -s "$URL/api/health"
```

You want `"storage":"supabase"` in that response. If it says `"local"`, the
Supabase variables did not reach the container — see section 9.

Open `$URL` in a browser to confirm the studio loads.

The database is new and empty, so there are no projects yet. Create one in the
studio and enter your provider API keys there — they are encrypted with
`ENCRYPTION_KEY` and stored in `project_secrets`. The `GEMINI_API_KEY` secret you
set in 3.6 is only the fallback used when a project has no key of its own.

### 3.11 Turn on the keep-alive

Run it once by hand to prove it works: <https://github.com/PranavMishra17/SoulEngine/actions/workflows/keep-supabase-awake.yml>
-> **Run workflow**. A green run means the database answered. After that it runs
itself every three days.

---

## 4. Deploying from now on

Push to `main`. The pipeline type-checks, runs the full test suite, builds the
image, pushes it, deploys the revision, and then polls `/api/health` on the live
URL until it answers `200`. A deploy that does not serve traffic fails the run.

To deploy by hand without going through GitHub:

```bash
gcloud run deploy "$SERVICE" --source . --region "$REGION"
```

### Why one instance

The deploy pins `--max-instances=1`. That is a correctness constraint, not a
cost tweak.

Live conversation sessions are held in an in-memory `Map`
([`src/session/store.ts:39`](src/session/store.ts:39)). With two instances,
whichever one receives a request has no idea about sessions started on the
other, so a player mid-conversation would get "session not found" as soon as a
request landed on the wrong container. Voice makes it worse: the WebSocket is
pinned to one instance while the REST calls around it are not.

`--concurrency=80` means that one instance still handles up to 80 simultaneous
requests, which is far beyond current traffic. Raising `--max-instances` requires
moving the session store into Supabase or Redis first (backlog 5.24 in
[`backlog.md`](backlog.md)).

---

## 5. Keeping Supabase alive

[`.github/workflows/keep-supabase-awake.yml`](.github/workflows/keep-supabase-awake.yml)
runs a real `select` against the database every three days, comfortably inside
the seven-day pause window, and fails loudly if the query does not return `200`.

Two things to know:

- **It queries Postgres, not just the URL.** Reaching the API gateway is not
  what resets the inactivity clock.
- **GitHub disables scheduled workflows after 60 days of repository
  inactivity.** If you stop pushing for two months, the keep-alive stops too and
  the project will pause. Re-enable it from the Actions tab, or push anything.

If the project has already paused, restore it at
<https://supabase.com/dashboard> -> your project -> **Restore**, then run the
workflow by hand to reset the clock.

---

## 6. Configuration

`NODE_ENV` and `DEFAULT_LLM_PROVIDER` are set as plain environment variables in
the deploy step. Everything else is mounted from Secret Manager.

| Variable | Source | Notes |
| --- | --- | --- |
| `PORT` | Cloud Run | Injected automatically; read via [`src/config.ts:63`](src/config.ts:63) |
| `NODE_ENV` | Deploy step | `production` — also what switches storage from local files to Supabase ([`src/storage/index.ts:19`](src/storage/index.ts:19)) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Secret Manager | Postgres, auth and image storage |
| `ENCRYPTION_KEY` | Secret Manager | Encrypts stored project API keys. Min 32 chars. Fixed for the life of the database — see 3.2 |
| `BROKER_TOKEN_SECRET` | Secret Manager | Signs broker tokens. Min 32 chars, must differ from `ENCRYPTION_KEY` |
| `GEMINI_API_KEY` | Secret Manager | Fallback provider when a project has no key of its own |

Storage only switches to Supabase when **both** `NODE_ENV=production` and the
Supabase variables are present. Miss one and the service silently runs on local
files inside the container, which vanish on the next deploy. `/api/health`
reports which backend is live.

To change a secret later — this creates a new version, then a redeploy picks it
up because the deploy step pins `:latest`:

```bash
printf 'new value' | gcloud secrets versions add GEMINI_API_KEY --data-file=-
gcloud run services update "$SERVICE" --region "$REGION"
```

To add a **new** provider key: create the secret (3.6), grant the runtime account
access (3.7), then add it to `--set-secrets` in
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

---

## 7. Staying inside the free tier

The always-free allowance is 2M requests, 180,000 vCPU-seconds and 360,000
GiB-seconds per month. Cloud Run bills only while a request is in flight, and
scale-to-zero means an idle service costs nothing.

**A voice session is one long WebSocket request and bills for its whole
duration.** 180,000 vCPU-seconds is about 50 hours of a single 1-vCPU instance
actively serving. `--timeout=900` caps any one connection at 15 minutes, which
bounds both a runaway session and its cost.

Set a budget alert so surprises arrive by email rather than on a statement. Get
the billing account id from <https://console.cloud.google.com/billing>:

```bash
gcloud billing budgets create \
  --billing-account=YOUR_BILLING_ACCOUNT_ID \
  --display-name="SoulEngine" \
  --budget-amount=1USD \
  --threshold-rule=percent=100
```

Artifact Registry keeps every image and the free allowance is 0.5 GB. Prune
occasionally, keeping the newest ten:

```bash
gcloud artifacts docker images list \
  "${REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${REPOSITORY}/${SERVICE}" \
  --format='value(version)' --sort-by=~UPDATE_TIME | tail -n +11 | \
  xargs -r -I{} gcloud artifacts docker images delete \
  "${REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${REPOSITORY}/${SERVICE}@{}" --quiet
```

---

## 8. Rollback

Revisions are immutable, so rolling back is a traffic switch, not a rebuild:

```bash
gcloud run revisions list --service "$SERVICE" --region "$REGION"

gcloud run services update-traffic "$SERVICE" \
  --region "$REGION" --to-revisions REVISION_NAME=100
```

---

## 9. Troubleshooting

**Logs:**

```bash
gcloud run services logs read "$SERVICE" --region "$REGION" --limit 100
```

| Symptom | Cause |
| --- | --- |
| `/api/health` says `"storage":"local"` | `NODE_ENV` or a Supabase variable is missing. Data is being written into the container and lost on redeploy |
| Health is fine, but every studio action fails | Supabase is paused. Restore it (section 5) |
| Stored project API keys all fail to decrypt | `ENCRYPTION_KEY` changed since those keys were saved. There is no way to recover them: set the original value back, or re-enter the provider keys in the studio. See ERR-023 in [`ERRORS.md`](ERRORS.md) |
| `Permission denied on secret` | The **runtime** service account was not granted `secretAccessor` (3.7). Easy to miss — it is a different account from the deployer |
| Workflow fails at "Authenticate to Google Cloud" | The three `GCP_*` repository secrets are missing or the WIF attribute condition does not match `OWNER/REPO` exactly |
| Deploy fails at "Verify the new revision is serving" | The container started but is not answering. Read the logs; usually a missing secret |
| WebSocket voice disconnects at 15 minutes | `--timeout=900` doing its job. Raise it up to 3600 if sessions need to be longer, and watch the vCPU-second budget |
| First request after a quiet period takes seconds | Cold start from zero instances. Expected. `--min-instances=1` removes it but bills continuously and would leave the free tier |
| Scheduled keep-alive stopped running | GitHub disables schedules after 60 days of repository inactivity. Re-enable in the Actions tab |

---

## 10. Known gaps

- **One instance only.** Sessions are in-process, so the service cannot scale
  horizontally until the session store moves to shared storage. Backlog 5.24 in
  [`backlog.md`](backlog.md).
- **No staging environment.** `main` deploys straight to production. The health
  check catches a dead container, not a bad release.
- **Only signed-in users work in production.** Any request without a user JWT --
  anonymous studio visitors and, more importantly, game clients authenticating
  with a project API key -- is routed to local file storage, which fails on Cloud
  Run's read-only filesystem. `GET /api/v1/projects` returns 500 today for that
  reason. Tracked as ERR-029 in [`ERRORS.md`](ERRORS.md) and backlog 5.25.
- **No custom domain.** The service answers on its generated `*.run.app` URL.
  Mapping a domain is `gcloud run domain-mappings create` plus a DNS record.
