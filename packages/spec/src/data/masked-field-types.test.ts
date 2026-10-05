// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20141] The masked-on-read field-type declaration (ADR-0100): its content,
 * its vocabulary, its immutability, and the predicate that reads it.
 *
 * The content pin restates the table on purpose. Importing the constant to
 * check the constant would be green by construction; which stored values leave
 * the engine in clear is a security decision, so an edit to the table must
 * show up here as a red line someone has to read.
 */

import { describe, it, expect } from 'vitest';

import { FieldType } from './field.zod';
import { ObjectSchema } from './object.zod';
import { MASKED_ON_READ_FIELD_TYPES, isMaskedOnReadFieldType } from './masked-field-types';

const FIELD_TYPES: readonly string[] = FieldType.options;
const MANAGED_BY_BUCKETS: readonly string[] = (
  ObjectSchema.shape.managedBy as unknown as { unwrap(): { options: readonly string[] } }
).unwrap().options;

describe('MASKED_ON_READ_FIELD_TYPES — the declaration (ADR-0100)', () => {
  it('declares exactly `secret` (always) and `password` (exempt on better-auth objects)', () => {
    expect(JSON.parse(JSON.stringify(MASKED_ON_READ_FIELD_TYPES))).toEqual({
      secret: { exemptManagedBy: [] },
      password: { exemptManagedBy: ['better-auth'] },
    });
  });

  it('every key is a FieldType member', () => {
    expect(FIELD_TYPES.length).toBeGreaterThan(40); // the enum really was read
    for (const type of Object.keys(MASKED_ON_READ_FIELD_TYPES)) {
      expect(FIELD_TYPES).toContain(type);
    }
  });

  it('every exemption is a value ObjectSchema.managedBy declares', () => {
    expect(MANAGED_BY_BUCKETS).toContain('better-auth'); // the enum really was read
    for (const rule of Object.values(MASKED_ON_READ_FIELD_TYPES)) {
      for (const bucket of rule!.exemptManagedBy) {
        expect(MANAGED_BY_BUCKETS).toContain(bucket);
      }
    }
  });

  it('is deep-frozen: no consumer can change what another one masks', () => {
    expect(Object.isFrozen(MASKED_ON_READ_FIELD_TYPES)).toBe(true);
    for (const rule of Object.values(MASKED_ON_READ_FIELD_TYPES)) {
      expect(Object.isFrozen(rule)).toBe(true);
      expect(Object.isFrozen(rule!.exemptManagedBy)).toBe(true);
    }
    expect(() => {
      (MASKED_ON_READ_FIELD_TYPES.password!.exemptManagedBy as string[]).push('platform');
    }).toThrow(TypeError);
    expect(MASKED_ON_READ_FIELD_TYPES.password!.exemptManagedBy).toEqual(['better-auth']);
  });
});

describe('isMaskedOnReadFieldType — the one reading of the declaration', () => {
  const MANAGED_BY: readonly unknown[] = [...MANAGED_BY_BUCKETS, undefined, null, 'system', 'not-a-bucket'];

  it('answers every FieldType × managedBy cell: secret always, password unless better-auth, nothing else', () => {
    let cells = 0;
    for (const type of FIELD_TYPES) {
      for (const managedBy of MANAGED_BY) {
        const expected = type === 'secret' || (type === 'password' && managedBy !== 'better-auth');
        expect(isMaskedOnReadFieldType(type, managedBy), `${type} × ${String(managedBy)}`).toBe(expected);
        cells += 1;
      }
    }
    expect(cells).toBe(FIELD_TYPES.length * MANAGED_BY.length);
  });

  it('agrees with the table cell for cell (the predicate derives, it does not restate)', () => {
    for (const type of FIELD_TYPES) {
      for (const managedBy of MANAGED_BY) {
        const rule = (MASKED_ON_READ_FIELD_TYPES as Record<string, { exemptManagedBy: readonly unknown[] }>)[type];
        const fromTable = Object.prototype.hasOwnProperty.call(MASKED_ON_READ_FIELD_TYPES, type)
          && !rule.exemptManagedBy.includes(managedBy);
        expect(isMaskedOnReadFieldType(type, managedBy), `${type} × ${String(managedBy)}`).toBe(fromTable);
      }
    }
  });

  it('is total over unvalidated input: non-strings, prototype keys and case variants are not masked types', () => {
    for (const type of [undefined, null, 42, ['secret'], { toString: () => 'secret' }, '', 'constructor',
      'toString', '__proto__', 'hasOwnProperty', 'SECRET', 'Password']) {
      expect(isMaskedOnReadFieldType(type, undefined), String(type)).toBe(false);
    }
  });

  it('fails closed on managedBy: an unlisted or malformed bucket never exempts', () => {
    for (const managedBy of ['Better-Auth', 'better-auth ', ['better-auth'], 0, true]) {
      expect(isMaskedOnReadFieldType('password', managedBy), String(managedBy)).toBe(true);
    }
  });
});
