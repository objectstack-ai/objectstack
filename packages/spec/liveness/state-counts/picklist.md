<!-- GENERATED — DO NOT EDIT BY HAND. -->
<!-- Regenerate: pnpm --filter @objectstack/spec gen:liveness-counts -->

# `picklist` — liveness counts (generated)

This type's row of the liveness state table, computed by the gate that enforces
it (`scripts/liveness/check-liveness.mts --json`, `types.<type>.byStatus`). Its
Notes prose is the `picklist` row of [the ledger README](../README.md), which
also states the counting method. One file per governed type, and no total is
committed anywhere: `check:liveness` sums the shards when it reads them.
**Never hand-patch a number here** — fix the ledger or the schema and regenerate.

| Type | live | exp | elsewhere | dead | planned | classified |
|---|---|---|---|---|---|---|
| `picklist` | 7 | 0 | 0 | 0 | 9 | 16 |
