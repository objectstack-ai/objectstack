---
"@objectstack/spec": minor
---

feat(spec): `element:button` declares the action it executes — `InlineActionSchema` (objectui#2997)

`element:button`'s renderer reads `properties.action` and dispatches it through
the `ActionRunner`; that prop is the only thing making a standalone-page button
interactive. `ElementButtonPropsSchema` declared `label`, `variant`, `size`,
`icon`, `iconPosition`, `disabled`, `aria` — and no `action`.

It is being authored anyway. cloud's `service-tenant` pages carry five
declaration sites across the billing and pricing funnel (`pricing`, `welcome`,
`billing-cancel` ×2, `billing-success`), each `{ type: 'navigation', to: … }`,
each cast `as any` to get past the type system.

**An undeclared prop is stripped, not ignored.**
`ElementButtonPropsSchema.safeParse({ label, action })` returned `success: true`
with no `action` in `data` — a non-strict `z.object` drops unknown keys. That is
harmless only because page block `properties` are still
`z.record(z.string(), z.unknown())`, so this schema never runs on a real page
save. The moment anyone tightens `properties` to validate against
`ComponentPropsMap` — an obvious hardening — every one of those buttons loses its
action at save, with a green parse. Declaring the prop is what defuses it.

**`InlineActionSchema` is derived, not a new dialect.** `ActionSchema` is
`z.object(…).refine(…).refine(…)`, so `.pick()` is unavailable on the exported
schema — the object half is now a factory both schemas build from, which keeps
`lazySchema`'s deferral (the fields are constructed on first use of whichever
schema is touched, not at module load). The inline schema `.pick()`s the twelve
fields `element:button` actually forwards to the runner, so their `describe()`
text, the `ActionType` vocabulary and the `target`-required refinement are shared
rather than restated.

`name` and `label` are optional, which is the substantive difference:
`ActionSchema` requires both because a registry entry needs an identity and a
menu label, and an inline action has neither — the button already has its own
`label`, and requiring `action.label` too would mean writing it twice. Everything
that only means something for a registered action — `objectName`, `locations`,
`order`, `ai`, `requiredPermissions`, `visible`/`disabled`, `resultDialog` — is
excluded, as are `icon`/`variant` (the button has its own) and `body` (a page
button running an inline sandboxed script is a separate decision). A declared
field no renderer reads is the failure this schema exists to stop, so widen it
when a renderer widens, not before.

**`navigation` and `to` become normalizing aliases, not new members.**
`normalizeInlineAction` folds `type: 'navigation'` → `'url'` and `to` → `target`
on parse, the `VIEW_FILTER_OPERATOR_ALIASES` pattern. So cloud's existing pages
keep validating unchanged while parse output is always canonical, and the aliases
get a `retiredKey` tombstone once the producers are migrated. `url` is also the
*better* target: the runner's `url` path has `${param.X}` / `${ctx.X}`
interpolation, `apiBase` promotion for `/api/…` paths and popup-blocker-safe
`openIn`, none of which its `navigation` path has.

Deliberately **not** done: promoting `navigation` into `ActionType` as a bare
member, which was considered and declined in #4070. It would name the type while
leaving the prop undeclared and `to` homeless — half a fix, and a permanent
synonym in a vocabulary whose members cannot be removed later.

Nothing is narrowed. `ui/InlineAction` and `ui/ElementButtonProps:action` are
additions to every generated surface; no accepted value stops being accepted, so
no stored page metadata changes meaning.

Verified: 16 new tests — the derivation is asserted from both directions
(the inline field set is exactly the documented twelve; every one of them
round-trips through `ActionSchema`; every registry-only concern is absent; every
`ActionType` member is inline-authorable), and the fold is pinned against the
literal shape cloud writes. Full `@objectstack/spec` suite **7038 tests across
271 files**, `tsc --noEmit`, and all twelve `check:*` gates, clean.
