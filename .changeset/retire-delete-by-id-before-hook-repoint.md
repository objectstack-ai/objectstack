---
"@objectstack/objectql": major
"@objectstack/spec": patch
---

<!-- adr-0087: registered delete-by-id-before-hook-repoint-retired -->

feat(objectql)!: retire `delete()`'s by-id `beforeDelete` REPOINT, aligning it with `update()` (#6752)

A `beforeDelete` handler on a **by-id** `delete()` may no longer move the
delete onto a different row by assigning `ctx.input.id`. The rebind is
**refused** with `HookTargetRebindError` / `ERR_HOOK_TARGET_REBIND`
(`path: 'by-id'`) — exactly what the `update()` twin and both per-row paths
already raised. Nothing is deleted, and `afterDelete` and the roll-up
recompute never run.

**The rule is now one line, on both verbs: a by-id target is immutable in a
`before*` handler.**

|                    | CLEARED id     | REBOUND to another id     |
| ------------------ | -------------- | ------------------------- |
| `update()` by-id   | refused        | refused                   |
| `delete()` by-id   | refused        | **refused** (was honoured)|
| either, per-row    | refused (D4)   | refused (D4)              |

**Removed keys and their prescriptions (FROM → TO):**

| Wrote | Write instead |
| --- | --- |
| `beforeDelete` handler: `ctx.input.id = otherId` | `await ctx.ql.delete(object, otherId)` for that row explicitly, and let the addressed delete proceed — or `throw` from the handler to stop it |
| `beforeDelete` handler repointing to delete a set | have the **caller** pass `{ multi: true, where: … }` |

Writing the **same** id back is unaffected and stays legal: the check is
`input.id !== id`, the `update()` check verbatim, so a handler that reads the
id or assigns it to itself is not caught.

**This removes a capability that WORKED, and the reasoning has to be read that
way.** `delete()` had a re-resolution for a repointed target since #5272: it
re-read the new target's pre-image and rebound `previous`, so `afterDelete` and
the summary recompute saw the row actually deleted. Nothing stale ever leaked,
and the case that retires a rebind on `update()` — the write landing on a row
whose pre-image, `readonlyWhen` locks and validation rules were never evaluated
— did not apply to it. That is why #5574's engine half (PR #6697) deliberately
left the asymmetry standing and filed it as its own question.

The 2026-08-09 maintainer ruling on #6752 retires it anyway, on three measured
axes:

- **Compatibility cost, measured: zero.** A repository-wide grep for assignments
  into a hook's `input.id`, re-run on this PR's base rather than inherited,
  finds six sites and all six are this family's own pins. No consumer anywhere
  repoints — not in the framework, plugins, examples or docs.
- **One rule beats two correct rules.** Two verbs answering the same slot
  differently is something every hook author must hold in memory, and the
  justification for the split lived in an ADR, not at the call site.
- **The surface is a footgun independent of the mechanism.** "A hook silently
  redirects which row gets deleted" is a top-grade hazard for authored — and
  especially AI-authored — handlers. Correctness of a mechanism does not justify
  the surface it exposes.

Aligning the other way — building `update()` the same re-resolution — stays
excluded by #5574's recorded ruling ("do not silently pick re-resolution
instead").

The re-read block in `delete()`'s by-id branch is **deleted, not bypassed**: its
guard was `input.id !== id && input.id`, precisely the case the refusal now
throws on, so it became unreachable the moment the refusal landed. The single
pre-dispatch pre-image read that binds `previous` for `beforeDelete` is a
different read and is untouched.

Recorded as **ADR-0058 Amendment II.2**; the `hook-target-rebind-errors.ts`
"what this does NOT cover" section is gone, because there is no longer an
exception to remember. The #5272 pin asserting the repoint was honoured is
**flipped to assert the refusal**, not deleted, with a new negative control
pinning that a same-id rewrite stays legal.

Supersedes the scope note in the pending `bulk-write-before-hooks-per-row`
changeset ("a `beforeDelete` handler that repoints the target is unaffected"),
which described PR #6697's deliberate carve-out and is closed by this change in
the same release.
