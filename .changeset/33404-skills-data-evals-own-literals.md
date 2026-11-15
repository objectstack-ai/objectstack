---
'@objectstack/skills': patch
---

docs(skills): `objectstack-data` evals 11, 12 and 14 carry their own `must_contain` literals in the reference answer

Clause-②: no
Metadata-protocol: none

In `objects-fields-relationships.json`, three evals listed `must_contain` literals that their own `expected_output` described only in prose, so the reference answer failed its own grader: eval 11 (`type: 'select'`, `type: 'state_machine'`), eval 12 (`type: 'summary'`, `type: 'formula'`) and eval 14 (`label: '公司名称'`, `value: 'active'`). Every literal is the spelling the data skill teaches on `main`, so the reference answers now spell them; eval 14's options are written in the skill's `{ label, value }` shape. No assertion, schema or runtime change.
