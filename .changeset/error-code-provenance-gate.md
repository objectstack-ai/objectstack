---
"@objectstack/spec": patch
---

Error-code ledger: provenance rows and a provenance gate (#13353). Four adjudicated owner-key rows land for packages that already stamp registered codes on their own wire doors — `@objectstack/plugin-webhooks` / `INVALID_REQUEST`, `@objectstack/cloud-connection` / `FORBIDDEN`, `@objectstack/cli` / `ENVIRONMENT_NOT_FOUND`, `@objectstack/trigger-api` / `INVALID_REQUEST`. The registered union is unchanged (every code was already registered under another package), so `ErrorCode` accepts and rejects exactly what it did before — the rows are provenance only. A new mechanical gate (`check:error-code-provenance`) sweeps `packages/**` non-test source and fails any stamp site of a registered code the stamping package's own owner key does not list; deliberate "the door, not the producer, names the wire vocabulary" splits are recorded in the new exported `PROVENANCE_WAIVERS` table (with `ProvenanceWaiverSchema`), held live by the gate in both directions.
