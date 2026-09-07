---
'@objectstack/objectql': patch
---

fix(objectql): the audit binder stamps `created_at` from the system clock on an ordinary create, so a caller-supplied value no longer survives a plain `POST` (#15964)

The `beforeInsert` audit stamp was `record.created_at = record.created_at ?? now` — client-preferred on every insert, with no flag and no privilege required. Since the static-`readonly` strip moved INSIDE `engine.insert` (2026-09-03 ruling, option C) it runs AFTER the before-phase hooks, and its guard treats a key a `beforeInsert` hook ASSIGNED as the hook's write rather than a caller forgery. The `??` therefore laundered the caller's bytes past that strip: a normal authenticated `POST /api/v1/data/OBJECT` carrying `created_at: '1999-01-01T00:00:00.000Z'` stored exactly that on an object declaring `created_at` as `readonly: true`, while `id`, `updated_at` and every other author-declared readonly datetime in the same payload were taken. `created_at` is the audit anchor, so a forgeable one makes after-the-fact attribution untrustworthy.

The stamp now takes the same shape as `updated_at`:

```ts
record.created_at = preserveAudit ? (record.created_at ?? now) : now;
```

**What changes for a caller.** An ordinary create no longer preserves a supplied `created_at` — the value is overwritten with the server instant rather than deleted, so the column is still a real stamp and no `defaultValue` re-derivation is involved. This narrows the accept set to the `readonly` contract the field already documents; no exported symbol, schema or config key moves.

**The historical-import channel is unchanged and pinned.** `runImport({ treatAsHistorical: true })` sets `preserveAudit: true` on the write context (`@objectstack/rest`), and that branch still reinstates an original `created_at`, exactly as it has reinstated `updated_at`/`updated_by` since #3493. This is why the fix is the `preserveAudit` ternary rather than a bare `= now`. The create-side strip still does not read `preserveAudit` (2026-08-08 ruling, untouched): the preservation is the audit binder's, and it always was.

**A creator that back-dated rows through the old `??` must now ask for it.** Any insert path that supplied a historical `created_at` without `preserveAudit` now gets the server instant. The remedy is one context key on the write (`preserveAudit: true`), the same one `treatAsHistorical` sets.

Ruled by the maintainer on 2026-09-06 (decision batch #54, option A).
