/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Report / chart / query cluster ↔ `@objectstack/spec` drift guard
 * (objectui#3155, objectstack#4115).
 *
 * This file guards the eleven collisions of ledger batch 1, which resolved three
 * different ways — and the tests differ accordingly:
 *
 *  - **Derived** (`AppContextSelectorSchema`, `GlobalFilterSchema`,
 *    `DashboardWidgetSchema`): spec keys now flow in by reference, so the risk is
 *    no longer drift but SHADOWING — a local key quietly reclaiming a name the
 *    spec owns, or a divergence outliving the reason it was granted. Four-way
 *    parity, in the shape `select-option-spec-parity.test.ts` established.
 *  - **Renamed** (`ChartDataSeries`, `ChartDataSeriesSchema`, `SqlQueryAST`,
 *    `DriverQueryConfig`, `SqlDriverInterface`, `DatasourceRegistration`): the
 *    concepts genuinely differ from the spec exports whose names they were
 *    wearing. The risk is picking a new name the spec ALREADY owns — the
 *    `PageComponentSchema` mistake from objectui#3074 — so each new name is
 *    asserted absent from the spec's export set, types and values alike.
 *  - **Burned down** (`JoinedReportBlock`, objectui#10940): erased through the
 *    published 17.4.0, typed — as a different shape — since 17.5.0, which this
 *    repository installs since objectui#11073. The published type IS the spec's
 *    now, a published-type change; the bottom of this file pins the derivation
 *    and, member by member, what replacing the hand-written interface changed.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';
import {
  AppContextSelectorSchema as SpecAppContextSelectorSchema,
  GlobalFilterSchema as SpecGlobalFilterSchema,
  ChartTypeSchema as SpecChartTypeSchema,
  DashboardWidgetSchema as SpecDashboardWidgetSchema,
} from '@objectstack/spec/ui';
import type {
  JoinedReportBlock as SpecJoinedReportBlock,
  JoinedReportBlockParsed as SpecJoinedReportBlockParsed,
} from '@objectstack/spec/ui';
import type { JoinedReportBlock as PublishedJoinedReportBlock, JoinedSpecReport } from '../spec-report.js';
import { AppContextSelectorSchema } from '../zod/app.zod.js';
import { DashboardWidgetSchema, DashboardWidgetTypeSchema, GlobalFilterSchema } from '../zod/complex.zod.js';
import { DASHBOARD_COMPONENT_WIDGET_TYPES, DASHBOARD_WIDGET_TYPE_EXTENSIONS } from '../complex.js';
import { DASHBOARD_WIDGET_TYPES } from '../designer.js';
import type { DashboardWidgetSchema as DashboardWidgetInterface } from '../complex.js';
import {
  liftLegacyGlobalFilterDefault,
  liftLegacyDashboardFilterDefaults,
} from '../dashboard-filter-alias.js';

const shapeOf = (s: unknown) => (s as { shape: Record<string, unknown> }).shape;

// ─────────────────────────────────────────────────────────────────────────────
// AppContextSelectorSchema
// ─────────────────────────────────────────────────────────────────────────────

describe('AppContextSelectorSchema derives from the spec', () => {
  const specKeys = Object.keys(shapeOf(SpecAppContextSelectorSchema)).sort();
  const localKeys = Object.keys(shapeOf(AppContextSelectorSchema)).sort();

  it('carries every spec key', () => {
    for (const key of specKeys) {
      expect(localKeys, `spec key '${key}' missing locally`).toContain(key);
    }
  });

  it('adds no local key of its own', () => {
    // The only sanctioned divergence is a RETYPE of `label`, not an extension.
    // A new name appearing here means someone extended the selector locally
    // instead of promoting the field upstream.
    expect(localKeys.filter((k) => !specKeys.includes(k))).toEqual([]);
  });

  it('keeps the spec keys the old hand copy restated — DECLARED, and no longer written for the author', () => {
    // ⭐ INVERTED by objectui#8317 (decision batch #90). This pin used to read
    // the substituted values back out of the parse output —
    // `optionsSource.valueKey === 'id'`, `labelKey === 'name'`,
    // `persist === 'query'` — and that reading is exactly the defect batch #69
    // ruled against: a validator writing values into an author's document. The
    // three keys are spec-declared and still accepted; what changed is that an
    // author who did not write them does not get them back.
    //
    // ⚠️ The comment below this block has said the important half all along —
    // "a materialised default is indistinguishable from an authored value" —
    // and that indistinguishability is what objectui#8317 removed. Keep both
    // directions asserted, or "stopped substituting" and "stopped declaring"
    // read the same from here.
    const authored = {
      id: 'active_package',
      label: 'Package',
      optionsSource: { endpoint: '/api/packages' },
    };
    expect(AppContextSelectorSchema.parse(authored)).toEqual(authored);

    const spelled = {
      id: 'active_package',
      label: 'Package',
      persist: 'query',
      optionsSource: { endpoint: '/api/packages', valueKey: 'id', labelKey: 'name' },
    };
    expect(AppContextSelectorSchema.parse(spelled)).toEqual(spelled);

    // Still DECLARED — membership is what the spec derivation owes, and it is
    // not readable off parse output any more (`BaseSchema` is passthrough, so
    // an undeclared key would survive a parse too).
    const optionsSource = shapeOf(AppContextSelectorSchema).optionsSource;
    for (const key of ['valueKey', 'labelKey']) {
      expect(Object.keys(shapeOf(optionsSource)), `optionsSource.${key} must stay declared`).toContain(key);
    }
    expect(Object.keys(shapeOf(AppContextSelectorSchema))).toContain('persist');

    // `includeAll` and `placement` were asserted here until spec 17.0.0
    // removed them (framework#4509 / objectui#3208). Both carried schema
    // defaults, which is exactly why the liveness lint could not flag them:
    // a materialised default is indistinguishable from an authored value.
    // Removal was the only channel that reaches the author.
  });
});

describe('AppContextSelectorSchema pinned divergence', () => {
  const base = { id: 'pkg', optionsSource: { endpoint: '/api/x' } };

  it('widens `label` to objectui\'s i18n envelope on purpose', () => {
    // `AppContextSelectors` (@object-ui/app-shell) renders the label through
    // `resolveI18nLabel`, so a localized selector must validate here…
    const i18n = { default: 'Package', translations: { 'zh-CN': '安装包' } };
    expect(AppContextSelectorSchema.safeParse({ ...base, label: i18n }).success).toBe(true);
    // …while the spec (plain `z.string()`) rejects it. If the spec ever widens
    // `label` itself, this flips and the local override is what to delete.
    expect(SpecAppContextSelectorSchema.safeParse({ ...base, label: i18n }).success).toBe(false);
  });

  it('still accepts the spec\'s plain-string label', () => {
    expect(AppContextSelectorSchema.safeParse({ ...base, label: 'Package' }).success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GlobalFilterSchema
// ─────────────────────────────────────────────────────────────────────────────

describe('GlobalFilterSchema derives from the spec', () => {
  const specKeys = Object.keys(shapeOf(SpecGlobalFilterSchema)).sort();
  const localKeys = Object.keys(shapeOf(GlobalFilterSchema)).sort();

  it('carries every spec key', () => {
    for (const key of specKeys) {
      expect(localKeys, `spec key '${key}' missing locally`).toContain(key);
    }
  });

  it('adds no local key of its own', () => {
    expect(localKeys.filter((k) => !specKeys.includes(k))).toEqual([]);
  });

  it('picks up the spec `scope` vocabulary by reference', () => {
    // Previously `z.string().optional()` — any typo validated. Nothing reads
    // `scope` at runtime, so adopting the spec enum costs nothing and closes it.
    const parsed = GlobalFilterSchema.parse({ field: 'stage', scope: 'dashboard' });
    expect(parsed.scope).toBe('dashboard');
    expect(GlobalFilterSchema.safeParse({ field: 'stage', scope: 'globl' }).success).toBe(false);
  });
});

/**
 * The two pinned divergences this block used to assert are RETIRED (objectui#7759
 * group A). `GlobalFilterSchema` restated `options` (bare-string shorthand, an
 * optional `label`, a `z.string()` label) and `optionsFrom` (optional
 * `labelField`, `filter: z.any()`) over the spec's shape, asserting each "in both
 * directions so it dies the day the spec adopts it". The spec did not move; the
 * ruling did — ruling 5617465269 principle 1: a key the spec declares is stated
 * by the spec on both faces. So the local schema IS the spec's now, and what is
 * pinned is that verdict, on the same literals, from both schemas.
 *
 * ⚠️ Retired at the SCHEMA first, and since objectui#4356 at the READ PATH too
 * (the objectstack#7917 option-② schedule): `normalizeFilterOptions`
 * (`@object-ui/core`'s `dashboard-filters.ts`) no longer lifts a stored
 * bare-string option — the member yields no option and a dev-mode warning
 * names it — so both faces now refuse the same spelling.
 */
describe('GlobalFilterSchema: the local divergences are retired (objectui#7759)', () => {
  const both = (doc: unknown) => [GlobalFilterSchema.safeParse(doc).success, SpecGlobalFilterSchema.safeParse(doc).success];

  it('refuses the bare-string options shorthand and a label-less option, as the spec does', () => {
    expect(both({ field: 'region', options: ['EMEA', 'APAC'] })).toEqual([false, false]);
    expect(both({ field: 'region', options: [{ value: 'emea' }] })).toEqual([false, false]);
  });

  it('requires `optionsFrom.labelField`, and takes the spec\'s `FilterCondition` for `filter`', () => {
    expect(both({ field: 'owner', optionsFrom: { object: 'users', valueField: 'id' } })).toEqual([false, false]);
    expect(both({
      field: 'owner', optionsFrom: { object: 'users', valueField: 'id', labelField: 'name', filter: [['active', '=', true]] },
    })).toEqual([false, false]);
    expect(both({
      field: 'owner', optionsFrom: { object: 'users', valueField: 'id', labelField: 'name', filter: { active: true } },
    })).toEqual([true, true]);
  });

  it('admits the inline per-locale option label it used to refuse', () => {
    expect(both({ field: 'region', options: [{ value: 'emea', label: { en: 'EMEA', 'zh-CN': '欧洲' } }] })).toEqual([true, true]);
  });
});

/**
 * The rc.6 date-`defaultValue` refinement, ADOPTED — objectui#4165.
 *
 * This block replaces the standstill tripwire that used to live here. That
 * tripwire pinned "objectui does NOT carry the spec's refinement" and was
 * designed to go red from either side the moment the conflict was resolved;
 * the maintainer ruling of 2026-08-11 resolved it consumer-side, the tripwire
 * went red exactly as designed, and it is deleted with its note rather than
 * repaired. What follows pins the RESOLUTION, in both directions.
 *
 * The ruling, verbatim (objectui#4165):
 *
 * > 「spec stays strict — no widening。rc.6 的 refinement 成立，bare preset NAME
 * > 是唯一 canonical spelling。」stored `{ preset }` becomes a documented legacy
 * > alias per the ADR-0089 alias-retirement pattern — lift on read, rewrite on
 * > next save, retirement window recorded at the read site.
 *
 * So there are two facts to hold apart, and a test that pins only one of them
 * would read as coverage while missing half the contract:
 *
 *  - the SCHEMA refuses the object form (the contract now matches the platform,
 *    so the designer can no longer go green on metadata the server rejects);
 *  - the READ PATH lifts it first, so a stored document carrying the alias is
 *    still loadable for the length of the window.
 */
describe('GlobalFilterSchema carries the spec rc.6 date refinement (objectui#4165)', () => {
  const legacy = { field: 'created_at', type: 'date', defaultValue: { preset: 'last_7_days' } };
  const canonical = { field: 'created_at', type: 'date', defaultValue: 'last_7_days' };

  it('accepts the canonical bare preset NAME, on both sides', () => {
    expect(GlobalFilterSchema.safeParse(canonical).success).toBe(true);
    expect(SpecGlobalFilterSchema.safeParse(canonical).success).toBe(true);
  });

  it('accepts the refinement\'s two other spellings — ISO date and date macro', () => {
    // Named here because the rejection message enumerates exactly three, and a
    // consumer that adopted the rule but only ever tested presets would not
    // notice if a future composition dropped the other two.
    for (const defaultValue of ['2026-01-15', '2026-01-15T08:30:00Z', '{today}', '{30_days_ago}']) {
      expect(
        GlobalFilterSchema.safeParse({ field: 'created_at', type: 'date', defaultValue }).success,
        `expected \`${defaultValue}\` to be accepted`,
      ).toBe(true);
    }
  });

  /**
   * MIND THE LAYER — the issue's "the obvious probe is misleading" warning
   * applies to this schema now too, in mirror image.
   *
   * #4165's body warned that probing the SPEC with `{ preset }` measures
   * nothing about the refinement, because the narrow `defaultValue` field type
   * rejects first (`invalid_union`) and the refinement never runs. Dropping
   * objectui's `z.any()` divergence gives this schema that same narrow field —
   * so the same shadowing now happens HERE, and it is measured, not assumed:
   *
   *   {"preset":"last_7_days"}  → invalid_union@defaultValue: "Invalid input"
   *   "last_5_fortnights"       → custom@defaultValue: "…is not a value a
   *                               `type: 'date'` filter can resolve…"
   *
   * So the two facts need two different probes, and swapping them produces a
   * test that passes for the wrong reason:
   *
   *  - that `{ preset }` is REFUSED is pinned below on the outcome and the
   *    issue path, deliberately NOT on the refinement's message — demanding
   *    that message here would be pinning a rule that never ran;
   *  - that the refinement is CARRIED needs a value the field type admits, so
   *    it is isolated with a bogus preset STRING in the test after this one.
   *    That is the only assertion in this file that can go red if the
   *    delegation in `complex.zod.ts` is dropped.
   */
  it('REFUSES the legacy `{ preset }` object form', () => {
    const refused = GlobalFilterSchema.safeParse(legacy);
    expect(refused.success).toBe(false);
    expect(refused.error?.issues?.map((i) => i.path.join('.'))).toContain('defaultValue');
    // The spec refuses it the same way and at the same layer — which is the
    // point of retiring the divergence: one contract, one verdict.
    expect(SpecGlobalFilterSchema.safeParse(legacy).success).toBe(false);
  });

  it('carries the REFINEMENT, not just the narrow field type', () => {
    // A bogus preset NAME is a string, so it clears `string | number | boolean`
    // and can only be refused by the rc.6 cross-field rule. Asserting the
    // spec's own message is what separates "objectui re-implemented the rule"
    // from "objectui delegates to the spec": a hand-written local copy would
    // keep the verdict and lose the wording, and then drift silently on the
    // next spec change.
    const refused = GlobalFilterSchema.safeParse({
      field: 'created_at', type: 'date', defaultValue: 'last_5_fortnights',
    });
    expect(refused.success).toBe(false);
    expect(
      refused.error?.issues?.some((i) => /is not a value a .*date.* filter can resolve/.test(i.message)),
      'the refinement is no longer reaching this schema (or its message changed ' +
        'upstream). Re-read objectui#4165 before relaxing this: adopting the rule ' +
        'IS the resolution the maintainer ruled for.',
    ).toBe(true);
  });

  it('leaves a NON-date filter\'s defaultValue alone', () => {
    // The refinement is scoped to `type: 'date'`. Adopting it must not start
    // policing a select/text filter's default.
    expect(GlobalFilterSchema.safeParse({ field: 'region', type: 'select', defaultValue: 'EMEA' }).success).toBe(true);
    expect(GlobalFilterSchema.safeParse({ field: 'amount', type: 'number', defaultValue: 42 }).success).toBe(true);
  });

  it('carries the refinement with the spec schema itself, now that no divergence is composed over it', () => {
    // This case used to pin the COMPOSITION — the local `options` / `optionsFrom`
    // overrides applied alongside a delegated refinement — with a document that
    // carried the bare-string shorthand and a `labelField`-less `optionsFrom`.
    // objectui#7759 retired both overrides, so the schema IS the spec's and the
    // refinement arrives with it: a date default is still judged, on a document
    // whose options are spec-legal.
    const withOptions = {
      field: 'created_at', type: 'date', options: [{ value: 'emea', label: 'EMEA' }],
      optionsFrom: { object: 'users', valueField: 'id', labelField: 'name' },
    };
    expect(GlobalFilterSchema.safeParse({ ...withOptions, defaultValue: 'last_7_days' }).success).toBe(true);
    expect(GlobalFilterSchema.safeParse({ ...withOptions, defaultValue: 'last_7_dayz' }).success).toBe(false);
  });

  describe('the ADR-0089 legacy-alias lift', () => {
    it('turns a stored `{ preset }` declaration into something the schema accepts', () => {
      // The read path's contract, end to end: refused raw, accepted lifted.
      expect(GlobalFilterSchema.safeParse(legacy).success).toBe(false);
      const lifted = liftLegacyGlobalFilterDefault(legacy);
      const parsed = GlobalFilterSchema.safeParse(lifted);
      expect(parsed.success).toBe(true);
      expect((parsed as { data: { defaultValue?: unknown } }).data.defaultValue).toBe('last_7_days');
    });

    it('is identity — same reference — when there is nothing to lift', () => {
      // Load-bearing for the designer: a new object on every load would read as
      // an edit and mark a pristine dashboard dirty.
      expect(liftLegacyGlobalFilterDefault(canonical)).toBe(canonical);
      const noDefault = { field: 'region', type: 'select' };
      expect(liftLegacyGlobalFilterDefault(noDefault)).toBe(noDefault);
    });

    it('does NOT lift a `{ preset, from, to }` value — that has no canonical spelling', () => {
      // Lifting it would have to drop `from`/`to` to fit the bare-name form,
      // losing data silently. It falls through to the spec's named rejection
      // instead, which is the loud outcome we want.
      const withBounds = {
        field: 'created_at', type: 'date',
        defaultValue: { preset: 'last_7_days', from: '2026-01-01', to: '2026-01-31' },
      };
      expect(liftLegacyGlobalFilterDefault(withBounds)).toBe(withBounds);
      expect(GlobalFilterSchema.safeParse(withBounds).success).toBe(false);
    });

    it('lifts every entry of a dashboard document, and only when one is legacy', () => {
      const legacyDoc: { type: string; globalFilters: Array<Record<string, unknown>> } = {
        type: 'dashboard',
        globalFilters: [legacy, { field: 'region' }],
      };
      const liftedDoc = liftLegacyDashboardFilterDefaults(legacyDoc);
      expect(liftedDoc).not.toBe(legacyDoc);
      expect(liftedDoc.globalFilters[0].defaultValue).toBe('last_7_days');
      // Untouched entries keep their identity.
      expect(liftedDoc.globalFilters[1]).toBe(legacyDoc.globalFilters[1]);

      const canonicalDoc = { type: 'dashboard', globalFilters: [canonical] };
      expect(liftLegacyDashboardFilterDefaults(canonicalDoc)).toBe(canonicalDoc);
      const noFilters = { type: 'dashboard' };
      expect(liftLegacyDashboardFilterDefaults(noFilters)).toBe(noFilters);
    });

    it('is idempotent', () => {
      const once = liftLegacyGlobalFilterDefault(legacy);
      expect(liftLegacyGlobalFilterDefault(once)).toBe(once);
    });
  });

  /**
   * The window's documentation is part of the deliverable, not commentary
   * (maintainer ruling: "retirement window recorded at the read site"). An
   * alias whose removal conditions are not written down is an alias nobody
   * dares remove — which is how a "temporary" tolerance becomes permanent.
   *
   * Source-text pin rather than a behavioural one, because there is no runtime
   * surface for a doc comment. It asks only for the three elements ADR-0089
   * requires — what the alias is, why it is lifted, and when it may go — plus
   * the issue number that carries the ruling.
   */
  it('records the retirement window at the read site', () => {
    const readSite = resolve(
      dirname(new URL(import.meta.url).pathname),
      '../../../core/src/utils/dashboard-filters.ts',
    );
    const source = readFileSync(readSite, 'utf8');
    for (const required of [
      'liftLegacyGlobalFilterDefault', // the lift, imported not re-implemented
      '#4165', // the ruling's issue
      'ADR-0089', // the pattern being followed
      'What it is', // what the alias is
      'Why it is lifted here rather than tolerated', // why
      'When it may be removed', // the window's end
      '18.0.0', // …stated as a concrete version, not "later"
    ]) {
      expect(source, `the read site no longer documents: ${required}`).toContain(required);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DashboardWidgetSchema
// ─────────────────────────────────────────────────────────────────────────────

describe('DashboardWidgetSchema derives from the spec', () => {
  const specKeys = Object.keys(shapeOf(SpecDashboardWidgetSchema)).sort();
  const localKeys = Object.keys(shapeOf(DashboardWidgetSchema)).sort();

  it('carries every spec key', () => {
    for (const key of specKeys) {
      expect(localKeys, `spec key '${key}' missing locally`).toContain(key);
    }
  });

  it('extends the spec by exactly the documented objectui-only key', () => {
    // If the spec ever claims `component`, the two meanings must be reconciled
    // rather than silently shadowed.
    expect(localKeys.filter((k) => !specKeys.includes(k))).toEqual(['component']);
  });

  it('stops stripping the spec keys the hand copy dropped', () => {
    // Every one of these survived `objectui validate` with its value deleted
    // before the derivation — including the capability gates, which the
    // dashboard renderer honours at runtime.
    //
    // Four of the original twelve are gone: `actionUrl` / `actionType` /
    // `actionIcon` and `aria` were retired in @objectstack/spec 17.0.0-rc.3
    // (objectstack#5010, ADR-0049 enforce-or-remove). A dashboard widget has no
    // action button and never had one — every action the dashboard dispatches
    // comes from `header.actions[]` — and no renderer ever applied the widget
    // `aria`, so it promised accessibility compliance it did not deliver. They
    // move to the negative-control block below: this fixture would now be
    // REFUSED rather than parsed, which is the opposite of what it asserts.
    const parsed = DashboardWidgetSchema.parse({
      id: 'w1',
      type: 'bar',
      description: 'Pipeline by stage',
      colorVariant: 'blue',
      requiresObject: 'opportunity',
      requiresService: 'analytics',
      suppressWarnings: ['no-data'],
      dataset: 'pipeline',
      dimensions: ['stage'],
      values: ['amount'],
      layout: { x: 0, y: 0, w: 6, h: 4 },
      filterBindings: { dateRange: 'closed_at' },
    });
    expect(parsed.description).toBe('Pipeline by stage');
    expect(parsed.colorVariant).toBe('blue');
    expect(parsed.requiresObject).toBe('opportunity');
    expect(parsed.requiresService).toBe('analytics');
    expect(parsed.suppressWarnings).toEqual(['no-data']);
    expect(parsed.layout).toEqual({ x: 0, y: 0, w: 6, h: 4 });
    expect(parsed.filterBindings).toEqual({ dateRange: 'closed_at' });
  });

  it('REFUSES the four keys objectstack#5010 retired, by name', () => {
    // Not "strips" — refuses. That distinction is the whole point of
    // ADR-0049 enforce-or-remove: a stale dashboard carrying `actionUrl` gets
    // told where the affordance moved (`header.actions[]`) instead of silently
    // losing it, which is what the pre-derivation hand copy did.
    for (const key of ['actionUrl', 'actionType', 'actionIcon', 'aria'] as const) {
      const result = DashboardWidgetSchema.safeParse({
        id: 'w1',
        type: 'bar',
        dataset: 'pipeline',
        dimensions: ['stage'],
        values: ['amount'],
        [key]: key === 'aria' ? { ariaLabel: 'Pipeline' } : 'x',
      });
      expect(result.success, `'${key}' must be refused, not accepted`).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path[0] === key)).toBe(true);
      }
    }
  });

  it('REFUSES `responsive`, retired separately by objectstack#4876', () => {
    // Same inheritance mechanism as the four above, DIFFERENT retirement:
    // `responsive` fell in @objectstack/spec 17.0.0-rc.6 under objectstack#4876
    // (ADR-0049 D2), not rc.3's #5010 — so it carries its own tombstone text and
    // gets its own case rather than a fifth entry in the loop above.
    //
    // objectui kept `responsive?: any` in `complex.ts` past that retirement, on
    // the stated grounds that the renderer reads a per-breakpoint record.
    // objectui#3173 measured it: zero `widget.responsive` read points, zero
    // authored occurrences. The override was removed, so TS and Zod now agree.
    const result = DashboardWidgetSchema.safeParse({
      id: 'w1',
      type: 'bar',
      dataset: 'pipeline',
      dimensions: ['stage'],
      values: ['amount'],
      responsive: { sm: { columns: 1 } },
    });
    expect(result.success, '`responsive` must be refused, not accepted').toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === 'responsive');
      expect(issue, '`responsive` must be reported by name').toBeDefined();
      // The tombstone names its own retirement, not #5010's — if this ever reads
      // `#5010` the key was folded into the wrong retirement upstream.
      // Was `'#4876, ADR-0049 D2'`. 17.3.0 stripped the `#NNNN` half of that
      // citation and kept the ADR reference and the prescription, so the
      // assertion keeps the durable half plus the repair the author acts on.
      expect(issue?.message).toContain('ADR-0049 D2');
      expect(issue?.message).toContain('Delete the key.');
      // And it must point at the surviving home for breakpoint behaviour rather
      // than just saying "removed".
      expect(issue?.message).toContain('page.components[].responsive');
    }
  });

  it('refuses `responsive` on the TypeScript interface too', () => {
    // The Zod case above does NOT guard this change, and saying so is the point
    // of splitting it out. Restoring `responsive?: any` to `complex.ts` leaves
    // that case green: the Zod twin derives every key by reference, so it
    // refused `responsive` from the moment rc.6 landed the tombstone and its
    // verdict never depended on the interface. What objectui#3173 actually
    // fixed is the TS half — the `Omit` that held `responsive` out of the
    // inherited key set so tsc kept accepting a value validation rejects.
    //
    // So the guard for it is this directive, not an `expect`. Per this
    // package's `type-check` (`tsc -p tsconfig.test.json` compiles every test
    // file), putting `responsive` back makes the directive unused and fails
    // the build — the same enforcement `accordion-item-authorable-keys.test.ts`
    // relies on. Measured both ways on objectui#3173's branch: with the fix,
    // `error TS2322: Type '{ sm: { columns: number; }; }' is not assignable to
    // type 'undefined'`; with `responsive?: any` restored, tsc is silent.
    const widget: DashboardWidgetInterface = {
      id: 'w1',
      type: 'bar',
      // @ts-expect-error `responsive` is retired (objectstack#4876, ADR-0049
      // D2) and inherits as `?: never`. Excess-property checking on this
      // literal is what carries the retirement to authors writing TypeScript,
      // who would otherwise meet it only at validation time.
      responsive: { sm: { columns: 1 } },
    };

    // The runtime assertion is incidental — the contract lives in the directive
    // above, which only compiles while the key is absent from the interface.
    expect(widget.id).toBe('w1');
  });
});

describe('DashboardWidgetSchema pinned divergences', () => {
  it('keeps `id` optional — stored dashboards and legacy widgets omit it', () => {
    expect(DashboardWidgetSchema.safeParse({ type: 'metric' }).success).toBe(true);
    expect(SpecDashboardWidgetSchema.safeParse({ type: 'metric' }).success).toBe(false);
  });

  it('widens `type` for the objectui-only `list` / `custom` families', () => {
    for (const type of DASHBOARD_WIDGET_TYPE_EXTENSIONS) {
      expect(DashboardWidgetSchema.safeParse({ id: 'w', type }).success).toBe(true);
      // If the spec adopts either family, drop the widening and use its enum.
      expect(SpecDashboardWidgetSchema.safeParse({ id: 'w', type }).success).toBe(false);
    }
  });

  it('does NOT admit `metric-card`: it is objectui\'s own COMPONENT extension, read by the slot\'s component arm (ruling 2026-08-14, objectui#11483)', () => {
    // objectstack#8593, maintainer, verbatim: `metric-card` joins objectui's own
    // CLOSED component enum as an explicitly allowed objectui extension, NOT the
    // spec widget enum. That component enum is the slot's component arm's `type`;
    // since objectui#11483 it is no widget type either, because a `metric-card`
    // parsing here as a widget skipped the card's required `value`. Both halves
    // are asserted: the spec refuses it too, so this stays an objectui-local
    // extension instead of a quiet spec change.
    expect(DASHBOARD_COMPONENT_WIDGET_TYPES.length).toBeGreaterThan(0);
    for (const type of DASHBOARD_COMPONENT_WIDGET_TYPES) {
      expect(DashboardWidgetSchema.safeParse({ id: 'w', type }).success).toBe(false);
      expect(SpecDashboardWidgetSchema.safeParse({ id: 'w', type }).success).toBe(false);
    }
  });

  it('CLOSES `type` — the widening is a named set, not an open hatch', () => {
    // The regression this guards is objectui#4600's: `type` was `z.string()`,
    // so a typo'd family, a component nothing registers, and a chart type the
    // spec retired all validated and only surfaced as the renderer's red
    // OBJUI-001 panel. `examples/schema-catalog` is an AI few-shot retrieval
    // source, so an accepted-but-unrenderable `type` is copied onward.
    for (const type of ['zzz-not-a-widget-type', 'metrci-card', 'heatmap', 'sunburst']) {
      const result = DashboardWidgetSchema.safeParse({ id: 'w', type });
      expect(result.success, `'${type}' must be refused`).toBe(false);
    }
  });

  it('takes the spec half of the vocabulary BY REFERENCE, not as a copy', () => {
    // Every family the spec models must be accepted here without an edit — the
    // "narrower than the contract it implements" failure this file records for
    // `label` and `defaultRange` would otherwise reappear on `type`, and a
    // family the spec ADDS would be a legal document objectui refuses.
    for (const type of SpecChartTypeSchema.options) {
      expect(DashboardWidgetSchema.safeParse({ id: 'w', type }).success, `spec family '${type}'`).toBe(true);
    }
    // And the closed enum is EXACTLY the spec's families plus the declared
    // objectui extension set — no undocumented member has crept in, and the
    // component set left it with objectui#11483.
    expect(new Set(DashboardWidgetTypeSchema.options)).toEqual(new Set([
      ...SpecChartTypeSchema.options,
      ...DASHBOARD_WIDGET_TYPE_EXTENSIONS,
    ]));
  });

  it('keeps the designer\'s offer list inside the closed vocabulary', () => {
    // `DASHBOARD_WIDGET_TYPES` (designer.ts) is what `WidgetConfigPanel` offers
    // an author. It is a SEPARATE list from the validation vocabulary and is
    // deliberately shorter, but it must never offer a type validation refuses —
    // that would be a designer that saves what the platform rejects.
    for (const type of DASHBOARD_WIDGET_TYPES) {
      expect(DashboardWidgetTypeSchema.safeParse(type).success, `designer offers '${type}'`).toBe(true);
    }
  });

  it('still accepts the legacy `component` envelope, with the one node it takes (objectui#12163, ruling C)', () => {
    const card = { type: 'metric-card', title: 'Revenue', value: '$1' };
    const parsed = DashboardWidgetSchema.parse({
      id: 'w', component: card, layout: { x: 0, y: 0, w: 4, h: 3 },
    });
    expect(parsed.component).toEqual(card);
    // Any other node is refused by name, at the slot. Until objectui#12163 a `chart` node
    // parsed here through a `BaseSchema` arm (this file never loads the `index.zod`
    // barrel, so that arm's recursion point was unfilled, and the verdict said nothing
    // about the published face); the refusal arm answers the same in any module graph.
    const refused = DashboardWidgetSchema.safeParse({ id: 'w', component: { type: 'chart' }, layout: { x: 0, y: 0, w: 4, h: 3 } });
    expect(refused.success).toBe(false);
    const issues = refused.success ? [] : refused.error.issues;
    expect(issues.map((issue) => [issue.code, issue.path.join('.')])).toEqual([['custom', 'component']]);
    expect(issues[0]?.message).toContain('`chart` node');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rename tripwires — the new names must not be spec names
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The compiler's view of the INSTALLED `@objectstack/spec`'s built `.d.ts`, per
 * subpath, with the version it was read from. Shared by the rename tripwires
 * below and by the `JoinedReportBlock` tripwire at the bottom of this file.
 */
function specDeclarations(subpaths: readonly string[]): {
  version: string;
  checker: ts.TypeChecker;
  modules: ts.Symbol[];
} {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve('@objectstack/spec/package.json');
  const pkgDir = dirname(pkgPath);
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    version: string;
    exports?: Record<string, { import?: { types?: string }; require?: { types?: string } }>;
  };

  const files: string[] = [];
  for (const [sub, cond] of Object.entries(pkg.exports ?? {})) {
    const name = sub === '.' ? '@objectstack/spec' : `@objectstack/spec${sub.slice(1)}`;
    if (!subpaths.includes(name)) continue;
    const dts = cond?.import?.types ?? cond?.require?.types;
    if (dts) files.push(resolve(pkgDir, dts));
  }
  if (files.length !== subpaths.length) {
    throw new Error(`could not resolve type entrypoints for ${subpaths.join(', ')}`);
  }

  const program = ts.createProgram(files, {
    noEmit: true,
    skipLibCheck: true,
    strict: false,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
  const checker = program.getTypeChecker();

  const modules = files.map((file) => {
    const sf = program.getSourceFile(file);
    const moduleSymbol = sf && checker.getSymbolAtLocation(sf);
    if (!moduleSymbol) throw new Error(`no module symbol for ${file}`);
    return moduleSymbol;
  });
  return { version: pkg.version, checker, modules };
}

/**
 * Every export name `@objectstack/spec` publishes, per subpath — TYPES included.
 *
 * A runtime `import()` would only see values, and five of the six names below
 * are types, so a value-only check would pass vacuously on exactly the cases
 * that matter. This reads the compiler's view of each subpath's `.d.ts`, which
 * is the same source `scripts/check-spec-symbol-derivation.mjs` uses.
 */
function specExportNames(subpaths: readonly string[]): Set<string> {
  const { checker, modules } = specDeclarations(subpaths);
  const names = new Set<string>();
  for (const moduleSymbol of modules) {
    for (const exported of checker.getExportsOfModule(moduleSymbol)) names.add(exported.getName());
  }
  return names;
}

describe('renamed local dialects do not collide with a spec export (objectui#3074 lesson)', () => {
  const names = specExportNames(['@objectstack/spec/ui', '@objectstack/spec/data']);

  it('reads a plausible spec export set (guards the assertions below)', () => {
    expect(names.size).toBeGreaterThan(100);
    // The names these six were renamed OFF are still the spec's — that is why
    // the renames happened, and it keeps this test honest about what it reads.
    for (const owned of [
      'ChartSeries', 'ChartSeriesSchema', 'QueryAST', 'QuerySchema',
      'DriverInterface', 'DatasourceSchema',
    ]) {
      expect(names, `spec no longer owns '${owned}' — re-run the triage`).toContain(owned);
    }
  });

  it.each([
    ['ChartDataSeries', 'inline-data series of the objectui ChartSchema node'],
    ['ChartDataSeriesSchema', 'zod twin of ChartDataSeries'],
    ['SqlQueryAST', 'compiled SQL syntax tree, not the spec ObjectQL request'],
    ['DriverQueryConfig', 'high-level query config the SQL AST builder consumes'],
    ['SqlDriverInterface', "objectui's SQL-oriented client driver abstraction"],
    ['DatasourceRegistration', 'in-memory datasource registration record'],
    // objectui#3162 batch 8. `JoinNode` was ledgered as "erased to `any` upstream,
    // re-export once objectstack#4171 lands". #4171 landed — and the symbol it was
    // waiting on no longer exists: spec 17.0.0 retired `query.joins` and the whole
    // JoinNode cluster (framework#4286), so there is nothing upstream to bind to
    // and `data-protocol.ts` owns the name outright. Measured against spec 17.2.0:
    // importing it from `@objectstack/spec/ui` OR `/data` is TS2305. This row is
    // what tells us if the spec ever mints the name again, which is the only way
    // the collision could come back.
    ['JoinNode', "objectui's local query-AST join node; the spec retired its own (framework#4286)"],
  ])('the spec does not own `%s` (%s)', (name) => {
    expect(names).not.toContain(name);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// JoinedReportBlock — derived from the spec since objectui#10940
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `JoinedReportBlock` collides with a spec export. Through the published
 * `@objectstack/spec` 17.4.0 the spec annotated `JoinedReportBlockSchema` as a
 * bare `z.ZodTypeAny`, so `z.input<typeof …>` — and therefore the exported
 * `JoinedReportBlock` type — resolved to `unknown`. Re-exporting that would have
 * replaced objectui's block interface with nothing at all: a type-safety
 * regression wearing a burn-down's clothes. It is the objectstack#4171 failure
 * mode one variant wider: `any` is caught by the `0 extends (1 & T)` probe,
 * `unknown` is not (that probe answers `false` for it), so a triage that only
 * screens for `any` concludes the symbol is derivable.
 *
 * ## Typed upstream, installed here, derived here
 *
 * objectstack#20369 (`681868ca7`) typed the block; `@objectstack/spec` 17.5.0
 * carries it, and this repository installs 17.5.0 since objectui#11073. The
 * spec's block is the ADR-0021 dataset-bound one — `dataset`, `rows`, `columns`
 * as dimension NAMES, `values`, `runtimeFilter`, `order` — in a closed schema.
 * The hand-written interface objectui published typed the legacy inline-query
 * block instead — `objectName`, `columns` as column OBJECTS, `groupingsDown`,
 * `groupingsAcross`, `filter`, `chart` — plus an index signature; the spec's
 * schema refuses all five of those keys, `chart` by name since objectstack#20161.
 *
 * objectui#10940 REPLACED the published `JoinedReportBlock` with the spec's type,
 * and `JoinedSpecReport.blocks` with the spec's own `Report.blocks`: a
 * published-type change, narrowing and widening, stated member by member in its
 * changeset. The divergence probes that stood here — local interface against
 * spec, each written to stop compiling the day its difference moved — are
 * answered by that replacement and are deleted with the interface.
 *
 * ## What guards it now, on both runs
 *
 * This file is compiled by the pull-request type-check against the INSTALLED
 * spec, and by the Spec Main Shape Gate against spec `main`.
 *
 * - THE STATE PIN admits `typed` alone. The `erased` arm is gone from the pin
 *   AND from under it: the `OnTypedSpec` licence that answered `true` for every
 *   probe on an erased spec is deleted, so every probe below is asked on every
 *   compile and an erasure, on either spec, stops compiling. `any` is refused
 *   as before.
 * - THE DERIVATION PINS: the published block IS the spec's block, and the
 *   published joined report's `blocks` ARE the spec's report blocks. Re-forking
 *   the block by hand under the spec's name is also refused by
 *   `check:spec-symbols`, whose ALLOW row for this symbol retired with the
 *   burn-down.
 * - THE MEMBER PINS state, on the PUBLISHED type, what the replacement changed.
 *   Each looks its member up through `BlockMember`, which yields `never` for a
 *   key the type does not declare — and `never` satisfies a `[never] extends [X]`
 *   probe vacuously. So every lookup is guarded, `[BlockMember OF …] extends
 *   [never] ? false : …`, and a member that disappears turns ITS OWN probe red
 *   rather than only some other line of the file. That gap was recorded on the
 *   probes these replace by the contract review of PR objectui#10934, posted on
 *   objectui#10940.
 * - TEST TIME, the installed spec only (the Spec Main Shape Gate type-checks and
 *   runs no test): the tripwire at the bottom reads the installed spec's built
 *   declarations and reports an erasure as the upstream regression it would be.
 *
 * ⚠️ objectstack#4171 (CLOSED 2026-07-30) was never this symbol's release: it
 * typed the RECURSIVE schemas, and this erasure's cause was the bare
 * annotation, not recursion. The state of an upstream issue says nothing here;
 * the pins and the tripwire below do.
 */
type IsUnknown<T> = [unknown] extends [T] ? ([T] extends [unknown] ? true : false) : false;
type IsAny<T> = 0 extends 1 & T ? true : false;
/** `any` is asked first: it passes `IsUnknown` as well. */
type SpecTyping<T> = IsAny<T> extends true ? 'any' : IsUnknown<T> extends true ? 'erased' : 'typed';

// THE STATE PIN. `typed` — the installed `@objectstack/spec` and spec `main` both
// type the block. There is no `erased` arm: an erasure stops compiling. `any` is
// refused (case 2).
const _specJoinedReportBlockTyping = null as unknown as SpecTyping<SpecJoinedReportBlock> satisfies 'typed';
const _specJoinedReportBlockIsNotEvenAny = false satisfies IsAny<SpecJoinedReportBlock>;

/** Keys a type DECLARES: an index signature is not a member. */
type DeclaredBlockKeys<T> = keyof {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};
type SameType<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/**
 * `T[K]`, or `never` where `T` does not declare `K`. That `never` is why every
 * member probe below asks `[BlockMember OF …] extends [never]` first.
 */
type BlockMember<T, K extends PropertyKey> = K extends keyof T ? T[K] : never;

// 0. The derivation. The published block is neither erased nor `any`, and it is
//    the spec's block in both directions. Mutual assignability alone cannot see
//    an OPTIONAL key dropped or added (every block member but `name` is
//    optional), so the declared key sets are compared as well.
const _publishedBlockTyping = null as unknown as SpecTyping<PublishedJoinedReportBlock> satisfies 'typed';
const _publishedBlockIsTheSpecBlock = true satisfies (
  SameType<PublishedJoinedReportBlock, SpecJoinedReportBlock> extends true
    ? SameType<DeclaredBlockKeys<PublishedJoinedReportBlock>, DeclaredBlockKeys<SpecJoinedReportBlock>>
    : false
);
// …and a published joined report's `blocks` are the spec's own report blocks,
// on the PARSED tier of `SpecReport`: required, each element the spec's parsed
// block, assignable to the authoring-tier block but not the other way round
// (`type` and `order[].direction` are defaulted on the parsed side).
type PublishedJoinedBlocks = BlockMember<JoinedSpecReport, 'blocks'>;
const _joinedReportBlocksAreTheSpecReportBlocks = true satisfies (
  [PublishedJoinedBlocks] extends [never]
    ? false
    : undefined extends PublishedJoinedBlocks
      ? false
      : SameType<PublishedJoinedBlocks, SpecJoinedReportBlockParsed[]>
);
const _joinedReportBlocksAreParsedTier = true satisfies (
  [PublishedJoinedBlocks] extends [never]
    ? false
    : [SpecJoinedReportBlockParsed] extends [PublishedJoinedReportBlock]
      ? [PublishedJoinedReportBlock] extends [SpecJoinedReportBlockParsed]
        ? false
        : true
      : false
);

// 1. NARROWED: the legacy inline-query keys are gone from the published block,
//    and so is the index signature that let any other key through.
type LegacyBlockKey = 'objectName' | 'groupingsDown' | 'groupingsAcross' | 'filter' | 'chart';
const _legacyBlockKeysAreGone = true satisfies (
  [DeclaredBlockKeys<PublishedJoinedReportBlock>] extends [never]
    ? false
    : SameType<Extract<DeclaredBlockKeys<PublishedJoinedReportBlock>, LegacyBlockKey>, never>
);
const _publishedBlockHasNoIndexSignature = true satisfies (
  [keyof PublishedJoinedReportBlock] extends [never]
    ? false
    : string extends keyof PublishedJoinedReportBlock
      ? false
      : true
);
// 2. WIDENED: the ADR-0021 dataset-bound selection arrived with the spec's type.
const _datasetBoundBlockKeysArrived = true satisfies (
  [DeclaredBlockKeys<PublishedJoinedReportBlock>] extends [never]
    ? false
    : ['dataset' | 'rows' | 'values' | 'runtimeFilter' | 'order'] extends [DeclaredBlockKeys<PublishedJoinedReportBlock>]
      ? true
      : false
);
// 3. CHANGED CONCEPT: `columns` is optional dimension NAMES across a matrix, no
//    longer the required column OBJECTS (`{ field, aggregate, … }`).
const _blockColumnsAreDimensionNames = true satisfies (
  [BlockMember<PublishedJoinedReportBlock, 'columns'>] extends [never]
    ? false
    : SameType<BlockMember<PublishedJoinedReportBlock, 'columns'>, string[] | undefined>
);
// 4. NARROWED: `label` / `description` still take a plain string, and refuse the
//    legacy `{ default, translations }` object arm, which is not a spec inline
//    locale map (every value of which is a string). One probe per member, so a
//    member that disappears is named by its own line.
type LegacyLabelObjectArm = { default: string; translations?: Record<string, string> };
const _blockLabelRefusesTheLegacyObjectArm = true satisfies (
  [BlockMember<PublishedJoinedReportBlock, 'label'>] extends [never]
    ? false
    : [LegacyLabelObjectArm] extends [BlockMember<PublishedJoinedReportBlock, 'label'>]
      ? false
      : [string] extends [BlockMember<PublishedJoinedReportBlock, 'label'>]
        ? true
        : false
);
const _blockDescriptionRefusesTheLegacyObjectArm = true satisfies (
  [BlockMember<PublishedJoinedReportBlock, 'description'>] extends [never]
    ? false
    : [LegacyLabelObjectArm] extends [BlockMember<PublishedJoinedReportBlock, 'description'>]
      ? false
      : [string] extends [BlockMember<PublishedJoinedReportBlock, 'description'>]
        ? true
        : false
);
// 5. UNCHANGED: `name` and `type` mean what the hand-written interface said.
const _blockNameIsUnchanged = true satisfies (
  [BlockMember<PublishedJoinedReportBlock, 'name'>] extends [never]
    ? false
    : SameType<BlockMember<PublishedJoinedReportBlock, 'name'>, string>
);
const _blockTypeIsUnchanged = true satisfies (
  [BlockMember<PublishedJoinedReportBlock, 'type'>] extends [never]
    ? false
    : SameType<BlockMember<PublishedJoinedReportBlock, 'type'>, 'tabular' | 'summary' | 'matrix' | undefined>
);
void _specJoinedReportBlockTyping;
void _specJoinedReportBlockIsNotEvenAny;
void _publishedBlockTyping;
void _publishedBlockIsTheSpecBlock;
void _joinedReportBlocksAreTheSpecReportBlocks;
void _joinedReportBlocksAreParsedTier;
void _legacyBlockKeysAreGone;
void _publishedBlockHasNoIndexSignature;
void _datasetBoundBlockKeysArrived;
void _blockColumnsAreDimensionNames;
void _blockLabelRefusesTheLegacyObjectArm;
void _blockDescriptionRefusesTheLegacyObjectArm;
void _blockNameIsUnchanged;
void _blockTypeIsUnchanged;

/**
 * How the INSTALLED spec declares an export: the compiler's reading of its
 * built `.d.ts`, the same reading `SpecTyping` takes at compile time — taken
 * here so that a TEST can act on it, which is the half the Spec Main Shape Gate
 * never runs.
 */
function installedSpecTyping(name: string): { version: string; typing: 'any' | 'erased' | 'typed' } {
  const { version, checker, modules } = specDeclarations(['@objectstack/spec/ui']);
  const exported = checker.getExportsOfModule(modules[0]).find((s) => s.getName() === name);
  if (!exported) throw new Error(`\`@objectstack/spec/ui\` does not export \`${name}\` — re-run the triage`);
  const declared = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
  const type = checker.getDeclaredTypeOfSymbol(declared);
  const typing = type.flags & ts.TypeFlags.Any ? 'any' : type.flags & ts.TypeFlags.Unknown ? 'erased' : 'typed';
  return { version, typing };
}

describe('JoinedReportBlock: the installed spec types the block the published type derives from (objectui#10940)', () => {
  const installed = installedSpecTyping('JoinedReportBlock');

  it('reads a typed export as `typed` (the lit control for the rows below)', () => {
    // A reader that answered `erased` for everything would keep the next row
    // green forever. `ReportSort` is a closed object in every spec this file
    // has compiled against.
    expect(installedSpecTyping('ReportSort').typing).toBe('typed');
  });

  // Was the objectui#10916 burn-down tripwire. It fired at the bump that installed
  // `@objectstack/spec` 17.5.0 (objectui#11073) and was flipped there; the burn-down
  // it announced landed in objectui#10940, which derived the PUBLISHED
  // `JoinedReportBlock` from the spec. What it guards now: the published type IS
  // the spec's, so an upstream erasure would erase objectui's published block too.
  it('the installed spec types the block (an erasure is an upstream regression)', () => {
    expect(
      installed.typing,
      `the installed @objectstack/spec ${installed.version} erases JoinedReportBlock again — an ` +
        "upstream regression to report, and it erases @object-ui/types' published JoinedReportBlock " +
        'with it; the state pin above refuses it at compile time too',
    ).toBe('typed');
  });
});
