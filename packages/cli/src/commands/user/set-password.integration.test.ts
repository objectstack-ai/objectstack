// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os user set-password` — the operator's reset, run through oclif against a
 * real SQLite file, as an operator runs it on the server.
 *
 * The fixture is a project database holding one account with a password
 * credential, one live session and one API key, written through the same
 * declaration boot the command takes. Each case runs the command in process
 * and reads the file back on a boot of its own: the stored hash is checked
 * against the stored-hash format a server verifies, the session and the key by the columns
 * that end and revoke them.
 */

import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { randomBytes, scrypt } from 'node:crypto';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';
import { isExitSignal } from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { composeProviderForDeclarations } from '../../utils/schema-migration-plugins.js';
import UserSetPassword from './set-password.js';

// Pay the first load of what `bootSchemaStack` and the command reach through
// dynamic `import()`s at MODULE LOAD, outside any clocked case.
import '@objectstack/service-datasource';
import '@objectstack/driver-sql';
import '@objectstack/driver-turso';
import '@objectstack/runtime';
import '@objectstack/platform-objects/plugin';
import '@objectstack/plugin-security';
import '@objectstack/rest';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');
const CASE_TIMEOUT_MS = 120_000;
const OVERRIDING_ENV = ['OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME'] as const;
const SYSTEM = { context: { isSystem: true } };
const EMAIL = 'admin@example.com';
const OLD_PASSWORD = 'Old!Passw0rd-seeded';
const NEW_PASSWORD = 'New!Passw0rd-operator';

/**
 * The stored-hash format every server verifies (better-auth's `hashPassword`:
 * `{saltHex}:{keyHex}`, scrypt N=16384 r=16 p=1, 64-byte key over the
 * NFKC-normalised password), spelled out with node's own scrypt so this file
 * checks the command against the format, not against the library it calls.
 */
const SCRYPT = { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 } as const;
const scryptKey = (password: string, saltHex: string): Promise<string> =>
  new Promise((resolveKey, reject) =>
    scrypt(password.normalize('NFKC'), saltHex, 64, SCRYPT, (err, key) => (err ? reject(err) : resolveKey(key.toString('hex')))),
  );
const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${await scryptKey(password, salt)}`;
};
const verifyPassword = async ({ hash, password }: { hash: string; password: string }): Promise<boolean> => {
  const [salt, key] = hash.split(':');
  return Boolean(salt && key) && (await scryptKey(password, salt)) === key;
};

let dir: string;
let templateDb: string;
const savedEnv: Record<string, string | undefined> = {};
const savedCwd = process.cwd();

async function bootIdentity(dbFile: string) {
  return bootSchemaStack({
    jsonOutput: false,
    databaseUrl: `file:${dbFile}`,
    projectRoot: dir,
    extraPlugins: [composeProviderForDeclarations(createIdentityObjectsPlugin())],
  });
}

/** What the file holds for the account, read on a boot of its own. */
async function readAccount(dbFile: string) {
  const stack = await bootIdentity(dbFile);
  try {
    const ql = stack.kernel.getService('objectql');
    const [user] = await ql.find('sys_user', { where: { email: EMAIL } }, SYSTEM);
    const [account] = await ql.find('sys_account', { where: { user_id: user.id, provider_id: 'credential' } }, SYSTEM);
    const values = await ql.resolveInternalField('sys_account', [account.id], 'password');
    const [session] = await ql.find('sys_session', { where: { user_id: user.id } }, SYSTEM);
    const [key] = await ql.find('sys_api_key', { where: { user_id: user.id } }, SYSTEM);
    return {
      hash: String(values.get(account.id)),
      sessionRevoked: Boolean(session?.revoked_at),
      keyRevoked: key?.revoked === true || key?.revoked === 1,
    };
  } finally {
    await stack.shutdown();
  }
}

/** Run the command in process with `stdin` as standard input; its exit status and what it printed. */
async function run(argv: string[], stdin?: string): Promise<{ exitCode: number; out: string }> {
  const savedStdin = Object.getOwnPropertyDescriptor(process, 'stdin');
  if (stdin !== undefined) {
    Object.defineProperty(process, 'stdin', { value: Readable.from([Buffer.from(stdin)]), configurable: true });
  }
  const printed: string[] = [];
  const capture = ((chunk: unknown, ...rest: unknown[]) => {
    printed.push(String(chunk));
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write;
  const spies = [
    vi.spyOn(process.stdout, 'write').mockImplementation(capture),
    vi.spyOn(process.stderr, 'write').mockImplementation(capture),
    vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { printed.push(a.join(' ')); }),
    vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { printed.push(a.join(' ')); }),
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { printed.push(a.join(' ')); }),
  ];
  let exitCode = 0;
  try {
    await UserSetPassword.run(argv, { root: CLI_ROOT });
  } catch (error) {
    if (!isExitSignal(error)) throw error;
    exitCode = (error as { oclif?: { exit?: number } }).oclif?.exit ?? 1;
  } finally {
    for (const spy of spies) spy.mockRestore();
    if (savedStdin) Object.defineProperty(process, 'stdin', savedStdin);
  }
  return { exitCode, out: printed.join('') };
}

let caseSeq = 0;
function prepareCase(): string {
  caseSeq += 1;
  const dbFile = join(dir, `case-${caseSeq}.db`);
  copyFileSync(templateDb, dbFile);
  return dbFile;
}

beforeAll(async () => {
  for (const key of [...OVERRIDING_ENV, 'NODE_ENV', 'OS_SEED_ADMIN_PASSWORD'] as const) savedEnv[key] = process.env[key];
  for (const key of [...OVERRIDING_ENV, 'OS_SEED_ADMIN_PASSWORD'] as const) delete process.env[key];
  process.env.NODE_ENV = 'production';
  dir = mkdtempSync(join(tmpdir(), 'os-user-set-password-'));
  mkdirSync(join(dir, 'data'), { recursive: true });
  templateDb = join(dir, 'data', 'template.db');
  process.chdir(dir);
  const stack = await bootIdentity(templateDb);
  try {
    const ql = stack.kernel.getService('objectql');
    const user = await ql.insert('sys_user', { name: 'Admin', email: EMAIL, email_verified: true }, SYSTEM);
    await ql.insert(
      'sys_account',
      { user_id: user.id, provider_id: 'credential', account_id: user.id, password: await hashPassword(OLD_PASSWORD) },
      SYSTEM,
    );
    await ql.insert(
      'sys_session',
      { user_id: user.id, token: 'tok_live_session', expires_at: new Date(Date.now() + 86_400_000) },
      SYSTEM,
    );
    await ql.insert('sys_api_key', { name: 'automation', key: 'k'.repeat(64), prefix: 'osk_test', user_id: user.id }, SYSTEM);
  } finally {
    await stack.shutdown();
  }
}, CASE_TIMEOUT_MS);

afterAll(() => {
  process.chdir(savedCwd);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  process.exitCode = undefined;
});
afterEach(() => {
  process.exitCode = undefined;
});

describe('os user set-password', () => {
  it('sets the password from standard input with the hash a server verifies, and ends the account\'s sessions and API keys', async () => {
    const dbFile = prepareCase();
    const result = await run([EMAIL, '--password-stdin', '--database-url', `file:${dbFile}`], `${NEW_PASSWORD}\n`);
    expect(result.exitCode, result.out).toBe(0);
    const after = await readAccount(dbFile);
    expect(await verifyPassword({ hash: after.hash, password: NEW_PASSWORD })).toBe(true);
    expect(await verifyPassword({ hash: after.hash, password: OLD_PASSWORD })).toBe(false);
    expect({ sessionRevoked: after.sessionRevoked, keyRevoked: after.keyRevoked }).toEqual({ sessionRevoked: true, keyRevoked: true });
  }, CASE_TIMEOUT_MS);

  it('refuses the development seed password and writes nothing', async () => {
    const dbFile = prepareCase();
    const before = await readAccount(dbFile);
    const result = await run([EMAIL, '--password-stdin', '--database-url', `file:${dbFile}`], 'admin123\n');
    expect(result.exitCode).toBe(1);
    expect(await readAccount(dbFile)).toEqual(before);
  }, CASE_TIMEOUT_MS);

  it('refuses an address no account holds before it asks for a password', async () => {
    const dbFile = prepareCase();
    const before = await readAccount(dbFile);
    const result = await run(['nobody@nowhere.example', '--database-url', `file:${dbFile}`]);
    expect(result.exitCode).toBe(1);
    expect(result.out).toContain('nobody@nowhere.example');
    expect(await readAccount(dbFile)).toEqual(before);
  }, CASE_TIMEOUT_MS);
});
