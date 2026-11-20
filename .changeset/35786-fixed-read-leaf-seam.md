---
'@objectstack/spec': patch
'@objectstack/core': patch
'@objectstack/objectql': patch
---

feat: the engine's seam for the fixed-read leaf, and the driver declaration for it (ADR-0155, step 2 of 6)

Clause-②: yes
Metadata-protocol: none

No visible change on its own: nothing on main writes a fixed-read leaf yet (the sharing plugin starts writing `SharedRecordIds` at ADR-0155's last step), and no driver declares one (the SQL drivers and the memory driver declare it on the steps that compile it).

- **The driver declaration** (`@objectstack/spec`). `DriverCapabilities.fixedReadLeaves` lists the fixed-read leaves a driver's filter compiler evaluates exactly, by name, e.g. `['SharedRecordIds']`; absence means none. The names are `FIXED_READ_LEAF_NAMES`, and `fixedReadLeafNameOf(leaf)` maps a leaf to its name. It stays separate from `readableIdsLeaf`: a `ReadableIds` leaf is not a fixed-read leaf, and a driver that evaluates both declares both. Both descriptions now say so.
- **The seam** (`@objectstack/objectql`). The engine's comparand door admits a branded `SharedRecordIds` leaf as a `$in` comparand, and the engine hands it to the driver by reference only when it sits on `id` of the object it names (directly, or inside a composed `ReadableIds` scope over that object), on a read verb in its read form or in a predicate update's `where` in its write form, for the context's user or its delegator (a system context is exempt), outside both classes ADR-0155 D4 recognises (the object on another datasource than `sys_record_share`; a middleware or a `beforeFind` / `afterFind` hook registered for `sys_record_share` by name), and to a driver whose `fixedReadLeaves` names it. Anything else is refused before any driver is asked, `INTERNAL_ERROR` / 500, logged at `error` once per evaluator. An unbranded copy is still refused at the door as a non-list comparand, `INVALID_FILTER` / 400.
- **The refusal** (`@objectstack/core`). `fixedReadLeafRefusal`, `refuseFixedReadLeafOnce` and `describeFixedReadLeaf` are the one envelope every evaluator answers a fixed-read leaf it will not run with; `logRefusalOnce` is the once-per-instance log it shares with the `ReadableIds` refusal.
- **Filter tokens** (`@objectstack/core`). `resolveFilterTokens` returns a fixed-read leaf by reference, as it does a `ReadableIds` leaf, so a read scope that carries a placeholder beside the leaf keeps the leaf's brand.
