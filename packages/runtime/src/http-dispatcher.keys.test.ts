// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';

import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';

import { HttpDispatcher, type HttpDispatcherResult } from './http-dispatcher.js';
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
      // The session caller every key here is minted for exists: an API key
      // authenticates only as an owner who exists.
      if (obj === 'sys_user') return where.id === 'u1' ? [{ id: 'u1' }] : [];
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
    // A signed-in caller: the credential the dispatcher's identity step records.
    admission: { credential: 'session' as const, authGate: undefined },
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

  // [#32281] A body naming another user, or a known secret, used to be
  // answered 201 with the key minted for the caller and the extra keys dropped
  // silently. Both are now refused before anything is written; the full
  // unknown-key contract is the `unknown body keys` suite at the end.
  it('refuses a body naming another user — no key is minted for anyone', async () => {
    const { kernel, rows } = makeKernel();
    const res = responseOf(await dispatcher(kernel).handleKeys('POST', { name: 'x', user_id: 'evil', userId: 'evil' }, ctx()));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(rows).toHaveLength(0);
  });

  it('refuses body-injected key/id/revoked/prefix — cannot forge a known secret', async () => {
    const { kernel, rows } = makeKernel();
    const res = responseOf(await dispatcher(kernel).handleKeys(
      'POST',
      { name: 'x', key: 'attacker-known', id: 'fixed', revoked: false, prefix: 'evil_' },
      ctx(),
    ));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.fields.map((f: any) => f.field)).toEqual(['key', 'id', 'revoked', 'prefix']);
    expect(rows).toHaveLength(0);
    expect(JSON.stringify(res.body)).not.toMatch(/osk_/);
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

    // [#23367] An expired key is a real key its own lifecycle refuses: the
    // shared resolver raises the branded refusal (403 API_KEY_EXPIRED, naming
    // the date) instead of answering an anonymous context, and whoever catches
    // the resolution decides how loud it is.
    await expect(resolveExecutionContext({
      getService: async () => undefined,
      getQl: async () => ql,
      request: { headers: { 'x-api-key': raw } },
    })).rejects.toMatchObject({ code: 'API_KEY_EXPIRED', status: 403 });
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
    // REFUSES combinators rather than answering them wrong, exactly as the
    // `makeKernel` matcher above does (`check:where-matcher-conformance`,
    // #8494). Without the throw, `Object.entries` reads `$or`/`$and` as an
    // ordinary FIELD NAME, compares `row.$or` (undefined) against the array,
    // matches nothing, and hands the suite an empty result set with nothing
    // erroring — a test that passes while asserting on a query the double
    // never ran. Refusal is the cheap correct answer for a double that only
    // ever sees scalar equality: it cannot go green on the wrong query.
    find: async (obj: string, opts: any) => {
      const where = opts?.where ?? {};
      const table = obj === 'sys_api_key' ? rows : obj === 'sys_member' ? members : [];
      return table.filter((r: any) => Object.entries(where).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        return r[k] === v;
      }));
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
  admission: { credential: 'session' as const, authGate: undefined },
});

/**
 * `HttpDispatcherResult.response` is OPTIONAL, so every read of it is a
 * `possibly undefined` in a type-checked program — and this package's test
 * layer IS type-checked, by `check:type-check-debt --re-measure` against a
 * shrink-only ledger, even though `pnpm test` never sees it.
 *
 * Narrow once, and narrow LOUDLY. `expect(res.response).toBeDefined()` would
 * satisfy a reader and narrow nothing (vitest's matchers are not assertion
 * signatures), and a `!` would silence the compiler while leaving the failure
 * to surface as `undefined is not an object` three lines later. A dispatcher
 * that answered no response at all is a different defect from one that
 * answered the wrong status; this keeps them distinguishable.
 *
 * Scoped to the #8287 suite below on purpose: the older suite's reads are the
 * file's share of the frozen TEST_DEBT number, and pressing that number down is
 * a separate improvement to bank, not a rider on this repair.
 */
function responseOf(res: HttpDispatcherResult): NonNullable<HttpDispatcherResult['response']> {
  const { response } = res;
  if (!response) throw new Error('handleKeys answered no response at all');
  return response;
}

describe('HttpDispatcher.handleKeys — organization inheritance (#8287)', () => {
  it('stamps the minter’s active organization on the row and echoes it once', async () => {
    const { kernel, rows } = makeOrgKernel([{ user_id: 'u1', organization_id: 'org_a', role: 'owner' }], 'isolated');
    const res = responseOf(await dispatcher(kernel).handleKeys('POST', { name: 'agent' }, orgCtx('org_a')));

    expect(res.status).toBe(201);
    expect(rows[0].active_organization_id).toBe('org_a');
    expect(res.body.data.active_organization_id).toBe('org_a');
  });

  /**
   * ⛔ No org parameter, no cross-org keys in v1. The organization is
   * INHERITED, so minting can never be a lateral-movement step. [#32281] A body
   * that names an organization used to be answered 201 with the key pinned to
   * the active organization and the body's value dropped; it is now refused,
   * naming each key, and nothing is minted in either organization.
   */
  it('refuses an organization supplied in the body (inherited, never parameterized)', async () => {
    const { kernel, rows } = makeOrgKernel([{ user_id: 'u1', organization_id: 'org_a', role: 'owner' }], 'isolated');
    const res = responseOf(await dispatcher(kernel).handleKeys(
      'POST',
      { name: 'agent', organization_id: 'org_evil', active_organization_id: 'org_evil', organizationId: 'org_evil' },
      orgCtx('org_a'),
    ));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.fields.map((f: any) => f.field))
      .toEqual(['organization_id', 'active_organization_id', 'organizationId']);
    expect(rows).toHaveLength(0);
  });

  it('still pins the key to the active organization when the body names none', async () => {
    const { kernel, rows } = makeOrgKernel([{ user_id: 'u1', organization_id: 'org_a', role: 'owner' }], 'isolated');
    const res = responseOf(await dispatcher(kernel).handleKeys('POST', { name: 'agent' }, orgCtx('org_a')));
    expect(res.status).toBe(201);
    expect(rows[0].active_organization_id).toBe('org_a');
  });

  it('refuses when the caller is not a member of their own active organization', async () => {
    const { kernel, rows } = makeOrgKernel([{ user_id: 'u1', organization_id: 'org_other', role: 'owner' }], 'isolated');
    const res = responseOf(await dispatcher(kernel).handleKeys('POST', { name: 'agent' }, orgCtx('org_a')));

    expect(res.status).toBe(403);
    // Nothing was minted — a refused mint must not leave a credential behind.
    expect(rows).toHaveLength(0);
  });

  it('refuses when the membership row exists but its ADR-0091 window has lapsed', async () => {
    const { kernel, rows } = makeOrgKernel([
      { user_id: 'u1', organization_id: 'org_a', role: 'owner', valid_until: '2000-01-01T00:00:00Z' },
    ], 'isolated');
    const res = responseOf(await dispatcher(kernel).handleKeys('POST', { name: 'agent' }, orgCtx('org_a')));

    expect(res.status).toBe(403);
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
    const res = responseOf(await dispatcher(kernel).handleKeys('POST', { name: 'agent' }, orgCtx(undefined)));

    expect(res.status).toBe(400);
    expect(rows).toHaveLength(0);
  });

  it('still mints an org-less key under `single` — there is no organization to inherit', async () => {
    const { kernel, rows } = makeOrgKernel([], 'single');
    const res = responseOf(await dispatcher(kernel).handleKeys('POST', { name: 'agent' }, orgCtx(undefined)));

    expect(res.status).toBe(201);
    expect(rows).toHaveLength(1);
    expect(rows[0].active_organization_id).toBeUndefined();
    expect(res.body.data.active_organization_id).toBeUndefined();
  });
});

/**
 * [#12981] The mint path's `ql.insert` catch is SILENT, and that is the correct
 * shape -- every path out of it hands the failure to the caller. The swallow-
 * family census (`scripts/measure-durability-swallow-family.mjs`) reports the
 * site as tier-1 DARK because it decides membership on three mechanical
 * conjuncts and leaves "and the caller still reports success" to a person; the
 * answer here is no, which is what puts the site OUT of the repair programme
 * under AGENTS.md's third legal answer ("a failure handed to the CALLER is not
 * a degradation at all").
 *
 * These pins exist because that ruling is otherwise a JUDGEMENT with nothing
 * holding it up. The census will keep listing this site as DARK until the
 * programme's last step, so the next reader arrives at a file the worklist
 * accuses and a comment that says "not guilty". What makes the difference
 * measurable is that the delivery is pinned: turn this catch into a real
 * swallow and these go red, which is precisely the transition -- from
 * delivering to silent-success -- that the census cannot see and this card
 * exists to prevent.
 */
describe('HttpDispatcher.handleKeys — a refused insert is DELIVERED, never swallowed (#12981)', () => {
  /** The mint path with a storage layer that refuses every write. */
  function kernelRefusingInsert(driverMessage: string) {
    const { kernel, rows } = makeKernel();
    const ql = kernel.getService('objectql');
    ql.insert = async () => { throw new Error(driverMessage); };
    return { kernel, rows };
  }

  it('answers the ADR-0112 error envelope (500 / INTERNAL_ERROR) rather than reporting success', async () => {
    const { kernel, rows } = kernelRefusingInsert('connection refused');
    const res = responseOf(await dispatcher(kernel).handleKeys('POST', { name: 'CI token' }, ctx()));

    // The whole point: the requester was TOLD. Nothing here looks normal from
    // the outside, so there is no durability degradation to escalate.
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(res.body.error.httpStatus).toBe(500);
    expect(rows).toHaveLength(0);
  });

  it('returns no key material — a caller never holds a credential that was never stored', async () => {
    const { kernel } = kernelRefusingInsert('connection refused');
    const res = responseOf(await dispatcher(kernel).handleKeys('POST', { name: 'CI token' }, ctx()));

    // A 201 carrying `data.key` after a refused insert would be the exact
    // "claims to persist, did not persist" shape #12981 is about.
    expect(res.body.data).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/osk_/);
  });

  it('does not echo the driver error — row contents cannot leak through the envelope', async () => {
    // The reason this catch discards the caught value at all, stated at the
    // site: a driver error can quote the offending row.
    const { kernel } = kernelRefusingInsert(
      'duplicate key value violates unique constraint, row: sentinel-row-content',
    );
    const res = responseOf(await dispatcher(kernel).handleKeys('POST', { name: 'CI token' }, ctx()));

    expect(JSON.stringify(res.body)).not.toMatch(/sentinel-row-content/);
    expect(res.body.error.message).not.toMatch(/duplicate key/);
  });
});

// ── [#32281] Unknown body keys are refused, never dropped ──────────────────

/**
 * `POST /keys` reads `name` and `expires_at` and nothing else. Any other key is
 * answered `400 VALIDATION_FAILED` with a `fields[]` entry per key, BEFORE any
 * service is resolved or any row is read or written — the shape the data door
 * and the `_activation` doors answer an undeclared key with. A caller who
 * asked for a key for another user, or with scopes, is told it did not get one.
 */
describe('HttpDispatcher.handleKeys — unknown body keys (#32281)', () => {
  /** A kernel that records every service lookup, so "before any read" is observable. */
  function countingKernel() {
    const { kernel, rows } = makeKernel();
    const looked: string[] = [];
    const counted: any = {
      getService: (n: string) => { looked.push(n); return kernel.getService(n); },
      getServiceAsync: async (n: string) => { looked.push(n); return kernel.getServiceAsync(n); },
    };
    return { kernel: counted, rows, looked };
  }

  it('refuses one unknown key with 400 VALIDATION_FAILED naming it, before any service is resolved', async () => {
    const { kernel, rows, looked } = countingKernel();
    const d = dispatcher(kernel);
    looked.length = 0;
    const res = responseOf(await d.handleKeys('POST', { name: 'ci', userId: 'u2' }, ctx()));

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.fields).toEqual([
      expect.objectContaining({ field: 'userId', code: 'unknown_field' }),
    ]);
    expect(res.body.error.message).toMatch(/^Unknown key `userId` in the API key request/);
    expect(rows).toHaveLength(0);
    expect(looked).toEqual([]);
  });

  it('names every unknown key together, in body order', async () => {
    const { kernel, rows } = makeKernel();
    const res = responseOf(await dispatcher(kernel).handleKeys(
      'POST', { scopes: ['admin'], name: 'ci', user_id: 'u2', nmae: 'typo' }, ctx()));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.fields.map((f: any) => f.field)).toEqual(['scopes', 'user_id', 'nmae']);
    expect(res.body.error.details.fields.every((f: any) => f.code === 'unknown_field')).toBe(true);
    expect(rows).toHaveLength(0);
  });

  it('a userId for another user mints no key at all: the caller\'s row count is unchanged', async () => {
    const { kernel, rows } = makeKernel();
    const d = dispatcher(kernel);
    responseOf(await d.handleKeys('POST', { name: 'mine' }, ctx()));
    expect(rows).toHaveLength(1);

    const res = responseOf(await d.handleKeys('POST', { name: 'theirs', userId: 'u2' }, ctx()));
    expect(res.status).toBe(400);
    expect(rows).toHaveLength(1);
    expect(rows.some((r) => r.user_id === 'u2')).toBe(false);
    expect(rows.some((r) => r.name === 'theirs')).toBe(false);
  });

  it('refuses a body that is not an object, naming (body)', async () => {
    const { kernel, rows } = makeKernel();
    for (const body of [['name'], 'ci', 42]) {
      const res = responseOf(await dispatcher(kernel).handleKeys('POST', body, ctx()));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details.fields).toEqual([expect.objectContaining({ field: '(body)', code: 'invalid_type' })]);
    }
    expect(rows).toHaveLength(0);
  });

  it('CONTROL: { name } and { name, expires_at } still mint 201, and an absent body still mints the default name', async () => {
    const { kernel, rows } = makeKernel();
    const d = dispatcher(kernel);
    const named = responseOf(await d.handleKeys('POST', { name: 'ci' }, ctx()));
    expect(named.status).toBe(201);
    const future = '2999-01-01T00:00:00.000Z';
    const dated = responseOf(await d.handleKeys('POST', { name: 'ci-dated', expires_at: future }, ctx()));
    expect(dated.status).toBe(201);
    expect(dated.body.data.expires_at).toBe(future);
    const bare = responseOf(await d.handleKeys('POST', undefined, ctx()));
    expect(bare.status).toBe(201);
    expect(rows.map((r) => r.name)).toEqual(['ci', 'ci-dated', 'API Key']);
  });
});
