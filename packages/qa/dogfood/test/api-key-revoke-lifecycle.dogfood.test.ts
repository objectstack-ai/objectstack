// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7727 — revoking an API key through the product route it actually declares.
 *
 * `sys_api_key` declares two row actions, `revoke_api_key` / `restore_api_key`,
 * as `method: 'PATCH'` against `/api/v1/data/sys_api_key/{id}` with
 * `bodyExtra: { revoked: true|false }`. The same object set
 * `enable.apiMethods = ['get', 'list']`, so that PATCH was refused at the
 * ADR-0049 method gate with a 405 before any authorization ran: the declared
 * action and the method gate cancelled out, and a leaked key could not be
 * revoked from any product surface — only by writing the row out-of-band.
 *
 * The fix is narrow in BOTH directions and this file pins both halves:
 *
 *  - the METHOD opens (`apiMethods` gains `update`, backed by the
 *    `userActions.edit` affordance ADR-0103's `reconcileManagedApiMethods`
 *    requires before it will let a `managedBy` object keep a write verb), so
 *    the declared PATCH reaches the pipeline instead of dying at the gate;
 *  - the COLUMNS do not. `sys_api_key` is `managedBy: 'better-auth'`, so
 *    ADR-0092 D2's identity write guard still fail-closed rejects
 *    user-context writes, and the only opening is its per-object update
 *    whitelist — which lists exactly `revoked`.
 *
 * That reconciler is worth naming because it is a SECOND silent gate of the
 * same shape as the bug: it rewrites `enable.apiMethods` at registration and
 * only warns, so an object can declare `update`, serve 405, and look correct
 * in its own source. The registered-schema assertion at the bottom of this
 * file is what keeps that from happening again.
 *
 * Why this file exists at all: nothing pinned the route before it. The
 * pre-existing tests (`http-dispatcher.keys.test.ts`,
 * `resolve-execution-context.test.ts`) exercise key RESOLUTION against a
 * pre-revoked row and never call the PATCH the action declares — which is
 * precisely how a declared affordance and a method gate came to cancel each
 * other out unnoticed. So the assertions below drive the real route and then
 * assert the CONSEQUENCE: a 200 that leaves the key still authenticating is
 * the defect wearing a success code, and would pass a status-only check.
 *
 * Refusal cases assert `code` AND `status` (ADR-0112): a bare
 * `rejects.toThrow()` / status-only assertion stays green against an
 * implementation that throws a naked `Error`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

describe('#7727: sys_api_key revoke/restore through the declared product route', () => {
  let stack: VerifyStack;
  let token: string;

  /** Mint a key through the ONE mint path; returns its id + raw secret. */
  const mintKey = async (name: string): Promise<{ id: string; raw: string }> => {
    const res = await stack.apiAs(token, 'POST', '/keys', { name });
    expect(res.status).toBe(201);
    const body: any = await res.json();
    expect(body?.data?.id).toBeTruthy();
    expect(body?.data?.key).toBeTruthy();
    return { id: String(body.data.id), raw: String(body.data.key) };
  };

  /**
   * Does this key still authenticate? Asked through a real authenticated
   * read, with NO bearer token — the key is the only credential present, so
   * a 200 means the key itself was accepted.
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

  it('revokes through PATCH /data/sys_api_key/{id} and the key stops authenticating', async () => {
    const { id, raw } = await mintKey('revoke-me');

    // Baseline: the freshly minted key authenticates. Without this the
    // post-revoke 401 would be unfalsifiable — a key that never worked also
    // "stops working".
    expect(await keyStillAuthenticates(raw)).toBe(true);

    // The exact request `revoke_api_key` declares.
    const revoked = await stack.apiAs(token, 'PATCH', `/data/sys_api_key/${id}`, { revoked: true });
    expect(revoked.status).toBe(200);

    // The consequence — a 200 that leaves the key working is the defect.
    expect(await keyStillAuthenticates(raw)).toBe(false);

    // And the row itself reads back revoked, so the 200 wasn't a no-op that
    // stripped the only field it was supposed to write.
    const row = await stack.apiAs(token, 'GET', `/data/sys_api_key/${id}`);
    expect(row.status).toBe(200);
    const rowBody: any = await row.json();
    expect(rowBody.record?.revoked ?? rowBody.data?.revoked).toBe(true);
  });

  it('restores through the same route and the key authenticates again', async () => {
    const { id, raw } = await mintKey('restore-me');

    const off = await stack.apiAs(token, 'PATCH', `/data/sys_api_key/${id}`, { revoked: true });
    expect(off.status).toBe(200);
    expect(await keyStillAuthenticates(raw)).toBe(false);

    // The exact request `restore_api_key` declares.
    const on = await stack.apiAs(token, 'PATCH', `/data/sys_api_key/${id}`, { revoked: false });
    expect(on.status).toBe(200);
    expect(await keyStillAuthenticates(raw)).toBe(true);
  });

  it('opens the column, not the table: a non-revoked PATCH is refused 403 PERMISSION_DENIED', async () => {
    // The negative direction matters as much as the positive one: if opening
    // `update` let a GENERAL update through, that is a worse defect than the
    // one being closed. `name` is an ordinary, otherwise-innocuous column —
    // it is refused because it is not on the ADR-0092 D2 whitelist, not
    // because it is dangerous.
    const { id, raw } = await mintKey('rename-me');

    const res = await stack.apiAs(token, 'PATCH', `/data/sys_api_key/${id}`, { name: 'renamed' });
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body.code).toBe('PERMISSION_DENIED');

    // Refused, not silently degraded into a timestamp touch.
    const row = await stack.apiAs(token, 'GET', `/data/sys_api_key/${id}`);
    const rowBody: any = await row.json();
    expect(rowBody.record?.name ?? rowBody.data?.name).toBe('rename-me');

    // The key is untouched by a refused write.
    expect(await keyStillAuthenticates(raw)).toBe(true);
  });

  it('refuses the credential columns even when smuggled alongside a legal `revoked`', async () => {
    // The whitelist STRIPS non-listed keys rather than rejecting the whole
    // payload, so a mixed patch is the shape that decides whether the
    // opening is column-scoped in practice: `revoked` must land and `key` /
    // `user_id` must not ride along with it. A rotated `key` would mint a
    // credential nobody holds; a rewritten `user_id` is privilege transfer.
    const { id, raw } = await mintKey('smuggle-me');
    const before = await stack.apiAs(token, 'GET', `/data/sys_api_key/${id}`);
    const beforeBody: any = await before.json();
    const originalOwner = beforeBody.record?.user_id ?? beforeBody.data?.user_id;
    expect(originalOwner).toBeTruthy();

    const res = await stack.apiAs(token, 'PATCH', `/data/sys_api_key/${id}`, {
      revoked: true,
      key: 'forged-hash-value',
      user_id: 'usr_someone_else',
    });
    // The whitelisted field survives, so the write succeeds…
    expect(res.status).toBe(200);

    // …but only that field was applied.
    const after = await stack.apiAs(token, 'GET', `/data/sys_api_key/${id}`);
    const afterBody: any = await after.json();
    expect(afterBody.record?.user_id ?? afterBody.data?.user_id).toBe(originalOwner);
    expect(afterBody.record?.revoked ?? afterBody.data?.revoked).toBe(true);

    // The decisive proof that `key` was stripped: the ORIGINAL secret is what
    // the row still hashes to. Had the forged value landed, this key would be
    // unrecognised rather than recognised-and-revoked — both answer 401, so
    // assert it from the other side by restoring and re-authenticating.
    const restored = await stack.apiAs(token, 'PATCH', `/data/sys_api_key/${id}`, { revoked: false });
    expect(restored.status).toBe(200);
    expect(await keyStillAuthenticates(raw)).toBe(true);
  });

  it('still refuses create and delete on the identity table (405, method gate)', async () => {
    // `update` was opened; `create` / `delete` were not. Minting stays on
    // `POST /api/v1/keys` (the only path that returns the raw secret once)
    // and rows are retired by revoking, not deleting.
    const { id } = await mintKey('immortal');

    const created = await stack.apiAs(token, 'POST', '/data/sys_api_key', { name: 'forged' });
    expect(created.status).toBe(405);
    const createdBody: any = await created.json();
    expect(createdBody.code).toBe('OBJECT_API_METHOD_NOT_ALLOWED');

    const deleted = await stack.apiAs(token, 'DELETE', `/data/sys_api_key/${id}`);
    expect(deleted.status).toBe(405);
    const deletedBody: any = await deleted.json();
    expect(deletedBody.code).toBe('OBJECT_API_METHOD_NOT_ALLOWED');
  });

  it('the declared row actions still match the route this file drives', async () => {
    // The original defect was a DECLARATION disagreeing with the runtime, so
    // pin the declaration too — read from the REGISTERED schema, i.e. what the
    // runtime actually serves. If someone re-points these actions at another
    // verb or path, every assertion above would keep passing while the button
    // in the UI went dead again, which is exactly how #7727 stayed invisible.
    const engine = await stack.kernel.getServiceAsync<any>('objectql');
    const schema = engine?.getSchema?.('sys_api_key');
    expect(schema, 'sys_api_key schema must be registered').toBeTruthy();

    // The REGISTERED apiMethods, i.e. post-`reconcileManagedApiMethods`. The
    // object's own source saying `update` is not enough — the reconciler
    // strips a write verb whose affordance is missing and only warns, which
    // is how `update` can be declared and 405 anyway.
    expect(schema.enable?.apiMethods).toContain('update');
    expect(schema.userActions?.edit).toBe(true);
    // The opening is `update` only — `create` / `delete` must stay stripped.
    expect(schema.enable?.apiMethods).not.toContain('create');
    expect(schema.enable?.apiMethods).not.toContain('delete');

    const actions = schema.actions as any[] | undefined;
    expect(actions, 'sys_api_key must keep its row actions').toBeTruthy();

    for (const expected of [
      { name: 'revoke_api_key', revoked: true },
      { name: 'restore_api_key', revoked: false },
    ]) {
      const declared = actions!.find((a) => a?.name === expected.name);
      expect(declared, `${expected.name} must stay declared`).toBeTruthy();
      expect(declared.method).toBe('PATCH');
      expect(declared.target).toBe('/api/v1/data/sys_api_key/{id}');
      expect(declared.bodyExtra).toEqual({ revoked: expected.revoked });
    }
  });
});
