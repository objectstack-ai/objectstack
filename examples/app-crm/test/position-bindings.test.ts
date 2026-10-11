// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3/D4] The CRM personas' permission sets are declared on their
 * positions (`permissionSets`), which the authorization resolver reads. The
 * junction binder (`src/security/bind-position-sets.ts`) still writes the same
 * pairs for the readers that have not moved off `sys_position_permission_set`;
 * until it is deleted, the two must name the same pairs, or those readers
 * judge a position by bindings the resolver does not grant.
 */

import { describe, expect, it } from 'vitest';
import { BINDINGS } from '../src/security/bind-position-sets.js';
import { FinanceApproverPosition, SalesManagerPosition, SalesRepPosition } from '../src/security/sales-positions.js';

describe('CRM position bindings', () => {
  it('the junction binder writes exactly the bindings the position definitions declare', () => {
    const declared = [SalesRepPosition, SalesManagerPosition, FinanceApproverPosition]
      .flatMap((p) => (p.permissionSets ?? []).map((s) => `${p.name} -> ${s}`))
      .sort();
    expect(declared).toHaveLength(3);
    expect(BINDINGS.map(([p, s]) => `${p} -> ${s}`).sort()).toEqual(declared);
  });
});
