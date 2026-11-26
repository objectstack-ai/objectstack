// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { auditExpiryCutoff, windowOf, type AuditExpiryRequest } from './expiry.js';

/**
 * ADR-0154 D8, seat ruling on review 7198128323 S1: a tenant-scoped retention
 * window applies to its organization's chain, and no chain expires under a
 * window shorter than one configured for its rows.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 26, 15, 0, 0);
const at = (days: number) => new Date(NOW - days * DAY).toISOString();

const request: AuditExpiryRequest = {
  object: 'app_ledger',
  policy: 'retention.maxAge',
  policyValue: '30d',
  cutoff: at(30),
  tenants: [
    { tenantId: 'org_long', policyValue: '400d', cutoff: at(400) },
    { tenantId: 'org_short', policyValue: '10d', cutoff: at(10) },
  ],
};

describe('windowOf — the window each chain of a sealed object expires under', () => {
  it("an organization's chain takes its own tenant-scoped window, shorter or longer than the global one", () => {
    expect(windowOf(request, 'org:org_long')).toEqual({ cutoffMs: auditExpiryCutoff(NOW - 400 * DAY), policyValue: '400d' });
    expect(windowOf(request, 'org:org_short')).toEqual({ cutoffMs: auditExpiryCutoff(NOW - 10 * DAY), policyValue: '10d' });
  });

  it('an organization with no window of its own takes the global one', () => {
    expect(windowOf(request, 'org:org_plain')).toEqual({ cutoffMs: auditExpiryCutoff(NOW - 30 * DAY), policyValue: '30d' });
  });

  it('a chain of no one organization takes the longest of all of them', () => {
    expect(windowOf(request, 'deployment')).toEqual({ cutoffMs: auditExpiryCutoff(NOW - 400 * DAY), policyValue: '400d' });
    expect(windowOf({ ...request, tenants: [{ tenantId: 'org_short', policyValue: '10d', cutoff: at(10) }] }, 'deployment'))
      .toEqual({ cutoffMs: auditExpiryCutoff(NOW - 30 * DAY), policyValue: '30d' });
  });

  it('with no tenant window every chain takes the global one', () => {
    const { tenants: _, ...plain } = request;
    expect(windowOf(plain, 'org:org_long')).toEqual({ cutoffMs: auditExpiryCutoff(NOW - 30 * DAY), policyValue: '30d' });
  });
});
