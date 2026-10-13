// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The session against a real TCP server: the in-process double of
 * `./testing`, which shares no protocol code with the client.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:net';
import { openImapSession, type ImapSession } from './imap-session.js';
import { staticCredentials, type MailAccount, type MailCredential } from './account.js';
import { ImapError } from './imap-error.js';
import { ImapServerDouble, type ImapServerDoubleOptions } from './testing.js';

const servers: Array<{ close(): Promise<void> }> = [];
const sessions: ImapSession[] = [];

afterEach(async () => {
  for (const s of sessions.splice(0)) s.close();
  for (const s of servers.splice(0)) await s.close();
});

async function double(options: ImapServerDoubleOptions = {}) {
  const server = new ImapServerDouble(options);
  servers.push(server);
  const { host, port } = await server.listen();
  const account: MailAccount = { id: 'acct_1', username: 'user', imap: { host, port, security: 'none' } };
  return { server, account };
}

async function open(account: MailAccount, credential: MailCredential = { type: 'password', password: 'secret' }) {
  const session = await openImapSession({ account, credentials: staticCredentials(credential), timeoutMs: 5_000 });
  sessions.push(session);
  return session;
}

const MESSAGE = 'From: a@acme.test\r\nTo: inbox@corp.test\r\nSubject: Hi\r\nMessage-ID: <m1@acme.test>\r\n\r\nBody.\r\n';

function refusal(err: unknown): { kind: string; message: string } {
  expect(err).toBeInstanceOf(ImapError);
  return { kind: (err as ImapError).kind, message: (err as ImapError).message };
}

describe('authentication', () => {
  it('logs in with LOGIN when the server offers no AUTH=PLAIN', async () => {
    const { server, account } = await double();
    const session = await open(account);
    expect(session.capabilities.has('IMAP4REV1')).toBe(true);
    expect(server.commands.some((c) => / LOGIN \[redacted\]$/.test(c))).toBe(true);
  });

  it('prefers AUTHENTICATE PLAIN, with the initial response inline under SASL-IR', async () => {
    const { server, account } = await double({ capabilities: ['AUTH=PLAIN', 'SASL-IR'] });
    await open(account);
    expect(server.commands.filter((c) => /AUTHENTICATE PLAIN/.test(c))).toHaveLength(1);
    expect(server.commands.some((c) => / LOGIN /.test(c))).toBe(false);
  });

  it('answers the continuation with the PLAIN response when SASL-IR is not offered', async () => {
    const { account } = await double({ capabilities: ['AUTH=PLAIN'] });
    await expect(open(account)).resolves.toBeDefined();
  });

  it('sends a password that quoting cannot carry as a literal, after the server asks for it', async () => {
    const { account } = await double({ users: { user: { password: 'line\r\nbreak' } } });
    await expect(open(account, { type: 'password', password: 'line\r\nbreak' })).resolves.toBeDefined();
  });

  it('authenticates an OAuth access token with XOAUTH2', async () => {
    const { account } = await double({ capabilities: ['AUTH=XOAUTH2', 'SASL-IR'], users: { user: { accessToken: 'tok' } } });
    await expect(open(account, { type: 'oauth2', accessToken: 'tok' })).resolves.toBeDefined();
  });

  it('refuses a bad XOAUTH2 token as an authentication failure, through the error-continuation flow', async () => {
    const { account } = await double({ capabilities: ['AUTH=XOAUTH2'], users: { user: { accessToken: 'tok' } } });
    const err = await open(account, { type: 'oauth2', accessToken: 'stale' }).catch((e) => e);
    expect(refusal(err).kind).toBe('authentication');
  });

  it('refuses a wrong password as an authentication failure and leaves no connection open', async () => {
    const { server, account } = await double();
    const err = await open(account, { type: 'password', password: 'nope' }).catch((e) => e);
    expect(refusal(err)).toMatchObject({ kind: 'authentication' });
    expect(refusal(err).message).not.toContain('nope');
    await new Promise((r) => setTimeout(r, 20));
    expect(server.openConnections).toBe(0);
  });

  it('refuses a password the server will not take (LOGINDISABLED, no PLAIN) without sending it', async () => {
    const { server, account } = await double({ capabilities: ['LOGINDISABLED'] });
    const err = await open(account).catch((e) => e);
    expect(refusal(err).kind).toBe('configuration');
    expect(server.commands.some((c) => /LOGIN|AUTHENTICATE/.test(c))).toBe(false);
  });

  it('refuses an OAuth token where the server offers no XOAUTH2', async () => {
    const { account } = await double();
    expect(refusal(await open(account, { type: 'oauth2', accessToken: 't' }).catch((e) => e)).kind).toBe('configuration');
  });

  it('asks for the capabilities when the greeting does not carry them', async () => {
    const { server, account } = await double({ capabilitiesInGreeting: false });
    const session = await open(account);
    expect(session.capabilities.has('IMAP4REV1')).toBe(true);
    expect(server.commands.some((c) => / CAPABILITY$/.test(c))).toBe(true);
  });

  it('resolves the credential on every open, never once for the life of the account', async () => {
    const { account } = await double();
    let asked = 0;
    const credentials = { credentialFor: async () => (asked++, { type: 'password' as const, password: 'secret' }) };
    for (let i = 0; i < 2; i++) sessions.push(await openImapSession({ account, credentials }));
    expect(asked).toBe(2);
  });
});

describe('a plaintext connection is accepted only to loopback', () => {
  it('refuses security none to any other host before a socket opens', async () => {
    let connected = false;
    const listener: Server = createServer(() => (connected = true));
    await new Promise<void>((r) => listener.listen(0, '0.0.0.0', () => r()));
    servers.push({ close: () => new Promise<void>((r) => listener.close(() => r())) });
    const port = (listener.address() as { port: number }).port;
    const err = await openImapSession({
      account: { id: 'a', username: 'u', imap: { host: 'mail.example.test', port, security: 'none' } },
      credentials: staticCredentials({ type: 'password', password: 'p' }),
    }).catch((e) => e);
    expect(refusal(err)).toMatchObject({ kind: 'configuration' });
    expect(refusal(err).message).toMatch(/plaintext/);
    expect(connected).toBe(false);
  });
});

describe('reading a folder', () => {
  it('opens the folder with EXAMINE and reports its UIDVALIDITY, UIDNEXT and count', async () => {
    const { server, account } = await double();
    server.append('INBOX', MESSAGE);
    server.append('INBOX', MESSAGE);
    const session = await open(account);
    const status = await session.examine('INBOX');
    expect(status).toEqual({ folder: 'INBOX', uidValidity: server.uidValidity('INBOX'), uidNext: 3, exists: 2 });
    expect(server.commands.some((c) => / EXAMINE "INBOX"$/.test(c))).toBe(true);
    expect(server.commands.some((c) => / SELECT /.test(c))).toBe(false);
  });

  it('lists UIDs and sizes from a UID up, and nothing when every UID is below it', async () => {
    const { server, account } = await double();
    const first = server.append('INBOX', MESSAGE);
    const second = server.append('INBOX', `${MESSAGE}more\r\n`);
    const session = await open(account);
    await session.examine('INBOX');
    expect(await session.listMessages(1)).toEqual([
      { uid: first, size: Buffer.byteLength(MESSAGE) },
      { uid: second, size: Buffer.byteLength(MESSAGE) + 6 },
    ]);
    expect((await session.listMessages(second)).map((m) => m.uid)).toEqual([second]);
    // `n:*` names the last message even past the end; it is not a new one.
    expect(await session.listMessages(second + 1)).toEqual([]);
  });

  it('lists nothing in an empty folder without sending a fetch', async () => {
    const { server, account } = await double();
    const session = await open(account);
    await session.examine('INBOX');
    expect(await session.listMessages(1)).toEqual([]);
    expect(server.commands.some((c) => /UID FETCH/.test(c))).toBe(false);
  });

  it('fetches messages byte for byte with their INTERNALDATE, and never marks them \\Seen', async () => {
    const { server, account } = await double();
    const raw = Buffer.concat([Buffer.from('Subject: =?utf-8?q?caf=C3=A9?=\r\n\r\n'), Buffer.from([0xc3, 0xa9, 0x0d, 0x0a])]);
    const uid = server.append('INBOX', new Uint8Array(raw), { internalDate: new Date('2026-10-12T07:30:00Z') });
    const session = await open(account);
    await session.examine('INBOX');
    const [message] = await session.fetchMessages([uid]);
    expect(message!.uid).toBe(uid);
    expect(Buffer.from(message!.raw).equals(raw)).toBe(true);
    expect(message!.internalDate?.toISOString()).toBe('2026-10-12T07:30:00.000Z');
    expect(server.commands.some((c) => /BODY\.PEEK\[\]/.test(c))).toBe(true);
    expect(server.messages('INBOX')[0]!.flags.has('\\Seen')).toBe(false);
  });

  it('fetches several messages in one command, ascending, leaving out a UID that is gone', async () => {
    const { server, account } = await double();
    const uids = [1, 2, 3, 4].map((n) => server.append('INBOX', MESSAGE.replace('m1@', `m${n}@`)));
    server.expunge('INBOX', uids[2]!);
    const session = await open(account);
    await session.examine('INBOX');
    const fetched = await session.fetchMessages([uids[3]!, uids[0]!, uids[1]!, uids[2]!]);
    expect(fetched.map((m) => m.uid)).toEqual([uids[0], uids[1], uids[3]]);
    expect(server.commands.filter((c) => /UID FETCH 1:4 /.test(c))).toHaveLength(1);
  });

  it('opens a folder whose name is not ASCII, in modified UTF-7', async () => {
    const { server, account } = await double();
    server.append('&ZeVnLIqe-', MESSAGE);
    const session = await open(account);
    expect((await session.examine('日本語')).exists).toBe(1);
  });

  it('refuses a folder opened without a UIDVALIDITY: its UIDs cannot be trusted across sessions', async () => {
    const { account } = await double({ omitUidValidity: true });
    const session = await open(account);
    expect(refusal(await session.examine('INBOX').catch((e) => e)).kind).toBe('protocol');
  });

  it('answers a missing folder as a refusal', async () => {
    const { account } = await double();
    const session = await open(account);
    expect(refusal(await session.examine('Nope').catch((e) => e)).kind).toBe('refused');
  });
});

describe('bounds against a hostile server', () => {
  async function openWith(options: ImapServerDoubleOptions, maxCommandBytes?: number) {
    const { server, account } = await double(options);
    const session = await openImapSession({
      account,
      credentials: staticCredentials({ type: 'password', password: 'secret' }),
      timeoutMs: 5_000,
      maxCommandBytes,
    });
    sessions.push(session);
    return { server, session };
  }

  it('refuses one response that announces empty literal after empty literal, without end, as oversized', async () => {
    const { server, session } = await openWith({ hostile: 'endless-literals' });
    server.append('INBOX', MESSAGE);
    await session.examine('INBOX');
    const err = await session.listMessages(1).catch((e) => e);
    expect(refusal(err).kind).toBe('oversized');
    expect(refusal(err).message).toMatch(/more than 32 literals/);
    await new Promise((r) => setTimeout(r, 20));
    expect(server.openConnections).toBe(0);
  }, 10_000);

  it('refuses an untagged stream that never reaches the tagged answer, at the command bound', async () => {
    const { server, session } = await openWith({ hostile: 'endless-untagged' }, 64 * 1024);
    server.append('INBOX', MESSAGE);
    await session.examine('INBOX');
    const err = await session.listMessages(1).catch((e) => e);
    expect(refusal(err).kind).toBe('oversized');
    expect(refusal(err).message).toMatch(/more than 65536 bytes of responses to one command/);
    await new Promise((r) => setTimeout(r, 20));
    expect(server.openConnections).toBe(0);
  }, 10_000);

  it('refuses a response at the announcement of the literal that takes it past the command bound, before its octets', async () => {
    // Two 40 KiB literals under a 64 KiB bound: the first is read, the second
    // is announced and never sent. Charged only once a response completes,
    // the session would wait for it until its silence bound (`timeout`).
    const { server, session } = await openWith({ hostile: 'withheld-literal' }, 64 * 1024);
    server.append('INBOX', MESSAGE);
    await session.examine('INBOX');
    const err = await session.fetchMessages([1]).catch((e) => e);
    expect(refusal(err).kind).toBe('oversized');
    expect(refusal(err).message).toMatch(/announced a literal that takes its responses to one command past 65536 bytes/);
    await new Promise((r) => setTimeout(r, 20));
    expect(server.openConnections).toBe(0);
  }, 10_000);

  it('control: the same command bound admits an honest folder of 50 messages', async () => {
    const { server, session } = await openWith({}, 64 * 1024);
    for (let i = 0; i < 50; i++) server.append('INBOX', MESSAGE);
    await session.examine('INBOX');
    expect(await session.listMessages(1)).toHaveLength(50);
    expect(await session.fetchMessages([1, 2, 3])).toHaveLength(3);
  });
});

describe('the connection', () => {
  it('logs out politely and closes', async () => {
    const { server, account } = await double();
    const session = await open(account);
    await session.logout();
    expect(server.commands.some((c) => / LOGOUT$/.test(c))).toBe(true);
    await expect(session.examine('INBOX')).rejects.toBeInstanceOf(ImapError);
  });

  it('fails a command the server drops the connection under, as a connection failure', async () => {
    const { server, account } = await double();
    const session = await open(account);
    const pending = session.examine('INBOX');
    await server.close();
    servers.splice(0);
    expect(refusal(await pending.catch((e) => e)).kind).toBe('connection');
  });

  it('gives up on a server that goes silent', async () => {
    const silent = createServer(() => {
      /* never greets */
    });
    await new Promise<void>((r) => silent.listen(0, '127.0.0.1', () => r()));
    servers.push({ close: () => new Promise<void>((r) => silent.close(() => r())) });
    const port = (silent.address() as { port: number }).port;
    const err = await openImapSession({
      account: { id: 'a', username: 'u', imap: { host: '127.0.0.1', port, security: 'none' } },
      credentials: staticCredentials({ type: 'password', password: 'p' }),
      timeoutMs: 100,
    }).catch((e) => e);
    expect(refusal(err).kind).toBe('timeout');
  });
});
