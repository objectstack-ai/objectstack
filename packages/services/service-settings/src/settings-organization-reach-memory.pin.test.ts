// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D8] The organization reach on the service's IN-MEMORY store — the
 * store a service with no engine bound reads and writes. The engine path puts
 * the organization in the query (`settings-organization-isolation.pin.test.ts`),
 * so its second comparison is a belt; here there is no query, and the reach
 * rule's row predicate (`organizationReachAdmits`, `@objectstack/core`) is the
 * only thing that keeps one organization's rung from drawing on a row that is
 * not its own.
 *
 * Both kinds of row share the one store: a caller with no organization, on a
 * service with no organization source, writes as the lean arm (a row with no
 * organization), and a caller that names an organization writes its own.
 */

import { describe, it, expect } from 'vitest';
import { SettingsService } from './settings-service.js';

const NS = 'org_reach_memory_fixture';

const MANIFEST = {
  namespace: NS,
  label: 'Organization reach (in-memory) fixture',
  scope: 'tenant',
  specifiers: [{ key: 'brand', type: 'text', label: 'Brand', scope: 'tenant', default: 'none' }],
} as any;

function makeService() {
  // `env: {}` so no `OS_*` variable in the environment can override the key.
  const service = new SettingsService({ env: {} });
  service.registerManifest(MANIFEST);
  return service;
}

describe('[ADR-0131 D8] the in-memory store: a row with no organization is no organization\'s fallback', () => {
  it('an organization with no row of its own reads the default, not the row written with no organization', async () => {
    const service = makeService();
    await service.set(NS, 'brand', 'lean-row', {});
    expect((await service.get(NS, 'brand', {})).value).toBe('lean-row');
    expect((await service.get(NS, 'brand', { tenantId: 'org_a' })).value).toBe('none');
  });

  it('each organization reads its own row, ahead of which the organization-less row sits in the store', async () => {
    const service = makeService();
    await service.set(NS, 'brand', 'lean-row', {});
    await service.set(NS, 'brand', 'a-row', { tenantId: 'org_a' });
    expect((await service.get(NS, 'brand', { tenantId: 'org_a' })).value).toBe('a-row');
    expect((await service.get(NS, 'brand', { tenantId: 'org_b' })).value).toBe('none');
    expect((await service.get(NS, 'brand', {})).value).toBe('lean-row');
  });
});
