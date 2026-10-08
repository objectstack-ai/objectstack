---
'@objectstack/spec': patch
'@objectstack/lint': patch
'@objectstack/driver-turso': patch
---

Retirement prescriptions name `os migrate meta --write`: "… to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand."

Clause-②: no

Wording only: no schema, key, type, export or error code changes, and every input that parsed or was refused before gets the same verdict at the same path. Only the closing sentence of the message changes.

- A prescription covered by an ADR-0087 conversion used to close with "Run `os migrate meta --from N` to list the mechanical edits for existing sources; apply them by hand." It now closes with "Run `os migrate meta --from N` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand." The default run still only lists. `os migrate meta --write` rewrites in place each edit it can trace to one literal in one project file and lists every other edit with the reason it was not written. The sentence never says the tool rewrites your sources automatically, because `--write` does not write every edit. Text up to and including "for existing sources;" is unchanged, so a caller matching that prefix still matches.
- The three prescriptions for conversions that cover only part of a value (dashboard `compareTo.offset`, the script flow node's `config.actionType` and the package manifest `permissions` case) carry the same `--write` clause before their second clause.
- The `record:chatter` / `record:discussion` `position` value prescriptions (`'sidebar'`, `'inline'`, `'drawer'`) used to tell the author to run a bare `os migrate meta`, which the command refuses because `--from` is missing. They now name `os migrate meta --from 17` and close with the same sentence.
- `@objectstack/lint`: the script node's retired dispatch-key diagnostic and the dataset widget's `chartConfig.xAxis.field` hint close with the new sentence.
- `@objectstack/driver-turso`: the `timeout`, `localPath` and `wasm` config tombstones close with the new sentence.
