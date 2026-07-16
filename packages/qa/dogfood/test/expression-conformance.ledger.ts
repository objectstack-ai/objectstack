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
// `ExpressionInputSchema` field declaration in `packages/spec/src` (plus the RLS
// `using`/`check` string predicates) and asserts each is `covers`-ed by exactly
// one row. A NEW expression surface that nobody classified — the #1887 class of
// "declared-but-unwired predicate" — breaks the build.

export type ExprMode = 'compile' | 'interpret';
export type ExprDialect = 'cel' | 'cron' | 'template' | 'js';
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
    summary: 'computed / formula field + mapping / graphql / feature expressions',
    dialect: 'cel', mode: 'interpret', state: 'enforced', failPolicy: 'fail-soft-log',
    enforcement: '@objectstack/formula celEngine (interpret)',
    covers: [
      'data/field.zod.ts:expression',
      'shared/mapping.zod.ts:expression',
      'api/graphql.zod.ts:expression',
      'kernel/feature.zod.ts:expression',
    ],
  },
  {
    id: 'cel-field-rule',
    summary: 'field UI rules (requiredWhen / readonlyWhen / visibleWhen / conditionalRequired)',
    dialect: 'cel', mode: 'interpret', state: 'enforced', failPolicy: 'fail-soft-log',
    enforcement: '@objectstack/formula celEngine (interpret) — console (objectui) + server',
    covers: [
      'data/field.zod.ts:requiredWhen',
      'data/field.zod.ts:readonlyWhen',
      'data/field.zod.ts:visibleWhen',
      'data/field.zod.ts:conditionalRequired',
    ],
  },
  {
    id: 'cel-ui',
    summary: 'UI visibility / routing / submit predicates',
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
      'ui/component.zod.ts:onSubmit',
      // Conditional tabs (framework#2606): `page:tabs` item-level visibility.
      // Canonical ADR-0089 `visibleWhen` from day one (no deprecated alias on
      // this new surface). Interpreted by the objectui page:tabs renderer to
      // omit the whole tab (header + panel) when FALSE.
      'ui/component.zod.ts:visibleWhen',
      'system/settings-manifest.zod.ts:visible',
    ],
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
    summary: 'flow / sync / loader branching + filter predicates',
    dialect: 'cel', mode: 'interpret', state: 'enforced', failPolicy: 'throw',
    enforcement: '@objectstack/formula celEngine (interpret) via the automation runtime',
    covers: [
      'automation/flow.zod.ts:condition',
      'automation/sync.zod.ts:condition',
      'kernel/metadata-loader.zod.ts:filter',
    ],
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
