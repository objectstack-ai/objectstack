---
"@objectstack/runtime": patch
"@objectstack/client": patch
---

Route ledger + conformance guard for the dispatcher↔client surface (#3563)

#3528's root-cause class — a route that exists and works while
`@objectstack/client` has no way to express it — now has an inventory and a
ratchet. `route-ledger.ts` records the audited disposition of every dispatcher
route (sdk / gap / server-only / public / dynamic / mismatch);
The guard is split along the package boundary (a runtime→client edge is a
build cycle): runtime's `route-ledger.conformance.test.ts` fails when a
dispatcher domain lands with no ledger entry and ratchets the audited gap
count (27 at PR-1); client's `route-ledger-coverage.test.ts` fails when a
ledger entry claims a client method that doesn't exist. Findings and follow-up slicing live
in `docs/audits/2026-07-dispatcher-client-route-coverage.md`. No runtime
behavior change.
