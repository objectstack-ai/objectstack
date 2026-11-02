---
'@objectstack/spec': patch
'@objectstack/metadata-protocol': patch
---

fix(spec): the connector read withholds root keys the entry shape does not declare

Clause-②: no
Metadata-protocol: none

Read-side hardening of the built-in `connector` redactor. A stored connector body is served without any top-level key the authored connector entry (`DeclarativeConnectorEntrySchema`) does not declare — including a cleared one (`null`, `''`, `{}`) and one whose own name carries a dot; the declared set is read from that schema's own shape, and the read decorations (`_diagnostics`, `_draft`) are left alone. Under `providerConfig`, an array, or a key whose own name carries a dot, that holds a URL with credential parts is withheld whole rather than served. Each withheld position is named in `redactedKeys`, and the metadata protocol's carry-forward keeps the stored value at rest when the served form is saved — resolving a dotted key by the whole-string fallback when the dotted split resolves nowhere. The runtime's execution read is unchanged, and nothing an author can write changes.
