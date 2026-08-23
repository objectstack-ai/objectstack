---
"@objectstack/platform-objects": patch
---

Move both authored `record:alert` gates off `properties.visible` onto the
component-node `visibleWhen`, `has()`-guarded (#9167) — the `sys_user` detail
page's "Email not verified" banner, and the showcase Task Detail page's
"Awaiting review" banner.

`record:alert` is the one record component that declares a props-level
`visible` predicate, but `PageComponentSchema.properties` is an opaque record:
the bag is served verbatim, so a bare string in `visible` never reaches
`ExpressionInputSchema` and is evaluated by the console's **legacy JS**
evaluator. The node-level `visibleWhen` declared at `page.zod.ts:189` *is* an
`ExpressionInputSchema`, so it normalizes to `{ dialect: 'cel', source }`
before it is served and runs on CEL — the same engine, and the same `has()`
semantics, every other predicate face was migrated to.

Two properties of that move were measured in a real console at the pinned
objectui SHA rather than reasoned about, and both are load-bearing:

- The `visible` key is **deleted**, not left beside the new gate. A node
  `visibleWhen` and `properties.visible` compose as **AND**, so keeping both
  would leave the legacy predicate load-bearing and make the migration
  cosmetic.
- The `has()` guards are **mandatory**. On the CEL face an absent key is a
  *fault*, and that face is fail-soft: unguarded, a stripped gate key logs
  `[runtime] No such key: …` and leaves the banner permanently VISIBLE. The
  guards are what make the migration safe rather than a regression.

Behaviour for real users is unchanged in every polarity — a `todo` task hides
the banner and an `in_review` task shows it; a verified user hides "Email not
verified" and an unverified user viewing their own profile shows it. What
changes is that a genuine fault is now **loud** (CEL names the missing key)
instead of silently answering `false`, and that the two predicates now sit on
the declared slot the platform teaches everywhere else.
