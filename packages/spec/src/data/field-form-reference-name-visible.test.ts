// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #29462 — the field form offers `referenceNameVisible` on `lookup` and `user`
 * fields, and on no other type (director ruling 6574398310, letter B).
 *
 * The key is served (`$expand` answers `{ id, name, readRefused: true }` for a
 * target the reader is refused) and drawn (the console's lookup and user cells
 * show that name as text, with no link), so the form row replaces the `omit`
 * entry `metadata-form-zod-reconciliation.test.ts` carried while it was
 * neither. The row's `visibleWhen` is also the key's parse gate: `FieldSchema`
 * refuses the key on every other type, an authored `false` included, so a row
 * shown on any other type would offer a value the save refuses. The set the
 * row is shown on is therefore read off the predicate and held equal to the
 * set the schema accepts, over every `FieldType`.
 */

import { describe, it, expect } from 'vitest';

import { fieldForm } from './field.form';
import { FieldSchema, FieldType } from './field.zod';

type Predicate = string | { dialect?: string; source?: string } | undefined;
type FormEntry = { field?: string; visibleWhen?: Predicate; fields?: FormEntry[] };

/** Every entry of the form, nested composite / list members included. */
function allEntries(): FormEntry[] {
  const out: FormEntry[] = [];
  const walk = (entries: FormEntry[] | undefined) => {
    for (const e of entries ?? []) {
      out.push(e);
      walk(e.fields);
    }
  };
  for (const section of (fieldForm as { sections: { fields?: FormEntry[] }[] }).sections) {
    walk(section.fields);
  }
  return out;
}

function sourceOf(predicate: Predicate): string | undefined {
  return typeof predicate === 'string' ? predicate : predicate?.source;
}

/**
 * The field types a `data.type in [...]` predicate shows its row on. Any other
 * predicate shape answers `null`, so a rewrite into a form this reader does not
 * know fails the test instead of being read as "no type".
 */
function typesShownBy(source: string | undefined): string[] | null {
  const match = /^data\.type in \[((?:'[a-z_]+',?)+)\]$/.exec(source ?? '');
  if (!match) return null;
  return match[1]!.split(',').map((quoted) => quoted.replace(/'/g, ''));
}

const rows = () => allEntries().filter((e) => e.field === 'referenceNameVisible');

describe('field form: the referenceNameVisible row', () => {
  it('is declared once, at the top level of the form', () => {
    // Positive control: the walk reaches the reference rows beside it.
    expect(allEntries().some((e) => e.field === 'reference')).toBe(true);
    expect(rows()).toHaveLength(1);
  });

  it('is shown on lookup and user, and on no other field type', () => {
    const shown = typesShownBy(sourceOf(rows()[0]?.visibleWhen));
    expect(shown, 'the predicate is a data.type in [...] list').not.toBeNull();
    expect([...shown!].sort()).toEqual(['lookup', 'user']);
    const offered = FieldType.options.filter((type) => shown!.includes(type));
    expect(offered.sort()).toEqual(['lookup', 'user']);
  });

  it('is shown exactly where FieldSchema accepts the key, over every field type', () => {
    const shown = new Set(typesShownBy(sourceOf(rows()[0]?.visibleWhen)) ?? []);
    const accepted = FieldType.options.filter((type) => {
      const parsed = FieldSchema.safeParse({ type, label: 'Owner', referenceNameVisible: true });
      return parsed.success || !parsed.error.issues.some((i) => i.path[0] === 'referenceNameVisible');
    });
    // CONTROL: the schema does refuse the key somewhere, so the set is a real cut.
    expect(accepted.length).toBeLessThan(FieldType.options.length);
    expect([...accepted].sort()).toEqual([...shown].sort());
  });
});
