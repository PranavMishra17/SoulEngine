# Deployment

SoulEngine runs as a single Node service on **Google Cloud Run**, with
**Supabase** behind it for Postgres, auth and image storage. Both sit inside
free tiers. Deploys happen automatically on every push to `main`.

This replaced Render, which was configured on the `starter` plan at $7/month
and had been failing on every push.

- Container: [`Dockerfile`](Dockerfile)
- Deploy pipeline: [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
- Supabase keep-alive: [`.github/workflows/keep-supabase-awake.yml`](.github/workflows/keep-supabase-awake.yml)

**Section 3 is copy-paste runnable.** Set five values once in 3.3 and every
later block uses them. Run the blocks in **Git Bash**, not PowerShell — they use
bash syntax (`$VAR`, loops, `read`). Git Bash ships with Git for Windows.

---

## 1. What was wrong

Two separate problems that looked like one.

**Supabase paused itself.** A free Supabase project is paused after seven
consecutive days with no database activity, and only a human can restore it from
the dashboard. Once paused, every request the app makes to it fails. The app
cannot prevent this by itself: the host scales to zero, so a quiet week is a week
with no queries.

**The Render deploy was failing separately.** GitHub Actions was green on every
push, including the most recent ones. The old workflow's last step was a bare
`curl -X POST "$RENDER_DEPLOY_HOOK_URL"` whose response was never checked, so a
failing deploy on Render's side could never turn CI red. Whatever Render was
reporting never reached the repository.

The new pipeline closes that hole: it deploys inline and then polls
`/api/health` on the live URL, so a broken deploy fails the run.

---

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

**Billing must be enabled on the GCP project even to use the free tier** — a card
on file. Section 7 covers capping spend so that stays theoretical.

---

## 3. Setup, step by step

### 3.1 First: rescue two values from Render

> **Do this before deleting the Render service.** `ENCRYPTION_KEY` decrypts every
> project API key stored in the `project_secrets` table. Deploy Cloud Run with a
> different value and every stored key becomes permanently unreadable, and every
> conversation in every project fails. That exact failure is ERR-023 in
> [`ERRORS.md`](ERRORS.md).

1. Open <https://dashboard.render.com> and sign in.
2. Click the **soulengine** service.
3. Click **Environment** in the left sidebar.
4. Reveal and copy these two values somewhere safe:
   - `ENCRYPTION_KEY`
   - `BROKER_TOKEN_SECRET`

You will paste both in step 3.5. Do not delete the Render service until Cloud Run
is serving.

If `BROKER_TOKEN_SECRET` was never set on Render, generate a fresh one — nothing
persisted depends on it, unlike `ENCRYPTION_KEY`:

```bash
openssl rand -hex 32
```

Both must be at least 32 characters (`src/config.ts:10` and `:13`) and must be
different values.

### 3.2 Collect your Supabase keys

1. Open <https://supabase.com/dashboard> and sign in.
2. Click your SoulEngine project. **If it shows as paused, click `Restore` now**
   and wait for it to come back.
3. Go to **Project Settings** (the gear, bottom left) then **API**.
4. Copy three values:
   - **Project URL** -> `SUPABASE_URL` (looks like `https://abcdefgh.supabase.co`)
   - **anon / public** key -> `SUPABASE_ANON_KEY`
   - **service_role / secret** key -> `SUPABASE_SERVICE_ROLE_KEY` (click to reveal)

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

### 3.6 Store the secrets

This prompts for each value in turn. Nothing is echoed to the screen and nothing
lands in your shell history. Paste the value, press Enter.

```bash
for NAME in SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY \
            ENCRYPTION_KEY BROKER_TOKEN_SECRET GEMINI_API_KEY; do
  printf 'Paste value for %s: ' "$NAME"
  read -rs VALUE
  echo
  # printf, not echo: a trailing newline inside an API key breaks auth in ways
  # that look like a wrong key.
  printf '%s' "$VALUE" \
    | gcloud secrets create "$NAME" --replication-policy=automatic --data-file=- 2>/dev/null \
    || printf '%s' "$VALUE" | gcloud secrets versions add "$NAME" --data-file=-
done
unset VALUE

gcloud secrets list
```

`gcloud secrets list` should show all six.

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

Open `$URL` in a browser to confirm the studio loads. Only then delete the Render
service.

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
| `ENCRYPTION_KEY` | Secret Manager | Decrypts stored project API keys. Min 32 chars. Never rotate casually |
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
| Stored project API keys all fail to decrypt | `ENCRYPTION_KEY` does not match the one Render used. Recover it (3.1); a wrong value cannot be worked around. See ERR-023 in [`ERRORS.md`](ERRORS.md) |
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
- **No custom domain.** The service answers on its generated `*.run.app` URL.
  Mapping a domain is `gcloud run domain-mappings create` plus a DNS record.
