---
---

test+docs: harden and document the historical-import `preserveAudit` seam (#3493 follow-ups)

Follow-ups to #3493 / #3549 / #3556, no behavior change:

- **Real-SQLite end-to-end test** (`@objectstack/runtime`): wires the real ObjectQL
  engine to the real `SqlDriver` (better-sqlite3) and proves the `preserveAudit`
  seam the mock/in-memory drivers structurally cannot — that `context.preserveAudit`
  threads through `buildDriverOptions` and defeats the SQL driver's `updated_at`
  force-stamp on both the forward historical write and the undo restore, and that a
  business `readonly` field (`closed_at`) survives the engine strip all the way to
  disk. Includes the #3549 undo capstone (restore-under-preserveAudit rolls the
  timeline back; a plain restore re-stamps now — the bug #3556 fixed).
- **Docs**: the `treatAsHistorical` schema describe (`@objectstack/spec` → regenerated
  `references/api/export.mdx`) now documents all three effects — FSM skip (#3479),
  audit-timeline preservation (#3493), and undo mirroring (#3556) — instead of only
  the state-machine half; and `protocol/objectql/state-machine.mdx` gains a bullet on
  the symmetric undo behavior.

Describe-string + regenerated docs + a new test only — releases nothing.
