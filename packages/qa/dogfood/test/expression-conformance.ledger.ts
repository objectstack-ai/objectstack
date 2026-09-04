// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { ConformanceRow } from '@objectstack/verify';
//
// ADR-0058 D7 — Expression Surface Conformance ledger.
//
// The durable encoding of the ADR-0058 audit: ONE classification per expression-
// holding declaration across the spec. Every surface is in exactly one honest
// state, names its evaluator/compiler site, declares its fail-policy (ADR-0058
// D5), and — for the security-critical COMPILE surfaces — references a proof.
//
// `mode` is a property of the surface (ADR-0058 D6): RLS `using`/`check` and the
// sharing `condition` are COMPILE (pushdown via the canonical
// @objectstack/formula compiler); everything else is INTERPRET (per-record, via
// the celEngine). There is NO silent fallback from compile to interpret.
//
// The companion test (`expression-conformance.test.ts`) RE-DISCOVERS every
// expression-declaring field in `packages/spec/src` (plus the RLS
// `using`/`check` string predicates) and asserts each is `covers`-ed by exactly
// one row. A NEW expression surface that nobody classified — the #1887 class of
// "declared-but-unwired predicate" — breaks the build. Discovery is by SCHEMA
// NAME (`EXPRESSION_INPUT_SCHEMAS` in that file), so a slot narrowed onto its
// own schema must register that schema there or it drops out of the scan.
//
// That promise covers all three dialects only as of #15027. The roster listed
// `ExpressionInputSchema` and `SettingsVisibilityInputSchema` and nothing else,
// so the 12 positions typed `CronExpressionInputSchema` /
// `TemplateExpressionInputSchema` could never match — this ledger reported a
// complete classification while carrying zero `cron` and zero `template` rows.
// The claim above was FALSE for two whole dialects, and read as true, which is
// the failure a ratchet is supposed to make impossible. Two limits survive and
// are worth knowing before trusting a green run: discovery still cannot see a
// slot typed with a schema nobody registered (the hazard is structural, not
// spent), and a ratchet key is `file:field`, so several declarations of one key
// name in one file share a single row — see the `discoverSurfaces` docblock and
// #15500.

export type ExprMode = 'compile' | 'interpret';
/**
 * What a surface is ACTUALLY evaluated as — deliberately not the spec's
 * `ExpressionDialect` enum. `js` outlives its retirement from that enum
 * (#3278), and `settings-visibility` never was in it: the settings manifest
 * `visible` slots carry a closed hand-rolled grammar with its own evaluator
 * (#7169 / #7327). A ledger that could only spell the three declared dialects
 * would have to record the settings slot as `cel`, which is the exact
 * misclassification it exists to surface.
 */
export type ExprDialect = 'cel' | 'cron' | 'template' | 'js' | 'settings-visibility';
export type ExprState = 'enforced' | 'experimental' | 'removed';
/** ADR-0058 D5 fail-policy tiers. */
export type FailPolicy = 'compile-error' | 'fail-closed' | 'fail-soft-log' | 'throw';

export interface ExprSurface extends ConformanceRow {
  dialect: ExprDialect;
  mode: ExprMode;
  failPolicy: FailPolicy;
  /** Runtime evaluator / compiler site (ConformanceRow.enforcement, required here). */
  enforcement: string;
  /** `file:field` surfaces (relative to packages/spec/src) this row classifies — the ratchet keys. */
  covers: string[];
}

export const EXPRESSION_SURFACE: ExprSurface[] = [
  // ── COMPILE (pushdown) — security-critical; canonical-compiler-reachable + proven ──
  {
    id: 'rls-using',
    summary: 'RLS `using` read / pre-image predicate',
    dialect: 'cel', mode: 'compile', state: 'enforced', failPolicy: 'fail-closed',
    enforcement: 'plugin-security/rls-compiler.ts → @objectstack/formula compileCelToFilter (legacy SQL bridged); AND-injected by security-plugin computeRlsFilter + service-analytics read-scope-sql',
    covers: ['security/rls.zod.ts:using'],
    proof: 'packages/qa/dogfood/test/rls-fixture.dogfood.test.ts',
  },
  {
    id: 'rls-check',
    summary: 'RLS `check` write post-image validation (ADR-0058 D4)',
    dialect: 'cel', mode: 'compile', state: 'enforced', failPolicy: 'fail-closed',
    enforcement: 'plugin-security/security-plugin.ts step 3.6 → compileCelToFilter + @objectstack/formula matchesFilterCondition',
    covers: ['security/rls.zod.ts:check'],
    proof: 'packages/plugins/plugin-security/src/security-plugin.test.ts',
  },
  {
    id: 'sharing-condition',
    summary: 'sharing-rule `condition` → criteria_json (ADR-0058 D3, closes #1887)',
    dialect: 'cel', mode: 'compile', state: 'enforced', failPolicy: 'fail-closed',
    enforcement: 'plugin-sharing/bootstrap-declared-sharing-rules.ts celToFilter → compileCelToFilter; matched by sharing-rule-service findMatchingRecords',
    covers: ['security/sharing.zod.ts:condition'],
    proof: 'packages/plugins/plugin-sharing/src/sharing-rule.test.ts',
  },

  // ── INTERPRET (per-record) — classified, fail-soft per ADR-0058 D5 ──
  {
    id: 'cel-validation',
    summary: 'object validation predicate (condition / when)',
    dialect: 'cel', mode: 'interpret', state: 'enforced', failPolicy: 'fail-soft-log',
    enforcement: '@objectstack/formula celEngine (interpret) via the validation runner',
    covers: ['data/validation.zod.ts:condition', 'data/validation.zod.ts:when'],
  },
  {
    id: 'cel-hook',
    summary: 'hook gate condition',
    dialect: 'cel', mode: 'interpret', state: 'enforced', failPolicy: 'fail-soft-log',
    enforcement: '@objectstack/formula celEngine (interpret) via the hook runner',
    covers: ['data/hook.zod.ts:condition'],
  },
  {
    id: 'cel-formula',
    summary: 'computed / formula field expressions',
    dialect: 'cel', mode: 'interpret', state: 'enforced', failPolicy: 'fail-soft-log',
    enforcement: '@objectstack/formula celEngine (interpret)',
    // kernel/feature.zod.ts:expression was covered here until the orphaned
    // FeatureFlagSchema module was removed (zero runtime consumers once its
    // capabilities-descriptor home went, #3605).
    // shared/mapping.zod.ts:expression went the same way at #5552: it was the
    // `javascript` member of FieldMappingTransform, and the whole five-member
    // union was retired under ADR-0049 (no runtime executed any of them). The
    // surface it named no longer exists in source, so the cover is deleted
    // rather than re-pointed — and the summary drops "+ mapping expressions"
    // with it, since nothing on that side is left to interpret.
    covers: [
      'data/field.zod.ts:expression',
    ],
  },
  {
    id: 'cel-field-rule',
    summary: 'field UI rules (requiredWhen / readonlyWhen / visibleWhen)',
    // `fail-soft-log` remains the tier for this row: a predicate that is BROKEN
    // on the record (undeclared key, null overload, parse fault) is logged and
    // skipped, on all three slots. One case is carved out and is not
    // representable in the D5 enum — a `readonlyWhen` naming a scope root the
    // write path could not bind (`parent` with no master-detail header) is held
    // LOCKED rather than waved through (#4889, ADR-0058 addendum). The carve-out
    // is inside the same evaluator and the same surface, so it does not split
    // into a second row.
    dialect: 'cel', mode: 'interpret', state: 'enforced', failPolicy: 'fail-soft-log',
    enforcement: '@objectstack/formula celEngine (interpret) — console (objectui) + server (rule-validator `readonlyWhen` strip binds `record`/`previous`, plus the master-detail header as `parent`)',
    covers: [
      'data/field.zod.ts:requiredWhen',
      'data/field.zod.ts:readonlyWhen',
      'data/field.zod.ts:visibleWhen',
    ],
  },
  {
    id: 'cel-ui',
    // "+ submit predicates" left this summary with #9249: `element:form.onSubmit`
    // was the one submit predicate here, and the whole element retired.
    summary: 'UI visibility / routing predicates',
    dialect: 'cel', mode: 'interpret', state: 'enforced', failPolicy: 'fail-soft-log',
    enforcement: 'console (objectui) SchemaRenderer + server celEngine (interpret)',
    covers: [
      // data/object.zod.ts:visibleOn (fieldGroups group-level CEL visibility)
      // was removed by ADR-0085 §3 — declared but never consumed anywhere
      // (enforce-or-remove, ADR-0049). Re-add the row when the key returns
      // WITH an enforcement path.
      'ui/action.zod.ts:visible',
      'ui/app.zod.ts:visible',
      // ADR-0089: `visibleWhen` is the canonical conditional-visibility key on
      // page components and view form sections/fields; `visibility` (page) and
      // `visibleOn` (view) stay accepted as deprecated aliases, normalized to
      // `visibleWhen` at parse. Both spellings are live CEL surfaces until the
      // aliases are removed in a future major, so both carry a ledger row.
      'ui/page.zod.ts:visibleWhen',
      'ui/page.zod.ts:visibility',
      'ui/view.zod.ts:condition',
      'ui/view.zod.ts:visibleWhen',
      'ui/view.zod.ts:visibleOn',
      // `ui/component.zod.ts:onSubmit` (element:form's submit CEL) sat here
      // until #9249 retired the whole `element:form` element under ADR-0049
      // (no renderer ever shipped, so nothing ever evaluated the predicate).
      // The key is a retiredKey() tombstone now — no ExpressionInputSchema
      // member left in source — so the cover is deleted rather than
      // re-pointed, the mapping.zod.ts:expression (#5552) way.
      // Conditional tabs (framework#2606): `page:tabs` item-level visibility.
      // Canonical ADR-0089 `visibleWhen` from day one (no deprecated alias on
      // this new surface). Interpreted by the objectui page:tabs renderer to
      // omit the whole tab (header + panel) when FALSE.
      'ui/component.zod.ts:visibleWhen',
      // `system/settings-manifest.zod.ts:visible` used to sit here. It never
      // belonged: this row's dialect is `cel` and its enforcement is the
      // SchemaRenderer + celEngine, and the settings slot is evaluated by
      // neither. Split out as `settings-visibility` in #7327.
    ],
  },
  {
    id: 'settings-visibility',
    summary: 'settings-manifest `visible` — specifier + whole-manifest gating (a closed non-CEL grammar)',
    // The one row in this ledger whose dialect is NOT one of the spec's three.
    // That is the finding, not an oversight: the slot was typed
    // `ExpressionInputSchema` — which labels its contents CEL — while its only
    // two evaluators read a small hand-rolled grammar. Measured in #7169 over
    // the 94 bundled predicates: routing them through CEL breaks 93 (`===` and
    // `!==` are not CEL operators at all), so the maintainer's 2026-08-10
    // ruling moved the DECLARATION rather than the evaluator. Classifying this
    // `cel` under `cel-ui` would restate here the exact claim #7327 removed
    // from the schema.
    dialect: 'settings-visibility', mode: 'interpret', state: 'enforced', failPolicy: 'fail-closed',
    enforcement:
      'service-settings `evaluateVisibility` (visibility-eval.ts), called from `SettingsService.validatePatch` — a closed grammar: single root `data`, one-level member access, `|| && !`, `=== !== == != >= <= > <`, parens, and string/number/bool/null literals, optionally `${…}`-wrapped, as a bare string or a `{dialect, source}` envelope. Fail-closed since #7310: a predicate outside the grammar REFUSES the save (SettingsValidationError, HTTP 400) instead of skipping the specifier — `visible` gates every other check on the key (`required`, `options`, `pattern`, `valueDomain`, the value window), so skipping it switched all of them off at once. The console evaluates the same string client-side through `new Function(...)`. Since #7327 the spec DECLARES that same grammar (`SettingsVisibilityInputSchema`), so it is refused at publish/parse too',
    covers: ['system/settings-manifest.zod.ts:visible'],
    // Proof is the producer/consumer pin rather than a runtime fixture: the
    // failure mode this surface actually has is the two sides disagreeing about
    // what parses, which is what that file measures — over the real bundled
    // corpus and an in/out-of-grammar table.
    proof: 'packages/services/service-settings/src/settings-visibility-declaration.pin.test.ts',
  },
  {
    id: 'cel-action-param-option-visible',
    summary: "action param option-list per-option gating (params[].options[].visibleWhen, #5016)",
    // Same key, same evaluator and same binding environment as the per-option
    // `visibleWhen` on a FIELD's option list — which is why it is `cel`,
    // `interpret` and `fail-soft-log` like `cel-field-rule` rather than
    // fail-closed: `evalFieldPredicate` is called with `fallback: true`, so a
    // broken predicate leaves the option OFFERED instead of silently deleting a
    // choice the author never meant to remove. It is a SEPARATE row from
    // `cel-ui` because the evaluator differs: `cel-ui`'s surfaces hide an
    // element through the SchemaRenderer, this one narrows an option LIST
    // inside the field widgets.
    dialect: 'cel', mode: 'interpret', state: 'enforced', failPolicy: 'fail-soft-log',
    enforcement: 'console (objectui) ActionParamDialog → paramToField → SelectField / MultiSelectField / RadioField / CheckboxesField → useCascadingOptions → resolveCascadingOptions (core/evaluator/optionRules.ts) → evalFieldPredicate → @objectstack/formula celEngine (interpret), evaluated per OPTION against the live param bag + current_user; a value no longer offered is dropped from the param. UI gating only — `enforceActionParams` (ADR-0104 D2) validates the submitted value against the declared option VALUES and does not evaluate this predicate, so access-control gating must also be enforced by the action body / permissions',
    covers: ['ui/action.zod.ts:visibleWhen'],
  },
  {
    id: 'cel-bulk-action-visible',
    summary: "selection-bar bulk action per-record eligibility (bulkActionDefs[].visible, objectui#3067)",
    dialect: 'cel', mode: 'interpret', state: 'enforced', failPolicy: 'fail-closed',
    enforcement: 'console (objectui) partitionBulkRows (plugin-grid/bulkEligibility.ts) → evalRowPredicate → @objectstack/formula celEngine (interpret), evaluated ONCE PER SELECTED RECORD with that record bound: the button is offered when at least one selected record passes, and the run covers only those — the rest are reported as skipped in the dialog. Faults hide the record (fallback:false, warnOnError) rather than acting on one the predicate was written to exclude; UI gating only, write enforcement stays with permissions/hooks',
    // Reached the ledger in #4457, not #3067: the key existed and was evaluated
    // all along, but it lived inside `bulkActionDefs: z.array(z.record(z.any()))`,
    // so the conformance walk had no declared surface to see. Typing the def is
    // what made it visible — which is the argument for typing it in one line.
    covers: ['ui/bulk-action.zod.ts:visible'],
  },
  {
    id: 'cel-row-crud-visible',
    summary: 'built-in row Edit/Delete per-record visibility (userActions.{edit,delete}.visibleWhen, objectui#2614)',
    dialect: 'cel', mode: 'interpret', state: 'enforced', failPolicy: 'fail-closed',
    enforcement: 'console (objectui) RowActionMenu BuiltinRowActionItem + data-table DataTableBuiltinRowActionItem → useRowPredicate → @objectstack/formula celEngine (interpret); FALSE/fault hides the row button (UI gating only — write enforcement stays with permissions/hooks)',
    covers: ['data/object.zod.ts:visibleWhen'],
  },
  {
    id: 'cel-row-crud-disabled',
    summary: 'built-in row Edit/Delete per-record disabling (userActions.{edit,delete}.disabledWhen, objectui#2614)',
    dialect: 'cel', mode: 'interpret', state: 'enforced', failPolicy: 'fail-soft-log',
    enforcement: 'console (objectui) RowActionMenu BuiltinRowActionItem + data-table DataTableBuiltinRowActionItem → useRowPredicate → @objectstack/formula celEngine (interpret); TRUE renders the button disabled, a fault leaves it enabled (server hooks are the real boundary)',
    covers: ['data/object.zod.ts:disabledWhen'],
  },
  {
    id: 'cel-flow',
    summary: 'flow / loader branching + filter predicates',
    dialect: 'cel', mode: 'interpret', state: 'enforced', failPolicy: 'throw',
    enforcement: '@objectstack/formula celEngine (interpret) via the automation runtime',
    covers: [
      'automation/flow.zod.ts:condition',
      // `automation/sync.zod.ts:condition` (custom validation predicates on
      // the L1 "Simple Sync" DataSyncConfig) left with the whole file in
      // #4738 — the L1 layer was narrative-only, so no engine ever evaluated
      // that predicate. Connector-attached sync (`ConnectorSchema.syncConfig`)
      // declares no CEL surface to re-point this cover at. It does declare a
      // cron one — `syncConfig.schedule` — which was invisible to discovery
      // when that was written and is classified by `cron-declared-unwired`
      // since #15027; nothing evaluates it either.
      // `kernel/metadata-loader.zod.ts:filter` (on MetadataLoadOptions and
      // MetadataExportOptions) was removed with the rest of that file's
      // zero-consumer duplicate envelope family in #4411. The surviving
      // `system/metadata-persistence.zod` copies of those options never
      // declared a `filter` — so no loader predicate was ever evaluated
      // through this surface, and there is nothing to re-point at.
    ],
  },

  // ── CRON dialect (#15027) ─────────────────────────────────────────────────
  // Discovery was blind to `CronExpressionInputSchema` until the roster in the
  // companion test grew, so every row below is a FIRST classification, not an
  // update. Each `enforcement` names what was actually found by walking out
  // from the declaration; where the walk found no evaluator, the row says so
  // and takes a non-`enforced` state rather than borrowing a neighbour's.
  {
    id: 'cron-job-schedule',
    summary: 'declarative background-job cron schedule (CronSchedule.expression)',
    dialect: 'cron', mode: 'interpret', state: 'enforced', failPolicy: 'throw',
    // The lowering seam and its containment are #4567; croner, not cron-parser,
    // is the library behind the adapter.
    enforcement:
      'runtime/job-schedule.ts `toBoundaryJobSchedule` — the authoring→boundary seam: it lowers the parsed `{dialect:"cron",source}` envelope to the bare cron string the adapter takes, and THROWS naming the job on a non-cron dialect, an AST-only envelope, or a missing/blank source. Called from runtime/app-plugin.ts `start`; the boundary value reaches service-job/cron-job-adapter.ts `CronJobAdapter.schedule` → **croner** `Cron` (db-job-adapter.ts routes the cron variant there and persists the shape onto sys_job). The throw is CONTAINED at the call site, deliberately and visibly: AppPlugin catches per job, logs `Background job FAILED TO SCHEDULE — it will never run` at ERROR with the `jobScheduleFailuresTotal` counter, then reports the failed count — boot continues and the job does not run. Cron SYNTAX is not judged on this path at all: `toBoundaryJobSchedule` only checks dialect/source shape, and a syntactically invalid pattern throws later inside croner, into the same catch',
    covers: ['system/job.zod.ts:expression'],
    proof: 'packages/runtime/src/job-schedule.test.ts',
    note: 'The ONE cron slot in the spec with a measured evaluator. `@objectstack/formula` cronEngine is NOT on this path — see `cron-declared-unwired` for what that means for the rest.',
  },
  {
    // The key and its documented hand-off arrived with #14825.
    id: 'cron-knowledge-refresh',
    summary: 'knowledge-source periodic reindex cron (KnowledgeRefreshPolicy.cron) — surfaced, deliberately not scheduled',
    dialect: 'cron', mode: 'interpret', state: 'experimental', failPolicy: 'compile-error',
    enforcement:
      'PARSE ONLY — `CronExpressionInputSchema` refuses a blank/non-string, non-envelope value and normalizes to `{dialect:"cron",source}`; nothing evaluates the result. service-knowledge/knowledge-service.ts reads `refresh.onRecordChange` and NEVER `refresh.cron` (measured: the only `refresh` reads in that package are the two `onRecordChange` sites)',
    covers: ['ai/knowledge-source.zod.ts:cron'],
    note: 'EXPERIMENTAL by DESIGN, and separated from `cron-declared-unwired` for that reason: the key documents its own hand-off — service-knowledge surfaces the value so an automation flow / external scheduler can call `reindexSource`, and the field docblock says so. Nothing in this repo schedules it, which is the intended state rather than an undelivered one. It still has no evaluator, so it is not `enforced`.',
  },
  {
    // Sibling cards named in this row's note: #15500 (ratchet-key granularity)
    // and #15028 (the envelope arm accepts any dialect).
    id: 'cron-declared-unwired',
    summary: 'cron slots on subsystems that were declared but never built — export schedules, flow schedule state, connector sync, cache warmup, DR backup/test',
    dialect: 'cron', mode: 'interpret', state: 'experimental', failPolicy: 'compile-error',
    enforcement:
      'PARSE ONLY — `CronExpressionInputSchema` refuses a blank/non-string, non-envelope value and normalizes to the envelope; NO EVALUATOR FOUND for any of these five keys. Reader hunt, per key, walking out from each declaration (2026-09-04, `61821e54cf5`): `api/export.zod.ts:cronExpression` — the whole `ExportJobApiContracts` family has zero consumers and rest-server serves no `/api/v1/data/export` route, so `POST /api/v1/data/export/schedules` is a declared contract nothing implements; `IExportService` has no provider binding, which its own source already records. `automation/execution.zod.ts:cronExpression` — `ScheduleStateSchema` has no consumer outside packages/spec; the schedule TRIGGER that does work reads a flow start node `config.schedule` through trigger-schedule/schedule-trigger.ts `normalizeSchedule`, a different shape this key never reaches. `integration/connector.zod.ts:schedule` — `syncConfig` has no reader outside packages/spec. `system/cache.zod.ts:schedule` (CacheWarmup) and `system/disaster-recovery.zod.ts:schedule` (BackupConfig + the DR `testing` block) — neither schema has any consumer outside packages/spec',
    covers: [
      'api/export.zod.ts:cronExpression',
      'automation/execution.zod.ts:cronExpression',
      'integration/connector.zod.ts:schedule',
      'system/cache.zod.ts:schedule',
      'system/disaster-recovery.zod.ts:schedule',
    ],
    note: 'EXPERIMENTAL — five declared cron slots with no runtime evaluator (ADR-0049 enforce-or-remove candidates; each wants its own look, and the card that surfaced them says so rather than proposing a sweep). ⚠️ TWO of these keys each cover TWO declaring positions, because a ratchet key is `file:field`: `api/export.zod.ts:cronExpression` is `:576` (ScheduledExport) and `:706` (ScheduleExportRequest), and `system/disaster-recovery.zod.ts:schedule` is `:57` (BackupConfig) and `:238` (the DR `testing` block). Both pairs are genuinely the same surface twice, so one row is honest here — but see the sibling card on ratchet-key GRANULARITY, where the same collapse hides surfaces that are NOT the same. ⚠️ The `failPolicy` on this row is `compile-error` because the PARSE is the only thing that ever refuses one of these values; it is not a claim that cron SYNTAX is checked. It is not: `@objectstack/formula` cronEngine validates 5/6-field patterns and `@` aliases, and has ZERO consumers outside packages/formula — nothing routes these slots through it. And per the sibling finding on the dialect union, the envelope arm of `CronExpressionInputSchema` accepts any declared dialect, so even the parse does not pin these to `cron`.',
  },

  // ── TEMPLATE dialect (#15027) ─────────────────────────────────────────────
  {
    // The apparent owner was #14797 (closed completed), delivered by PR #14819.
    id: 'template-prompt',
    summary: 'AI prompt-template system/user prompts (PromptTemplate.system, .user) — `{{var}}` interpolation',
    dialect: 'template', mode: 'interpret', state: 'experimental', failPolicy: 'compile-error',
    enforcement:
      'PARSE ONLY — `TemplateExpressionInputSchema` refuses a blank/non-string, non-envelope value and normalizes to `{dialect:"template",source}`; NO EVALUATOR FOUND. `PromptTemplateSchema` has no consumer outside packages/spec (measured 2026-09-04), so nothing interpolates the `{{var}}` holes and nothing checks that the declared `variables` match them',
    covers: [
      'ai/model-registry.zod.ts:system',
      'ai/model-registry.zod.ts:user',
    ],
    note: 'EXPERIMENTAL — declared prompt templates with no runtime evaluator (ADR-0049). Ownership was checked before classifying rather than assumed: the card that appeared to own these keys is closed as completed, and its delivered diff (`d355c361157`) touched exactly one file, `skills/objectstack-ai/SKILL.md` — it corrected a prose clause that called these keys CEL, and never owned a ledger row. No open card owns them.',
  },
  {
    id: 'template-title-format',
    summary: 'object record-title template (Object.titleFormat, deprecated → nameField per ADR-0079)',
    dialect: 'template', mode: 'interpret', state: 'experimental', failPolicy: 'compile-error',
    enforcement:
      'PARSE ONLY in this repo — `TemplateExpressionInputSchema` refuses a blank/non-string, non-envelope value. The KEY has a build-time reader that is NOT an evaluator: lint/validate-record-title.ts `validateRecordTitle` (wired into authoring-rules.ts, run by `os build` / `os lint` / the MCP authoring surface) reports every declaration as `title-format-retired`, an advisory WARNING steering the author to `nameField` — it reads that the key is present and never looks at the template text. The server-side title resolver deliberately does NOT read it: spec/src/data/display-name.ts `objectTitleCompleteness` / `resolveRecordDisplayName` resolve `nameField` then the `displayNameField` alias then a derivation, and ADR-0079 states the reason (render-only; the server can neither return nor query it)',
    covers: ['data/object.zod.ts:titleFormat'],
    note: 'EXPERIMENTAL, and the state is a deliberate split between two questions. `packages/spec/liveness/object.json` classifies the KEY `live` with the note "objectui ({{record.field}} interpolation)" — that ledger asks whether anything READS the key, and the answer is yes. THIS ledger asks what EVALUATES the expression and under which fail policy, and the only interpolation site named is in the sibling repo objectui, which is not in this checkout: ⛔ NOT measured here, so it is not written into `enforcement` as if it had been. Marking the row `enforced` on a second-hand reading is exactly the invented cell this ledger exists to prevent; marking it `removed` would contradict a governed ledger that measured more than I could. Re-state as `enforced` when someone measures the objectui site — or as `removed` when ADR-0079 retires the key.',
  },
  {
    id: 'cel-advanced-policy',
    summary: 'advanced security / versioning policy conditions',
    dialect: 'cel', mode: 'interpret', state: 'experimental', failPolicy: 'fail-closed',
    enforcement: '(no runtime consumer yet)',
    covers: [
      'kernel/plugin-security-advanced.zod.ts:condition',
      'kernel/plugin-versioning.zod.ts:condition',
    ],
    note: 'EXPERIMENTAL — declared policy conditions with no runtime evaluator yet (ADR-0056 D8 / ADR-0049 tracking).',
  },
];
