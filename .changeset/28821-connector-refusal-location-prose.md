---
'@objectstack/spec': patch
---

fix(spec): the connector docs say where an undeclared key's refusal is located: at the entry, with the key named in `keys`

Clause-②: no
Metadata-protocol: none

A connector entry refuses a top-level key it does not declare, through `DeclarativeConnectorEntrySchema` and `defineConnector()`. The TSDoc on both said the refusal was "located at the key". It is not. zod raises one `unrecognized_keys` issue at the entry itself: its path is empty when the entry is parsed alone and `connectors.N` inside a stack, and it lists every undeclared key in `keys` and in its message. An author or agent looking for an issue at the key's path found none.

The TSDoc now says this. The same correction is made in the reason of the protocol-18 upgrade note for undeclared connector keys (`connector-entry-undeclared-key-refused`), which is not released yet.

Prose only. The refusal, its code, its path, its message and what the connector schema accepts are unchanged.
