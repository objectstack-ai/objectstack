---
'@objectstack/spec': minor
---

feat(spec): the dataset tools' output declares `nextStep` on `list_datasets` and `sourceLine` on `query_dataset` (ADR-0149 M1)

Clause-②: yes (widening: two optional output members on published schemas)
Metadata-protocol: added
Skills-docs: follow-up owed — skills/objectstack-ask/SKILL.md (follows `nextStep` and cites `sourceLine` once the executor fills them)

`ListDatasetsOutputSchema` (`@objectstack/spec/ai`) gains one optional member, `nextStep`, with its schema `DatasetNextStepSchema` (type `DatasetNextStep`) and the closed enum `DatasetNextStepDecision`. `QueryDatasetOutputSchema` gains one optional member, `sourceLine`. Nothing is removed or renamed, and an answer without either member parses as it did.

- **`nextStep`: what it is.** The platform's reading of the caller's `terms` under the ADR-0149 D3 selection rule, as three members: `decision`, `terms` and `note`.
- **`decision` is a closed enum of four cases.** `one_measure` (the term equals exactly one measure), `several_measures` (it equals more than one, in one dataset or in several), `candidates_only` (it matched no member and has entries in `candidates`), `no_measure` (it equals no measure and has no candidate). A dimension the term equals is not counted: the rule selects a measure. Any other value does not parse. The values name what the platform found, not what a reader then does.
- **`terms` is the reference to the members, and there is one list of candidates.** `nextStep` holds no member list. It names the caller's terms the decision is about, and the members are read under those terms from the same answer: a dataset's `matches` for `one_measure` and `several_measures`, `candidates` for `candidates_only`. No `{ dataset, member }` pointer is declared twice.
- **`note` and `sourceLine` are string slots.** `note` is the decision in words; `sourceLine` is a `query_dataset` answer's source as one finished line, the same source `provenance` carries as structure. Each is a non-empty string, and the spec declares no wording for either: the text is the executor's (ADR-0149 M1).
- **`sourceLine` is the tool's member only.** It is declared on `QueryDatasetOutputSchema`; `AnalyticsResultResponseSchema`, the REST door's answer, is not changed.
- **When they are present.** Both are optional. `nextStep` is present only when `terms` were sent. No `sourceLine` is the key's absence: an empty string does not parse.
- **Who fills them.** This change declares the shapes only, and each tool's `outputSchema` (`getDatasetToolJsonSchemas()`) lists its member from it. Filling them is the dataset tools' executor's change in `@objectstack/service-analytics`, which ships under its own entry; an answer carries `nextStep` or `sourceLine` only from a release that has both.

ADR-0149 M1 gains an add-only amendment note recording the ruling: M1 is unchanged, the spec gains two string slots and one closed enum and no sentence, and the two sentences are written by the executor.

Level: `minor` for `@objectstack/spec`, the level `Metadata-protocol: added` takes. The `authorable-surface/ai.json` baseline records the new keys: `ai/ListDatasetsOutput:nextStep`, the three `ai/DatasetNextStep` members and `ai/QueryDatasetOutput:sourceLine`.
