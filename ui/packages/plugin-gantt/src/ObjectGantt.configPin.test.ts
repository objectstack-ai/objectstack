/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Declaration pin — every member `ObjectGantt` restates on top of
 * {@link GanttConfig} still means what its twin means (objectui#6471).
 *
 * ## The defect this closes
 *
 * `GanttConfigEx` is `GanttConfig & GanttConfigRestated`. The second half
 * re-declares keys the first half already declares — nine of them arriving on
 * `GanttConfig` from the spec's `GanttConfigSchema` (19 keys as of rc.6). Two
 * declarations of one key CAN disagree, and until this file nothing asserted
 * that they still agree after a spec bump. They are kept rather than deleted
 * because their JSDoc is the only prose in this repo describing what this
 * renderer does with each key; this pin is what makes keeping them safe.
 *
 * ## Why the local half had to be NAMED first
 *
 * The pin is impossible to write against `GanttConfigEx` itself, and writing it
 * that way is the trap: `GanttConfigEx[K]` is ALREADY `GanttConfig[K] &
 * GanttConfigRestated[K]`, so it is assignable to `GanttConfig[K]` by
 * construction. An assertion phrased over the intersection passes no matter how
 * far the two declarations drift — green, permanent, and measuring nothing.
 * Splitting the local half into its own named type is what gives the assertions
 * below two INDEPENDENT operands.
 *
 * ## What was measured, and what it contradicts
 *
 * All TWELVE restated members are mutually assignable with their `GanttConfig`
 * twin today — including `quickFilters` and `timeSegments`. The card
 * (objectui#6471) and its triage both describe those two as load-bearing
 * NARROWINGS; on current `main` they narrow nothing, and the reason is
 * traceable rather than mysterious:
 *
 *   - `timeSegments` — objectui#6051/#6472 lifted the member onto `GanttConfig`
 *     in `@object-ui/types`, and the shape it lifted is structurally
 *     {@link ShiftSegmentsConfig};
 *   - `quickFilters` — rc.6's `GanttConfigSchema.quickFilters` already models
 *     `field` / `label` / `options` exactly as {@link QuickFilterDef} does.
 *
 * Both are pinned below as the MEASURED state rather than deleted: the type each
 * one names is still this plugin's own runtime vocabulary, and a spec bump that
 * moves either side should surface here as a decision, not as a silent widening.
 * That is the whole point of the instrument.
 */

import { describe, it, expect } from 'vitest';
import type { GanttConfig } from '@object-ui/types';
import type { GanttConfigRestated, QuickFilterDef } from './ObjectGantt';
import type { ShiftSegmentsConfig } from './shifts';

/**
 * Mutual assignability. Both sides are wrapped in a 1-tuple so a naked union
 * distributes as one type rather than member-by-member, which would report a
 * union and its own member as equal.
 */
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** `true` only for `any` — the one operand that makes `Mutual` unconditionally true. */
type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * The restated keys that no longer agree with their `GanttConfig` twin.
 * `never` is the contract, and a violation NAMES the key in the compiler error.
 *
 * Derived over `keyof GanttConfigRestated`, so there is no key list here to fall
 * out of date: add a member to `GanttConfigRestated` and it is pinned the moment
 * it exists.
 */
type Diverged = {
  [K in keyof GanttConfigRestated]-?: Mutual<GanttConfigRestated[K], GanttConfig[K]> extends true
    ? never
    : K;
}[keyof GanttConfigRestated];

/** Restated keys where either operand is `any`, which would make `Diverged` blind. */
type AnyOperand = {
  [K in keyof GanttConfigRestated]-?: IsAny<GanttConfigRestated[K]> extends true
    ? K
    : IsAny<GanttConfig[K]> extends true
      ? K
      : never;
}[keyof GanttConfigRestated];

/** The census, as a runtime list the type side holds to account below. */
const RESTATED = [
  'parentField',
  'typeField',
  'baselineStartField',
  'baselineEndField',
  'groupByField',
  'resourceView',
  'assigneeField',
  'effortField',
  'capacity',
  'quickFilters',
  'autoZoomToFilter',
  'timeSegments',
] as const;

/** A member of `GanttConfigRestated` missing from `RESTATED` above. `never` is the contract. */
type UncensusedKey = Exclude<keyof GanttConfigRestated, (typeof RESTATED)[number]>;
/** A `RESTATED` entry that is no longer a member. `never` is the contract. */
type StaleCensusEntry = Exclude<(typeof RESTATED)[number], keyof GanttConfigRestated>;

describe('GanttConfigRestated — every restatement still agrees with its GanttConfig twin', () => {
  it('no restated member has diverged from GanttConfig', () => {
    // THE PIN. A spec bump (or an edit to `@object-ui/types`) that re-types one
    // of these stops compiling HERE, naming the key — instead of being silently
    // intersected back to the old type by `GanttConfigEx` and read as unchanged.
    const noDivergence: Diverged extends never ? true : Diverged = true;
    expect(noDivergence).toBe(true);
  });

  it('the census is the measured twelve, with no member unpinned', () => {
    // Non-vacuity for the runtime loop below, and a self-maintaining list: a new
    // member of `GanttConfigRestated` that nobody added here fails to compile.
    const noUncensused: UncensusedKey extends never ? true : UncensusedKey = true;
    const noStale: StaleCensusEntry extends never ? true : StaleCensusEntry = true;
    expect([noUncensused, noStale]).toEqual([true, true]);
    expect(RESTATED).toHaveLength(12);
    expect(new Set(RESTATED).size).toBe(12);
  });

  it('the pin is not vacuous', () => {
    // Four ways `Diverged` could be `never` while proving nothing.
    //
    // 1. `Mutual` degenerating to always-true. The directive below is USED today
    //    (string and number are not mutually assignable, so the annotation is
    //    `never` and the assignment is an error). If `Mutual` ever stopped having
    //    teeth the assignment would start succeeding and this directive would go
    //    unused — TS2578, a failed build. The control guards itself.
    // @ts-expect-error — `Mutual<string, number>` must be `false`.
    const mutualHasTeeth: Mutual<string, number> extends true ? true : never = true;
    // 2. an `any` on either side of the comparison, which `Mutual` swallows.
    const noAnyOperand: AnyOperand extends never ? true : AnyOperand = true;
    // 3. `keyof GanttConfigRestated` degenerating to `string` — the index-signature
    //    trap `gantt-flat-config-declared-keys.test.ts` records on the other side
    //    of this vocabulary. `GanttConfig` really does carry `[x: string]: unknown`
    //    (its spec schema is `$loose`), so this is a live hazard, not a ritual.
    const keysNotWidened: string extends keyof GanttConfigRestated ? never : true = true;
    // 4. `GanttConfigRestated` having no members at all would leave nothing to map.
    const hasMembers: 'parentField' extends keyof GanttConfigRestated ? true : never = true;
    expect([mutualHasTeeth, noAnyOperand, keysNotWidened, hasMembers])
      .toEqual([true, true, true, true]);
  });

  it('records the MEASURED state of the two the card calls narrowings', () => {
    // The card and its triage both call these load-bearing NARROWINGS. Measured
    // on current `main` they narrow nothing — they are mutually assignable with
    // their twins, exactly like the other ten. Pinned as a measured state so the
    // claim is not re-inherited from prose: if a spec bump makes either a real
    // narrowing again, `Diverged` above fires and this line is where the next
    // agent reads what changed.
    const quickFiltersNarrowsNothing: Mutual<
      GanttConfigRestated['quickFilters'],
      GanttConfig['quickFilters']
    > extends true
      ? true
      : never = true;
    const timeSegmentsNarrowsNothing: Mutual<
      GanttConfigRestated['timeSegments'],
      GanttConfig['timeSegments']
    > extends true
      ? true
      : never = true;
    expect([quickFiltersNarrowsNothing, timeSegmentsNarrowsNothing]).toEqual([true, true]);
  });

  it('both still name THIS plugin\'s runtime vocabulary', () => {
    // What deleting them would actually cost, stated as a type rather than as a
    // belief: the members bind the config to the plugin's own named types, which
    // is what `QuickFilterBar` and `normalizeShiftSegments` consume. When one of
    // these two lines and the pair above disagree, the SPEC side moved; when they
    // agree and `Diverged` fires, this plugin's side moved.
    const quickFiltersIsPluginType: Mutual<
      GanttConfigRestated['quickFilters'],
      QuickFilterDef[] | undefined
    > extends true
      ? true
      : never = true;
    const timeSegmentsIsPluginType: Mutual<
      GanttConfigRestated['timeSegments'],
      ShiftSegmentsConfig | undefined
    > extends true
      ? true
      : never = true;
    expect([quickFiltersIsPluginType, timeSegmentsIsPluginType]).toEqual([true, true]);
  });

  it('GanttConfigEx still carries every restated key at its agreed type', () => {
    // The consumer-side half: the intersection the renderer actually reads is
    // unchanged by the split. This is assignability in the direction that would
    // break reads, and it is the runtime-facing claim behind "no behaviour change".
    const cfg: import('./ObjectGantt').GanttConfigRestated = {
      parentField: 'parent',
      typeField: 'kind',
      baselineStartField: 'plan_start',
      baselineEndField: 'plan_end',
      groupByField: 'owner',
      resourceView: true,
      assigneeField: 'owner',
      effortField: 'effort',
      capacity: 2,
      quickFilters: [{ field: 'owner', label: 'Owner' }],
      autoZoomToFilter: false,
      timeSegments: { bands: [{ label: 'Day', start: '08:00', end: '20:00' }] },
    };
    const asConfig: Partial<GanttConfig> = cfg;
    expect(Object.keys(asConfig).sort()).toEqual([...RESTATED].sort());
  });
});
