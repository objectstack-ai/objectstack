// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 20 — spawns the real producer once per single-cause fixture: one showcase boot for the whole file, its REST and MCP doors driven in process, and one timed ban waited out to its expiry; 12.25 s of tests, the slower of two local runs on a shared agent box, x 1.25, rounded up, no CI reading yet (the dogfood lane did not run on this PR), re-measure on CI

/**
 * A banned user's credentials are refused while the ban holds, at every door
 * that accepts an API key.
 *
 * A ban already ends the user's sessions and refuses their sign-in. An API
 * key the user minted is a credential of that same user, so while the ban
 * holds the key answers exactly as a key that does not exist: the same status,
 * the same error code and message, on the REST data door (read and write) and
 * on the MCP door. Nothing distinguishes a banned owner's key from a made-up
 * one, so the answer says nothing about the key or its owner.
 *
 * The ban is read where the key is resolved to its owner (the shared
 * key-admission seam in `@objectstack/core`), with the one ban predicate the
 * session refusal uses: the ban flag, and its expiry. A ban with an expiry
 * stops binding once it expires, as sign-in does.
 *
 * ⛔ Not a revocation: the key row is not written. The same key is admitted
 * again the moment the ban is lifted (or lapses).
 *
 * Controls, which keep today's answer:
 *  - before the ban, the key reads (200), writes (201) and opens an MCP
 *    session (200);
 *  - another member's key keeps working while the first member is banned;
 *  - the banned member's sign-in is still refused `403 BANNED_USER`;
 *  - after the unban, the key works again with nothing reissued.
 *
 * Refusal cases assert status AND code AND message (ADR-0112) against a
 * made-up key's answer on the same door, and the write case reads the store
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

describe('a banned user\'s credentials are refused while the ban holds, at every door', () => {
  let stack: VerifyStack;
  let adminToken: string;
  let ql: any;

  const BANNED_EMAIL = 'apikey.banned.owner@verify.test';
  const PEER_EMAIL = 'apikey.banned.peer@verify.test';
  let bannedUserId: string;
  let bannedSession: string;
  let bannedKey: string;
  let peerKey: string;
  /** A well-formed key no row holds — the answer every refusal is compared to. */
  const madeUpKey = `osk_${randomBytes(32).toString('base64url')}`;

  const mintKey = async (token: string, name: string): Promise<string> => {
    const res = await stack.apiAs(token, 'POST', '/keys', { name });
    expect(res.status, await res.clone().text()).toBe(201);
    const body: any = await res.json();
    expect(body?.data?.key).toBeTruthy();
    return String(body.data.key);
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

  /** The three doors, each authenticated by the key alone (no cookie, no bearer session). */
  const readAs = (key: string) =>
    stack.api(`/data/${OBJECT}`, { headers: { 'x-api-key': key } });
  const writeAs = (key: string, title: string) =>
    stack.api(`/data/${OBJECT}`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
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
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'banned-owner-pin', version: '0.0.0' } },
      }),
    });

  const notesTitled = async (title: string): Promise<number> =>
    rowsOf(await ql.find(OBJECT, { where: { title }, limit: 5, ...SYS })).length;

  const ban = async (body: Record<string, unknown>) => {
    const res = await stack.apiAs(adminToken, 'POST', '/auth/admin/ban-user', { userId: bannedUserId, ...body });
    expect(res.status, await res.clone().text()).toBe(200);
  };
  const unban = async () => {
    const res = await stack.apiAs(adminToken, 'POST', '/auth/admin/unban-user', { userId: bannedUserId });
    expect(res.status, await res.clone().text()).toBe(200);
  };

  /** Every door answers the banned owner's key exactly as it answers the made-up key. */
  const expectAnsweredAsMadeUpKey = async (label: string) => {
    const read = await answerOf(await readAs(bannedKey));
    const readControl = await answerOf(await readAs(madeUpKey));
    expect(readControl.status, `${label}: the made-up key's read must be refused`).toBe(401);
    expect(read, `${label}: data read`).toEqual(readControl);

    const title = `banned-owner-write-${randomBytes(4).toString('hex')}`;
    const write = await answerOf(await writeAs(bannedKey, title));
    const writeControl = await answerOf(await writeAs(madeUpKey, `${title}-control`));
    expect(writeControl.status, `${label}: the made-up key's write must be refused`).toBe(401);
    expect(write, `${label}: data write`).toEqual(writeControl);
    expect(await notesTitled(title), `${label}: the refused write must not land`).toBe(0);

    const init = await answerOf(await mcpInitializeAs(bannedKey));
    const initControl = await answerOf(await mcpInitializeAs(madeUpKey));
    expect(initControl.status, `${label}: the made-up key's MCP initialize must be refused`).toBe(401);
    expect(init, `${label}: MCP initialize`).toEqual(initControl);
  };

  const expectKeyServed = async (key: string, label: string) => {
    const read = await readAs(key);
    expect(read.status, `${label}: read ${await read.clone().text()}`).toBe(200);
    const title = `served-write-${randomBytes(4).toString('hex')}`;
    const write = await writeAs(key, title);
    expect(write.status, `${label}: write ${await write.clone().text()}`).toBe(201);
    expect(await notesTitled(title), `${label}: the write landed`).toBe(1);
    const init = await mcpInitializeAs(key);
    expect(init.status, `${label}: MCP initialize ${await init.clone().text()}`).toBe(200);
  };

  let priorScim: string | undefined;

  beforeAll(async () => {
    // The ban routes answer 501 unless better-auth's admin plugin is on, and
    // `bootStack` exposes no auth-plugin override. `OS_SCIM_ENABLED` is the one
    // env knob that reaches it (SCIM forces the admin plugin on); it is read
    // when the auth manager is constructed, so it must precede the boot.
    priorScim = process.env.OS_SCIM_ENABLED;
    process.env.OS_SCIM_ENABLED = 'true';
    stack = await bootShowcase({
      extraPlugins: [new MCPServerPlugin()],
      security: showcaseAppDefaultSecurity(),
    });
    adminToken = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');

    bannedSession = await stack.signUp(BANNED_EMAIL, PASSWORD);
    const me = await stack.apiAs(bannedSession, 'GET', '/auth/get-session');
    expect(me.status).toBe(200);
    bannedUserId = String(((await me.json()) as any)?.user?.id ?? '');
    expect(bannedUserId).not.toBe('');
    bannedKey = await mintKey(bannedSession, 'banned-owner-key');

    const peerSession = await stack.signUp(PEER_EMAIL, PASSWORD);
    peerKey = await mintKey(peerSession, 'peer-key');
  }, 180_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (priorScim === undefined) delete process.env.OS_SCIM_ENABLED;
    else process.env.OS_SCIM_ENABLED = priorScim;
  });

  it('control: before the ban, the key reads, writes and opens an MCP session', async () => {
    await expectKeyServed(bannedKey, 'before the ban');
  });

  it('while the ban holds, the key is answered as a key that does not exist, on every door', async () => {
    await ban({ banReason: 'credential-pin' });
    try {
      // The session and sign-in refusals are unchanged.
      const oldSession = await stack.apiAs(bannedSession, 'GET', `/data/${OBJECT}`);
      expect(oldSession.status, 'the ended session').toBe(401);
      const signIn = await stack.api('/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: BANNED_EMAIL, password: PASSWORD }),
      });
      const signInBody: any = await signIn.json();
      expect(signIn.status).toBe(403);
      expect(signInBody?.code ?? signInBody?.error?.code).toBe('BANNED_USER');

      await expectAnsweredAsMadeUpKey('banned');

      // Another member's key is not touched by this member's ban.
      await expectKeyServed(peerKey, 'peer during the ban');
    } finally {
      await unban();
    }
  });

  it('the ban does not revoke the key: once lifted, the same key is served again', async () => {
    await expectKeyServed(bannedKey, 'after the unban');
    const [row] = rowsOf(await ql.find('sys_api_key', { where: { name: 'banned-owner-key' }, limit: 1, ...SYS }));
    expect(row?.revoked === true || row?.revoked === 1, 'the key row was not revoked').toBe(false);
  });

  it('a ban with an expiry binds until it expires, and not after', async () => {
    await ban({ banReason: 'timed-credential-pin', banExpiresIn: 3 });
    try {
      await expectAnsweredAsMadeUpKey('timed ban, before expiry');
      await new Promise((r) => setTimeout(r, 3_500));
      // No sign-in lapses the ban on the row first: the expiry alone decides.
      await expectKeyServed(bannedKey, 'timed ban, after expiry');
    } finally {
      await unban();
    }
  }, 60_000);
});
