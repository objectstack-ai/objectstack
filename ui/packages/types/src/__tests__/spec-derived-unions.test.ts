/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Hand-written unions that shadowed a spec vocabulary. (#2944, #2901)
 *
 * `spec-subschema-parity.test.ts` pins zod schemas by REFERENCE, which is the
 * strongest possible check — a faithful copy fails, because a copy is a fork.
 * TS type aliases cannot be pinned that way: they erase at runtime, and a
 * restated union that happens to match is indistinguishable from a derived one.
 *
 * So these assert the runtime vocabulary instead, which is what a restated union
 * would have drifted from. Each of these WAS drifted:
 *
 *  - `ChartType` carried 7 of the spec's 19 values. Because the sibling zod
 *    schema was re-exported under the spec's own symbol name, #2901 was filed
 *    reading this copy as the protocol and concluding the renderer had outgrown
 *    it — the premise was backwards.
 *  - `ReportType` was missing `joined`.
 *  - `ActionType` was missing `form`, under a doc comment claiming to be "the
 *    canonical definition from @objectstack/spec". `ActionRunner.executeForm`
 *    implements it, so a host app typing against @object-ui/types got an error
 *    on working code.
 *
 * The `satisfies` checks below ARE enforcement — but only since #3009 added
 * `packages/types/tsconfig.test.json` and chained it from this package's
 * `type-check` script.
 *
 * For the whole interval before that they were decorative, and an earlier version
 * of this comment asserting they were "the real enforcement" was simply false:
 * `tsconfig.json` excludes test files (it is the package build, with `rootDir`,
 * `composite` and `declaration`, so tests would emit into dist), and no other
 * `tsc` invocation read this file. Measured at the time: reverting a derived alias
 * to its old hand-written fork produced ZERO type errors. It now produces
 * `TS1360` pointing at the `satisfies` line below.
 *
 * The runtime assertions further down are still the stronger check for anything
 * with a runtime witness — a type alias erases, so only reference identity
 * distinguishes a re-export from a faithful copy. Keep both.
 *
 * Two cases are the inverse: `navigation` and `combo` are names objectui uses
 * that the spec does NOT have. Each is asserted absent from the spec, so that
 * the day the spec adopts one, this file fails and names the local thing to
 * retire.
 */
import { describe, it, expect } from 'vitest';
import {
  ChartTypeSchema as SpecChartTypeSchema,
  ReportType as SpecReportType,
  ActionType as SpecActionType,
  PageTypeSchema as SpecPageTypeSchema,
  ACTION_LOCATIONS as SpecACTION_LOCATIONS,
  ActionLocationSchema as SpecActionLocationSchema,
  ActionSchema as SpecActionSchema,
  NavigationItemSchema as SpecNavigationItemSchema,
} from '@objectstack/spec/ui';
import type { z } from 'zod';
import {
  FieldType as SpecFieldType,
} from '@objectstack/spec/data';
import { enumOptions } from '@object-ui/test-support';
// The objectstack#4171 / #3177 pins must import the banned name to probe it —
// this guard is a sanctioned importer (#3090 tripwire).
/* eslint-disable no-restricted-imports -- reported at the specifier line, out of -next-line reach */
import type {
  NavigationItem as SpecNavigationItem,
  NavigationItemInput as SpecNavigationItemInput,
  FormField as SpecFormField,
  FormFieldInput as SpecFormFieldInput,
} from '@objectstack/spec/ui';
/* eslint-enable no-restricted-imports */
import type { NavigationItem, NavigationItemType } from '../app';
import type { FormField } from '../form';
import type { BreakpointName } from '../mobile';
import type { ImportJobStatus, ImportWriteMode, ValidationError } from '../data';
import {
  OBJECTUI_LOCAL_ACTION_TYPES,
  OBJECTUI_LOCAL_PARAM_FIELD_TYPES,
  ACTION_LOCATIONS,
  ActionLocationSchema,
  ACTION_PARAM_FIELD_TYPES,
} from '../ui-action';
import type { ChartType } from '../data-display';
import type { ReportType } from '../reports';
import type {
  ActionType,
  RunnableActionType,
  ActionComponent,
  ActionParam,
  ActionParamFieldType,
  ResolvableParamFieldType,
} from '../ui-action';
import type { PageType, PageVisualizationAlias } from '../layout';

/**
 * Compile-time coverage: every spec member must be assignable to the objectui
 * alias. A restated union that drops a value fails to compile here.
 */
type SpecChart = typeof SpecChartTypeSchema extends { options: readonly (infer T)[] } ? T : never;
const _chartCovers = null as unknown as SpecChart satisfies ChartType;
const _reportCovers = null as unknown as 'tabular' | 'summary' | 'matrix' | 'joined' satisfies ReportType;
const _actionCovers = null as unknown as 'script' | 'url' | 'modal' | 'flow' | 'api' | 'form' satisfies ActionType;
const _pageCovers = null as unknown as 'record' | 'home' | 'app' | 'utility' | 'list' satisfies PageType;
// The sanctioned local extensions are still part of their unions.
const _vizCovers = null as unknown as PageVisualizationAlias satisfies PageType;
const _runnableCovers = null as unknown as ActionType satisfies RunnableActionType;
// #4074: the action sub-vocabularies that were restated rather than derived.
const _componentCovers = null as unknown as
  | 'action:button'
  | 'action:icon'
  | 'action:menu'
  | 'action:group' satisfies ActionComponent;
// `ActionParamFieldType` is now the spec's `FieldType`, so every spec field type
// must be assignable — the old 16-member subset fails here.
type SpecField = typeof SpecFieldType extends { options: readonly (infer T)[] } ? T : never;
const _paramFieldCovers = null as unknown as SpecField satisfies ActionParamFieldType;
const _resolvableCovers = null as unknown as ActionParamFieldType satisfies ResolvableParamFieldType;
// framework#4074 steps 2–3: `ActionParam` is the AUTHORING shape, aligned with
// the spec's input. The spec's primary declaration form — a bare field
// reference — must compile; it was a type error while `name`/`label`/`type`
// were required and `field` was undeclared. `label` is typed as the spec's own
// `I18nLabel` import — which THIS check revealed to be aliased to plain
// `string` in the current spec (the per-locale record is the separate
// `I18nObject`); importing the alias rather than restating it means objectui
// tracks any future widening automatically. (These annotations are enforcement
// since objectui#3009 made this file compile.)
const _fieldBackedParam: ActionParam = { field: 'status' };
const _minimalTypedParam: ActionParam = { name: 'priority', label: 'Priority', type: 'select' };
// `BreakpointName` LEFT the burn-down population below — objectui#7580.
//
// It was in it: a local fork PROVED equivalent to the spec's and then replaced
// by a binding. objectstack#11027 then retired the spec's whole `ui/responsive`
// vocabulary, and the maintainer ruling of 2026-09-04 (option A) re-homed this
// union into `../mobile` rather than retiring it with the key, because a
// renderer implements it — the tombstone's own return condition. Today that is
// the `grid` node, whose authorable breakpoint `columns` is keyed by this
// union; the ruling's original ground, the `responsive-grid` node, retired
// under objectui#11441, which kept the vocabulary.
//
// So the assertion below is NOT the burn-down check any more, and this is the
// restatement rather than a deletion: it never read the spec for this symbol
// (it imports `BreakpointName` from `../mobile`, and a type alias erases, so
// there was never a runtime witness to compare). What it pins is the union's
// WIDTH, and that pin outlives the binding it was written under — the six
// members are what `BreakpointColumnMap` is keyed by, so narrowing the local
// declaration fails to compile here rather than silently dropping a breakpoint.
// Deleting the case because its ORIGINAL reason expired would have removed live
// coverage on the exact declaration the ruling just made this repo responsible
// for.
//
// Where it goes next: at the `@objectstack/spec` pin bump that lands
// objectstack#11027, this name joins the INVERSE population documented at the
// top of this file — names objectui uses that the spec does NOT have, each
// asserted absent so that the day the spec re-adopts one, this file fails. That
// absence cannot be asserted yet: the pin is still 17.2.0, which PRE-dates the
// retirement and still exports the name. Until then the collision is held by a
// self-expiring entry in `scripts/check-spec-symbol-derivation.mjs`, whose
// ratchet 3 forces the bump to come back here.
const _breakpointCovers = null as unknown as 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' satisfies BreakpointName;

// objectstack#4115 ledger burn-down: the symbols whose local declaration was
// PROVED equivalent to the spec's and then replaced by a binding. Each listed
// member is what the local fork carried, so re-declaring it narrower fails here
// as well as at the guard.
const _importModeCovers = null as unknown as 'insert' | 'update' | 'upsert' satisfies ImportWriteMode;
const _importStatusCovers = null as unknown as
  | 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' satisfies ImportJobStatus;
// The export-job status row retired with its type (objectui#10247).
const _validationErrorShape: ValidationError = { field: 'name', message: 'required' };
// `JoinStrategy` / `WindowFunction` USED to be derived off the spec's zod enums
// (objectstack#4115, "come off the spec enum, not a restatement"). Spec 17.0.0
// retired both — `query.joins` and `query.windowFunctions` were tombstoned
// because no engine or driver ever read them on the query path (framework#4286)
// — so there is no enum left to derive from and the pins that enforced it are
// gone with the imports. `packages/types/src/data-protocol.ts` now restates the
// members locally, verbatim from the last spec that published them, as the
// objectui query-AST vocabulary they have become.
//
// ── objectstack#4115 batch 8/8 (objectui#3162): CLOSED WITH ZERO RE-EXPORTS ───
//
// The ledger's last batch — `JoinNode`, `NavigationItem`, `NavigationItemSchema`,
// `JoinedReportBlock` — was filed as "blocked on objectstack#4171; burn down when
// the upstream `any` erasure lifts". #4171 closed completed on 2026-07-30, and the
// re-measurement it licensed found that NONE of the four is burnable, for three
// DIFFERENT reasons — none of which is the one the ledger recorded. Measured in the
// BUILT dist at spec 17.2.0 (source and issue state were both insufficient: the
// whole point of this ledger is that dist erasure is invisible from either):
//
//  - `JoinNode`            — the spec no longer exports the symbol AT ALL
//                            (TS2305 from `/ui` and `/data`); spec 17.0.0 retired
//                            the cluster. Nothing upstream to bind to. Absence
//                            pinned in `report-chart-query-spec-parity.test.ts`.
//  - `NavigationItem`      — upstream IS precise now (`IsAny` and `IsUnknown` both
//                            `false`), so #4171 really did land. Binding is still
//                            wrong: the semantic blockers pinned below are
//                            unaffected by it (three when this was written;
//                            objectui#10867 lifted the separator `label`, by a
//                            local change, not an upstream one). `any` was never the only blocker —
//                            #3177 established that, and it still holds.
//  - `NavigationItemSchema`— upstream IS precise now; pinned below. The live
//                            blocker is SHAPE, and it is a RUNTIME one: see
//                            `navigation-spec-parity.test.ts`.
//  - `JoinedReportBlock`   — STILL erased then, to `unknown`, by a cause #4171 never
//                            covered. Since BURNED DOWN: objectstack#20369 typed
//                            it, spec 17.5.0 ships that, and objectui#10940
//                            derived the published type from it. The derivation
//                            is pinned in `report-chart-query-spec-parity.test.ts`.
//
// So the batch burns down to zero re-exports and the ledger's remaining debt is
// now carried as state pins that name their own release condition, rather than as
// a card pointing at an upstream issue that has since closed without settling it.
// ⛔ A closed upstream issue is not a licence to re-export: prove the dist type is
// precise, then prove binding it does not narrow what this package already accepts.

/**
 * Admission probes for `NavigationItem` and `FormField` (#3177).
 *
 * ## What these used to be, and why they were replaced
 *
 * `NavigationItem`, `JoinNode` and `FormField` used to collide with a spec
 * export whose own declaration resolved to `any` (the spec annotated the
 * recursive schemas behind them as `z.ZodType<any>`, and `z.infer` of that is
 * `any`). Binding objectui's local interface to that would have replaced a
 * precise, documented shape with `any` — a type-safety regression wearing a
 * burn-down's clothes — so they stayed local, and two `IsAny` pins asserted the
 * premise held. Filed upstream as objectstack#4171.
 *
 * Spec 17.0.0-rc.1 typed both properly and the `IsAny` pins fired. The #3177
 * triage then measured what the burn-down they demanded would actually cost —
 * and found that **`any` was never the only blocker for either symbol**, so
 * "no longer `any`" was never the right admission question. `IsAny` going
 * `false` proves the spec type is no longer EMPTY; it says nothing about
 * whether it is PRECISE enough to bind, which is what the burn-down needs.
 *
 * So the probes below ask the real question instead, one blocker per line. Each
 * asserts the CURRENT state (so this file is green today) and stops compiling
 * the day that specific blocker lifts — at which point that line names exactly
 * what became derivable. `JoinNode` needs none of this: spec 17.0.0 retired the
 * symbol (framework#4286), so there is no collision left to reason about.
 *
 * ## Why not simply compare the two types
 *
 * Mutual assignability lies here, in three separate ways, all of them present
 * in this repo (the list is `scripts/check-spec-symbol-derivation.mjs`'s):
 * `any` answers every `extends` question affirmatively; so does `unknown` on
 * one side; and objectui's `FormField` carries `[key: string]: any`, which
 * absorbs any member the spec has and makes the two compare equal while they
 * accept wildly different objects. A structural `extends` ALSO silently permits
 * excess properties, so it cannot see that the spec declares no `pinned`. Hence
 * per-key, per-tier probes rather than one verdict.
 */
type IsAny<T> = 0 extends 1 & T ? true : false;

/** Every key of every branch of a union (plain `keyof` on a union gives the intersection). */
type KeysOfUnion<T> = T extends unknown ? keyof T : never;
/** Does the spec declare this key on ANY nav branch, at EITHER tier? */
type SpecNavDeclares<K extends string> =
  K extends KeysOfUnion<SpecNavigationItem> | KeysOfUnion<SpecNavigationItemInput> ? true : false;

// ── NavigationItem: the blockers, none of which `any` ever caused ────────────
//
// Three were pinned here; objectui#10867 lifted the third (the separator
// `label`), which now stands as an agreement pin in its place.
//
// Umbrella verdict: still not bindable. The lines under it say why, and are the
// ones to act on — this one stays `false` while ANY blocker remains.
const _localNavIsNotYetTheSpecUnion = false satisfies [NavigationItem] extends [SpecNavigationItem]
  ? true
  : false;

// 1. `visible: boolean`. The spec takes a CEL string (input) / Expression
//    envelope (output); neither tier admits a boolean. `NavigationRenderer`
//    evaluates one, and `menuItemToNavigationItem` MANUFACTURES one when it
//    inverts legacy `AppMenuItem.hidden`. Measured: binding to the input tier
//    fails with 3x TS2322 on exactly those lines.
type SpecNavVisible =
  | NonNullable<Extract<SpecNavigationItem, { type: 'url' }>['visible']>
  | NonNullable<Extract<SpecNavigationItemInput, { type: 'url' }>['visible']>;
const _specNavVisibleStillRejectsBoolean = false satisfies boolean extends SpecNavVisible
  ? true
  : false;

// 2. Keys the spec has no counterpart for at either tier. `pinned` backs
//    `useNavPins` + `FavoritesProvider`; `defaultOpen` is the legacy spelling
//    `navigation-spec-parity.test.ts` keeps accepting for published metadata.
//    If the spec ever claims either NAME, this fails and the two meanings must
//    be reconciled rather than silently shadowed.
const _specNavStillHasNoPinned = false satisfies SpecNavDeclares<'pinned'>;
const _specNavStillHasNoDefaultOpen = false satisfies SpecNavDeclares<'defaultOpen'>;

// 3. LIFTED by objectui#10867. objectui's separator used to carry a `label`,
//    which the spec's separator branch (`type` / `id?` / `order?`) does not
//    declare, and the Studio wizard saved one that the platform's `AppSchema`
//    refused (`unrecognized_keys`). `NavigationItem` is now a union whose
//    separator arm admits exactly the spec separator's keys, so what stood here
//    as a blocker is asserted as an AGREEMENT instead. It fails the day either
//    side moves: a key the spec adds to its separator, or one this arm admits
//    that the spec does not declare.
//
//    "Admits" = a key whose type is not `never`. The arm carries every other
//    entry key as `?: never`, refused by name at compile, so a plain `keyof`
//    would count those too.
type AdmittedKeys<T> = {
  [K in keyof T]-?: [Exclude<T[K], undefined>] extends [never] ? never : K;
}[keyof T];
type LocalSeparator = Extract<NavigationItem, { type: 'separator' }>;
type SpecSeparator = Extract<SpecNavigationItem, { type: 'separator' }>;
type SpecSeparatorInput = Extract<SpecNavigationItemInput, { type: 'separator' }>;
type SameKeys<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _separatorAdmitsTheSpecKeys = true satisfies SameKeys<AdmittedKeys<LocalSeparator>, keyof SpecSeparator>;
const _separatorAdmitsTheSpecInputKeys = true satisfies SameKeys<
  AdmittedKeys<LocalSeparator>,
  keyof SpecSeparatorInput
>;
// ...and the value types of the keys this arm admits are ones the spec's separator accepts, at both tiers. `extends` ignores extra keys, so key agreement is the two pins above: this one alone passes a labelled arm, and it is vacuous on BASE.
const _localSeparatorIsSpecValid = true satisfies [LocalSeparator] extends [SpecSeparator & SpecSeparatorInput]
  ? true
  : false;

// What IS derivable today is derived: `app.ts` now takes `NavigationItemType`
// off the spec's discriminant, and `recordMode` / `filters` / `badge` /
// `target` / `params` / `actionDef` / `badgeVariant` off the branch that owns
// each. This asserts the membership list really is the spec's — a restatement
// that drops a member (the objectstack#4115 failure class) fails here.
const _navTypeCoversSpec = null as unknown as SpecNavigationItem['type'] satisfies NavigationItemType;

// `NavigationItemSchema` (objectui#3162 batch 8): upstream precision is SETTLED,
// so no future triage may re-derive the ledger's stale reason from prose. The spec
// now ships `z.ZodType<NavigationItem, NavigationItemInput>`; this holds that
// measurement, and fires if the annotation ever regresses to `z.ZodType<any>`.
//
// This pin deliberately does NOT say the schema is bindable — it says the OLD
// reason for not binding is spent. The live reason is runtime shape, and only
// `navigation-spec-parity.test.ts` can pin that, because it is about which
// metadata parses, not which types assign.
const _specNavSchemaIsNoLongerAny = false satisfies IsAny<z.infer<typeof SpecNavigationItemSchema>>;

// ── FormField: not one concept in two dialects, but two concepts on two layers ─
//
// `select-option-spec-parity.test.ts` states the distinction in its own header —
// "Unlike the FormField pair — two genuinely different concepts on two layers —
// a select option is ONE concept in two dialects" — and `index.ts` exports
// `SpecFormField` SEPARATELY as the disambiguation the #3090 tripwire exists to
// force. Binding would make `FormField === SpecFormField` and collapse that.
//
// The decisive, mechanical form of "two layers": the two types' REQUIRED keys
// are disjoint. objectui requires `name` (the form data path); the spec requires
// `field` (a reference to an object field) and has no `name` at either tier.
const _specFormFieldIsNoLongerAny = false satisfies IsAny<SpecFormField>;
const _specFormFieldStillHasNoName = false satisfies 'name' extends keyof SpecFormField
  ? true
  : false;
const _specFormFieldInputStillHasNoName = false satisfies 'name' extends keyof SpecFormFieldInput
  ? true
  : false;

// The same key on both sides, meaning different things — the pun `form.ts`
// flags with a ⚠️. The spec's `field` is the referenced field's NAME; on a
// runtime `FormField` the slot holds the RESOLVED metadata object, and
// `normalizeSectionField` (@object-ui/plugin-form) is the only place the two
// layers meet.
const _specFieldSlotIsStillAName = true satisfies [SpecFormField['field']] extends [string]
  ? true
  : false;
const _localFieldSlotIsStillAnObject = false satisfies [NonNullable<FormField['field']>] extends [
  string,
]
  ? true
  : false;

// framework#4074 widened objectui's `dependsOn` to match its runtime reader
// (`resolveCascadingOptions` has always accepted arrays and `{ field, param }`
// entries). The spec still says `string`, so binding would revert that fix.
const _specDependsOnStillTakesNoArray = false satisfies string[] extends NonNullable<
  SpecFormFieldInput['dependsOn']
>
  ? true
  : false;

// ADR-0089 D2 folds `visibleOn` into `visibleWhen` at the spec's schema
// boundary, so it is absent from the OUTPUT type by construction — while
// objectui's #2212 wire contract keeps it. (The spec's input tier still
// accepts it; this asks the output tier on purpose.)
const _specOutputStillDropsVisibleOn = false satisfies 'visibleOn' extends keyof SpecFormField
  ? true
  : false;

void _chartCovers; void _reportCovers; void _actionCovers; void _pageCovers; void _vizCovers;
void _runnableCovers; void _componentCovers; void _paramFieldCovers; void _resolvableCovers;
void _fieldBackedParam; void _minimalTypedParam;
void _breakpointCovers; void _importModeCovers; void _importStatusCovers;
void _validationErrorShape;
void _localNavIsNotYetTheSpecUnion; void _specNavVisibleStillRejectsBoolean;
void _specNavStillHasNoPinned; void _specNavStillHasNoDefaultOpen;
void _separatorAdmitsTheSpecKeys; void _separatorAdmitsTheSpecInputKeys;
void _localSeparatorIsSpecValid; void _navTypeCoversSpec;
void _specNavSchemaIsNoLongerAny;
void _specFormFieldIsNoLongerAny; void _specFormFieldStillHasNoName;
void _specFormFieldInputStillHasNoName; void _specFieldSlotIsStillAName;
void _localFieldSlotIsStillAnObject; void _specDependsOnStillTakesNoArray;
void _specOutputStillDropsVisibleOn;

/**
 * Read a spec enum's members, failing loudly if the shape ever changes.
 *
 * The wrapper walk is `@object-ui/test-support`'s shared reader (objectui#6924);
 * the THROW stays here, because that is this suite's non-vacuity duty and the
 * reader deliberately answers `[]` rather than raising.
 */
const optionsOf = (schema: unknown, name: string): string[] => {
  const raw = enumOptions(schema);
  if (raw.length === 0) {
    throw new Error(`could not read ${name}.options from @objectstack/spec`);
  }
  return raw;
};

describe('unions derived from a spec vocabulary stay derived (#2944)', () => {
  it('the spec still exposes each enum', () => {
    // Guards every assertion below from passing on an empty list.
    expect(optionsOf(SpecChartTypeSchema, 'ChartTypeSchema').length).toBeGreaterThan(0);
    expect(optionsOf(SpecReportType, 'ReportType').length).toBeGreaterThan(0);
    expect(optionsOf(SpecActionType, 'ActionType').length).toBeGreaterThan(0);
    expect(optionsOf(SpecPageTypeSchema, 'PageTypeSchema').length).toBeGreaterThan(0);
  });

  it('ActionType includes `form` — the member the fork dropped', () => {
    expect(optionsOf(SpecActionType, 'ActionType')).toContain('form');
  });

  it('`navigation` is objectui\'s declared alias, not a spec action type', () => {
    // #2944 item 3 asked for a decision: promote `navigation` upstream or delete
    // the `ActionRunner` case. Neither, as stated. The spec already has `url` for
    // "go to a location" (with `openIn`), so a seventh type would be a second
    // spec name for one operation — the exact failure this audit is named after.
    // And deleting the case is silent, not loud: the action falls into
    // `executeActionSchema`, which returns success without navigating (#2960).
    //
    // So it stays as a NAMED local alias sharing `url`'s navigator. This test is
    // the tripwire: if the spec ever does adopt `navigation`, it fails and the
    // alias is the thing to retire.
    expect(optionsOf(SpecActionType, 'ActionType')).not.toContain('navigation');
    expect([...OBJECTUI_LOCAL_ACTION_TYPES]).toEqual(['navigation']);
  });

  it('`combo` IS a spec chart type since 17.0.0-rc.1 — the tripwire fired', () => {
    // `plugin-charts`'s `ChartFamily` carries `combo`, which #2945 listed as
    // "promote or delete". For a long time the answer was neither: the spec
    // expressed a combo PER-SERIES (`ChartSeries.type`, "Series type override
    // (combo charts)"), exactly as it expresses stacking with `ChartSeries.stack`
    // rather than a `stacked-bar` family — so `combo` stayed a renderer-local
    // marker that `effectiveChartFamily` DERIVES from the series, and this test
    // was the tripwire watching for the spec to adopt it.
    //
    // Spec 17.0.0-rc.1 adopted it (the sole addition to `ChartTypeSchema`, 19
    // members → 20). The assertion is inverted to pin the new fact, and the two
    // surfaces that classify a spec chart type were taught to route it —
    // `widgetDispatch.SERIES_CHART_TYPES` and `planReportChart` — because until
    // they were, a spec-valid `combo` fell through to a red error box on a
    // dashboard and to the out-of-spec notice on a report.
    //
    // The renderer-local DERIVATION stays: `effectiveChartFamily` still infers a
    // combo from mixed series types, which is what makes an authored
    // `type: 'combo'` render rather than merely validate.
    expect(optionsOf(SpecChartTypeSchema, 'ChartTypeSchema')).toContain('combo');
  });

  it('ReportType includes `joined` — the member the fork dropped', () => {
    expect(optionsOf(SpecReportType, 'ReportType')).toContain('joined');
  });

  it('PageTypeSchema includes `list` — the member the fork dropped', () => {
    expect(optionsOf(SpecPageTypeSchema, 'PageTypeSchema')).toContain('list');
  });

  it('ChartTypeSchema is far wider than the 7 the fork carried', () => {
    const spec = optionsOf(SpecChartTypeSchema, 'ChartTypeSchema');
    const forked = ['line', 'bar', 'area', 'pie', 'donut', 'radar', 'scatter'];
    expect(spec.length).toBeGreaterThan(forked.length);
    // Everything the fork had is still real, so no consumer of the old union breaks.
    expect(forked.filter((v) => !spec.includes(v))).toEqual([]);
  });

  it('ACTION_LOCATIONS / ActionLocationSchema ARE the spec\'s, by reference (#4074)', () => {
    // The doc comment claimed "re-export" while the code re-declared a parallel
    // union + `as const` tuple + `z.enum`. Identity is the only check that tells
    // a re-export from a faithful copy — a copy passes any value comparison.
    expect(ACTION_LOCATIONS).toBe(SpecACTION_LOCATIONS);
    expect(ActionLocationSchema).toBe(SpecActionLocationSchema);
    // #2561 decision (a) drops spec/ui's `…Schema` names from this package, but
    // these two are explicitly kept — so they must still be defined VALUES, not
    // type-erased to undefined.
    expect(ActionLocationSchema).toBeDefined();
    expect(optionsOf(ActionLocationSchema, 'ActionLocationSchema')).toContain('record_header');
  });

  it('the spec still accepts every ActionComponent value (#4074)', () => {
    // `ActionSchema` is a lazySchema proxy that does not forward `.shape`, so the
    // enum is asserted behaviorally through parse — stronger than reading
    // `.options` anyway, since it proves the value is accepted end-to-end.
    const base = { name: 'act', label: 'Act', type: 'script' as const, target: 'run' };
    for (const component of ['action:button', 'action:icon', 'action:menu', 'action:group']) {
      const parsed = SpecActionSchema.safeParse({ ...base, component });
      expect(parsed.success, `spec rejected component '${component}'`).toBe(true);
    }
    // Negative control: the whitelist is a whitelist.
    expect(SpecActionSchema.safeParse({ ...base, component: 'action:carousel' }).success).toBe(false);
  });

  it('ACTION_PARAM_FIELD_TYPES IS the spec\'s FieldType list, by reference (#4074)', () => {
    // `ActionParamFieldType` is a type alias, so it erases — nothing at runtime
    // stops a future edit from restating it as a literal union, which is how the
    // 16-member fork got there. This array is the witness: identity fails against
    // a hand-listed copy.
    expect(ACTION_PARAM_FIELD_TYPES).toBe(SpecFieldType.options);
  });

  it('ActionParamFieldType covers the spec vocabulary the 16-member fork dropped (#4074)', () => {
    const spec = optionsOf(SpecFieldType, 'FieldType');
    const forked = [
      'text', 'textarea', 'number', 'boolean', 'date', 'datetime', 'time',
      'select', 'email', 'phone', 'url', 'password', 'file', 'color', 'slider', 'rating',
    ];
    // Everything the fork had is still real, so no consumer of the old union breaks.
    expect(forked.filter((v) => !spec.includes(v))).toEqual([]);
    // And it was a strict subset — these are the ones that failed `tsc` while
    // `ActionParamDialog` rendered them.
    expect(spec.length).toBeGreaterThan(forked.length);
    for (const missed of ['lookup', 'multiselect', 'currency', 'user', 'tags', 'json']) {
      expect(spec).toContain(missed);
      expect(forked).not.toContain(missed);
    }
  });

  it('the param-only type aliases are NOT spec field types (#4074)', () => {
    // Same contract as `navigation` above: these are objectui dialect
    // (`PARAM_TYPE_ALIASES` in app-shell's `paramToField.ts`), folded onto a
    // canonical widget type. If the spec adopts one, this fails and names the
    // alias to retire.
    const spec = optionsOf(SpecFieldType, 'FieldType');
    expect([...OBJECTUI_LOCAL_PARAM_FIELD_TYPES]).toEqual(['checkbox', 'reference', 'datetime-local']);
    expect(OBJECTUI_LOCAL_PARAM_FIELD_TYPES.filter((v) => spec.includes(v))).toEqual([]);
  });

  it('the page visualization names are NOT spec page types', () => {
    // `ui/page.zod.ts` says so explicitly; they survive only as the sanctioned
    // local extension in `layout.ts`. If the spec ever adopts one, drop it there.
    const spec = optionsOf(SpecPageTypeSchema, 'PageTypeSchema');
    const local = ['grid', 'gallery', 'kanban', 'calendar', 'timeline'];
    expect(local.filter((v) => spec.includes(v))).toEqual([]);
  });

  // The `JoinStrategy` / `WindowFunction` runtime pin (objectstack#4115) was
  // REMOVED with spec 17.0.0: both enums were retired there (framework#4286), so
  // there is no spec schema left to read members off. See the note beside the
  // type-level pins above.
});
