// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#10401] An UNPUBLISHED object is denied — correctly — but the refusal must
 * say WHY, and the why must not be "permissions".
 *
 * The #3545 fail-closed branch (pinned next door in
 * `metadata-unresolvable-posture.test.ts`, and unchanged by this file) answers
 * two very different conditions with one sentence:
 *
 *   • the object exists only as an unpublished DRAFT — the author's declaration
 *     is fine, the remedy is to publish it;
 *   • the declaration genuinely cannot be read — the remedy is to check that the
 *     object is declared, or to look at a metadata-store outage.
 *
 * Because the one sentence described an internal *security* step ("the security
 * posture … could not be resolved"), readers took it for a permissions problem.
 * Measured downstream (objectstack-ai/cloud#1481): an AI turn burned seven tool
 * calls and a free plan's daily allowance before telling the user the object was
 * "missing its sharing/visibility setting".
 *
 * So this file pins three things:
 *
 *   1. **The rejection contract does not move.** Both branches are still
 *      `PermissionDeniedError` / `PERMISSION_DENIED` / 403, and both still open
 *      with the `[Security] Access denied` prefix — which is a MATCHER the
 *      transports read as "this is a 403" (`errors.ts` header), not house style.
 *   2. **Both branches of the discriminator**, by their message.
 *   3. **Enforcement and explanation stay in sync** — the two surfaces that
 *      state this condition are derived from one wording module, and drifting
 *      apart is the incident shape this card exists to close.
 */

import { describe, it, expect, vi } from 'vitest';
import { SecurityPlugin } from './security-plugin.js';
import { PermissionEvaluator } from './permission-evaluator.js';
import { explainAccess, type ExplainEngineDeps } from './explain-engine.js';
import { isPermissionDeniedError } from './errors.js';
import {
  unresolvedPostureRemedy,
  unresolvedPostureDenialMessage,
  unresolvedPostureExplainDetail,
} from './unresolved-posture.js';
import type { PermissionSet } from '@objectstack/spec/security';

/** Plain member: blanket wildcard grant, no superuser bits, no capabilities. */
const memberSet: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
} as any;

/**
 * Middleware harness for the unresolved path.
 *
 * `draftRow` decides what the `sys_metadata` probe finds: a row (the object has
 * a pending draft and no published value) or nothing. `probeThrows` stands in
 * for every deployment where the probe cannot run at all — no `sys_metadata`
 * registered, an unprovisioned store, a driver error — which must degrade to the
 * both-conditions wording rather than to a claim.
 */
const makeHarness = (opts: {
  resolvable: boolean;
  draftRow?: boolean;
  probeThrows?: boolean;
}) => {
  const fields: Record<string, any> = {};
  for (const f of ['id', 'organization_id', 'owner_id', 'name']) fields[f] = { name: f };
  const baseSchema: any = { name: 'shyx_customer', fields };

  let middleware: any;
  const findOne = vi.fn(async (object: string, query: any) => {
    if (object !== 'sys_metadata') return null;
    if (opts.probeThrows) throw new Error('no such table: sys_metadata');
    const w = query?.where ?? {};
    if (opts.draftRow && w.type === 'object' && w.name === 'shyx_customer' && w.state === 'draft') {
      return { id: 'md_1', type: 'object', name: 'shyx_customer', state: 'draft' };
    }
    return null;
  });
  const ql = {
    registerMiddleware: (mw: any) => {
      if (!middleware) middleware = mw;
    },
    getSchema: () => (opts.resolvable ? baseSchema : undefined),
    findOne,
  };
  const metadata = {
    get: async (type: string, name: string) => {
      if (!opts.resolvable && type === 'object' && name === 'shyx_customer') return undefined;
      return baseSchema;
    },
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
    findOne,
    run: async (opCtx: any) => {
      await middleware(opCtx, async () => {});
      return opCtx;
    },
  };
};

const boot = async (opts: { resolvable: boolean; draftRow?: boolean; probeThrows?: boolean }) => {
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  const harness = makeHarness(opts);
  await plugin.init(harness.ctx);
  await plugin.start(harness.ctx);
  return harness;
};

/** Authenticated member — resolves to a non-empty permission-set list. */
const memberRead = (): any => ({
  object: 'shyx_customer',
  operation: 'find',
  ast: { where: undefined },
  context: { userId: 'u1', tenantId: 'org-1', positions: [], permissions: [] },
});

/** The thrown refusal, as an object (the harness rejects). */
const denialOf = async (h: { run: (c: any) => Promise<any> }): Promise<any> => {
  try {
    await h.run(memberRead());
  } catch (e) {
    return e;
  }
  throw new Error('expected the middleware to deny, but it allowed the operation');
};

describe('[#10401] unpublished object — the deny stays, the explanation gets honest', () => {
  describe('the rejection contract is untouched (ADR-0112 envelope)', () => {
    it('an UNPUBLISHED object still denies with PERMISSION_DENIED / 403', async () => {
      const err = await denialOf(await boot({ resolvable: false, draftRow: true }));
      expect(err.name).toBe('PermissionDeniedError');
      expect(err.code).toBe('PERMISSION_DENIED');
      expect(err.statusCode).toBe(403);
    });

    it('a genuinely UNRESOLVABLE object still denies with PERMISSION_DENIED / 403', async () => {
      const err = await denialOf(await boot({ resolvable: false, draftRow: false }));
      expect(err.name).toBe('PermissionDeniedError');
      expect(err.code).toBe('PERMISSION_DENIED');
      expect(err.statusCode).toBe(403);
    });

    it('both branches keep the `[Security] Access denied` prefix the transports match on', async () => {
      for (const draftRow of [true, false]) {
        const err = await denialOf(await boot({ resolvable: false, draftRow }));
        expect(err.message.startsWith('[Security] Access denied')).toBe(true);
        // The prefix is load-bearing: it is how a 403 is recognised downstream.
        expect(isPermissionDeniedError(err)).toBe(true);
      }
    });
  });

  describe('the discriminator — both branches', () => {
    it('a draft-only object is told it is NOT PUBLISHED, and told to publish it', async () => {
      const err = await denialOf(await boot({ resolvable: false, draftRow: true }));
      expect(err.message).toContain("object 'shyx_customer' is not published");
      expect(err.message).toContain('Publish the object to make it queryable');
      // The whole point: it must not read as a permissions problem any more.
      expect(err.message).toContain('NOT a permissions problem');
      expect(err.message).not.toContain('could not be resolved');
    });

    it('a genuinely unresolvable object keeps the original clause, plus the remedy', async () => {
      const err = await denialOf(await boot({ resolvable: false, draftRow: false }));
      // Pinned verbatim: any surface matching the pre-#10401 opening still does.
      expect(err.message).toContain(
        "the security posture of object 'shyx_customer' could not be resolved for operation 'find'",
      );
      expect(err.message).toContain('Check that the object is declared and published');
      expect(err.message).toContain('NOT a permissions problem');
    });

    it('the two branches really are different sentences', async () => {
      const unpublished = await denialOf(await boot({ resolvable: false, draftRow: true }));
      const unresolvable = await denialOf(await boot({ resolvable: false, draftRow: false }));
      expect(unpublished.message).not.toBe(unresolvable.message);
    });

    it('the operator log names the cause too, so the two are separable in logs', async () => {
      const h = await boot({ resolvable: false, draftRow: true });
      await denialOf(h);
      expect(h.logger.error).toHaveBeenCalled();
      const line = String(h.logger.error.mock.calls.at(-1)?.[0] ?? '');
      expect(line).toContain('DRAFT declaration');
      expect(line).toContain('shyx_customer');
    });
  });

  describe('the probe fails safe, and costs nothing on the allowed path', () => {
    it('a probe that THROWS degrades to the both-conditions wording — never to a claim', async () => {
      const err = await denialOf(await boot({ resolvable: false, probeThrows: true }));
      expect(err.code).toBe('PERMISSION_DENIED');
      expect(err.message).toContain('could not be resolved');
      expect(err.message).not.toContain('is not published');
    });

    it('a resolvable posture never probes sys_metadata at all', async () => {
      const h = await boot({ resolvable: true, draftRow: true });
      await expect(h.run(memberRead())).resolves.toBeDefined();
      const probed = h.findOne.mock.calls.filter((c: any[]) => c[0] === 'sys_metadata');
      expect(probed).toHaveLength(0);
    });

    it('the probe reads under a SYSTEM context, so it cannot re-enter the posture resolution', async () => {
      const h = await boot({ resolvable: false, draftRow: true });
      await denialOf(h);
      const probed = h.findOne.mock.calls.filter((c: any[]) => c[0] === 'sys_metadata');
      expect(probed).toHaveLength(1);
      expect(probed[0][1]?.context?.isSystem).toBe(true);
      expect(probed[0][1]?.where).toMatchObject({
        type: 'object',
        name: 'shyx_customer',
        state: 'draft',
      });
    });

    it('the probe never turns a denial into a grant — an unpublished object is still refused', async () => {
      const h = await boot({ resolvable: false, draftRow: true });
      await expect(h.run(memberRead())).rejects.toMatchObject({ name: 'PermissionDeniedError' });
    });
  });

  // The incident shape this card closes is TWO FILES stating one condition and
  // drifting apart. One module owns the wording; these pin that both surfaces
  // read it rather than re-spelling it.
  describe('enforcement and explanation cannot drift apart', () => {
    const explainDeps = (unresolvedCause?: 'unpublished_draft' | 'unknown'): ExplainEngineDeps =>
      ({
        ql: { getSchema: () => ({ name: 'shyx_customer' }) },
        resolveSets: async () => [memberSet],
        evaluator: new PermissionEvaluator(),
        getObjectSecurityMeta: async () => ({
          isPrivate: false,
          requiredPermissions: { all: [], read: [], create: [], update: [], delete: [] },
          fieldRequiredPermissions: {},
          unresolved: true,
          ...(unresolvedCause ? { unresolvedCause } : {}),
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

    const explainCtx = { userId: 'u1', positions: ['everyone'], permissions: [] };

    const crudDetail = async (cause?: 'unpublished_draft' | 'unknown') => {
      const d = await explainAccess(explainDeps(cause), {
        object: 'shyx_customer',
        operation: 'read',
        context: explainCtx,
      });
      expect(d.allowed).toBe(false);
      const crud = d.layers.find((l) => l.layer === 'object_crud')!;
      expect(crud.verdict).toBe('denies');
      return crud.detail;
    };

    it('explain names the unpublished cause and the same remedy the refusal names', async () => {
      const detail = await crudDetail('unpublished_draft');
      expect(detail).toContain('is not published');
      expect(detail).toContain(unresolvedPostureRemedy('unpublished_draft'));
      // …and the refusal carries that same remedy sentence, verbatim.
      const err = await denialOf(await boot({ resolvable: false, draftRow: true }));
      expect(err.message).toContain(unresolvedPostureRemedy('unpublished_draft'));
    });

    it('explain keeps the unresolvable prose, and shares its remedy with the refusal too', async () => {
      const detail = await crudDetail('unknown');
      expect(detail).toContain('could not be resolved');
      expect(detail).toContain(unresolvedPostureRemedy('unknown'));
      const err = await denialOf(await boot({ resolvable: false, draftRow: false }));
      expect(err.message).toContain(unresolvedPostureRemedy('unknown'));
    });

    it('a deps bag with no cause at all explains as the both-conditions wording', async () => {
      // Back-compat: an explain caller wired before #10401 must not crash or
      // silently claim "unpublished" for a condition nobody probed.
      const detail = await crudDetail(undefined);
      expect(detail).toBe(unresolvedPostureExplainDetail('shyx_customer', 'unknown'));
      expect(detail).not.toContain('is not published');
    });

    it('the middleware throw is the wording module verbatim, not a second spelling', async () => {
      const err = await denialOf(await boot({ resolvable: false, draftRow: true }));
      expect(err.message).toBe(
        unresolvedPostureDenialMessage('shyx_customer', 'find', 'unpublished_draft'),
      );
    });
  });
});
