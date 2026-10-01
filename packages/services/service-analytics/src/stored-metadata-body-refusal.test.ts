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
