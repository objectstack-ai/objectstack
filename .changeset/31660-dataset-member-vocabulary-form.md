---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
---

The dataset metadata form now offers each dimension's and measure's `synonyms` and `description` (ADR-0149 D1) as row properties, with help text and translations in every shipped locale. `synonyms` are the words people use for a member in a question, matched by the dataset AI tools and never shown; `description` is a plain-language business definition, never a prompt. Both keys were already authorable and are read since the dataset AI tools landed; only the Studio form control is new.

Clause-②: no
Metadata-protocol: none
