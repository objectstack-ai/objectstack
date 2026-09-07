---
"@objectstack/spec": minor
---

feat(spec)!: a typed expression slot fixes its dialect on the envelope arm too, and refuses a blank string (#15028, #15035)

<!-- adr-0087: not-required (no-migration-prescription) No authorable key is renamed, retired or re-typed: every one of the twelve cron- and template-typed keys still takes the bare string and the same-dialect envelope it took before. The two newly refused shapes — an envelope naming a foreign dialect, and a blank string — were measured against every author value in this repo, the examples, the docs, the skills and the objectui pin (32 cron and 14 template values; #15035 census comment 5552934813): zero real authors write either, so the ledger has nothing to rewrite and this changeset carries no rewrite instruction. The remedy is authoring intent: declare the slot's own dialect, or write the bare string. -->

**BREAKING** accept-set narrowing on the twelve authorable keys typed
`CronExpressionInputSchema` (`system/CronSchedule:expression`,
`ai/KnowledgeRefreshPolicy:cron`, `api/ScheduledExport` and
`api/ScheduleExportRequest` `schedule.cronExpression`,
`automation/ScheduleState:cronExpression`, `integration/DataSyncConfig:schedule`,
`system/CacheWarmup:schedule`, `system/BackupConfig:schedule`,
`system/DisasterRecoveryPlan` `testing.schedule`) and
`TemplateExpressionInputSchema` (`ai/PromptTemplate:system`,
`ai/PromptTemplate:user`, `data/Object:titleFormat`). Shipped as `minor` under
the repo's launch-window convention for breaking changes. Measured cost: zero
— of the 46 author values probed across the repo, the examples, the docs, the
skills and the objectui pin, every one is a bare string or a same-dialect
envelope.

**What changes** (`packages/spec/src/shared/expression.zod.ts`):

- The envelope arm of each typed schema is `ExpressionSchema` narrowed to that
  one dialect literal. A cron-typed slot accepts a bare string or
  `{ dialect: 'cron', source }` only; a template-typed slot likewise for
  `template`. An envelope naming any other dialect — `cel` or `template` on a
  cron slot, `cel` or `cron` on a template slot, or the retired `js` — is
  refused with ONE `invalid_union` at the slot whose message is the slot's
  dialect-only sentence (`TYPED_EXPRESSION_DIALECT_ONLY[dialect]`, exported).
  Before, the arm was the unrestricted `ExpressionSchema`, so a cron slot
  parsed a `cel` envelope green and whatever read it received an expression it
  could not schedule — a copy-paste artifact of the untyped schema, never a
  decision.
- The bare-string arm refuses a blank string — empty or whitespace-only, the
  notion of blank `EvaluatedExpressionSchema` already applies (`source.trim()`)
  — with ONE `invalid_union` at the slot whose message is the slot's
  source-required sentence (`TYPED_EXPRESSION_SOURCE_REQUIRED[dialect]`,
  exported). Before, `.min(1)` did not trim, so `'   '` normalized to
  `{ dialect: 'cron', source: '   ' }` on every typed slot.
- The author type narrows with it: `CronExpressionInput` /
  `TemplateExpressionInput` no longer admit a foreign-dialect envelope, and the
  published JSON Schema and the generated reference page declare the envelope's
  `dialect` as that one literal. `TypedExpressionDialect` names the pair.

**What does NOT change.** No cron syntax is judged at parse time; `croner`
judges it where a schedule is wired (`CronSchedule.expression`, the one cron
slot with a reader); no grammar is restated in spec. `'not a cron'` still
normalizes to `{ dialect: 'cron', source: 'not a cron' }`, deliberately: the
repo's two cron grammars already disagree on 5 of 32 probed patterns, and a
restatement would be a third. `ExpressionInputSchema` and `ExpressionSchema`
are untouched — the untyped envelope still takes every declared dialect, and an
envelope with neither `source` nor `ast` is refused exactly as before.

```ts
// a cron-typed slot, e.g. defineStack({ jobs: [{ schedule: { type: 'cron', expression } }] })
expression: '0 9 * * 1-5'                              // accepted, normalized to { dialect: 'cron', source }
expression: { dialect: 'cron', source: '0 9 * * 1-5' } // accepted verbatim
expression: { dialect: 'cel', source: 'now()' }        // refused at jobs.0.schedule.expression
expression: '   '                                      // refused at jobs.0.schedule.expression
expression: 'not a cron'                               // accepted — syntax is croner's verdict at schedule time
```
