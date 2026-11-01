---
'@objectstack/spec': patch
---

fix(spec): the connector read withholds root keys the entry shape does not declare

Clause-②: no
Metadata-protocol: none

Read-side hardening of the built-in `connector` redactor. A stored connector body is served without any top-level key the authored connector entry (`DeclarativeConnectorEntrySchema`) does not declare; the declared set is read from that schema's own shape, and the read decorations (`_diagnostics`, `_draft`) are left alone. Under `providerConfig`, an array holding a URL with credential parts is withheld whole rather than served. Each withheld position is named in `redactedKeys`, so a save of the served form keeps the stored value, and the runtime's execution read is unchanged. Nothing an author can write changes.
