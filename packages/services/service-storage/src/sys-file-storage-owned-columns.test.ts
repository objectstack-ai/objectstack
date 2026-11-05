// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The create-side guard of `sys_file`, judged at the guard: the handler
 * {@link installSysFileStorageOwnedColumnsGuard} registers, called with the
 * hook contexts the engine builds. The real engine around it is
 * `sys-file-storage-owned-columns.integration.test.ts`.
 *
 * The rule pinned here is the uploader's: a stored file's uploader is the user
 * who created it, as an attachment's and a comment's author are. A non-system
 * create records the session's user as `owner_id` over whatever it carried, and
 * one whose session names no signed-in user is refused, as the attachment and
 * comment create hooks refuse theirs. System context keeps what it supplies,
 * and so does a call with no session at all (a bare kernel), which the
 * attachment hook passes the same way.
 */

import { describe, it, expect, vi } from 'vitest';
import { installSysFileStorageOwnedColumnsGuard } from './sys-file-storage-owned-columns.js';

type Handler = (ctx: any) => void | Promise<void>;

/** Install the guard on a stand-in engine and hand back its one handler. */
function installGuard() {
  const registered: Array<{ event: string; handler: Handler; options: { object: string } }> = [];
  const logger = { warn: vi.fn() };
  installSysFileStorageOwnedColumnsGuard(
    { registerHook: (event, handler, options) => { registered.push({ event, handler, options }); } },
    logger,
  );
  expect(registered.map((r) => [r.event, r.options.object])).toEqual([['beforeInsert', 'sys_file']]);
  const run = async (session: unknown, data: Record<string, unknown>) => {
    await registered[0]!.handler({ object: 'sys_file', event: 'beforeInsert', session, input: { data } });
    return data;
  };
  return { run, logger };
}

/** What a thrown refusal answers, reduced to the two members ADR-0112 makes assertable. */
async function refusalOf(write: Promise<unknown>): Promise<{ code: unknown; status: unknown } | null> {
  return write.then(
    () => null,
    (err: any) => ({ code: err?.code, status: err?.status }),
  );
}

const CREATOR = 'u_creator';
const SOMEONE_ELSE = 'u_someone_else';

describe('a stored file\'s uploader is the user who created it (sys_file.owner_id on create)', () => {
  it('a non-system create records the session\'s user as the uploader, over an owner_id naming another user', async () => {
    const { run } = installGuard();
    const row = await run({ userId: CREATOR }, { name: 'a.png', owner_id: SOMEONE_ELSE });
    expect(row.owner_id).toBe(CREATOR);
    expect(row.name).toBe('a.png');
  });

  it('a non-system create that names no uploader records the session\'s user', async () => {
    const { run } = installGuard();
    expect((await run({ userId: CREATOR }, { name: 'a.png' })).owner_id).toBe(CREATOR);
  });

  it.each([
    ['a session that names no user (a service principal)', { actor: 'svc:flow:importer' }],
    ['a session that names only an organization', { organizationId: 'org_1' }],
    ['a session whose user id is empty', { userId: '' }],
  ])('a non-system create is refused 403 RECORD_NOT_ACCESSIBLE when there is no signed-in user to record: %s', async (_label, session) => {
    const { run, logger } = installGuard();
    expect(await refusalOf(run(session, { name: 'a.png', owner_id: SOMEONE_ELSE, status: 'committed' }))).toEqual({
      code: 'RECORD_NOT_ACCESSIBLE',
      status: 403,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('a system create keeps the uploader it supplies', async () => {
    const { run } = installGuard();
    const row = await run({ userId: CREATOR, isSystem: true }, { name: 'a.png', owner_id: SOMEONE_ELSE });
    expect(row.owner_id).toBe(SOMEONE_ELSE);
  });

  it('a create with no session at all (a bare kernel) keeps the uploader it supplies, and still loses the storage-owned columns', async () => {
    const { run } = installGuard();
    const row = await run(undefined, { name: 'a.png', owner_id: SOMEONE_ELSE, status: 'committed', key: 'k' });
    expect(row.owner_id).toBe(SOMEONE_ELSE);
    expect(row.status).toBe('pending');
    expect(row).not.toHaveProperty('key');
  });

  it('the uploader is recorded beside the storage-owned strip, which still drops the caller\'s columns and starts the row pending', async () => {
    const { run, logger } = installGuard();
    const row = await run({ userId: CREATOR }, { name: 'a.png', owner_id: SOMEONE_ELSE, size: 9, status: 'committed' });
    expect(row).toEqual({ name: 'a.png', owner_id: CREATOR, status: 'pending' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]![1]).toMatchObject({ fields: ['size', 'status'] });
  });
});
