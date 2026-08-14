// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import { HttpDispatcher } from './http-dispatcher.js';
import { resolveExecutionContext } from './security/resolve-execution-context.js';
import { hashApiKey } from './security/api-key.js';

/**
 * Security-critical: the `POST /keys` mint path. We assert the show-once
 * contract, that only the hash is persisted, the principal is pinned (no
 * impersonation / forgery via the body), auth is fail-closed, and that a minted
 * key actually authenticates through the verify path (round-trip).
 */

function makeKernel() {
  const rows: any[] = [];
  const ql = {
    insert: async (_obj: string, data: any, _opts: any) => {
      const id = `key_${rows.length + 1}`;
      rows.push({ id, ...data });
      return { id };
    },
    // Minimal find for the round-trip via resolveExecutionContext.
    find: async (obj: string, opts: any) => {
      const where = opts?.where ?? {};
      if (obj !== 'sys_api_key') return [];
      return rows.filter((r) => Object.entries(where).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return r[k] === v; }));
    },
    update: async () => ({}),
    delete: async () => ({}),
  };
  const kernel: any = {
    getService: (n: string) => (n === 'objectql' ? ql : undefined),
    getServiceAsync: async (n: string) => (n === 'objectql' ? ql : undefined),
  };
  return { kernel, rows };
}

function ctx(overrides: any = {}) {
  return {
    request: { headers: {} },
    response: {},
    environmentId: undefined,
    executionContext: { userId: 'u1', isSystem: false, positions: [], permissions: [] },
    ...overrides,
  };
}

function dispatcher(kernel: any) {
  return new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
}

describe('HttpDispatcher.handleKeys (POST /keys — key generation)', () => {
  it('mints a key: 201, returns raw once, stores only the hash', async () => {
    const { kernel, rows } = makeKernel();
    const res = await dispatcher(kernel).handleKeys('POST', { name: 'CI token' }, ctx());

    expect(res.response.status).toBe(201);
    const data = res.response.body.data;
    expect(data.key).toMatch(/^osk_/);
    expect(data.prefix).toBe(data.key.slice(0, data.prefix.length));
    expect(data.name).toBe('CI token');

    // Exactly one row, storing the HASH not the raw key.
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe(hashApiKey(data.key));
    expect(rows[0].key).not.toBe(data.key);
    expect(rows[0].user_id).toBe('u1');
    expect(rows[0].revoked).toBe(false);
  });

  it('round-trip: the minted raw key authenticates via resolveExecutionContext', async () => {
    const { kernel } = makeKernel();
    const ql = await (kernel.getServiceAsync('objectql'));
    const res = await dispatcher(kernel).handleKeys('POST', { name: 'agent' }, ctx());
    const raw = res.response.body.data.key;

    const resolved = await resolveExecutionContext({
      getService: async () => undefined,
      getQl: async () => ql,
      request: { headers: { 'x-api-key': raw } },
    });
    expect(resolved.userId).toBe('u1');
  });

  it('rejects anonymous requests (401, no row created)', async () => {
    const { kernel, rows } = makeKernel();
    const res = await dispatcher(kernel).handleKeys('POST', { name: 'x' }, ctx({ executionContext: undefined }));
    expect(res.response.status).toBe(401);
    expect(rows).toHaveLength(0);
  });

  it('pins user_id to the caller — body cannot impersonate', async () => {
    const { kernel, rows } = makeKernel();
    await dispatcher(kernel).handleKeys('POST', { name: 'x', user_id: 'evil', userId: 'evil' }, ctx());
    expect(rows[0].user_id).toBe('u1');
  });

  it('ignores body-injected key/id/revoked — cannot forge a known secret', async () => {
    const { kernel, rows } = makeKernel();
    const res = await dispatcher(kernel).handleKeys(
      'POST',
      { name: 'x', key: 'attacker-known', id: 'fixed', revoked: false, prefix: 'evil_' },
      ctx(),
    );
    const data = res.response.body.data;
    // Stored key is the hash of the GENERATED raw, never the attacker's value.
    expect(rows[0].key).toBe(hashApiKey(data.key));
    expect(rows[0].key).not.toBe('attacker-known');
    expect(rows[0].key).not.toBe(hashApiKey('attacker-known'));
    expect(data.prefix).toMatch(/^osk_/);
  });

  it('rejects non-POST methods (405)', async () => {
    const { kernel } = makeKernel();
    const res = await dispatcher(kernel).handleKeys('GET', {}, ctx());
    expect(res.response.status).toBe(405);
  });

  it('defaults the name when omitted', async () => {
    const { kernel, rows } = makeKernel();
    await dispatcher(kernel).handleKeys('POST', {}, ctx());
    expect(rows[0].name).toBe('API Key');
  });

  it('accepts a valid future expires_at and stores it', async () => {
    const { kernel, rows } = makeKernel();
    const future = '2999-01-01T00:00:00.000Z';
    const res = await dispatcher(kernel).handleKeys('POST', { name: 'x', expires_at: future }, ctx());
    expect(res.response.status).toBe(201);
    expect(rows[0].expires_at).toBe(future);
  });

  it('rejects a past expires_at (400, no row)', async () => {
    const { kernel, rows } = makeKernel();
    const res = await dispatcher(kernel).handleKeys('POST', { name: 'x', expires_at: '2000-01-01T00:00:00Z' }, ctx());
    expect(res.response.status).toBe(400);
    expect(rows).toHaveLength(0);
  });

  it('rejects an unparseable expires_at (400, no row)', async () => {
    const { kernel, rows } = makeKernel();
    const res = await dispatcher(kernel).handleKeys('POST', { name: 'x', expires_at: 'not-a-date' }, ctx());
    expect(res.response.status).toBe(400);
    expect(rows).toHaveLength(0);
  });

  it('an expired minted key does NOT authenticate (end-to-end with verify path)', async () => {
    // Insert directly with a past expiry to confirm the verify path rejects it
    // (handleKeys refuses to mint past-dated keys, so we simulate a stale one).
    const { kernel } = makeKernel();
    const ql = await kernel.getServiceAsync('objectql');
    const raw = 'osk_stale_demo';
    await ql.insert('sys_api_key', {
      key: hashApiKey(raw),
      prefix: 'osk_stale_de',
      user_id: 'u1',
      revoked: false,
      expires_at: '2000-01-01T00:00:00Z',
    }, { context: { isSystem: true } });

    const resolved = await resolveExecutionContext({
      getService: async () => undefined,
      getQl: async () => ql,
      request: { headers: { 'x-api-key': raw } },
    });
    expect(resolved.userId).toBeUndefined();
  });
});
