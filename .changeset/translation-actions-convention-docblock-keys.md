---
"@objectstack/spec": patch
---

Documentation: the `_actions` and `globalActions` convention lists in `translation.zod.ts` now name every key the schema accepts.

Both docblocks are hand-written prose copies of what one factory declares. `actionTranslationSchema(...)` builds both surfaces — the file says so outright, "Shared by object `_actions` and `globalActions`" — so the two lists carried the identical four addresses (`label`, `confirmText`, `successMessage`, `resultDialog.*`) and the identical two omissions. An author reading either list to learn which keys exist saw a strict subset of what the schema has accepted all along.

Added to both lists, in the order the factory declares them and matching the spelling already landed in `i18n-resolver.ts`'s own header:

- `description` — the explanatory line under the title in the action's param dialog, resolved at `objects.<object>._actions.<action>.description` with a `globalActions.<action>.description` fallback.
- `params.<param_name>.{label, helpText, placeholder, options.<value>}` — the per-parameter translations for an action's param dialog.

Prose only. No schema, factory or resolver changed: the keys were already declared and already accepted, so nothing about what a bundle validates to moves. `packages/spec` publishes `src/**/*.zod.ts`, which is why documentation-only text still ships and still earns a changeset.
