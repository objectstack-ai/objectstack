---
"@objectstack/plugin-sharing": patch
---

Collapse the two byte-identical `MinimalLogger` declarations in `plugin-sharing`
onto one shared `OptionalSharingLogger` (#10692). Internal types only — none of
the seven local `MinimalLogger` interfaces was exported, so no published surface
and no runtime behaviour changes.

`plugin-sharing/src` declared **seven** module-local interfaces all named
`MinimalLogger`. The duplication was not the defect; divergence under one name
was. When #10556 made `bulk-recompute.ts`'s `warn` non-optional, `tsc` reported
the forwarding modules as:

```
Type 'MinimalLogger' is not assignable to type 'MinimalLogger'.
  Two different types with this name exist, but they are unrelated.
```

`bu-tree-recompute.ts` and `primary-bu-projection.ts` were byte-identical, so
they now share one declaration in `logger-shapes.ts`. The new type is
deliberately given a DIFFERENT name: the next forwarding edge added between it
and a module that still declares its own `MinimalLogger` produces a diagnostic
naming two different types, instead of the same name twice.

The other five declarations are left alone, each for a stated reason recorded in
`logger-shapes.ts`. Three are genuinely different contracts (`bulk-recompute.ts`
is the guaranteed sink; `rule-hooks.ts` and `record-share-cascade.ts` require
`warn` because they forward into it). Two are *not* the cheap unification the
card assumed:

- `sharing-rule-provenance.ts` is `{ info?, warn? }` by optionality but carries a
  stricter member signature, `(msg: string, meta?: Record<string, any>)`.
  Folding it onto the `(msg: any, ...rest: any[])` spelling would delete real
  checking; folding the others onto its spelling would tighten two modules.
- `record-orphan-cleanup.ts`'s bare `Function` members **cannot** be tightened
  here: `Function` is not assignable to any concrete signature ("Type 'Function'
  provides no match for the signature"), and the two loggers handed to it —
  `SharingServiceOptions['logger']` and `ShareLinkServiceOptions['logger']` —
  are themselves spelled with bare `Function`.

`check:optional-error-sink` (#9754) membership is unchanged and was verified
before and after: 37 sinks declare `error`, 2 permit silence, 2 baselined. The
shared shape declares no `error` and must not grow one — that would enrol every
module using it into that gate's population, which is a contract decision for
the #10556 family rather than a side effect of de-duplication.
