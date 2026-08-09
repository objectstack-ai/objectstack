---
'@objectstack/service-settings': patch
---

The settings env door now enforces declared `pattern` constraints (#6580). An
`OS_*` override whose value the specifier's `pattern` rejects is loudly
reported (`error` log, once per var+value) and ignored — the key resolves from
the next cascade layer and is not locked — exactly the #5204 contract the
option-table, value-window/step and valueDomain families already honor. The
write gate's judgment is hoisted into shared helpers (`declaredPattern` /
`firstPatternMiss`) called by both doors, so `PUT /api/settings/:ns` behavior
is unchanged byte-for-byte (same `invalid_format` envelope, same tolerance for
uncompilable pattern declarations) and the two doors can no longer drift.
Family ordering agrees between doors: options → pattern → valueDomain → bounds.
