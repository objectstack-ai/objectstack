// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4586] The better-auth actor seam.
 *
 * These cover the seam's own mechanics — scope lifetime, laziness, the
 * re-entrancy guard, and the two-part context it builds. The proof that the
 * REAL routes reach it (invite-accept, update-member-role, the reconciler bind,
 * demotion revoke) lives at the call sites, in
 * `packages/qa/dogfood/test/membership-actor-attribution.dogfood.test.ts` —
 * the #3106 lesson: a function that works in isolation is not a seam anyone
 * actually crosses.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IDataEngine } from '@objectstack/core';
import {
  runWithAuthActorScope,
  setAuthActorResolver,
  resolveAttributedUserId,
  authSystemWriteContext,
} from './auth-actor-attribution';
import { withSystemContext } from './objectql-adapter';

describe('auth actor attribution scope (#4586)', () => {
  it('resolves the actor registered for the current request', async () => {
    const seen = await runWithAuthActorScope(async () => {
      setAuthActorResolver(async () => 'usr_admin');
      return resolveAttributedUserId();
    });
    expect(seen).toBe('usr_admin');
  });

  it('is LAZY — registering a resolver does not run it', async () => {
    const resolver = vi.fn(async () => 'usr_admin');
    await runWithAuthActorScope(async () => {
      setAuthActorResolver(resolver);
      // A read-only auth request never asks who to credit, so it must not pay
      // for a session lookup. This is what keeps the general shape cheap
      // enough to leave on for every endpoint.
      expect(resolver).not.toHaveBeenCalled();
    });
    expect(resolver).not.toHaveBeenCalled();
  });

  it('runs the resolver at most once, shared by concurrent writes', async () => {
    const resolver = vi.fn(async () => 'usr_admin');
    const results = await runWithAuthActorScope(async () => {
      setAuthActorResolver(resolver);
      return Promise.all([
        resolveAttributedUserId(),
        resolveAttributedUserId(),
        resolveAttributedUserId(),
      ]);
    });
    expect(results).toEqual(['usr_admin', 'usr_admin', 'usr_admin']);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('does not deadlock when resolving the session itself writes (re-entrancy)', async () => {
    // Real shape: resolving the actor goes back through better-auth, which may
    // refresh the session row — a WRITE, which asks who to credit. That inner
    // ask must return immediately rather than await the resolution producing
    // it. A sibling write started afterwards still gets the answer.
    let innerSawActor: string | undefined = 'not-run';
    const scoped = runWithAuthActorScope(async () => {
      setAuthActorResolver(async () => {
        innerSawActor = await resolveAttributedUserId();
        return 'usr_admin';
      });
      return resolveAttributedUserId();
    });
    await expect(scoped).resolves.toBe('usr_admin');
    expect(innerSawActor).toBeUndefined();
  });

  it('a failing or empty resolver attributes nothing — never throws', async () => {
    const boom = await runWithAuthActorScope(async () => {
      setAuthActorResolver(async () => {
        throw new Error('session store down');
      });
      return resolveAttributedUserId();
    });
    expect(boom).toBeUndefined();

    const anonymous = await runWithAuthActorScope(async () => {
      setAuthActorResolver(async () => null);
      return resolveAttributedUserId();
    });
    expect(anonymous).toBeUndefined();
  });

  it('outside any request scope there is no actor — absence is the system, not a caller', async () => {
    // Programmatic `auth.api.*` calls, boot sync, scheduled jobs. ADR-0118 D1:
    // that records as `null`, never as some ambient user.
    expect(await resolveAttributedUserId()).toBeUndefined();
    expect(await authSystemWriteContext()).toEqual({ isSystem: true });
  });

  it('does not leak across sibling requests', async () => {
    const [a, b] = await Promise.all([
      runWithAuthActorScope(async () => {
        setAuthActorResolver(async () => 'usr_a');
        await new Promise((r) => setTimeout(r, 5));
        return resolveAttributedUserId();
      }),
      runWithAuthActorScope(async () => {
        setAuthActorResolver(async () => 'usr_b');
        return resolveAttributedUserId();
      }),
    ]);
    expect(a).toBe('usr_a');
    expect(b).toBe('usr_b');
  });

  it('builds a context whose AUTHORIZATION half is system and ATTRIBUTION half is the human', async () => {
    const ctx = await runWithAuthActorScope(async () => {
      setAuthActorResolver(async () => 'usr_admin');
      return authSystemWriteContext();
    });
    // The two halves are separate fields on purpose: `isSystem` decides what
    // the write may touch, `attributedUserId` decides only who it is credited
    // to. Nothing here may name the human as `userId`.
    expect(ctx).toEqual({ isSystem: true, attributedUserId: 'usr_admin' });
    expect(ctx).not.toHaveProperty('userId');
  });
});

describe('withSystemContext carries attribution on WRITES only (#4586)', () => {
  const mockEngine = () =>
    ({
      insert: vi.fn().mockResolvedValue({ id: '1' }),
      update: vi.fn().mockResolvedValue({ id: '1' }),
      delete: vi.fn().mockResolvedValue(undefined),
      find: vi.fn().mockResolvedValue([]),
      findOne: vi.fn().mockResolvedValue({ id: '1' }),
      count: vi.fn().mockResolvedValue(0),
    }) as unknown as IDataEngine;

  it('stamps the attributed human on insert / update / delete, beside isSystem', async () => {
    const engine = mockEngine();
    await runWithAuthActorScope(async () => {
      setAuthActorResolver(async () => 'usr_admin');
      const e = withSystemContext(engine);
      await e.insert('sys_member', { id: 'm1' } as any);
      await e.update('sys_member', { id: 'm1' } as any);
      await e.delete('sys_member', { where: { id: 'm1' } } as any);
    });

    const expected = { context: { attributedUserId: 'usr_admin', isSystem: true } };
    expect(engine.insert).toHaveBeenCalledWith('sys_member', { id: 'm1' }, expected);
    expect(engine.update).toHaveBeenCalledWith('sys_member', { id: 'm1' }, expected);
    expect(engine.delete).toHaveBeenCalledWith(
      'sys_member',
      expect.objectContaining(expected),
    );
  });

  it('never puts the human on `userId` — the write still authorizes as the system', async () => {
    const engine = mockEngine();
    await runWithAuthActorScope(async () => {
      setAuthActorResolver(async () => 'usr_admin');
      await withSystemContext(engine).insert('sys_member', { id: 'm1' } as any);
    });
    const ctx = (engine.insert as any).mock.calls[0][2].context;
    // The hard constraint of #4586, pinned at the seam that could break it:
    // better-auth already authorized this write under its own ACL. Re-running
    // it as the human would open a second adjudication track (ADR-0095 D3).
    expect(ctx.userId).toBeUndefined();
    expect(ctx.isSystem).toBe(true);
    expect(ctx.attributedUserId).toBe('usr_admin');
  });

  it('READS carry no attribution — a read changes nothing to attribute', async () => {
    const engine = mockEngine();
    await runWithAuthActorScope(async () => {
      setAuthActorResolver(async () => 'usr_admin');
      const e = withSystemContext(engine);
      await e.find('sys_member', { where: {} } as any);
      await e.findOne('sys_member', { where: {} } as any);
      await e.count('sys_member', { where: {} } as any);
    });
    expect(engine.find).toHaveBeenCalledWith('sys_member', expect.objectContaining({ context: { isSystem: true } }));
    expect(engine.findOne).toHaveBeenCalledWith('sys_member', expect.objectContaining({ context: { isSystem: true } }));
    expect(engine.count).toHaveBeenCalledWith('sys_member', expect.objectContaining({ context: { isSystem: true } }));
  });

  it('outside a request scope writes are unchanged — plain isSystem', async () => {
    const engine = mockEngine();
    await withSystemContext(engine).insert('sys_member', { id: 'm1' } as any);
    expect(engine.insert).toHaveBeenCalledWith('sys_member', { id: 'm1' }, { context: { isSystem: true } });
  });

  it('an explicit caller-supplied context still wins on every key', async () => {
    const engine = mockEngine();
    await runWithAuthActorScope(async () => {
      setAuthActorResolver(async () => 'usr_admin');
      await withSystemContext(engine).insert('sys_member', { id: 'm1' } as any, {
        context: { transaction: 'tx1', attributedUserId: 'usr_explicit' },
      } as any);
    });
    expect(engine.insert).toHaveBeenCalledWith('sys_member', { id: 'm1' }, {
      context: { attributedUserId: 'usr_explicit', isSystem: true, transaction: 'tx1' },
    });
  });
});
