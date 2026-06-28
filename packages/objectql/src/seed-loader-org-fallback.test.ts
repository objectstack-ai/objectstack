// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The SeedLoader stamps business seed rows with the tenant's organization key so
// they don't vanish under strict org-scoping. When the caller pins no org (an
// in-process publish has no active user session — the AI build agent's publish
// path), the loader adopts the tenant's SOLE organization as a fallback. A
// `sys_`/platform seed never takes the fallback (those stay global). Zero or
// many orgs → leave rows org-less (genuinely ambiguous → historical behavior).

import { describe, it, expect } from 'vitest';
import { SeedLoaderService } from '@objectstack/metadata-protocol';
import { SeedLoaderConfigSchema } from '@objectstack/spec/data';

function harness(orgRows: Array<{ id: string }>) {
  const inserted: Array<{ object: string; record: Record<string, unknown> }> = [];
  const engine = {
    // sys_organization is the org-count probe; everything else (ref lookups) is empty.
    find: async (object: string) => (object === 'sys_organization' ? orgRows : []),
    insert: async (object: string, record: Record<string, unknown>) => {
      inserted.push({ object, record });
      return { id: `${object}_${inserted.length}` };
    },
    update: async () => ({}),
  };
  const metadata = {
    // A single text field → no lookup/master_detail references to resolve.
    getObject: async (name: string) => ({ name, fields: { name: { type: 'text' } } }),
  };
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const svc = new SeedLoaderService(engine as never, metadata as never, logger as never);
  return { svc, inserted };
}

const cfg = (over: Record<string, unknown> = {}) =>
  SeedLoaderConfigSchema.parse({ mode: 'insert', ...over });

describe('SeedLoader org-key fallback (un-pinned publish)', () => {
  it('stamps the SOLE organization onto un-pinned BUSINESS seed rows', async () => {
    const { svc, inserted } = harness([{ id: 'org_only' }]);
    await svc.load({
      seeds: [{ object: 'project', records: [{ name: 'Apollo' }] }] as never,
      config: cfg(),
    });
    expect(inserted[0]?.record.organization_id).toBe('org_only');
  });

  it('does NOT take the fallback for sys_/platform seeds (they stay global)', async () => {
    const { svc, inserted } = harness([{ id: 'org_only' }]);
    await svc.load({
      seeds: [{ object: 'sys_widget_pref', records: [{ name: 'X' }] }] as never,
      config: cfg(),
    });
    expect(inserted[0]?.record.organization_id).toBeUndefined();
  });

  it('leaves rows org-less when the tenant org is ambiguous (≠ exactly one)', async () => {
    const { svc, inserted } = harness([{ id: 'a' }, { id: 'b' }]);
    await svc.load({
      seeds: [{ object: 'project', records: [{ name: 'Apollo' }] }] as never,
      config: cfg(),
    });
    expect(inserted[0]?.record.organization_id).toBeUndefined();
  });

  it('leaves rows org-less when there is no organization at all', async () => {
    const { svc, inserted } = harness([]);
    await svc.load({
      seeds: [{ object: 'project', records: [{ name: 'Apollo' }] }] as never,
      config: cfg(),
    });
    expect(inserted[0]?.record.organization_id).toBeUndefined();
  });

  it('an explicitly pinned org still wins over the fallback path', async () => {
    const { svc, inserted } = harness([{ id: 'sole_ignored' }]);
    await svc.load({
      seeds: [{ object: 'project', records: [{ name: 'Apollo' }] }] as never,
      config: cfg({ organizationId: 'org_pinned' }),
    });
    expect(inserted[0]?.record.organization_id).toBe('org_pinned');
  });
});
