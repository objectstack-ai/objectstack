---
"@objectstack/spec": minor
"@objectstack/core": minor
"@objectstack/objectql": minor
---

fix(import): `createMissingOptions` now keeps an unmatched option value through the engine's option check

Clause-②: yes (widening)

- **What was wrong.** With `createMissingOptions: true` on an import (objectui's Import Wizard sends it for *Keep unknown option values*), the import coercion kept a `select` / `radio` / `multiselect` cell that matched none of the field's options. The engine's write-path option check then refused the same value ("Priority must be one of: high, low"), so on every writable field the row still failed. Only the stage that refused it changed.
- **What happens now.** The import stores the kept value: a single-value cell trimmed, and each unmatched item of a multi-value cell. The dry run admits the same rows the write does. The engine admits exactly the values the import kept, on that import's writes. Every other value outside the options is still refused, and a field bound to a shared picklist that did not resolve is still refused.
- **The field's options do not change.** No option is added to the field. A later write that sends the field is judged against the options again, so sending the kept value back is refused and picking an option is accepted. A write that leaves the field out, such as an edit form saving only the fields it changed, is not judged on that field.
- **`@objectstack/spec`.** `ExecutionContext` declares `keptOptionValues`: per field name, the option values an import kept. It is server-constructed only, like `skipStateMachine` and `preserveAudit`, and is never client-supplied. The `ImportRequest.createMissingOptions` description now states exactly the behaviour above.
- **`@objectstack/core`.** `coerceRow` returns `keptOptionValues` beside `data` and `errors`, and `coerceFieldValue` reports the values it kept. `runImport` puts exactly those values on each write's context. A per-row write carries its own row's values, and a batched create carries the union of its rows' values. A row that kept nothing is written with the import's context unchanged.
- **`@objectstack/objectql`.** `ValidateRecordOptions.keptOptionValues` lets the single-value and multi-value option arms admit a listed value. The engine fills it from the write's `ExecutionContext.keptOptionValues` on insert, update and `validate`.
