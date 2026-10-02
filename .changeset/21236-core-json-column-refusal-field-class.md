---
'@objectstack/core': patch
---

`jsonColumnOperatorRefusalText` takes an optional fourth argument: the class of JSON column the refused operator met, `JsonColumnFieldClass` (now exported). `'multi-value-or-json'` is the default, and its words are unchanged. `'single-value-media'` words the refusal for a single-value file-class field that a SQL deployment still stores as a JSON column.

Clause-②: no

A single-value file-class field (`file`, `image`, `avatar`, `video`, `audio`) is stored as a JSON column only on a deployment inside the ADR-0104 dual-encoding window, whose media columns have not moved. There it holds one JSON string, so `$contains` with the field's exact id answers no rows. That class's refusal no longer prescribes `$contains`. It says that the field answers these operators again once the deployment finishes the media-column move (the column step of `objectstack migrate files-to-references --apply`), and it still names `$null` / `$empty` for "no value". The message stays under the REST envelope's 500-character bound. Which operators are refused, and on which fields, does not change.
