// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The seam's in-memory ObjectQL holds the caller's `limit`.
 *
 * `resolveAuthzContext` reads through this double with real bounds (for
 * example `limit: 1` and `limit: 2` when it picks a default organization). A
 * double that dropped the bound answered more rows than the real engine ever
 * would, so a test running through the seam could pass on a result the
 * runtime never produces.
 */

import { describe, expect, it } from 'vitest';
import { makeSeamQl } from './exec-context-seam.testkit.js';

describe('makeSeamQl().find holds the caller limit', () => {
  const rows = [
    { id: 'a', organization_id: 'org_1' },
    { id: 'b', organization_id: 'org_1' },
    { id: 'c', organization_id: 'org_2' },
  ];

  it('answers at most `limit` rows when more match', async () => {
    const ql = makeSeamQl({ sys_member: rows });
    const page = await ql.find('sys_member', { where: { organization_id: 'org_1' }, limit: 1 });
    expect(page).toEqual([{ id: 'a', organization_id: 'org_1' }]);
  });

  it('applies the bound after the filter, not before it', async () => {
    const ql = makeSeamQl({ sys_member: rows });
    const page = await ql.find('sys_member', { where: { organization_id: 'org_2' }, limit: 1 });
    expect(page).toEqual([{ id: 'c', organization_id: 'org_2' }]);
  });

  it('answers every match when no limit is given', async () => {
    const ql = makeSeamQl({ sys_member: rows });
    const page = await ql.find('sys_member', { where: { organization_id: 'org_1' } });
    expect(page.map((r) => r.id)).toEqual(['a', 'b']);
  });
});
