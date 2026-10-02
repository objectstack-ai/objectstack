// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21120] The analytics door's stored-metadata-body refusal. A query naming the
 * stored body column of `sys_metadata` / `sys_metadata_history` as a member is
 * refused with the invalid-member envelope (`INVALID_FIELD` / 400) every other
 * analytics member refusal answers — never evaluated, because evaluating it (a
 * group key, a filter oracle, a sort over the stored bytes) discloses a withheld
 * credential.
 */

import { describe, expect, it } from 'vitest';
import {
  storedMetadataBodyAnalyticsRefusal,
  type NamedAnalyticsField,
} from './stored-metadata-body-refusal.js';

const field = (object: string, name: string, role: 'aggregate' | 'predicate'): NamedAnalyticsField => ({
  object,
  field: name,
  role,
});

describe('storedMetadataBodyAnalyticsRefusal', () => {
  it('refuses a dimension/aggregate on the body column (INVALID_FIELD / 400, param dimensions)', () => {
    const err = storedMetadataBodyAnalyticsRefusal([field('sys_metadata', 'metadata', 'aggregate')]) as any;
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('INVALID_FIELD');
    expect(err.status).toBe(400);
    expect(err.field).toBe('metadata');
    expect(err.object).toBe('sys_metadata');
    expect(err.param).toBe('dimensions');
  });

  it('refuses a filter/sort/predicate on the body column (param where)', () => {
    const err = storedMetadataBodyAnalyticsRefusal([field('sys_metadata_history', 'metadata', 'predicate')]) as any;
    expect(err?.code).toBe('INVALID_FIELD');
    expect(err?.param).toBe('where');
    expect(err?.object).toBe('sys_metadata_history');
  });

  it('allows every scalar member of a stored-body object', () => {
    expect(
      storedMetadataBodyAnalyticsRefusal([
        field('sys_metadata', 'type', 'aggregate'),
        field('sys_metadata', 'name', 'predicate'),
        field('sys_metadata', 'scope', 'aggregate'),
      ]),
    ).toBeUndefined();
  });

  it('ignores the body column on an object outside the family', () => {
    expect(storedMetadataBodyAnalyticsRefusal([field('showcase_task', 'metadata', 'aggregate')])).toBeUndefined();
    expect(storedMetadataBodyAnalyticsRefusal([])).toBeUndefined();
  });

  it('leaves a member that names no field (an authored expression) to the field gate', () => {
    // The field-level gate refuses an expression member itself; this refusal
    // judges attributable fields only, so it adds no second rule for them.
    expect(
      storedMetadataBodyAnalyticsRefusal([{ object: 'sys_metadata', member: 'derived', expression: true, declared: true }]),
    ).toBeUndefined();
  });

  it('refuses when the body column appears among other admissible members', () => {
    const err = storedMetadataBodyAnalyticsRefusal([
      field('sys_metadata', 'type', 'aggregate'),
      field('sys_metadata', 'metadata', 'aggregate'),
    ]) as any;
    expect(err?.field).toBe('metadata');
  });
});

/**
 * [#21207] The two stored content-hash columns of the same tables (`checksum`,
 * and the history table's `previous_checksum`). Each is a hash over the WHOLE
 * stored body, withheld credential material included, so a dimension serves an
 * offline verifier and a filter is an online one. They are refused in the same
 * envelope as the body column, in either role, on both tables.
 */
describe('storedMetadataBodyAnalyticsRefusal — the content-hash columns (#21207)', () => {
  const HASH_COLUMNS: Array<[string, string]> = [
    ['sys_metadata', 'checksum'],
    ['sys_metadata_history', 'checksum'],
    ['sys_metadata_history', 'previous_checksum'],
  ];
  for (const [object, column] of HASH_COLUMNS) {
    it(`refuses '${column}' on ${object} as a dimension or measure (INVALID_FIELD / 400, param dimensions)`, () => {
      const err = storedMetadataBodyAnalyticsRefusal([field(object, column, 'aggregate')]) as any;
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe('INVALID_FIELD');
      expect(err.status).toBe(400);
      expect(err.field).toBe(column);
      expect(err.object).toBe(object);
      expect(err.param).toBe('dimensions');
      // The refusal names the usable columns.
      expect(err.message).toContain("'type'");
    });

    it(`refuses '${column}' on ${object} as a filter or sort (param where)`, () => {
      const err = storedMetadataBodyAnalyticsRefusal([field(object, column, 'predicate')]) as any;
      expect(err?.code).toBe('INVALID_FIELD');
      expect(err?.status).toBe(400);
      expect(err?.field).toBe(column);
      expect(err?.param).toBe('where');
    });
  }

  it('leaves a `checksum` column on an object outside the family alone', () => {
    expect(storedMetadataBodyAnalyticsRefusal([field('file_blob', 'checksum', 'aggregate')])).toBeUndefined();
    expect(storedMetadataBodyAnalyticsRefusal([field('file_blob', 'previous_checksum', 'predicate')])).toBeUndefined();
  });
});

describe('storedMetadataBodyAnalyticsRefusal — the history change note (#21207)', () => {
  it('refuses the change note, which can quote a stored hash, in either role', () => {
    for (const role of ['aggregate', 'predicate'] as const) {
      const err = storedMetadataBodyAnalyticsRefusal([field('sys_metadata_history', 'change_note', role)]) as any;
      expect(err?.code).toBe('INVALID_FIELD');
      expect(err?.status).toBe(400);
      expect(err?.field).toBe('change_note');
    }
  });
});
