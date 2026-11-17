---
'@objectstack/runtime': patch
---

fix(runtime): a sandboxed data call reaches the engine with every filter key it was written with

Clause-②: no
Metadata-protocol: none

A sandboxed data call reaches the engine with every filter key it was written with, so the engine's refusal of an absent comparand applies inside the sandbox too. A hook, action or job body's `ctx.api.object(name)` `find`, `findOne`, `count`, `aggregate`, bulk `update` or bulk `delete` whose filter (`where`, `having`, an aggregation's `filter`, at any depth) holds an `undefined` value is answered exactly as the same call made in-process: `INVALID_FILTER` / 400 from the engine, and no row read or written. To mean "no constraint", omit the key; to match an empty value, write `{"$eq": null}`.

A defined filter value, a data payload, and every argument outside a filter cross as before.
