---
'@objectstack/cli': patch
---

feat(cli): `os secret orphans` also reports the `sys_secret` handles more than one holder names, and the ones a column other than their own holds

Clause-②: no
Metadata-protocol: none

The orphan report answered which `sys_secret` rows nothing names. Its report mode now also lists, from the same cross-producer reference union, the rows something does name in a way no producer writes:

- **`shared`** — a handle more than one holder record names. A producer seals one handle per value it writes.
- **`misplaced`** — a handle held by a column other than the one its `(namespace, key)` names: the settings row's own pair, or the object and field name for a `secret` field. A datasource holder is not judged for placement, because the datasource binder records the pair its caller passes.
- **`sharedInOwnColumn`**, listed apart — a handle every holder of which is a row of its own minting column. That is what a predicate update writes (one sealed value onto every row it matched), and stored rows cannot tell it from a reference copied between rows of the same column, so it is listed and not judged.

Each entry carries the handle id, its `(namespace, key)`, the holder count and every holder's object, field and record. Never a secret and never cipher material. Under `--json` the section is a new top-level `holders` key beside `plan`. Report mode only: it changes nothing `--delete` removes, and it repairs nothing.
