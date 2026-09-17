---
'@objectstack/spec': patch
---

`AnchorBindingContext`'s boot half names the stack's capability DECLARATIONS, not the `sys_capability` rows the seeder has not written yet

The docblock named two sources for `declaredCapabilities`: at boot 「the
`sys_capability` rows carrying `managed_by: 'package'` provenance」, at authoring
time the stack's own `capabilities` array. The boot half carried an ordering
precondition the sentence never stated, and a caller following it literally
lands on the defect the input exists to remove.

`runBootstrap` (`@objectstack/plugin-security`) awaits `bindBaselineToEveryone`
— the ADR-0090 D5 anchor binding, the boot call site that consults
`describeHighPrivilegeBits` — BEFORE it calls `bootstrapDeclaredCapabilities`,
the seeder that WRITES those `managed_by: 'package'` rows. The order is fixed by
two other constraints stated at that call site: the binding must follow the
seeding of the `everyone` anchor it binds to, and precede the audience-binding
suggestion reconciliation. So on a first boot the table is EMPTY at exactly the
moment the docblock said to read it, and this docblock's own 「omission refuses」
property turns that emptiness into a silent refusal of every declared token —
the app's own `isDefault` set unbindable at the `everyone` anchor, which is the
defect #17811 introduced the input to remove.

The boot half now names the DECLARATIONS, read through the seeder's own two-step
— the ObjectQL registry first, the metadata service as the fallback — which is
what `readDeclaredCapabilityContext` (`@objectstack/plugin-security`, #18535)
already implements, so the contract text and its one runtime consumer now
corroborate each other instead of contradicting. The `sys_capability` rows stay
a valid source, qualified: only once the seeder has written them, which is where
an admin-surface or post-boot caller reads them.

⛔ No behaviour changes. The diff is comment text: `git diff` against the branch
point over `src/security/high-privilege.ts` changes **0** non-comment lines (the
same predicate reads 33 on that file's own #17811 commit, which is the control
proving it fires). No predicate, no type, no export, no accept set moves.

**This is shipped, which is why it carries a changeset rather than
`skip-changeset`.** `src/security/high-privilege.ts` is NOT shipped as source —
`@objectstack/spec`'s published `files[]` takes `src/**/*.zod.ts`, and this file
is not one (`npm pack --dry-run` lists 2021 files and excludes it, with the
sibling `src/security/permission.zod.ts` present as the lit control). Its
published reach is the emitted declarations, and they move: the new clause is
present in `dist/security/index.d.ts` and `dist/security/index.d.mts`, both in
that same shipped list, with the superseded spelling absent from every built
declaration file and the docblock's unchanged neighbouring sentence present in
the same two as the lit control.
