---
"@objectstack/spec": patch
---

fix(spec): keep machine constants off the skill-reference `Exports:` fallback

When a `.zod.ts` has no module doc block, `build-skill-references.ts` falls back
to listing its exports. That line is TRUE — an accurate list of what the module
exports, which is why #12094 kept the fallback rather than refusing. What was
wrong is the RANKING: the list was whichever five exports happened to be
DECLARED FIRST, and the extraction had no notion of authorable surface, so any
`export const` qualified — including constants whose own names say they are not
for authoring.

Three of the eleven modules that reach this fallback declare their machine
constants near the top, so three published rows headlined them:

- `automation/approval.zod.ts` named `DEPRECATED_APPROVER_TYPES`,
  `NON_AUTHORABLE_APPROVER_TYPES`, `ORG_MEMBERSHIP_LEVELS` and
  `APPROVER_EXPRESSION_ROOTS` — four of its five slots
- `kernel/plugin.zod.ts` named `CORE_PLUGIN_TYPES`, `CONSUMER_INSTALLABLE_TYPES`
- `system/translation.zod.ts` named `LEGACY_OBJECT_FIRST_KEYS`

`skills/**` is loaded whole into a customer agent's context window and its job
is to teach that agent what it may author, so a row headlining
`DEPRECATED_APPROVER_TYPES` and `NON_AUTHORABLE_APPROVER_TYPES` pointed an
authoring agent at exactly the vocabulary it must not use, with nothing on the
line marking them as such. No gate could see it: `check:skill-refs` compares the
artifact against the generator, and the generator ranked faithfully.

`SCREAMING_SNAKE` exports are now dropped and source order is kept for what
remains, with the cap of five applied AFTER filtering so the authorable names
waiting behind the constants are promoted rather than the row merely shortened.
A module whose entire export surface is machine constants falls through to no
description at all rather than printing a bare `Exports:`.

Sorting `*Schema` exports first was considered and NOT taken: on the very row
that motivated this it demotes `ApproverType` — the approver-type enum an author
actually writes — below four schema objects, which is worse by this surface's
own standard. The rule moves to `scripts/lib/export-list.ts` so it can be pinned
without running the generator, and `scripts/export-list.test.ts` enforces it
both as unit cases and as a corpus gate over the checked-in artifacts.
