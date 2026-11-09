---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit): `sys_audit_log` no longer describes itself as an "immutable" audit trail

Clause-②: no
Metadata-protocol: none

The object's description and doc comment said "Immutable audit trail for platform events". The guarantee the platform actually gives is narrower: rows are written only by the platform and are read-only through the data API and in Setup. Platform code running in a system context (retention archive-then-delete, redaction migrations) can still change or delete rows. The description now says what holds, in English and in the ten translated locales. Nothing about the object's fields, permissions or API behaviour changes.
