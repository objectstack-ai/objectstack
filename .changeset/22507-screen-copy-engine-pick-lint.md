---
"@objectstack/lint": minor
---

feat(lint): `objectstack validate` judges a translated screen `description`

Clause-②: yes (widening)

- A translation of `flows.<flow>.screens.<node_id>.description` over a screen that declares no `config.description` is reported as `translation-target-unknown` (error). The engine translates body text only where the screen authors one, so nothing would read the key. Declare the screen's `description`, or drop the key.
