---
'@objectstack/spec': minor
'@objectstack/lint': minor
---

feat(spec): a dataset dimension and measure carry business vocabulary (`synonyms`, `description`), and the `list_datasets` / `query_dataset` tool inputs and outputs are declared in spec (ADR-0149 D1, D2)

Clause-②: yes (widening)
Metadata-protocol: added
Skills-docs: follow-up owed — skills dataset authoring page

- **`@objectstack/spec`: member vocabulary (ADR-0149 D1).** `DatasetDimensionSchema` and `DatasetMeasureSchema` accept two optional keys. `synonyms` is a list of the words a person uses for the member in a question (`['收入', '销售额', 'revenue']`): each trimmed and non-empty, at most 60 characters, at most 20 per member. It is matched, never rendered, so it is not translated. `description` is the member's business definition in plain language, a string or an inline locale map of at most 500 characters per locale; it is never a prompt to an AI (M1, ruled A). Authors who write `synonym`, `aliases`, `keywords`, `terms`, `alternateNames` or `alias` are pointed at `synonyms`, and `aiDescription`, `aiContext`, `hint`, `help` or `tooltip` at `description`.
- **Within one dataset a word answers to one member.** `DatasetSchema` refuses a synonym that equals another member's name, another member's label (any locale of an inline map) or another member's synonym, and a synonym listed twice on one member. Words are compared after `normalizeDatasetTerm` (NFKC, lower case, `_` and `-` read as a space, whitespace collapsed), which is exported so the dataset tools' term matcher uses the same rule. A synonym equal to its own member's name or label is accepted as written. The same word may answer to different members in different datasets. The refusal names both members and the word.
- **Translations.** The `datasets` translation group accepts `datasets.<name>.{dimensions,measures}.<member>.description`, and `translateDataset` overlays it the way it overlays `label`. A member `description` in a bundle used to be refused with a pointer to the dataset's own description; that guidance and its message are retired. `synonyms` in a bundle is refused with the reason: one authored list holds the words of every language.
- **Dataset AI tool schemas (ADR-0149 D2).** A new `ai/dataset-tools.zod.ts`, exported from `@objectstack/spec/ai`, declares the inputs and outputs of `list_datasets` and `query_dataset`: the catalogue entry with its dimensions, measures, vocabulary, `membersWithheld` and term `matches`; the `partial` / `warning` shape of a degraded catalogue; `query_dataset`'s input, whose `selection` is `DatasetSelectionSchema` itself; and its output, the dataset answer's members taken by reference without `sql`, plus `provenance` (the dataset and the measures and dimensions used, and the caller's `runtimeFilter` echoed as sent, never the dataset's own `filter`), `rowCount`, `truncated` and the delegation narrowing. `getDatasetToolJsonSchemas()` projects them to the JSON Schema an `AIToolDefinition` carries. No executor ships here: the catalogue, the term matcher, the compiler write and the tool registration are cards #31589 and #31590. The four new member keys are recorded `planned` in the liveness ledger with #31589 as their reader.
- **`@objectstack/lint`:** the i18n walk emits `datasets.<name>.{dimensions,measures}.<member>.description`, so `os i18n extract` scaffolds a member's description and `check:i18n-coverage` measures it. It emits nothing for `synonyms`.

Every dataset and translation bundle that parsed before parses to the same value.
