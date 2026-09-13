---
'@objectstack/sdui-parser': patch
---

`dashboard-widget-options.ts` header: `stageOrder` is a `funnel`-only key, not `funnel` / `pyramid`

The accepted-set census comment at the top of the module (carried into the
published `index.d.ts`) described `stageOrder` as "funnel/pyramid stage order".
There is no `pyramid` widget type: `ChartTypeSchema` refuses it, so an author
who copied the pair got a parse refusal. The line now says what the schema's
own `.describe()` says: `funnel` is the only widget type that reads the key.
Comment-only — the accepted set, the diagnostic code and the emitted JS are
unchanged.
