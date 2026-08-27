// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12015 — the storage/presentation split itself, pinned.
 *
 * The diagnostic in `SqlDriver` fires on what this module decides, so the
 * decision is worth more than the plumbing around it. Two claims live here:
 *
 * ① **The classification is exhaustive over `FieldSchema`.** A key added to
 *    the spec later fails the first case until someone classifies it — the
 *    whole point of keeping the table in one place. At runtime an unclassified
 *    key is silent (a diagnostic must never invent a warning it cannot
 *    justify), so without this pin an added key would default into silence
 *    with nothing to notice it.
 *
 * ② **Delivered means delivered.** A declared storage attribute the platform's
 *    own column already provides is NOT a disagreement and must not be
 *    reported as one — that is the whole content of the 2026-08-25 narrowing,
 *    and the case that makes the message true again.
 *
 * ③ **The delivery table speaks the SPEC's vocabulary** (#12131). Its `type`
 *    is compared with `===` against a declaration's `type`, so a knex builder
 *    name there is a cross-vocabulary comparison that no declaration can
 *    satisfy. `id` used to record `'string'` — the `table.string('id')`
 *    builder name — and reported all 45 correct `id: Field.text(...)`
 *    declarations in `@objectstack/platform-objects` as disagreements while
 *    `'string'` was not even authorable. The first case below now holds every
 *    entry to `FieldType`, so the class fails by name rather than by corpus.
 */

import { describe, it, expect } from 'vitest';
import { FieldSchema, FieldType } from '@objectstack/spec/data';
import {
  FIELD_KEY_STORAGE_CLASS,
  BUILTIN_COLUMN_DELIVERY,
  undeliveredStorageAttributes,
} from './builtin-column-collision.js';

/** Just the keys, for readability in the assertions below. */
const keysOf = (attrs: ReturnType<typeof undeliveredStorageAttributes>) => attrs.map((a) => a.key);

describe('the FieldSchema storage/presentation classification (#12015)', () => {
  it('classifies EVERY FieldSchema key, and invents none', () => {
    const declared = Object.keys(FieldSchema.shape).sort();
    const classified = Object.keys(FIELD_KEY_STORAGE_CLASS).sort();

    // A spec key with no classification: it would be silent at runtime, which
    // is safe but undeliberate. Classify it in `FIELD_KEY_STORAGE_CLASS`.
    expect(declared.filter((k) => !classified.includes(k)), 'unclassified FieldSchema key(s)').toEqual([]);
    // A classification with no spec key: dead weight that reads as coverage.
    expect(classified.filter((k) => !declared.includes(k)), 'classified key(s) FieldSchema does not declare').toEqual([]);
  });

  it('puts `required` on the PRESENTATION side — ADR-0113 makes it the WRITE contract, not a column constraint', () => {
    // The load-bearing classification: `required: true` appears on nearly every
    // platform object's `id`, the engine enforces it there exactly as anywhere
    // else, and calling it "discarded" is the false sentence this card removed.
    expect(FIELD_KEY_STORAGE_CLASS.required).toBe('presentation');
    // Its ADR-0113 sibling — the one that IS the column constraint.
    expect(FIELD_KEY_STORAGE_CLASS.storage).toBe('storage');
  });

  it('puts the honoured half on the presentation side and the column shape on the storage side', () => {
    for (const key of ['label', 'readonly', 'searchable', 'description', 'inlineHelpText', 'group', 'name']) {
      expect(FIELD_KEY_STORAGE_CLASS[key], `${key} is honoured on a builtin column`).toBe('presentation');
    }
    for (const key of ['type', 'maxLength', 'unique', 'defaultValue', 'multiple', 'expression']) {
      expect(FIELD_KEY_STORAGE_CLASS[key], `${key} shapes the physical column`).toBe('storage');
    }
  });

  it('⛔ spells every delivered `type` in the SPEC vocabulary, never a knex builder name (#12131)', () => {
    // The one that got away: `id` recorded `'string'`, the knex builder name,
    // and `undeliveredStorageAttributes` compares it with `===` against a
    // declaration's `type` — a spec `FieldType`. No declaration could match it
    // (`'string'` is absent from FieldType's 49 members and `FieldSchema`
    // refuses it), so every correct `id: Field.text(...)` was reported as a
    // disagreement: 45 of them on a stock boot of platform-objects.
    for (const [column, delivery] of Object.entries(BUILTIN_COLUMN_DELIVERY)) {
      expect(
        FieldType.options as readonly string[],
        `BUILTIN_COLUMN_DELIVERY.${column}.type must be a spec FieldType, not a builder name`,
      ).toContain(delivery.type);
    }
  });

  it('records what each builtin column actually delivers, read off the emitting lines', () => {
    // `table.string('id').primary()` — varchar(255), NOT NULL, unique, no
    // default. varchar canonicalizes to the field type `text`
    // (`canonicalizeSqlType('varchar(255)') === 'text'`, pinned in
    // `type-compat.test.ts`), so `text` is what this column DELIVERS — which
    // is why the platform's own `id: Field.text(...)` declarations agree with
    // it exactly (#12131).
    expect(BUILTIN_COLUMN_DELIVERY.id).toMatchObject({
      type: 'text', maxLength: 255, unique: true, notNull: true, defaultValue: null,
    });
    // `createAuditTimestampColumn` — a timestamp defaulted to the DB clock, left NULLABLE.
    for (const column of ['created_at', 'updated_at']) {
      expect(BUILTIN_COLUMN_DELIVERY[column]).toMatchObject({
        type: 'datetime', unique: false, notNull: false, defaultValue: 'NOW()',
      });
    }
  });
});

describe('what a declaration on a builtin column name loses (#12015)', () => {
  it('FIRES on the author error the card was filed for', () => {
    // `id: { type: 'number' }` — an author expecting a numeric key. This is
    // the real author error; ⛔ NOT `{ type: 'text' }`, which is what the
    // column delivers (see the silent case below).
    expect(keysOf(undeliveredStorageAttributes('id', { type: 'number' }))).toEqual(['type']);
    expect(keysOf(undeliveredStorageAttributes('id', { type: 'number', name: 'id' }))).toEqual(['type']);
    // …and names what the column really is, not just that something was lost.
    expect(undeliveredStorageAttributes('id', { type: 'number' })[0]).toMatchObject({
      key: 'type', declared: 'number', delivered: 'text',
    });
  });

  it('is SILENT for a presentation-only declaration — the platform honours that half', () => {
    // `sys_presence.id`, verbatim in shape: the population the pre-narrowing
    // warning was false about. ⚠️ It is `Field.text`, and this fixture used to
    // spell it `type: 'string'` — matching the delivery table's builder name
    // rather than the source. That made this case pass while the same
    // declaration as actually written warned (#12131). Verbatim now.
    expect(
      undeliveredStorageAttributes('id', { type: 'text', label: 'Presence ID', required: true, readonly: true }),
    ).toEqual([]);
    // The #11456 fixture's exact shape — the declaration that started #12015.
    // It asks for precisely what the column delivers, so it is SILENT; it was
    // reported as a disagreement until the delivery table was corrected.
    expect(undeliveredStorageAttributes('id', { type: 'text', name: 'id' })).toEqual([]);
    expect(
      undeliveredStorageAttributes('created_at', {
        type: 'datetime', label: 'Created At', defaultValue: 'NOW()', readonly: true,
      }),
    ).toEqual([]);
  });

  it('is SILENT for a storage attribute the column already delivers', () => {
    expect(undeliveredStorageAttributes('id', { type: 'text', maxLength: 255 })).toEqual([]);
    expect(undeliveredStorageAttributes('id', { type: 'text', unique: true })).toEqual([]);        // the PK is unique
    expect(undeliveredStorageAttributes('id', { type: 'text', storage: { notNull: true } })).toEqual([]); // the PK is NOT NULL
    expect(undeliveredStorageAttributes('created_at', { type: 'datetime', defaultValue: 'now()' })).toEqual([]); // token, case-insensitive
  });

  it('FIRES for a storage attribute the column does NOT deliver, one entry each', () => {
    expect(keysOf(undeliveredStorageAttributes('id', { type: 'text', maxLength: 12 }))).toEqual(['maxLength']);
    expect(keysOf(undeliveredStorageAttributes('id', { type: 'text', defaultValue: 'NOW()' }))).toEqual(['defaultValue']);
    // created_at IS nullable and NOT unique — asking for either is a real disagreement.
    expect(keysOf(undeliveredStorageAttributes('created_at', { type: 'datetime', unique: true }))).toEqual(['unique']);
    expect(keysOf(undeliveredStorageAttributes('created_at', { type: 'datetime', storage: { notNull: true } })))
      .toEqual(['storage.notNull']);
    // Several at once, in declaration order.
    expect(keysOf(undeliveredStorageAttributes('id', { type: 'number', maxLength: 12, unique: false })))
      .toEqual(['type', 'maxLength']);   // `unique: false` asks for nothing
  });

  it('ignores a field that is not a builtin column name at all', () => {
    expect(undeliveredStorageAttributes('region', { type: 'text', maxLength: 12 })).toEqual([]);
  });

  it('stays silent — never throws — on a key it does not know, and on a malformed declaration', () => {
    // Forward compatibility: an unclassified key cannot invent a warning. The
    // exhaustiveness case above is what makes its arrival visible.
    expect(undeliveredStorageAttributes('id', { type: 'text', someFutureKey: 'x' } as any)).toEqual([]);
    expect(undeliveredStorageAttributes('id', undefined)).toEqual([]);
    expect(undeliveredStorageAttributes('id', null as any)).toEqual([]);
  });
});
