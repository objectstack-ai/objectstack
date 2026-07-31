// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { FIELD_GROUP_SYSTEM_FIELDS } from '@objectstack/spec/data';
import { SystemFieldName } from '@objectstack/spec/system';
import { SYSTEM_FIELDS } from './system-fields.js';

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
