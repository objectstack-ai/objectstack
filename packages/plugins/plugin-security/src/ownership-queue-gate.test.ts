// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0142 D3/D4] The ownership gate (authz middleware step 3.5) over the
 * `queue` anchor: every admission and every refusal of the table in
 * `ownership-queue-gate.ts`, driven through the registered middleware.
 *
 * The sharing service and the ownership-queue service are doubles with the
 * real contracts' shapes; what is under test is what the gate does with their
 * answers. The engine half of the claim — the write made conditional on the
 * owner still being empty, and 409 for the loser — is pinned in
 * `packages/objectql/src/ownership-queue.test.ts`; here the pin is that the
 * gate ASKS for it (`opCtx.writePrecondition`).
 */

import { describe, it, expect, vi } from 'vitest';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { QueueNotFoundError } from './errors.js';
import { CLAIM_REFUSAL, INSERT_QUEUE_REFUSAL, MOVE_REFUSAL, RELEASE_REFUSAL } from './ownership-queue-gate.js';

const runEngineWriteBody = async (opCtx: any): Promise<void> => {
  const seam = opCtx?.postHookWriteImageCheck;
  if (!seam) return;
  seam.honoured = true;
  if (opCtx.operation === 'update') {
    await seam.evaluate([]);
    return;
  }
  await seam.evaluate(Array.isArray(opCtx.data) ? opCtx.data : [opCtx.data]);
};

const memberSet: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
} as any;
const transferSet: PermissionSet = {
  name: 'can_transfer',
  label: 'Transfer',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowTransfer: true } },
} as any;

/** The queues the double knows, per organization, with their members. */
const QUEUES: Record<string, Record<string, string[]>> = {
  'org-1': { support_intake: ['u1', 'u2'], billing: ['u9'] },
  'org-2': { support_intake: ['u7'] },
};

interface Harness {
  run: (opCtx: any) => Promise<any>;
  checkEdit: ReturnType<typeof vi.fn>;
}

const boot = async (opts: {
  sets: PermissionSet[];
  /** The stored row every by-id read returns (`null` = the caller cannot read it). */
  row?: Record<string, unknown> | null;
  /** The sharing service's tri-state write verdict for the row. */
  verdict?: 'allow' | 'deny' | 'abstain';
  /** Register the ownership-queue service (default true). */
  queues?: boolean;
  /** Object field names (default: a user-owned object, so `queue` is present). */
  fields?: string[];
}): Promise<Harness> => {
  const fields: Record<string, any> = {};
  for (const f of opts.fields ?? ['id', 'organization_id', 'owner_id', 'queue', 'name']) fields[f] = { name: f };
  const schema: any = { name: 'case', fields };
  let middleware: any;
  const findOne = vi.fn(async (object: string, query: any) => {
    assertEngineFindOnePredicate(object, query as EngineFindOneQueryInput);
    return opts.row === undefined ? null : opts.row ? { ...opts.row } : null;
  });
  const ql = {
    registerMiddleware: (mw: any) => { if (!middleware) middleware = mw; },
    getSchema: () => schema,
    findOne,
    find: vi.fn(async () => [] as Record<string, unknown>[]),
  };
  const checkEdit = vi.fn(async () => opts.verdict ?? 'abstain');
  const services: Record<string, any> = {
    manifest: { register: vi.fn() },
    objectql: ql,
    metadata: { get: async () => schema, list: async () => opts.sets },
    sharing: { checkEdit, checkDelete: vi.fn(async () => 'abstain') },
  };
  if (opts.queues !== false) {
    services['ownership-queue'] = {
      resolveQueue: vi.fn(async (name: string, org: string | null) =>
        org && QUEUES[org]?.[name] ? { name, label: name, source: 'authored', organizationId: org, members: [] } : null),
      isMember: vi.fn(async (userId: string, name: string, org: string | null) =>
        !!(org && QUEUES[org]?.[name]?.includes(userId))),
    };
  }
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx);
  await plugin.start(ctx);
  return {
    checkEdit,
    run: async (opCtx: any) => {
      await middleware(opCtx, () => runEngineWriteBody(opCtx));
      return opCtx;
    },
  };
};

const as = (userId: string, extra: Record<string, unknown> = {}) =>
  ({ userId, tenantId: 'org-1', positions: [], permissions: [], ...extra });
const update = (data: Record<string, unknown>, context = as('u1')) =>
  ({ object: 'case', operation: 'update', data: { id: 'c1', ...data }, context });
const insert = (data: Record<string, unknown> | Record<string, unknown>[], context = as('u1')) =>
  ({ object: 'case', operation: 'insert', data, context });

const SITTING = { id: 'c1', owner_id: null, queue: 'support_intake', organization_id: 'org-1' };
const OWNED_BY_U1 = { id: 'c1', owner_id: 'u1', queue: 'support_intake', organization_id: 'org-1' };

describe('[ADR-0142 D4] claim — an unowned record, to the caller, by id, where sharing admits', () => {
  it('is admitted without the transfer grant, and the write is made conditional on the owner still being empty', async () => {
    const h = await boot({ sets: [memberSet], row: SITTING, verdict: 'allow' });
    const opCtx = await h.run(update({ owner_id: 'u1' }));
    expect(opCtx.data.owner_id).toBe('u1');
    expect(opCtx.writePrecondition).toEqual({ owner_id: null });
  });

  it('is admitted on a record with no queue at all, when sharing positively admits (an edit share, Modify All)', async () => {
    const h = await boot({ sets: [memberSet], row: { ...SITTING, queue: null }, verdict: 'allow' });
    const opCtx = await h.run(update({ owner_id: 'u1' }));
    expect(opCtx.writePrecondition).toEqual({ owner_id: null });
  });

  it.each(['abstain', 'deny'] as const)('is refused when the sharing verdict is %s — mere passage is not a basis', async (verdict) => {
    const h = await boot({ sets: [memberSet], row: SITTING, verdict });
    await expect(h.run(update({ owner_id: 'u1' }))).rejects.toThrow(CLAIM_REFUSAL);
  });

  it('claims for the caller only: naming another user is a transfer', async () => {
    const h = await boot({ sets: [memberSet], row: SITTING, verdict: 'allow' });
    await expect(h.run(update({ owner_id: 'u2' }))).rejects.toThrow(/changing record ownership on update requires the transfer grant/);
  });

  it('is refused on an owned record (that is a transfer, not a claim)', async () => {
    const h = await boot({ sets: [memberSet], row: { ...SITTING, owner_id: 'u2' }, verdict: 'allow' });
    await expect(h.run(update({ owner_id: 'u1' }))).rejects.toThrow(/changing record ownership/);
  });

  it('is refused on a predicate (bulk) update: no single pre-image, no one-owner precondition', async () => {
    const h = await boot({ sets: [memberSet], row: SITTING, verdict: 'allow' });
    const opCtx = {
      object: 'case', operation: 'update', data: { owner_id: 'u1' },
      options: { where: { queue: 'support_intake' }, multi: true }, context: as('u1'),
    };
    await expect(h.run(opCtx)).rejects.toThrow(/system-managed/);
  });

  it('is refused for a row the caller cannot read', async () => {
    const h = await boot({ sets: [memberSet], row: null, verdict: 'allow' });
    await expect(h.run(update({ owner_id: 'u1' }))).rejects.toThrow();
  });

  it('a claim that also changes the queue is a move, refused without the grant', async () => {
    const h = await boot({ sets: [memberSet], row: SITTING, verdict: 'allow' });
    await expect(h.run(update({ owner_id: 'u1', queue: 'billing' }))).rejects.toThrow(MOVE_REFUSAL);
  });

  it('a claim that echoes the stored queue is still a claim', async () => {
    const h = await boot({ sets: [memberSet], row: SITTING, verdict: 'allow' });
    const opCtx = await h.run(update({ owner_id: 'u1', queue: 'support_intake' }));
    expect(opCtx.writePrecondition).toEqual({ owner_id: null });
  });
});

describe('[ADR-0142 D4] release — the owner, back to the home queue', () => {
  it('is admitted for the owner of a record with a home queue', async () => {
    const h = await boot({ sets: [memberSet], row: OWNED_BY_U1 });
    const opCtx = await h.run(update({ owner_id: null }));
    expect(opCtx.data.owner_id).toBeNull();
    expect(opCtx.writePrecondition).toBeUndefined();
  });

  it('is refused for a record with no home queue (that is a disown, which needs the grant)', async () => {
    const h = await boot({ sets: [memberSet], row: { ...OWNED_BY_U1, queue: null } });
    await expect(h.run(update({ owner_id: null }))).rejects.toThrow(RELEASE_REFUSAL);
  });

  it('is refused for a non-owner', async () => {
    const h = await boot({ sets: [memberSet], row: { ...OWNED_BY_U1, owner_id: 'u2' } });
    await expect(h.run(update({ owner_id: null }))).rejects.toThrow(/changing record ownership/);
  });

  it('a release into ANOTHER queue is a move, refused without the grant', async () => {
    const h = await boot({ sets: [memberSet], row: OWNED_BY_U1 });
    await expect(h.run(update({ owner_id: null, queue: 'billing' }))).rejects.toThrow(MOVE_REFUSAL);
  });
});

describe('[ADR-0142 D3] move — a changed queue is transfer-class', () => {
  it('is refused without the grant, even for a member of both queues', async () => {
    const h = await boot({ sets: [memberSet], row: SITTING });
    await expect(h.run(update({ queue: 'billing' }))).rejects.toThrow(MOVE_REFUSAL);
  });

  it('clearing the queue is a move too', async () => {
    const h = await boot({ sets: [memberSet], row: SITTING });
    await expect(h.run(update({ queue: null }))).rejects.toThrow(MOVE_REFUSAL);
  });

  it('an echo of the stored queue is not a move', async () => {
    const h = await boot({ sets: [memberSet], row: OWNED_BY_U1 });
    await expect(h.run(update({ name: 'x', queue: 'support_intake' }))).resolves.toBeTruthy();
  });

  it('is admitted under the grant when the queue resolves in the row\'s organization', async () => {
    const h = await boot({ sets: [memberSet, transferSet], row: SITTING });
    const opCtx = await h.run(update({ queue: 'billing' }, as('u1', { permissions: ['can_transfer'] })));
    expect(opCtx.data.queue).toBe('billing');
  });

  it('a dispatcher parks an owned record in one write under the grant', async () => {
    const h = await boot({ sets: [memberSet, transferSet], row: OWNED_BY_U1 });
    const opCtx = await h.run(update({ owner_id: null, queue: 'billing' }, as('u5', { permissions: ['can_transfer'] })));
    expect(opCtx.data).toMatchObject({ owner_id: null, queue: 'billing' });
  });

  it('QUEUE_NOT_FOUND: under the grant, a name that resolves nowhere in the row\'s organization is refused (422)', async () => {
    const h = await boot({ sets: [memberSet, transferSet], row: SITTING });
    const err = await h.run(update({ queue: 'no_such_queue' }, as('u1', { permissions: ['can_transfer'] }))).catch((e) => e);
    expect(err).toBeInstanceOf(QueueNotFoundError);
    expect(err).toMatchObject({ code: 'QUEUE_NOT_FOUND', status: 422, statusCode: 422 });
    expect(err.message).not.toMatch(/^\[Security\] Access denied/);
  });

  it('a predicate (bulk) update writing queue fails closed without the grant', async () => {
    const h = await boot({ sets: [memberSet], row: SITTING });
    const opCtx = {
      object: 'case', operation: 'update', data: { queue: 'billing' },
      options: { where: { status: 'open' }, multi: true }, context: as('u1'),
    };
    await expect(h.run(opCtx)).rejects.toThrow(MOVE_REFUSAL);
  });
});

describe('[ADR-0142 D3] insert naming a queue', () => {
  it('a member\'s insert is an OWNED record with a home queue — the stamp does not stand down', async () => {
    const h = await boot({ sets: [memberSet] });
    const opCtx = await h.run(insert({ name: 'A', queue: 'support_intake', organization_id: 'org-1' }));
    expect(opCtx.data).toMatchObject({ owner_id: 'u1', queue: 'support_intake' });
  });

  it('a member supplying an empty owner beside the queue is still stamped (parking needs the grant)', async () => {
    const h = await boot({ sets: [memberSet] });
    const opCtx = await h.run(insert({ name: 'A', owner_id: null, queue: 'support_intake' }));
    expect(opCtx.data.owner_id).toBe('u1');
  });

  it('a non-member is refused without the grant', async () => {
    const h = await boot({ sets: [memberSet] });
    await expect(h.run(insert({ name: 'A', queue: 'billing' }))).rejects.toThrow(INSERT_QUEUE_REFUSAL);
  });

  it('membership is asked in the row\'s organization, not another one', async () => {
    const h = await boot({ sets: [memberSet] });
    await expect(h.run(insert({ name: 'A', queue: 'support_intake', organization_id: 'org-2' }))).rejects.toThrow(INSERT_QUEUE_REFUSAL);
  });

  it('a grant holder parks a new record in one write: owner supplied empty beside the queue', async () => {
    const h = await boot({ sets: [memberSet, transferSet] });
    const opCtx = await h.run(insert({ name: 'A', owner_id: null, queue: 'billing' }, as('u5', { permissions: ['can_transfer'] })));
    expect(opCtx.data).toMatchObject({ owner_id: null, queue: 'billing' });
  });

  it('a grant holder who leaves owner out is stamped as before — only an explicit empty owner parks', async () => {
    const h = await boot({ sets: [memberSet, transferSet] });
    const opCtx = await h.run(insert({ name: 'A', queue: 'billing' }, as('u5', { permissions: ['can_transfer'] })));
    expect(opCtx.data.owner_id).toBe('u5');
  });

  it('a foreign owner beside the queue still needs the grant (the forge rule)', async () => {
    const h = await boot({ sets: [memberSet] });
    await expect(h.run(insert({ name: 'A', owner_id: 'u2', queue: 'support_intake' }))).rejects.toThrow(/creating a record owned by another user/);
  });

  it('QUEUE_NOT_FOUND for a name that resolves nowhere, member or not', async () => {
    const h = await boot({ sets: [memberSet] });
    await expect(h.run(insert({ name: 'A', queue: 'Support Intake' }))).rejects.toBeInstanceOf(QueueNotFoundError);
  });

  it('QUEUE_NOT_FOUND for a value that is not a name', async () => {
    const h = await boot({ sets: [memberSet] });
    await expect(h.run(insert({ name: 'A', queue: 42 }))).rejects.toBeInstanceOf(QueueNotFoundError);
  });

  it('QUEUE_NOT_FOUND with no ownership-queue service registered — nothing resolves, fail closed', async () => {
    const h = await boot({ sets: [memberSet, transferSet], queues: false });
    await expect(h.run(insert({ name: 'A', queue: 'support_intake' }, as('u1', { permissions: ['can_transfer'] }))))
      .rejects.toBeInstanceOf(QueueNotFoundError);
  });

  it('a batch insert is judged per row', async () => {
    const h = await boot({ sets: [memberSet] });
    await expect(h.run(insert([{ name: 'a', queue: 'support_intake' }, { name: 'b', queue: 'billing' }])))
      .rejects.toThrow(INSERT_QUEUE_REFUSAL);
  });

  it('an object without the queue column is untouched by the queue gate', async () => {
    const h = await boot({ sets: [memberSet], fields: ['id', 'organization_id', 'owner_id', 'name'] });
    const opCtx = await h.run(insert({ name: 'A' }));
    expect(opCtx.data.owner_id).toBe('u1');
  });
});

describe('[ADR-0142 D3 / ADR-0138 D1] the guest never supplies the queue', () => {
  const guest = { userId: undefined, tenantId: 'org-1', positions: [], permissions: [], principalKind: 'guest' };

  it('refuses a guest insert naming a queue, whatever it is granted', async () => {
    const h = await boot({ sets: [memberSet, transferSet] });
    await expect(h.run(insert({ name: 'A', queue: 'support_intake' }, { ...guest, permissions: ['can_transfer'] } as any)))
      .rejects.toThrow(/'queue' on 'case' cannot be set by an anonymous caller/);
  });
});
