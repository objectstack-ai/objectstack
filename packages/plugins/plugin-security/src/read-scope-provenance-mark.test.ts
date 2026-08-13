// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8220, A of the #7929 ruling] The CRUD merge boundary's half of the
 * filter-subtree provenance mark: this middleware is the frame that knows
 * which subtree the caller did not write, so it is the frame that stamps it.
 *
 * What is pinned, and why each half matters:
 *
 *  - every injected read scope (RLS, controlled-by-parent, the fail-closed
 *    deny sentinel) is marked `'policy'` — that is what keeps the driver's
 *    cross-field refusal redacted for predicates an administrator authored;
 *  - the caller's own predicate is marked `'author'` ONLY under the identity
 *    vouch `opCtx.ast.where === opCtx.options.where` — the caller's verbatim
 *    predicate, untouched by any sibling middleware. A tree a sibling already
 *    rewrote gets NO mark, and unmarked withholds: the mark is permission to
 *    reveal, never a guess (the fail-closed invariant this card is chartered
 *    on).
 *
 * The driver-side consumption is pinned in `driver-sql`
 * (`sql-driver-cross-field-provenance.test.ts`) and end-to-end in
 * `packages/runtime/src/cross-field-refusal-operand-withhold.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import { filterSubtreeProvenanceOf, resolveFilterSubtreeProvenance } from '@objectstack/spec/data';

import { SecurityPlugin } from './security-plugin.js';

const tenantPolicySet: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
  rowLevelSecurity: [
    { name: 'tenant_isolation', object: '*', operation: 'all', using: 'organization_id = current_user.organization_id' },
  ],
} as never;

/** The minimal middleware harness `security-plugin.test.ts` boots with. */
const makeHarness = (overrides?: { permissionSets?: PermissionSet[]; orgScoping?: boolean }) => {
  const fields: Record<string, unknown> = {};
  for (const f of ['id', 'organization_id', 'owner_id', 'name', 'amount', 'budget']) {
    fields[f] = { name: f };
  }
  const baseSchema = { name: 'task', fields };
  let middleware: ((opCtx: unknown, next: () => Promise<void>) => Promise<void>) | undefined;
  const ql = {
    registerMiddleware: (mw: never) => {
      if (!middleware) middleware = mw;
    },
    getSchema: () => baseSchema,
    findOne: vi.fn(async () => null),
  };
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: ql,
    metadata: { get: async () => baseSchema, list: async () => overrides?.permissionSets ?? [tenantPolicySet] },
  };
  if (overrides?.orgScoping !== false) {
    services['org-scoping'] = { name: 'com.objectstack.org-scoping' };
  }
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  return {
    ctx,
    run: async (opCtx: unknown) => {
      if (!middleware) throw new Error('middleware never registered');
      await middleware(opCtx, async () => {});
      return opCtx;
    },
  };
};

const memberContext = () => ({
  userId: 'u1',
  tenantId: 'org-1',
  positions: [],
  permissions: [],
});

const boot = async (overrides?: Parameters<typeof makeHarness>[0]) => {
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  const harness = makeHarness(overrides);
  await plugin.init(harness.ctx as never);
  await plugin.start(harness.ctx as never);
  return harness;
};

describe('[#8220] the CRUD read-scope merge boundary stamps filter-subtree provenance', () => {
  it("marks every injected scope 'policy' and the caller's verbatim where 'author'", async () => {
    const harness = await boot();
    const callerWhere = { amount: { $gt: { $field: 'budget' } } };
    const opCtx: Record<string, any> = {
      object: 'task',
      operation: 'find',
      ast: { object: 'task', where: callerWhere },
      options: { where: callerWhere },
      context: memberContext(),
    };
    await harness.run(opCtx);

    // The merge really happened — caller's arm first, scopes after.
    expect(opCtx.ast.where.$and[0]).toBe(callerWhere);
    expect(filterSubtreeProvenanceOf(callerWhere)).toBe('author');
    const scopes = opCtx.ast.where.$and.slice(1);
    expect(scopes.length).toBeGreaterThan(0);
    for (const scope of scopes) {
      expect(filterSubtreeProvenanceOf(scope)).toBe('policy');
    }
    // The mark is invisible to enumeration — nothing downstream serialises it.
    expect(JSON.stringify(callerWhere)).toBe('{"amount":{"$gt":{"$field":"budget"}}}');
  });

  it("a caller with NO where still gets the scope marked 'policy' (nothing vouched author)", async () => {
    const harness = await boot();
    const opCtx: Record<string, any> = {
      object: 'task',
      operation: 'find',
      ast: { object: 'task', where: undefined },
      options: {},
      context: memberContext(),
    };
    await harness.run(opCtx);
    expect(opCtx.ast.where).toBeTruthy();
    // With nothing to merge against, the injected scope IS the whole where —
    // the mark sits on that root, and every inner arm inherits it positionally
    // (`resolveFilterSubtreeProvenance`'s innermost-wins walk).
    expect(filterSubtreeProvenanceOf(opCtx.ast.where)).toBe('policy');
    const innerArm = opCtx.ast.where.$and?.[0];
    if (innerArm) {
      expect(resolveFilterSubtreeProvenance(opCtx.ast.where, innerArm)).toBe('policy');
    }
  });

  it('⚠️ fail closed: a where a SIBLING already rewrote gets NO author mark', async () => {
    const harness = await boot();
    const callerWhere = { amount: { $gt: { $field: 'budget' } } };
    // plugin-sharing's shape: the sibling composed its own filter in first, so
    // ast.where is no longer the caller's verbatim object.
    const rewritten = { $and: [callerWhere, { owner_id: 'u1' }] };
    const opCtx: Record<string, any> = {
      object: 'task',
      operation: 'find',
      ast: { object: 'task', where: rewritten },
      options: { where: callerWhere },
      context: memberContext(),
    };
    await harness.run(opCtx);
    // The rewritten root was NOT vouched — the boundary cannot know which of
    // its arms the caller wrote. The caller subtree keeps no mark either.
    expect(filterSubtreeProvenanceOf(rewritten)).toBe(null);
    expect(filterSubtreeProvenanceOf(callerWhere)).toBe(null);
    // The injected scopes are still marked policy.
    const arms = opCtx.ast.where.$and ?? [];
    const marked = arms.filter((a: unknown) => filterSubtreeProvenanceOf(a) === 'policy');
    expect(marked.length).toBeGreaterThan(0);
  });

  it("the fail-closed RLS deny sentinel is marked 'policy' too", async () => {
    // No org in context → the tenant policy's token cannot resolve → the
    // compiler answers the deny sentinel. It is as policy-authored as any
    // resolvable scope, and its shape must stay unnamed the same way.
    const harness = await boot();
    const opCtx: Record<string, any> = {
      object: 'task',
      operation: 'find',
      ast: { object: 'task', where: undefined },
      options: {},
      context: { userId: 'u1', positions: [], permissions: [] },
    };
    await harness.run(opCtx);
    expect(opCtx.ast.where).toBeTruthy();
    // Same shape as the no-where case above: the deny sentinel (or the
    // composite carrying it) IS the where, marked at its root.
    expect(filterSubtreeProvenanceOf(opCtx.ast.where)).toBe('policy');
  });
});
