// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The SeedLoader's tenant stamp must survive the reference pass.
//
// `organization_id` is declared as a lookup → `sys_organization`, so it is a
// REFERENCE field as far as the loader's resolution pass is concerned. But the
// value the loader stamps into it (`config.organizationId`, the per-org replay
// target) is an ID, not a natural key. Resolving it as one probes
// `sys_organization.name` for an id, misses, and DROPS the column — the row
// lands org-less and is then invisible to every member behind the tenant wall.
//
// The `id` fallback probe cannot rescue it: under per-tenant replay every probe
// is AND-scoped with `organization_id = <target org>`, and `sys_organization`
// — the tenant table itself — has no such column.
//
// What kept this hidden is the ID SHAPE. `looksLikeInternalId` recognises UUID
// and Mongo ObjectId and short-circuits both, so any fixture minting UUID org
// ids passed. Every organization better-auth actually creates — including the
// default org `ensureDefaultOrganization` bootstraps — is `org_<base36>`, which
// it does not recognise. So the defect fired on real deployments only.

import { describe, it, expect } from 'vitest';
import { SeedLoaderService } from '@objectstack/metadata-protocol';
import { SeedLoaderConfigSchema } from '@objectstack/spec/data';

/**
 * Harness whose business object declares `organization_id` as the engine
 * injects it — a lookup to `sys_organization` — which is what puts the stamp on
 * the reference pass's path in the first place.
 *
 * `find` returns [] for every probe, standing in for the real miss: an org id
 * matches neither `sys_organization.name` nor the tenant-scoped `id` probe.
 */
function harness() {
  const inserted: Array<{ object: string; record: Record<string, unknown> }> = [];
  const engine = {
    find: async () => [],
    insert: async (object: string, record: Record<string, unknown>) => {
      inserted.push({ object, record });
      return { id: `${object}_${inserted.length}` };
    },
    update: async () => ({}),
  };
  const metadata = {
    getObject: async (name: string) => ({
      name,
      fields: {
        name: { type: 'text' },
        organization_id: { type: 'lookup', reference: 'sys_organization' },
      },
    }),
  };
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const svc = new SeedLoaderService(engine as never, metadata as never, logger as never);
  return { svc, inserted };
}

const cfg = (over: Record<string, unknown> = {}) =>
  SeedLoaderConfigSchema.parse({ mode: 'insert', ...over });

describe('SeedLoader tenant stamp survives the reference pass', () => {
  it('keeps a better-auth-shaped organization id (the shape real deployments use)', async () => {
    const { svc, inserted } = harness();
    const result = await svc.load({
      seeds: [{ object: 'project', records: [{ name: 'Apollo' }] }] as never,
      config: cfg({ organizationId: 'org_msbubm8g3j35rgx0' }),
    });

    expect(inserted[0]?.record.organization_id).toBe('org_msbubm8g3j35rgx0');
    // A dropped stamp is reported as a reference error, never as a failed row —
    // which is exactly why it went unnoticed: the seed summary reads clean.
    expect(result.errors).toHaveLength(0);
    expect(result.summary.totalReferencesDropped ?? 0).toBe(0);
  });

  it('keeps a UUID-shaped organization id too (the shape fixtures mint)', async () => {
    const { svc, inserted } = harness();
    await svc.load({
      seeds: [{ object: 'project', records: [{ name: 'Apollo' }] }] as never,
      config: cfg({ organizationId: '372e1c7b-493d-411a-9a92-faecdf7b3da9' }),
    });
    expect(inserted[0]?.record.organization_id).toBe('372e1c7b-493d-411a-9a92-faecdf7b3da9');
  });

  it('still RESOLVES an organization_id the seed itself authored as a natural key', async () => {
    // The stamp is skipped only when the loader wrote it. A seed naming its org
    // explicitly keeps going through resolution — so this one misses (the
    // harness finds nothing) and is dropped, exactly as before the fix.
    const { svc, inserted } = harness();
    await svc.load({
      seeds: [
        { object: 'project', records: [{ name: 'Apollo', organization_id: 'Acme Org' }] },
      ] as never,
      config: cfg({ organizationId: 'org_msbubm8g3j35rgx0' }),
    });
    expect(inserted[0]?.record.organization_id).toBeUndefined();
  });
});
