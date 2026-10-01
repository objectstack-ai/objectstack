---
'@objectstack/rest': patch
---

refactor(rest): the import runner, coercion, mapping apply, field-meta map and error classification moved to `@objectstack/core` / `@objectstack/types`; `rest` re-exports them (#20919)

`runImport`, `coerceRow`, `buildFieldMetaMap` and their types (from the package
index), and `mapDataError` with its sibling classification exports, are now
re-exported from their new homes — byte-identical code, the same names, the same
behaviour at both import routes and at `plugin-auth`'s identity import. Nothing to
change for consumers.
