// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `ObjectGridSchema.title` is declared on BOTH faces — interface AND zod mirror
 * (objectui#6639, census-directed maintainer ruling 2026-08-29, declare branch).
 *
 * ## The card, corrected by measurement
 *
 * The card read `caption: schema.label || schema.title` as a read of an
 * UNDECLARED key admitted by `BaseSchema`'s `[key: string]: any`. Verified
 * against the tree the card was filed on (`5ef9c4f5f`, the last
 * `objectql.ts`-touching commit before filing): HALF false — the INTERFACE
 * already declared `title?: string` (`@deprecated Use label instead`), so both
 * read sites compile through a declared member, not the index signature. What
 * was missing was the zod-mirror half of the #6424 family form: the published
 * validator had never heard of the key (ledgered in `zod-mirror-parity.test.ts`
 * `UnmirroredDeclared`), so it admitted ANY `title` unexamined through the
 * `.passthrough()` base instead of enforcing the declared `string`.
 *
 * ## The census that chose the branch (ruling step 1; recorded in the PR)
 *
 * Parse-based, order-agnostic sweep of `apps/` `examples/` `content/` on base
 * `30266cf`: 32 `object-grid` nodes in 11 files; 2 nodes author a sibling
 * `title`, both confirmed PER-HIT as genuine grid-node keys (not nested-object
 * misattribution) in `content/docs/api/schema-reference.md`; positive control
 * in the same instrument (`label`) returned 2 nodes. Authors exist ⇒ DECLARE,
 * not drop-the-read (which would have silently cost those nodes their caption).
 *
 * ## What each assertion pins, and why membership is read off `.shape`
 *
 * The mirror extends a `.passthrough()` base, so `unrecognized_keys` can never
 * fire and parse ACCEPTANCE cannot distinguish "declared" from "admitted
 * unexamined" — acceptance was green before the fix too. Membership is
 * therefore asserted on the mirror's own `.shape` (the same face
 * `zod-mirror-parity.test.ts` derives from), value enforcement through full
 * `safeParse` verdicts with the red side pointed AT `['title']`, and the
 * before-state is kept as a labelled control so the refusal assertion cannot
 * pass vacuously.
 *
 * ## Widened to the spec's `I18nLabel` (objectui#10993, batch 4)
 *
 * This file pinned `title` as the plain deprecated `string` on both faces. The
 * spec's row types the key `I18nLabel` (`ComponentPropsMap['object-grid'].title`)
 * and `ObjectGrid` resolves an inline locale map at both read sites since
 * objectui#10993 batch 3, so the `string` pin held a narrowing in place: it is
 * re-judged here rather than kept. The interface face is now equal to
 * `I18nLabel`, the mirror takes the spec's `I18nLabelSchema` by reference, and
 * the rows below add the map (parses, survives) and a map whose entry is not a
 * string (refused AT the key) beside the string and number rows that stand.
 */

import { describe, it, expect } from 'vitest';
import { ObjectGridSchema, ObjectViewSchema } from '../zod/objectql.zod';
import type { ObjectGridSchema as TsObjectGridSchema, ObjectViewSchema as TsObjectViewSchema } from '../objectql';
import type { I18nLabel } from '../index';

/* ── Type-level helpers (invariant equality, house form) ─────────────────── */

type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Expect< T extends true > = T;

/**
 * Interface face: `title` is the spec's `I18nLabel` (objectui#10993 batch 4) —
 * fails to compile if it is narrowed back to `string` or widened past the
 * spec's type.
 */
export type _TitleIsI18nLabel = Expect<
  Equal< TsObjectGridSchema['title'], I18nLabel | undefined >
>;

/**
 * An `object-view`'s `table` slot picks this key (`ObjectGridSlotKey`), so it
 * follows: `ObjectView` hands `table.title` to its grid as `title`, which
 * resolves it (`plugin-view`'s `ObjectView.tableTitleI18nLabel-10993` pin).
 */
export type _ViewTableTitleFollows = Expect<
  Equal< NonNullable< TsObjectViewSchema['table'] >['title'], I18nLabel | undefined >
>;

/** A minimal legal `object-grid` node: the two required keys and nothing else. */
const legal = { type: 'object-grid' as const, objectName: 'Contact' };

describe('ObjectGridSchema.title — mirrored face (objectui#6639)', () => {
  it('is a member of the mirror shape (membership cannot be read off acceptance under passthrough)', () => {
    expect(Object.keys(ObjectGridSchema.shape)).toContain('title');
  });

  it('accepts an authored string title and the value SURVIVES the parse', () => {
    const r = ObjectGridSchema.safeParse({ ...legal, title: 'All Contacts' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.title).toBe('All Contacts');
  });

  it('accepts an inline locale map title and the map SURVIVES the parse (objectui#10993)', () => {
    const map = { en: 'All Contacts', 'zh-CN': '全部联系人' };
    const r = ObjectGridSchema.safeParse({ ...legal, title: map });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    if (r.success) expect(r.data.title).toEqual(map);
  });

  it('object-view: the table slot, rebuilt from this shape, parses the same map (objectui#10993)', () => {
    const map = { en: 'All Contacts', 'zh-CN': '全部联系人' };
    const r = ObjectViewSchema.safeParse({ type: 'object-view', objectName: 'Contact', table: { title: map } });
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
    if (r.success) expect((r.data.table as { title?: unknown } | undefined)?.title).toEqual(map);
  });

  it('refuses a map whose entry is not a string AT the key (objectui#10993)', () => {
    // The spec's map is `Record<string, string>`: a nested value is judged,
    // not waved through as "some object".
    const r = ObjectGridSchema.safeParse({ ...legal, title: { en: 42 } });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('title');
    }
  });

  it('refuses a non-string title AT the key — the enforcement mirroring adds', () => {
    const r = ObjectGridSchema.safeParse({ ...legal, title: 123 });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('title');
    }
  });

  it('control: the same non-string under an UNDECLARED key is still admitted unexamined', () => {
    // The before-state, kept on purpose: `.passthrough()` admits an undeclared
    // key of any type. This is what `title: 123` did before the mirror declared
    // it — and it is why the refusal above measures the fix rather than the
    // base object's strictness.
    const r = ObjectGridSchema.safeParse({ ...legal, undeclaredControlKey6639: 123 });
    expect(r.success).toBe(true);
  });
});
