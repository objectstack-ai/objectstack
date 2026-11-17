---
'@objectstack/service-analytics': patch
'@objectstack/mcp': patch
---

feat(analytics): `list_datasets` answers `nextStep` and `query_dataset` answers `sourceLine`, written by the platform in the caller's language

Clause-②: no
Metadata-protocol: none

The dataset tools now fill the two members the spec declares (`DatasetNextStepSchema`, `QueryDatasetOutputSchema.sourceLine`, `@objectstack/spec/ai`). Until now the decision "one match answers, several ask, near ones are offered, none falls back" and the citation line were left for each AI client to work out from `matches`, `candidates` and `provenance`; a model handed a finished sentence copies it, and one that builds it from parts often does not.

- **`nextStep` on `list_datasets`, whenever `terms` were sent.** `decision` is the case of the ADR-0149 D3 rule the words are in, counted in measures: one measure equals the word ⇒ `one_measure`; more than one, in one dataset or several ⇒ `several_measures`; no match but `candidates` ⇒ `candidates_only`; otherwise `no_measure`, which includes a word that equals only a dimension. `terms` names every word sent (once each, in order) that is in the reported case. `note` is that case as a finished sentence: the measure and the names to query for `one_measure`; each member by its label and its dataset's label for `several_measures` and `candidates_only`, with "ask the user, do not pick"; the object query tools for an unknown word, and "ask which number" for a word that is only a grouping.
- **Precedence among mixed cases.** One answer reports one case, the first of `several_measures`, `one_measure`, `candidates_only`, `no_measure`. A word that matches only a dimension never outranks a measure match: `["营收", "销售阶段"]` reports `one_measure` for `营收`. The order is exported as `DATASET_NEXT_STEP_PRECEDENCE` from `@objectstack/service-analytics`, and the tool description and the MCP `initialize` rule name it.
- **A partial answer says so.** With `partial: true` the answer still carries `nextStep`, computed from what it lists, and `note` ends by saying the catalogue was incomplete, that a measure missing from it may exist, and to repeat the `warning`.
- **`sourceLine` on `query_dataset`.** The answer's `provenance` as one line to cite: each measure's label and the dataset's label, then each dimension's label (`指标：营收（数据集：销售分析）；维度：阶段`). `provenance` is unchanged and stays the structured source. The REST dataset door's answer is not changed.
- **Only what the caller may see.** Both sentences are composed from the answer being served: a member over a field the caller cannot read, an `internal` member and a dataset the caller may not query never appear in either.
- **Language.** The request's locale, else the workspace default, else English, the ladder every platform-composed sentence follows (`userTextLocalesOf`, read from the caller's execution context). Sentences are written in English, Simplified Chinese, Traditional Chinese and Japanese; another language takes the next rung. The HTTP and stdio MCP doors hand the executor the same context, so one caller reads one sentence on either.

`@objectstack/mcp`: the `initialize` selection rule now tells the client to follow `nextStep`'s note, names the precedence, and says to cite `sourceLine`. Both tools pass the two members through unchanged.
