---
'@objectstack/cli': patch
---

`os validate`, `os build` and `os info` count the objects an ADR-0130 D4 / option-B project actually declares, so `--strict` stops refusing a conforming stack

`collectMetadataStats` — the one reader behind the metadata summary all three
commands print — counted every collection at the **top level only**. On an
option-B project (every definition inside `packages[]`, none flattened up) the
summary reported `Data: 0 Objects`, and `os validate` raised
`No objects defined — this stack has no data model` on a stack that declares a
data model.

Under `--strict` that warning is not cosmetic. Measured through the real
binaries on the card's repro, before:

```
os validate            exit 0    Data: 0 Objects
                                 ⚠ No objects defined — this stack has no data model
                                 ⚠ No apps or plugins defined — this stack may not do much
os validate --strict   exit 1    ✗ Strict mode: warnings treated as errors
os build               exit 0    Data: 0 Objects
os info                exit 0    Data: 0 Objects
```

and after, on the same stack:

```
os validate --strict   Data: 1 Objects  2 Fields
                       ⚠ No apps or plugins defined — this stack may not do much
```

A conforming project that also declares an app now exits **0** where it exited
**1**.

**The fix reuses the existing fold, and that is what keeps the count a union.**
`authoringRuleUnionStack` (`utils/stack-collections.ts`) is this package's one
resolution rule for a package-owned collection, and it is strictly additive: a
key the top level already carries wins, because in today's additive shape that
array already *is* the union. So an object reachable from both the top level and
a `packages[]` entry is counted once, never twice — a corrected number that
over-counts would be the same defect with the opposite sign.

**One behaviour change beyond the counts, in `os info` only.** The fold resolves
package order through `resolveArtifactPackageOrder`, whose ADR-0112 refusals are
deliberately not swallowed. `os validate` and `os compile` already drove that
seam on the same config above their summary call, so they are unchanged; `os
info` did not, and now reports a stack whose `packages[]` repeats a package id
as a named `422` (`DUPLICATE_ARTIFACT_PACKAGE`) instead of printing
`Data: 0 Objects` for an artifact it could not read.

⛔ No authorable key, spec schema or published export moves. A stack whose top
level carries its collections — every stack the platform emits today — gets a
byte-identical summary: the seam returns it by identity.
