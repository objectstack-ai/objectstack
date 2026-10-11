// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3/D4] The security plugin's third permission-set source — the
 * catalog loader (`SecurityPlugin.catalogSetLoader`) — pinned the way the row
 * loader it replaced was pinned (`engine-find-bare-array.pin.test.ts` block 7,
 * #15598), against the post-cutover read.
 *
 * The loader answers the names the metadata list and the bootstrap sets did
 * not: each name's definition in the security catalog the plugin binds to its
 * engine. Three facts must never leave it as one value:
 *
 *  - the catalog holds the set → the definition, WHOLE;
 *  - the catalog holds no set of that name (or no catalog is bound) → nothing;
 *  - the catalog read did NOT answer → a THROW (`AuthzStoreUnavailableError`),
 *    never "no such set". `PermissionEvaluator.resolvePermissionSets` catches it
 *    one frame up: the unresolved sets grant nothing (fail closed) and the
 *    #2565 warn names the failure, once.
 *
 * And it reads no `sys_permission_set` row at all: a set only a row carries
 * resolves nothing, whatever the row says.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  AUTHZ_STORE_UNAVAILABLE_CODE,
  AUTHZ_STORE_UNAVAILABLE_STATUS,
  AuthzStoreUnavailableError,
} from '@objectstack/core';
import type { PermissionSet } from '@objectstack/spec/security';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';

import { SecurityPlugin } from './security-plugin.js';
import { PermissionEvaluator } from './permission-evaluator.js';

/** An environment-authored set, as the engine registry holds it. */
const CATALOG_SET: PermissionSet = {
  name: 'ps_catalog',
  label: 'Catalog authored',
  objects: { deal: { allowRead: true, allowEdit: true } },
  fields: { 'deal.amount': { readable: true, editable: false } },
  systemPermissions: ['setup.access'],
  tabPermissions: { app_crm: 'visible' },
} as any;

interface Fixture {
  /** What the registry's by-name read does: answer from `CATALOG_SET`, or throw. */
  registryThrows?: Error;
  /** `sys_permission_set` rows — present to prove they are never read. */
  rows?: Array<Record<string, unknown>>;
  /** Boot with no registry on the engine: no catalog gets bound. */
  noRegistry?: boolean;
}

/** Boot the real plugin over a double engine and hand back its private catalog loader. */
async function loaderOver(fixture: Fixture = {}) {
  let rowReads = 0;
  const ql: any = {
    registerMiddleware: () => {},
    getSchema: () => null,
    findOne: async (object: string, query?: EngineFindOneQueryInput) => { assertEngineFindOnePredicate(object, query); return null; },
    // No table answers here: every set is the catalog's. Only a read that
    // asks for a set the loader was asked about counts — the boot's own
    // background passes (the org-admin backfill, the baseline binder) read
    // their own names and race the call.
    find: async (object: string, query?: unknown) => {
      if (object === 'sys_permission_set' && /ps_catalog|ps_row_only/.test(JSON.stringify(query ?? {}))) rowReads += 1;
      return [];
    },
  };
  if (!fixture.noRegistry) {
    ql.registry = {
      getItem: (type: string, name: string) => {
        if (fixture.registryThrows) throw fixture.registryThrows;
        return type === 'permission' && name === CATALOG_SET.name ? CATALOG_SET : undefined;
      },
      listItems: (type: string) => (type === 'permission' ? [CATALOG_SET] : []),
      isPackageDisabled: () => false,
    };
  }
  const warn = vi.fn();
  const ctx: any = {
    logger: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (name === 'objectql') return ql;
      if (name === 'metadata') return { get: async () => null, list: async () => [] };
      if (name === 'manifest') return { register: vi.fn() };
      throw new Error(`service not registered: ${name}`);
    },
  };
  const plugin = new SecurityPlugin();
  await plugin.init(ctx);
  await plugin.start(ctx);
  const loader = (plugin as any).catalogSetLoader as ((names: string[]) => Promise<PermissionSet[]>) | undefined;
  expect(typeof loader, 'the catalog loader was never built — the boot bailed out').toBe('function');
  rowReads = 0; // boot-time reads are not the loader's
  return { loader: loader!, rowReads: () => rowReads };
}

describe('[ADR-0131 D3/D4] the catalog loader — what it answers', () => {
  it('a set the catalog holds comes back WHOLE, and no sys_permission_set row is read', async () => {
    const { loader, rowReads } = await loaderOver();
    const sets = await loader(['ps_catalog']);
    expect(sets).toEqual([CATALOG_SET]);
    expect(rowReads()).toBe(0);
  });

  it('a name the catalog does not hold answers nothing — an EMPTY answer is a real answer', async () => {
    const { loader } = await loaderOver();
    await expect(loader(['ps_nowhere'])).resolves.toEqual([]);
  });

  it('a set only a sys_permission_set ROW carries resolves nothing, and the row is never read', async () => {
    const { loader, rowReads } = await loaderOver({
      rows: [{ name: 'ps_row_only', object_permissions: JSON.stringify({ deal: { allowDelete: true } }) }],
    });
    await expect(loader(['ps_row_only'])).resolves.toEqual([]);
    expect(rowReads()).toBe(0);
  });

  it('a name asked twice is answered once', async () => {
    const { loader } = await loaderOver();
    expect((await loader(['ps_catalog', 'ps_catalog'])).map((s) => s.name)).toEqual(['ps_catalog']);
  });

  it('an engine with no catalog bound answers nothing, never a guess', async () => {
    const { loader } = await loaderOver({ noRegistry: true });
    await expect(loader(['ps_catalog'])).resolves.toEqual([]);
  });
});

describe('[ADR-0131 D3/D4, #2565] a catalog read that did not answer', () => {
  it('PROPAGATES as the reader\'s own loud failure instead of reading as "no such set"', async () => {
    const { loader } = await loaderOver({ registryThrows: new Error("Datasource 'primary' is declared but not connected") });
    // ⛔ Not `toThrow()` alone: the envelope is the assertion.
    const err = await loader(['ps_catalog']).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(AuthzStoreUnavailableError);
    expect(err).toMatchObject({ code: AUTHZ_STORE_UNAVAILABLE_CODE, status: AUTHZ_STORE_UNAVAILABLE_STATUS });
  });

  it('stays FAIL-CLOSED through the evaluator, and its #2565 warn fires exactly once', async () => {
    const { loader } = await loaderOver({ registryThrows: new Error('registry unreadable') });
    const warns: Array<{ msg: string; meta: any }> = [];
    const resolved = await new PermissionEvaluator().resolvePermissionSets(
      ['ps_catalog'],
      { list: async () => [] },
      [],
      loader,
      { logger: { warn: (msg: string, meta?: any) => { warns.push({ msg, meta }); } } },
    );
    // The unresolved set grants nothing — fail closed, never a widening.
    expect(resolved).toEqual([]);
    // The loss is sayable: one warn, naming the catalog and the names it could not answer.
    expect(warns).toHaveLength(1);
    expect(warns[0].msg).toContain('catalog lookup failed');
    expect(warns[0].meta?.unresolved).toEqual(['ps_catalog']);
  });

  it('CONTROL: the same request with a catalog that answers resolves the set and warns nothing', async () => {
    const { loader } = await loaderOver();
    const warns: string[] = [];
    const resolved = await new PermissionEvaluator().resolvePermissionSets(
      ['ps_catalog'],
      { list: async () => [] },
      [],
      loader,
      { logger: { warn: (msg: string) => { warns.push(msg); } } },
    );
    expect(resolved.map((s) => s.name)).toEqual(['ps_catalog']);
    expect(warns).toEqual([]);
  });
});
