---
"@objectstack/platform-objects": patch
---

Move both authored `record:alert` gates off `properties.visible` onto the
component-node `visibleWhen`, `has()`-guarded and served as a CEL envelope
(#9167) — the `sys_user` detail page's "Email not verified" banner, and the
showcase Task Detail page's "Awaiting review" banner.

`record:alert` is the one record component that declares a props-level
`visible` predicate, but `PageComponentSchema.properties` is an opaque record:
the bag is served verbatim, so a bare string in `visible` never reaches
`ExpressionInputSchema` and is evaluated by the console's **legacy JS**
evaluator, which has no `has()`. The node-level `visibleWhen` declared at
`page.zod.ts:189` *is* an `ExpressionInputSchema`, so a page that goes through
the spec's transform serves `{ dialect: 'cel', source }` and runs on CEL — the
same engine, and the same `has()` semantics, every other predicate face was
migrated to.

Three properties of that move were measured in a real console at the pinned
objectui SHA rather than reasoned about, and all three are load-bearing:

- The `visible` key is **deleted**, not left beside the new gate. A node
  `visibleWhen` and `properties.visible` compose as **AND**, so keeping both
  would leave the legacy predicate load-bearing and make the migration
  cosmetic.
- The `has()` guards are **mandatory**. On the CEL face an absent key is a
  *fault*, and that face is fail-soft: measured, an unguarded gate with its key
  stripped from the read left the banner VISIBLE, where the guarded gate hid
  it.
- On `sys_user` the predicate is authored through `P` so it reaches the wire as
  a CEL **envelope**. `SysUserDetailPage` is a raw `Page` object literal, so —
  unlike a page built with `definePage()` — nothing normalizes it, and the
  renderer keeps bare strings on the legacy path by design. Measured: the bare
  form left "Email not verified" showing on *every* profile, including other
  people's; the envelope restores every polarity.

Behaviour for real users is unchanged in every polarity measured — a `todo`
task hides the banner and an `in_review` task shows it; a verified user hides
"Email not verified", an unverified user viewing their own profile shows it,
and another user's profile shows nothing. What changes is that a genuine fault
is now **loud** (CEL names the missing key) instead of silently answering
`false`, and that both predicates sit on the declared slot the platform teaches
everywhere else.
