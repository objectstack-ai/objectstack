---
'@objectstack/objectql': minor
'@objectstack/spec': minor
---

A hook registration can now express "global, EXCEPT these objects" — `registerHook(event, handler, { excludeObjects })`.

`registerHook` carried one scope face: `object`, an allow list (absent = global, `'*'` = every object). An allow list and a deny list are interchangeable only over a closed universe of object names, and this one is open — a successful `/meta` PUT registers new objects into a running engine, and `SchemaRegistry.registerObject` emits no event a plugin could subscribe to. So a registrant wanting "everything except these platform tables" had two options, both wrong: keep the skip list inside the handler as an early return, which leaves the registration global and makes the per-object gates (`hasHooksFor`, the bulk-write row-set read) answer "hooks apply" for objects the handler is about to skip; or enumerate the complement into `object`, which freezes the list at boot so an object created afterwards is silently not covered — a compliance regression for the audit plugin, and a silent one.

`excludeObjects?: string | string[]` is the deny half, subtracted from whatever `object` admits: `matches = allowMatches && !excludeMatches`. Absent means subtract nothing, so every registration that compiled before still behaves identically. Declared on the registration rather than left to a predicate callback, so the scope stays static, printable — the `Registered hook` debug record now reports it — and introspectable by diagnostics.

Two shapes are refused at registration, following the same reasoning as the empty-target ruling: an empty name (`''`, `['']`, or a blank member) would subtract nothing while reading as though it subtracted something, and `'*'` would subtract every object and leave a hook that can never fire (ADR-0078: no silently inert declaration). Both throw, naming the fix. `excludeObjects: []` is accepted — it is the honest spelling of "subtract nothing", and the natural value of a spread whose source list is empty.

`triggerHooks` (dispatch) and `hasHooksFor` (the bulk-write gate) were two hand-written copies of one matching semantic; adding a second scope dimension to two copies is how they drift, so both now call one shared matcher. A property test pins the direction that matters — the gate is never tighter than the dispatch, since a looser gate costs a wasted query while a tighter one silently drops hooks that were going to fire.

The authorable `HookSchema` is deliberately untouched: the consumer is plugin code registering in TypeScript, and no metadata author needs "global minus a list" today. The key stays off the authoring surface until real pull appears.
