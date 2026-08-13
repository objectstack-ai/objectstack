# ADR-0001: Withdrawn — this number is retired and must not be reused

**Status**: **Withdrawn (2026-02-11)**. This file is a *tombstone*, not a decision: nothing in it is in force, and the number must never be reassigned.
**Deciders**: ObjectStack Protocol Architects (recorded retroactively — see [How this differs from ADR-0107](#how-this-differs-from-adr-0107))
**The record that held this number**: *"Metadata Service Architecture"* — `docs/adr/0001-metadata-service-architecture.md`, Status *Accepted (2026-02-10)*
**Landed by**: `908d95c82`, 2026-02-10 09:14 UTC
**Deleted by**: `9da8e3e72`, 2026-02-11 23:35 +0800, about thirty hours later — a 37-path documentation sweep, not an ADR decision
**Tracking**: [#7329](https://github.com/objectstack-ai/objectstack/issues/7329) (the citation-resolution work that named this case), [#7866](https://github.com/objectstack-ai/objectstack/issues/7866) (this tombstone), [#6634](https://github.com/objectstack-ai/objectstack/issues/6634) (the squat failure mode both are written against)
**Consumers**: none. No code is governed by this number, and none may be — see [Do not anchor to this number](#do-not-anchor-to-this-number).

---

## TL;DR

A real record occupied ADR-0001 on `main` for about thirty hours in February 2026 and
was then deleted. Unlike [ADR-0107](./0107-withdrawn-hook-body-write-set-static-gap.md),
it was **not withdrawn on the merits** — it was swept away as collateral in a bulk
documentation cleanup that took the entire `docs/adr/` registry with it, including its
`README.md` and the ADR-0002 of that era.

This file exists so the number resolves to that explanation instead of to nothing, and so
it is never handed to an unrelated decision. Reassigning it would retroactively re-point
every historical "ADR-0001" at a document its author never meant — the squat failure mode
[#6634](https://github.com/objectstack-ai/objectstack/issues/6634) was filed for, where
one number had silently accumulated 77 citations it did not resolve.

**A new record takes the next free number. Not this one.**

## What happened

| When | What | Evidence |
|---|---|---|
| 2026-02-10 09:14 UTC | `docs/adr/0001-metadata-service-architecture.md` written and merged, Status *Accepted*, authored by an automated agent | `908d95c82` |
| 2026-02-11 23:35 +0800 | Deleted, together with `docs/adr/0002-database-driven-metadata-storage.md` and `docs/adr/README.md`, inside a 37-path docs sweep | `9da8e3e72` |
| 2026-08-08 | The bare number is grandfathered onto `check-adr-anchors`'s citation allowlist, pending this tombstone | [#6634](https://github.com/objectstack-ai/objectstack/issues/6634) |
| 2026-08-11 | [PR #7838](https://github.com/objectstack-ai/objectstack/pull/7838) makes a tombstone refuse *anchors* while still resolving *citations*, and leaves this number open because it needs a file under `docs/adr/` | [#7329](https://github.com/objectstack-ai/objectstack/issues/7329) |

The deleting commit's subject is *"feat(docs): add comprehensive analysis of Permission
Protocol with AI-enhanced security controls and RLS implementation"*; its body is empty
and it names no ADR. Alongside the registry it removed the whole `docs/METADATA_*`
documentation family and the `examples/metadata-objectql` package. **No reasoning for
retiring the decision was recorded anywhere**, which is the substantive difference from
ADR-0107 and the reason this tombstone reconstructs the record from the tree rather than
quoting a withdrawal.

## Do not resurrect it

Independently of how it was deleted, the record's substance is now **contradicted by
shipped code**, so restoring the text would plant a false statement in the decision log.

Its selected option was a **hybrid dual-provider** architecture: *both* `@objectstack/objectql`
and `@objectstack/metadata` may provide the `metadata` service, MetadataPlugin taking
precedence when loaded and **ObjectQL registering itself as the fallback provider** when
it is not. That fallback is exactly what the code stopped doing:

- **MetadataPlugin is the sole provider** of the `metadata` service — the one
  `registerService('metadata', …)` in the tree is
  [`packages/metadata/src/plugin.ts`](../../packages/metadata/src/plugin.ts).
- **ObjectQL is a consumer, never a provider.**
  [`packages/objectql/src/plugin.ts`](../../packages/objectql/src/plugin.ts) registers
  `objectql`, `data`, `manifest` and `lifecycle` — and no longer `metadata`. It reads the
  `metadata` service and degrades to its own internal registry when none is present,
  which is not the same thing as claiming the slot.
- **The shared-interface principle survived, as a spec contract**: `IMetadataService` in
  [`packages/spec/src/contracts/metadata-service.ts`](../../packages/spec/src/contracts/metadata-service.ts).

The live account of that surface is the "Metadata service architecture" section of
[`ARCHITECTURE.md`](../../ARCHITECTURE.md). Read that, never this file, for what is true
today. The withdrawn text is recoverable in full at
`git show 908d95c82:docs/adr/0001-metadata-service-architecture.md` and is deliberately
kept in history rather than reprinted here — a withdrawn record reprinted inside its own
tombstone reads as a record.

Note that the single-provider architecture which replaced it **has no ADR record of its
own**. That gap is real and is not closed by this file; re-homing it is a maintainer call.

## What ADR-0002 actually cites

Recorded because it is the first thing a reader arriving from ADR-0002 will want, and
because it was mis-stated in `check-adr-anchors.mjs` until this tombstone was written.

[`0002-environment-database-isolation.md`](./0002-environment-database-isolation.md) says,
of a rejected alternative: *"One global DB + tenant column. Was never on the table —
already discarded in v3.4's ADR-0001."* That is **not** a reference to the record above.
The record that held this number decided how the `metadata` *service* is registered and
says nothing about tenancy or database topology.

Two distinct things carry the string "ADR-0001" in this repository's past, and only one
of them was ever a file here:

- **The v3.4-era "ADR-0001" ADR-0002 is pointing at.** Nothing matching `*0001-*` was ever
  added under any path, on any branch, other than the metadata-service record — see
  [Archaeology](#archaeology). Today's ADR-0002 is itself dated 2026-04-19 and supersedes
  the v3.4/v4.0 per-organization database model, so its "v3.4's ADR-0001" is a reference to
  a pre-registry document that this repository has never contained.
- **`docs/adr/0001-metadata-service-architecture.md`**, the record this tombstone retires.

The citation is therefore historical narration rather than a pointer into `docs/adr/`, and
this file is what it now resolves to. Correcting ADR-0002's wording is an edit to an
accepted record and is deliberately not made here.

## Do not anchor to this number

`scripts/check-adr-anchors.mjs` requires every `ADR-NNNN` cited in a tracked file to name a
record under `docs/adr/`. This tombstone satisfies that check — deliberately, because the
citations below are legitimate references to a deleted record. It is **not** a licence to
cite ADR-0001 as governing anything: an anchor entry must state the invariant its ADR
decided, and this number decides nothing today.

The citations that exist are all discussion of the deletion itself:

- [`ARCHITECTURE.md`](../../ARCHITECTURE.md) — names the deleted path as plain text and
  states the current single-provider architecture in its place;
- [`0002-environment-database-isolation.md`](./0002-environment-database-isolation.md) —
  the v3.4 reference dissected above;
- `scripts/check-adr-anchors.mjs` — the gate, describing this case.

## Archaeology

Recorded so the next reader does not repeat it. Run against full history with the clone
**unshallowed** — a shallow clone silently answers "never existed", and the default clone
in this project's agent containers is 50 commits deep:

```bash
git fetch --unshallow
git log --all --diff-filter=AD -- 'docs/adr/0001*'   # -> exactly 2 commits, both above
git log --all --diff-filter=AD -- '*0001-*'          # -> the same 2 commits, any path
git log --all --oneline -S'ADR-0001'                 # -> 10 commits, all accounted for
```

**Nothing else ever claimed this number**, on any branch, at any time: the second query
widens the first from `docs/adr/` to the whole tree and returns the same two commits, so
there is no second era of "ADR-0001" as a file and no lost content beyond the record named
above.

## How this differs from ADR-0107

Both are tombstones and both are unreusable, but the two cases are not the same and the
distinction is worth keeping:

| | ADR-0107 | ADR-0001 |
|---|---|---|
| Why it left | Owner decision, reasoning stated in the withdrawing commit | Collateral in an unrelated 37-path docs sweep; no reasoning recorded |
| Lifetime | Nine hours | About thirty hours |
| Deciders line | The withdrawal was itself the decision | Reconstructed from the tree in 2026-08; nobody decided the number should retire at the time |
| Why not resurrect | Substance reversed by later shipped code | Same — the fallback-provider half is contradicted by the code today |

The shared conclusion is the one that matters: an ADR number that has ever named a record
does not become free again by that record's removal, however the removal happened.
