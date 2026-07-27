---
"@objectstack/client": minor
"@objectstack/rest": patch
---

feat(client): close the sharing-rules (5) + security-explain (2) + search (1) REST gaps (#3587 batch 4/5)

New `client.shares.rules` sub-namespace for tenant-wide sharing rules
(M10.17): `list` / `save` / `get` / `delete` (204-safe, grants cascade) /
`evaluate` (reconcile). `client.security.explain` speaks the ADR-0090 D6
access-explanation contract via the POST transport (the GET query form is the
same `ExplainRequestSchema`). Top-level `client.search` covers global
cross-object search (M10.5). REST route-ledger ratchet: 17 → 9.
