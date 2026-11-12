// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { FieldType } from '@objectstack/spec/data';
import { SysSecret } from '@objectstack/platform-objects/system';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_SEAL_TYPE_RULES,
  CanonicalFormError,
  CanonicalJsonError,
  SecretCoordinateBoundError,
  canonRuleOf,
  canonicalJson,
  canonicalValue,
  checkpointSeedContext,
  commitValue,
  signingKeyContext,
  unsealableColumns,
} from './index.js';

/**
 * ADR-0154 D1, open question 1 ruled A widened (seat ruling Q5 (a)): every
 * declared column type has one canonical spelling, or none — and an object
 * with a column of no rule is not sealed. Both spellings a driver hands back
 * are pinned per rule.
 */

const refused = (value: unknown, type: string, extra: Record<string, unknown> = {}) =>
  expect(() => canonicalValue(value, { type, ...extra }, 'r.c')).toThrow(CanonicalFormError);

describe('the rule table (Q5 (a))', () => {
  it('names every FieldType, and nothing else', () => {
    expect(Object.keys(AUDIT_SEAL_TYPE_RULES).sort()).toEqual([...FieldType.options].sort());
  });

  it('has no rule for a secret, a computed column or a file reference', () => {
    const none = Object.entries(AUDIT_SEAL_TYPE_RULES).filter(([, rule]) => rule === null).map(([type]) => type).sort();
    expect(none).toEqual(['audio', 'avatar', 'file', 'formula', 'image', 'password', 'secret', 'summary', 'video']);
  });

  it('reads a multi-value text column as json', () => {
    expect(canonRuleOf({ type: 'lookup' })).toBe('text');
    expect(canonRuleOf({ type: 'lookup', multiple: true })).toBe('json');
    expect(canonRuleOf({ type: 'select', multiple: true })).toBe('json');
  });

  it('has no rule for a type it does not know, or a column with no type', () => {
    expect(canonRuleOf({ type: 'hologram' })).toBeNull();
    expect(canonRuleOf({})).toBeNull();
    expect(canonRuleOf(undefined)).toBeNull();
  });
});

describe('each rule, in both spellings', () => {
  it('number: a JS number and the decimal text an exact-decimal column reads back as', () => {
    for (const type of ['number', 'currency', 'percent', 'rating', 'slider', 'progress']) {
      expect(canonicalValue(12.5, { type })).toBe(12.5);
      expect(canonicalValue('12.50', { type })).toBe(12.5);
    }
    expect(canonicalValue(42n, { type: 'number' })).toBe(42);
    expect(canonicalValue('0.30000000000000004', { type: 'number' })).toBe(0.30000000000000004);
    expect(canonicalValue('-0', { type: 'number' })).toBe(0);
    expect(canonicalValue('1e3', { type: 'number' })).toBe(1000);
  });

  it('number: refuses a non-finite, an unsafe integer, a decimal text a double cannot carry, and a non-number', () => {
    refused(Number.POSITIVE_INFINITY, 'number');
    refused(Number.NaN, 'currency');
    refused(2 ** 53, 'number');
    refused('9007199254740993', 'number');
    refused(2n ** 60n, 'number');
    refused('0.1000000000000000055511151231257827', 'number');
    refused('twelve', 'number');
    refused(true, 'percent');
  });

  it('boolean: true/false, and a driver 1/0 or "1"/"0"', () => {
    for (const type of ['boolean', 'toggle']) {
      expect([true, 1, '1'].map((v) => canonicalValue(v, { type }))).toEqual([true, true, true]);
      expect([false, 0, '0'].map((v) => canonicalValue(v, { type }))).toEqual([false, false, false]);
    }
    refused('yes', 'boolean');
  });

  it('date (Q7 (a)): YYYY-MM-DD text, and a Date only at UTC midnight', () => {
    expect(canonicalValue('2026-11-10', { type: 'date' })).toBe('2026-11-10');
    expect(canonicalValue(new Date('2026-11-10T00:00:00.000Z'), { type: 'date' })).toBe('2026-11-10');
  });

  it('date (Q7 (a)): refuses a Date off UTC midnight, an impossible day, a datetime text and a number', () => {
    refused(new Date('2026-11-10T08:00:00.000Z'), 'date');
    refused(new Date('2026-11-09T16:00:00.000Z'), 'date'); // midnight in UTC+8 is not a UTC day
    refused('2026-02-30', 'date');
    refused('2026-11-10T00:00:00.000Z', 'date');
    refused(Date.UTC(2026, 10, 10), 'date');
  });

  it('datetime: every driver spelling of one instant to one ISO text', () => {
    const at = '2026-11-10T05:06:07.089Z';
    for (const raw of [new Date(at), at, '2026-11-10 05:06:07.089', Date.parse(at)]) {
      expect(canonicalValue(raw, { type: 'datetime' })).toBe(at);
    }
  });

  it('json: the text a JSON column reads back as on SQLite, and the parsed value on PostgreSQL', () => {
    for (const type of ['json', 'multiselect', 'tags', 'address', 'repeater', 'vector']) {
      const parsed = type === 'vector' ? [0.5, 1] : { a: [1, 'x'] };
      expect(canonicalValue(JSON.stringify(parsed), { type })).toEqual(parsed);
      expect(canonicalValue(parsed, { type })).toEqual(parsed);
    }
    expect(canonicalValue('["a","b"]', { type: 'lookup', multiple: true })).toEqual(['a', 'b']);
    refused('{not json', 'json');
  });

  it('text: a string, and nothing else', () => {
    expect(canonicalValue('09:30:00', { type: 'time' })).toBe('09:30:00');
    expect(canonicalValue('usr_1', { type: 'lookup' })).toBe('usr_1');
    refused(12, 'text');
    refused(['a'], 'lookup');
  });

  it('absent and null are null under every rule', () => {
    for (const type of ['text', 'number', 'boolean', 'date', 'datetime', 'json']) {
      expect(canonicalValue(undefined, { type })).toBeNull();
      expect(canonicalValue(null, { type })).toBeNull();
    }
  });

  it('refuses every value of a type with no rule, null included', () => {
    for (const type of ['secret', 'formula', 'file']) {
      refused('x', type);
      refused(null, type);
    }
  });
});

describe('an object with a column of no rule is not sealed', () => {
  it('lists each such column, clear or committed, with its type', () => {
    const types = { id: { type: 'text' }, created_at: { type: 'datetime' }, total: { type: 'formula' }, note: { type: 'secret' }, extra: {} };
    expect(unsealableColumns({ clear: ['created_at', 'extra', 'id', 'total'], committed: ['note'] }, types)).toEqual([
      { column: 'extra', type: null },
      { column: 'note', type: 'secret' },
      { column: 'total', type: 'formula' },
    ]);
  });
});

describe('a committed value names no member of its own in a refusal (round-1 n2)', () => {
  it("writes a committed JSON value's member names by position, and names the column", () => {
    const payload = { 'patient-hiv-status': Number.NaN };
    let message = '';
    try {
      commitValue(Buffer.alloc(32), payload, 'r1.metadata');
    } catch (err) {
      expect(err).toBeInstanceOf(CanonicalJsonError);
      message = (err as Error).message;
    }
    expect(message).toContain('r1.metadata.#0');
    expect(message).not.toContain('patient-hiv-status');
  });

  it('still names members in a clear value, where nothing is kept off the log', () => {
    expect(() => canonicalJson({ status: Number.NaN })).toThrow(/\$\.status/);
  });
});

describe('a seed coordinate fits the sys_secret columns that hold it (n3, Q6 (a))', () => {
  it("reads the bound off sys_secret's own declaration", () => {
    expect((SysSecret.fields.namespace as { maxLength?: number }).maxLength).toBe(128);
    expect((SysSecret.fields.key as { maxLength?: number }).maxLength).toBe(128);
  });

  it('builds a coordinate at the bound, and refuses one over it, before anything is sealed', () => {
    const atBound = 'o'.repeat(128 - '["",0]'.length);
    expect(checkpointSeedContext('sys_audit_log', atBound, 0).key).toHaveLength(128);
    expect(() => checkpointSeedContext('sys_audit_log', `${atBound}x`, 0)).toThrow(SecretCoordinateBoundError);
    expect(() => checkpointSeedContext('x'.repeat(129), null, 0)).toThrow(SecretCoordinateBoundError);
    expect(() => signingKeyContext('f'.repeat(129))).toThrow(SecretCoordinateBoundError);
  });
});
