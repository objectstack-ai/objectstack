---
'@objectstack/spec': patch
'@objectstack/service-automation': patch
---

Graduate `notify`'s nested `source: { object, id }` into the conversion layer (#4045).

The `notify` executor tolerated a second spelling of its click-through target with
a bare consumer-side fallback:

```ts
const object = toStr(interpolate(cfg.sourceObject ?? src?.object, …));
```

Its own doc comment named `sourceObject`/`sourceId` **canonical** (they mirror the
`sys_notification.source_object`/`source_id` columns), so the nested form was an
alias tolerated by exactly the mechanism Prime Directive #12 calls debt — and the
one alias on this executor that #3796 missed when it moved `to`/`subject`/`body`/
`url` into `flow-node-notify-config-aliases`.

It now graduates the same way `filters` → `filter` and `object` → `objectName`
did: the conversion lifts it onto the canonical pair at load — including the
`AutomationEngine.registerFlow` rehydration seam — and the executor's fallback is
deleted, so no consumer-side dialect tolerance survives and the alias is declared,
tested and retirable on schedule (it rides the existing entry's window, retiring
at 18).

Unlike the four renames this is a **1→2 destructuring**, which the pair mechanism
cannot express, so it is a small custom transform. It mirrors the `??` precedence
exactly: a canonical key already present wins and its nested counterpart is left
shadowed, matching how a shadowed alias is treated elsewhere. `source` is dropped
once at least one part is lifted; a `source` that is not an object, or carries
neither key, is left untouched rather than silently deleted.

No behaviour change for authors — both spellings keep working, and a
half-specified target is still dropped rather than emitting a dead deep-link.
