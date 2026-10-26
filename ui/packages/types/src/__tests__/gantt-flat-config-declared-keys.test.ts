/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Declaration pin — the flattened `GanttConfig` face, plus the query keys, that
 * `ObjectGantt` reads off the node and `ObjectGanttSchema` did not declare
 * (objectui#6051).
 *
 * ## The concealment is an INDEX SIGNATURE, not a cast
 *
 * objectui#5903's ten keys were hidden by `(schema as any).K` — a syntax a regex
 * can find. These were hidden by `BaseSchema`'s `[key: string]: any`
 * (objectui#5155's structural ceiling) reached through a parameter typed
 * `ObjectGridSchema | any`: `schema.colorField` type-checked as `any` with no cast
 * anywhere. Same outcome, no syntax to grep for.
 *
 * The consequence for anyone re-measuring this: "annotate the parameter and see
 * what errors" DID NOT WORK here while `BaseSchema` carried the signature (until
 * objectui#8347): it absorbed every literal name, so the annotation compiled clean
 * while enforcing nothing — the same blind
 * instrument objectui#6373 records. The census behind this card is therefore an
 * AST enumeration of every top-level key read off the `schema` prop in
 * `packages/plugin-gantt/src/**` (non-test), stripping `as` / parenthesis /
 * non-null wrappers and following local aliases.
 *
 * ## The measurement, re-derived on the post-#5903 tree
 *
 * The card reported 24 keys. #5903 landed (PR #6053) between the filing and this
 * work, so the population was re-derived rather than inherited:
 *
 *   - 47 distinct top-level keys are read (the card's 47, reproduced);
 *   - 19 of them are declared — `ObjectGanttSchema`'s own plus `BaseSchema`'s
 *     `label`/`data`, and the ten #5903 added;
 *   - 28 are the residue. #5903 absorbed NONE of the card's 24: its ten
 *     (`skipWeekends`, `holidays`, `persistLayout`, `viewName`, `navigation`,
 *     `markers`, `criticalPath`, `showBaselines`, `readOnly`, `mobileReadOnly`)
 *     are disjoint from them.
 *
 * 27 of the 28 are declared here. The 28th, `gantt`, was severed to objectui#6475
 * and is now declared too — pinned separately below, since it is the one entry
 * that narrows the accept set rather than merely adding a name.
 *
 * The residue is four LARGER than the card's list, and #5903 is why. The card
 * scored "declared by neither `ObjectGanttSchema` nor `ObjectGridSchema`" over
 * `getGanttConfig`'s flat branch only. #5903 retyped `ObjectGanttProps.schema`
 * from `ObjectGridSchema` to `ObjectGanttSchema` — correct, and it is what makes
 * these reads resolve against THIS interface — but `staticData`, `filter` and
 * `sort` were declared on `ObjectGridSchema` and are not on this one. `gantt`, the
 * block face, was outside the line range the card cited and is declared by
 * neither. All four have live read sites; all four are declared here.
 *
 * ## Every key is DERIVED, so the two faces cannot fork
 *
 * The 24 flattened members take their type from {@link GanttConfig} — the same
 * type the `gantt` block carries — rather than restating it. The invariant that
 * keeps that true as either side moves is the type-level pin at the bottom:
 * every key of `GanttConfig` is declared on the node's flat face.
 *
 * ## `gantt`, the 28th key, was severed — and is now declared (objectui#6475)
 *
 * The 27 declared below are new OPTIONAL members: additive on both sides, nothing
 * previously legal loses its slot. `gantt` was the one that would not have been —
 * it had no mirror entry at all, so a block rode through `.passthrough()`
 * unvalidated. Declaring it as `GanttConfig` means it is now parsed, and
 * `GanttConfig` derives from the spec's `GanttConfigSchema`, which REQUIRES
 * `startDateField`, `endDateField` and `titleField`. `ObjectGanttSchema` is a
 * member of `AnyComponentSchema`, so that reaches `safeValidateSchema` and with
 * it the CLI's `validate` / `check`: a block missing one of the three moves from
 * "accepted, then warned about at runtime" to "refused at authoring time".
 *
 * PM ruling (2026-08-26): sever it, so a published CLI's refusal behaviour is
 * decided on its own card rather than inside a 27-key declaration PR. Maintainer
 * ruling on that severed card, objectui#6475 (2026-08-27), Option A: declare it
 * as-is, enforce the spec's requiredness immediately, no warning window (the
 * startup-stage no-gradualism rule, objectstack#12668 — no named external-user
 * evidence). `getGanttConfig`'s block branch already fed the block to
 * `GanttConfigSchema.safeParse` and logged `[ObjectGantt] Invalid gantt
 * configuration`, so declaring it restores declared = enforced rather than
 * inventing a stricter contract.
 *
 * Today's behaviour — the trio enforced, everything else `GanttConfig` allows
 * accepted — is pinned below rather than left implicit.
 *
 * ## What the pin has teeth against, and what it does not
 *
 * Unchanged from #5903, and worth restating because it is the half people read
 * wrongly: `BaseSchema` is `.passthrough()` on the zod side (and carried
 * `[key: string]: any` on the TS side until objectui#8347), so declaring these
 * keys does NOT buy rejection of a misspelling on the zod face. What it buys is that a DECLARED key is validated
 * (`capacity: 'one'` is refused where it used to parse green), that the published
 * types now TEACH the vocabulary, and that the type-level pins below fail when a
 * declaration is removed.
 */

import { describe, it, expect } from 'vitest';
import { ObjectGanttSchema } from '../zod/objectql.zod.js';
import type { GanttConfig, ObjectGanttSchema as ObjectGanttSchemaTS, SortConfig } from '../objectql.js';
import type { ViewFilterRule } from '@objectstack/spec/ui';

const MINIMAL = {
  type: 'object-gantt',
  objectName: 'task',
  startDateField: 'start',
  endDateField: 'end',
} as const;

/**
 * The 27 keys this card declared, each with a value its declared type refuses.
 *
 * 24 flattened `GanttConfig` members and the three query keys (`staticData` /
 * `filter` / `sort`). The 28th measured key, `gantt` (objectui#6475), is pinned
 * separately below — it is declared too, but as a PARSED block rather than a
 * bare optional scalar, so its refusal shape does not fit this table.
 */
const DECLARED: ReadonlyArray<readonly [string, unknown]> = [
  // — the flattened GanttConfig face —
  ['colorField', 5],
  ['borderColorField', 5],
  ['dependenciesField', 5],
  ['parentField', 5],
  ['typeField', 5],
  ['lockField', 5],
  ['objectField', 5],
  ['summaryExtent', 'parent'],
  ['defaultCollapsedDepth', '2'],
  ['tooltipFields', 'name'],
  ['baselineStartField', 5],
  ['baselineEndField', 5],
  ['groupByField', 5],
  ['resourceView', 'yes'],
  ['assigneeField', 5],
  ['effortField', 5],
  ['capacity', 'one'],
  ['quickFilters', [{ label: 'Owner' }]],
  ['autoZoomToFilter', 'yes'],
  ['timeSegments', { bands: [{ label: 'Day' }] }],
  ['interactions', 'none'],
  ['exportFileName', 5],
  ['timeZone', 5],
  ['dependencyTypes', 'yes'],
  // — the query keys the fetch path reads —
  ['staticData', { id: 1 }],
  ['filter', 'name = 1'],
  ['sort', 5],
];

/** One well-typed value per declared key — the counter-probe for the block above. */
const GOOD = {
  colorField: 'status',
  borderColorField: 'alert',
  dependenciesField: 'predecessors',
  parentField: 'parent',
  typeField: 'kind',
  lockField: 'locked',
  objectField: 'object_name',
  summaryExtent: 'self' as const,
  defaultCollapsedDepth: 2,
  tooltipFields: ['owner', { field: 'stage', label: 'Stage' }],
  baselineStartField: 'plan_start',
  baselineEndField: 'plan_end',
  groupByField: 'owner',
  resourceView: true,
  assigneeField: 'owner',
  effortField: 'effort',
  capacity: 2,
  quickFilters: [{ field: 'owner', label: 'Owner' }],
  autoZoomToFilter: false,
  timeSegments: {
    dayStart: '08:00',
    bands: [{ key: 'day', label: 'Day shift', start: '08:00', end: '20:00' }],
    showMidnight: true,
  },
  interactions: { move: true, resize: false, progress: true, link: false },
  exportFileName: 'Shift Plan',
  timeZone: 'Asia/Shanghai',
  dependencyTypes: false,
  staticData: [{ id: 1, name: 'Task' }],
  // objectui#6152 round 10 — the `object-gantt` row's `ViewFilterRule` array; the AST
  // tuple array this used to carry is the row's refusal now, on both faces.
  filter: [{ field: 'name', operator: 'equals' as const, value: 'Task' }],
  sort: [{ field: 'name', order: 'desc' as const }],
};

describe('ObjectGanttSchema — the flattened gantt config is declared (objectui#6051)', () => {
  it('the mirror declares every one of the 27', () => {
    const shape = Object.keys(ObjectGanttSchema.shape);
    for (const [key] of DECLARED) expect(shape, `mirror is missing ${key}`).toContain(key);
  });

  it('the census is the measured 28, not a shorter list that drifted', () => {
    // Non-vacuity for the loops below: they iterate DECLARED, so a truncated
    // DECLARED would pass everything while checking less. The number is the
    // measured residue stated in this file's header.
    expect(DECLARED).toHaveLength(27);
    expect(new Set(DECLARED.map(([k]) => k)).size).toBe(27);
    expect(Object.keys(GOOD).sort()).toEqual(DECLARED.map(([k]) => k).sort());
  });

  it('declares them all OPTIONAL — none of the 27 may become required', () => {
    // Requiredness is the half the zod-mirror-parity ratchet compares against
    // `../objectql.ts`, where all 27 are `?:`. A mirror that required one would
    // reject every gantt already published.
    const result = ObjectGanttSchema.safeParse(MINIMAL);
    expect(result.success ? null : result.error.issues).toBe(null);
  });

  it('materialises NO defaults — an omitted key stays absent after parse', () => {
    // `autoZoomToFilter` and `dependencyTypes` default ON *in the renderer*, which
    // reads `!== false`. A `.default(true)` here would arrive downstream as an
    // explicit author choice; the two spellings are not interchangeable.
    const result = ObjectGanttSchema.safeParse(MINIMAL);
    expect(result.success).toBe(true);
    if (!result.success) return;
    for (const [key] of DECLARED) expect(key in result.data, `${key} must stay absent`).toBe(false);
  });

  it('refuses a wrong-typed value on each declared key', () => {
    for (const [key, bad] of DECLARED) {
      const result = ObjectGanttSchema.safeParse({ ...MINIMAL, [key]: bad });
      expect(result.success, `${key} accepted ${JSON.stringify(bad)}`).toBe(false);
      if (result.success) continue;
      const issue = result.error.issues.find((i) => i.path[0] === key);
      expect(issue, `${key} failed, but not on the ${key} path`).toBeTruthy();
    }
  });

  it('accepts a well-typed value on every declared key', () => {
    // Counter-probe for the assertion above: it must be the VALUE being refused,
    // not the key. A pin that only ever sees red proves nothing.
    const result = ObjectGanttSchema.safeParse({ ...MINIMAL, ...GOOD });
    expect(result.success ? null : result.error.issues).toBe(null);
  });

  it('the `gantt` BLOCK face is declared, and the spec trio now enforces at parse time (objectui#6475)', () => {
    // The 28th measured key. objectui#6475, Option A: declared as `GanttConfig`,
    // so a block is now PARSED against the spec's `GanttConfigSchema` — the
    // published CLI's `validate`/`check` refusal this card exists to pin.
    expect(Object.keys(ObjectGanttSchema.shape)).toContain('gantt');

    // A block missing one of the required trio (startDateField / endDateField /
    // titleField) is REFUSED — this is the accept-set narrowing itself, and it
    // names the missing field rather than failing silently.
    const missingTitleField = ObjectGanttSchema.safeParse({
      ...MINIMAL,
      gantt: { startDateField: 'start', endDateField: 'end', lockField: 'locked' },
    });
    expect(missingTitleField.success).toBe(false);
    if (!missingTitleField.success) {
      const issue = missingTitleField.error.issues.find((i) => i.path.join('.') === 'gantt.titleField');
      expect(issue, 'refusal must name the missing titleField').toBeTruthy();
    }

    // A completely empty block is refused too — all three of the trio absent.
    expect(ObjectGanttSchema.safeParse({ ...MINIMAL, gantt: {} }).success).toBe(false);

    // A wrong-TYPED block (not even an object) is refused.
    expect(ObjectGanttSchema.safeParse({ ...MINIMAL, gantt: 'flat' }).success).toBe(false);

    // A block carrying the complete trio IS accepted — the narrowing is exactly
    // the trio, nothing more.
    const complete = ObjectGanttSchema.safeParse({
      ...MINIMAL,
      gantt: { startDateField: 'start', endDateField: 'end', titleField: 'name', lockField: 'locked' },
    });
    expect(complete.success ? null : complete.error.issues).toBe(null);
  });

  it('does NOT reject an undeclared key — objectui#5155 ceiling, measured not assumed', () => {
    // Declaring the 28 bought validation of DECLARED keys, not rejection of
    // undeclared ones: `BaseSchema` is `.passthrough()`. Anyone reading this card
    // as "misspellings now fail" is reading it wrong, and this pin says so in the
    // one place that cannot rot.
    const misspelled = ObjectGanttSchema.safeParse({ ...MINIMAL, colourField: 'status', lockFeild: 'locked' });
    expect(misspelled.success).toBe(true);
  });
});

/* ── The derived invariant: the two authoring faces are one vocabulary ─────── */

/**
 * A declaration's OWN declared members, with any index signature stripped.
 *
 * Same construction as `zod-mirror-parity.test.ts` and for the same measured
 * reason: `keyof ObjectGanttSchema` resolved to bare `string` while
 * `BaseSchema`'s `[key: string]: any` absorbed every literal name (until
 * objectui#8347), and `GanttConfig` still carries a signature of its own. A homomorphic
 * mapped type maps declared members and index signatures separately, so remapping
 * the index-signature keys to `never` leaves the literal members.
 */
type WithoutIndexSignature<D> = {
  [K in keyof D as string extends K ? never : number extends K ? never : K]: D[K];
};
type DeclaredKeys<D> = Extract<keyof WithoutIndexSignature<D>, string>;

/**
 * Keys of the BLOCK face that the FLAT face does not declare. `never` is the contract.
 *
 * `DeclaredKeys` is applied to BOTH sides, and that is load-bearing rather than
 * symmetry for its own sake: the spec's `GanttConfigSchema` is `$loose`, so
 * `GanttConfig` carries `[x: string]: unknown` of its own and bare
 * `keyof GanttConfig` resolves to `string` — measured, when this pin was first
 * written that way, and it made the `Exclude` unconditionally `string`. Two index
 * signatures, two chances for the same vacuity; the non-vacuity test below pins
 * both.
 */
type FlatFaceGaps = Exclude<DeclaredKeys<GanttConfig>, DeclaredKeys<ObjectGanttSchemaTS>>;

describe('ObjectGanttSchema (TS) — the flat face declares the whole block vocabulary', () => {
  it('every GanttConfig key is declared at the top level too', () => {
    // Derived, with no key list to maintain: add a member to `GanttConfig` (or to
    // the spec's `GanttConfigSchema`, which it derives from) without declaring the
    // flattened spelling and this line stops compiling, NAMING the missing key.
    const noGaps: FlatFaceGaps extends never ? true : FlatFaceGaps = true;
    expect(noGaps).toBe(true);
  });

  it('the invariant above is not vacuous', () => {
    // Two ways `FlatFaceGaps` could be `never` while proving nothing.
    //
    // 1. `DeclaredKeys<ObjectGanttSchemaTS>` degenerating to `string` — the exact
    //    index-signature trap this card is about — would `Exclude` everything.
    const notWidened: string extends DeclaredKeys<ObjectGanttSchemaTS> ? never : true = true;
    // 2. the SAME degeneration on the other side would make the `Exclude` source
    //    `string`, which is what happened before `DeclaredKeys` was applied here.
    const blockNotWidened: string extends DeclaredKeys<GanttConfig> ? never : true = true;
    // 3. `DeclaredKeys<GanttConfig>` resolving to `never` would leave nothing to
    //    exclude, and both the spec's members and objectui's must be in it.
    const blockHasSpecKeys: 'colorField' extends DeclaredKeys<GanttConfig> ? true : never = true;
    const blockHasLocalKeys: 'summaryExtent' extends DeclaredKeys<GanttConfig> ? true : never = true;
    // 4. ...and the flat face must really carry the derived members, not `any`.
    const flatHasKeys: 'summaryExtent' extends DeclaredKeys<ObjectGanttSchemaTS> ? true : never = true;
    expect([notWidened, blockNotWidened, blockHasSpecKeys, blockHasLocalKeys, flatHasKeys])
      .toEqual([true, true, true, true, true]);
  });
});

describe('ObjectGanttSchema (TS) — compile-time pin on every declared key', () => {
  it('refuses a wrong-typed value on every declared key', () => {
    // Each directive below failed the build (TS2578, "unused '@ts-expect-error'")
    // the moment its key stopped being declared, while the member resolved to
    // `any` through `BaseSchema`'s index signature. Since objectui#8347 a removal
    // makes the indexed access itself an error, which its directive swallows, so
    // these directives guard each member's TYPE only. The deletion guards are
    // elsewhere in this file: the derived invariant above catches a deletion of
    // any `GanttConfig` key (measured by ablation: deleting `colorField` from
    // the interface reddens `noGaps`, naming the key), and the three query keys,
    // which `GanttConfig` does not carry, have the `_StaticData…` / `_Filter…` /
    // `_Sort…` rows after this block. `tsconfig.test.json` compiles this file, so
    // it is real enforcement (#3009).

    // @ts-expect-error — `colorField` is declared `string | undefined`.
    const colorField: ObjectGanttSchemaTS['colorField'] = 5;
    // @ts-expect-error — `borderColorField` is declared `string | undefined`.
    const borderColorField: ObjectGanttSchemaTS['borderColorField'] = 5;
    // @ts-expect-error — `dependenciesField` is declared `string | undefined`.
    const dependenciesField: ObjectGanttSchemaTS['dependenciesField'] = 5;
    // @ts-expect-error — `parentField` is declared `string | undefined`.
    const parentField: ObjectGanttSchemaTS['parentField'] = 5;
    // @ts-expect-error — `typeField` is declared `string | undefined`.
    const typeField: ObjectGanttSchemaTS['typeField'] = 5;
    // @ts-expect-error — `lockField` is declared `string | undefined`.
    const lockField: ObjectGanttSchemaTS['lockField'] = 5;
    // @ts-expect-error — `objectField` is declared `string | undefined`.
    const objectField: ObjectGanttSchemaTS['objectField'] = 5;
    // @ts-expect-error — `summaryExtent` is declared `'children' | 'self' | undefined`.
    const summaryExtent: ObjectGanttSchemaTS['summaryExtent'] = 'parent';
    // @ts-expect-error — `defaultCollapsedDepth` is declared `number | undefined`.
    const defaultCollapsedDepth: ObjectGanttSchemaTS['defaultCollapsedDepth'] = '2';
    // @ts-expect-error — `tooltipFields` is declared an ARRAY of field refs.
    const tooltipFields: ObjectGanttSchemaTS['tooltipFields'] = 'name';
    // @ts-expect-error — `baselineStartField` is declared `string | undefined`.
    const baselineStartField: ObjectGanttSchemaTS['baselineStartField'] = 5;
    // @ts-expect-error — `baselineEndField` is declared `string | undefined`.
    const baselineEndField: ObjectGanttSchemaTS['baselineEndField'] = 5;
    // @ts-expect-error — `groupByField` is declared `string | undefined`.
    const groupByField: ObjectGanttSchemaTS['groupByField'] = 5;
    // @ts-expect-error — `resourceView` is declared `boolean | undefined`.
    const resourceView: ObjectGanttSchemaTS['resourceView'] = 'yes';
    // @ts-expect-error — `assigneeField` is declared `string | undefined`.
    const assigneeField: ObjectGanttSchemaTS['assigneeField'] = 5;
    // @ts-expect-error — `effortField` is declared `string | undefined`.
    const effortField: ObjectGanttSchemaTS['effortField'] = 5;
    // @ts-expect-error — `capacity` is declared `number | undefined`.
    const capacity: ObjectGanttSchemaTS['capacity'] = 'one';
    // @ts-expect-error — `quickFilters[].field` is required.
    const quickFilters: ObjectGanttSchemaTS['quickFilters'] = [{ label: 'Owner' }];
    // @ts-expect-error — `autoZoomToFilter` is declared `boolean | undefined`.
    const autoZoomToFilter: ObjectGanttSchemaTS['autoZoomToFilter'] = 'yes';
    // @ts-expect-error — `timeSegments.bands[]` requires `start` and `end`.
    const timeSegments: ObjectGanttSchemaTS['timeSegments'] = { bands: [{ label: 'Day' }] };
    // @ts-expect-error — `interactions` is declared an object of switches.
    const interactions: ObjectGanttSchemaTS['interactions'] = 'none';
    // @ts-expect-error — `exportFileName` is declared `string | undefined`.
    const exportFileName: ObjectGanttSchemaTS['exportFileName'] = 5;
    // @ts-expect-error — `timeZone` is declared `string | undefined`.
    const timeZone: ObjectGanttSchemaTS['timeZone'] = 5;
    // @ts-expect-error — `dependencyTypes` is declared `boolean | undefined`.
    const dependencyTypes: ObjectGanttSchemaTS['dependencyTypes'] = 'yes';
    // @ts-expect-error — `staticData` is declared `any[] | undefined`.
    const staticData: ObjectGanttSchemaTS['staticData'] = { id: 1 };
    // @ts-expect-error — `filter` is declared `ViewFilterRule[] | undefined` (the
    // `object-gantt` row's own member, objectui#6152 round 10).
    const filter: ObjectGanttSchemaTS['filter'] = 'name = 1';
    // @ts-expect-error — `sort` is declared `SortConfig[] | undefined` (the legacy
    // string clause was retired in objectui#8221).
    const sort: ObjectGanttSchemaTS['sort'] = 5;

    expect([
      colorField, borderColorField, dependenciesField, parentField, typeField,
      lockField, objectField, summaryExtent, defaultCollapsedDepth, tooltipFields,
      baselineStartField, baselineEndField, groupByField, resourceView, assigneeField,
      effortField, capacity, quickFilters, autoZoomToFilter, timeSegments,
      interactions, exportFileName, timeZone, dependencyTypes,
      staticData, filter, sort,
    ]).toHaveLength(27);
  });

  it('accepts the well-typed value on every declared key', () => {
    // Counter-probe for the directives above: without this, a declaration narrowed
    // to `never` would satisfy every one of them.
    const ok: ObjectGanttSchemaTS = { ...MINIMAL, ...GOOD };
    expect(ok.summaryExtent).toBe('self');
    expect(ok.interactions?.resize).toBe(false);
  });
});

/* ── The three query keys EXIST on the flat face, with their declared type ─── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/**
 * `staticData` / `filter` / `sort` are not `GanttConfig` keys, so the derived
 * invariant above is blind to their deletion, and the counter-probe literal
 * spreads `GOOD`, which excess-property checking does not reach. These rows are
 * their deletion guard: an indexed access on a member that does not exist is
 * itself a compile error, and `Equal` pins each declared type. Measured by
 * ablation on this tree: deleting any one of the three from `ObjectGanttSchema`
 * turns its row red while its directive above stays green; restored, green.
 */
// The `any[]` below restates the member's own declared type (`staticData?: any[]` in
// `objectql.ts`); `Equal` is strict, so a narrower spelling would be red. `filter` is the
// `object-gantt` row's `ViewFilterRule` array since objectui#6152 round 10 (was `any[]`).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type _StaticDataIsDeclared = Expect<Equal<ObjectGanttSchemaTS['staticData'], any[] | undefined>>;
export type _FilterIsDeclared = Expect<Equal<ObjectGanttSchemaTS['filter'], ViewFilterRule[] | undefined>>;
export type _SortIsDeclared = Expect<Equal<ObjectGanttSchemaTS['sort'], SortConfig[] | undefined>>;
