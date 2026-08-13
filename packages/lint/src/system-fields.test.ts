// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { FIELD_GROUP_SYSTEM_FIELDS, unprovisionedInjectedColumns } from '@objectstack/spec/data';
import { SystemFieldName } from '@objectstack/spec/system';
import { SYSTEM_FIELDS, unprovisionedInjectedColumnsFor } from './system-fields.js';

describe('SYSTEM_FIELDS (#4330)', () => {
  it('contains every member of both spec declarations — the derivation is complete', () => {
    for (const f of FIELD_GROUP_SYSTEM_FIELDS) {
      expect(SYSTEM_FIELDS.has(f), f).toBe(true);
    }
    for (const f of Object.values(SystemFieldName)) {
      expect(SYSTEM_FIELDS.has(f), f).toBe(true);
    }
  });

  it('contains nothing BEYOND the two spec declarations — additions go to the spec, not here', () => {
    const declared = new Set<string>([
      ...FIELD_GROUP_SYSTEM_FIELDS,
      ...Object.values(SystemFieldName),
    ]);
    for (const f of SYSTEM_FIELDS) {
      expect(declared.has(f), f).toBe(true);
    }
  });

  it('excludes the rule-local exemptions — they are decisions, not system columns', () => {
    // `name` is an ordinary authored field on most objects; `owner` and
    // `record_type` are not registry-injected; `_id` and `space` are legacy
    // physical spellings. Rules that exempt them do so locally, next to their
    // reason (see the module note). Putting any of them here would silently
    // stop every consumer from catching a reference to a genuinely missing
    // field — this test is where that accidental widening fails.
    for (const f of ['name', 'owner', 'record_type', '_id', 'space']) {
      expect(SYSTEM_FIELDS.has(f), f).toBe(false);
    }
  });
});

describe('unprovisionedInjectedColumnsFor (#8116)', () => {
  const external = {
    name: 'ext_customer',
    external: { remoteName: 'customers' },
    fields: { email: { type: 'text', label: 'Email' } },
  };

  it('is the spec derivation verbatim — never a hand-copied predicate', () => {
    // Delegation pin: the set is exactly what `@objectstack/spec/data` answers,
    // so the author-time warning and the runtime guards cannot disagree.
    expect([...unprovisionedInjectedColumnsFor(external)].sort()).toEqual(
      unprovisionedInjectedColumns(external).sort(),
    );
  });

  it('is non-empty only for external objects, and excludes author-declared columns', () => {
    expect(unprovisionedInjectedColumnsFor(external).has('owner_id')).toBe(true);
    expect(unprovisionedInjectedColumnsFor(external).has('organization_id')).toBe(true);
    // Local twin: platform storage is real.
    expect(unprovisionedInjectedColumnsFor({ name: 'customer', fields: {} }).size).toBe(0);
    // #7859's security direction: a declared organization_id maps a real
    // remote column the author vouches for — never in the set.
    const declaredReal = {
      ...external,
      fields: { ...external.fields, organization_id: { type: 'text', label: 'Remote Org Key' } },
    };
    expect(unprovisionedInjectedColumnsFor(declaredReal).has('organization_id')).toBe(false);
  });
});
