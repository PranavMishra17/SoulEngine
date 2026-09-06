# Deployment

SoulEngine runs as a single Node service on **Google Cloud Run**, with
**Supabase** behind it for Postgres, auth and image storage. Both sit inside
free tiers. Deploys happen automatically on every push to `main`.

This replaced Render, which was configured on the `starter` plan at $7/month
and had been failing on every push.

- Container: [`Dockerfile`](Dockerfile)
- Deploy pipeline: [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
- Supabase keep-alive: [`.github/workflows/keep-supabase-awake.yml`](.github/workflows/keep-supabase-awake.yml)

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

## 3. One-time setup

Run once, from a machine with the [gcloud CLI](https://cloud.google.com/sdk/docs/install)
installed. Replace `YOUR_PROJECT_ID` and `OWNER/REPO` throughout.

### 3.1 Project and APIs

```bash
gcloud config set project YOUR_PROJECT_ID

gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com
```

### 3.2 Somewhere to put the image

```bash
gcloud artifacts repositories create soulengine \
  --repository-format=docker \
  --location=us-central1 \
  --description="SoulEngine container images"
```

Artifact Registry gives 0.5 GB of free storage. The pipeline pushes one image
per commit, so prune old ones occasionally (section 7).

### 3.3 Secrets

Everything sensitive lives in Secret Manager, never in the workflow file and
never in the image. Create one secret per value:

```bash
for NAME in SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY \
            ENCRYPTION_KEY BROKER_TOKEN_SECRET GEMINI_API_KEY; do
  gcloud secrets create "$NAME" --replication-policy=automatic
done
```

Then add each value (this reads from your terminal, so the value never becomes a
shell-history entry):

```bash
gcloud secrets versions add SUPABASE_URL --data-file=-
# paste the value, then press Ctrl-D
```

Repeat for each name. `ENCRYPTION_KEY` and `BROKER_TOKEN_SECRET` **must be
different values** — they are separate secrets precisely so that compromising one
does not implicate the other.

> `ENCRYPTION_KEY` decrypts every stored project API key. If you change it,
> every key already stored becomes unreadable and every conversation in that
> project fails. That has happened before; see ERR-023 in
> [`ERRORS.md`](ERRORS.md).

### 3.4 A service account for deploys

```bash
gcloud iam service-accounts create github-deployer \
  --display-name="GitHub Actions deployer"

SA="github-deployer@YOUR_PROJECT_ID.iam.gserviceaccount.com"

# Deploy revisions
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:$SA" --role="roles/run.admin"

# Push images
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:$SA" --role="roles/artifactregistry.writer"

# Act as the runtime service account when deploying
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:$SA" --role="roles/iam.serviceAccountUser"
```

The Cloud Run **runtime** service account (the default compute one, unless you
made another) needs to read the secrets:

```bash
PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT_ID --format='value(projectNumber)')

for NAME in SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY \
            ENCRYPTION_KEY BROKER_TOKEN_SECRET GEMINI_API_KEY; do
  gcloud secrets add-iam-policy-binding "$NAME" \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```

### 3.5 Keyless auth from GitHub

Workload Identity Federation lets GitHub Actions authenticate with a
short-lived token minted per run. Nothing long-lived is stored in the
repository, so there is no key to leak or rotate.

```bash
gcloud iam workload-identity-pools create github \
  --location=global --display-name="GitHub"

gcloud iam workload-identity-pools providers create-oidc github \
  --location=global \
  --workload-identity-pool=github \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository == 'OWNER/REPO'"
```

The attribute condition is required, and it is the security boundary: without
it, any repository on GitHub could impersonate this service account.

Let that repository act as the deployer:

```bash
PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT_ID --format='value(projectNumber)')

gcloud iam service-accounts add-iam-policy-binding \
  "github-deployer@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/OWNER/REPO"
```

Print the provider resource name for the next step:

```bash
gcloud iam workload-identity-pools providers describe github \
  --location=global --workload-identity-pool=github \
  --format='value(name)'
```

### 3.6 Repository secrets

In GitHub, under **Settings -> Secrets and variables -> Actions**:

| Secret | Value |
| --- | --- |
| `GCP_PROJECT_ID` | Your GCP project id |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | The provider name printed in 3.5 |
| `GCP_SERVICE_ACCOUNT` | `github-deployer@YOUR_PROJECT_ID.iam.gserviceaccount.com` |
| `SUPABASE_URL` | Same value as the Secret Manager entry |
| `SUPABASE_SERVICE_ROLE_KEY` | Same value as the Secret Manager entry |

The last two are duplicated here on purpose: the keep-alive workflow talks to
Supabase directly and never touches Google Cloud.

You can now delete `RENDER_DEPLOY_HOOK_URL`.

---

## 4. Deploying

Push to `main`. The pipeline type-checks, runs the full test suite, builds the
image, pushes it, deploys the revision, and then polls `/api/health` on the live
URL until it answers `200`. A deploy that does not serve traffic fails the run.

To deploy by hand:

```bash
gcloud run deploy soulengine --source . --region us-central1
```

Find the URL at any time:

```bash
gcloud run services describe soulengine --region us-central1 --format='value(status.url)'
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
moving the session store into Supabase or Redis first.

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

To confirm it works, trigger it by hand: Actions -> Keep Supabase awake -> Run
workflow. A green run means the database answered.

If the project has already paused, restore it at
`https://supabase.com/dashboard` -> your project -> **Restore**, then run the
workflow to reset the clock.

---

## 6. Configuration

`NODE_ENV` and `DEFAULT_LLM_PROVIDER` are set as plain environment variables in
the deploy step. Everything else is mounted from Secret Manager.

| Variable | Source | Notes |
| --- | --- | --- |
| `PORT` | Cloud Run | Injected automatically; the server reads it via [`src/config.ts:63`](src/config.ts:63) |
| `NODE_ENV` | Deploy step | `production` — also what switches storage from local files to Supabase ([`src/storage/index.ts:19`](src/storage/index.ts:19)) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Secret Manager | Postgres, auth and image storage |
| `ENCRYPTION_KEY` | Secret Manager | Decrypts stored project API keys — never rotate casually |
| `BROKER_TOKEN_SECRET` | Secret Manager | Signs broker tokens; must differ from `ENCRYPTION_KEY` |
| `GEMINI_API_KEY` | Secret Manager | Fallback provider when a project has no key of its own |

Storage only switches to Supabase when **both** `NODE_ENV=production` and the
Supabase variables are present. Miss one and the service silently runs on local
files inside the container, which vanish on the next deploy. `/api/health`
reports which backend is live — check `"storage":"supabase"` after any change.

Adding a provider key later means creating the secret, granting the runtime
service account access to it, and adding it to `--set-secrets` in the deploy
step.

---

## 7. Staying inside the free tier

The always-free allowance is 2M requests, 180,000 vCPU-seconds and 360,000
GiB-seconds per month. Cloud Run bills only while a request is in flight, and
scale-to-zero means an idle service costs nothing.

**A voice session is one long WebSocket request and bills for its whole
duration.** 180,000 vCPU-seconds is about 50 hours of a single 1-vCPU instance
actively serving. `--timeout=900` caps any one connection at 15 minutes, which
bounds both a runaway session and its cost.

Set a budget alert so surprises arrive by email rather than on a statement:

```bash
gcloud billing budgets create \
  --billing-account=YOUR_BILLING_ACCOUNT_ID \
  --display-name="SoulEngine" \
  --budget-amount=1USD \
  --threshold-rule=percent=100
```

Artifact Registry keeps every image, and the free allowance is 0.5 GB. Prune
occasionally:

```bash
gcloud artifacts docker images list \
  us-central1-docker.pkg.dev/YOUR_PROJECT_ID/soulengine/soulengine \
  --format='value(version)' --sort-by=~UPDATE_TIME | tail -n +11 | \
  xargs -I{} gcloud artifacts docker images delete \
  "us-central1-docker.pkg.dev/YOUR_PROJECT_ID/soulengine/soulengine@{}" --quiet
```

---

## 8. Rollback

Revisions are immutable, so rolling back is a traffic switch, not a rebuild:

```bash
gcloud run revisions list --service soulengine --region us-central1

gcloud run services update-traffic soulengine \
  --region us-central1 --to-revisions REVISION_NAME=100
```

---

## 9. Troubleshooting

**Logs:**

```bash
gcloud run services logs read soulengine --region us-central1 --limit 100
```

| Symptom | Cause |
| --- | --- |
| `/api/health` says `"storage":"local"` | `NODE_ENV` or a Supabase variable is missing. Data is being written into the container and lost on redeploy |
| Health is fine, but every studio action fails | Supabase is paused. Restore it (section 5) |
| Deploy fails at "Verify the new revision is serving" | The container started but is not answering. Read the logs; usually a missing secret |
| `Permission denied on secret` | The **runtime** service account was not granted `secretAccessor` (section 3.4). Easy to miss — it is a different account from the deployer |
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
