// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The environment-user outbox (`environment-user-outbox.ts`) on its own: what
// one attempt makes of a row, the claim that keeps two workers off one row,
// the worker's pass (retry, backoff, the last attempt, a refusal on a retry,
// a person who accepted or went away meanwhile), and the trigger that marks
// an invitation accepted. The doors that write the rows are pinned end to end
// in `pending-sso-users.test.ts`.

import { describe, it, expect, vi } from 'vitest';
import {
  bootEnvironmentUserOutbox,
  claimOutboxRow,
  ENVIRONMENT_USER_OUTBOX_OBJECT,
  environmentUserOutboxNextDueAt,
  outboxDoc,
  outboxSettlement,
  OUTBOX_BACKOFF_MS,
  OUTBOX_LEASE_MS,
  OUTBOX_MAX_ATTEMPTS,
  registerOutboxAcceptedTrigger,
  runEnvironmentUserOutboxTick,
  type EnvironmentUserOutboxRow,
} from './environment-user-outbox';
import { EnvironmentUserHostRefusal, type EnvironmentUserEvent, type EnvironmentUserHost } from './environment-user-host';
import { PENDING_SSO_SOURCE } from './pending-sso-marker';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';

const NOW = Date.parse('2026-11-15T12:00:00.000Z');

const EVENT: EnvironmentUserEvent = {
  userId: 'usr_p',
  email: 'pending@example.com',
  name: 'Pending',
  source: PENDING_SSO_SOURCE,
  actorId: 'usr_admin',
  actorCloudUserId: 'cloud_admin',
  occurredAt: '2026-11-15T11:00:00.000Z',
};

function harness(opts: { user?: Record<string, unknown> | null; host?: Partial<EnvironmentUserHost> } = {}) {
  const engine = createMemoryEngine();
  if (opts.user !== null) {
    engine.tables.set('sys_user', [{ id: 'usr_p', email: EVENT.email, source: PENDING_SSO_SOURCE, banned: 0, ...opts.user }]);
  }
  const calls: Array<{ member: string; event: EnvironmentUserEvent }> = [];
  const host: EnvironmentUserHost = {
    userAdded: (event) => void calls.push({ member: 'userAdded', event }),
    userDeactivated: (event) => void calls.push({ member: 'userDeactivated', event }),
    userReactivated: (event) => void calls.push({ member: 'userReactivated', event }),
    ...opts.host,
  };
  const logger = { warn: vi.fn(), error: vi.fn() };
  const deps = { getDataEngine: () => engine as any, host: () => host, logger, now: () => NOW };
  const rows = () => (engine.tables.get(ENVIRONMENT_USER_OUTBOX_OBJECT) ?? []) as any[];
  const seed = (doc: Record<string, unknown>) => engine.tables.set(ENVIRONMENT_USER_OUTBOX_OBJECT, [...rows(), doc]);
  const pendingRow = (over: Record<string, unknown> = {}) => ({
    ...outboxDoc('row_1', 'added', EVENT, { status: 'pending', lastError: 'down' }, NOW - 120_000),
    next_attempt_at: NOW - 1,
    ...over,
  });
  return { engine, calls, logger, deps, rows, seed, pendingRow };
}

describe('what one attempt makes of a row', () => {
  it('a call the host took is sent', () => {
    const settled = outboxSettlement({ notified: true }, 0, NOW);
    expect(settled.status).toBe('sent');
    expect(settled.data).toMatchObject({ attempts: 1, status: 'sent', next_attempt_at: null, claim_token: null });
  });

  it('a typed refusal is failed at once, with the host\'s code and sentence', () => {
    const settled = outboxSettlement({ refused: { status: 403, code: 'DEVELOPER_ORGANIZATION_MEMBER_LIMIT_REACHED', message: 'Cap.' } }, 3, NOW);
    expect(settled).toMatchObject({ status: 'failed', exhausted: false });
    expect(settled.data).toMatchObject({ attempts: 4, refusal_code: 'DEVELOPER_ORGANIZATION_MEMBER_LIMIT_REACHED', last_error: 'Cap.' });
  });

  it('a host that failed is pending again, due after the backoff for its attempt count', () => {
    expect(outboxSettlement({ notified: false, reason: 'host_failed' }, 0, NOW).data).toMatchObject({
      status: 'pending',
      attempts: 1,
      next_attempt_at: NOW + OUTBOX_BACKOFF_MS[0]!,
    });
    expect(outboxSettlement({ notified: false, reason: 'host_failed' }, 1, NOW).data.next_attempt_at).toBe(NOW + OUTBOX_BACKOFF_MS[1]!);
    // Past the schedule the last wait repeats.
    expect(outboxSettlement({ notified: false, reason: 'host_failed' }, 9, NOW).data.next_attempt_at).toBe(
      NOW + OUTBOX_BACKOFF_MS[OUTBOX_BACKOFF_MS.length - 1]!,
    );
  });

  it('the last attempt that fails is failed, and says no attempts are left', () => {
    const settled = outboxSettlement({ notified: false, reason: 'host_failed' }, OUTBOX_MAX_ATTEMPTS - 1, NOW);
    expect(settled).toMatchObject({ status: 'failed', exhausted: true });
    expect(String(settled.data.last_error)).toContain('No attempts are left.');
  });
});

describe('the claim keeps two workers off one row', () => {
  it('two workers that both read the row pending: exactly one holds it', async () => {
    const h = harness();
    h.seed(h.pendingRow());
    const snapshot = { ...h.rows()[0] } as EnvironmentUserOutboxRow;

    const first = await claimOutboxRow(h.engine as any, snapshot, NOW);
    const second = await claimOutboxRow(h.engine as any, snapshot, NOW);

    expect(first).toEqual(expect.any(String));
    expect(second).toBeUndefined();
    expect(h.rows()[0]).toMatchObject({ status: 'in_flight', claim_token: first, claimed_until: NOW + OUTBOX_LEASE_MS });
  });

  it('two passes over the same due row call the host once', async () => {
    const h = harness();
    h.seed(h.pendingRow());
    const [a, b] = await Promise.all([runEnvironmentUserOutboxTick(h.deps), runEnvironmentUserOutboxTick(h.deps)]);
    expect(a + b).toBe(1);
    expect(h.calls).toHaveLength(1);
    expect(h.rows()[0]).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it('a claim that lapsed is taken again; one still held is left alone', async () => {
    const held = harness();
    held.seed(held.pendingRow({ status: 'in_flight', claim_token: 'tok_live', claimed_until: NOW + 60_000 }));
    expect(await runEnvironmentUserOutboxTick(held.deps)).toBe(0);
    expect(held.calls).toHaveLength(0);

    const lapsed = harness();
    lapsed.seed(lapsed.pendingRow({ status: 'in_flight', claim_token: 'tok_dead', claimed_until: NOW - 1 }));
    expect(await runEnvironmentUserOutboxTick(lapsed.deps)).toBe(1);
    expect(lapsed.calls).toHaveLength(1);
    expect(lapsed.rows()[0]).toMatchObject({ status: 'sent' });
  });
});

describe('the worker\'s pass', () => {
  it('sends a due row with the stored event unchanged and the row id as the delivery id', async () => {
    const h = harness();
    h.seed(h.pendingRow());
    await runEnvironmentUserOutboxTick(h.deps);
    expect(h.calls).toEqual([{ member: 'userAdded', event: { ...EVENT, deliveryId: 'row_1' } }]);
    expect(h.rows()[0]).toMatchObject({ status: 'sent', attempts: 2, last_error: null, claim_token: null });
  });

  it('leaves a row that is not due yet', async () => {
    const h = harness();
    h.seed(h.pendingRow({ next_attempt_at: NOW + 1 }));
    expect(await runEnvironmentUserOutboxTick(h.deps)).toBe(0);
    expect(h.calls).toHaveLength(0);
  });

  it('a host that still fails pushes the row back by the next wait', async () => {
    const h = harness({ host: { userAdded: () => Promise.reject(new Error('cloud down')) } });
    h.seed(h.pendingRow());
    await runEnvironmentUserOutboxTick(h.deps);
    expect(h.rows()[0]).toMatchObject({ status: 'pending', attempts: 2, next_attempt_at: NOW + OUTBOX_BACKOFF_MS[1]! });
  });

  it('the last attempt that fails is failed and logged at error, once', async () => {
    const h = harness({ host: { userAdded: () => Promise.reject(new Error('cloud down')) } });
    h.seed(h.pendingRow({ attempts: OUTBOX_MAX_ATTEMPTS - 1 }));
    await runEnvironmentUserOutboxTick(h.deps);
    expect(h.rows()[0]).toMatchObject({ status: 'failed', attempts: OUTBOX_MAX_ATTEMPTS, next_attempt_at: null });
    expect(h.logger.error).toHaveBeenCalledOnce();
    expect(String(h.logger.error.mock.calls[0]![0])).toContain('nothing will retry it');
  });

  it('a typed refusal on a retry is failed with the host\'s answer, and the person is left as they are', async () => {
    const h = harness({
      host: {
        userAdded: () => {
          throw new EnvironmentUserHostRefusal(403, 'DEVELOPER_ORGANIZATION_MEMBER_LIMIT_REACHED', 'The member cap is reached.');
        },
      },
    });
    h.seed(h.pendingRow());
    await runEnvironmentUserOutboxTick(h.deps);
    expect(h.rows()[0]).toMatchObject({
      status: 'failed',
      refusal_code: 'DEVELOPER_ORGANIZATION_MEMBER_LIMIT_REACHED',
      last_error: 'The member cap is reached.',
    });
    expect(h.engine.tables.get('sys_user')).toEqual([expect.objectContaining({ id: 'usr_p', source: PENDING_SSO_SOURCE })]);
  });

  it('an invitation for a person who signed in meanwhile is accepted, and the host is not called', async () => {
    const h = harness({ user: { source: 'idp_provisioned' } });
    h.seed(h.pendingRow());
    await runEnvironmentUserOutboxTick(h.deps);
    expect(h.calls).toHaveLength(0);
    expect(h.rows()[0]).toMatchObject({ status: 'accepted', accepted_at: new Date(NOW).toISOString() });
  });

  it('an invitation for a person who is gone is superseded, and the host is not called', async () => {
    const h = harness({ user: null });
    h.seed(h.pendingRow());
    await runEnvironmentUserOutboxTick(h.deps);
    expect(h.calls).toHaveLength(0);
    expect(h.rows()[0]).toMatchObject({ status: 'superseded' });
  });

  it('a reactivation for a person deactivated again meanwhile is superseded; CONTROL: an active one is sent', async () => {
    const banned = harness({ user: { banned: 1 } });
    banned.seed(banned.pendingRow({ kind: 'reactivated' }));
    await runEnvironmentUserOutboxTick(banned.deps);
    expect(banned.calls).toHaveLength(0);
    expect(banned.rows()[0]).toMatchObject({ status: 'superseded' });

    const active = harness({ user: { banned: 0, source: 'idp_provisioned' } });
    active.seed(active.pendingRow({ kind: 'reactivated' }));
    await runEnvironmentUserOutboxTick(active.deps);
    expect(active.calls.map((c) => c.member)).toEqual(['userReactivated']);
  });

  it('an invitation for a pending person who was deactivated is superseded, waiting or stranded in flight; the host is not called', async () => {
    const h = harness({ user: { banned: 1 } });
    h.seed(h.pendingRow());
    h.seed(h.pendingRow({ id: 'row_2', status: 'in_flight', claim_token: 'dead', claimed_until: NOW - 1 }));
    await runEnvironmentUserOutboxTick(h.deps);
    expect(h.calls).toHaveLength(0);
    expect(h.rows().map((r) => r.status)).toEqual(['superseded', 'superseded']);
  });

  it('a cancellation for a person who signed in meanwhile is superseded; CONTROL: one for a person still pending is sent', async () => {
    const signedIn = harness({ user: { source: 'idp_provisioned' } });
    signedIn.seed(signedIn.pendingRow({ kind: 'removed' }));
    await runEnvironmentUserOutboxTick(signedIn.deps);
    expect(signedIn.calls).toHaveLength(0);
    expect(signedIn.rows()[0]).toMatchObject({ status: 'superseded' });

    const pending = harness();
    pending.seed(pending.pendingRow({ kind: 'removed' }));
    await runEnvironmentUserOutboxTick(pending.deps);
    expect(pending.calls.map((c) => c.member)).toEqual(['userDeactivated']);
  });

  it('a removal is sent on userRemoved, or on userDeactivated by a host without it', async () => {
    const removed = vi.fn();
    const own = harness({ user: null, host: { userRemoved: removed } });
    own.seed(own.pendingRow({ kind: 'removed' }));
    await runEnvironmentUserOutboxTick(own.deps);
    expect(removed).toHaveBeenCalledOnce();
    expect(own.calls).toHaveLength(0);

    const fallback = harness({ user: null });
    fallback.seed(fallback.pendingRow({ kind: 'removed' }));
    await runEnvironmentUserOutboxTick(fallback.deps);
    expect(fallback.calls.map((c) => c.member)).toEqual(['userDeactivated']);
    expect(fallback.calls[0]!.event.source).toBe(PENDING_SSO_SOURCE);
    expect(fallback.rows()[0]).toMatchObject({ status: 'sent' });
  });

  it('the next due time is the earliest pending row or lapsing claim; none answers null', async () => {
    const h = harness();
    expect(await environmentUserOutboxNextDueAt(h.deps)).toBeNull();
    h.seed(h.pendingRow({ id: 'a', next_attempt_at: NOW + 50_000 }));
    h.seed(h.pendingRow({ id: 'b', status: 'in_flight', next_attempt_at: null, claim_token: 't', claimed_until: NOW + 20_000 }));
    expect(await environmentUserOutboxNextDueAt(h.deps)).toBe(NOW + 20_000);
  });
});

describe('an invitation reads accepted once the person signs in', () => {
  function hookHarness() {
    const engine = createMemoryEngine() as any;
    const hooks: Array<{ event: string; handler: (ctx: any) => Promise<void>; object?: string }> = [];
    engine.registerHook = (event: string, handler: any, options?: { object?: string }) =>
      void hooks.push({ event, handler, object: options?.object });
    const logger = { warn: vi.fn() };
    registerOutboxAcceptedTrigger(engine, { logger });
    const fire = (input: unknown) => hooks.find((h) => h.event === 'afterUpdate' && h.object === 'sys_user')!.handler({ input });
    const rows = () => (engine.tables.get(ENVIRONMENT_USER_OUTBOX_OBJECT) ?? []) as any[];
    return { engine, fire, rows, logger };
  }

  it('the stamp that clears the pending marker marks the person\'s invitation rows accepted and stops a retry', async () => {
    const h = hookHarness();
    h.engine.tables.set(ENVIRONMENT_USER_OUTBOX_OBJECT, [
      { id: 'sent', user_id: 'usr_p', kind: 'added', status: 'sent' },
      { id: 'retry', user_id: 'usr_p', kind: 'added', status: 'pending', next_attempt_at: NOW },
      { id: 'old', user_id: 'usr_p', kind: 'added', status: 'superseded' },
      { id: 'other', user_id: 'usr_q', kind: 'added', status: 'sent' },
    ]);
    await h.fire({ id: 'usr_p', data: { id: 'usr_p', source: 'idp_provisioned' } });
    expect(Object.fromEntries(h.rows().map((r) => [r.id, r.status]))).toEqual({
      sent: 'accepted',
      retry: 'accepted',
      old: 'superseded',
      other: 'sent',
    });
    expect(h.rows().find((r) => r.id === 'retry').next_attempt_at).toBeNull();
  });

  it('CONTROL: an update that leaves the marker, or does not touch source, changes nothing', async () => {
    const h = hookHarness();
    h.engine.tables.set(ENVIRONMENT_USER_OUTBOX_OBJECT, [{ id: 'sent', user_id: 'usr_p', kind: 'added', status: 'sent' }]);
    await h.fire({ id: 'usr_p', data: { source: PENDING_SSO_SOURCE } });
    await h.fire({ id: 'usr_p', data: { name: 'Renamed' } });
    expect(h.rows()[0].status).toBe('sent');
  });

  it('a mark that fails is logged and never fails the sign-in', async () => {
    const h = hookHarness();
    h.engine.update = () => Promise.reject(new Error('store down'));
    await expect(h.fire({ id: 'usr_p', data: { source: 'idp_provisioned' } })).resolves.toBeUndefined();
    expect(h.logger.warn).toHaveBeenCalledOnce();
  });
});

describe('the outbox boots only on a cloud-managed kernel with a host wired', () => {
  function bootHarness() {
    const engine = createMemoryEngine() as any;
    const hooks: string[] = [];
    engine.registerHook = (event: string, _handler: unknown, options?: { object?: string }) =>
      void hooks.push(`${event}:${options?.object}`);
    const host: EnvironmentUserHost = { userAdded: () => {}, userDeactivated: () => {}, userReactivated: () => {} };
    return { engine, hooks, host };
  }

  it('starts the worker and registers the accepted trigger when the kernel is cloud-managed and a host is wired', async () => {
    const h = bootHarness();
    const worker = bootEnvironmentUserOutbox(h.engine, { host: () => h.host, isCloudManaged: () => true });
    try {
      expect(worker).toBeDefined();
      expect(h.hooks).toEqual(['afterUpdate:sys_user']);
    } finally {
      await worker?.stop();
    }
  });

  it('does nothing off a cloud-managed kernel, even with a host wired, or with no host', () => {
    const h = bootHarness();
    expect(bootEnvironmentUserOutbox(h.engine, { host: () => h.host, isCloudManaged: () => false })).toBeUndefined();
    expect(bootEnvironmentUserOutbox(h.engine, { host: undefined, isCloudManaged: () => true })).toBeUndefined();
    expect(h.hooks).toEqual([]);
  });
});
