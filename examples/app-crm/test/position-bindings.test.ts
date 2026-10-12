// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3/D4] The CRM personas' permission sets are declared on their
 * positions (`permissionSets`), which the authorization resolver reads; no
 * junction row is written for them. Pinned literally so a persona losing its
 * set is a red here, not a silently narrower boot.
 */

import { describe, expect, it } from 'vitest';
import { FinanceApproverPosition, SalesManagerPosition, SalesRepPosition } from '../src/security/sales-positions.js';

describe('CRM position bindings', () => {
  it('each persona position declares crm_sales_user', () => {
    const declared = [SalesRepPosition, SalesManagerPosition, FinanceApproverPosition]
      .flatMap((p) => (p.permissionSets ?? []).map((s) => `${p.name} -> ${s}`))
      .sort();
    expect(declared).toEqual([
      'finance_approver -> crm_sales_user',
      'sales_manager -> crm_sales_user',
      'sales_rep -> crm_sales_user',
    ]);
  });
});
