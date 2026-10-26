/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12297 — the deadline semantic, `dueLike` and `settledWhen`, is typed
 * on `DateFieldMetadata` and `DateTimeFieldMetadata` BY REFERENCE to
 * `@objectstack/spec`'s `FieldSchema`, the convention `visibleWhen` and
 * `currencyConfig` already follow in `field-types.ts`.
 *
 *  - The type half is an exact `Equal` against `SpecField[KEY]`, read by this
 *    package's `type-check` through `tsconfig.test.json`. An exact equality,
 *    not an assignment: a local `boolean` happens to equal the spec's type
 *    today, and only the reference keeps it equal when the spec moves.
 *  - CONTROL: a non-deadline field type (`time`, `text`) carries neither key,
 *    and a fresh literal carrying one is refused.
 *  - The runtime half reads the installed spec, so "the spec declares both
 *    keys on a date field" and "the spec refuses them elsewhere" are
 *    re-derived on every run.
 *
 * Not pinned here: whether a renderer reads either key. `settledWhen` is
 * declared and not yet read; the read is objectui#11815.
 */
import { describe, it, expect } from 'vitest';
import { FieldSchema, type Field as SpecField } from '@objectstack/spec/data';
import type {
  DateFieldMetadata,
  DateTimeFieldMetadata,
  TextFieldMetadata,
  TimeFieldMetadata,
} from '../field-types.js';

type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

// ── Declared by reference ────────────────────────────────────────────────────

export type assertionDeadlineByReference = [
  Expect<Equal<DateFieldMetadata['dueLike'], SpecField['dueLike']>>,
  Expect<Equal<DateFieldMetadata['settledWhen'], SpecField['settledWhen']>>,
  Expect<Equal<DateTimeFieldMetadata['dueLike'], SpecField['dueLike']>>,
  Expect<Equal<DateTimeFieldMetadata['settledWhen'], SpecField['settledWhen']>>,
];

/** CONTROL: the keys live on the two deadline types only. */
export type assertionNotOnOtherTypes = [
  Expect<Equal<'dueLike' extends keyof TimeFieldMetadata ? true : false, false>>,
  Expect<Equal<'settledWhen' extends keyof TimeFieldMetadata ? true : false, false>>,
  Expect<Equal<'dueLike' extends keyof TextFieldMetadata ? true : false, false>>,
  Expect<Equal<'settledWhen' extends keyof TextFieldMetadata ? true : false, false>>,
];

export const _dateDeadline: DateFieldMetadata = {
  type: 'date',
  name: 'due_date',
  dueLike: true,
  settledWhen: "record.status == 'done'",
};

export const _datetimeDeadlineEnvelope: DateTimeFieldMetadata = {
  type: 'datetime',
  name: 'respond_by',
  dueLike: true,
  settledWhen: { dialect: 'cel', source: "record.status == 'closed'" },
};

export const _timeRefusesDueLike: TimeFieldMetadata = {
  type: 'time',
  name: 'opens_at',
  // @ts-expect-error — objectui#12297: `dueLike` is a `date` / `datetime` key only
  dueLike: true,
};

export const _textRefusesSettledWhen: TextFieldMetadata = {
  type: 'text',
  name: 'status_note',
  // @ts-expect-error — objectui#12297: `settledWhen` is a `date` / `datetime` key only
  settledWhen: "record.status == 'done'",
};

// ── The installed spec ───────────────────────────────────────────────────────

/** Whether the parse failed with an issue at `path`. */
function refusedAt(res: ReturnType<typeof FieldSchema.safeParse>, path: string): boolean {
  if (res.success) return false;
  return res.error.issues.some((i) => i.path.join('.') === path);
}

describe('installed @objectstack/spec — the deadline keys (objectui#12297)', () => {
  it('accepts both keys, in both wire shapes, on a date and a datetime field', () => {
    expect(FieldSchema.safeParse(_dateDeadline).success).toBe(true);
    expect(FieldSchema.safeParse(_datetimeDeadlineEnvelope).success).toBe(true);
  });

  it('refuses `dueLike` on a non-deadline type, with a minimal field of that type as the control', () => {
    expect(FieldSchema.safeParse({ type: 'time', name: 'f' }).success).toBe(true);
    expect(refusedAt(FieldSchema.safeParse({ type: 'time', name: 'f', dueLike: true }), 'dueLike')).toBe(true);
  });

  it('refuses `settledWhen` without `dueLike: true`, and accepts the same field with it', () => {
    const settled = { type: 'date', name: 'f', settledWhen: "record.status == 'done'" };
    expect(refusedAt(FieldSchema.safeParse(settled), 'settledWhen')).toBe(true);
    expect(FieldSchema.safeParse({ ...settled, dueLike: true }).success).toBe(true);
  });
});
