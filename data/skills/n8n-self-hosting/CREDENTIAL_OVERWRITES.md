# Managed OAuth: credential overwrites

On n8n Cloud, connecting Google or Slack is one click — Cloud owns the OAuth app, so users
never see a client secret. Self-hosted has no OAuth app of its own, so by default **every user
must paste a Client ID and Client Secret** into every OAuth credential they create.

That is the problem this feature solves. **Credential overwrites** let you register one OAuth
app per credential type at instance level. n8n then hides those fields in the UI and users get
the plain "Sign in with …" button. Each user still authorises their own account and gets their
own tokens — only the *app* identity is shared.

Docs: <https://docs.n8n.io/administer/manage-credentials/credential-overwrites>

Use this when the user says any of: "we don't want to hand the client secret to everyone",
"can we get the Sign in with Google button", "every new hire has to set up OAuth again",
"how does Cloud do one-click Google".

## Two ways to set it, and only one you should use

| | `CREDENTIALS_OVERWRITE_DATA` | Endpoint |
|---|---|---|
| How | JSON blob in an env var | one authenticated `POST` after boot |
| Secret lands in | compose/`.env`, container env, `docker inspect` | request body only |
| n8n's own docs | "isn't recommended" | "the recommended approach" |
| Use it | never on a shared box | always |

The docs are blunt about the env route: *"Environment variables aren't protected in n8n, so the
data can leak to users."* Take that literally and use the endpoint.

## Setup

Three vars. In queue mode put them in the shared `x-n8n-env` anchor (see `QUEUE_MODE.md` on
env parity), except that only the main actually serves the endpoint.

```yaml
- CREDENTIALS_OVERWRITE_ENDPOINT=${CREDS_OVERWRITE_PATH}       # random, not "credentials"
- CREDENTIALS_OVERWRITE_ENDPOINT_AUTH_TOKEN=${CREDS_OVERWRITE_TOKEN}
- CREDENTIALS_OVERWRITE_PERSISTENCE=true
```

Generate both values on the box, into `.env` (600), like every other secret:

```bash
printf "\nCREDS_OVERWRITE_PATH=creds-overwrite-%s\nCREDS_OVERWRITE_TOKEN=%s\n" "$(openssl rand -hex 6)" "$(openssl rand -hex 32)" >> .env
```

Recreate n8n, then push the OAuth app once. The endpoint is mounted at the **root** of the
n8n host, not under `/rest`:

```bash
curl -sS -X POST "https://n8n.example.com/${CREDS_OVERWRITE_PATH}" -H "Authorization: Bearer ${CREDS_OVERWRITE_TOKEN}" -H "Content-Type: application/json" -d '{"googleOAuth2Api":{"clientId":"...","clientSecret":"..."}}'
```

`Content-Type: application/json` is enforced — anything else returns an error, not a silent
no-op. Success is HTTP 200 with `success: true`.

## The auth token is not optional

**Leave `CREDENTIALS_OVERWRITE_ENDPOINT_AUTH_TOKEN` empty and the endpoint stands open.** n8n
only installs the auth middleware when the token is set; without it, the route still exists and
accepts the **first** POST it receives from anyone, then latches (a one-shot
`presetCredentialsLoaded` flag). Whoever gets there first registers the OAuth app that your
users will consent to.

So: always set the token, and make the path unguessable. With the token set, the one-shot latch
is bypassed and you can re-POST to rotate the app later.

Reverse proxies pass arbitrary paths through to n8n, so nothing in Caddy needs changing — which
also means nothing in Caddy is protecting this route for you.

## Set it on the parent credential type, not the leaf

Overwrites resolve along the credential inheritance chain. `GoogleBigQueryOAuth2Api` declares
`extends: ['googleOAuth2Api']`, and n8n merges every ancestor's overwrite before the leaf's.

One entry on **`googleOAuth2Api`** therefore covers Sheets, Drive, Gmail, Calendar, Docs,
BigQuery, Chat, Cloud Storage and the rest in one go. Registering each leaf type separately
works but is pointless duplication.

Before assuming a family shares a parent, check that credential's `extends` — not every vendor's
credentials are structured this way, and a leaf with no parent only gets its own entry.

## It will not break existing credentials

The overwrite fills a field **only when the stored value is `null`, `undefined` or empty**.
Every credential already holding its own Client ID and Secret keeps working untouched. The
overwrite applies to newly created credentials, and to any field a user left blank.

Escape hatch for users who insist on their own OAuth app:

```
N8N_SKIP_CREDENTIAL_OVERWRITE=googleOAuth2Api,slackOAuth2Api
```

For a listed type, if the credential has any overwritten field set to a value of its own, n8n
skips the overwrite entirely for that credential and uses what the user entered.

`N8N_MANAGED_OAUTH_SHOW_SCOPES` (comma-separated types) makes the UI display the scopes being
requested — worth enabling if users need to see what they are consenting to.

## Persistence, restarts and workers

With `CREDENTIALS_OVERWRITE_PERSISTENCE=true`, a POST is stored in the `settings` table under
key `credentialsOverwrite`, **encrypted with `N8N_ENCRYPTION_KEY`** — so it is covered by your
normal DB backup, and it is unreadable without the key you already had to protect.

Two consequences worth knowing:

- **Workers pick it up live.** Saving broadcasts a `reload-overwrite-credentials` pubsub
  command; every worker reloads from the DB immediately, no restart and no redeploy. The
  `PERSISTENCE` flag on a worker only matters at **cold start**, when it decides whether the
  worker reads the row on boot. Set it on workers anyway — otherwise a worker that restarts
  quietly loses the overwrite and its executions start failing on credentials that work fine in
  the editor.
- **Without persistence** the data is in-memory only. It disappears on restart and you must
  POST again, which is exactly the kind of thing nobody remembers at 3am.

If you set both `CREDENTIALS_OVERWRITE_DATA` and persistence, the DB copy is loaded second and
wins. Don't run both; pick one source of truth.

## Google-specific prerequisites

The overwrite only supplies the app identity. The OAuth app itself still has to be correct:

- **Redirect URI** on the OAuth client must be exactly
  `https://<your-n8n-host>/rest/oauth2-credential/callback`. Get `WEBHOOK_URL` /
  `N8N_EDITOR_BASE_URL` wrong and n8n will generate a `localhost` callback that never matches.
- **Consent screen publishing status.** An *External* app left in *Testing* issues refresh
  tokens that expire after 7 days. On a per-user client that is one person's annoyance; behind a
  shared client it logs out the whole company at once, weekly. Publish the app, or use
  *Internal* if the org is on Google Workspace.
- **Enable the APIs** you intend to use in that Google Cloud project. The overwrite cannot fix
  a disabled API.

## Verify

```bash
docker compose exec -T postgres sh -lc 'psql -U $POSTGRES_USER -d $POSTGRES_DB -A -t -c "select key, length(value) from settings where key = '"'"'credentialsOverwrite'"'"'"'
```

One row. The value is ciphertext, so length is all you should see — never decrypt it to "check".

Then in the UI, create a new credential of that type: the Client ID and Client Secret fields
should be gone, leaving only the sign-in button. That is the real acceptance test.

## What NOT to do

- **Don't leave the auth token empty.** See above — that is a takeover, not a rough edge.
- **Don't use `CREDENTIALS_OVERWRITE_DATA` on a multi-user instance.** Anything in the
  container env is one Code node or one `docker inspect` away from a user.
- **Don't paste the client secret into a shell one-liner on a shared box** — it lands in shell
  history. Read it from `.env` or a file, or type it into a heredoc.
- **Don't expect this to fix a broken credential.** Overwrites set the *app*'s ID and secret.
  A credential that fails because its refresh token was revoked, expired, or belonged to someone
  who left the company needs re-authorisation and an ownership change — a different job.
- **Don't skip the worker flag in queue mode.** It only bites after a worker restart, which is
  the worst time to discover it.
