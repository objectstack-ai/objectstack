---
"@objectstack/service-cluster": minor
---

feat(service-cluster): the multi-node gate can carry an admitted node count, so a license cap can refuse the excess replicas instead of the whole cluster (#8367)

`registerMultiNodeGate` consumed `{ allowMultiNode(): { allowed, reason } }` — a
bare boolean verdict with **no node count in the contract**. The maintainer ruled
on 2026-08-13 (recorded on `objectstack-ai/cloud#1275`) that a licensed
`max_nodes` overflow must **refuse the excess replicas, run up to the paid limit,
and warn loudly** — explicitly *not* a whole-cluster degrade. Through a boolean
gate that verdict could not be stated at all: the only refusal a license could
express was `allowed: false`, which is precisely the whole-cluster degrade the
ruling rejects.

A gate verdict may now carry `admitted` — how many nodes it admits — and
`checkMultiNodeAllowed(requested?)` forwards the caller's intended node count to
the gate and returns a normalized verdict:

```ts
{ allowed: boolean; reason?: string; admitted?: number; refused: number; capped: boolean }
```

`refused` and `capped` are **totalized** (always present), so no consumer writes
`?? 0` over a third-party gate's output — the seam normalizes non-finite,
fractional and negative counts itself. `capped` marks only a **partial** refusal:
it stays `false` for an outright `allowed: false`, so the licensed-overflow case
and the unlicensed case cannot be conflated by a consumer.

**Backward compatible.** `requested` is an optional parameter and `admitted` an
optional return field, so an existing zero-arg, boolean-shaped provider — the
shape `@objectstack/security-enterprise` registers today — remains valid and is
interpreted as "no count-based cap": it admits everything requested rather than
having a refusal invented for it. Existing zero-arg call sites are unaffected.

**⚠️ The count is advisory at this seam — it is not yet enforcement.** The gate
is consulted once per process, at boot, by each replica independently, and at
that moment a replica has no cluster membership view (`nodeId` is random per
process; nothing tracks live nodes) and no ordinal — the only count available is
the operator-declared `OS_CLUSTER_REPLICAS`, identical in every replica. So every
replica computes the same verdict and none can tell whether *it* is one of the
admitted N or one of the excess. Binding enforcement additionally requires an
atomic slot claim against the shared cluster primitives this package already
ships (`ILock`/`ICounter`/`IKV`), which is tracked separately. Until then,
consumers should treat `refused > 0` as the trigger for the loud warning the
ruling requires, never as grounds to deny the cluster.
