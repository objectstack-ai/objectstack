---
"@objectstack/spec": major
---

**`automation/etl.zod.ts`'s nine type aliases now follow the house `X` / `XParsed`
convention** (#4963): the bare name is `z.input` — what an author writes — and a new
`XParsed` is `z.infer` — what a parse returns.

Until 17 all nine were `z.infer` under the bare name with no `*Parsed` counterpart at
all. On this file that was not a style detail. Five named keys carry `.default()`
(`ETLDestination.writeMode`, `ETLTransformation.continueOnError`, `ETLPipeline.syncMode`
/ `.enabled`, `ETLSource.incremental.enabled`), as does every key of
`ETLPipeline.retry` and of `ETLPipelineRun.stats`, and `schedule` is a
`CronExpressionInputSchema` transform whose *output* is the `{ dialect, source }`
envelope. Under `z.infer` all of them were REQUIRED and a bare cron string was rejected — so the single use this file has, `const p: ETLPipeline = { … }`
written by hand, did not compile. That is the whole authoring door: `etl.zod.ts` has no
parse site in objectstack / objectui / cloud, so the exported schema and the exported
type are the only surface an author touches.

The evidence was checked in. `packages/spec/docs/SYNC_ARCHITECTURE.md` carried three
`ETLPipeline` examples, none of which compiled, and both `ETL` factories were spelling
out defaults and pre-wrapping their cron purely to satisfy their own return type.

### Migration

**Zero importers across objectstack, objectui and cloud** (re-measured against each
repo's `origin/main` for this change), so the migration surface is empty. If you have a
local consumer:

| You wrote | Keep it if | Change it to |
|:---|:---|:---|
| `const p: ETLPipeline = { … }` | you are AUTHORING a pipeline literal | nothing — this is the case that now compiles |
| `const p: ETLPipeline = ETLPipelineSchema.parse(raw)` | — | `const p: ETLPipelineParsed = …` |
| `function run(p: ETLPipeline)` reading `p.syncMode` as always-present | — | `ETLPipelineParsed` |

The same rename applies to each of the nine: `ETLEndpointType`, `ETLSource`,
`ETLDestination`, `ETLTransformationType`, `ETLTransformation`, `ETLSyncMode`,
`ETLPipeline`, `ETLRunStatus`, `ETLPipelineRun` — append `Parsed` wherever the annotated
value came out of a `.parse()`. The four enum aliases are unaffected in practice
(`z.input` and `z.infer` coincide for an enum); their pair exists so a reader never has
to know which of the nine has defaults before choosing an annotation.

Nothing at runtime moves: no schema, default, bound or key changed, and both `ETL`
factories still produce documents that parse to the same result. `ETL.databaseSync` /
`ETL.apiToDatabase` no longer restate `enabled: true` and no longer pre-wrap a bare cron
string into `{ dialect: 'cron', source }` — the schema does that at parse, which is where
it always belonged. Each helper still states what it DECIDES (`incremental` + `upsert`
vs `full` + `append`), because that contrast is the reason the pair exists.

`SYNC_ARCHITECTURE.md`'s three examples now compile, and a compiler-API test
(`etl-author-shape.test.ts`) compiles them verbatim on every run — import line included —
so they cannot rot again silently.
