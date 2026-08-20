<!-- GENERATED — DO NOT EDIT BY HAND. -->
<!-- Regenerate: pnpm --filter @objectstack/spec gen:liveness-counts -->

# Liveness state table — the counts (generated)

Every number the [liveness ledger README](./README.md)'s "Current state" table
used to publish, computed by the gate that enforces them —
`scripts/liveness/check-liveness.mts --json`, `types.<type>.byStatus`, the
counting method fixed in #4488. The Notes prose, which is hand-written
measurement of how each type got where it is, stays in the README and is never
regenerated.

Split out at #7377 on #5107's precedent. Nine of the thirty rows had drifted
from the gate by the time anyone re-ran the documented snippet, and
hand-maintained counts merge in the one way that hides: two PRs each move a
different row by their own correct delta, the rows do not overlap, git merges
them without complaint, and the result is a table nobody wrote down. The
correct resolution was always "recompute from the merged tree", so this path
carries `merge=os-regen` (#4675) and the recomputation is mandatory rather than
remembered. **Never hand-patch a number here** — fix the ledger or the schema
and regenerate.

Counts are at the gate's one-level walk granularity and include the ADR-0010
protection envelope, which the gate auto-classifies `live` on every type that
spreads `MetadataProtectionFields`. See the README's counting-method section
for both corollaries.

| Type | live | exp | dead | planned | classified |
|---|---|---|---|---|---|
| `object` | 50 | 0 | 0 | 1 | 51 |
| `field` | 88 | 0 | 0 | 2 | 90 |
| `flow` | 34 | 0 | 6 | 0 | 40 |
| `action` | 42 | 0 | 2 | 2 | 46 |
| `hook` | 18 | 0 | 2 | 0 | 20 |
| `permission` | 38 | 0 | 4 | 0 | 42 |
| `position` | 12 | 0 | 0 | 0 | 12 |
| `agent` | 21 | 4 | 1 | 0 | 26 |
| `tool` | 13 | 1 | 0 | 0 | 14 |
| `skill` | 16 | 0 | 1 | 0 | 17 |
| `dataset` | 27 | 0 | 0 | 0 | 27 |
| `page` | 23 | 0 | 0 | 1 | 24 |
| `view` | 77 | 0 | 9 | 1 | 87 |
| `report` | 21 | 0 | 0 | 0 | 21 |
| `dashboard` | 34 | 0 | 7 | 0 | 41 |
| `webhook` | 19 | 0 | 0 | 0 | 19 |
| `query` | 15 | 1 | 5 | 0 | 21 |
| `datasource` | 30 | 0 | 0 | 0 | 30 |
| `app` | 47 | 0 | 9 | 0 | 56 |
| `book` | 20 | 0 | 1 | 0 | 21 |
| `doc` | 15 | 0 | 0 | 0 | 15 |
| `email_template` | 21 | 0 | 0 | 0 | 21 |
| `job` | 15 | 0 | 0 | 0 | 15 |
| `mapping` | 14 | 0 | 0 | 0 | 14 |
| `seed` | 12 | 0 | 0 | 0 | 12 |
| `translation` | 19 | 0 | 0 | 2 | 21 |
| `validation` | 15 | 0 | 3 | 0 | 18 |
| `api` | 25 | 0 | 0 | 2 | 27 |
| `capability` | 12 | 0 | 0 | 0 | 12 |
| `qa` | 4 | 0 | 5 | 0 | 9 |
| **total** | **797** | **6** | **55** | **11** | **869** |
