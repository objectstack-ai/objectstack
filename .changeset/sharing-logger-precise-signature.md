---
"@objectstack/plugin-sharing": patch
---

Put `plugin-sharing`'s shared `{ info?, warn? }` logger contract on the precise
member signature and absorb the third module onto it (#10692). Internal types
only — no local `MinimalLogger` was ever exported, so there is no published
surface change and no runtime behaviour change.

`OptionalSharingLogger` in `logger-shapes.ts` shipped with the loose spelling
`(msg: any, ...rest: any[]) => void`, inherited from the two byte-identical
declarations it replaced. Its members are now spelled
`(msg: string, meta?: Record<string, any>) => void`, and
`sharing-rule-provenance.ts` — which already declared exactly that stricter
signature under its own local `MinimalLogger` — now imports the shared type
instead of declaring a seventh copy.

That direction was chosen deliberately over unifying on the loose spelling.
`(msg: any, ...rest: any[])` documents nothing and catches nothing, which is the
same complaint this card levels at bare `Function`; folding the stricter module
onto it would have deleted real checking to buy uniformity. Taking the precise
spelling instead tightens the two modules that were already on the shared type,
and buys arity and type checking at all 12 in-module call sites — every one of
which already passes exactly a string message plus an optional metadata object.

Caller cost is zero: every caller of the three affected binders passes
`ctx.logger as any` or `undefined`, so no caller constrains the signature.

`check:optional-error-sink` (#9754) membership is unchanged and was verified
before and after: 37 sinks declare `error`, 12 required, 23 optional beside a
required `warn`, 2 permit silence, 2 baselined. The shared shape still declares
no `error` and must not grow one — that would enrol every module using it into
that gate's population, which is a contract decision for the #10556 family
rather than a side effect of de-duplication.

`record-orphan-cleanup.ts`'s bare-`Function` members are deliberately untouched:
tightening them requires tightening two publicly exported option types first,
which moves that gate's population and remains open on #10692.
