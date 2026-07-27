---
"@objectstack/runtime": patch
---

Route ledger + conformance guard for the dispatcher↔client surface (#3563)

#3528's root-cause class — a route that exists and works while
`@objectstack/client` has no way to express it — now has an inventory and a
ratchet. `route-ledger.ts` records the audited disposition of every dispatcher
route (sdk / gap / server-only / public / dynamic / mismatch);
`route-ledger.conformance.test.ts` fails when a dispatcher domain lands with no
ledger entry, when an entry claims a client method that doesn't exist, and when
the audited gap count (27 at PR-1) grows. Findings and follow-up slicing live
in `docs/audits/2026-07-dispatcher-client-route-coverage.md`. No runtime
behavior change.
