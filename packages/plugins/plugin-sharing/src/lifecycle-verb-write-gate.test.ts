// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30237 PR 4] The sharing write gate judges a lifecycle verb by its write
 * class (`rlsOperationForVerb`, `@objectstack/core`): the permanent delete
 * dispatches `purge` by id, and that row is asked `canDelete` exactly as an
 * ordinary delete is. Before the recycle bin's grants were read, `purge` was
 * refused for every caller but the system at the object gate, so this gate
 * never had to answer it; now a `manageRecycleBin` holder reaches it.
 *
 * The bin's own doors (`restore(entryId)`, `purge(entryId)`, `empty(object)`)
 * dispatch with no id and no AST: they address no live row, so the gate
 * passes them on untouched and writes no AST onto them.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildSharingMiddleware } from './sharing-plugin.js';

const MEMBER = { userId: 'u_member', tenantId: 'org_1' };

function makeService(admits: boolean) {
  return {
    admitsByIdWrite: vi.fn(async () => admits),
    buildWriteFilter: vi.fn(async () => ({ owner_id: 'u_member' })),
  };
}

async function drive(service: ReturnType<typeof makeService>, opCtx: any) {
  const mw = buildSharingMiddleware(service as any, { warn: () => {} }) as any;
  let reached = false;
  const outcome = await mw(opCtx, async () => { reached = true; }).then(
    () => 'passed',
    (e: any) => e?.code,
  );
  return { outcome, reached };
}

describe('the sharing write gate on lifecycle verbs (#30237 PR 4)', () => {
  it('asks `canDelete` (verb `delete`) of a by-id `purge`, and refuses FORBIDDEN when the row is not the caller\'s to delete', async () => {
    const service = makeService(false);
    const opCtx = { object: 'deal', operation: 'purge', options: { where: { id: 'd1' }, permanent: true }, context: MEMBER };

    const { outcome, reached } = await drive(service, opCtx);

    expect(outcome).toBe('FORBIDDEN');
    expect(reached).toBe(false);
    expect(service.admitsByIdWrite).toHaveBeenCalledWith('deal', 'd1', 'delete', MEMBER);
  });

  it('passes a by-id `purge` the delete gate admits, asked as `delete`', async () => {
    const service = makeService(true);
    const opCtx = { object: 'deal', operation: 'purge', options: { where: { id: 'd1' }, permanent: true }, context: MEMBER };

    const { outcome, reached } = await drive(service, opCtx);

    expect(outcome).toBe('passed');
    expect(reached).toBe(true);
    expect(service.admitsByIdWrite).toHaveBeenCalledWith('deal', 'd1', 'delete', MEMBER);
  });

  it('scopes a bulk `purge` to the rows the caller may DELETE', async () => {
    const service = makeService(true);
    const opCtx: any = { object: 'deal', operation: 'purge', ast: { where: { stage: 'lost' } }, options: {}, context: MEMBER };

    const { outcome } = await drive(service, opCtx);

    expect(outcome).toBe('passed');
    expect(service.buildWriteFilter).toHaveBeenCalledWith('deal', MEMBER, 'delete');
    expect(opCtx.ast.where).toEqual({ $and: [{ stage: 'lost' }, { owner_id: 'u_member' }] });
  });

  it.each([
    ['restore(entryId)', 'restore'],
    ['purge(entryId) / empty(object)', 'purge'],
  ])("passes the recycle bin's own %s dispatch on untouched: no id, no AST, nothing asked", async (_door, operation) => {
    const service = makeService(false);
    const opCtx: any = { object: 'deal', operation, options: { context: MEMBER }, context: MEMBER };

    const { outcome, reached } = await drive(service, opCtx);

    expect(outcome).toBe('passed');
    expect(reached).toBe(true);
    expect(opCtx.ast).toBeUndefined();
    expect(service.admitsByIdWrite).not.toHaveBeenCalled();
    expect(service.buildWriteFilter).not.toHaveBeenCalled();
  });

  it('keeps an ordinary by-id delete on the same gate', async () => {
    const service = makeService(false);
    const { outcome } = await drive(service, { object: 'deal', operation: 'delete', options: { where: { id: 'd1' } }, context: MEMBER });
    expect(outcome).toBe('FORBIDDEN');
    expect(service.admitsByIdWrite).toHaveBeenCalledWith('deal', 'd1', 'delete', MEMBER);
  });
});
