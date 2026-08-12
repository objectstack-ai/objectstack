// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7725] Unit pins for the adoption decision itself.
//
// The end-to-end proof lives in `accept-invitation-adopt-membership.test.ts`
// (real better-auth pipeline, an engine that enforces `sys_member`'s unique
// index). This file pins the two things that file exercises only along the
// paths it happens to drive: the role ladder, and the "not an adoption case"
// answers that must stay a plain insert.

import { describe, it, expect, vi } from 'vitest';
import { adoptExistingMembership, decideAdoptedRole } from './adopt-membership';

const silent = { logger: { info: () => {} } };

describe('decideAdoptedRole', () => {
  it('applies the invitation’s role over the reconciler’s auto-bound default', () => {
    expect(decideAdoptedRole('member', 'admin')).toEqual({ role: 'admin', verdict: 'applied' });
    expect(decideAdoptedRole('member', 'owner')).toEqual({ role: 'owner', verdict: 'applied' });
  });

  it('takes a grade-FLAT invitation role too — intent is not dropped just because the grade is equal', () => {
    // `delegated_admin` is reach, not authority (ADR-0105 D8), so `orgRoleGrade`
    // puts it level with `member`. Keeping the default here is exactly the
    // "silently keep the default" failure adoption exists to avoid.
    expect(decideAdoptedRole('member', 'delegated_admin')).toEqual({
      role: 'delegated_admin',
      verdict: 'applied',
    });
  });

  it('never LOWERS a grade — demotion belongs to update-member-role, where last-admin-guard stands', () => {
    expect(decideAdoptedRole('owner', 'member')).toEqual({ role: 'owner', verdict: 'kept-higher' });
    expect(decideAdoptedRole('owner', 'admin')).toEqual({ role: 'owner', verdict: 'kept-higher' });
    expect(decideAdoptedRole('admin', 'member')).toEqual({ role: 'admin', verdict: 'kept-higher' });
  });

  it('reports an identical role as unchanged, across better-auth’s spellings', () => {
    expect(decideAdoptedRole('member', 'member').verdict).toBe('unchanged');
    // Comma-joined and array spellings are the same value to better-auth, so a
    // pointless write must not be issued for them either.
    expect(decideAdoptedRole('owner,admin', 'admin,owner').verdict).toBe('unchanged');
    expect(decideAdoptedRole('admin', ['admin']).verdict).toBe('unchanged');
  });

  it('keeps the existing role when nothing was asked for', () => {
    expect(decideAdoptedRole('admin', undefined)).toEqual({ role: 'admin', verdict: 'unchanged' });
    expect(decideAdoptedRole('admin', '')).toEqual({ role: 'admin', verdict: 'unchanged' });
  });
});

describe('adoptExistingMembership — when it declines, the caller must insert normally', () => {
  const engineWith = (row: any) => ({
    findOne: vi.fn().mockResolvedValue(row),
    update: vi.fn().mockImplementation(async (_o: string, patch: any) => ({ ...row, ...patch })),
  });

  it('declines for any object other than sys_member', async () => {
    const engine = engineWith({ id: 'm1', role: 'member' });
    expect(await adoptExistingMembership(engine, 'sys_user', { user_id: 'u1' }, silent)).toBeNull();
    expect(engine.findOne).not.toHaveBeenCalled();
  });

  it('declines when either half of the declared unique key is missing', async () => {
    const engine = engineWith({ id: 'm1', role: 'member' });
    expect(
      await adoptExistingMembership(engine, 'sys_member', { user_id: 'u1' }, silent),
    ).toBeNull();
    expect(
      await adoptExistingMembership(engine, 'sys_member', { organization_id: 'o1' }, silent),
    ).toBeNull();
    // A null organization_id is left alone on purpose: ADR-0120 D3 folds NULL
    // into the `'__global__'` bucket for uniqueness and this function does not
    // reproduce that folding.
    expect(
      await adoptExistingMembership(
        engine,
        'sys_member',
        { organization_id: null, user_id: 'u1' },
        silent,
      ),
    ).toBeNull();
    expect(engine.findOne).not.toHaveBeenCalled();
  });

  it('declines when no row exists for the pair — the ordinary insert path', async () => {
    const engine = engineWith(null);
    expect(
      await adoptExistingMembership(
        engine,
        'sys_member',
        { organization_id: 'o1', user_id: 'u1', role: 'member' },
        silent,
      ),
    ).toBeNull();
    expect(engine.findOne).toHaveBeenCalledWith('sys_member', {
      where: { organization_id: 'o1', user_id: 'u1' },
    });
    expect(engine.update).not.toHaveBeenCalled();
  });
});

describe('adoptExistingMembership — when it adopts', () => {
  const engineWith = (row: any) => ({
    findOne: vi.fn().mockResolvedValue(row),
    update: vi.fn().mockImplementation(async (_o: string, patch: any) => ({ ...row, ...patch })),
  });

  it('writes the invitation’s role onto the existing row and returns it', async () => {
    const engine = engineWith({
      id: 'mem_1',
      organization_id: 'o1',
      user_id: 'u1',
      role: 'member',
      created_at: '2026-01-01T00:00:00.000Z',
    });

    const adopted = await adoptExistingMembership(
      engine,
      'sys_member',
      { id: 'discarded', organization_id: 'o1', user_id: 'u1', role: 'admin' },
      silent,
    );

    expect(engine.update).toHaveBeenCalledWith('sys_member', { id: 'mem_1', role: 'admin' });
    expect(adopted).toMatchObject({ id: 'mem_1', role: 'admin' });
    // The membership really did begin at sign-up — acceptance does not restart it.
    expect(adopted!.created_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('issues NO write when the role is already right, and still returns the row', async () => {
    const engine = engineWith({ id: 'mem_1', organization_id: 'o1', user_id: 'u1', role: 'admin' });
    const adopted = await adoptExistingMembership(
      engine,
      'sys_member',
      { organization_id: 'o1', user_id: 'u1', role: 'admin' },
      silent,
    );
    expect(engine.update).not.toHaveBeenCalled();
    expect(adopted).toMatchObject({ id: 'mem_1', role: 'admin' });
  });

  it('issues no write — and keeps the higher grade — when the invitation would demote', async () => {
    const engine = engineWith({ id: 'mem_1', organization_id: 'o1', user_id: 'u1', role: 'owner' });
    const adopted = await adoptExistingMembership(
      engine,
      'sys_member',
      { organization_id: 'o1', user_id: 'u1', role: 'member' },
      silent,
    );
    expect(engine.update).not.toHaveBeenCalled();
    expect(adopted).toMatchObject({ id: 'mem_1', role: 'owner' });
  });

  it('says so out loud — an adoption is never silent', async () => {
    const info = vi.fn();
    const engine = engineWith({ id: 'mem_1', organization_id: 'o1', user_id: 'u1', role: 'member' });
    await adoptExistingMembership(
      engine,
      'sys_member',
      { organization_id: 'o1', user_id: 'u1', role: 'admin' },
      { logger: { info } },
    );
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]![0])).toContain('adopted the existing sys_member row');
    expect(info.mock.calls[0]![1]).toMatchObject({
      memberId: 'mem_1',
      existingRole: 'member',
      incomingRole: 'admin',
      resultingRole: 'admin',
      verdict: 'applied',
    });
  });
});
