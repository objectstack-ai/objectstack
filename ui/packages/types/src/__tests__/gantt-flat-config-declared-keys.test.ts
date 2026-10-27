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
 *
 * ## ⏱ objectstack#25923 — the 24 flattened members LEFT this interface
 *
 * `ComponentPropsMap['object-gantt']` refuses every `GanttConfig` key written
 * flat on the node, so a published flat member was an authorable spelling the
 * spec refuses. The 24 moved to `plugin-gantt`'s package-local hand-off type
 * (`ObjectGanttFlatFields`, DERIVED from `GanttConfig` there, so the "one
 * vocabulary" invariant below holds by construction on that side and is pinned
 * in `plugin-gantt`'s `ganttHandoffFlatFields-25923.test.ts`). What this file
 * pins now: the 24 are members of NEITHER published face, the three query keys
 * still are (and are still value-validated), and the `gantt` block is unchanged.
 * The paragraphs above are this card's reading at the time, kept as written.
 */

import { describe, it, expect } from 'vitest';
import { ObjectGanttSchema } from '../zod/objectql.zod.js';
import { StrictAnyComponentSchema } from '../zod/index.zod';
import type { GanttConfig, ObjectGanttSchema as ObjectGanttSchemaTS, SortConfig } from '../objectql.js';
import type { ViewFilterRule } from '@objectstack/spec/ui';

const MINIMAL = {
  type: 'object-gantt',
  objectName: 'task',
} as const;

/** The block every row below may add, carrying the spec's required trio. */
const BLOCK = { startDateField: 'start', endDateField: 'end', titleField: 'name' } as const;

/**
 * The 24 flattened `GanttConfig` members objectui#6051 declared here, each with
 * a value their type refuses. objectstack#25923 moved them OFF this interface
 * and its mirror: the rows below pin their ABSENCE, and the bad values pin that
 * the tolerant mirror no longer examines them (it admits what it does not
 * declare, objectui#5155).
 */
const MOVED_OFF: ReadonlyArray<readonly [string, unknown]> = [
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
];

/** The three query keys the fetch path reads: still DECLARED, each with a refused value. */
const DECLARED: ReadonlyArray<readonly [string, unknown]> = [
  ['staticData', { id: 1 }],
  ['filter', 'name = 1'],
  ['sort', 5],
];

/** One well-typed value per declared key — the counter-probe for the block above. */
const GOOD = {
  staticData: [{ id: 1, name: 'Task' }],
  // objectui#6152 round 10 — the `object-gantt` row's `ViewFilterRule` array; the AST
  // tuple array this used to carry is the row's refusal now, on both faces.
  filter: [{ field: 'name', operator: 'equals' as const, value: 'Task' }],
  sort: [{ field: 'name', order: 'desc' as const }],
};

describe('ObjectGanttSchema — the flattened gantt config is NOT declared (objectstack#25923)', () => {
  it('the mirror declares none of the 24, and still declares the three query keys', () => {
    const shape = Object.keys(ObjectGanttSchema.shape);
    for (const [key] of MOVED_OFF) expect(shape, `mirror declares the flat ${key} again`).not.toContain(key);
    for (const [key] of DECLARED) expect(shape, `mirror is missing ${key}`).toContain(key);
    // CONTROL on the same shape: the block that carries the 24 is declared.
    expect(shape).toContain('gantt');
  });

  it('the census is the measured 24 + 3, not a shorter list that drifted', () => {
    // Non-vacuity for the loops below: they iterate the two lists, so a
    // truncated list would pass everything while checking less.
    expect(MOVED_OFF).toHaveLength(24);
    expect(new Set(MOVED_OFF.map(([k]) => k)).size).toBe(24);
    expect(Object.keys(GOOD).sort()).toEqual(DECLARED.map(([k]) => k).sort());
  });

  it('the tolerant mirror no longer examines a flat key: a wrong-typed one rides `.passthrough()`', () => {
    // The flip side of the move, stated so nobody reads the tolerant face as
    // judging them still. The authoring judgement is the STRICT face's, and for
    // `object-gantt` that face already refused a flat key (its arm is the
    // `properties` bag, `ObjectGanttBlockSchema`).
    for (const [key, bad] of MOVED_OFF) {
      const result = ObjectGanttSchema.safeParse({ ...MINIMAL, [key]: bad });
      expect(result.success ? null : result.error.issues, `${key}`).toBe(null);
    }
  });

  it('declares the three query keys OPTIONAL, with no materialised default', () => {
    const result = ObjectGanttSchema.safeParse(MINIMAL);
    expect(result.success ? null : result.error.issues).toBe(null);
    if (!result.success) return;
    for (const [key] of DECLARED) expect(key in result.data, `${key} must stay absent`).toBe(false);
  });

  it('refuses a wrong-typed value on each declared query key', () => {
    for (const [key, bad] of DECLARED) {
      const result = ObjectGanttSchema.safeParse({ ...MINIMAL, [key]: bad });
      expect(result.success, `${key} accepted ${JSON.stringify(bad)}`).toBe(false);
      if (result.success) continue;
      const issue = result.error.issues.find((i) => i.path[0] === key);
      expect(issue, `${key} failed, but not on the ${key} path`).toBeTruthy();
    }
  });

  it('accepts a well-typed value on every declared query key', () => {
    // Counter-probe for the assertion above: it must be the VALUE being refused,
    // not the key. A pin that only ever sees red proves nothing.
    const result = ObjectGanttSchema.safeParse({ ...MINIMAL, ...GOOD });
    expect(result.success ? null : result.error.issues).toBe(null);
  });

  it('the `gantt` BLOCK face is declared, and the spec trio enforces at parse time (objectui#6475)', () => {
    // The 28th measured key, and since objectstack#25923 the ONE spelling of the
    // other 24 on this node. objectui#6475, Option A: declared as `GanttConfig`,
    // so a block is PARSED against the spec's `GanttConfigSchema`.
    expect(Object.keys(ObjectGanttSchema.shape)).toContain('gantt');

    // A block missing one of the required trio (startDateField / endDateField /
    // titleField) is REFUSED, naming the missing field.
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

    // A block carrying the complete trio IS accepted, and so is every one of the
    // 24 inside it, well-typed — the narrowing is exactly the trio.
    const complete = ObjectGanttSchema.safeParse({
      ...MINIMAL,
      gantt: { ...BLOCK, lockField: 'locked', summaryExtent: 'self', capacity: 2, interactions: { move: true } },
    });
    expect(complete.success ? null : complete.error.issues).toBe(null);
    // …and a wrong-typed one of the 24 inside the block is refused AT its path,
    // which is where the value validation the flat members used to carry lives now.
    const bad = ObjectGanttSchema.safeParse({ ...MINIMAL, gantt: { ...BLOCK, capacity: 'one' } });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues.map((i) => i.path.join('.'))).toContain('gantt.capacity');
    }
  });

  it('the STRICT authoring face refuses each of the 24 written flat, and takes them in the block', () => {
    // Not new with objectstack#25923: the strict face's `object-gantt` arm is the
    // `properties` bag (`ObjectGanttBlockSchema`, objectui#10859), which refused
    // every flat key before this card. Pinned here so the published TS/zod
    // narrowing and the strict face cannot drift apart again.
    for (const [key] of MOVED_OFF) {
      const r = StrictAnyComponentSchema.safeParse({ type: 'object-gantt', [key]: 'x' });
      expect(r.success, `the strict face accepts a flat ${key}`).toBe(false);
    }
    const ok = StrictAnyComponentSchema.safeParse({
      type: 'object-gantt',
      properties: { objectName: 'task', gantt: { ...BLOCK, lockField: 'locked', summaryExtent: 'self' } },
    });
    expect(ok.success ? null : ok.error.issues).toBe(null);
  });

  it('does NOT reject an undeclared key — objectui#5155 ceiling, measured not assumed', () => {
    const misspelled = ObjectGanttSchema.safeParse({ ...MINIMAL, colourField: 'status', lockFeild: 'locked' });
    expect(misspelled.success).toBe(true);
  });
});

/* ── The derived invariant, inverted: the flat face carries NO block key ───── */

/**
 * A declaration's OWN declared members, with any index signature stripped.
 *
 * Same construction as `zod-mirror-parity.test.ts` and for the same measured
 * reason: `GanttConfig` carries a signature of its own (the spec's
 * `GanttConfigSchema` is `$loose`), and bare `keyof GanttConfig` resolves to
 * `string`.
 */
type WithoutIndexSignature<D> = {
  [K in keyof D as string extends K ? never : number extends K ? never : K]: D[K];
};
type DeclaredKeys<D> = Extract<keyof WithoutIndexSignature<D>, string>;

/**
 * Keys of the BLOCK face that the published interface ALSO declares flat.
 * `never` is the contract since objectstack#25923 — the reverse of the
 * objectui#6051 invariant this row replaces (which required every one).
 */
type FlatFaceOverlap = Extract<DeclaredKeys<GanttConfig>, DeclaredKeys<ObjectGanttSchemaTS>>;

describe('ObjectGanttSchema (TS) — the published interface declares no block key flat', () => {
  it('no GanttConfig key is declared at the top level', () => {
    // Derived, with no key list to maintain: re-declare any `GanttConfig` key on
    // the interface and this line stops compiling, NAMING the key.
    const noOverlap: FlatFaceOverlap extends never ? true : FlatFaceOverlap = true;
    expect(noOverlap).toBe(true);
  });

  it('the invariant above is not vacuous', () => {
    // 1. `DeclaredKeys` degenerating to `string` on either side would make the
    //    `Extract` meaningless.
    const notWidened: string extends DeclaredKeys<ObjectGanttSchemaTS> ? never : true = true;
    const blockNotWidened: string extends DeclaredKeys<GanttConfig> ? never : true = true;
    // 2. Both sides must really carry members: the block its spec and local keys,
    //    the interface its query keys and `gantt`.
    const blockHasSpecKeys: 'colorField' extends DeclaredKeys<GanttConfig> ? true : never = true;
    const blockHasLocalKeys: 'summaryExtent' extends DeclaredKeys<GanttConfig> ? true : never = true;
    const flatHasOwnKeys: 'gantt' | 'staticData' extends DeclaredKeys<ObjectGanttSchemaTS> ? true : never = true;
    expect([notWidened, blockNotWidened, blockHasSpecKeys, blockHasLocalKeys, flatHasOwnKeys])
      .toEqual([true, true, true, true, true]);
  });
});

describe('ObjectGanttSchema (TS) — compile-time pin on every declared query key', () => {
  it('refuses a wrong-typed value on every declared query key', () => {
    // @ts-expect-error — `staticData` is declared `any[] | undefined`.
    const staticData: ObjectGanttSchemaTS['staticData'] = { id: 1 };
    // @ts-expect-error — `filter` is declared `ViewFilterRule[] | undefined` (the
    // `object-gantt` row's own member, objectui#6152 round 10).
    const filter: ObjectGanttSchemaTS['filter'] = 'name = 1';
    // @ts-expect-error — `sort` is declared `SortConfig[] | undefined` (the legacy
    // string clause was retired in objectui#8221).
    const sort: ObjectGanttSchemaTS['sort'] = 5;

    expect([staticData, filter, sort]).toHaveLength(3);
  });

  it('accepts the well-typed value on every declared key, and the 24 inside the block', () => {
    // Counter-probe for the directives above: without this, a declaration narrowed
    // to `never` would satisfy every one of them.
    const ok: ObjectGanttSchemaTS = {
      ...MINIMAL,
      ...GOOD,
      gantt: { ...BLOCK, summaryExtent: 'self', interactions: { move: true, resize: false } },
    };
    expect(ok.gantt?.summaryExtent).toBe('self');
    expect(ok.gantt?.interactions?.resize).toBe(false);
  });

  it('refuses a flat block key on a fresh literal', () => {
    // @ts-expect-error — `summaryExtent` is no member of the published interface; write `gantt.summaryExtent`
    const flat: ObjectGanttSchemaTS = { ...MINIMAL, summaryExtent: 'self' };
    expect(flat.type).toBe('object-gantt');
  });
});

/* ── The three query keys EXIST on the flat face, with their declared type ─── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/**
 * `staticData` / `filter` / `sort` are not `GanttConfig` keys. These rows are
 * their deletion guard: an indexed access on a member that does not exist is
 * itself a compile error, and `Equal` pins each declared type.
 */
// The `any[]` below restates the member's own declared type (`staticData?: any[]` in
// `objectql.ts`); `Equal` is strict, so a narrower spelling would be red. `filter` is the
// `object-gantt` row's `ViewFilterRule` array since objectui#6152 round 10 (was `any[]`).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type _StaticDataIsDeclared = Expect<Equal<ObjectGanttSchemaTS['staticData'], any[] | undefined>>;
export type _FilterIsDeclared = Expect<Equal<ObjectGanttSchemaTS['filter'], ViewFilterRule[] | undefined>>;
export type _SortIsDeclared = Expect<Equal<ObjectGanttSchemaTS['sort'], SortConfig[] | undefined>>;
