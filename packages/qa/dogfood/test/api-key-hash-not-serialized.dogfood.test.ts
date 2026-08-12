// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7728 — `sys_api_key.key` (the stored SHA-256 hash) must not come back on the
 * generic read path, because its own declaration says it never does:
 *
 *   description: 'Hashed API key value — never exposed to clients'
 *
 * On `origin/main` that sentence was false. The engine's read path masks only
 * `secret`- and `password`-TYPED columns (`collectMaskedReadFields`), and `key`
 * is `text`, so nothing collected it and the hash serialized on get-by-id and
 * list. `hidden: true` is not the contract that was broken — spec defines it as
 * "Hidden from default UI", not "stripped from serialization" — the broken
 * contract is the field's own description. The fix is the new `internal: true`
 * field flag, honoured at the same post-hook choke point as the credential mask.
 *
 * **This file has to drive BOTH directions**, and the negative one is the
 * load-bearing half. A change that strips the column everywhere would satisfy
 * every "absent" assertion below and still break the product:
 *
 *  - the verifier resolves a principal with `where: { key: hashApiKey(raw) }`,
 *    so authentication must keep working (`keyStillAuthenticates`);
 *  - `POST /api/v1/keys` returns the raw secret ONCE at mint, and that is the
 *    only time a client ever sees the credential.
 *
 * The third pin is `?select=`. #7823 measured the sibling column coming back by
 * EXPLICIT projection as well as on the default one, so a strip that only
 * touched the default projection would ship looking complete and still leak to
 * any client that spells the column out. `select` gates on whether a field is
 * KNOWN, and `key` is known — so the explicit-projection case is its own test.
 *
 * Falsifiability: `prefix` / `name` are asserted PRESENT throughout. Without
 * them a "delete every column" bug reads as a pass.
 *
 * Refusal/absence cases assert `code` AND `status` where a refusal is involved
 * (ADR-0112); a bare status check stays green against a naked `Error`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

describe('#7728: sys_api_key.key (hash) never serializes on the generic read path', () => {
  let stack: VerifyStack;
  let token: string;

  /** Mint through the ONE mint path; returns the row id + the show-once secret. */
  const mintKey = async (name: string): Promise<{ id: string; raw: string }> => {
    const res = await stack.apiAs(token, 'POST', '/keys', { name });
    expect(res.status).toBe(201);
    const body: any = await res.json();
    expect(body?.data?.id).toBeTruthy();
    // The show-once mint path is NOT the generic read path and must keep
    // returning the credential — this is the negative direction, asserted at
    // the moment it would break.
    expect(typeof body?.data?.key).toBe('string');
    expect(body.data.key.length).toBeGreaterThan(8);
    return { id: String(body.data.id), raw: String(body.data.key) };
  };

  /**
   * Does this key still authenticate? Asked through a real authenticated read
   * with NO bearer token, so the key is the only credential present.
   */
  const keyStillAuthenticates = async (raw: string): Promise<boolean> => {
    const res = await stack.api('/data/sys_api_key', { headers: { 'x-api-key': raw } });
    if (res.status === 200) return true;
    expect(res.status).toBe(401);
    return false;
  };

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, {});
    token = await stack.signIn();
  }, 120_000);

  afterAll(async () => { await stack?.stop?.(); });

  it('get-by-id omits `key` on the default projection, and keeps the other columns', async () => {
    const { id, raw } = await mintKey('hash-getbyid');

    const res = await stack.apiAs(token, 'GET', `/data/sys_api_key/${id}`);
    expect(res.status).toBe(200);
    const record = ((await res.json()) as any).record ?? {};

    // OMIT, not mask (maintainer ruling 2026-08-12 (b)): `key` is
    // `required: true`, so a "a value is set" mask carries zero bits here while
    // still shipping a value under a field whose description promises none.
    // `toBeUndefined()` alone would pass on a masked value of `undefined`; the
    // key must be absent from the object.
    expect(Object.keys(record)).not.toContain('key');

    // Falsifiability: the read still works and still carries its other columns.
    expect(record.id).toBe(id);
    expect(record.name).toBe('hash-getbyid');
    expect(record.prefix).toBeTruthy();

    // Negative direction: stripping a column from a RESPONSE must not disturb
    // the stored row or the verifier's `where: { key: <hash> }` lookup.
    expect(await keyStillAuthenticates(raw)).toBe(true);
  });

  it('list omits `key` on every row', async () => {
    const { raw } = await mintKey('hash-list');

    const res = await stack.apiAs(token, 'GET', '/data/sys_api_key');
    expect(res.status).toBe(200);
    const rows = ((await res.json()) as any).records ?? [];
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) expect(Object.keys(row)).not.toContain('key');
    // …and the rows are real rows, not empty objects.
    expect(rows.every((r: any) => typeof r.id === 'string')).toBe(true);

    expect(await keyStillAuthenticates(raw)).toBe(true);
  });

  it('an EXPLICIT `?select=id,key` projection does not bypass the strip', async () => {
    // The bypass #7823 measured on the sibling column. `select` only gates on
    // whether a field is KNOWN (`assertProjectionFieldsExist`) and `key` is
    // known, so naming it is a legal request that must come back WITHOUT it —
    // stripped, not refused, so a client asking for a legal-but-omitted column
    // still gets its other columns.
    const { id, raw } = await mintKey('hash-select');

    const byId = await stack.apiAs(token, 'GET', `/data/sys_api_key/${id}?select=id,key`);
    expect(byId.status).toBe(200);
    const record = ((await byId.json()) as any).record ?? {};
    expect(Object.keys(record)).not.toContain('key');
    expect(record.id).toBe(id);

    const list = await stack.apiAs(token, 'GET', '/data/sys_api_key?select=id,key,prefix');
    expect(list.status).toBe(200);
    const rows = ((await list.json()) as any).records ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(Object.keys(row)).not.toContain('key');
    // The projection is otherwise honoured — proves the request was served,
    // not silently downgraded to something that never contained `key` anyway.
    expect(rows.every((r: any) => typeof r.prefix === 'string')).toBe(true);

    expect(await keyStillAuthenticates(raw)).toBe(true);
  });

  it('the revoke lifecycle still works, and its PATCH response carries no `key` either', async () => {
    // `sys_api_key` is one of the few identity objects with a write verb open
    // (`apiMethods: ['get','list','update']`, #7727), so PATCH is a response
    // surface a real client hits on this exact object. Read it explicitly
    // rather than assuming the read-path strip covers it.
    const { id, raw } = await mintKey('hash-patch');
    expect(await keyStillAuthenticates(raw)).toBe(true);

    const patched = await stack.apiAs(token, 'PATCH', `/data/sys_api_key/${id}`, { revoked: true });
    expect(patched.status).toBe(200);
    const body: any = await patched.json();
    const echoed = body?.record ?? body?.data ?? {};
    if (echoed && typeof echoed === 'object') {
      expect(Object.keys(echoed)).not.toContain('key');
    }

    // The write itself still lands — the strip did not turn a real update into
    // a no-op.
    expect(await keyStillAuthenticates(raw)).toBe(false);
  });

  it('the declaration that makes all of the above required is still on the registered schema', async () => {
    // The original defect was a DECLARATION disagreeing with the runtime, so
    // pin the declaration from the REGISTERED schema — what the runtime serves,
    // not what the source file says. If `internal` is dropped from `key`, every
    // assertion above breaks anyway, but this one says WHY in one line.
    const engine = await stack.kernel.getServiceAsync<any>('objectql');
    const schema = engine?.getSchema?.('sys_api_key');
    expect(schema, 'sys_api_key schema must be registered').toBeTruthy();

    const key = schema.fields?.key;
    expect(key, 'sys_api_key.key must stay declared').toBeTruthy();
    expect(key.internal).toBe(true);
    // The description this card exists to make true — unchanged by the fix
    // (omit was ruled over mask partly to avoid churning the four generated
    // translation bundles that mirror this string).
    expect(String(key.description)).toContain('never exposed to clients');
    // Still a plain `text` column: the fix does NOT retype it, because
    // `secret` would encrypt at rest and destroy the verifier's hash lookup.
    expect(key.type).toBe('text');
  });
});
