// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { isLegacyOrganizationRow } from './legacy-organization-row.js';

describe('[ADR-0131 D6] isLegacyOrganizationRow — the one row-value test', () => {
  it('a row whose organization_id names an organization is a legacy organization row', () => {
    expect(isLegacyOrganizationRow({ organization_id: 'org_a' })).toBe(true);
  });

  it('an absent, null or empty organization_id is the environment\'s row', () => {
    for (const row of [{}, { organization_id: undefined }, { organization_id: null }, { organization_id: '' }, null, undefined]) {
      expect(isLegacyOrganizationRow(row), JSON.stringify(row)).toBe(false);
    }
  });
});
