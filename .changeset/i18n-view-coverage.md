---
"@objectstack/cli": patch
"@objectstack/spec": patch
---

fix(cli,spec): i18n coverage actually gates view labels — the `defineView()` container is no longer skipped (#4123)

`i18n/missing-view` had **zero producers**. `collectExpectedEntries` recognized
two view shapes and the compiled config is neither:

1. **Object-nested `listViews`** — objects do not carry `listViews` once
   compiled (0 across every example).
2. **Top-level named views** — guarded by `if (!view?.name) continue`.

`defineView()` emits the aggregated View **container**, `{ list, listViews,
formViews }`, which per spec (`view.zod.ts`) has **no top-level `name`**: it is
keyed implicitly by its target object at `list.data.object`, exactly as
objectql's `resolveMetadataItemName` resolves it. So the guard rejected the
spec's own container shape, and with it every view in every example — 64 view
strings that the ratchet reported as fully covered.

The walker now handles the container, emitting under the same
`objects.<object>._views.<view>.*` convention the runtime resolver reads
(`viewLabel` in `@object-ui/i18n`) and the shipped platform bundles already
carry. An unnamed default `list` resolves under `_views.list`, matching the
console's `primary.name || 'list'`. `formViews` stays uncovered — form views
have no counterpart in that resolver convention, so keys for them would expect
translations nothing reads.

`StrictObjectTranslation` gains the `_views` slot that
`ObjectTranslationDataSchema` already permits. Without it, `satisfies
StrictObjectTranslation<…>` rejects the very translations the gate now asks
for.

The newly surfaced strings are **translated, not ratcheted** (the precedent set
when the object-less action landed): `check-i18n-coverage` stays at 665 with
none new.
