// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0106 D7] `getMetadataReadableFields` — the metadata-plane variant of
 * `getReadableFields`.
 *
 * The two differ in exactly one place: what a caller resolving to ZERO
 * permission sets gets. On the DATA plane, falling open is the drift-free
 * answer — the engine middleware skips its whole gate for such a caller, and
 * reporting a narrowing the data path would not enforce is its own kind of
 * drift. On the METADATA plane the question is disclosure, and D7 rules that a
 * guest/public deployment's schema exposure must be a deliberate
 * permission-set decision rather than an accidental everything-default. So the
 * zero-set caller goes through the same fallback resolution
 * `/auth/me/permissions` performs (`security.fallbackPermissionSet`).
 *
 * Every case below asserts BOTH methods, so the pair can only be changed
 * together and the divergence stays exactly one row wide.
 */

import { describe, it, expect, vi } from 'vitest';
import { SecurityPlugin } from './security-plugin.js';
import type { PermissionSet } from '@objectstack/spec/security';

function bootPlugin(permissionSets: PermissionSet[], objectFields: string[], fallback: string | undefined = 'guest_default') {
  const fields: Record<string, any> = {};
  for (const f of objectFields) fields[f] = { name: f };
  const schema: any = { name: 'deal', label: 'Deal', systemFields: false, fields };
  const ql: any = {
    registerMiddleware: () => {},
    getSchema: (name: string) => (name === 'deal' ? schema : null),
    findOne: async () => null,
  };
  const metadata: any = {
    get: async (_type: string, name: string) => (name === 'deal' ? schema : null),
    list: async () => permissionSets,
  };
  const services: Record<string, any> = { manifest: { register: vi.fn() }, objectql: ql, metadata };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin(
    fallback === undefined ? ({} as any) : { fallbackPermissionSet: fallback },
  );
  return { plugin, ctx };
}

/** The deployment's guest baseline: reads `deal`, cannot see `secret`. */
const GUEST_DEFAULT: PermissionSet = {
  name: 'guest_default',
  label: 'Guest',
  objects: { deal: { allowRead: true } },
  fields: { 'deal.secret': { readable: false, editable: false } },
} as any;

const OPEN: PermissionSet = {
  name: 'open',
  label: 'Open',
  objects: { deal: { allowRead: true } },
} as any;

async function boot(sets: PermissionSet[], fields: string[], fallback?: string) {
  const { plugin, ctx } = bootPlugin(sets, fields, fallback);
  await plugin.init(ctx);
  await plugin.start(ctx);
  return { plugin, ctx };
}

describe('[ADR-0106 D7] SecurityPlugin.getMetadataReadableFields', () => {
  it('a zero-permission-set caller resolves the FALLBACK set instead of falling open', async () => {
    const { plugin } = await boot([GUEST_DEFAULT], ['id', 'name', 'secret']);
    // No `userId` → `resolvePermissionSetsForContext` applies no baseline, so
    // this caller resolves to nothing at all.
    const context = { positions: [], permissions: [] };

    const dataPlane = await plugin.getReadableFields('deal', context);
    const metadataPlane = await plugin.getMetadataReadableFields('deal', context);

    // The data plane keeps its middleware-mirroring fall-open — unchanged.
    expect(dataPlane).toEqual(['id', 'name', 'secret']);
    // The metadata plane does not.
    expect(metadataPlane).toEqual(['id', 'name']);
    expect(metadataPlane).not.toContain('secret');
  });

  it('a caller WITH permission sets is answered identically by both methods', async () => {
    const { plugin } = await boot([GUEST_DEFAULT, OPEN], ['id', 'name', 'secret']);
    const context = { userId: 'u1', permissions: ['open'] };

    expect(await plugin.getMetadataReadableFields('deal', context))
      .toEqual(await plugin.getReadableFields('deal', context));
  });

  it('falls open when the fallback set itself does not resolve — that is the "no FLS posture" tier, not a restricted caller', async () => {
    // The deployment names a fallback that does not exist.
    const { plugin } = await boot([OPEN], ['id', 'name', 'secret'], 'missing_set');

    expect(await plugin.getMetadataReadableFields('deal', { positions: [], permissions: [] }))
      .toEqual(['id', 'name', 'secret']);
  });

  it('falls open when no fallback set is configured at all', async () => {
    const { plugin } = await boot([OPEN], ['id', 'name', 'secret'], undefined);

    const answer = await plugin.getMetadataReadableFields('deal', { positions: [], permissions: [] });
    expect(answer).toEqual(['id', 'name', 'secret']);
  });

  it('`isSystem` bypasses on both planes (ADR-0106 D4 — the exemption is a caller property)', async () => {
    const { plugin } = await boot([GUEST_DEFAULT], ['id', 'name', 'secret']);

    expect(await plugin.getMetadataReadableFields('deal', { isSystem: true })).toEqual(['id', 'name', 'secret']);
    expect(await plugin.getReadableFields('deal', { isSystem: true })).toEqual(['id', 'name', 'secret']);
  });

  it('an unresolvable object schema answers `undefined` on both planes — "no answer", not "no fields"', async () => {
    const { plugin } = await boot([GUEST_DEFAULT], ['id', 'name', 'secret']);

    expect(await plugin.getMetadataReadableFields('unknown_object', { userId: 'u1' })).toBeUndefined();
    expect(await plugin.getReadableFields('unknown_object', { userId: 'u1' })).toBeUndefined();
  });

  it('is registered on the `security` service so the dispatch layer can feature-detect it', async () => {
    const { ctx } = await boot([GUEST_DEFAULT], ['id', 'name', 'secret']);

    const registered = ctx.registerService.mock.calls.find((c: any[]) => c[0] === 'security')?.[1];
    expect(typeof registered?.getMetadataReadableFields).toBe('function');
    // The published-contract methods are still there — the extension is
    // additive, and a consumer that only knows `getReadableFields` is unaffected.
    expect(typeof registered?.getReadableFields).toBe('function');
    expect(typeof registered?.getReadFilter).toBe('function');
  });
});
