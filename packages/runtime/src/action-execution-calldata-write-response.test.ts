// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `callData`'s ObjectQL fallback (no `protocol` slot) is a write mouth of its
 * own: its create arm answers with the engine's write result, which keeps the
 * stored row whole. It owes the same write-response rules the protocol ingress
 * applies — credential-class fields masked, `internal` fields omitted — so the
 * answer cannot depend on whether a deployment registered the protocol slot.
 *
 * Synthetic fixtures; the stored values are sentinels.
 */

import { describe, it, expect } from 'vitest';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { SECRET_MASK } from '@objectstack/spec/data';
import { callData, executeDeclarativeUpdateAction, type ActionExecutionDeps } from './action-execution.js';
import type { HttpProtocolContext } from './http-dispatcher.js';

const EC = { userId: 'u1', isSystem: false, positions: [], permissions: [] } as any;
const REQ = { request: {} } as HttpProtocolContext;
const STORED_PASSWORD = 'PASSWORD-SENTINEL-NEVER-SERIALIZED';
const STORED_REF = 'secret:HANDLE-SENTINEL-NEVER-SERIALIZED';
const STORED_INTERNAL = 'INTERNAL-SENTINEL-NEVER-SERIALIZED';

const SCHEMA = {
  name: 'cred_holder',
  fields: {
    title: { name: 'title', type: 'text' },
    login_password: { name: 'login_password', type: 'password' },
    api_token: { name: 'api_token', type: 'secret' },
    hidden_hash: { name: 'hidden_hash', type: 'text', internal: true },
  },
};

function fallbackHarness() {
  const store = new Map<string, any>();
  const stored = (row: Record<string, unknown>) => ({
    ...row,
    login_password: STORED_PASSWORD,
    api_token: STORED_REF,
    hidden_hash: STORED_INTERNAL,
  });
  const ql: any = {
    registry: { getObject: (n: string) => (n === 'cred_holder' ? SCHEMA : undefined) },
    insert: async (_o: string, data: any) => {
      const row = stored({ ...data, id: 'r1' });
      store.set('r1', row);
      return { ...row };
    },
    // The engine's READ path masks/omits — mirrored here so the update echo's
    // `existing` half is what a real read returns.
    find: async (_o: string, bag: any) => {
      const hit = store.get(String(bag?.where?.id));
      if (!hit) return [];
      const { hidden_hash: _omit, ...rest } = hit;
      return [{ ...rest, login_password: SECRET_MASK, api_token: SECRET_MASK }];
    },
    update: async (_o: string, data: any, opts: any) => {
      assertEngineUpdateDispatch(data, opts);
      const id = String(opts?.where?.id);
      const row = stored({ ...store.get(id), ...data });
      store.set(id, row);
      return { ...row };
    },
  };
  const deps: ActionExecutionDeps = {
    resolveService: (async (_c: HttpProtocolContext, name: string) =>
      name === 'metadata' ? { getObject: async () => SCHEMA } : name === 'objectql' ? ql : undefined) as any,
    getObjectQL: async () => ql,
  };
  return { deps, ql };
}

const NEVER = [STORED_PASSWORD, STORED_REF, STORED_INTERNAL, 'caller-sent-password'];
const leaks = (v: unknown) => NEVER.filter((s) => JSON.stringify(v).includes(s));

describe('callData fallback write arms apply the write-response rules', () => {
  it('create: no stored credential value or internal value in the response; the record still flows', async () => {
    const { deps, ql } = fallbackHarness();
    const res = await callData(deps, REQ, 'create', { object: 'cred_holder', data: { title: 'kept' } }, ql, undefined, EC);
    expect(leaks(res)).toEqual([]);
    expect(res.record.title).toBe('kept');
    expect(res.record.login_password).toBe(SECRET_MASK);
    expect(res.record.api_token).toBe(SECRET_MASK);
    expect(Object.keys(res.record)).not.toContain('hidden_hash');
  });

  it('update: the echo never returns a credential the caller wrote, in clear', async () => {
    const { deps, ql } = fallbackHarness();
    await ql.insert('cred_holder', { title: 'one' });
    const res = await callData(
      deps, REQ, 'update',
      { object: 'cred_holder', id: 'r1', data: { title: 'two', login_password: 'caller-sent-password' } },
      ql, undefined, EC,
    );
    expect(leaks(res)).toEqual([]);
    expect(res.record.title).toBe('two');
    expect(res.record.login_password).toBe(SECRET_MASK);
  });

  it('the fixture is armed: the engine write result really carries the stored values', async () => {
    const { ql } = fallbackHarness();
    const raw = await ql.insert('cred_holder', { title: 'x' });
    expect(leaks(raw)).toEqual([STORED_PASSWORD, STORED_REF, STORED_INTERNAL]);
  });
});

describe('callData fallback write arms fail closed when no schema resolves', () => {
  function schemaLessHarness() {
    const { ql } = fallbackHarness();
    // No registry entry, and a metadata service that throws: nothing to judge the fields by.
    ql.registry = { getObject: () => undefined };
    const deps: ActionExecutionDeps = {
      resolveService: (async (_c: HttpProtocolContext, name: string) => {
        if (name === 'metadata') throw new Error('metadata unavailable');
        return name === 'objectql' ? ql : undefined;
      }) as any,
      getObjectQL: async () => ql,
    };
    return { deps, ql };
  }

  it('create: answers the receipt only, carrying no record', async () => {
    const { deps, ql } = schemaLessHarness();
    // The exposure gate reads metadata too and falls open on its own; the write arm must not.
    const res = await callData(deps, REQ, 'create', { object: 'cred_holder', data: { title: 'kept' } }, ql, undefined, EC);
    expect(res).toEqual({ object: 'cred_holder', id: 'r1' });
    expect(leaks(res)).toEqual([]);
  });

  it('update: answers the receipt only, carrying no record', async () => {
    const { deps, ql } = schemaLessHarness();
    await ql.insert('cred_holder', { title: 'one' });
    const res = await callData(
      deps, REQ, 'update',
      { object: 'cred_holder', id: 'r1', data: { login_password: 'caller-sent-password' } },
      ql, undefined, EC,
    );
    expect(res).toEqual({ object: 'cred_holder', id: 'r1' });
    expect(leaks(res)).toEqual([]);
  });
});

describe('declarative update action result applies the write-response rules', () => {
  const ACTION = { name: 'set_cred', operation: 'update', undoable: true, params: [{ name: 'login_password', type: 'text' }] };
  const run = async (opts: { schema: boolean; written?: unknown }) => {
    const ql: any = { registry: { getObject: (n: string) => (opts.schema && n === 'cred_holder' ? SCHEMA : undefined) } };
    const deps: ActionExecutionDeps = {
      resolveService: (async () => { throw new Error('metadata unavailable'); }) as any,
      getObjectQL: async () => ql,
    };
    return await executeDeclarativeUpdateAction(deps, ACTION, {
      objectName: 'cred_holder',
      actionName: 'set_cred',
      subject: { record: { id: 'r1', title: 'one', login_password: SECRET_MASK }, recordLoadDenied: false },
      recordId: 'r1',
      params: { login_password: 'caller-sent-password', hidden_hash: STORED_INTERNAL },
      ec: EC,
      driver: ql,
      requestContext: REQ,
      callData: async () => opts.written,
    });
  };

  it('redoData and the fallback record mask the patch; a masked redo value replays as unchanged', async () => {
    const res: any = await run({ schema: true, written: { object: 'cred_holder', id: 'r1' } });
    expect(leaks(res)).toEqual([]);
    expect(res.undo.redoData.login_password).toBe(SECRET_MASK);
    expect(Object.keys(res.undo.redoData)).not.toContain('hidden_hash');
    expect(res.record.login_password).toBe(SECRET_MASK);
    // The undo half is the prior READ, which was already masked.
    expect(res.undo.undoData.login_password).toBe(SECRET_MASK);
  });

  it('fails closed with no schema: no undo anchor and no echoed patch', async () => {
    const res: any = await run({ schema: false, written: { object: 'cred_holder', id: 'r1' } });
    expect(leaks(res)).toEqual([]);
    expect(res.undo).toBeUndefined();
    expect(res.record).toEqual({ id: 'r1' });
  });
});
