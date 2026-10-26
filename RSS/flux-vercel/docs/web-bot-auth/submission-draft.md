# Cloudflare BotBase submission — submitted 26 October 2026

Submitted: 26 October 2026. Status at submission: Waiting for review. Submission ID: `01a17946-426b-76b1-9105-ab8ded7f3e92`. This is not proof of Cloudflare acceptance.

## Proposed form values

- **Service name:** Flux Reader
- **Operator display name:** Balázs Kemenesi — explicitly selected and approved by the operator.
- **Website:** https://fluxreader.vercel.app/
- **Public service description:** https://fluxreader.vercel.app/reader-bot
- **Verification method:** Request Signature / Web Bot Auth (Ed25519).
- **Key directory:** https://fluxreader.vercel.app/.well-known/http-message-signatures-directory
- **User agent after activation:** `FluxReader/1.0 (+https://fluxreader.vercel.app/reader-bot)`
- **Signature-Agent:** `"https://fluxreader.vercel.app"` (structured-field string).
- **Behavior:** RSS/feed fetching and user-directed retrieval of linked public articles for reading. Choose the closest actual form categories; do not describe Flux as a search engine or model-training crawler.
- **Operating model:** Flux runs its own web reader and backend. The site and article endpoint are publicly reachable; they are not a closed, authenticated private API. Do not claim that only the operator can technically initiate requests. Select Direct/Intermediary only after reviewing the current form definitions against this description.
- **Contact email / legal operator identity:** Not filled or published. Obtain the operator's approval before sending personal contact information.

## Description to paste

Flux Reader is a small personal RSS reading web application. It collects feed metadata and can retrieve linked, public article pages to display them in a consistent reading view, with source attribution and links to the publisher. Full article text is requested when a reader opens an article; there is no hover/touch text prefetch. The Flip view can also retrieve page metadata to improve image quality. It does not recursively crawl links to build a search index.

The current article endpoint supports a fixed list of publishers. Telex retrieval currently passes through a dedicated authenticated relay with shared limits of 12 requests per client per minute, 20 globally per minute and 500 globally per UTC day, plus a one-hour edge cache for successful HTML. Telex image-metadata requests and any reserved direct retry use the same budget. Typed failures are remembered briefly. The web reader can keep content in memory and readers may save individual articles locally for later reading.

Content is used for personal reading and, when explicitly enabled by the reader, text-to-speech processing through ElevenLabs. Flux does not use article content for AI model training. It does not request publisher account credentials for protected content. Publisher access decisions remain authoritative.

We are requesting verification of Flux's own identity, not permission to impersonate another crawler. Once verified, we intend to sign outgoing Telex article requests using Web Bot Auth with Ed25519. A signed public key directory will be served on the production HTTPS origin above.

## Submission record and later activation

1. The operator approved the final form and selected Balázs Kemenesi as the public operator name. No separate contact address was requested by the form.
2. Publish the public description and a real signed key directory on the production origin, after a separate release approval. A preview URL is not a substitute for the declared production identity.
3. Verify the production directory response, its signature, its exact authority, and the absence of private key fields.
4. Review the live form's behavior/content-use choices. State the automatic image-metadata requests and optional speech honestly; do not claim that all network requests require a click or that no AI processing occurs.
5. The operator explicitly authorized submission. The request was submitted through the existing Cloudflare account; outgoing signing remains disabled pending acceptance and approval.

Cloudflare may accept, reject, or ask for clarification. Acceptance does not force Telex to allow requests. Do not enable outbound signing until verification is complete.

Sources: [BotBase for Operators](https://blog.cloudflare.com/botbase-for-operators/), [Web Bot Auth](https://developers.cloudflare.com/bots/reference/bot-verification/web-bot-auth/).
