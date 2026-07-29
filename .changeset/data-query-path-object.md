---
"@objectstack/runtime": patch
"@objectstack/plugin-webhooks": patch
---

fix(runtime,webhooks): the path object wins on /data/:object/query, and the webhook envelope owns its keys (#3946)

Follow-up sweep for the shape behind #3897 and #3933 — a trusted, server-derived
value written into an object literal with a caller-controlled bag spread OVER
it. Both of those were in the same block of REST code, so the pattern was swept
across all 1313 non-test TypeScript files in `packages/`. Nine candidate sites;
one real, one worth hardening, seven verified clean (recorded in #3946 so the
next sweep does not re-litigate them).

**`POST /data/:object/query` (runtime dispatcher).** The `/data` domain built
`{ object: objectName, ...body }`, so `{"object":"other", …}` in the body moved
the read to a different object than the URL named.

This is NOT an authorization bypass, and the tests pin why: `callData` gates
API exposure on `params.object`, so the gate followed the body and agreed with
the read — an object hidden by `apiEnabled: false` was refused either way. What
broke is that the URL stopped describing the operation (audit trails, logs, and
anything keyed on the request path saw object A while object B was read), and
that one endpoint spoke a second dialect of the contract the REST side had just
standardised on: the path object wins. The other handlers in that file never had
the problem — they nest caller data (`data: body`, `query: normalized`) instead
of splatting it, and the GET-by-id branch already allowlists its query params
against exactly this pollution.

**Webhook delivery envelope.** `auto-enqueuer` built
`{ object, recordId, action, timestamp, ...payload }`, letting an event payload
rewrite the envelope a subscriber receives. Behaviour-neutral for the engine's
own publishers — `data.record.*` payloads are `{ recordId, after, changes }`
with record fields nested under `after`, so none of those four keys collide
today — but the shape was wrong, and the `payload.id` fallback right above it
suggests publishers that flatten record fields do exist. Envelope keys are
written last now.
