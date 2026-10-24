/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8655 — `ObjectTreeProps.schema` is the published `object-tree` node,
 * and every key this renderer reads off it now has an ANSWER.
 *
 * ## The card's ordering, and why it is the whole point
 *
 * `ObjectTreeProps` declared `schema: any`. Two reads — `data` and
 * `navigation` — were filed as class (d), *structurally unanswerable*, ⛔ not
 * as "undeclared": `checker.getPropertyOfType` through `any` returns
 * `undefined` for `objectName`, a key this node certainly declares, exactly as
 * it does for a nonsense token. An absence returned by an instrument unable to
 * see a declaration is not a reading (objectui#8410). So the order was ① type
 * the prop, ② re-run the checker, ③ classify — and ⛔ never ③ first.
 *
 * The answerability control is pinned below and it FIRES: `Declares` answers
 * `false` for both a real member and a nonsense token when asked of `any`, and
 * separates them when asked of the node.
 *
 * ## What ② returned, and what ① surfaced on the way
 *
 * Both class-(d) reads changed status, in OPPOSITE directions, and the second
 * of them is the outcome the card warned to expect:
 *
 *   - `data` is **DECLARED** — on `BaseSchema` ("Arbitrary data attached to the
 *     component"). The `(schema as any)` at that read was hiding a declaration,
 *     not reaching past its absence, so the cast is gone. This is the same
 *     shape objectui#8655's body recorded for plugin-detail's `add`.
 *   - `navigation` was **UNDECLARED** at this card — it survived on
 *     `BaseSchema`'s `[key: string]: any` alone (declared since objectui#11168
 *     slice 3).
 *
 * ⚠️ And typing the prop made SIX more reads answerable that `any` had hidden —
 * the card calls that the expected outcome, ⛔ not scope creep. Five are
 * declared (`objectName` `parentField` `labelField` `fields`
 * `defaultExpandedDepth`); one, `filter`, is not.
 *
 * ## ③ — the family ruling, applied per key, each with its own reading
 *
 * The ruling (objectui#8327 triage): does `@objectstack/spec` declare this key,
 * and on which schema? declared ⇒ align the mirror; not declared ⇒ "declare" is
 * off the table and the exit is retire-the-read or route-to-producer.
 *
 * ⚠️ One reading governs all three, and it is measured below rather than
 * assumed: the installed `@objectstack/spec` has **no `ComponentPropsMap` entry
 * for `object-tree` at all** (nor for `tree`), while `object-calendar` and
 * `object-grid` are present. So no key can be confirmed on "the element schema
 * this node maps to" — there is none. Each verdict therefore names the schema
 * the spec DOES declare the key on, and says what follows:
 *
 *   - **`navigation` — ⛔ NOT RULED HERE.** objectui#8652's family, maintainer
 *     ruled option B (declare on the platform element schemas first, then
 *     mirror), `pm:blocked` on objectstack#17987, unlock criterion = a released
 *     spec carrying the declaration installable here. Measured: `navigation` is
 *     declared on exactly ONE element entry, `object-grid` — so the unlock has
 *     not happened. Ledgered by name, read untouched.
 *   - **`filter` — DECLARE, and ⛔ not executed on this branch.** The spec
 *     declares it on `ListView` and on four comparable `object-*` element
 *     entries; this repo's mirror declares it on every sibling node schema and
 *     omits it on this one alone. That is align-the-mirror. ⛔ It is not done
 *     here because `packages/types/src/objectql.ts` and its zod twin are held
 *     by an in-flight branch (objectui#9309), and the declared handling for
 *     that breach is to stop and report. Ledgered; the row below reddens the
 *     day it is declared, which is when this ledger should be retired.
 *     ⇒ EXECUTED by objectui#9549, in the shape objectui#9309 settled
 *     (`QueryParams['$filter']`), and the ledger entry retired with it.
 *   - **`tree` — ⛔ declare is OFF THE TABLE, and this card does not retire
 *     it.** The spec declares `tree` on the VIEW (`ListView.tree`, mirrored
 *     here as `TreeViewConfig`) and on ZERO element entries. Putting a
 *     view-level block on a node schema is not mirroring the contract, it is
 *     forking it. Retiring the read is the other exit and it needs a producer
 *     census this card cannot soundly make: producers deliver these keys by
 *     SPREADING the block flat, and a text census is structurally blind to a
 *     key arriving through a spread (objectui#8651 measured exactly that
 *     failure and had to withdraw a retirement). ⇒ routed, rung untouched.
 *
 * ## ⚠️ UPDATE at `@objectstack/spec` 17.5.0 (objectui#11073) — the readings moved
 *
 * The bump turned the three spec-reading rows below red, which is what they
 * are for. Re-measured on the installed 17.5.0:
 *
 *   - `ComponentPropsMap['object-tree']` now EXISTS — a strict entry declaring
 *     `objectName` `data` `staticData` `filter` `tree` `navigation`. There is
 *     still no `tree` entry.
 *   - `navigation` is declared on SEVEN element entries, `object-tree` and
 *     `object-calendar` among them — objectui#8652's unlock criterion ("a
 *     released spec carrying the declaration installable here") is MET. The
 *     ruled second step, mirroring it, is that card's and is ⛔ not executed by
 *     the bump, so the key stays ledgered and undeclared here.
 *   - `tree` is declared on exactly ONE element entry, `object-tree`, as the
 *     nested author face (the same block `ListViewSchema.tree` declares). The
 *     "declaring it on the node would fork" premise above has EXPIRED: declaring
 *     is now align-the-mirror. That is a new DECLARE verdict — it widens the
 *     published node — and it is ⛔ not executed by the bump either.
 *
 * The rows below pin those readings; the "stays undeclared here" rows are
 * unchanged and now mean "owed, not yet executed".
 *
 * ## ⭐ EXECUTED by objectui#11168 slice 3 — both owed verdicts
 *
 * That slice loaded `object-tree` into the repo-wide registry parity guard and
 * aligned this mirror with the 17.5.0 row: `navigation` (the spec's
 * `NavigationConfig`) and `tree` (the spec's `TreeConfig`) are declared on both
 * faces, by reference, alongside `data`, `staticData` and an optional
 * `objectName`. So the two "stays undeclared" rows below flipped to "declared",
 * the ledger of undeclared reads is EMPTY, and the renderer's `navigation` read
 * lost its cast. The flat `parentField` / `labelField` / `fields` /
 * `defaultExpandedDepth` are untouched: still declared here, still read, and
 * not declared by the spec row.
 *
 * ## The ceiling, stated so nobody reads this file as claiming more
 *
 * `BaseSchema` ended in `[key: string]: any` when this was written. Typing the
 * prop made the question ANSWERABLE; it refused nothing at the read site and
 * rejected no misspelling (objectui#5155 / objectui#7927). objectui#8347 removed
 * the signature, and the counter-probe below is flipped.
 */
/// <reference types="node" />
// ⚠️ The triple-slash reference is the route, ⛔ not an oversight. This package's
// `tsconfig.test.json` leaves `types` unset, so naming it there would switch OFF
// automatic `@types/*` inclusion for every other test in the package; the
// per-file reference registers Node's globals for this program alone. Both
// routes are documented by `scripts/tsconfig-test-parity-census.mjs`, which reads
// them off the resolved program rather than off the config text.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { ComponentPropsMap, TreeConfigSchema } from '@objectstack/spec/ui';
import {
  ObjectTreeSchema as ObjectTreeMirror,
  ObjectGridSchema as ObjectGridMirror,
  ObjectMapSchema as ObjectMapMirror,
  ObjectGanttSchema as ObjectGanttMirror,
  ObjectCalendarSchema as ObjectCalendarMirror,
  ObjectKanbanSchema as ObjectKanbanMirror,
  ObjectChartSchema as ObjectChartMirror,
  ObjectGallerySchema as ObjectGalleryMirror,
  ObjectDataTableSchema as ObjectDataTableMirror,
} from '@object-ui/types/zod';
import type { ObjectQLComponentSchema } from '@object-ui/types';

import type { ObjectTreeProps } from './ObjectTree';

// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');
const TREE_READER = 'packages/plugin-tree/src/ObjectTree.tsx';

/**
 * The node spelled INDEPENDENTLY of the renderer: narrowed off the published
 * union, here and only here. ⭐ A deliberate SECOND spelling, kept on purpose —
 * `ObjectTree.tsx` imports `ObjectTreeSchema` by name as of objectui#9550, so the
 * ① row below is a CONSUMER-SIDE proof that the named import and the union arm
 * are one declaration. ⛔ Do not "tidy" this into the same import the renderer
 * uses: two independently written spellings that must agree IS the assertion, and
 * one spelling agreeing with itself asserts nothing.
 */
type ObjectTreeNode = Extract<ObjectQLComponentSchema, { type: 'object-tree' }>;

/** A key nothing reads and nothing declares — the both-ways control. */
const CONTROL_KEY = 'zzplTreeAbsentControl8655' as const;

/**
 * ③'s answers that are still UNDECLARED, by name. Every entry is asserted STILL
 * READ below: a ledger whose subject has gone is a hole, not an exemption
 * (objectui#8885). `filter` left this ledger when objectui#9549 executed its
 * declare verdict, and `navigation` and `tree` left it when objectui#11168
 * slice 3 executed theirs — each is a member of the mirror's shape now, so the
 * population row below counts it as declared rather than exempt. EMPTY: every
 * key the renderer reads off the node is declared.
 */
const LEDGERED_UNDECLARED: readonly string[] = [];

/* ── Instruments ──────────────────────────────────────────────────────────── */

function readRepo(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

/**
 * Every key read off the schema node, in EITHER spelling — the bare
 * `schema.KEY` and the cast `(schema as any).KEY`. Both spell the same FACT,
 * and reading the fact rather than the spelling is what stops these verdicts
 * reddening when a cast is removed (objectui#8832). Borrowed verbatim from
 * `plugin-calendar`'s `calendarUnionReads-8651` census.
 */
const SCHEMA_READ = /(?:\bschema\b|\(\s*schema\s+as\s+[^)]*\))\s*\.\s*([A-Za-z_$][\w$]*)/g;

function schemaReads(source: string): Set<string> {
  return new Set([...source.matchAll(SCHEMA_READ)].map((m) => m[1]));
}

/** The renderer's reads, with prose masked so a key named only in a comment cannot vote. */
function rendererReads(): Set<string> {
  return schemaReads(mask(readRepo(TREE_READER)));
}

/** Declared membership, off a mirror's OWN shape — never off parse acceptance. */
function shapeKeys(schema: unknown): string[] {
  return Object.keys((schema as { shape: Record<string, unknown> }).shape);
}

/**
 * ⚠️ `ComponentPropsMap` entries are read through `Record<string, any>` on
 * purpose: `_def` is a zod INTERNAL for which the spec publishes no type, so a
 * hand-written shape for it would be a local assertion about a third-party
 * runtime that nothing re-checks. Same decision as objectui#8651's pin.
 */
function specElementKeys(type: string): string[] | null {
  const entry = (ComponentPropsMap as unknown as Record<string, any>)[type];
  if (!entry?._def) return null;
  const def = entry._def;
  const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
  if (!shape || typeof shape !== 'object') return null;
  return Object.keys(shape);
}

function specElementsDeclaring(key: string): string[] {
  return Object.keys(ComponentPropsMap as unknown as Record<string, unknown>)
    .filter((type) => (specElementKeys(type) ?? []).includes(key))
    .sort();
}

/* ── Compile-time pins (compiled by `tsc -p tsconfig.test.json`) ───────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;
/** The canonical `any` detector: only `any` absorbs `1 &` down to something `0` extends. */
type IsAny<T> = 0 extends (1 & T) ? true : false;

/**
 * ⭐ THE instrument of this card, at the type level: the DECLARED member names
 * of `T`, with any index signature removed by key remapping. `keyof` alone
 * could not answer while `BaseSchema` ended in `[key: string]: any` (until
 * objectui#8347): `keyof` of any node schema was `string | number` and every
 * token "extends" it. That is the
 * same blindness `checker.getPropertyOfType` avoids by returning a SYMBOL only
 * for a real member, and this is its compile-time twin.
 */
type DeclaredKeys<T> = keyof {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};
type Declares<T, K extends PropertyKey> = K extends DeclaredKeys<T> ? true : false;

/** ① — the prop is the published node, equal to the union arm, and it is not `any`. */
export type _PropIsThePublishedNode = Expect<Equal<ObjectTreeProps['schema'], ObjectTreeNode>>;
export type _PropIsNotAnyAnyMore = Expect<Equal<IsAny<ObjectTreeProps['schema']>, false>>;
/** The `Equal` helper can FAIL — synthetic control, so the two rows above count. */
export type _EqualCanFail = Expect<Equal<Equal<any, ObjectTreeNode>, false>>;

/**
 * ⭐ THE ANSWERABILITY CONTROL, and it is the card's whole argument in two
 * lines. Asked of `any`, the instrument gives the SAME answer for a member the
 * node certainly declares and for a nonsense token — which is why the
 * pre-objectui#8655 reading was "unknown", ⛔ never "undeclared".
 */
export type _ThroughAnyARealMemberIsUnanswerable =
  Expect<Equal<Declares<any, 'objectName'>, false>>;
export type _ThroughAnyANonsenseTokenReadsTheSame =
  Expect<Equal<Declares<any, typeof CONTROL_KEY>, false>>;
/** …and asked of the NODE, the same instrument separates them. */
export type _OnTheNodeARealMemberIsDeclared = Expect<Declares<ObjectTreeNode, 'objectName'>>;
export type _OnTheNodeANonsenseTokenIsNot =
  Expect<Equal<Declares<ObjectTreeNode, typeof CONTROL_KEY>, false>>;

/** ② — the per-key readings, one row per key, ⛔ no verdict by analogy. */
export type _DataIsDeclared = Expect<Declares<ObjectTreeNode, 'data'>>;
export type _ObjectNameIsDeclared = Expect<Declares<ObjectTreeNode, 'objectName'>>;
export type _ParentFieldIsDeclared = Expect<Declares<ObjectTreeNode, 'parentField'>>;
export type _LabelFieldIsDeclared = Expect<Declares<ObjectTreeNode, 'labelField'>>;
export type _FieldsIsDeclared = Expect<Declares<ObjectTreeNode, 'fields'>>;
export type _DefaultExpandedDepthIsDeclared =
  Expect<Declares<ObjectTreeNode, 'defaultExpandedDepth'>>;
/** Declared by objectui#11168 slice 3 — the spec's `NavigationConfig`, by reference. */
export type _NavigationIsDeclared = Expect<Declares<ObjectTreeNode, 'navigation'>>;
/** Declared by objectui#9549 — the `filter` DECLARE verdict below, executed. */
export type _FilterIsDeclared = Expect<Declares<ObjectTreeNode, 'filter'>>;
/** Declared by objectui#11168 slice 3 — the spec's `TreeConfig`, by reference. */
export type _TreeIsDeclared = Expect<Declares<ObjectTreeNode, 'tree'>>;
/** …and the record-source rungs the 17.5.0 row declares beside it. */
export type _StaticDataIsDeclared = Expect<Declares<ObjectTreeNode, 'staticData'>>;

/**
 * THE CEILING, as it was: an undeclared key compiled and typed `any`, so
 * declaring bought VALUE typing and never refusal of a misspelling. objectui#8347
 * removed `BaseSchema`'s index signature, so the control key and the typo are
 * no members now, and a declared key (`navigation`, since objectui#11168 slice
 * 3) still resolves to its own type, not `any`.
 */
export type _UndeclaredIsNoMember = Expect<Equal<typeof CONTROL_KEY extends keyof ObjectTreeNode ? true : false, false>>;
export type _DeclaredNoLongerResolvesToAny = Expect<Equal<IsAny<ObjectTreeNode['navigation']>, false>>;
export type _MisspellingIsNoMember = Expect<Equal<'objectNaem' extends keyof ObjectTreeNode ? true : false, false>>;
/** Lit control for the detector: `IsAny` does answer `true`, so the line above is a reading. */
export type _IsAnyCanAnswerTrue = Expect<IsAny<any>>;

/** The node still type-checks the way a host writes it, with no cast. */
const node: ObjectTreeProps['schema'] = {
  type: 'object-tree',
  objectName: 'duly_task',
  parentField: 'parent_id',
  labelField: 'name',
  fields: ['owner'],
  defaultExpandedDepth: 1,
};

/* ── 1. Non-vacuity: the instruments can see the tree ──────────────────────── */

describe('objectui#8655 — the instruments are reading something (guards every row below)', () => {
  it('the read census sees the renderer, and invents nothing', () => {
    const reads = rendererReads();
    expect(reads.size).toBeGreaterThan(5);
    expect([...reads]).toContain('objectName');
    expect(reads.has(CONTROL_KEY)).toBe(false);
  });

  it('the census fires on BOTH spellings, so a cast removal cannot mute it', () => {
    const probe = schemaReads('const a = schema.alphaKey; const b = (schema as any).betaKey;');
    expect([...probe].sort()).toEqual(['alphaKey', 'betaKey']);
  });

  it('the mirror shape is a real set, not everything', () => {
    expect(shapeKeys(ObjectTreeMirror)).toContain('parentField');
    expect(shapeKeys(ObjectTreeMirror)).not.toContain(CONTROL_KEY);
  });

  it('the spec reader resolves entries that exist and refuses one that does not', () => {
    expect(specElementKeys('object-grid')).toContain('objectName');
    expect(specElementKeys(CONTROL_KEY)).toBeNull();
  });

  it('the type-face literal is real', () => {
    expect(node.type).toBe('object-tree');
  });
});

/* ── 2. The population: every read is declared, or ledgered by name ─────────── */

describe('objectui#8655 — every key read off the node is declared, or ledgered', () => {
  it('no read is undeclared outside the ledgered keys', () => {
    const reads = rendererReads();
    const declared = new Set(shapeKeys(ObjectTreeMirror));
    const exempt = new Set<string>(LEDGERED_UNDECLARED);
    const undeclared = [...reads]
      .filter((key) => !declared.has(key))
      .filter((key) => !exempt.has(key))
      .sort();
    expect(undeclared, `undeclared reads on the object-tree node: ${undeclared.join(', ')}`)
      .toEqual([]);
  });

  it('the ledger is not stale: every carve-out is STILL READ', () => {
    const reads = rendererReads();
    for (const key of LEDGERED_UNDECLARED) {
      expect([...reads], `${key} is ledgered but no longer read — the exception is a hole`)
        .toContain(key);
    }
  });

  it('`data` is declared — the class-(d) read that changed direction', () => {
    // The card warned to expect this: on plugin-detail the same prerequisite
    // turned one apparently-undeclared key into a declared one. Here it is
    // `data`, declared on `BaseSchema` and reached through the mirror's own
    // shape rather than through parse acceptance.
    expect(shapeKeys(ObjectTreeMirror)).toContain('data');
  });
});

/* ── 3. ③ — the spec readings each verdict rests on ────────────────────────── */

describe('objectui#8655 — the spec has no element schema for this node', () => {
  it('an `object-tree` entry since 17.5.0, and still no `tree` entry (controls: two that ARE there)', () => {
    // `toBeNull()` through 17.4.0; the bump turned it red (objectui#11073).
    expect(specElementKeys('object-tree')?.sort()).toEqual([
      'data',
      'filter',
      'navigation',
      'objectName',
      'staticData',
      'tree',
    ]);
    expect(specElementKeys('tree')).toBeNull();
    // FIRING CONTROLS on those two nulls — without them a broken reader and a
    // real absence give the same answer.
    expect(specElementKeys('object-calendar')).toBeTruthy();
    expect(specElementKeys('object-grid')).toBeTruthy();
  });
});

describe('objectui#8655 — `navigation` is objectui#8652\'s, its unlock HAS happened, and objectui#11168 mirrored it', () => {
  it('the spec declares it on seven element entries since 17.5.0, this one included, and on the `list-view` row', () => {
    // Through 17.4.0: ONE entry, `object-grid`, and not this one. 17.5.0 met
    // objectui#8652's unlock criterion (objectui#11073); mirroring is that
    // card's ruled second step. The spec after 18.0.0-next.3 gives `list-view`
    // a `ComponentPropsMap` row (objectstack#22444), the list view's own
    // schema, which carries the view-level `navigation` (objectui#12971).
    expect(specElementsDeclaring('navigation')).toEqual([
      'list-view',
      'object-calendar',
      'object-gantt',
      'object-grid',
      'object-kanban',
      'object-map',
      'object-timeline',
      'object-tree',
    ]);
  });

  it('and the mirror declares it now — objectui#11168 slice 3 executed the ruled second step', () => {
    // This row stood as `not.toContain` while the mirroring was owed.
    expect(shapeKeys(ObjectTreeMirror)).toContain('navigation');
  });
});

describe('objectui#8655 — `filter` is the one DECLARE verdict, executed by objectui#9549', () => {
  it('the spec declares it on the comparable `object-*` element faces', () => {
    const declaring = specElementsDeclaring('filter');
    for (const el of ['object-grid', 'object-kanban', 'object-calendar', 'object-metric']) {
      expect(declaring, `${el} should declare filter`).toContain(el);
    }
  });

  it('every sibling node mirror in THIS repo declares it — and now this one does too', () => {
    // The align-the-mirror ground, re-derived rather than written down.
    const siblings: [string, unknown][] = [
      ['ObjectGridSchema', ObjectGridMirror],
      ['ObjectMapSchema', ObjectMapMirror],
      ['ObjectGanttSchema', ObjectGanttMirror],
      ['ObjectCalendarSchema', ObjectCalendarMirror],
      ['ObjectKanbanSchema', ObjectKanbanMirror],
      ['ObjectChartSchema', ObjectChartMirror],
      ['ObjectGallerySchema', ObjectGalleryMirror],
      ['ObjectDataTableSchema', ObjectDataTableMirror],
    ];
    for (const [name, mirror] of siblings) {
      expect(shapeKeys(mirror), `${name} should declare filter`).toContain('filter');
    }
    // This row was the LEDGER while the verdict was unexecuted. objectui#9549
    // declared the key on both faces and retired the ledger entry in the same
    // change, so the row now pins the declaration instead.
    expect(shapeKeys(ObjectTreeMirror)).toContain('filter');
  });
});

describe('objectui#8655 — `tree` was a VIEW-level block, and since 17.5.0 the node\'s own (declared by objectui#11168)', () => {
  it('the spec declares the block, and its members are the four this resolver reads', () => {
    const blockKeys = Object.keys(
      (TreeConfigSchema as unknown as { shape: Record<string, unknown> }).shape,
    ).sort();
    expect(blockKeys).toEqual(['defaultExpandedDepth', 'fields', 'labelField', 'parentField']);
  });

  it('…and ONE element face declares a `tree` key since 17.5.0 — this node\'s — beside the `list-view` row (control: one key that IS on four)', () => {
    // `[]` through 17.4.0. The premise this describe is named for expired at
    // the bump (objectui#11073): see the UPDATE note in this file's header.
    // The `list-view` row the spec gained after 18.0.0-next.3 (objectstack#22444)
    // is the list view's own schema, so its `tree` IS the view-level block this
    // describe is named for, not a second element face (objectui#12971).
    expect(specElementsDeclaring('tree')).toEqual(['list-view', 'object-tree']);
    // FIRING CONTROL on that zero, same instrument, same corpus.
    expect(specElementsDeclaring('filter').length).toBeGreaterThan(3);
  });

  it('so the mirror declares it — objectui#11168 slice 3 executed the DECLARE verdict', () => {
    // This row stood as `not.toContain` while the verdict was owed.
    expect(shapeKeys(ObjectTreeMirror)).toContain('tree');
  });
});

/* ── 4. The ceiling, at runtime as well as at compile time ─────────────────── */

describe('objectui#8655 — the objectui#7927 ceiling is UNCHANGED', () => {
  it('a misspelled key still rides through the mirror', () => {
    const base = { type: 'object-tree', objectName: 'duly_task' };
    expect(ObjectTreeMirror.safeParse({ ...base, parentFeild: 'parent_id' }).success).toBe(true);
    // CONTROL: the mirror is not simply accepting everything — a declared key
    // with the wrong VALUE type is refused.
    expect(ObjectTreeMirror.safeParse({ ...base, parentField: 42 }).success).toBe(false);
    expect(ObjectTreeMirror.safeParse(base).success).toBe(true);
  });
});
