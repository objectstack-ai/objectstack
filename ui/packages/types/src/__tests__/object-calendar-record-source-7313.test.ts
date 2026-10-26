/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#7313 — `ObjectCalendarSchema` declares the record-source ladder its
 * renderer already reads, on both faces, in the shape objectui#6939 landed on
 * `object-map` / `object-gantt` (PR #7471).
 *
 * ## The defect
 *
 * `ObjectCalendar` resolves its records through the shared ladder —
 * `resolveRecordSourceConfig(schema)` in `@object-ui/core`
 * (`packages/core/src/utils/record-source.ts`): `data`, then `staticData`, then
 * `objectName`, `null` when none is present. The published interface REQUIRED
 * `objectName` and declared neither `data` nor `staticData`; the mirror did the
 * same (no `requireRecordSource`). So the two static-data examples
 * `content/docs/plugins/plugin-calendar.mdx` teaches rendered correctly, were
 * refused by `safeValidateSchema`, and could not be annotated with their own
 * type (`TS2741: Property 'objectName' is missing`).
 *
 * Measured on `origin/main` at `91f92768` (identical to the dispatch base
 * `4dfdcc3c` on both faces), pristine dist, four documents through
 * `ObjectCalendarSchema.safeParse`:
 *
 *     staticData only  -> refused at `objectName` (invalid_type)
 *     data only        -> refused at `objectName` (invalid_type)
 *     none of the three-> refused at `objectName` (invalid_type)
 *     objectName only  -> accepted
 *
 * `ObjectGanttSchema` on the same four: accepted / accepted / refused ON THE
 * REFINEMENT / accepted. This file pins that the calendar now agrees with the
 * gantt verdict-for-verdict, and WHY each verdict is what it is.
 *
 * ## What this file pins — the VALIDATOR and DECLARATION halves
 *
 * The render half needs no new pin: the renderer never changed. The read it
 * performs is pinned off disk below, so a later rewrite of the ladder cannot
 * leave this declaration describing a read that no longer exists.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// objectui#9239 — the PROTOCOL's own row, read directly so the pins below
// measure it rather than restate it. `@objectstack/spec` is a declared
// dependency of this package; `ComponentPropsMap` is its published UI surface.
import { ComponentPropsMap } from '@objectstack/spec/ui';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

import { ObjectCalendarSchema, ObjectGanttSchema, safeValidateSchema } from '../zod/index.zod';
import { BaseSchema } from '../zod/base.zod';
import type {
  ObjectCalendarSchema as TsObjectCalendarSchema,
  ObjectGanttSchema as TsObjectGanttSchema,
  ObjectKanbanSchema as TsObjectKanbanSchema,
  ViewData,
} from '../objectql';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const RENDERER = 'packages/plugin-calendar/src/ObjectCalendar.tsx';
const LADDER = 'packages/core/src/utils/record-source.ts';
const DOC_PAGE = 'content/docs/plugins/plugin-calendar.mdx';

/* ── Type-level pins (invariant equality, house form) ─────────────────────── */

type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Expect< T extends true > = T;
/** `Partial< Pick< T, K > >` is assignable to `Pick< T, K >` exactly when `K` is optional on `T`. */
type IsOptionalKey< T, K extends keyof T > = Partial< Pick< T, K > > extends Pick< T, K > ? true : false;

/**
 * `objectName` is OPTIONAL and still `string`. Both directions bite: required
 * again -> `string` is not `string | undefined` -> red; member DELETED -> the
 * indexed access stops compiling -> red (until objectui#8347 the key resolved
 * through `BaseSchema`'s index signature to `any`, and `Equal< any, … >` was
 * false -> red).
 */
export type _CalendarObjectNameIsOptionalString =
  Expect< Equal< TsObjectCalendarSchema['objectName'], string | undefined > >;
export type _CalendarObjectNameIsOptionalKey =
  Expect< IsOptionalKey< TsObjectCalendarSchema, 'objectName' > >;

/**
 * `data` is DECLARED, optional, and the ARRAY of PRE-FETCHED RECORDS the
 * protocol's row declares — not `any`, and ⛔ no longer `ViewData`
 * (objectui#9239). Deleting the member does NOT fall through to the index
 * signature: it lands on the INHERITED `BaseSchema.data?: any` (a declared
 * member wins over an index signature), and `Equal< any, … >` is false -> red.
 * That is the whole reason the member is declared here rather than left to the
 * base.
 *
 * The shape is written out rather than re-derived from the spec, deliberately:
 * the declaration DERIVES `ComponentPropsMap['object-calendar'].data`
 * (`z.array(z.unknown()).optional()` on `@objectstack/spec` 17.4.0), so a
 * protocol move would silently re-shape this repository's published type. This
 * row is what makes such a move LOUD instead.
 */
export type _CalendarDataIsOptionalRecordArray =
  Expect< Equal< TsObjectCalendarSchema['data'], unknown[] | undefined > >;
export type _CalendarDataIsOptionalKey =
  Expect< IsOptionalKey< TsObjectCalendarSchema, 'data' > >;

/** `staticData` is DECLARED and optional; deleted, it would resolve to `any`. */
export type _CalendarStaticDataIsOptionalAnyArray =
  Expect< Equal< TsObjectCalendarSchema['staticData'], any[] | undefined > >;
export type _CalendarStaticDataIsOptionalKey =
  Expect< IsOptionalKey< TsObjectCalendarSchema, 'staticData' > >;

/**
 * One concept, one type — for TWO of the three keys now. Each was RE-CHECKED
 * individually when `data` left this set (objectui#9239), ⛔ not deleted by
 * association with it: `staticData` is `any[] | undefined` on both members and
 * `objectName` is `string | undefined` on both, so both rows still hold and
 * still bite.
 */
export type _CalendarStaticDataMatchesGantt =
  Expect< Equal< TsObjectCalendarSchema['staticData'], TsObjectGanttSchema['staticData'] > >;
export type _CalendarObjectNameMatchesGantt =
  Expect< Equal< TsObjectCalendarSchema['objectName'], TsObjectGanttSchema['objectName'] > >;

/**
 * ⭐ …and `data` is pinned as DIFFERENT, which is objectui#9239's whole subject.
 * A bare deletion of the old equality would have left the divergence unwitnessed
 * — nothing would notice the two keys silently converging again — so the row is
 * INVERTED rather than removed, and BOTH sides are named below so the inversion
 * cannot be satisfied by the wrong member moving.
 *
 * `object-calendar` carries the protocol's ARRAY arm
 * (`ComponentPropsMap['object-calendar'].data`); `object-gantt` has no
 * `ComponentPropsMap` row at all, so the published row that governs it is this
 * package's own `ViewDataSchema.optional()` and it STAYS. ⛔ Do not "fix" this
 * pin by moving the gantt.
 */
export type _CalendarDataDiffersFromGantt =
  Expect< Equal< Equal< TsObjectCalendarSchema['data'], TsObjectGanttSchema['data'] >, false > >;
export type _GanttDataIsStillOptionalViewData =
  Expect< Equal< TsObjectGanttSchema['data'], ViewData | undefined > >;

/**
 * The document the plugin page teaches under "With Static Data". It did not
 * compile before this card — `objectName` was a required member, and an index
 * signature cannot rescue a MISSING required key — so this annotation is a real
 * compile-time pin.
 */
export const STATIC_DATA_DOCUMENT: TsObjectCalendarSchema = {
  type: 'object-calendar',
  staticData: [{ id: 1, title: 'Team Meeting', startDate: '2024-01-15T10:00:00' }],
};

/**
 * …and the `data`-authored one, typed against the declared ARRAY of pre-fetched
 * records (objectui#9239). The provider-block spelling this literal used to
 * carry is now a compile error here, which is the declaration half of the fix.
 */
export const DATA_DOCUMENT: TsObjectCalendarSchema = {
  type: 'object-calendar',
  data: [{ id: 1, title: 'Team Meeting' }],
};

/**
 * CLASS BOUNDARY — and it MOVED. This literal used to carry a
 * `@ts-expect-error` reading "objectName is still required on
 * ObjectKanbanSchema", recorded here by objectui#7313 as the one deliberate
 * error in this file, with the note "when a card moves the kanban's
 * `objectName` to optional, this directive is the line that card deletes".
 * objectui#7780 is that card, and this is that deletion: the directive is gone
 * and the literal now compiles, which is the assertion — an unused
 * `@ts-expect-error` is `TS2578`, so leaving it would have reddened
 * `tsconfig.test.json` rather than quietly meaning nothing.
 *
 * ⚠️ It is NOT the same fix as this file's own subject. `object-calendar`
 * joined the `object-map` / `object-gantt` ladder — `data` → `staticData` →
 * `objectName`, `requireRecordSource`. (What `data` ADMITS diverged later:
 * objectui#9239 put the calendar's rung on the protocol's ARRAY arm while the
 * map's and the gantt's stay `ViewData` provider blocks. The LADDER is what is
 * shared, not the arm.) The
 * kanban board walks its own: pre-fetched `data` prop → `bind` → an inline ROW
 * ARRAY on `data` → `objectName`, with no `staticData` rung, and objectui#7651
 * (ruled B, closed `not_planned`) refuses giving it the shared one. Its
 * refinement is `requireRecordSource` with that board's own rung list
 * (objectui#11117; until then a hand copy, `requireKanbanRecordSource`), and
 * the verdict table lives in `object-kanban-record-source-7780.test.ts`.
 *
 * `groupBy` is still supplied, and now for a second reason as well as the
 * first: objectui#7322 made it the required lane key, so it was the only way
 * `objectName` could be the ONE member this literal was missing — and
 * objectui#7780 deliberately did NOT touch it, so this literal also witnesses
 * that a record source and a lane key stayed different questions.
 */
export const KANBAN_NO_LONGER_REQUIRES_OBJECT_NAME: TsObjectKanbanSchema = {
  type: 'object-kanban',
  groupBy: 'status',
};

/* ── Runtime pins ─────────────────────────────────────────────────────────── */

/**
 * ⭐ The `data` rung's VALUE, per member — the one thing the two ladders stopped
 * sharing (objectui#9239). The LADDER is still shared (`requireRecordSource`
 * asks only whether a rung is present, `!== undefined`, whatever its kind); what
 * each member's published `data` row ADMITS is not:
 *
 *  - `object-calendar` — `ComponentPropsMap['object-calendar'].data` is
 *    `z.array(z.unknown()).optional()`, an ARRAY of pre-fetched records.
 *  - `object-gantt` — no `ComponentPropsMap` row exists, so its published row is
 *    this package's own `ViewDataSchema.optional()`: a PROVIDER BLOCK.
 */
const DATA_ARM = {
  'object-calendar': [{ id: 1, title: 'Team Meeting' }],
  'object-gantt': { provider: 'value', items: [{ id: 1, title: 'Team Meeting' }] },
} as const;
type LadderMember = keyof typeof DATA_ARM;

/**
 * The four documents the card's verdict table is written over, on the CALENDAR's
 * arm. Before objectui#9239 `dataOnly` was the value-provider config — the one
 * `staticData` is folded into — so the two accepted-without-`objectName` rows
 * exercised different keys but one route. They still exercise different keys;
 * the route is now literally different too, which is the point of that card.
 */
const DOCUMENTS = {
  staticOnly: { staticData: [{ id: 1, title: 'Team Meeting', startDate: '2024-01-15T10:00:00' }] },
  dataOnly: { data: DATA_ARM['object-calendar'] },
  none: {},
  objectOnly: { objectName: 'events' },
} as const;
type DocumentName = keyof typeof DOCUMENTS;
const DOCUMENT_NAMES = Object.keys(DOCUMENTS) as DocumentName[];

/** The refinement's message, spelled exactly as the map/gantt members emit it. */
const REFUSAL_MESSAGE = '`object-calendar` has no record source: declare one of `data`, `staticData` or `objectName`, or name the object in `dataSource.object`';

function withType(type: string, name: DocumentName): Record<string, unknown> {
  return { type, ...DOCUMENTS[name] };
}

/**
 * The same four documents with the `data` rung on the arm THAT member's own
 * published row declares (objectui#9239). Used by the gantt parity block below,
 * which measures the LADDER — had it kept feeding one arm to both members, the
 * gantt would refuse `dataOnly` by KIND and the comparison would read as a
 * ladder divergence that does not exist.
 */
function withArm(type: LadderMember, name: DocumentName): Record<string, unknown> {
  return name === 'dataOnly' ? { type, data: DATA_ARM[type] } : withType(type, name);
}

/** Report the issues rather than `false`, so a red run says what broke. */
function reasons(schema: unknown): string[] {
  const r = safeValidateSchema(schema);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
}

describe('objectui#7313 — the four documents, through the member and the published entry point', () => {
  it('`staticData` alone validates — the route the plugin page documents twice', () => {
    const doc = withType('object-calendar', 'staticOnly');
    expect('objectName' in doc).toBe(false);
    expect(ObjectCalendarSchema.safeParse(doc).success).toBe(true);
    expect(reasons(doc)).toEqual([]);
  });

  it('`data` alone validates', () => {
    const doc = withType('object-calendar', 'dataOnly');
    expect(ObjectCalendarSchema.safeParse(doc).success).toBe(true);
    expect(reasons(doc)).toEqual([]);
  });

  it('`objectName` alone still validates — the accept set only WIDENED, an empty name included', () => {
    expect(ObjectCalendarSchema.safeParse(withType('object-calendar', 'objectOnly')).success).toBe(true);
    expect(reasons(withType('object-calendar', 'objectOnly'))).toEqual([]);
    // Presence is `!== undefined`, not the renderer's truthiness: `objectName:
    // ''` validated before this card (a required `z.string()` accepts '') and
    // must still validate, or the change would narrow something.
    expect(ObjectCalendarSchema.safeParse({ type: 'object-calendar', objectName: '' }).success).toBe(true);
  });

  it('NONE of the three is refused ON THE REFINEMENT — by name, not at `objectName`', () => {
    const result = ObjectCalendarSchema.safeParse(withType('object-calendar', 'none'));
    expect(result.success).toBe(false);
    if (result.success) return;
    // Exactly one issue, and it is the refinement's — not the `objectName`
    // key-level failure this document used to get, which would make this case
    // green for the wrong reason.
    expect(result.error.issues).toHaveLength(1);
    const issue = result.error.issues[0];
    expect(issue.code).toBe('custom');
    expect(issue.path).toEqual([]);
    expect((issue as { params?: { code?: string } }).params?.code).toBe('RECORD_SOURCE_REQUIRED');
    expect(issue.message).toBe(REFUSAL_MESSAGE);
  });

  it('…and the published entry point refuses it too, with the same message', () => {
    const r = safeValidateSchema({ type: 'object-calendar' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.map((i) => i.message)).toContain(REFUSAL_MESSAGE);
  });
});

describe('objectui#7313 — parity with `ObjectGanttSchema`, verdict for verdict', () => {
  const verdicts = (member: { safeParse: (v: unknown) => { success: boolean } }, type: LadderMember) =>
    DOCUMENT_NAMES.map((name) => member.safeParse(withArm(type, name)).success);

  it('the two members agree on all four documents, and the vector is not vacuous', () => {
    const calendar = verdicts(ObjectCalendarSchema, 'object-calendar');
    const gantt = verdicts(ObjectGanttSchema, 'object-gantt');
    expect(calendar).toEqual(gantt);
    // Non-vacuity: a pair that accepted everything, or refused everything,
    // would "agree" too. The vector must carry BOTH verdicts, and in the
    // positions the card's table names.
    expect(new Set(calendar).size).toBe(2);
    expect(calendar).toEqual([true, true, false, true]);
  });

  it('the refusal is the same issue on both members, differing only in the member name', () => {
    const c = ObjectCalendarSchema.safeParse({ type: 'object-calendar' });
    const g = ObjectGanttSchema.safeParse({ type: 'object-gantt' });
    expect(c.success).toBe(false);
    expect(g.success).toBe(false);
    if (c.success || g.success) return;
    const strip = (m: string) => m.replace(/`object-(calendar|gantt)`/, '`object-MEMBER`');
    expect(strip(c.error.issues[0].message)).toBe(strip(g.error.issues[0].message));
    expect((c.error.issues[0] as { params?: { code?: string } }).params?.code)
      .toBe((g.error.issues[0] as { params?: { code?: string } }).params?.code);
  });

  it('control: `BaseSchema` accepts all four — the refusal above is the refinement\'s, not the base\'s', () => {
    // `BaseSchema` is `.passthrough()` with no record-source refinement, so it
    // takes every one of these documents. Only the member refuses `none`.
    for (const name of DOCUMENT_NAMES) {
      expect(BaseSchema.safeParse(withType('object-calendar', name)).success).toBe(true);
    }
  });
});

describe('objectui#7313 — `data` and `staticData` are DECLARED, not passthrough holes', () => {
  it('a wrong-typed `data` is refused AT the key; `objectName` is supplied so only `data` is under test', () => {
    const r = ObjectCalendarSchema.safeParse({ type: 'object-calendar', objectName: 'events', data: 'nope' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path[0])).toContain('data');
    // ⭐ objectui#9239 — the PROVIDER BLOCK is a wrong-typed `data` now too. This
    // line asserted `success: true` until that card, and it was the mirror's half
    // of the divergence: the protocol refused this document by kind while this
    // published face called it valid. `objectName` is supplied, so the refusal
    // below can only be the KEY's — the refinement is satisfied either way.
    const block = ObjectCalendarSchema.safeParse({ type: 'object-calendar', objectName: 'events', data: { provider: 'object', object: 'events' } });
    expect(block.success).toBe(false);
    if (!block.success) expect(block.error.issues.map((i) => i.path[0])).toContain('data');
    // …and the ARRAY of pre-fetched records is what the key admits instead.
    expect(ObjectCalendarSchema.safeParse({ type: 'object-calendar', objectName: 'events', data: DATA_ARM['object-calendar'] }).success).toBe(true);
  });

  it('a wrong-typed `staticData` is refused AT the key', () => {
    const r = ObjectCalendarSchema.safeParse({ type: 'object-calendar', objectName: 'events', staticData: 'nope' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path[0])).toContain('staticData');
  });

  it('control: `BaseSchema` alone would have admitted both — delete either member and its refusal becomes this', () => {
    expect(BaseSchema.safeParse({ type: 'object-calendar', objectName: 'events', data: 'nope' }).success).toBe(true);
    expect(BaseSchema.safeParse({ type: 'object-calendar', objectName: 'events', staticData: 'nope' }).success).toBe(true);
  });

  it('the object stayed an object: `.shape` is exposed, with the three keys in it and `objectName` optional', () => {
    // zod 4 attaches a refinement in place; had it wrapped the object, `.shape`
    // would be gone and the parity census in `zod-mirror-parity.test.ts` would
    // read the pair as vacuous.
    const shape = (ObjectCalendarSchema as unknown as { shape: Record<string, { safeParse: (v: unknown) => { success: boolean } }> }).shape;
    expect(Object.keys(shape)).toEqual(expect.arrayContaining(['objectName', 'data', 'staticData']));
    expect(shape.objectName.safeParse(undefined).success).toBe(true);
    expect(shape.objectName.safeParse(5).success).toBe(false);
  });
});

/* ── objectui#9676 — the plugin page's `object-calendar` literals, ENUMERATED ── */

/**
 * objectui#9676 — the TOTAL property in this file ("no bare `object-calendar`
 * literal is left unannotated on the page") used to be carried by a single
 * pattern, `/^const \w+ = \{\n\s+type: 'object-calendar'/gm` asserted
 * `.toBeNull()`, and that pattern could not fail for most of the class it named.
 * Four samples through it, re-measured on this branch before the repair:
 *
 *     column 0, discriminant first       -> MATCHES
 *     the same text indented by two      -> null
 *     column 0, discriminant SECOND      -> null
 *     indented, NO discriminant at all   -> null
 *
 * Rows two and three are the two blindnesses the card names: `^` under the `m`
 * flag anchors at column 0, so a literal declared inside a function is invisible;
 * and the pattern required the discriminant to be the literal's FIRST member.
 *
 * ⭐ Row four is why this row is an ENUMERATION and not a wider regex. The anchor
 * and the member-order requirement are both loosenable, but a literal that omits
 * the discriminant ENTIRELY — the failure mode the page's own prose is about — is
 * invisible to ANY pattern keyed on `type: 'object-calendar'`, at every anchor
 * and in every member order. Widening the pattern would have left the class open
 * while reading as a repair. The specimen that proves it is historical now:
 * `MyObjectCalendar`'s `const schema = { objectName: 'events', … }` sat indented
 * and discriminant-less inside this pin's own input from objectui#7313 until PR
 * objectui#9678 annotated it, and the pin read green for every day of that.
 *
 * So the population is read off the page rather than matched. Every
 * `const NAME = { … }` declaration inside a fence is brace-matched out, then
 * classified as an `object-calendar` literal by either of two INDEPENDENT
 * signals, so that neither one alone can hide a member of the class:
 *
 *   S1  it carries `type: 'object-calendar'` among its OWN members, at any
 *       indentation and in any position — rows one through three;
 *   S2  it is handed to an `<ObjectCalendar …>` element as that element's
 *       `schema` prop — row four, which S1 structurally cannot reach.
 *
 * Scope is the FENCE, not the page. `schema` is declared five times on this page
 * in five separate blocks, so a page-wide name match would read the
 * `calendar-view` fragment's `const schema` as the one `<ObjectCalendar>`
 * consumes and go red on a healthy page.
 *
 * ⚠️ WHERE THIS STILL CANNOT FAIL — written down rather than left to be assumed
 * (AGENTS.md #9, and the reason this card exists at all): a literal carrying
 * NEITHER the discriminant NOR an `<ObjectCalendar>` consumption inside its own
 * fence remains invisible. Nothing in the page text identifies such a literal as
 * an `object-calendar`, so that is the BOUNDARY of the claim, not a gap in the
 * reading — and the row below is named to that boundary rather than to a wider
 * one. The row that follows it feeds both blind shapes through this reading, so
 * the ability to fail is a measured fact here and not a claim.
 */

/** A `const NAME[: T] = { … }` declaration, brace-matched out of a code fence. */
interface ConstObjectDecl {
  readonly name: string;
  /** Whether the declaration carries an explicit type annotation. */
  readonly annotated: boolean;
  /** The object literal, from its opening brace to its matching close. */
  readonly body: string;
}

/** The page's fenced code blocks, fence lines removed. */
function fencedBlocks(source: string): string[] {
  const out: string[] = [];
  let buf: string[] | null = null;
  for (const line of source.split('\n')) {
    if (line.startsWith('```')) {
      if (buf === null) buf = [];
      else {
        out.push(buf.join('\n'));
        buf = null;
      }
      continue;
    }
    if (buf !== null) buf.push(line);
  }
  // An unterminated fence would swallow the rest of the page into nothing and
  // shrink the population silently — the exact failure direction this card is
  // about, so it is thrown rather than tolerated.
  if (buf !== null) throw new Error('unterminated code fence');
  return out;
}

/** Every `const NAME[: T] = { … }` declaration in `source`, brace-matched. */
function constObjectDeclarations(source: string): ConstObjectDecl[] {
  const out: ConstObjectDecl[] = [];
  const decl = /\bconst\s+([A-Za-z_$][\w$]*)\s*(:[^=\n]+)?=\s*\{/g;
  for (let m = decl.exec(source); m !== null; m = decl.exec(source)) {
    const open = decl.lastIndex - 1;
    let depth = 0;
    let end = open;
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1;
      else if (source[end] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) throw new Error(`unbalanced object literal for \`const ${m[1]}\``);
    out.push({ name: m[1], annotated: m[2] !== undefined, body: source.slice(open, end + 1) });
  }
  return out;
}

/** The members of a brace-matched object literal, split at ITS OWN depth. */
function ownMembers(body: string): string[] {
  const out: string[] = [];
  let buf = '';
  let d = 0;
  for (const ch of body.slice(1, -1)) {
    if ('([{'.includes(ch)) d += 1;
    else if (')]}'.includes(ch)) d -= 1;
    if (ch === ',' && d === 0) {
      out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  out.push(buf.trim());
  return out.filter((s) => s.length > 0);
}

/** Every `<TAG …>` opening element in `source`. */
function jsxOpeningElements(source: string, tag: string): string[] {
  const out: string[] = [];
  const open = new RegExp(`<${tag}\\b`, 'g');
  for (let m = open.exec(source); m !== null; m = open.exec(source)) {
    let depth = 0;
    let end = m.index;
    for (; end < source.length; end += 1) {
      const ch = source[end];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      // A `>` inside a `{…}` expression is an operator (`=>`, `a > b`), not the
      // element's end; depth is what separates the two.
      else if (ch === '>' && depth === 0) break;
    }
    out.push(source.slice(m.index, end + 1));
  }
  return out;
}

/** One enumerated declaration, with the two classification signals kept apart. */
interface ClassifiedDecl extends ConstObjectDecl {
  readonly byDiscriminant: boolean;
  readonly byConsumption: boolean;
}

/** Enumerate a page's `const` object literals, fence by fence, and classify each. */
function objectCalendarLiterals(page: string): ClassifiedDecl[] {
  return fencedBlocks(page).flatMap((block) => {
    const consumers = jsxOpeningElements(block, 'ObjectCalendar');
    return constObjectDeclarations(block).map((d) => ({
      ...d,
      byDiscriminant: ownMembers(d.body).some((m) => /^type\s*:\s*'object-calendar'(?![\w-])/.test(m)),
      byConsumption: consumers.some((el) => el.includes(`schema={${d.name}}`)),
    }));
  });
}

describe('objectui#7313 — the declaration names a live read, in the declared order', () => {
  it('the renderer resolves its records through the shared ladder, on the ARRAY arm', () => {
    // ⭐ objectui#8348 — the arm is part of the call, and asserting it here is
    // what keeps this row honest. The spelling before that card looked for the
    // bare `resolveRecordSourceConfig(schema)`, which this renderer satisfies
    // from a DOCBLOCK line that merely names the function — so it would have
    // stayed green through a call site that had stopped existing.
    //
    // ⭐ objectui#8651 re-anchored it a second time, for the objectui#8832
    // reason: the literal `resolveRecordSourceConfig(schema, 'array')` pinned
    // how the FIRST ARGUMENT is written, and that card had to change it — the
    // ladder's parameter declares `data?: ViewData` while this block's
    // published `data` row is the ARRAY arm, so the three members it documents
    // itself as reading are now passed one by one. The call, the arm and the
    // refusal of the other arm are the FACTS; the argument's shape is
    // formatting. So the arms are read out of the call's own argument list,
    // located by paren matching, with comments masked FIRST — which retires the
    // docblock false green structurally rather than by wording.
    const src = mask(readFileSync(join(REPO_ROOT, RENDERER), 'utf8'));
    const at = src.indexOf('resolveRecordSourceConfig(');
    expect(at, `${RENDERER} no longer calls the shared ladder at all`).toBeGreaterThan(-1);
    let depth = 0;
    let end = at + 'resolveRecordSourceConfig'.length;
    let closed = false;
    for (; end < src.length; end += 1) {
      if (src[end] === '(') depth += 1;
      else if (src[end] === ')') {
        depth -= 1;
        if (depth === 0) {
          closed = true;
          break;
        }
      }
    }
    const call = src.slice(at, end + 1);
    expect(closed, 'the paren match ran away — every assertion below is void').toBe(true);

    // ⭐ READ THE ARGUMENT LIST, do not search the slice for the arm's TEXT.
    //
    // This row shipped with `call.length < src.length` and `call.endsWith(')')`
    // as its control, and objectui#8651's contract review showed both are
    // satisfied by a paren match that RAN AWAY — a runaway slice is shorter
    // than the file and ends in a paren. The control passed in exactly the case
    // it existed to catch.
    //
    // ⚠️ And the obvious repairs do not close it either, which is worth writing
    // down so the next person does not re-derive it: delete this call's own
    // closing paren and the matcher simply closes on `useMemo`'s instead,
    // swallowing the dependency array. That runaway slice still reports
    // `closed`, is still balanced on every bracket kind, and still contains no
    // declaration — a dependency array is a legal call argument, so NO
    // structural test on the slice can separate the two. Measured: 179 chars
    // genuine, 249 runaway.
    //
    // What DOES separate them is the thing this row actually claims — the arm
    // is the call's LAST ARGUMENT, not a string that appears somewhere inside
    // it. Splitting the argument list at depth 0 gives `['{…}', "'array'"]` for
    // the real call and a third `[…]` argument for the runaway, so the arity
    // assertion fires. It is also reformat-stable, which a length ceiling is
    // not.
    const inner = call.slice(call.indexOf('(') + 1, -1);
    const args: string[] = [];
    let buf = '';
    let d = 0;
    for (const ch of inner) {
      if ('([{'.includes(ch)) d += 1;
      else if (')]}'.includes(ch)) d -= 1;
      if (ch === ',' && d === 0) { args.push(buf.trim()); buf = ''; continue; }
      buf += ch;
    }
    args.push(buf.trim());
    const positional = args.filter((a) => a.length > 0);
    expect(positional, `${RENDERER}: the ladder call no longer takes exactly (schema, arm)`)
      .toHaveLength(2);
    // The arm is the one `ComponentPropsMap['object-calendar'].data` declares
    // (`z.array(z.unknown())`, "Pre-fetched records"), which is why it is
    // `'array'` here and `'view-data'` on `object-grid` / `object-map` /
    // `object-gantt`.
    expect(positional[1], `${RENDERER} no longer calls the shared ladder with its declared arm`)
      .toBe("'array'");
  });

  it('the ladder reads `data`, then `staticData`, then `objectName` — the order the refinement rests on', () => {
    const src = readFileSync(join(REPO_ROOT, LADDER), 'utf8');
    const body = src.slice(src.indexOf('export function resolveRecordSourceConfig'));
    // Rung 1 is no longer a bare `if (schema.data)`: objectui#8348 gates it on
    // the arm the calling block's published `data` row declares. The ORDER — the
    // thing `requireRecordSource` actually rests on — is unchanged, and is what
    // this row still measures.
    const data = body.indexOf('schema.data');
    const staticData = body.indexOf('if (schema.staticData)');
    const objectName = body.indexOf('if (schema.objectName)');
    expect(data).toBeGreaterThan(-1);
    expect(staticData).toBeGreaterThan(data);
    expect(objectName).toBeGreaterThan(staticData);
    expect(body).toContain('authoredDataIsOnTheDeclaredArm(schema.data, dataArm)');
  });

  it('the two static-data examples on the plugin page carry the annotation (the card\'s completion signal)', () => {
    const page = readFileSync(join(REPO_ROOT, DOC_PAGE), 'utf8');
    expect(page).toContain("const schema: ObjectCalendarSchema = {\n  type: 'object-calendar',\n  staticData: [");
    expect(page).toContain("const valueProviderCalendar: ObjectCalendarSchema = {\n  type: 'object-calendar',\n  staticData: [");
    // These two rows name two specific consts and verify those two — that is the
    // whole of what they claim. The TOTAL property that used to be asserted here
    // alongside them lives in its own row below (objectui#9676), because the
    // pattern that carried it could not fail for most of the class it named.
  });

  it('⭐ no `object-calendar` literal on the page is left unannotated — the page\'s literals ENUMERATED, not pattern-matched (objectui#9676)', () => {
    const page = readFileSync(join(REPO_ROOT, DOC_PAGE), 'utf8');
    const declared = objectCalendarLiterals(page);

    // Control: splitting the page into fences may not LOSE a declaration. Every
    // `const NAME = {…}` the whole page carries has to come back out of some
    // fence, or the verdict below is a verdict on a population that shrank on
    // the way in.
    expect(declared.map((d) => d.name).sort()).toEqual(
      constObjectDeclarations(page)
        .map((d) => d.name)
        .sort(),
    );

    const calendar = declared.filter((d) => d.byDiscriminant || d.byConsumption);

    // Control: the reader has to SEE the population before its verdict on that
    // population means anything — `every()` over an empty set is exactly the
    // silent green this card was filed for. Named subjects, not a count: a count
    // moves every time the page grows an example, and then gets relaxed.
    expect(calendar.map((d) => d.name)).toEqual(
      expect.arrayContaining([
        'fieldMappedCalendar',
        'objectProviderCalendar',
        'valueProviderCalendar',
        'eventClickCalendar',
        'dateClickCalendar',
        'appointmentCalendar',
        'eventCalendar',
        'taskCalendar',
      ]),
    );

    expect(
      calendar.filter((d) => !d.annotated).map((d) => d.name),
      `${DOC_PAGE}: these \`object-calendar\` literals carry no type annotation`,
    ).toEqual([]);
  });

  it('…and that reading CAN fail: both shapes the retired pattern was blind to are caught (objectui#9676)', () => {
    // The blind shapes, as their own one-fence pages. The second is the shape
    // that stood on the real page until PR objectui#9678 — indented inside a
    // function and carrying no discriminant at all.
    const indentedWithDiscriminant = [
      '```tsx',
      'function Host() {',
      '  const blindOne = {',
      "    objectName: 'events',",
      "    type: 'object-calendar'",
      '  };',
      '  return <ObjectCalendar schema={blindOne} />;',
      '}',
      '```',
    ].join('\n');
    const indentedWithoutDiscriminant = [
      '```tsx',
      'function Host() {',
      '  const blindTwo = {',
      "    objectName: 'events',",
      "    calendar: { startDateField: 'startDate', titleField: 'title' }",
      '  };',
      '  return <ObjectCalendar schema={blindTwo} onEventClick={(r) => console.log(r)} />;',
      '}',
      '```',
    ].join('\n');

    // The retired pattern, kept here as a NEGATIVE control: it must miss both,
    // or this row is not measuring the delta it claims to measure.
    const retired = /^const \w+ = \{\n\s+type: 'object-calendar'/gm;
    expect(indentedWithDiscriminant.match(retired)).toBeNull();
    expect(indentedWithoutDiscriminant.match(retired)).toBeNull();

    const unannotated = (page: string): string[] =>
      objectCalendarLiterals(page)
        .filter((d) => (d.byDiscriminant || d.byConsumption) && !d.annotated)
        .map((d) => d.name);

    expect(unannotated(indentedWithDiscriminant)).toEqual(['blindOne']);
    expect(unannotated(indentedWithoutDiscriminant)).toEqual(['blindTwo']);

    // …and the same two, annotated, are clean — so the row above is refusing the
    // missing annotation and not the indentation.
    expect(unannotated(indentedWithDiscriminant.replace('const blindOne = {', 'const blindOne: ObjectCalendarSchema = {'))).toEqual([]);
    expect(unannotated(indentedWithoutDiscriminant.replace('const blindTwo = {', 'const blindTwo: ObjectCalendarSchema = {'))).toEqual([]);
  });
});

/* ── objectui#9239 — the `data` ARM, and the face that had it wrong ────────── */

/**
 * objectui#9239 — both published faces of this package declared the `{ provider,
 * items }` PROVIDER BLOCK under `ObjectCalendarSchema.data` while
 * `ComponentPropsMap['object-calendar'].data` on `@objectstack/spec` declared
 * `z.array(z.unknown()).optional()`. One key, two published shapes that refuse
 * each other BY KIND — and after objectui#8348 put the renderer on the
 * protocol's side, this mirror was the LONE published face still teaching a
 * spelling the renderer, `os validate` and the save gate all refuse.
 *
 * The rows below measure the protocol directly rather than restating it: the
 * mirror is asked for a verdict on the same two documents the protocol's own row
 * is asked for, so a future protocol move breaks this file instead of quietly
 * re-opening the divergence. That is the objectui#4631 class ("three declared
 * surfaces that disagree") closed on this key from the runtime side; the type
 * side is closed by the declaration DERIVING the protocol's row.
 */
describe('objectui#9239 — `data` is the protocol\'s ARRAY arm, on both faces', () => {
  const PROTOCOL_ROW = ComponentPropsMap['object-calendar'];
  const BLOCK = DATA_ARM['object-gantt'];
  const ARRAY = DATA_ARM['object-calendar'];

  it('the protocol refuses the provider block and accepts the array — measured, not assumed', () => {
    const refused = PROTOCOL_ROW.safeParse({ objectName: 'events', data: BLOCK });
    expect(refused.success).toBe(false);
    if (!refused.success) {
      expect(refused.error.issues.map((i) => i.path[0])).toContain('data');
      expect(refused.error.issues.some((i) => (i as { expected?: string }).expected === 'array')).toBe(true);
    }
    expect(PROTOCOL_ROW.safeParse({ objectName: 'events', data: ARRAY }).success).toBe(true);
  });

  it('⭐ the mirror now returns the protocol\'s verdict on both documents', () => {
    // THE ablation row. Put `ObjectCalendarSchema.data` back on
    // `ViewDataSchema.optional()` and the first expectation flips to `true`,
    // reddening here — the divergence cannot come back silently.
    expect(ObjectCalendarSchema.safeParse({ type: 'object-calendar', objectName: 'events', data: BLOCK }).success).toBe(false);
    expect(ObjectCalendarSchema.safeParse({ type: 'object-calendar', objectName: 'events', data: ARRAY }).success).toBe(true);

    // Verdict-for-verdict against the protocol's own row, so neither side can
    // drift alone. Non-vacuity is the `.size` below: a pair that agreed by
    // accepting everything would "agree" too.
    const documents = [BLOCK, ARRAY, 'nope', []];
    const mirror = documents.map((d) => ObjectCalendarSchema.safeParse({ type: 'object-calendar', objectName: 'events', data: d }).success);
    const protocol = documents.map((d) => PROTOCOL_ROW.safeParse({ objectName: 'events', data: d }).success);
    expect(mirror).toEqual(protocol);
    expect(new Set(mirror).size).toBe(2);
    expect(mirror).toEqual([false, true, false, true]);
  });

  it('the two members diverge on the ARM only — each refuses the other\'s `data` document', () => {
    // `data` is present in both, so `requireRecordSource` is satisfied and the
    // only thing that can refuse is the KEY. Path `[]` would be the refinement.
    const calendarOnGanttArm = ObjectCalendarSchema.safeParse({ type: 'object-calendar', data: BLOCK });
    expect(calendarOnGanttArm.success).toBe(false);
    if (!calendarOnGanttArm.success) expect(calendarOnGanttArm.error.issues.map((i) => i.path[0])).toContain('data');

    const ganttOnCalendarArm = ObjectGanttSchema.safeParse({ type: 'object-gantt', data: ARRAY });
    expect(ganttOnCalendarArm.success).toBe(false);
    if (!ganttOnCalendarArm.success) expect(ganttOnCalendarArm.error.issues.map((i) => i.path[0])).toContain('data');

    // ⛔ `object-gantt` was NOT moved: its own arm still validates.
    expect(ObjectGanttSchema.safeParse({ type: 'object-gantt', data: BLOCK }).success).toBe(true);
  });

  it('the LADDER is untouched: the refinement still counts presence, whatever the arm', () => {
    // An `object-calendar` whose `data` is on the WRONG arm is refused at the
    // key, NOT sent down to `staticData` — the refinement never fires, because
    // `data !== undefined`. Exactly one issue, and it is the key's.
    const r = ObjectCalendarSchema.safeParse({ type: 'object-calendar', data: BLOCK });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues).toHaveLength(1);
      expect(r.error.issues[0].path).toEqual(['data']);
      expect(r.error.issues[0].message).not.toBe(REFUSAL_MESSAGE);
    }
  });
});
