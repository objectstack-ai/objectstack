---
"@objectstack/plugin-security": patch
---

**Perf:** the declared-capability boot seed and the environment permission-set overlay reconciler each pay ONE batched existence read instead of one per item, and stop re-writing rows that already match (#11096, #11097).

Both were read-then-write reconcilers over a set known in full before their loop started, and both had the shape #10946 removed from the permission-set and position seeders next door:

- `bootstrapDeclaredCapabilities` issued a `SELECT … WHERE name = ? LIMIT 1` per declared capability, then an `UPDATE` on its own row whether or not anything had changed;
- `reconcilePermissionSetProjection` projected every environment-scope `permission` overlay in a per-name loop, each iteration issuing its own existence `SELECT` inside `upsertEnvPermissionSet` plus an unconditional `UPDATE`.

On a local file database these loops are invisible. On the remote libsql/Turso database every hosted environment runs, each leg is its own sequential HTTP request, and the capability set is typically the largest of the identity axes — it is the union of every capability every declared package contributes, not a count bounded by the number of permission sets.

Both now hoist one chunked `{ name: { $in: [...] } }` read out of the loop through `buildExistingByName`, which keeps the tri-state judgement that makes hoisting safe: **a read that could not ANSWER is not the answer "none of them exist"**. A batched read fails for the whole set at once, so collapsing those two would make a boot during a brief outage try to re-create everything; the seeders now decline the names they could not read, and say so.

**The write-skip is an equality test, and the reconciliation leg is pinned.** A row whose stored value genuinely differs still gets its `UPDATE` — a reconciler that skipped writes outright would show a perfect round-trip count while silently reconciling nothing, so every counting test added here is paired one-for-one with a drift test over the same fixture, and both pairs were ablated to confirm the drift half fails when the write is removed.

Two behaviour repairs the write-skip REQUIRED, both on the environment door — not optional polish, but corrections the equality test itself demands, verified by ablation (each one made a specific test fail when reverted):

- **`customized` is now compared, not just written.** The flag is provenance rather than definition, so `recordDiffersFromBody` deliberately does not compare it; skipping on the facets alone would have stopped maintaining a flag the Setup list badges on and the reset action reads. It gets its own comparison term, against the same `managed_by:'package'` condition the write uses.
- **A newly created environment-authored record is no longer born badged "customized".** The INSERT used to stamp the caller's raw overlay opinion (`!!customized`) while the UPDATE branch's rule stamps `false` for a non-package row — those two disagree for any fresh `managed_by:'admin'` row created while its overlay is still active. Before this changeset, that disagreement was invisible: every boot re-wrote every record unconditionally, so the very next reconciliation pass silently overwrote the wrong value back to `false`. Once writes are equality-gated, that disagreement stops being invisible and becomes a REAL, PERMANENT one-boot-late corrective `UPDATE` after every such creation — the "steady state" round-trip count is not actually flat without this fix. Confirmed on this branch: reverting it to `!!customized` fails `#11097 — env overlay reconciliation: round trips > does not grow the steady-state round-trip count` and `#11097 — drift STILL reconciles > only the DRIFTED overlay is written` (both start seeing a real `UPDATE` on the boot immediately after any overlay-backed admin row is created).

`projectPermissionMutation` also syncs the in-memory evaluator registry on an unchanged record, not only on a write. That sync is not a database round trip, and the evaluator resolves permission sets registry-first — gating it on "a write happened" would have left a steady-state boot enforcing the stale declared body while the record and Setup showed the overlay.

⚠️ **This is a behaviour change beyond the write COUNT**, flagged explicitly: today, a brand-new environment-authored permission set with no package baseline can be observed `customized: true` for the one boot between its creation and the next reconciliation pass (or, on the live write-through door, self-heals within the same request). After this changeset it is never observed `true`. The change is required for the round-trip fix's own steady-state claim to hold on this path — the two are not separable — but it is a resulting-STATE change, not merely a write-count change, and is called out here for that reason.

⚠️ **No curve number is claimed for either axis.** The hosted `bootstrap-curve.mjs` rig lives in `objectstack-ai/cloud` and neither of these axes has ever been measured on it. What is established is that the code shape is the one measured at slope 4.0000 / R² = 1.000000 on the two sibling loops in #10946, and that the round-trip COUNT is now flat in the number of declared items — which is what the new tests assert, in counts, never in wall time.
