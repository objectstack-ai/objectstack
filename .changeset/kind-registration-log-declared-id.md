---
"@objectstack/objectql": patch
---

Log a contributed metadata kind by its declared `id` (#10729). `registerApp()`
emits one `'Registered Kind'` debug line per entry in a manifest's
`contributes.kinds`, and that line read `kind.name || kind.type`:

```ts
this.logger.debug('Registered Kind', { kind: kind.name || kind.type, from: id });
```

`contributes.kinds` items declare neither field. The schema
(`packages/spec/src/kernel/manifest.zod.ts`) says `{ id, globs, description? }`,
and `SchemaRegistry.registerKind` types its parameter `{ id: string, globs: string[] }`
— so the expression evaluated `undefined || undefined` and every conforming
manifest logged `kind: undefined`. The line now reads `kind.id`.

`id` rather than any other declared field because `registerKind` files the
descriptor with `registerItem('kind', kind, 'id')`: `id` is simultaneously the
only identifying field the schema declares and the exact key the item is stored
under, so a reader of the log line can look the item back up with it. Kept
undeclared aliases OUT rather than adding `?? kind.name` for old manifests —
reading an undeclared alias in a consumer is the tolerance Prime Directive #12
rejects, and no manifest in this repo authors the older shape.

Behaviour change is confined to the text of one `debug`-level line; nothing
branches on it. It is pinned by `engine-kind-registration-log.test.ts`, which
asserts the logged value equals the key `registry.listItems('kind')` files the
descriptor under — a debug field that silently goes `undefined` is exactly the
class of defect that survives forever because nothing asserts on it.
