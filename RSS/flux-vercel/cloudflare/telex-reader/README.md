# Telex Reader relay

This separate Worker does not bind to Pixaluma resources. Only signed GET
requests to `/article` are accepted, for HTTPS Telex article paths. The shared
secret belongs in Cloudflare and Vercel server environment variables, never in
the client bundle or Git. Requests expire after one minute; redirects are not
followed. HTML is bounded to 2 MiB with a 6-second upstream timeout.

Required configuration:

- Cloudflare secret: `TELEX_RELAY_SECRET`.
- Vercel server variables: the same `TELEX_RELAY_SECRET` and
  `TELEX_RELAY_URL=https://flux-telex-reader.balazskemenesi.workers.dev/article`.
- Worker binding `RATE_LIMITER`: 20 requests per 60 seconds, namespace
  `2026100201`, as specified in wrangler.jsonc.

Successful HTML is cached for one hour per Cloudflare location. Authentication
and rate limiting happen before cache access. Failed responses are not cached.
The native rate limit is approximate and per location, not a global daily cap.
Requests rejected by authentication still consume Worker invocations; this does
not guarantee isolation from the account-wide free quota under deliberate
flooding. The public Flux article API remains public as before.

With configuration absent, Flux retains its existing direct-fetch behavior.
Non-Telex extraction, article parsing and saved user settings are unchanged.

The Reader Vercel function alone runs in `fra1`; other functions keep their
existing region. The Worker uses the `aws:eu-central-1` placement hint. End-to-end
testing found Telex returning 403 on the US Vercel-to-Worker path, while the
European Reader path succeeded for both test articles. This does not guarantee
that Telex will never change its access rules.

Validation: `node --test worker.test.mjs`.
