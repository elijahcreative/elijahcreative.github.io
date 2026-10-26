# Telex Reader relay — preview revision

This dedicated Worker binds only to its own ReaderBudget SQLite Durable Object.
It does not use Pixaluma resources. Changes require preview review before release.

Only authenticated GET requests to `/article` with HTTPS Telex article paths are
accepted. The shared `TELEX_RELAY_SECRET` belongs only in Cloudflare and Vercel
server environment variables. Requests expire after one minute; the HMAC binds
the URL, optional Web Bot Auth headers and daily client digest. Redirects are not
followed. HTML is bounded to 2 MiB with a 6-second upstream timeout.

## Traffic protection

After authentication, valid successful edge-cache entries are served before quota
admission. Successful HTML stays in edge cache for one hour. A single SQLite
Durable Object coordinates 12 requests per client per minute, 20 globally per
minute and 500 globally per UTC day. Counters survive Worker restarts; these are
upstream-request limits, not per-Cloudflare-location counters. `wrangler.jsonc`
contains the binding and initial SQLite migration. No raw client IP is stored;
the backend sends an authenticated daily HMAC digest.

Short typed negative records cover blocks, challenges, timeouts, upstream errors
and provider rate limits. Provider `Retry-After` is honored up to 24 hours. A fresh
unsigned transient failure can permit one direct retry only after atomically
reserving a second client/global slot. Cached failures never grant permission.
Challenges, 403, 429, unavailable guards, and signed Web Bot Auth requests do not
grant a direct retry. Missing relay configuration fails closed for Telex.

Both article text and Flip image metadata use this relay and budget. The public
Vercel API also applies bounded per-instance caches, coalescing and a local abuse
brake. These local controls alone are not a global quota. Authentication failures
and deliberately flooded public endpoints still consume platform invocations;
this mechanism cannot guarantee isolation from shared account-wide free quotas.

## Configuration and validation

Use the same server-only `TELEX_RELAY_SECRET` in the Worker and Vercel. The
production URL is `https://flux-telex-reader.balazskemenesi.workers.dev/article`.
Preview uses a separate `flux-telex-reader-preview` Worker, secret and DO namespace.
Web Bot Auth remains separately disabled until approved and configured.

Run `node --test worker.test.mjs`. Local Wrangler tests also exercise the real
SQLite implementation and persisted daily counters across a runtime restart.
These checks do not prove that Telex will allow the fetcher; current deployment
access must be tested independently. Parser behavior and saved settings are
outside the relay and remain unchanged.
