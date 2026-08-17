// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#3545] Object metadata unresolvable → the SECURITY POSTURE must fail CLOSED.
 *
 * #3545 assessed the fail-open on unresolvable metadata in the API-exposure gate
 * (`checkApiExposure` / REST `enforceApiAccess`) and accepted it, on the premise
 * that the gate is a SURFACE-AREA control while the real authorization boundary —
 * auth + the ObjectQL security middleware (CRUD / FLS / RLS) — enforces
 * unconditionally on the data call regardless of the gate's answer.
 *
 * The middleware does run unconditionally. But two of its INPUTS were read from
 * the same object metadata and defaulted PERMISSIVELY when it could not be
 * resolved, so the same trigger reached one layer deeper than the assessment
 * looked:
 *
 *   • `access.default: 'private'` → `isPrivate` defaulted to `false`. A private
 *     object is deliberately NOT covered by a plain (non-superuser) `'*'`
 *     wildcard grant (ADR-0066 D2, `resolveObjectPermission`); read as public it
 *     IS covered — a grant the author never wrote.
 *   • `requiredPermissions` → defaulted to `[]`, which skips the ADR-0066 D3
 *     capability AND-gate entirely (`if (required.length > 0)`).
 *
 * These tests pin BOTH directions: the control (metadata resolvable → denied,
 * the ADR-0066 behaviour) and the regression (metadata unresolvable → still
 * denied, rather than silently promoted to public + uncontracted).
 */

import { describe, it, expect, vi } from 'vitest';
import { SecurityPlugin } from './security-plugin.js';
import { PermissionEvaluator } from './permission-evaluator.js';
import { explainAccess, type ExplainEngineDeps } from './explain-engine.js';
import type { PermissionSet } from '@objectstack/spec/security';

/** Plain member: blanket wildcard grant, NO superuser bits, NO capabilities. */
const memberSet: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
} as any;

/**
 * Middleware harness. `resolvable: false` makes the OBJECT metadata
 * unresolvable — `ql.getSchema()` returns undefined and `metadata.get('object',
 * …)` throws — while permission-set resolution keeps working. That isolates the
 * axis under test: "the object's own posture can't be read", NOT "the permission
 * subsystem is down" (which already fails closed, see security-plugin.ts).
 */
const makeHarness = (opts: { schemaExtra?: Record<string, any>; resolvable: boolean }) => {
  const fields: Record<string, any> = {};
  for (const f of ['id', 'organization_id', 'owner_id', 'name']) fields[f] = { name: f };
  const baseSchema: any = { name: 'task', fields, ...(opts.schemaExtra ?? {}) };

  let middleware: any;
  const ql = {
    registerMiddleware: (mw: any) => {
      if (!middleware) middleware = mw;
    },
    getSchema: () => (opts.resolvable ? baseSchema : undefined),
    findOne: vi.fn(async () => null),
  };
  const metadata = {
    get: async (type: string, name: string) => {
      if (!opts.resolvable && type === 'object' && name === 'task') {
        throw new Error('metadata store unavailable');
      }
      return baseSchema;
    },
    // Permission-set resolution stays healthy on BOTH paths.
    list: async () => [memberSet],
  };
  const services: Record<string, any> = {
    manifest: { register: vi.fn() },
    objectql: ql,
    metadata,
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  return {
    ctx,
    logger: ctx.logger,
    run: async (opCtx: any) => {
      await middleware(opCtx, async () => {});
      return opCtx;
    },
  };
};

const boot = async (opts: { schemaExtra?: Record<string, any>; resolvable: boolean }) => {
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  const harness = makeHarness(opts);
  await plugin.init(harness.ctx);
  await plugin.start(harness.ctx);
  return harness;
};

/** Authenticated member — resolves to a non-empty permission-set list. */
const memberRead = (): any => ({
  object: 'task',
  operation: 'find',
  ast: { where: undefined },
  context: { userId: 'u1', tenantId: 'org-1', positions: [], permissions: [] },
});

describe('[#3545] unresolvable object metadata — security posture fails closed', () => {
  describe('private posture (ADR-0066 D2)', () => {
    it('control: metadata RESOLVABLE → a plain wildcard does not reach a private object', async () => {
      const h = await boot({ schemaExtra: { access: { default: 'private' } }, resolvable: true });
      await expect(h.run(memberRead())).rejects.toMatchObject({ name: 'PermissionDeniedError' });
    });

    it('metadata UNRESOLVABLE → still denied (posture must not default to public)', async () => {
      const h = await boot({ schemaExtra: { access: { default: 'private' } }, resolvable: false });
      await expect(h.run(memberRead())).rejects.toMatchObject({ name: 'PermissionDeniedError' });
    });
  });

  describe('requiredPermissions capability contract (ADR-0066 D3)', () => {
    it('control: metadata RESOLVABLE → a member lacking the capability is denied', async () => {
      const h = await boot({
        schemaExtra: { requiredPermissions: ['manage_platform_settings'] },
        resolvable: true,
      });
      await expect(h.run(memberRead())).rejects.toMatchObject({ name: 'PermissionDeniedError' });
    });

    it('metadata UNRESOLVABLE → still denied (the capability AND-gate must not be skipped)', async () => {
      const h = await boot({
        schemaExtra: { requiredPermissions: ['manage_platform_settings'] },
        resolvable: false,
      });
      await expect(h.run(memberRead())).rejects.toMatchObject({ name: 'PermissionDeniedError' });
    });
  });

  describe('blast radius', () => {
    it('a PUBLIC, uncontracted object is unaffected when its metadata IS resolvable', async () => {
      const h = await boot({ resolvable: true });
      await expect(h.run(memberRead())).resolves.toBeDefined();
    });

    it('an anonymous request is unaffected — it short-circuits before the posture read', async () => {
      const h = await boot({ resolvable: false });
      const anon: any = {
        object: 'task',
        operation: 'find',
        ast: { where: undefined },
        context: { positions: [], permissions: [] }, // no userId
      };
      await expect(h.run(anon)).resolves.toBeDefined();
    });

    it('a system/boot operation is unaffected — isSystem short-circuits the middleware', async () => {
      const h = await boot({ resolvable: false });
      const sys: any = {
        object: 'task',
        operation: 'find',
        ast: { where: undefined },
        context: { isSystem: true, userId: 'usr_system' },
      };
      await expect(h.run(sys)).resolves.toBeDefined();
    });

    it('logs the unresolvable posture so a persistent outage is observable', async () => {
      const h = await boot({ resolvable: false });
      await expect(h.run(memberRead())).rejects.toMatchObject({ name: 'PermissionDeniedError' });
      expect(h.logger.error).toHaveBeenCalled();
    });
  });

  // The "why am I denied?" surface must agree with the enforcement path —
  // explain reporting `allowed` where the middleware throws is the same
  // declared-≠-enforced drift the engine exists to expose.
  describe('explain parity', () => {
    const explainDeps = (unresolved: boolean): ExplainEngineDeps =>
      ({
        ql: { getSchema: () => ({ name: 'task' }) },
        resolveSets: async () => [memberSet],
        evaluator: new PermissionEvaluator(),
        getObjectSecurityMeta: async () => ({
          isPrivate: false,
          requiredPermissions: { all: [], read: [], create: [], update: [], delete: [] },
          fieldRequiredPermissions: {},
          unresolved,
        }),
        requiredCaps: (meta: any, op: string) => {
          const bucket = op === 'find' ? 'read' : op === 'insert' ? 'create' : op;
          return [...(meta.all ?? []), ...(meta[bucket] ?? [])];
        },
        computeRlsFilter: async () => null,
        getFieldMask: () => ({}),
        getPartialMaskRules: async () => ({}),
        baselinePermissionSets: ['member_default'],
      }) as any;

    const ctx = { userId: 'u1', positions: ['everyone'], permissions: [] };

    it('control: a resolvable posture still explains as granted', async () => {
      const d = await explainAccess(explainDeps(false), { object: 'task', operation: 'read', context: ctx });
      expect(d.allowed).toBe(true);
      expect(d.layers.find((l) => l.layer === 'object_crud')!.verdict).toBe('grants');
    });

    it('an unresolvable posture explains as DENIED, naming the real cause', async () => {
      const d = await explainAccess(explainDeps(true), { object: 'task', operation: 'read', context: ctx });
      expect(d.allowed).toBe(false);
      const crud = d.layers.find((l) => l.layer === 'object_crud')!;
      expect(crud.verdict).toBe('denies');
      expect(crud.detail).toContain('could not be resolved');
      // Not misattributed to the permission sets — they were never the problem.
      expect(crud.detail).not.toContain('No resolved permission set');
    });
  });
});
