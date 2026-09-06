---
"@objectstack/objectql": patch
---

fix(objectql): the declarative hook wrapper reads the renamed `hook.timeoutMs` (#14478)

`wrapDeclarativeHook` reads its wall-clock abort budget from `meta.timeoutMs`
instead of `meta.timeout`, following the `@objectstack/spec` rename of the
authored key (the unit now lives in the key name). Same value, same magnitude,
same abort; no public surface of this package changes.
