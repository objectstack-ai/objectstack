---
'@objectstack/spec': patch
'@object-ui/app-shell': patch
---

feat(studio): a dataset is a data type — Studio lists it under Data, directly after objects, and always shows datasets and positions

Clause-②: no
Metadata-protocol: none

`DEFAULT_METADATA_TYPE_REGISTRY` registers `dataset` under `domain: 'data'`; it was `'ui'`. A dataset is the semantic layer that charts and an AI's data questions both read, so it is data and not interface (ADR-0084, amended 2026-11-26). Nothing an author writes changes: a `*.dataset.ts` item validates and loads as it did, the `domain` enum keeps its six values, and the registry's declared type is the same. `dashboard` and `report` stay `ui` types.

What changes is a served value. `GET /api/v1/meta/types` answers `domain: "data"` for the `dataset` entry, and because that listing is ordered by domain and then by type, the entry now sits among the data types. Code that finds the entry by its `type` sees no difference; code that selected datasets by `domain === 'ui'`, from the listing or from the exported registry, reads `'data'` instead.

In Studio the left menu, the type directory and a dataset page's badge follow the registry, so datasets are found under Data. `STUDIO_MENU_PLACEMENT` places `dataset` and `position` in the common tier by name: a package's menu always lists both above the Advanced fold, whether the package holds one or not — dataset directly after object, position directly after permission set.
