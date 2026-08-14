// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';

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

// ── [#8287] The key inherits the minter's active organization ──────────────

/**
 * Kernel whose ObjectQL also serves `sys_member`, so the mint-time membership
 * check has something real to read.
 */
function makeOrgKernel(members: any[], posture?: string) {
  const rows: any[] = [];
  const ql = {
    insert: async (_obj: string, data: any) => {
      const id = `key_${rows.length + 1}`;
      rows.push({ id, ...data });
      return { id };
    },
    find: async (obj: string, opts: any) => {
      const where = opts?.where ?? {};
      const table = obj === 'sys_api_key' ? rows : obj === 'sys_member' ? members : [];
      return table.filter((r: any) => Object.entries(where).every(([k, v]) => r[k] === v));
    },
    // The write verbs route through `ObjectQL`'s OWN dispatch predicates rather
    // than a hand-written approximation of them (`check:engine-double-contract`,
    // #4434/#5480). A double that imports the producer's decision cannot be
    // looser than the producer — which is what keeps a green suite from meaning
    // nothing on the day one of these stops being dormant. Only this second
    // double is pinned; the file's pre-existing `makeKernel` double is the
    // shrink-only baseline's measured DEBT entry and is left exactly as it was.
    update: async (_obj: string, data: any, options?: any) => {
      assertEngineUpdateDispatch(data, options);
      return {};
    },
    delete: async (_obj: string, options?: any) => {
      assertEngineDeleteDispatch(options);
      return {};
    },
  };
  // [#8287] The mint path resolves the EFFECTIVE posture from the kernel's
  // `tenancy` service (ADR-0093 D4/D5), never from OS_TENANCY_POSTURE — a
  // requested-but-unenforceable wall resolves to `single` there, and minting
  // must follow what is ENFORCED.
  const tenancy = posture ? { posture } : undefined;
  const kernel: any = {
    getService: (n: string) => (n === 'objectql' ? ql : n === 'tenancy' ? tenancy : undefined),
    getServiceAsync: async (n: string) => (n === 'objectql' ? ql : n === 'tenancy' ? tenancy : undefined),
  };
  return { kernel, rows };
}

const orgCtx = (tenantId?: string) => ({
  request: { headers: {} },
  response: {},
  environmentId: undefined,
  executionContext: { userId: 'u1', isSystem: false, positions: [], permissions: [], tenantId },
});

describe('HttpDispatcher.handleKeys — organization inheritance (#8287)', () => {
  it('stamps the minter’s active organization on the row and echoes it once', async () => {
    const { kernel, rows } = makeOrgKernel([{ user_id: 'u1', organization_id: 'org_a', role: 'owner' }], 'isolated');
    const res = await dispatcher(kernel).handleKeys('POST', { name: 'agent' }, orgCtx('org_a'));

    expect(res.response.status).toBe(201);
    expect(rows[0].active_organization_id).toBe('org_a');
    expect(res.response.body.data.active_organization_id).toBe('org_a');
  });

  /**
   * ⛔ No org parameter, no cross-org keys in v1. The organization is
   * INHERITED — a body that names another organization is ignored exactly the
   * way a body naming another `user_id` already is, so minting can never be a
   * lateral-movement step.
   */
  it('ignores an organization supplied in the body (inherited, never parameterized)', async () => {
    const { kernel, rows } = makeOrgKernel([{ user_id: 'u1', organization_id: 'org_a', role: 'owner' }], 'isolated');
    const res = await dispatcher(kernel).handleKeys(
      'POST',
      { name: 'agent', organization_id: 'org_evil', active_organization_id: 'org_evil', organizationId: 'org_evil' },
      orgCtx('org_a'),
    );

    expect(res.response.status).toBe(201);
    expect(rows[0].active_organization_id).toBe('org_a');
  });

  it('refuses when the caller is not a member of their own active organization', async () => {
    const { kernel, rows } = makeOrgKernel([{ user_id: 'u1', organization_id: 'org_other', role: 'owner' }], 'isolated');
    const res = await dispatcher(kernel).handleKeys('POST', { name: 'agent' }, orgCtx('org_a'));

    expect(res.response.status).toBe(403);
    // Nothing was minted — a refused mint must not leave a credential behind.
    expect(rows).toHaveLength(0);
  });

  it('refuses when the membership row exists but its ADR-0091 window has lapsed', async () => {
    const { kernel, rows } = makeOrgKernel([
      { user_id: 'u1', organization_id: 'org_a', role: 'owner', valid_until: '2000-01-01T00:00:00Z' },
    ], 'isolated');
    const res = await dispatcher(kernel).handleKeys('POST', { name: 'agent' }, orgCtx('org_a'));

    expect(res.response.status).toBe(403);
    expect(rows).toHaveLength(0);
  });

  /**
   * The card's own defect, caught one step earlier: under a walled posture a
   * key with no organization reads nothing, so handing back a valid-looking
   * secret is the dishonest half. Refuse at mint time, where the caller is a
   * human at a console who can act on it.
   */
  it('refuses to mint an org-less key under a walled posture', async () => {
    const { kernel, rows } = makeOrgKernel([], 'isolated');
    const res = await dispatcher(kernel).handleKeys('POST', { name: 'agent' }, orgCtx(undefined));

    expect(res.response.status).toBe(400);
    expect(rows).toHaveLength(0);
  });

  it('still mints an org-less key under `single` — there is no organization to inherit', async () => {
    const { kernel, rows } = makeOrgKernel([], 'single');
    const res = await dispatcher(kernel).handleKeys('POST', { name: 'agent' }, orgCtx(undefined));

    expect(res.response.status).toBe(201);
    expect(rows).toHaveLength(1);
    expect(rows[0].active_organization_id).toBeUndefined();
    expect(res.response.body.data.active_organization_id).toBeUndefined();
  });
});
