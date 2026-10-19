---
'@objectstack/spec': minor
---

feat(spec): a navigation entry may declare one API data source, which its `visible` reads as `data` (planned, not yet rendered)

Clause-②: yes (widening)

- **What changed.** Every navigation entry that spreads the shared nav base (`object`, `dashboard`, `page`, `url`, `report`, `action`, `component`, `doc`, `group`) accepts an optional `dataSource`. It is the page element's API binding, `ElementApiDataSourceSchema`, by reference: `{ provider: 'api', read: { url, method? }, path? }` reads one same-origin endpoint with the console's signed-in fetch, and the entry's `visible` reads the value `path` selects as `data`, for example `visible: 'data.total == 1'`.
- **The refusals are the binding's own.** A `read.url` that is not a same-origin API path, a `method` other than `GET`, a credential key (`headers`, `token`, …), the object binding `{ object, … }` and an unknown key are all refused at parse, at the entry's `dataSource` path. A `separator` refuses `dataSource` with its own prescription.
- **What does not read it.** Only `visible` reads `data`. `label` and the target keys (`recordId`, `filters`, `params`) take no `data` read, and a group's binding is not published to its `children`: each entry declares its own.
- **Planned, not yet rendered.** No console reads the key yet, so a `visible` that reads `data` has no value to read until the navigation renderer ships. The describe opens with `[PLANNED — not yet rendered]`, and the liveness row `app` → `navigation.dataSource` is `planned` with an author warning (`os lint` / `os validate` report it on a top-level entry).
- **Who notices.** Nobody, by construction: every app that parsed before parses unchanged. Nothing narrows.
