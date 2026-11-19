// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `admin/remove-sso-user` writes the admin audit row the add doors write
 * (`writeAdminAudit`), once, for a removal that committed, and none for a
 * removal it refused: a host that could not be reached (`503`, nothing
 * removed), a host's typed refusal, or a person who is not pending.
 *
 * Drives `runRemoveSsoUser` on the shared memory engine double, so the
 * removal's real deletes run and the audit row lands in `sys_audit_log`.
 */

import { describe, it, expect } from 'vitest';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { runRemoveSsoUser, type PendingSsoUserDeps } from './pending-sso-users';
import { PENDING_SSO_SOURCE } from './pending-sso-marker';
import { EnvironmentUserHostRefusal, type EnvironmentUserHost } from './environment-user-host';

const ADMIN = { id: 'usr_admin' };
const PENDING_ID = 'usr_pending';

function stage(host?: EnvironmentUserHost) {
  const engine = createMemoryEngine() as any;
  engine.tables.set('sys_user', [
    { id: ADMIN.id, email: 'admin@example.com', name: 'Admin', source: null },
    { id: PENDING_ID, email: 'typo@exmaple.com', name: 'Typo', source: PENDING_SSO_SOURCE },
    { id: 'usr_signed_in', email: 'member@example.com', name: 'Member', source: 'idp' },
  ]);
  engine.tables.set('sys_member', [{ id: 'mem_1', user_id: PENDING_ID, organization_id: 'org_1' }]);
  const deps = {
    isCloudManaged: () => true,
    getDataEngine: () => engine,
    getTenancy: () => undefined,
    getMembershipPolicy: () => undefined,
    ...(host ? { host: () => host } : {}),
    logger: { warn: () => {} },
  } as unknown as PendingSsoUserDeps;
  const remove = async (userId: string) =>
    runRemoveSsoUser(
      deps,
      ADMIN,
      new Request('http://localhost/api/v1/auth/admin/remove-sso-user', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId }),
      }),
    );
  const auditRows = (): any[] => engine.tables.get('sys_audit_log') ?? [];
  const user = (id: string) => (engine.tables.get('sys_user') as any[]).find((r) => r.id === id);
  return { remove, auditRows, user };
}

const quietHost = (removed: EnvironmentUserHost['userDeactivated']): EnvironmentUserHost => ({
  userAdded: () => {},
  userDeactivated: () => {},
  userReactivated: () => {},
  userRemoved: removed,
});

describe('admin/remove-sso-user writes an admin audit row for a removal that committed', () => {
  it('a removal the host took writes one delete row naming the admin, the person and the decision', async () => {
    const s = stage(quietHost(() => {}));

    const res = await s.remove(PENDING_ID);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(s.user(PENDING_ID)).toBeUndefined();
    const rows = s.auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'delete',
      user_id: ADMIN.id,
      actor: ADMIN.id,
      object_name: 'sys_user',
      record_id: PENDING_ID,
    });
    expect(JSON.parse(rows[0].metadata)).toEqual({ event: 'user.admin_removed_pending', hostNotified: true });
  });

  it('a removal with no host wired writes the row with hostNotified false', async () => {
    const s = stage();

    expect((await s.remove(PENDING_ID)).status).toBe(200);

    const rows = s.auditRows();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].metadata)).toEqual({ event: 'user.admin_removed_pending', hostNotified: false });
  });

  it('CONTROL: a host that cannot be reached refuses the removal with 503 and no row is written', async () => {
    const s = stage(
      quietHost(() => {
        throw new Error('connect ECONNREFUSED');
      }),
    );

    const res = await s.remove(PENDING_ID);

    expect(res.status).toBe(503);
    expect((res.body as any).error.code).toBe('SERVICE_UNAVAILABLE');
    expect(s.user(PENDING_ID)).toBeDefined();
    expect(s.auditRows()).toHaveLength(0);
  });

  it('CONTROL: a host refusal and a person who is not pending write no row', async () => {
    const refused = stage(
      quietHost(() => {
        throw new EnvironmentUserHostRefusal(409, 'RESOURCE_CONFLICT', 'An organization owner cannot be removed here.');
      }),
    );
    const r1 = await refused.remove(PENDING_ID);
    expect(r1.status).toBe(409);
    expect((r1.body as any).error.code).toBe('RESOURCE_CONFLICT');
    expect(refused.auditRows()).toHaveLength(0);

    const notPending = stage(quietHost(() => {}));
    const r2 = await notPending.remove('usr_signed_in');
    expect(r2.status).toBe(409);
    expect((r2.body as any).error.code).toBe('RESOURCE_CONFLICT');
    expect(notPending.auditRows()).toHaveLength(0);
  });
});
