/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8651 — `ObjectCalendar` is typed at the PUBLISHED schema of the
 * element it is registered as, and every key it reads off the node is declared
 * there.
 *
 * ## What was measured, and why the card's three-way split collapsed to two
 *
 * The card filed twelve keys in two classes — four undeclared on both arms of
 * `ObjectGridSchema | CalendarSchema`, eight declared on exactly ONE arm — and
 * asked, as its FIRST question, whether that union is right at all. Measured
 * with the TypeScript checker on the merge-base (`getPropertyOfType`, never a
 * grep — objectui#8410), the answer decides eleven of the twelve at once:
 *
 * ⚠️ Note what the union itself answers, because it is easy to get backwards
 * and this file's first cut did: on the UNION only SEVEN of the fifteen reads
 * were undeclared. `ObjectGridSchema` carried `BaseSchema`'s index signature
 * (until objectui#8347), so the five `CalendarSchema`-only keys resolved through it and compiled with
 * no cast — silently typed `any`, which is the defect rather than the absence
 * of one. Per-ARM is the reading the card tabled; per-UNION is the reading the
 * compiler acts on; they are different numbers and both are measured here.
 *
 *   `ObjectCalendarSchema` — this repo's published interface for the
 *   `object-calendar` element, and its zod mirror — ALREADY declares eleven of
 *   the fifteen keys this renderer reads, `allDayField`, `startDateField`,
 *   `endDateField`, `titleField`, `colorField` and `defaultView` among them
 *   (objectui#8466, #8174, #8314, #9239). Neither arm of the union it was
 *   actually annotated with is that interface.
 *
 * ⇒ the reads were never undeclared for want of a declaration; they were
 * undeclared because the props type pointed somewhere else. Both arms go:
 *
 *   - `ObjectGridSchema` is `type: 'object-grid'`. Nothing hands this component
 *     one — the single production call site is this package's own
 *     `index.tsx`, and both of its registrations (`object-calendar` and
 *     `calendar`) publish `OBJECT_CALENDAR_INPUTS`, the `object-calendar`
 *     surface.
 *   - `CalendarSchema` was declared LOCALLY in `ObjectCalendar.tsx`, absent
 *     from this package's barrel — so no importer could ever name it — and it
 *     SHADOWED `@object-ui/types`' own published `CalendarSchema`, which is the
 *     date-picker primitive (`form.ts`, reachable at `ui:calendar` only,
 *     objectui#8499). Two layers, one word.
 *
 * The shape this leaves is the one every sibling widget in the family already
 * has: `ObjectKanban` takes `ObjectKanbanSchema`, `ObjectGantt` takes
 * `ObjectGanttSchema`, `ObjectMap` takes `ObjectMapSchema` — and `plugin-map`
 * is registered under TWO tags (`object-map` and `map`) with a single published
 * props type, exactly as this package is.
 *
 * ## The two keys that do NOT come along, and their separate exits
 *
 *   - `calendar` is declared by NO face of this repo, while
 *     `@objectstack/spec`'s `ComponentPropsMap['object-calendar']` declares it
 *     as the configuration container AND this package's registration `inputs`
 *     publishes it AND `getCalendarConfig` reads it FIRST. Triage's ruling for
 *     the family (objectui#8327, comment `5619610246`) makes that exit
 *     mechanical: declared in spec ⇒ align the mirror. Declared here.
 *   - `dateField` / `endField` were ROUTED TO THE PRODUCER by this card and are
 *     now RETIRED by objectui#8355 (director seat, 2026-09-16). The routing
 *     reading stays recorded because it is the transferable part.
 *     ⛔ An earlier cut of this card retired them on a census that was FALSE.
 *     It said: zero producers write either spelling onto a calendar node. It
 *     could not see the producer because the producer does not write the key
 *     LITERALLY — `plugin-list/src/ListView.tsx`'s `case 'calendar':` SPREAD
 *     the authored block flat onto the node it emits, objectui's own published
 *     `ListViewSchema` accepted `calendar.dateField`, and
 *     `resolveTimelineDateBinding` in that file documents it as *"the pre-#2231
 *     alias for `startDateField`"* and honours it. A word-boundary text census
 *     is structurally blind to a key arriving through a spread. Measured by
 *     mounting the producer: `calendar: { dateField, titleField }` emitted a
 *     node with a flat `dateField` and NO `startDateField`, which the merge-base
 *     drew and the retiring tree refused — SILENTLY, at a generic screen naming
 *     the canonical keys and not the key the author wrote.
 *     ⭐ objectui#8355 retires them anyway, and what makes that legitimate is
 *     the half the failed cut lacked: `@object-ui/types` now REFUSES both
 *     spellings BY NAME on every calendar surface, so the same document fails
 *     loudly at the authoring door instead of drawing nothing. The rungs, the
 *     producer's two raw spreads and these ledger rows all move together; the
 *     rows below are the inverted form of the ones that guarded the routing.
 *
 * ## ⛔ `navigation` is NOT ruled here, and its verdict is INVARIANT
 *
 * objectui#8652 carries the `navigation` family; the maintainer ruled B
 * (declare on the platform element schemas first, then mirror), the spec half
 * is objectstack#17987, and #8652 is `pm:blocked` on it. This card must not
 * rule, declare, retire or touch it. (`@objectstack/spec` 17.5.0 ships that
 * spec half — the `object-calendar` element entry declares `navigation` —
 * which meets #8652's unlock criterion; the mirroring is still #8652's, and
 * the rows below still hold: objectui#11073.)
 *
 * ⭐ It does not, and that is measurable rather than asserted: through the
 * UNION the key was already undeclared, and on `ObjectCalendarSchema` it is
 * undeclared too. ⚠️ The rule is NOT "declared on every arm" — the reading
 * recorded at the top of this file carries five keys on the union that only ONE
 * arm declares (`colorField` `dateField` `defaultView` `endField` `titleField`).
 * It is: a union member is available only when EVERY arm supplies it — by its
 * own declaration OR through an applicable index signature. `ObjectGridSchema`
 * declares `navigation`; `CalendarSchema` neither declares it nor has an index
 * signature to supply it; so the union does not carry it. Same
 * verdict at the read site before and after; the read itself is untouched. It
 * is ledgered BY NAME below, with an assertion that it is STILL READ — a stale
 * exception is a hole (the objectui#8885 ledger discipline).
 *
 * ⏱ objectui#8652 has since landed its half: `navigation` is DECLARED on
 * `ObjectCalendarSchema` (both faces), and the read above dropped its cast. So
 * its ledger entry below is STRUCK — the key now answers the population row
 * like every other read, as a declared member — and the row that pinned it
 * UNDECLARED is inverted rather than deleted. The two paragraphs above are
 * this card's reading at the time, kept as written.
 *
 * ## What the population assertion is, and why it is not a written-down list
 *
 * AGENTS.md #9: a claim that needs a live population is defended by an
 * instrument that re-derives it every run, never by a figure in prose. So the
 * central row below takes BOTH sides from the tree at run time — the keys read
 * come from a cast-aware census over `ObjectCalendar.tsx` (objectui#6576's
 * `schemaReads`, comment-masked so a key that appears only in prose cannot
 * move a verdict), and the keys declared come from the zod mirror's own
 * `.shape`, never from parse acceptance, which under `.passthrough()` cannot
 * tell "declared" from "admitted unexamined" (objectui#8466's instrument).
 *
 * The TS face is held to the same set by the standing `zod-mirror-parity`
 * ratchet plus the compile-time pins in this file, so one row covers both
 * published faces without this file re-implementing a second checker.
 *
 * ## The ceiling, stated rather than assumed (objectui#5155 / #7927)
 *
 * The mirror is `.passthrough()`, so declaring a key buys VALUE validation and
 * never buys rejection of a MISSPELLING on that face. (The TS face refused none
 * either while `BaseSchema` ended in `[key: string]: any`; objectui#8347 removed
 * it, so a typed literal refuses a misspelling now.) The counter-probe below
 * pins the mirror half honestly, so nobody reads this
 * file as claiming more than it does.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { ComponentPropsMap } from '@objectstack/spec/ui';
import { ObjectCalendarSchema as ObjectCalendarMirror } from '@object-ui/types/zod';
import type { ObjectCalendarSchema } from '@object-ui/types';

import { ObjectCalendar, type ObjectCalendarComponentProps } from '../ObjectCalendar';

// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const CALENDAR_READER = 'packages/plugin-calendar/src/ObjectCalendar.tsx';

/**
 * Keys this card deliberately does not rule on. Every entry must still be
 * READ; see the header for why the ledger asserts that and nothing else.
 *
 * EMPTY since objectui#8652 declared `navigation`, its one entry, on
 * `ObjectCalendarSchema`: a declared read needs no carve-out, and keeping the
 * entry would exempt a key the population row can now judge.
 */
const LEDGERED_OTHER_CARD_READS: readonly string[] = [];

/**
 * The two PRE-#2231 alias spellings this card ROUTES TO THE PRODUCER rather
 * than declaring or retiring. Both are genuinely undeclared on
 * `ObjectCalendarSchema` and must stay so.
 *
 * ⚠️ The ground is NOT that the spec singles these two out. MEASURED on
 * installed `@objectstack/spec` 18.1.0: `ComponentPropsMap['object-calendar']`
 * is STRICT and declares exactly ten flat members — `calendar` `data`
 * `defaultView` `filter` `loading` `locale` `navigation` `objectName` `sort`
 * `staticData` (nine through 17.4.0; 17.5.0 added `navigation`) —
 * so it refuses every undeclared flat key with the same `unrecognized_keys`
 * diagnostic: these two aliases, a nonsense key, AND the five canonical field
 * keys `ObjectCalendarSchema` already declares and this renderer reads (`startDateField`
 * `endDateField` `titleField` `colorField` `allDayField`). ⛔ Blanket strictness cannot be the reason these
 * two stay undeclared — applied as a reason it would require undeclaring those
 * canonical five, and this repo's mirror being stricter than the protocol is
 * the SANCTIONED direction anyway (see `zod/objectql.zod.ts`).
 *
 * The real ground was narrower: they are deprecated pre-#2231 ALIASES of keys
 * this schema already declares, and the alias question had an open carrier —
 * objectui#8355 — which had not ruled. It has now: retire at both faces, with
 * no phased window. So the entries below invert. Each is asserted to be NO
 * LONGER READ, to be DECLARED AS A REFUSAL rather than absent, and the PRODUCER
 * is asserted to no longer flatten either spelling onto the node.
 *
 * ⛔ Declaring them as ordinary members is the one disposition that stays
 * forbidden — it would accept what the platform refuses (option D, refused by
 * the same ruling). A refusal arm is the opposite move: the key is declared so
 * that it can be REJECTED by name instead of riding a `.passthrough()`.
 */
const RETIRED_ALIASES = ['dateField', 'endField'] as const;

/** Their canonical twins — the control that makes any zero above a reading. */
const CANONICAL_TWINS = ['startDateField', 'endDateField'] as const;

/** The producer that makes the two aliases reachable, and the branch that does it. */
const PRODUCER = 'packages/plugin-list/src/ListView.tsx';

/** A key nothing reads and nothing declares: the both-ways control. */
const CONTROL_KEY = 'zzqxNoSuchField';

/* ── Instruments ──────────────────────────────────────────────────────────── */

function readRepo(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

/**
 * Every key read off the schema node, in EITHER form: the bare `schema.KEY` and
 * the cast `(schema as any).KEY`. Both spell the same FACT — the renderer reads
 * this key — and only one spells it through a cast that this card's cleanup
 * deletes. Reading the fact rather than the spelling is what stops these
 * verdicts reddening on that cleanup (objectui#8832). Borrowed verbatim from
 * `types/src/__tests__/calendar-flat-color-allday-8466.test.ts`.
 */
const SCHEMA_READ = /(?:\bschema\b|\(\s*schema\s+as\s+[^)]*\))\s*\.\s*([A-Za-z_$][\w$]*)/g;

function schemaReads(source: string): Set<string> {
  return new Set([...source.matchAll(SCHEMA_READ)].map((m) => m[1]));
}

/** The renderer's reads, with prose masked so a key named only in a comment cannot vote. */
function rendererReads(): Set<string> {
  return schemaReads(mask(readRepo(CALENDAR_READER)));
}

/** Declared membership, off the mirror's OWN shape — never off parse acceptance. */
function shapeKeys(schema: unknown): string[] {
  return Object.keys((schema as { shape: Record<string, unknown> }).shape);
}

/**
 * ⚠️ `ComponentPropsMap` entries are read through `Record<string, any>` on
 * purpose: `_def` is a zod INTERNAL for which the spec publishes no type, so a
 * hand-written shape for it would be a local assertion about a third-party
 * runtime that nothing re-checks. The same reading, and the same decision, as
 * `calendar-flat-color-allday-8466.test.ts`.
 */
function specShapeKeys(type: string): string[] {
  const entry = (ComponentPropsMap as unknown as Record<string, any>)[type];
  const def = entry._def;
  const shape = typeof def.shape === 'function' ? def.shape() : def.shape;
  return Object.keys(shape);
}

/* ── Compile-time pins (compiled by `tsc -p tsconfig.test.json`) ───────────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/**
 * `Equal`, not `extends`: a union arm carrying `BaseSchema`'s index signature
 * (every extender did until objectui#8347) made an UNDECLARED member read `any`,
 * and a one-way check accepts `any` on both sides — which is precisely the
 * before-state this card removed.
 */
export type assertionSchemaPropIsThePublishedElementSchema =
  Expect<Equal<ObjectCalendarComponentProps['schema'], ObjectCalendarSchema>>;
/** The helper can FAIL — synthetic control. */
export type assertionEqualCanFail = Expect<Equal<Equal<any, ObjectCalendarSchema>, false>>;

/* ── 1. The props type ────────────────────────────────────────────────────── */

describe('objectui#8651 — the props type is the published element schema', () => {
  it('accepts the flat calendar vocabulary contextually typed, with NO cast', () => {
    const schema: ObjectCalendarComponentProps['schema'] = {
      type: 'object-calendar',
      objectName: 'duly_task',
      startDateField: 'kickoff',
      endDateField: 'wrapup',
      titleField: 'nickname',
      colorField: 'status_colour',
      allDayField: 'is_all_day',
      defaultView: 'week',
    };
    expect(schema.startDateField).toBe('kickoff');
    expect(schema.defaultView).toBe('week');
  });

  it('accepts the nested `calendar` container the spec names, contextually typed', () => {
    const schema: ObjectCalendarComponentProps['schema'] = {
      type: 'object-calendar',
      objectName: 'duly_task',
      calendar: { startDateField: 'kickoff', endDateField: 'wrapup', titleField: 'nickname' },
    };
    expect(schema.calendar?.startDateField).toBe('kickoff');
  });
});

/* ── 2. The population: every read is declared, or ledgered by name ────────── */

describe('objectui#8651 — every key read off the node is declared on that schema', () => {
  it('no read is undeclared — `navigation` included, since objectui#8652', () => {
    const reads = rendererReads();
    const declared = new Set(shapeKeys(ObjectCalendarMirror));
    const exempt = new Set<string>([...LEDGERED_OTHER_CARD_READS]);
    const undeclared = [...reads]
      .filter((key) => !declared.has(key))
      .filter((key) => !exempt.has(key))
      .sort();
    expect(undeclared, `undeclared reads on ObjectCalendarSchema: ${undeclared.join(', ')}`)
      .toEqual([]);
  });

  it('the ledger is not stale: every carve-out is STILL read', () => {
    const reads = rendererReads();
    for (const key of LEDGERED_OTHER_CARD_READS) {
      expect([...reads], `${key} is ledgered but no longer read — the exception is a hole`)
        .toContain(key);
    }
  });

  it('`navigation` is READ and DECLARED — objectui#8652 landed the mirror', () => {
    // Inverted rather than deleted: this row pinned the key UNDECLARED while
    // objectui#8652 held it. Both halves are read, so the declaration cannot
    // satisfy it for a key the renderer stopped reading.
    expect([...rendererReads()]).toContain('navigation');
    expect(shapeKeys(ObjectCalendarMirror)).toContain('navigation');
    expect(LEDGERED_OTHER_CARD_READS).not.toContain('navigation');
  });

  it('CONTROL: both halves of the row above can fail', () => {
    // The census sees a read that is there…
    expect([...rendererReads()]).toContain('objectName');
    // …and does not invent one that is not.
    expect(rendererReads().has(CONTROL_KEY)).toBe(false);
    // The declared set is a real set, not everything.
    expect(shapeKeys(ObjectCalendarMirror)).toContain('startDateField');
    expect(shapeKeys(ObjectCalendarMirror)).not.toContain(CONTROL_KEY);
    // And the census fires on both spellings, so the cast cleanup cannot mute it.
    const probe = schemaReads('const a = schema.alphaKey; const b = (schema as any).betaKey;');
    expect([...probe].sort()).toEqual(['alphaKey', 'betaKey']);
  });
});

/* ── 3. `calendar`, the container the spec names ───────────────────────────── */

describe('objectui#8651 — `calendar` is declared; the spec sets the KEY, and since 17.7.0 its SHAPE too', () => {
  it('the spec declares the KEY and, since 17.7.0, its shape — the slot is the list view\'s strict calendar block', () => {
    // The grounds, stated the way the instrument returns them. Through 17.6.0
    // this row pinned the slot as `z.unknown()`: a nonsense key, the alias
    // spelling and a number all parsed inside it. `@objectstack/spec` 17.7.0
    // types it (objectstack#21464 stage 2, `7d674dfc`) as the list view's own
    // `calendar` member, `CalendarConfigSchema`, so each of those is refused now
    // and this row flipped at that bump (objectui#11717).
    const oc = (ComponentPropsMap as unknown as Record<string, any>)['object-calendar'];
    const inside = (value: unknown) => oc.safeParse({ objectName: 'duly_task', calendar: value }).success;
    expect(inside({ startDateField: 'kickoff' })).toBe(true);   // known-accepted control
    expect(inside({ [CONTROL_KEY]: 'x' })).toBe(false);         // ⇒ the slot is strict
    expect(inside({ dateField: 'kickoff' })).toBe(false);       // so the alias is NOT writable
    expect(inside(42)).toBe(false);                             // it is an object, not `z.unknown()`
    // CONTROL, same instrument, one level out: the element's props schema IS
    // strict too, so the readings above are about this SLOT's own shape.
    expect(oc.safeParse({ objectName: 'duly_task', [CONTROL_KEY]: 'x' }).success).toBe(false);
  });

  it('the spec declares it at the flat position (control: a nonsense key on the same call)', () => {
    expect(specShapeKeys('object-calendar')).toContain('calendar');
    const oc = (ComponentPropsMap as unknown as Record<string, any>)['object-calendar'];
    expect(oc.safeParse({ objectName: 'duly_task', calendar: { startDateField: 'kickoff' } }).success)
      .toBe(true);
    expect(oc.safeParse({ objectName: 'duly_task', [CONTROL_KEY]: 'x' }).success).toBe(false);
  });

  it('the mirror declares it — read off the shape, not off acceptance', () => {
    expect(shapeKeys(ObjectCalendarMirror)).toContain('calendar');
  });

  it('…and now VALUE-validates it, which is the whole of what declaring buys', () => {
    const node = { type: 'object-calendar', objectName: 'duly_task' };
    expect(ObjectCalendarMirror.safeParse({ ...node, calendar: 42 }).success).toBe(false);
    const ok = ObjectCalendarMirror.safeParse({
      ...node,
      calendar: { startDateField: 'kickoff', titleField: 'nickname', allDayField: 'is_all_day' },
    });
    expect(ok.success, JSON.stringify(ok.error?.issues)).toBe(true);
  });

  it('the objectui#7927 ceiling is UNCHANGED: a misspelling is still admitted', () => {
    const node = { type: 'object-calendar', objectName: 'duly_task' };
    expect(ObjectCalendarMirror.safeParse({ ...node, calender: { startDateField: 'k' } }).success)
      .toBe(true);
  });
});

/* ── 4. The retired spellings ─────────────────────────────────────────────── */

describe('objectui#8355 — the `dateField` / `endField` rungs are RETIRED at both faces', () => {
  it('neither is READ any more — the ladder is gone', () => {
    const reads = rendererReads();
    for (const key of RETIRED_ALIASES) {
      expect([...reads], `${key} is still read by the renderer — the ladder half of objectui#8355 did not land`)
        .not.toContain(key);
    }
  });

  it('CONTROL: the same census sees the canonical twins, and invents nothing', () => {
    // Without this row the absence above is not a reading: a census that had
    // stopped matching anything would report the same two zeros.
    const reads = rendererReads();
    for (const key of CANONICAL_TWINS) expect([...reads]).toContain(key);
    expect(reads.has(CONTROL_KEY)).toBe(false);
  });

  it('both ARE declared — as by-name REFUSALS, which is what makes the removal loud', () => {
    // ⭐ The inversion of this card's own row, and the distinction the ruling
    // turns on. Declared-as-a-MEMBER would accept what the platform refuses
    // (option D, refused). Declared-as-a-REFUSAL is the opposite: `BaseSchema`
    // ends `.passthrough()`, so a key that is simply ABSENT from the shape is
    // KEPT unexamined and then ignored — silent. Present in the shape and
    // unwritable is the only disposition that fails the document out loud.
    const declared = shapeKeys(ObjectCalendarMirror);
    for (const key of RETIRED_ALIASES) expect(declared).toContain(key);
  });

  it('…and an authored alias is refused BY NAME, at its own path, naming the canonical key', () => {
    const node = { type: 'object-calendar', objectName: 'duly_task', titleField: 'nickname' };
    for (const [alias, canonical] of [['dateField', 'startDateField'], ['endField', 'endDateField']] as const) {
      const r = ObjectCalendarMirror.safeParse({ ...node, [alias]: 'kickoff' });
      expect(r.success, `${alias} still parses green on the node face`).toBe(false);
      const issue = r.success ? undefined : r.error.issues.find((i) => i.path.join('.') === alias);
      expect(issue?.code, `${alias} is not refused at its own path`).toBe('invalid_type');
      expect(issue?.message).toContain(`Did you mean \`${alias}\` → \`${canonical}\`?`);
    }
  });

  it('CONTROL: the canonical spellings still parse green on the same instrument', () => {
    // So the four rows above are a narrowing of two keys, not "the node face
    // refuses everything".
    const ok = ObjectCalendarMirror.safeParse({
      type: 'object-calendar',
      objectName: 'duly_task',
      startDateField: 'kickoff',
      endDateField: 'wrapup',
      titleField: 'nickname',
    });
    expect(ok.success, JSON.stringify(ok.error?.issues)).toBe(true);
  });

  it('THE PRODUCER HALF (SECONDARY, spelling-bound): the calendar branch no longer flattens the block raw', () => {
    // The carrier assertion, inverted. The branch used to end by spreading the
    // authored `calendar` block FLAT onto the `object-calendar` node it emits,
    // which is the whole reason an authored `calendar.dateField` ever reached
    // this renderer as a flat key. objectui#8355 stripped the two retired
    // spellings out of that spread; objectui#6152 round 14 retired the spread
    // itself, so the branch now reads the block's five declared keys by name and
    // spreads nothing of the block into the node. Re-judged then: the row below
    // pinned the destructure-then-spread shape, whose subject is gone.
    //
    // ⭐ THIS ROW IS SECONDARY, AND THE NEXT READER SHOULD KNOW WHICH ONE IS NOT.
    // The LOAD-BEARING witness is `plugin-list`'s
    // `ListView.calendarAliasRefused-8355.test.tsx` half 1, which reads the node
    // the producer really EMITS. Measured across three revert shapes: it
    // reddened on every one of them, while this row caught only two.
    //
    // ⚠️ The shape it missed, measured rather than imagined (contract review of
    // objectui#8355, ablation "B2"): keep the strip and re-add a raw
    // `...(schema.calendar || {})` as the LAST property with NO trailing comma.
    // The emitted node carries the alias again — the runtime row goes red — and
    // every text assertion below stays GREEN, because the tokens they key on are
    // still present. A text census cannot see what a spread produces, which is
    // the same blindness that produced the false producer census this file
    // records; this row narrows it, it does not close it.
    //
    // ⇒ ⛔ Do not read a green here as "the producer is correct", and ⛔ do not
    // delete the runtime row on the grounds that this one covers it.
    const producer = mask(readRepo(PRODUCER));
    const at = producer.indexOf("case 'calendar':");
    expect(at, `${PRODUCER}: the calendar branch is gone; re-derive this ledger`).toBeGreaterThan(-1);
    // Bound the slice STRUCTURALLY, at the next `case` label, rather than by a
    // character count — a magic window either overshoots into the sibling
    // branch (measured: 2000 chars reaches `case 'gallery':`) or silently
    // undershoots past the spread this row is about.
    const nextCase = producer.indexOf("case '", at + 1);
    expect(nextCase, `${PRODUCER}: no branch follows the calendar one; the bound is unsafe`)
      .toBeGreaterThan(at);
    const branch = producer.slice(at, nextCase);
    // Since objectui#6152 round 14 nothing of the block is spread into the
    // node: no merged local, no remainder. The retired spellings are therefore
    // named nowhere in the branch's code (comments are masked), and each of the
    // five declared keys is read by name. ⚠️ Still spelling-bound, as the
    // paragraph above says: the runtime witness is the load-bearing one.
    for (const key of RETIRED_ALIASES) {
      expect(branch, `${PRODUCER}'s calendar branch names the retired ${key} in code again`)
        .not.toMatch(new RegExp(`\\b${key}\\b`));
    }
    for (const key of ['startDateField', 'endDateField', 'titleField', 'colorField', 'allDayField']) {
      expect(branch, `${PRODUCER}'s calendar branch no longer reads the declared ${key} by name`)
        .toContain(`schema.calendar?.${key}`);
    }
    expect(branch, `${PRODUCER} spreads a calendar block or its remainder into the node again`)
      .not.toMatch(/\.\.\.(restCalendar|calendarCfg|\(schema(\.options\?)?\.calendar)/);
    // The runtime half of this row — the node `ListView` really emits — is in
    // `plugin-list`'s `ListView.calendarAliasRefused-8355.test.tsx`; a text read
    // alone cannot see what a spread produces, which is the blindness that
    // produced the false census this file records.
    // CONTROLS: the slice really is just this branch — it carries this branch's
    // own marker, and not the sibling branch's.
    expect(branch).toContain("type: 'object-calendar'");
    expect(branch).not.toContain("type: 'object-gallery'");
  });
});

/* ── 5. …and the regression is observable on screen ──────────────────────── */

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailPanel: () => null,
  deriveRecordPageHref: () => null,
}));

const OBJECT_SCHEMA = {
  name: 'duly_task',
  nameField: 'subject',
  fields: {
    id: { name: 'id', type: 'text' },
    subject: { name: 'subject', type: 'text' },
    nickname: { name: 'nickname', type: 'text' },
    kickoff: { name: 'kickoff', type: 'datetime' },
  },
};

const ROW = {
  id: 'r1',
  subject: 'Default display name',
  nickname: 'Authored event title',
  kickoff: '2026-03-01T09:00:00.000Z',
};

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [ROW], total: 1 })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => OBJECT_SCHEMA),
  } as any;
}

const REFUSAL = /Calendar configuration required/i;

/**
 * ⭐ THE REGRESSION ROW, INVERTED BY objectui#8355 — and the inversion is the
 * whole record of why the first attempt was wrong and this one is not.
 *
 * An earlier cut of objectui#8651 retired the two alias rungs and this suite was
 * GREEN, the whole farm was GREEN, and a live authoring path had stopped
 * rendering. What was missing was not a stricter assertion anywhere in it — it
 * was THIS node, and what made its failure UNREPORTABLE was that nothing refused
 * the key: the document validated, the alias arrived, nothing read it, and the
 * author met a generic screen naming keys they had not written.
 *
 * The node below is not invented: it is what `ListView` used to emit for a view
 * authored `calendar: { dateField, titleField }` — captured by mounting the
 * producer with a spy registration — a flat `dateField`, a `titleField`, and NO
 * `startDateField`.
 *
 * ⭐ TWO THINGS CHANGED TOGETHER, which is the ruled shape:
 *
 *   1. the producer no longer emits this node at all (pinned in `plugin-list`'s
 *      `ListView.calendarAliasRefused-8355.test.tsx`), and
 *   2. a document that authors the alias is REFUSED BY NAME at validation,
 *      pointed at `startDateField` / `endDateField` (pinned in section 4 above
 *      and in `@object-ui/types`' `calendar-date-alias-refusal-8355.test.ts`).
 *
 * ⇒ this node reaching the refusal screen is now the CORRECT outcome rather
 * than the regression, because the author has already been told, by name, at
 * the door. ⛔ Do not restore a rung to make this row draw again: that reopens
 * the alias the ruling retired. The row that reports a half-landed retirement
 * is the producer row in section 4 — if the rungs came back while the refusals
 * stayed, section 4's first row reddens.
 */
describe('objectui#8355 — the retired node refuses, and the canonical one still draws', () => {
  it('a node carrying ONLY the retired alias binding reaches the refusal screen', async () => {
    render(
      <ObjectCalendar
        schema={{ type: 'object-calendar', objectName: 'duly_task', dateField: 'kickoff', titleField: 'nickname' } as any}
        dataSource={makeDataSource()}
      />,
    );
    await waitFor(() => expect(screen.getByText(REFUSAL)).toBeTruthy());
  });

  it('CONTROL: the canonical spelling on the same rows draws — the ladder removal narrowed TWO keys', async () => {
    render(
      <ObjectCalendar
        schema={{ type: 'object-calendar', objectName: 'duly_task', startDateField: 'kickoff', titleField: 'nickname' } as any}
        dataSource={makeDataSource()}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(screen.queryByText(REFUSAL)).toBeNull();
  });

  it('CONTROL: a node with no date binding at all refuses too, so the row above is not vacuous', async () => {
    render(
      <ObjectCalendar
        schema={{ type: 'object-calendar', objectName: 'duly_task', titleField: 'nickname' } as any}
        dataSource={makeDataSource()}
      />,
    );
    await waitFor(() => expect(screen.getByText(REFUSAL)).toBeTruthy());
  });
});
