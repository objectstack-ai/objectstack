// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21062] The ADR-0056 public-form grant never bypasses the result masker.
 *
 * The grant the form-submit route builds admits exactly two things on the
 * form's declared object: the create, and the read-back of what was created.
 * It passes before any permission set resolves, so it used to hand the
 * operation to the engine and return before step 4 (the result masker) ever
 * ran — the record echoed to an anonymous submitter carried every field whose
 * `maskingRule` applies as stored, a field filled from its `defaultValue` that
 * the form never shows included.
 *
 * `maskingRule` declares itself for "every non-system caller unless the
 * field's `requiredPermissions` are ALL held". The submitter is a non-system
 * caller, so the read-back passes the SAME masker the data plane uses, for the
 * caller the grant stands in for: the permission sets the data plane resolves
 * for the grant's context (no user id, so no baseline — the deployment's guest
 * set if it registers one, otherwise none) and the posture its gates read for
 * those sets (the zero-set stand-in included).
 *
 * Pinned on both deployment shapes, each case first asserting what resolution
 * answers for the grant's caller there, so a later change to resolution moves
 * the case loudly instead of silently testing something else:
 *
 *  - the masked fields are served masked on every read-back the grant admits,
 *    the defaulted one included, and a field with no rule is served stored;
 *  - the grant's admission is unchanged: the declared object's create and
 *    read-back pass, the server-managed fields are still stripped from the
 *    payload, and every other operation or object is still refused.
 *
 * The last block pins the grant's own boundary: a grant context carrying no
 * principal is masked too (the grant is never the principal-less hand-off),
 * and a masker whose inputs cannot be read refuses before the operation runs,
 * as the data plane does.
 *
 * Fixtures are synthetic. Harness mirrors `zero-set-masking.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import type { FieldMaskingRule } from '@objectstack/spec/data';
import { SecurityPlugin } from './security-plugin.js';
import { maskFieldValue } from './field-masker.js';

const OBJECT = 'intake';
const RULE: FieldMaskingRule = { keepHead: 1, keepTail: 1 };
const SCHEMAS: Record<string, unknown> = {
  [OBJECT]: {
    name: OBJECT,
    fields: {
      // No rule: the control, served as stored.
      subject: { type: 'text', label: 'Subject' },
      // A rule, collected by the form.
      on_form_masked: { type: 'text', label: 'On form', maskingRule: RULE },
      // A rule, filled from its default and never shown by the form.
      defaulted_masked: { type: 'text', label: 'Defaulted', maskingRule: RULE, defaultValue: 'SYNTHDEFAULT01' },
    },
  },
  other_object: { name: 'other_object', fields: { name: { type: 'text', label: 'Name' } } },
};
const MASKED = ['on_form_masked', 'defaulted_masked'] as const;

/** What the engine stores and hands back for a submitted payload: the payload, an id, the default. */
const STORED_ROW = {
  id: 'r1',
  subject: 'SYNTH-SUBJECT',
  on_form_masked: 'SYNTHVALUE01',
  defaulted_masked: 'SYNTHDEFAULT01',
};

/** The guest set a deployment may register under the name the route's grant context requests. */
const GUEST_SET: PermissionSet = {
  name: 'guest_portal',
  label: 'Guest',
  objects: { [OBJECT]: { allowRead: false, allowCreate: true, allowEdit: false, allowDelete: false } },
} as PermissionSet;

/** The context the form-submit route builds for an anonymous submitter. */
const ROUTE_GRANT_CONTEXT = { publicFormGrant: { object: OBJECT }, permissions: ['guest_portal'], anonymous: true };

async function boot(opts: { guestSet: boolean; schemas?: Record<string, unknown> }) {
  const schemas = opts.schemas ?? SCHEMAS;
  const middlewares: Array<(opCtx: any, next: () => Promise<void>) => Promise<void>> = [];
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: {
      registerMiddleware: (mw: any) => middlewares.push(mw),
      getSchema: (name: string) => schemas[name],
      findOne: vi.fn(async () => null),
    },
    metadata: {
      get: async (_type: string, name: string) => schemas[name],
      list: async (type: string) =>
        (opts.guestSet && (type === 'permission' || type === 'permissions') ? [GUEST_SET] : []) as PermissionSet[],
    },
  };
  const registerService = vi.fn();
  const ctx: Record<string, unknown> = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({});
  await plugin.init(ctx as any);
  await plugin.start(ctx as any);
  if (middlewares.length === 0) throw new Error('SecurityPlugin registered no middleware');
  const security = registerService.mock.calls.find((c: any[]) => c[0] === 'security')?.[1] as {
    resolvePermissionSetsForContext: (context: unknown) => Promise<PermissionSet[]>;
  };
  return { plugin, middleware: middlewares[0], security };
}

type Verdict = { admitted: true; ran: boolean } | { admitted: false; ran: boolean; code?: unknown; status?: unknown };

/**
 * Drive the middleware with an engine stand-in for `next()`: it records that
 * the operation ran and produces what the engine would — the stored row for an
 * insert or a findOne, a one-row page for a find.
 */
async function run(
  middleware: (opCtx: any, next: () => Promise<void>) => Promise<void>,
  opCtx: Record<string, any>,
): Promise<Verdict> {
  let ran = false;
  const engine = async () => {
    ran = true;
    if (opCtx.operation === 'insert' || opCtx.operation === 'findOne') opCtx.result = { ...STORED_ROW };
    else if (opCtx.operation === 'find') opCtx.result = [{ ...STORED_ROW }];
    else if (opCtx.operation === 'count') opCtx.result = 1;
  };
  try {
    await middleware(opCtx, engine);
    return { admitted: true, ran };
  } catch (e) {
    const err = e as { code?: unknown; status?: unknown; statusCode?: unknown };
    return { admitted: false, ran, code: err.code, status: err.status ?? err.statusCode };
  }
}

const submit = (context: Record<string, unknown> = ROUTE_GRANT_CONTEXT): Record<string, any> => ({
  object: OBJECT,
  operation: 'insert',
  context: { ...context },
  options: {},
  data: { subject: STORED_ROW.subject, on_form_masked: STORED_ROW.on_form_masked },
});

function expectMasked(served: Record<string, unknown>): void {
  for (const f of MASKED) {
    const stored = (STORED_ROW as Record<string, string>)[f];
    expect(served[f], f).toBe(maskFieldValue(stored, RULE));
    expect(served[f], f).not.toBe(stored);
  }
}

const DEPLOYMENTS: Array<{ label: string; guestSet: boolean; resolves: string[] }> = [
  { label: 'a deployment that registers no guest set', guestSet: false, resolves: [] },
  { label: 'a deployment that registers a guest set', guestSet: true, resolves: ['guest_portal'] },
];

describe('[#21062] the public-form grant serves its read-back through the result masker', () => {
  for (const d of DEPLOYMENTS) {
    describe(d.label, () => {
      it('premise: what resolution answers for the caller the grant stands in for', async () => {
        const { security } = await boot({ guestSet: d.guestSet });
        const sets = await security.resolvePermissionSetsForContext({ ...ROUTE_GRANT_CONTEXT });
        expect(sets.map((s) => s.name)).toEqual(d.resolves);
      });

      it('an anonymous submit echoes every masked field masked, the defaulted one included', async () => {
        const { middleware } = await boot({ guestSet: d.guestSet });
        const opCtx = submit();
        expect(await run(middleware, opCtx)).toEqual({ admitted: true, ran: true });
        expectMasked(opCtx.result);
      });

      it('the read-back operations the grant admits serve every masked field masked', async () => {
        const { middleware } = await boot({ guestSet: d.guestSet });
        const one: Record<string, any> = {
          object: OBJECT, operation: 'findOne', context: { ...ROUTE_GRANT_CONTEXT }, options: {}, ast: { where: { id: 'r1' } },
        };
        expect(await run(middleware, one)).toEqual({ admitted: true, ran: true });
        expectMasked(one.result);
        const page: Record<string, any> = {
          object: OBJECT, operation: 'find', context: { ...ROUTE_GRANT_CONTEXT }, options: {}, ast: { where: { id: 'r1' } },
        };
        expect(await run(middleware, page)).toEqual({ admitted: true, ran: true });
        expectMasked(page.result[0]);
      });

      it('the field with no masking rule is served as stored', async () => {
        const { middleware } = await boot({ guestSet: d.guestSet });
        const opCtx = submit();
        expect(await run(middleware, opCtx)).toEqual({ admitted: true, ran: true });
        expect(opCtx.result.subject).toBe(STORED_ROW.subject);
        expect(opCtx.result.id).toBe(STORED_ROW.id);
      });

      it('admission is unchanged: the create runs and the server-managed fields are stripped from it', async () => {
        const { middleware } = await boot({ guestSet: d.guestSet });
        const opCtx = submit();
        opCtx.data = {
          ...opCtx.data,
          owner_id: 'usr_synth_forged', organization_id: 'org_synth_forged', created_by: 'usr_synth_forged',
        };
        expect(await run(middleware, opCtx)).toEqual({ admitted: true, ran: true });
        expect(opCtx.data).toEqual({ subject: STORED_ROW.subject, on_form_masked: STORED_ROW.on_form_masked });
      });

      it('admission is unchanged: a count passes, and another operation or another object is refused before it runs', async () => {
        const { middleware } = await boot({ guestSet: d.guestSet });
        const update = await run(middleware, {
          object: OBJECT, operation: 'update', context: { ...ROUTE_GRANT_CONTEXT }, options: {}, data: { id: 'r1', subject: 'x' },
        });
        expect(update).toEqual({ admitted: false, ran: false, code: 'PERMISSION_DENIED', status: 403 });
        const foreign = await run(middleware, {
          object: 'other_object', operation: 'insert', context: { ...ROUTE_GRANT_CONTEXT }, options: {}, data: { name: 'x' },
        });
        expect(foreign).toEqual({ admitted: false, ran: false, code: 'PERMISSION_DENIED', status: 403 });
        const count = await run(middleware, {
          object: OBJECT, operation: 'count', context: { ...ROUTE_GRANT_CONTEXT }, options: {}, ast: { where: {} },
        });
        expect(count).toEqual({ admitted: true, ran: true });
      });
    });
  }
});

describe('[#21062] the grant boundary: never a principal-less hand-off, and fail closed on the masker\'s inputs', () => {
  it('a grant context carrying no principal has its read-back masked too', async () => {
    const { middleware } = await boot({ guestSet: false });
    const opCtx = submit({ publicFormGrant: { object: OBJECT } });
    expect(await run(middleware, opCtx)).toEqual({ admitted: true, ran: true });
    expectMasked(opCtx.result);
    expect(opCtx.result.subject).toBe(STORED_ROW.subject);
  });

  it('a permission-resolution failure refuses the operation before it runs', async () => {
    const { plugin, middleware } = await boot({ guestSet: true });
    (plugin as unknown as { resolvePermissionSetsForContext: () => Promise<never> }).resolvePermissionSetsForContext =
      async () => { throw new Error('synthetic resolution outage'); };
    expect(await run(middleware, submit())).toEqual({ admitted: false, ran: false, code: 'PERMISSION_DENIED', status: 403 });
  });

  it('an object whose posture cannot be read refuses the operation before it runs', async () => {
    const { middleware } = await boot({ guestSet: false, schemas: {} });
    expect(await run(middleware, submit())).toEqual({ admitted: false, ran: false, code: 'PERMISSION_DENIED', status: 403 });
  });
});
