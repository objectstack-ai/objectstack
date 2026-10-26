// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0138 E1 — the security plugin's half of the guest's grants channel.
 *
 *  - D3 (Enforced by): the set resolution treats the sets the guest envelope
 *    carries — the `guest` anchor's bindings `resolveAuthzContext` resolved —
 *    as any requested set; and a set sharing the anchor's name, the
 *    authenticated baseline and `everyone` never reach the guest (D3 item 3).
 *    The position-name fold that once made the first of those a live channel
 *    is retired for every principal (#24757).
 *  - D4: a guest that reaches a data operation acting in no organization, on
 *    a deployment where the guest entry's organization step refuses, meets the
 *    located refusal at the CRUD gate — `NOT_IMPLEMENTED` (501), before the
 *    operation runs and before any set resolves.
 *
 * Every pin carries its control: the same resolution for a signed-in human
 * (who still takes the baseline), and the same gate on a
 * single-organization deployment (an ordinary 403 for a guest holding nothing).
 *
 * Harness mirrors `zero-set-deny-baseline.test.ts`; the engine double adds the
 * organization rows and the registry the organization step reads. Synthetic.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { SecurityPlugin } from './security-plugin.js';

const SCHEMAS: Record<string, unknown> = {
  ledger: { name: 'ledger', fields: { title: { type: 'text', label: 'Title' } } },
  catalog: { name: 'catalog', fields: { title: { type: 'text', label: 'Title' } } },
};

const READ = { allowRead: true };
const MEMBER_SET = { name: 'member_default', label: 'Synthetic member', objects: { ledger: READ } } as unknown as PermissionSet;
/** The set an administrator bound to the `guest` anchor. */
const BOUND_SET = { name: 'synth_public_catalog', label: 'Synthetic catalog', objects: { catalog: READ } } as unknown as PermissionSet;
/** A set that merely shares the anchor's NAME. */
const NAMED_LIKE_ANCHOR = { name: 'guest', label: 'Named like the anchor', objects: { ledger: READ } } as unknown as PermissionSet;

type Deployment = { organizations: string[] | undefined };

async function boot(deployment: Deployment) {
  const middlewares: Array<(opCtx: any, next: () => Promise<void>) => Promise<void>> = [];
  const registered: Record<string, any> = {};
  const organizationRows = (deployment.organizations ?? []).map((id) => ({ id }));
  const organizationReads = vi.fn();
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: {
      registerMiddleware: (mw: any) => middlewares.push(mw),
      getSchema: (name: string) => SCHEMAS[name],
      registry: { getObject: (name: string) => (name === 'sys_organization' && deployment.organizations ? { name } : undefined) },
      find: vi.fn(async (object: string, query: any) => {
        if (object === 'sys_organization') {
          organizationReads();
          return organizationRows.slice(0, query?.limit ?? organizationRows.length);
        }
        return [];
      }),
      findOne: vi.fn(async (object: string, query: any) => {
        assertEngineFindOnePredicate(object, query);
        return null;
      }),
    },
    metadata: {
      get: async (_type: string, name: string) => SCHEMAS[name],
      list: async () => [MEMBER_SET, BOUND_SET, NAMED_LIKE_ANCHOR],
    },
  };
  const ctx: Record<string, unknown> = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, svc: unknown) => { registered[name] = svc; },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as any);
  await plugin.start(ctx as any);
  if (middlewares.length === 0) throw new Error('SecurityPlugin registered no middleware');
  const security = registered['security'] as { resolvePermissionSetsForContext(context?: unknown): Promise<PermissionSet[]> };
  return { middleware: middlewares[0], security, organizationReads, logger: ctx.logger as { warn: ReturnType<typeof vi.fn> } };
}

type Verdict = { admitted: true } | { admitted: false; ran: boolean; code?: unknown; status?: unknown; message?: string };

async function run(
  middleware: (opCtx: any, next: () => Promise<void>) => Promise<void>,
  object: string,
  operation: string,
  context: Record<string, unknown>,
): Promise<Verdict> {
  let ran = false;
  const opCtx: Record<string, unknown> = { object, operation, context: { ...context }, options: {}, ast: { where: {} } };
  if (operation === 'insert') opCtx.data = { title: 'SYNTH' };
  try {
    await middleware(opCtx, async () => { ran = true; });
    return { admitted: true };
  } catch (e) {
    const err = e as { code?: unknown; status?: unknown; statusCode?: unknown; message?: string };
    return { admitted: false, ran, code: err.code, status: err.status ?? err.statusCode, message: err.message };
  }
}

const names = (sets: PermissionSet[]) => sets.map((s) => s.name).sort();

const GUEST = { principalKind: 'guest', positions: ['guest'], isSystem: false } as const;

describe('ADR-0138 D3 — the set resolution treats the guest\'s bound sets as any requested set', () => {
  it('a guest carrying the bound set resolves exactly that set', async () => {
    const { security } = await boot({ organizations: ['org_one'] });
    const sets = await security.resolvePermissionSetsForContext({ ...GUEST, permissions: [BOUND_SET.name], tenantId: 'org_one' });
    expect(names(sets)).toEqual([BOUND_SET.name]);
  });

  it('a set sharing the anchor\'s name never reaches the guest (D3 item 3)', async () => {
    const { security } = await boot({ organizations: ['org_one'] });
    const guest = await security.resolvePermissionSetsForContext({ ...GUEST, permissions: [], tenantId: 'org_one' });
    expect(names(guest)).toEqual([]);
    // Nor a signed-in human holding a position of that name: the shared name
    // grants nothing to anyone (#24757) — only the baseline resolves.
    const human = await security.resolvePermissionSetsForContext({
      principalKind: 'human', userId: 'u_synth', positions: ['guest'], permissions: [], tenantId: 'org_one',
    });
    expect(names(human)).toEqual(['member_default']);
    // Control: the set is real — named by the context, it resolves.
    const named = await security.resolvePermissionSetsForContext({
      principalKind: 'human', userId: 'u_synth', positions: [], permissions: ['guest'], tenantId: 'org_one',
    });
    expect(names(named)).toEqual(['guest', 'member_default']);
  });

  it('the authenticated baseline never reaches the guest (D3 item 3)', async () => {
    const { security } = await boot({ organizations: ['org_one'] });
    const guest = await security.resolvePermissionSetsForContext({ ...GUEST, permissions: [BOUND_SET.name], tenantId: 'org_one' });
    expect(names(guest)).not.toContain('member_default');
    // Control: the same request with a user id takes the baseline additively.
    const human = await security.resolvePermissionSetsForContext({
      principalKind: 'human', userId: 'u_synth', positions: [], permissions: [BOUND_SET.name], tenantId: 'org_one',
    });
    expect(names(human)).toEqual(['member_default', BOUND_SET.name]);
  });
});

describe('ADR-0138 D4 — the located refusal at the CRUD gate', () => {
  it('several organizations: a guest with no organization is refused NOT_IMPLEMENTED (501), before the operation runs', async () => {
    const { middleware, logger } = await boot({ organizations: ['org_a', 'org_b'] });
    for (const operation of ['find', 'insert']) {
      const verdict = await run(middleware, 'catalog', operation, { ...GUEST, permissions: [] });
      expect(verdict, operation).toMatchObject({ admitted: false, ran: false, code: 'NOT_IMPLEMENTED', status: 501 });
      expect((verdict as { message?: string }).message).toMatch(/site binding/);
      // The caller learns nothing of the deployment.
      expect((verdict as { message?: string }).message).not.toMatch(/org_a|org_b|ambiguous|\b2\b/);
    }
    // The operator is told why — once.
    const lines = logger.warn.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.includes('resolves no organization for the guest'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('ambiguous-organization');
  });

  it('control — one organization: the same guest is denied 403 for holding nothing, never refused 501', async () => {
    const { middleware } = await boot({ organizations: ['org_one'] });
    expect(await run(middleware, 'catalog', 'find', { ...GUEST, permissions: [] }))
      .toMatchObject({ admitted: false, ran: false, code: 'PERMISSION_DENIED', status: 403 });
  });

  it('control — a composition with no organization object: denied 403, and no organization is read', async () => {
    const { middleware, organizationReads } = await boot({ organizations: undefined });
    expect(await run(middleware, 'catalog', 'find', { ...GUEST, permissions: [] }))
      .toMatchObject({ admitted: false, ran: false, code: 'PERMISSION_DENIED', status: 403 });
    expect(organizationReads).not.toHaveBeenCalled();
  });

  it('a guest that carries its organization is not re-asked, and its bound set admits it', async () => {
    const { middleware, organizationReads } = await boot({ organizations: ['org_one'] });
    expect(await run(middleware, 'catalog', 'find', { ...GUEST, permissions: [BOUND_SET.name], tenantId: 'org_one' }))
      .toEqual({ admitted: true });
    expect(organizationReads).not.toHaveBeenCalled();
    // …and only the object it names.
    expect(await run(middleware, 'ledger', 'find', { ...GUEST, permissions: [BOUND_SET.name], tenantId: 'org_one' }))
      .toMatchObject({ admitted: false, ran: false, code: 'PERMISSION_DENIED', status: 403 });
  });

  it('a signed-in caller with no active organization is never refused by the guest rule', async () => {
    const { middleware } = await boot({ organizations: ['org_a', 'org_b'] });
    const verdict = await run(middleware, 'ledger', 'find', { principalKind: 'human', userId: 'u_synth', positions: [], permissions: [] });
    expect(verdict).not.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });
});
