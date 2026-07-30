---
---

Extend `scripts/check-route-envelope.mjs` to the dispatcher domains — the REST
surface it structurally could not see. Deliberately empty frontmatter: this is a
CI guard, no published behaviour, type, or wire shape changes.

The platform answers REST from two kinds of file. Route modules (`*-routes.ts`)
call `res.json(...)`, which the scan counted. Dispatcher domains
(`runtime/src/domains/*.ts`) RETURN `{ status, body }` for a central sender, so
they never call `res.json` and were invisible to it by construction.

That gap cost something real: `/share-links` emitted its payload under both `data`
and a legacy `link` / `links` for as long as nothing looked, and it surfaced only
because #3983's consumer sweep happened to walk past it (#4038, fixed in #4049).

The new table counts hand-built `response: { … }` literals per domain. A domain
answering only through the `deps.success` / `deps.error` / `deps.routeNotFound` /
`deps.errorFromThrown` helpers hand-builds **zero** and cannot drift; any
hand-built response now has to be declared with a `note` saying why. Hand-building
is not automatically wrong — four kinds show up and only the last is drift:

1. Enveloped, but the helper cannot express it — `deps.success` hardcodes status
   200, so a 201 must be assembled by hand, and `deps.error` carries no headers,
   so a 405 with `Allow:` must be too (`keys.ts`, `share-links.ts`, one in `mcp.ts`).
2. Passthrough of a body this dispatcher does not own — an upstream Web Response,
   another service's result (`mcp.ts`, `ai.ts`).
3. A foreign wire format a client library requires — `/auth` answers better-auth's
   shapes because better-auth's client parses them (`auth.ts` ×4).
4. Drift.

Result: **16 domains audited, 11 helper-only, 5 declaring hand-built responses,
1 ratcheted.** The ratchet is `ai.ts` → #4053: `GET /ai/agents` is SDK-addressable
but unenveloped, and the SDK compensates by reading `.agents` off the raw body, so
converting it without changing cloud and the SDK in the same batch makes
`client.ai.agents.list()` return an empty list silently. That warning now fails CI
for whoever tries, instead of sitting in an issue.

Five self-test assertions cover the new scan, one of which caught a real
false positive while it was being written: matching the `response` key alone
counted a *payload field* named `response` (`deps.success({ response: … })`) as a
hand-built response. It now requires `response` to be a sibling of `handled` —
that pair is the `HttpDispatcherResult`.
