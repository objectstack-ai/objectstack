---
'@objectstack/spec': patch
---

docs(translation): the two `TranslationData` / `TranslationItem` `@example` blocks stop teaching a `messages` id that cannot resolve (#18190)

`messages` is declared a flat `Record<string, string>` (`translation.zod.ts` — `messages: z.record(z.string(), z.string())`), while `t()` resolves a key by walking its dot path segment by segment. Both implementations do this, identically:

- `packages/core/src/fallbacks/memory-i18n.ts` — `resolveKey()`, `key.split('.')`, walked by `t()`;
- `packages/services/service-i18n/src/file-i18n-adapter.ts` — a second `resolveKey()` with the same body, walked by `t()` through `resolveFromLocale()`.

So an id that merely *contains* a dot is one flat key named `common.save`, and `t('messages.common.save', …)` looks for a nested `common` object, finds a string or nothing at the first hop, and returns the key itself. Both docblock `@example` blocks on this schema demonstrated exactly that id — the doorway an author (or an authoring agent) copies from.

- The JSON example on `TranslationDataSchema` and the TypeScript example on `TranslationItemSchema` now author `commonSave`, the single-segment spelling `content/docs/protocol/kernel/i18n-standard.mdx` already prescribes and `packages/plugins/plugin-audit/src/translations/messages.ts` already applies to its own bundle.
- Both docblocks now state the rule, so the counter-example is named as one rather than demonstrated.

⚠️ **The schema still accepts a dotted id** — nothing is narrowed here and no key is retired. Whether the door should refuse a dotted `messages` key narrows a published accept set and rides its own card; this change is the doorway half only.

For authors: a `messages` id containing a dot never resolved, so re-spelling one single-segment (`'common.save'` → `commonSave`, looked up as `messages.commonSave`) turns a key that was returning itself into one that translates. No key that resolved before stops resolving.
