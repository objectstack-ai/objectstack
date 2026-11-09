// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An API key authenticates only as an owner who exists, at every door that
 * accepts a key (maintainer ruling 2026-11-05, option B).
 *
 * A key is a credential of the user who minted it (ADR-0090). When that user's
 * row is gone, the key is a credential of no one: every door answers it
 * exactly as a key that does not exist — the same status, error code, message
 * and `WWW-Authenticate` — on the REST data door (read and write), on the
 * key-management write door (`PATCH /api/v1/data/sys_api_key/{id}`, the revoke
 * and restore road) and on the MCP door. A session sent beside it never
 * answers for it. The rule lives where a key becomes its owner (the shared
 * key-admission seam in `@objectstack/core`), on the owner read the ban
 * already takes.
 *
 * The fixture removes the owner's row at the store, beneath the engine, and
 * leaves the key row in place.
 *
 * Controls, which keep today's answer:
 *  - before the owner's row is removed, the key reads (200), writes (201),
 *    opens an MCP session (200), and its write to its own key row is refused
 *    as every key-authenticated key change is (`403 PERMISSION_DENIED`);
 *  - another member's key keeps working throughout;
 *  - once the owner's row is back, the same key is served again: the refusal
 *    wrote nothing to the key row.
 *
 * Refusal cases assert status AND code AND message (ADR-0112) against a
 * made-up key's answer on the same door, and every write case reads the store
 * afterwards: a refusal that still wrote is the defect wearing a refusal.
 */

import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { MCPServerPlugin } from '@objectstack/mcp';
import { bootShowcase } from './showcase-boot.js';
import { showcaseAppDefaultSecurity } from './showcase-security.js';

const OBJECT = 'showcase_private_note';
const SYS = { context: { isSystem: true } };
const PASSWORD = 'Member-Pass-123';

/** One door's answer, reduced to what a caller can tell apart. */
interface DoorAnswer {
  status: number;
  code: unknown;
  message: unknown;
  wwwAuthenticate: string | null;
}

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.value) ? r.value : []);

describe('an API key authenticates only as an owner who exists, at every door', () => {
  let stack: VerifyStack;
  let adminToken: string;
  let ql: any;

  const OWNER_EMAIL = 'apikey.owner.exists@verify.test';
  const PEER_EMAIL = 'apikey.owner.exists.peer@verify.test';
  let ownerId: string;
  let ownerKey: { id: string; raw: string };
  let peerKey: { id: string; raw: string };
  /** The owner's row as stored, kept to put back for the closing control. */
  let ownerRow: Record<string, unknown> | undefined;
  /** A well-formed key no row holds — the answer every refusal is compared to. */
  const madeUpKey = `osk_${randomBytes(32).toString('base64url')}`;

  const mintKey = async (token: string, name: string): Promise<{ id: string; raw: string }> => {
    const res = await stack.apiAs(token, 'POST', '/keys', { name });
    expect(res.status, await res.clone().text()).toBe(201);
    const body: any = await res.json();
    expect(body?.data?.key).toBeTruthy();
    return { id: String(body.data.id), raw: String(body.data.key) };
  };

  const answerOf = async (res: Response): Promise<DoorAnswer> => {
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = undefined; }
    return {
      status: res.status,
      code: body?.error?.code ?? body?.code,
      message: body?.error?.message ?? body?.message,
      wwwAuthenticate: res.headers.get('www-authenticate'),
    };
  };

  /** Each door, authenticated by the key alone (no cookie, no bearer session) unless `extra` adds one. */
  const readAs = (key: string, extra: Record<string, string> = {}) =>
    stack.api(`/data/${OBJECT}`, { headers: { 'x-api-key': key, ...extra } });
  const writeAs = (key: string, title: string) =>
    stack.api(`/data/${OBJECT}`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    });
  const revokeAs = (key: string, keyRowId: string) =>
    stack.api(`/data/sys_api_key/${keyRowId}`, {
      method: 'PATCH',
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ revoked: true }),
    });
  const mcpInitializeAs = (key: string) =>
    stack.api('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        // The form remote MCP clients send a key in.
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'owner-exists-pin', version: '0.0.0' } },
      }),
    });

  const notesTitled = async (title: string): Promise<number> =>
    rowsOf(await ql.find(OBJECT, { where: { title }, limit: 5, ...SYS })).length;
  const keyRow = async (id: string): Promise<Record<string, any> | undefined> =>
    rowsOf(await ql.find('sys_api_key', { where: { id }, limit: 1, ...SYS }))[0];
  const isRevoked = (row: Record<string, any> | undefined) => row?.revoked === true || row?.revoked === 1;

  const expectKeyServed = async (key: string, label: string) => {
    const read = await readAs(key);
    expect(read.status, `${label}: read ${await read.clone().text()}`).toBe(200);
    const title = `owner-exists-served-${randomBytes(4).toString('hex')}`;
    const write = await writeAs(key, title);
    expect(write.status, `${label}: write ${await write.clone().text()}`).toBe(201);
    expect(await notesTitled(title), `${label}: the write landed`).toBe(1);
    const init = await mcpInitializeAs(key);
    expect(init.status, `${label}: MCP initialize ${await init.clone().text()}`).toBe(200);
  };

  beforeAll(async () => {
    stack = await bootShowcase({
      extraPlugins: [new MCPServerPlugin()],
      security: showcaseAppDefaultSecurity(),
    });
    adminToken = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');

    const ownerSession = await stack.signUp(OWNER_EMAIL, PASSWORD);
    const me = await stack.apiAs(ownerSession, 'GET', '/auth/get-session');
    expect(me.status).toBe(200);
    ownerId = String(((await me.json()) as any)?.user?.id ?? '');
    expect(ownerId).not.toBe('');
    ownerKey = await mintKey(ownerSession, 'owner-exists-key');

    const peerSession = await stack.signUp(PEER_EMAIL, PASSWORD);
    peerKey = await mintKey(peerSession, 'owner-exists-peer-key');
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('control: while its owner exists, the key reads, writes and opens an MCP session, and its own key change is refused 403', async () => {
    await expectKeyServed(ownerKey.raw, 'owner present');
    const revoke = await answerOf(await revokeAs(ownerKey.raw, ownerKey.id));
    expect({ status: revoke.status, code: revoke.code }, 'a key-authenticated key change').toEqual({
      status: 403,
      code: 'PERMISSION_DENIED',
    });
    expect(isRevoked(await keyRow(ownerKey.id)), 'the refused key change wrote nothing').toBe(false);
  });

  it('once its owner\'s row is gone, the key is answered as a key that does not exist, on every door', async () => {
    const driver = ql.getDriver('sys_user');
    ownerRow = rowsOf(await driver.find('sys_user', { where: { id: ownerId } }))[0];
    expect(ownerRow, 'the owner row to remove').toBeTruthy();
    await driver.delete('sys_user', ownerId);
    expect(rowsOf(await ql.find('sys_user', { where: { id: ownerId }, limit: 1, ...SYS })), 'the owner row is gone').toHaveLength(0);
    const keyRowBefore = await keyRow(ownerKey.id);
    expect(keyRowBefore, 'the key row stays').toBeTruthy();
    expect(isRevoked(keyRowBefore), 'the key row is not revoked').toBe(false);

    // The data door: read.
    const read = await answerOf(await readAs(ownerKey.raw));
    const readControl = await answerOf(await readAs(madeUpKey));
    expect(readControl.status, 'the made-up key\'s read must be refused').toBe(401);
    expect(read, 'data read').toEqual(readControl);

    // The data door: write, and nothing lands.
    const title = `owner-exists-write-${randomBytes(4).toString('hex')}`;
    const write = await answerOf(await writeAs(ownerKey.raw, title));
    const writeControl = await answerOf(await writeAs(madeUpKey, `${title}-control`));
    expect(writeControl.status, 'the made-up key\'s write must be refused').toBe(401);
    expect(write, 'data write').toEqual(writeControl);
    expect(await notesTitled(title), 'the refused write must not land').toBe(0);

    // The key-management write door (revoke / restore): answered as the made-up key, and nothing lands.
    const revoke = await answerOf(await revokeAs(ownerKey.raw, ownerKey.id));
    const revokeControl = await answerOf(await revokeAs(madeUpKey, ownerKey.id));
    expect(revokeControl.status, 'the made-up key\'s key change must be refused').toBe(401);
    expect(revoke, 'key change').toEqual(revokeControl);
    expect(await keyRow(ownerKey.id), 'the refused key change must not land').toEqual(keyRowBefore);

    // The MCP door.
    const init = await answerOf(await mcpInitializeAs(ownerKey.raw));
    const initControl = await answerOf(await mcpInitializeAs(madeUpKey));
    expect(initControl.status, 'the made-up key\'s MCP initialize must be refused').toBe(401);
    expect(init, 'MCP initialize').toEqual(initControl);

    // A session sent beside the key never answers for it.
    const beside = await answerOf(await readAs(ownerKey.raw, { authorization: `Bearer ${adminToken}` }));
    expect(beside, 'a session beside the key').toEqual(readControl);

    // Another member's key is not touched.
    await expectKeyServed(peerKey.raw, 'peer while the owner row is gone');
  });

  it('control: once the owner\'s row is back, the same key is served again — the refusal wrote nothing', async () => {
    expect(ownerRow, 'the owner row kept by the previous case').toBeTruthy();
    await ql.getDriver('sys_user').create('sys_user', ownerRow);
    await expectKeyServed(ownerKey.raw, 'owner back');
    expect(isRevoked(await keyRow(ownerKey.id)), 'the key row was not revoked').toBe(false);
  });
});
