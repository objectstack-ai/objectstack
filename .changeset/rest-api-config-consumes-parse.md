---
"@objectstack/rest": patch
---

The REST server's `api` configuration defaults now come from `RestApiConfigSchema` alone, instead of being restated in `packages/rest`.

`RestServer.normalizeConfig` already parsed `config.api` against `RestApiConfigSchema` — and then discarded the result, rebuilding the block from a `??` chain over the raw input. That chain restated the schema's eleven top-level `z.default(...)`s as eleven literals in a second package. They agreed key for key, and nothing measured that they would keep agreeing: changing a default in `@objectstack/spec` silently failed to propagate, because `api.enableUi ?? true` answers `true` for an absent key whatever the schema declares. Consuming the parse deletes the duplicate and makes the schema authoritative.

The parse itself is unchanged, so **nothing new is accepted or refused**: the same schema, with the same `.omit({ requireAuth: true })`, already ran at construction. `api.requireAuth` keeps its retired warn-and-ignore posture (`@objectstack/rest`'s plugin reads it off the raw config, so the warning is untouched), and every authored value still wins over the default.

One bounded behaviour change, for a caller who writes `api.documentation` or `api.responseFormat`: those objects now arrive carrying their own declared inner defaults — `documentation.enabled` / `.title`, and `responseFormat.envelope` / `.includeMetadata` / `.includePagination` — where they were previously copied through exactly as authored. An object left unwritten stays absent; nothing in the platform reads either key today.
