---
'@objectstack/lint': patch
'@objectstack/skills': patch
---

feat(lint): a dataset measure or dimension that declares neither `synonyms` nor a `description` is advised

Clause-②: no
Metadata-protocol: none

A dataset member answers a business question through its vocabulary (ADR-0149 D1): `synonyms`, the words a person types for it, and `description`, a short business definition. Both keys are optional, so a dataset that declares neither on a member passes every check, and that member then answers only to its own name and label. A person who asks in other words, or in another language, matches nothing and gets a number from a plain object query instead of the governed metric.

`@objectstack/lint` adds one advisory rule, `dataset-member-no-vocabulary` (`warning`). It reports once per measure or dimension that has no non-blank `synonyms` entry and no non-blank `description`, names the dataset and the member, and says what is lost. One of the two keys is enough to silence it. It runs at `os validate`, `os build` and `os lint`, and at the metadata publish door for a `dataset` write, where it is an advisory on the save response. Nothing is refused: a dataset that only feeds charts loses nothing by leaving both keys out. `os explain dataset-member-no-vocabulary` prints the full reasoning.

The author-time rule count the CLI prints (`Running author-time rules (N)`) rises by one, to 70 for `os validate` and `os build`.

`@objectstack/lint` exports `validateDatasetMemberVocabulary`, `DATASET_MEMBER_NO_VOCABULARY` and the `DatasetMemberVocabularyFinding` type.

`@objectstack/skills`: the `objectstack-ui` dashboards rule now says, for every dataset member, to write `synonyms` as the words a person types, in the language of the brief, and a one-sentence business `description`; that one word names one member; and that a member with neither draws the new warning. Its dataset example gives the dimension a synonym too, and the skill's evals gain a case for a dataset authored from a Chinese brief.
