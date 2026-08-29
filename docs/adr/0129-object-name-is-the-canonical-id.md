# ADR-0129: Object `name` is the canonical id — literal module prefix, no separate `namespace` field

**Status**: Accepted (2026-08-29; maintainer ruling on #12918, option 甲 — recorded as one
convoy with #12786). This ADR **records an already-enforced, platform-wide decision**; it
changes no shipped behavior. The contract below has been enforced since the parse path was
closed by #4001 and is restated by Prime Directive #6 in `AGENTS.md` — what was missing was
the decision record itself, and that absence is what produced the phantom citation this ADR
closes (see § History).
**Deciders**: ObjectStack maintainer (2026-08-29), recording a contract in force since #4001.
**Relates to**: [ADR-0028](./0028-metadata-naming-and-namespace-isolation.md) (the **Deferred
target model** pointing the opposite way — reconciled in D4 below),
[ADR-0048](./0048-cross-package-metadata-collision.md) (cross-package collision-proofing of
the literal prefix), ADR-0006 (the record the phantom letter was mis-attributed to — the
project/environment split, which never decided object naming), #4001 (parse-path closure),
#4522 (tombstone), #12913 / #12917 / #12918 (the 2026-08-28 incident and its remediation).
**Consumers**: `@objectstack/spec` (`data/object.zod.ts`, `stack.zod.ts`,
`kernel/namespace-prefix.ts`, `system/translation.zod.ts`), `@objectstack/objectql`
(`SchemaRegistry`, `StorageNameMapping`), every SQL driver, `@objectstack/rest`, the client
SDKs, and every metadata author — human or AI.

---

## TL;DR

The object `name` is the **only** identity an object has, everywhere. The module prefix is
part of the name the author writes (`sys_user`, `crm_account`), validated against the
package's declared namespace. There is **no** separate `namespace` field on the object
document — the key is retired and **rejected on the parse path** with a prescription. This
page exists because the decision was enforced for months with no ADR recording it, and an
unwritten decision manufactures phantom citations (§ History).

---

## Decision

### D1 — The object `name` IS the canonical id everywhere

One string is the object's identity across every surface: the API, ObjectQL, REST routes,
the client SDKs, and the **database table name**. There is no logical/physical split and no
parallel identity dimension: `StorageNameMapping.resolveTableName` is a pass-through
(`packages/spec/src/system/constants/system-names.ts`; every SQL driver routes through it),
and the object document carries no `tableName` field — the table name always equals `name`
(pinned by `packages/spec/src/data/object.test.ts`, "name-as-identity").

### D2 — The module prefix is embedded literally in the authored name

Authors write the full literal name — `sys_user`, `crm_account` — never a short name plus a
namespace. A package declares its prefix once (`manifest.namespace`), and every object it
defines MUST be named `${namespace}_${shortName}` (platform-reserved `sys_*` names exempt).
Enforced at **both** chokepoints from one shared rule
(`packages/spec/src/kernel/namespace-prefix.ts` — the single source, so the two cannot
drift):

- compile time — `validateNamespacePrefix()` in `packages/spec/src/stack.zod.ts`
  (`defineStack()` / `os validate`);
- runtime — `MetadataManager.publishPackage()` (Studio publish).

The literal prefix is collision-proof across installed packages (ADR-0048) and gives the AI
author exactly one writing style — the property the rule exists for.

### D3 — There is no separate `namespace` field; the key is retired and rejected loudly

The object document has **no** `namespace` key. It is retired with a tombstone: the strict
`ObjectSchema` rejects the key on parse, and the rejection message carries the fix
(`UNKNOWN_KEY_GUIDANCE.namespace` in `packages/spec/src/data/object.zod.ts` —
`namespace: "sys", name: "user"` becomes `name: "sys_user"`). Until #4001 closed the parse
path the key was **stripped in silence**, so an object declaring one shipped under the
unprefixed name its author never intended — the rejection is the fix for that failure mode,
not a style preference. The retirement is platform-wide: the translation contract rejects
the key the same way (`packages/spec/src/system/translation.zod.ts`), and Prime Directive #6
in `AGENTS.md` states the authoring rule for every agent working this repo.

### D4 — Reconciliation with ADR-0028: this is the governing record until 0028's re-open trigger fires

[ADR-0028](./0028-metadata-naming-and-namespace-isolation.md) records the **opposite**
model — namespace as an identity dimension, short authored names, derived physical names
(its D1–D6). That model is a **Deferred target design, entirely unbuilt**, by 0028's own
status line, which also records the literal-prefix current state as "enforced,
collision-proof (ADR-0028/0048), and working" and names a re-open trigger (real
multi-package ecosystem naming pain). The two records do not conflict: 0028 is a deferred
design, this ADR is the enforced present. **Until 0028's recorded re-open trigger fires,
this ADR is the governing record of object naming.** If 0028 is ever adopted, the adopting
work must supersede this record explicitly (Prime Directive #13) — never drift past it.

---

## History — why this record exists

The contract above was enforced with **no ADR recording it**. When #4522 added the
tombstone's rejection message, its author needed a provenance for a real, enforced decision,
found none, and minted one: a phantom decision letter — spelled "D4" — attributed to
ADR-0006, a record that never decided object naming and declares no such letter. The
citation survived for months because the ADR-0006 family declared no letters at all, so
`check:adr-anchors` had nothing to contradict — until #12736 minted D1–D3 for ADR-0006's
API-surface addendum (2026-08-28), at which point the phantom became mechanically
unresolvable and every merge-queue build went red (#12913; emergency one-string fix
#12917). #12918 recorded the root cause: **the decision was real, enforced, and unwritten**
— and the gate's own remedy text says what to do about that: "if the decision is real but
unwritten, it needs an ADR, not a citation." This is that ADR. The surviving spellings
re-point here (the letter to cite for the retirement is **D3**); `packages/spec/CHANGELOG.md`
keeps its historical copies untouched.

## Consequences

- The retirement finally has a citable record: rejection messages, tests, and code comments
  cite **ADR-0129 D3** instead of a phantom, and `check:adr-anchors` can verify them.
- The next author (or AI) who asks "why can't `namespace` come back?" finds a decision, not
  an enforcement with no paper trail — the failure mode that produced the phantom does not
  re-arm.
- ADR-0028's Supersedes-line note ("there is no standalone ADR for that rule today") is
  corrected by this record's existence; nothing else in 0028 changes, and its Deferred
  status and re-open trigger stand exactly as written.
