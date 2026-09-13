---
"@objectstack/spec": minor
---

fix(spec): `PageSchema`'s rejection guidance stops prescribing `assignedProfiles` as a page gate (#16929)

The two wrong-layer prescriptions `PageSchema` hands an author at parse time both ended by pointing at `assignedProfiles`: the `visibleWhen` pointer said "or gate the page with `assignedProfiles`", and the `permissions` pointer said "reach it through `assignedProfiles`". Neither is true. `assignedProfiles` gates nothing.

Measured 2026-09-10 on `origin/main` `e1eee43beb` and objectui `3fbdd4a2d`: `assignedProfiles` has **zero readers** in this repo — every one of its 25 matching files is a declaration, a generated artifact, prose, a `CHANGELOG`, the liveness ledger, or this schema's own round-trip test — and **zero readers** in objectui, whose three hits are a docs table row and two type/zod declarations. Lit controls in the same sweeps (`visibleWhen` 308 files, `PageSchema` 94 files in objectui; `visibleWhen` 168 files here) prove the instrument fired; a fabricated dark control read 0 in both. The key is also named for the concept **ADR-0090 D2** removed, which `security/permission.zod.ts` states to authors three times over.

Prescribing it was Prime Directive #10's exact prohibition — advertising a capability the runtime does not deliver — delivered to the author in the error that is supposed to be teaching them the correct spelling. Both prescriptions now say only what the platform actually does: put `visibleWhen` on the component inside a region, and gate the DATA a page shows with the object's permission sets.

**Nothing about what `PageSchema` accepts changes.** `assignedProfiles` remains an authorable key with its declaration untouched, and the `profiles:` / `assignedTo:` alias entries are untouched. Both channels edited here fire only from the `unrecognized_keys` path, so every key involved is rejected before this change and rejected after it, with identical `issue.code` and identical `path` — only the human-readable text moves. The key's own disposition (keep, rename, or remove) needs a ruling and stays open on #16929.
