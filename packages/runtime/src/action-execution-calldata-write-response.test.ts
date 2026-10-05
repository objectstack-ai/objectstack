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
import { callData, type ActionExecutionDeps } from './action-execution.js';
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
