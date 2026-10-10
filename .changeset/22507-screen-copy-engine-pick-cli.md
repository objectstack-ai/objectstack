---
"@objectstack/cli": minor
---

feat(cli): `os i18n extract` and the coverage gate scaffold and demand a screen's `description`

Clause-②: yes (widening)

- `os i18n extract` now writes `flows.<flow>.screens.<node_id>.description` into the skeleton for every screen that authors body text, seeded with the authored `{{ }}` template so a translator keeps its holes.
- The coverage gate demands it in the `flow` bucket (`i18n/missing-flow`). A project that declares `supportedLocales` gets one missing-key issue per locale for each screen that authors a `description`, until it translates it. A screen with no `description` is never asked for one.
