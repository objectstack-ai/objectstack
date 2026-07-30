---
"@objectstack/metadata-protocol": minor
---

feat(metadata): `saveMeta` persists the operator spellings the spec normalized (objectui#2945)

`ViewFilterRuleSchema.operator` is `z.preprocess(normalizeFilterOperator, …)`, so
a stored `notEquals` / `gt` / `isNull` is folded to its canonical form during
save-time validation — and then the result was thrown away. `saveMetaItem`
persists the authored body verbatim, deliberately: `parsed.data` strips the
Studio-only auxiliary fields (`isPinned`, `isDefault`, `sortOrder`) that ride
along with an overlay document (ADR-0005 §Validation).

The consequence is that **every save mints new legacy-alias rows.** The ~30
entries in `VIEW_FILTER_OPERATOR_ALIASES` are documented as *"a migration bridge
[that] may be dropped in a future major"*, but there is no point at which the
last alias row is behind you, so the bridge can never be dismantled — a
migration that rewrote every existing row would be obsolete the moment the next
console personalization PUT landed. That is prerequisite 2 of the vocabulary
consolidation blocked in objectstack-ai/objectui#2945.

`graftNormalizedOperators` grafts the normalization back on without giving up the
verbatim body. It walks the authored value and `parsed.data` in lockstep **by
structure** and copies across exactly one thing: an `operator` whose parsed value
differs from the authored one.

- **No key list to maintain.** `ViewFilterRule[]` appears at five declared sites
  today (view `filter`, `ViewTab.filter`, page `filterBy`, and two
  `component.zod.ts` block props) and the structural walk covers all of them,
  plus any added later. Enumerating paths would have reproduced in this file the
  exact duplication #2945 exists to remove.
- **Nothing else moves.** Only an `operator` string is rewritten, and only where
  both sides are strings — so a `$`-token `FilterCondition`, a different operator
  vocabulary entirely, cannot be reshaped by accident. No key is added, removed,
  reordered or defaulted; the unary `{field, operator}` form does not acquire a
  `value` even though the schema's own output would give it one.
- **Nothing is allocated when nothing changed**, so a body already written in
  canonical form is returned by identity.

Behaviour change worth stating plainly: a `GET` after a `PUT` now returns the
canonical spelling rather than the one the author sent. That is the spelling the
spec defines, every renderer accepts it (objectstack-ai/objectui#2974,
objectstack-ai/objectui#2989 pinned all three of objectui's translation tables to
the full vocabulary), and it is the point of the change. Existing rows are not
touched — this stops the bleeding, it is not the migration.

Verified: 11 new tests, including one that drives **every** alias the spec still
folds through the real `ViewMetadataSchema` and asserts the persisted body comes
out canonical; full `@objectstack/metadata-protocol` suite 110 tests / 18 files
green.
