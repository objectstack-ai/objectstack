---
"@objectstack/plugin-auth": patch
"@objectstack/client": patch
---

test(plugin-auth): enumerate better-auth's route table — the `/auth/**` wildcard becomes 55 exact rows (#3656)

The widest hole the #3642 capstone measured. That guard reports how many SDK
calls match only a `**` prefix family rather than a resolvable route, and the
answer was 60 of ~196 — with 54 on `* /auth/**`, the largest and most
security-relevant namespace in the client. `auth.me` builds
`/api/v1/auth/get-session`; a prefix claim cannot tell you better-auth still
calls it that, and better-auth is a third-party dependency on its own release
cadence (this repo already chased its 1.7 column drift in #3624 / #3647).

`plugin-auth` mounts it with a single catch-all, so there are no per-route
registration calls to capture the way tranche 3 captured
`registerStorageRoutes`. The seam is `auth.api`: every better-auth endpoint
carries `.path` and `.options.method`, so a live instance is the route table.

`auth-route-ledger.ts` reads it, in two halves checked differently on purpose:

- **55 reviewed rows** — every route the SDK calls, each naming its client
  method, checked strictly against the live table. This is the rename detector.
- **129-path mounted-surface inventory** — checked for exact equality both
  ways, so a version bump that adds publicly-mounted auth endpoints becomes a
  reviewable CI diff. Machine-maintained rather than reviewed prose: demanding
  a rationale for all 129 would make every better-auth upgrade a hundred-row
  review and the ledger would rot into rubber-stamping.

Enumeration is config-dependent, so the inventory is pinned at the
configuration enabling every plugin the SDK targets — the maximal surface —
with the participating `OS_*` env vars cleared so a developer's shell cannot
produce a spurious diff. Mutation-checked: renaming a ledgered route fails the
suite naming it.

The capstone guard now includes this ledger in its union and prefers exact rows
over wildcard families when matching — without that ordering fix every
`/auth/*` URL would still have been absorbed by `* /auth/**` and the new ledger
would have changed nothing. Wildcard-only matches fall **60 → 3**; the ratchet
moves with them. What remains is `* /ai/**`, whose routes `service-ai` builds
at plugin start.

No runtime change: a ledger, a guard, and the header/audit-doc notes.
