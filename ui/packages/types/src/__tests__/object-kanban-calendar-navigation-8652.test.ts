/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#8652 — `navigation` is declared on the `object-kanban` and
 * `object-calendar` arms, on both published faces, BY REFERENCE to the spec.
 *
 * ## The ruling this executes
 *
 * Maintainer ruling on objectui#8652, verbatim 「B」: declare `navigation` on
 * the platform element schema first, then mirror it in this package. The spec
 * half shipped in `@objectstack/spec` 17.5.0 — its `ComponentPropsMap` entries
 * for both elements declare `navigation: NavigationConfigSchema.optional()` —
 * and that is the release this repository resolves. So this is the mirror
 * catching up with the contract (declared in spec ⇒ align the mirror), not a
 * key this package invents.
 *
 * ## What was measurably wrong
 *
 * Both renderers read the key (`ObjectKanban` and `ObjectCalendar`, each in its
 * `navConfig`), and neither arm declared it. On the TS face the read compiled
 * through `BaseSchema`'s `[key: string]: any`; on the zod face `.passthrough()`
 * kept any value unexamined. So `navigation: { mode: 'not-a-mode' }` passed
 * both faces of this package while the spec's own element schema refused it at
 * `navigation.mode`. The rows below are that opposite-answer pair, frozen: the
 * installed spec is read in the same run, so the two faces are compared against
 * the contract they mirror rather than against a copy of it written here.
 *
 * ## The value-level judgment, per arm
 *
 * Declaring a key on a `.passthrough()` face cannot refuse a MISSPELLED key
 * (objectui#7927's ceiling). What it buys is VALUE validation, so the pins are
 * value-level, the same judgment PR objectui#8799 pinned on the retired `kanban`
 * arm: a valid block parses, a bad `mode` is refused at `navigation.mode`, and a
 * bogus member INSIDE the block is refused. Each refusal is paired with the
 * same value under a key nothing declares, which is still ACCEPTED — the
 * control that makes the refusal this declaration's and nothing else's.
 *
 * ## ⛔ Not here
 *
 * `object-timeline` also carries `navigation` on 17.5.0; it is objectui#8654's
 * card and its arm is untouched by this one.
 */

import { describe, it, expect } from 'vitest';
import { ComponentPropsMap } from '@objectstack/spec/ui';

import {
  ObjectKanbanSchema as KanbanMirror,
  ObjectCalendarSchema as CalendarMirror,
} from '../zod/objectql.zod';
import { safeValidateSchema } from '../zod/index.zod';
import type {
  ObjectKanbanSchema,
  ObjectCalendarSchema,
  ViewNavigationConfig,
} from '../objectql';

/** The slice of a zod `safeParse` result these rows read — no zod internals. */
type ParseResult = {
  success: boolean;
  error?: { issues: Array<{ path: PropertyKey[]; code: string }> };
  data?: unknown;
};
type Parser = { safeParse: (doc: unknown) => ParseResult };

type Arm = {
  type: 'object-kanban' | 'object-calendar';
  mirror: Parser;
  base: Record<string, unknown>;
};

/** The installed spec's element entry, read through the same narrow slice. */
const specEntry = (type: Arm['type']): Parser =>
  (ComponentPropsMap as unknown as Record<string, Parser>)[type];

/**
 * One valid document per arm. The kanban board carries `objectName` and the
 * calendar `objectName` too, so each arm's record-source refinement is met and
 * the only verdict under test is `navigation`'s.
 */
const ARMS: Arm[] = [
  {
    type: 'object-kanban',
    mirror: KanbanMirror as unknown as Parser,
    base: { type: 'object-kanban', objectName: 'task', groupBy: 'status' },
  },
  {
    type: 'object-calendar',
    mirror: CalendarMirror as unknown as Parser,
    base: { type: 'object-calendar', objectName: 'event', startDateField: 'starts_at' },
  },
];

/** Issues as `path|code`, so a red run names what broke. */
function issuesOf(arm: Arm, doc: unknown): string[] {
  const r = arm.mirror.safeParse(doc);
  return r.success ? [] : (r.error?.issues ?? []).map((i) => `${i.path.map(String).join('.')}|${i.code}`);
}

/**
 * The installed spec's own verdict on the element's props, `type` removed (the
 * element entry does not declare the node discriminator). Read, not restated.
 */
function specIssuesOf(type: Arm['type'], navigation: unknown): string[] {
  const r = specEntry(type).safeParse({ navigation });
  return r.success ? [] : (r.error?.issues ?? []).map((i) => `${i.path.map(String).join('.')}|${i.code}`);
}

const shapeKeys = (schema: unknown): string[] =>
  Object.keys((schema as { shape: Record<string, unknown> }).shape);

describe.each(ARMS)('`$type` declares `navigation` (objectui#8652)', (arm) => {
  const withNav = (navigation: unknown) => ({ ...arm.base, navigation });

  it('the installed spec declares it on this element — the premise, read live', () => {
    // A valid block is accepted and a bogus key beside it is refused, on the
    // same entry: the acceptance is a declaration, not a blanket accept.
    expect(specIssuesOf(arm.type, { mode: 'drawer' })).toEqual([]);
    const bogus = specEntry(arm.type).safeParse({ zzqxNoSuchKey: 1 });
    expect(bogus.success).toBe(false);
    expect((bogus.error?.issues ?? []).map((i) => i.code)).toContain('unrecognized_keys');
  });

  it('the mirror names it as a member of its own shape', () => {
    expect(shapeKeys(arm.mirror)).toContain('navigation');
    // Firing control: the shape is a real set, not everything.
    expect(shapeKeys(arm.mirror)).not.toContain('zzqxNoSuchKey');
  });

  it('a valid block parses, and so does every mode the spec declares', () => {
    expect(issuesOf(arm, withNav({ mode: 'drawer' }))).toEqual([]);
    expect(issuesOf(arm, withNav({ mode: 'modal', size: 'lg' }))).toEqual([]);
    expect(issuesOf(arm, withNav({ mode: 'page', openNewTab: true }))).toEqual([]);
    expect(issuesOf(arm, withNav({ mode: 'none', preventNavigation: true }))).toEqual([]);
    expect(issuesOf(arm, withNav({ mode: 'drawer', width: '720px' }))).toEqual([]);
  });

  it('a bad `mode` is refused at `navigation.mode` — as the spec refuses it', () => {
    const doc = withNav({ mode: 'not-a-mode' });
    expect(issuesOf(arm, doc)).toEqual(['navigation.mode|invalid_value']);
    expect(specIssuesOf(arm.type, { mode: 'not-a-mode' })).toEqual(['navigation.mode|invalid_value']);
  });

  it('a bogus member INSIDE the block is refused — the block is the spec\'s strict object', () => {
    const issues = issuesOf(arm, withNav({ mode: 'drawer', zzqxNoSuchMember: true }));
    expect(issues).toEqual(['navigation|unrecognized_keys']);
    expect(specIssuesOf(arm.type, { mode: 'drawer', zzqxNoSuchMember: true })).toEqual(['navigation|unrecognized_keys']);
  });

  it('the retired `view` member is refused, as the spec retired it in 17.5.0', () => {
    expect(issuesOf(arm, withNav({ mode: 'page', view: 'summary' }))).not.toEqual([]);
    expect(specIssuesOf(arm.type, { mode: 'page', view: 'summary' })).not.toEqual([]);
  });

  it('CONTROL — the same bad block under a key nothing declares is still ACCEPTED', () => {
    // `BaseSchema` is `.passthrough()`: this is the state `navigation` itself
    // was in before this card. The only difference from the refusal rows above
    // is the key name, so those refusals come from this declaration.
    expect(issuesOf(arm, { ...arm.base, zzqxUndeclaredNav: { mode: 'not-a-mode' } })).toEqual([]);
  });

  it('the parse writes no default into the document — the renderer\'s absent-key fallback stays reachable', () => {
    // The spec defaults `mode` to `'page'`. Imported through
    // `stripImportedDefaults`, the mirror adds nothing: an absent key stays
    // absent (so the renderer's `{ mode: 'drawer' }` applies) and a block
    // without `mode` stays without one.
    const absent = arm.mirror.safeParse({ ...arm.base });
    expect(absent.success).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(absent.data as object, 'navigation')).toBe(false);
    const noMode = arm.mirror.safeParse(withNav({ size: 'lg' }));
    expect(noMode.success).toBe(true);
    expect((noMode.data as { navigation: Record<string, unknown> }).navigation).toEqual({ size: 'lg' });
  });

  it('through `safeValidateSchema`, the published entry point, the verdicts agree', () => {
    expect(safeValidateSchema(withNav({ mode: 'drawer' })).success).toBe(true);
    expect(safeValidateSchema(withNav({ mode: 'not-a-mode' })).success).toBe(false);
  });
});

/* ── Type-level: the TS twin declares the member, by the spec's type ──────── */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/**
 * `Equal`, not `extends`: an undeclared member read `any` through
 * `BaseSchema`'s index signature until objectui#8347, and `any` passes a
 * one-way check on both sides — which is precisely the before-state this card
 * removed.
 */
export type assertionKanbanNavigationIsTheSpecType =
  Expect<Equal<ObjectKanbanSchema['navigation'], ViewNavigationConfig | undefined>>;
export type assertionCalendarNavigationIsTheSpecType =
  Expect<Equal<ObjectCalendarSchema['navigation'], ViewNavigationConfig | undefined>>;
/** The helper can FAIL — synthetic control. */
export type assertionEqualCanFail = Expect<Equal<Equal<any, ViewNavigationConfig | undefined>, false>>;

/**
 * The TS twin's own failing instrument. The zod-mirror-parity ratchet has no
 * operator for a mirrored key the twin does not declare (objectui#9711), so the
 * twin's member is defended here: with it declared, `'not-a-mode'` is not a
 * `NavigationMode` and the expected error exists. That guards the member's
 * TYPE; since objectui#8347 a deleted member's value is refused as an undeclared
 * key and the directive stays used, so a deletion is caught by the `Equal` rows
 * above instead (the indexed access stops compiling).
 */
export const BAD_KANBAN_MODE_IS_REFUSED_AT_COMPILE_TIME: ObjectKanbanSchema = {
  type: 'object-kanban',
  objectName: 'task',
  groupBy: 'status',
  // @ts-expect-error — `mode` is the spec's closed `NavigationMode` vocabulary.
  navigation: { mode: 'not-a-mode' },
};

export const BAD_CALENDAR_MODE_IS_REFUSED_AT_COMPILE_TIME: ObjectCalendarSchema = {
  type: 'object-calendar',
  objectName: 'event',
  // @ts-expect-error — `mode` is the spec's closed `NavigationMode` vocabulary.
  navigation: { mode: 'not-a-mode' },
};

/** The valid block annotates on both arms, with no cast. */
export const KANBAN_WITH_NAVIGATION: ObjectKanbanSchema = {
  type: 'object-kanban',
  objectName: 'task',
  groupBy: 'status',
  navigation: { mode: 'modal', size: 'lg' },
};

export const CALENDAR_WITH_NAVIGATION: ObjectCalendarSchema = {
  type: 'object-calendar',
  objectName: 'event',
  navigation: { mode: 'page', openNewTab: true },
};

describe('the TS face admits what the zod face admits (objectui#8652)', () => {
  it.each([
    ['object-kanban', KANBAN_WITH_NAVIGATION, KanbanMirror],
    ['object-calendar', CALENDAR_WITH_NAVIGATION, CalendarMirror],
  ] as const)('the annotated %s document also parses', (_type, doc, mirror) => {
    expect((mirror as unknown as Parser).safeParse(doc).success).toBe(true);
  });
});
