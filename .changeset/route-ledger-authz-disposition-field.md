---
'@objectstack/rest': patch
'@objectstack/runtime': patch
---

Route ledger rows can declare their reviewed authorization posture

`RestRouteLedgerEntry` and `RouteLedgerEntry` gain an optional `authz` field
naming the authorization-conformance row that classifies the route. It is
phased exactly like `responseSchema` in the same two files: optional, filled
only where conformance coverage already exists, never mass-produced. Five rows
are seeded; the rest stay undeclared.

Both modules are package-internal (neither type reaches either package's
published `.d.ts`), and nothing reads the field at runtime — the authorization
conformance ratchet resolves every declaration against the live matrix and
refuses a name that is not an `enforced` row.
