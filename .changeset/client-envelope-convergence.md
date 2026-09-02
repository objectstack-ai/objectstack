---
"@objectstack/client": minor
---

feat(client)!: `analytics.query` / `analytics.meta` / `analytics.explain` and `automation.trigger` resolve to the payload — the dispatcher envelope is unwrapped, as on every other SDK method (#13079)

<!-- adr-0087: not-required (runtime-interface-only packages/client/src/index.ts#ObjectStackClient) The four changed members are methods of a published runtime TypeScript class. What moves is the VALUE each promise resolves to — the dispatcher's `{ success, data }` envelope before, its `data` member after — and the matching return annotations. No Zod schema changes, no `packages/spec` declaration moves, no authorable key and no stored representation is involved: the wire body every route answers is byte-identical before and after, only the SDK's reader changed. So `objectstack migrate meta` has nothing to visit and there is no tombstone to mint; the channel that reaches every affected consumer is the COMPILER at the call site (`error TS2339: Property 'data' does not exist on type 'AnalyticsResult'`), which is strictly more precise than a ledger line. Recorded rather than worked around: this body carries a migration table, and the gate refuses `runtime-interface-only` on any body that prescribes a rewrite; `type-surface-only` (#13080) is scoped by its predicate 4 to symbols that were `any` at the merge base, and these four were concrete envelope types there, so no verifiable category fits a concrete-to-concrete runtime interface move that ships its prescription. The disposition is left stated rather than swapped for one that would pass through a detector blind spot. -->

**BREAKING** — a runtime change to what four published SDK methods resolve to. It ships as `minor` under the lockstep launch-window convention (`scripts/check-changeset-no-major.mjs`): the version number is not the migration signal here, this entry is.

Maintainer ruling on #13079 (2026-08-31, verbatim): 「裁决:A,cloud 未测量照裁」 — 「四方法(`analytics.query` / `analytics.meta` / `analytics.explain` / `automation.trigger`)收敛 `unwrapResponse`,SDK 一套读法。」

## What changed

`ObjectStackClient` had two response readers. `unwrapResponse` strips the runtime dispatcher's `{ success, data }` envelope and hands back `data` — every other dispatcher-served method uses it, and every return type bound since #8140 is that post-unwrap payload. These four ended `return res.json()`, which strips nothing, so their callers alone had to read `.data`; the sharpest case was `automation.trigger` and `automation.execute` answering two shapes for one handler. All four now end `return this.unwrapResponse(res)`, and their return declarations are the payload types, derived from the route's declared `data` member where the spec already transcribes it.

## Migration

| method | resolved to (before) | resolves to (now) | rewrite |
|:--|:--|:--|:--|
| `client.analytics.query(q)` | `{ success, data: AnalyticsResult, meta? }` | `AnalyticsResult` | `r.data.rows` → `r.rows` |
| `client.analytics.meta(cube?)` | `AnalyticsMetadataResponse` — `{ success, data: CubeMeta[], meta? }` | `AnalyticsMetadataResponse['data']` — the bare cube list | `r.data[0].name` → `r[0].name` |
| `client.analytics.explain(q)` | `AnalyticsSqlResponse` — `{ success, data: { sql, params }, meta? }` | `AnalyticsSqlResponse['data']` — `{ sql, params }` | `r.data.sql` → `r.sql` |
| `client.automation.trigger(name, payload)` | `{ success, data: AutomationResult, meta? }` | `AutomationResult` — the same value `client.automation.execute` resolves to | `r.data.status` → `r.status`, `r.data.runId` → `r.runId` |

Before / after, per method:

```ts
const r1 = await client.analytics.query({ cube: 'crm_account', measures: ['account_count'] });
r1.data.rows;        // before
r1.rows;             // now

const r2 = await client.analytics.meta();
r2.data[0].name;     // before
r2[0].name;          // now

const r3 = await client.analytics.explain({ cube: 'crm_account', measures: ['account_count'] });
r3.data.sql;         // before
r3.sql;              // now

const r4 = await client.automation.trigger('approve_account', {});
r4.data.status;      // before  ('paused' | 'completed' | 'failed')
r4.status;           // now — exactly what `client.automation.execute` already answered
```

Every old read is a compile error under the new declarations (`Property 'data' does not exist on type …`), so a TypeScript consumer finds each site at build time; a JavaScript consumer reads `undefined` from `.data` and has to search for the four spellings.

### The failure path — read this before touching a `catch`

Nothing changes there, and it is stated per door because a convergence on `unwrapResponse` could be misread as "errors now throw":

- **Non-2xx answers threw before and throw now.** `ObjectStackClient.fetch` rejects on every non-2xx status BEFORE either reader runs, carrying the ADR-0112 envelope on the error (`err.code`, `err.httpStatus`, `err.message`, `err.details`). A failed `trigger` run has been a thrown `400 FLOW_FAILED` since #9378 (`409 FLOW_DISABLED` / `422 FLOW_NO_START_NODE` since #9415); a query the analytics service refuses is a thrown 4xx. Your `catch` blocks are unchanged.
- **`unwrapResponse` never throws.** A 2xx body with a boolean `success` and a `data` key resolves to `data`. A 2xx body with no `data` key resolves unchanged (pass-through) — and no dispatcher door behind these four routes sends a 2xx without `data`, so a resolved `{ success: false, error }` is not a value you will receive from them.
- **What you lose.** The envelope's `success` flag and its `meta` (`timestamp` / `requestId` / `traceId`) are no longer on the resolved value. They were never on any other SDK method's value either; a read of `meta.requestId` off one of these four has no SDK-level replacement, the same as on every other unwrapped method.

### Not changed

- `client.analytics.queryDataset(...)` — served by `@objectstack/rest` with no envelope at all; it resolved to the bare `AnalyticsResult` before and still does (ruling item 1: protected, not converted).
- The wire. Every route answers exactly the body it answered before; a raw-HTTP caller is unaffected.
- `client.automation.execute`, `client.automation.resume` and every other method that already used `unwrapResponse`.

### Populations measured, and the one ruled NOT MEASURED

`packages/client/src/envelope-caller-census.test.ts` (PR #13647) measured the callers: in this repo, zero production call sites and 13 loud test pins — this change's own diff — and in objectui one production site whose row-extraction chain accepts both spellings today (objectui#7028 tightens it to the post-unwrap spelling after this lands). `objectstack-ai/cloud` was not measured (ruling item 4); the census file carries `CLOUD_CENSUS_COMMAND`, and a `.data` read on any of these four there is a runtime break after this change.
