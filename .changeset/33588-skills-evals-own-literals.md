---
'@objectstack/skills': patch
---

docs(skills): four automation, query and ui evals spell their own `must_contain` literals in the reference answer

Clause-②: no
Metadata-protocol: none

Four evals listed a `must_contain` literal that their own `expected_output` did not contain, so the reference answer failed its own grader and the eval could not tell a right answer from a wrong one. In each the literal is what the skill teaches and the reference answer named it in prose, so the reference answer now spells it: `objectstack-automation` `flows-triggers-approvals` case 20 writes the node as `type: 'subflow'`; `integrations-declared` case 2 writes the two `update_record` fields as `{ dialect: 'cel', source: … }` envelopes, as the Stripe recipe in `references/integration-recipes.md` does; `objectstack-query` `filters-pagination-search` case 2 says `keyset` in lower case; `objectstack-ui` `analytics-inline-vs-dataset` case 1 says each widget names the dataset in `dataset`. No assertion, prompt, schema or runtime change.
