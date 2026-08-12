---
"@objectstack/runtime": patch
---

fix(runtime): consult the anonymous-deny gate before `/ai/**`'s capability answers (#7653)

On an open-edition boot — where `@objectstack/service-ai` is absent by
construction, it being a Cloud/Enterprise package — the whole `/ai/**` family
answered **unauthenticated** callers: `GET /api/v1/ai/agents` returned **200**
with the console's empty-list courtesy, and every other route returned **501**
carrying the Cloud/Enterprise remedy sentence. Both should have been **401**.

`handleAIRequest` held the `shouldDenyAnonymous` gate *inside* its per-route
loop, which is reachable only once the AI service is serveable, while the
`!isServiceServeable` branch returned above it. So serveability decided whether
the gate ran at all — the inverse of the contract. `/ai` stands on the same
anonymous-deny floor as `/data`, `/meta`, `/security`, `/actions` and
`/automation` (ADR-0056 D2 → #3963), and `domains/automation.ts` already gates
ahead of its own `capabilityUnavailable` for exactly this reason: an anonymous
caller must not learn from a 501-vs-401 whether a deployment mounts AI at all.

The decision is now taken once at the top of the handler and consulted at the
exits; there is no second copy of the rule. The route-level `auth: false`
opt-out stays in the loop, because it is a property of a *registered* route and
can only be honoured where a route table exists — with no serveable service
there is no route to declare it, so the family default (auth required) stands.
The unpublished-route-table exit (`AI service routes not yet initialized`, 503)
takes the gate first for the same reason.

The honest degradation is unchanged for authenticated and internal SYSTEM
callers: `/ai/models`, `/ai/conversations`, `/ai/usage` and `/ai/chat` still
answer 501 with `serviceUnavailableMessage('ai')` verbatim (never 404, never
503), `/ai/agents` still returns the declared envelope with the payload
relocated under `data.agents`, and the 501 body stays string-identical to what
`/discovery` reports for the `ai` slot.
