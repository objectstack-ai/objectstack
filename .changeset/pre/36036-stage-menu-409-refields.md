---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): after a 409, the stage menu's dialog asks for what the re-read record needs

Clause-②: no
Metadata-protocol: none

The record header's stage menu opens a dialog that asks for the fields a stage makes required. When the move came back 409 (someone else changed the record), the dialog re-read the record but kept the list of fields it chose when the stage was picked. If the other writer had just filled one of those fields, the reader's next Move wrote the reader's value over it.

The dialog now judges the fields against the record as it stands, so the list follows the re-read row when it lands. A field another writer filled in the meantime leaves the dialog and is not sent with the move, and a value the reader typed for it no longer asks for the fields it would have made required in turn. When nothing is left to fill in, the dialog shows the record, the stage and the Move button. A 409 that filled nothing keeps the list and the typed values as before.
