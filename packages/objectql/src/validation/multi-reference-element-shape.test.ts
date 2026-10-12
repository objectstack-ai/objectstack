// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22908] Each element of a multi-valued `lookup` / `user` / `file` / `image`
 * is held to the single value's stored form (ADR-0104 D1).
 *
 * The multi-value branch of `validateOne` returned early for these four types
 * ("reference integrity is handled elsewhere"), so an element was never parsed
 * against `valueSchemaFor`'s `z.array(element)`. An embedded record `[{ id }]`,
 * `[false]` and `[42]` were admitted on a deployment whose single-valued field
 * refuses the same three with `invalid_type`. The fix hands those types to the
 * ADR-0104 arm the single value goes through, so what is pinned here is that
 * a multi-valued element answers EXACTLY what a single value answers: the same
 * refusal under the same posture, the same warn-first admission and sink when
 * the posture is lenient, the same gate split between media and references,
 * and the scan's predicate agreeing with the write path.
 */

import { describe, it, expect } from 'vitest';
import { validateRecord, validateRecordInScope, valueShapeViolation, ValidationError } from './record-validator.js';

const schema = {
  fields: {
    team: { type: 'lookup', reference: 'account', multiple: true },
    watchers: { type: 'user', reference: 'sys_user', multiple: true },
    attachments: { type: 'file', multiple: true },
    gallery: { type: 'image', multiple: true },
    owner: { type: 'lookup', reference: 'account' },
    assignee: { type: 'user', reference: 'sys_user' },
    stamped_team: { type: 'lookup', reference: 'account', multiple: true, readonly: true },
  },
};

/** The card's three wrong shapes, each as the single value a single-valued field would get. */
const WRONG = { boolean: false, number: 42, 'embedded-record': { id: 'acc_1', name: 'Acme' } } as const;

const STRICT_REFS = { valueShapeStrict: true };
const STRICT_MEDIA = { mediaValueShapeStrict: true };

/** The one refusal a write answered; fails the test if the write was admitted. */
function refusalOf(run: () => void): ValidationError {
  try {
    run();
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationError);
    return e as ValidationError;
  }
  throw new Error('expected the write to be refused, but it was admitted');
}

describe('[#22908] a multi-valued reference element of the wrong shape is refused like a single value', () => {
  for (const field of ['team', 'watchers'] as const) {
    for (const [kind, element] of Object.entries(WRONG)) {
      for (const mode of ['insert', 'update'] as const) {
        it(`${field} (${schema.fields[field].type}, multiple): [${kind}] on ${mode} answers invalid_type naming the field`, () => {
          const err = refusalOf(() => validateRecord(schema, { [field]: [element] }, mode, STRICT_REFS));
          expect(err.code).toBe('VALIDATION_FAILED');
          expect(err.fields).toHaveLength(1);
          expect(err.fields[0]).toMatchObject({ field, code: 'invalid_type' });
          expect(err.fields[0]?.constraint).toMatchObject({ type: schema.fields[field].type });
          expect(String(err.fields[0]?.constraint?.detail)).toContain('index 0');
        });
      }
    }
  }

  it('names the index of the element that is wrong, not the first one', () => {
    const err = refusalOf(() =>
      validateRecord(schema, { team: ['acc_1', 'acc_2', { id: 'acc_3' }] }, 'insert', STRICT_REFS),
    );
    expect(err.fields[0]).toMatchObject({ field: 'team', code: 'invalid_type' });
    expect(String(err.fields[0]?.constraint?.detail)).toContain('index 2');
  });

  it('CONTROL: the single-valued rows are unchanged — the same three refused, with no index named', () => {
    for (const field of ['owner', 'assignee'] as const) {
      for (const element of Object.values(WRONG)) {
        const err = refusalOf(() => validateRecord(schema, { [field]: element }, 'insert', STRICT_REFS));
        expect(err.fields[0]).toMatchObject({ field, code: 'invalid_type' });
        expect(String(err.fields[0]?.constraint?.detail)).not.toContain('index');
      }
    }
  });

  it('CONTROL: a well-formed id array is accepted, and so is the empty array', () => {
    for (const mode of ['insert', 'update'] as const) {
      expect(() =>
        validateRecord(schema, { team: ['acc_1', 'acc_2'], watchers: ['usr_1'] }, mode, STRICT_REFS),
      ).not.toThrow();
      expect(() => validateRecord(schema, { team: [], watchers: [] }, mode, STRICT_REFS)).not.toThrow();
    }
  });

  it('a non-array is still the array refusal, before any element is read', () => {
    const err = refusalOf(() => validateRecord(schema, { team: { id: 'acc_1' } }, 'update', STRICT_REFS));
    expect(err.fields[0]).toMatchObject({ field: 'team', code: 'invalid_type' });
    expect(err.fields[0]?.constraint).toBeUndefined();
  });

  it('a readonly multi-valued reference is judged by its shape too, as a readonly single value is', () => {
    const err = refusalOf(() =>
      validateRecordInScope(schema, { stamped_team: [{ id: 'acc_1' }] }, 'update', 'only', STRICT_REFS),
    );
    expect(err.fields[0]).toMatchObject({ field: 'stamped_team', code: 'invalid_type' });
  });
});

describe('[#22908] the multi-valued element answers to the single value\'s posture', () => {
  it('warn-first (the posture a deployment holds before its evidence): admitted and reported to the sink', () => {
    const admitted: Array<{ gate: string; field: string; type: string; detail: string }> = [];
    expect(() =>
      validateRecord(
        schema,
        { team: [{ id: 'acc_1' }], watchers: [false], attachments: ['https://cdn/x.pdf'] },
        'insert',
        { onAdmittedValueShapeViolation: (v) => admitted.push(v) },
      ),
    ).not.toThrow();
    expect(admitted.map((v) => [v.gate, v.field, v.type])).toEqual([
      ['value-shape', 'team', 'lookup'],
      ['value-shape', 'watchers', 'user'],
      ['media', 'attachments', 'file'],
    ]);
    expect(admitted.every((v) => v.detail.includes('index 0'))).toBe(true);
  });

  it('the media flag opens media elements only, and the value-shape flag reference elements only', () => {
    // A verified file migration is no evidence about a lookup id, and the reverse.
    expect(() => validateRecord(schema, { team: [{ id: 'acc_1' }] }, 'insert', STRICT_MEDIA)).not.toThrow();
    expect(() => validateRecord(schema, { attachments: ['https://cdn/x.pdf'] }, 'insert', STRICT_REFS)).not.toThrow();
  });

  it('the declared escape hatch re-opens reference elements on a verified deployment', () => {
    process.env.OS_ALLOW_LAX_VALUE_SHAPES = '1';
    try {
      expect(() => validateRecord(schema, { team: [{ id: 'acc_1' }] }, 'insert', STRICT_REFS)).not.toThrow();
    } finally {
      delete process.env.OS_ALLOW_LAX_VALUE_SHAPES;
    }
  });
});

describe('[#22908] a multi-valued file / image element is held to its own stored form', () => {
  // `valueSchemaFor` gives each type its own element: an opaque `sys_file` id
  // for the media types, which bounds the charset (a reference id does not).
  for (const field of ['attachments', 'gallery'] as const) {
    it(`${field} (${schema.fields[field].type}, multiple): a wrong element answers invalid_type; a sys_file id array is accepted`, () => {
      for (const element of [...Object.values(WRONG), 'https://cdn/x.png', { id: 'file_01', url: 'https://cdn/x.png' }]) {
        const err = refusalOf(() => validateRecord(schema, { [field]: ['file_01', element] }, 'insert', STRICT_MEDIA));
        expect(err.fields[0]).toMatchObject({ field, code: 'invalid_type' });
        expect(String(err.fields[0]?.constraint?.detail)).toContain('index 1');
      }
      expect(() => validateRecord(schema, { [field]: ['file_01', 'file_02'] }, 'insert', STRICT_MEDIA)).not.toThrow();
    });
  }
});

describe('[#22908] the scan counts exactly what the strict write path refuses', () => {
  // `os migrate value-shapes` imports `valueShapeViolation` so the flag it
  // records attests what strict mode rejects. Before this change it counted a
  // multi-valued element the write path admitted.
  const probes: unknown[] = [[false], [42], [{ id: 'acc_1' }], ['acc_1', { id: 'acc_2' }], ['acc_1', 'acc_2'], []];
  for (const field of ['team', 'watchers'] as const) {
    it(`${field}: the scan predicate and the strict write path agree on every probe`, () => {
      const def = schema.fields[field];
      for (const value of probes) {
        const scanned = valueShapeViolation(def, value);
        let refused: string | undefined;
        try {
          validateRecord(schema, { [field]: value }, 'insert', STRICT_REFS);
        } catch (e) {
          refused = String((e as ValidationError).fields[0]?.constraint?.detail);
        }
        expect(refused, JSON.stringify(value)).toBe(scanned ?? undefined);
      }
    });
  }
});
