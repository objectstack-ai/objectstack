---
"@objectstack/runtime": patch
---

fix(runtime): consult the anonymous-deny gate before `/security`'s capability answer (#7911)

On any deployment where the `security` slot is empty or its occupant does not
duck-type `ISecurityService`, an **unauthenticated** caller to
`/api/v1/security/suggested-bindings` got **503 "Security service not
available"** instead of **401 UNAUTHENTICATED** — a capability disclosure
served ahead of this admin surface's own "anonymous is denied
UNCONDITIONALLY" rule (#2567, #3963).

`handleSecurityRequest` resolved the `security` service and returned the 503
for an empty/non-duck-typing slot *before* reaching the
`!ec || shouldDenyAnonymous(...)` gate ~20 lines below. `/security` stands on
the same anonymous-deny floor as `/data`, `/meta`, `/actions` and
`/automation` (ADR-0056 D2 → #3963); this was the last of the six dispatcher
domains still ordered the wrong way, after `/ai/**` (#7653, fixed in #7910).

The gate now runs first and decides once; the `!ec` arm is unchanged
(documented `#4127 batch 3` as behaviour-preserving) so the hoist changes
*when* the decision is made, not *what* it decides. The 503 answer is
unchanged for an authenticated caller against an empty/stubbed slot, and a
serveable slot still works for an authenticated caller and still denies
anonymous. No route-level `auth: false` opt-out exists on this domain, so
there is a single consult site.
