---
'@objectstack/metadata-protocol': patch
---

Stop `GET /api/v1/meta/:type/:name/diff` serving stored credential values.

`diffMetaItem` compared two stored metadata bodies and emitted the raw values it
found, so a `datasource` row whose credential rotated between versions returned
both the old and the new password in cleartext (inline `config.password` and the
password component of `config.url` alike).

The diff is still computed on the RAW bodies — a credential rotation continues to
report its path as changed — but the emitted `value` / `from` / `to` are now taken
from the type's redacted projection of those same bodies, on both sides. Types
with no registered redactor are unaffected and keep serving their values by
reference.
