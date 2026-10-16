// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21499] `bootStack` never creates key material in the key home, and never
// seals under a real key the host already holds.
//
// `os verify` is a one-shot command: it boots this harness twice (the CRUD
// stack and the RLS stack), each over an in-memory database, and exits. The
// harness used to compose the settings service with no `cryptoProvider` and
// bind the engine to a bare `new LocalCryptoProvider()`. `bootStack` forces a
// development posture, and in that posture, with no env key and no key file,
// both of those providers MINT a key file in the key home so the next restart
// reuses it. That is right for `os serve`, the long-lived host. For a run that
// seals nothing it keeps, it is an undeclared side effect on key custody: the
// file outlives the run, and the next development-posture process on that host
// adopts it and seals real secrets under it.
//
// The one-shot shape the CLI uses ("read an existing key, or refuse every
// call") does not fit here, because the harness SEALS AND OPENS secrets in its
// own database: a `secret` field write, an encrypted setting. On a keyless host
// a refusing provider would break exactly those. So the harness holds its own
// data key, in this process's memory only, and hands that one provider to the
// settings service and to the engine. What this file pins, in a development
// posture:
//
//   1. the control — the default provider mints a key file in this posture and
//      this home, so an empty home after a boot is a reading, not a vacuity;
//   2. an empty key home stays empty through a boot, a secret-field write, an
//      encrypted-setting write and `stop()`, while both secrets still read back;
//   3. a key file already in the key home is never rewritten, and nothing the
//      boot seals opens under it — so it was never the key in use;
//   4. the same for an `OS_SECRET_KEY` in the environment;
//   5. two boots in one process over one `databaseFile` — the harness's restart
//      — open each other's secrets, so the key is the process's, not the boot's.
//
// Every boot runs in a hook: a case measures behaviour, never loading.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { LocalCryptoProvider, type SettingsManifest } from '@objectstack/service-settings';
// `.js` extension deliberate: this package resolves NodeNext, so an
// extensionless relative import does not resolve under its typecheck.
import { bootStack, type BootOptions } from './harness.js';

// Booting the full in-process stack runs well past vitest's 5s default.
const BOOT_TIMEOUT = 120_000;

/** Every variable that decides where a data key comes from, and the posture. */
const KEY_ENV = [
  'NODE_ENV', 'OS_SECRET_KEY', 'OS_DEV_CRYPTO_KEY', 'OBJECTSTACK_DEV_CRYPTO_KEY',
  'OS_HOME', 'OBJECTSTACK_HOME', 'OS_CRYPTO_AUTOKEY',
] as const;

/** The file name the default provider persists its key under, in the key home. */
const KEY_FILE = 'dev-crypto-key';

/** A host's real key, as a key file or as `OS_SECRET_KEY`. Fixed bytes, never a secret. */
const HOST_KEY_HEX = '606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f';
const HOST_KEY = Buffer.from(HOST_KEY_HEX, 'hex');

const OBJECT = 'keycustody_vault';
const SECRET_FIELD = 'token';
const SETTINGS_NS = 'keycustody_settings';
const SETTINGS_KEY = 'api_key';
const SYS = { isSystem: true } as const;

/** The producer scope each `sys_secret` row was sealed under, by its namespace. */
const SCOPE_OF: Record<string, 'object_secret_field' | 'settings'> = {
  [OBJECT]: 'object_secret_field',
  [SETTINGS_NS]: 'settings',
};

const app = {
  manifest: {
    id: 'com.example.key-custody',
    namespace: 'keycustody',
    version: '0.0.1',
    type: 'app',
    name: 'Key Custody Fixture',
  },
  objects: [
    ObjectSchema.create({
      name: OBJECT,
      sharingModel: 'public_read_write',
      label: 'Vault',
      pluralLabel: 'Vaults',
      fields: {
        name: Field.text({ label: 'Name', required: true }),
        [SECRET_FIELD]: Field.secret({ label: 'Token' }),
      },
    }),
  ],
};

/** One encrypted setting, so the settings service's provider is exercised too. */
const settingsManifest: SettingsManifest = {
  namespace: SETTINGS_NS,
  version: 1,
  label: 'Key custody',
  scope: 'global',
  readPermission: 'setup.access',
  writePermission: 'setup.write',
  specifiers: [{ type: 'password', key: SETTINGS_KEY, label: 'API key', required: false }],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Engine = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Settings = any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : []);

interface SealedRow {
  id: string;
  namespace: string;
  key: string;
  kms_key_id: string;
  alg: string;
  version: number;
  ciphertext: string;
}

/** What one boot sealed, and what it read back through its own doors. */
interface BootReading {
  /** The secret field, read back through the engine's privileged door. */
  fieldReadBack: string | null;
  /** The encrypted setting, read back through the settings service. */
  settingReadBack: unknown;
  /** Every `sys_secret` row the boot holds. */
  sealed: SealedRow[];
  /** The key home's entries after the writes, before `stop()`. */
  homeBeforeStop: string[];
  /** The key home's entries after `stop()`. */
  homeAfterStop: string[];
}

const savedEnv: Record<string, string | undefined> = {};
const scratch: string[] = [];

function freshDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `os-21499-${label}-`));
  scratch.push(dir);
  return dir;
}

/**
 * A development posture with no key anywhere, and `home` as the key home. Set
 * before each boot: `bootStack` forces `NODE_ENV=development` itself, and the
 * control below needs the same posture with no harness in the way.
 */
function keylessDevelopmentPosture(home: string): void {
  for (const k of KEY_ENV) delete process.env[k];
  process.env.NODE_ENV = 'development';
  process.env.OS_HOME = home;
}

beforeAll(() => {
  for (const k of KEY_ENV) savedEnv[k] = process.env[k];
});

afterAll(() => {
  for (const k of KEY_ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** Write a secret field and an encrypted setting into a booted stack. */
async function sealBoth(engine: Engine, settings: Settings): Promise<string> {
  const row = await engine.insert(OBJECT, { name: 'vault', [SECRET_FIELD]: 'field-plaintext' }, { context: SYS });
  await settings.set(SETTINGS_NS, SETTINGS_KEY, 'setting-plaintext');
  return row.id as string;
}

/** Boot `bootStack(app, opts)`, seal both producers' secrets, read them back, stop. */
async function bootAndSeal(home: string, opts?: BootOptions): Promise<BootReading> {
  const stack = await bootStack(app, opts);
  try {
    const engine: Engine = await stack.kernel.getServiceAsync('objectql');
    const settings: Settings = await stack.kernel.getServiceAsync('settings');
    settings.registerManifest(settingsManifest);
    const id = await sealBoth(engine, settings);
    const reading: Omit<BootReading, 'homeAfterStop'> = {
      fieldReadBack: await engine.resolveSecretField(OBJECT, id, SECRET_FIELD),
      settingReadBack: (await settings.get(SETTINGS_NS, SETTINGS_KEY)).value,
      sealed: rowsOf(await engine.find('sys_secret', { context: SYS })),
      homeBeforeStop: readdirSync(home),
    };
    await stack.stop();
    return { ...reading, homeAfterStop: readdirSync(home) };
  } catch (e) {
    await stack.stop().catch(() => undefined);
    throw e;
  }
}

/** Does `row` open under a provider over `key`, in its producer's own context? */
async function opensUnder(key: Buffer, row: SealedRow): Promise<boolean> {
  const provider = new LocalCryptoProvider({ key });
  const handle = {
    id: row.id, kmsKeyId: row.kms_key_id, alg: row.alg, version: row.version, ciphertext: row.ciphertext,
  };
  try {
    await provider.decrypt(handle, { scope: SCOPE_OF[row.namespace], namespace: row.namespace, key: row.key });
    return true;
  } catch {
    return false;
  }
}

/** Both producers sealed exactly one row each — the population every "none opens" reads. */
function expectOneRowPerProducer(sealed: SealedRow[]): void {
  expect(sealed.map((r) => r.namespace).sort()).toEqual([OBJECT, SETTINGS_NS].sort());
}

describe('[#21499] the control: this posture and this home are where a key gets minted', () => {
  let home: string;
  let keySource: string;
  let entries: string[];

  beforeAll(() => {
    home = freshDir('control-home');
    keylessDevelopmentPosture(home);
    keySource = new LocalCryptoProvider().keySource;
    entries = readdirSync(home);
  });

  it('the default provider mints a key file in the key home', () => {
    expect(keySource).toBe('generated-file');
    expect(entries).toEqual([KEY_FILE]);
  });
});

describe('[#21499] an empty key home stays empty through a whole boot', () => {
  let home: string;
  let reading: BootReading;

  beforeAll(async () => {
    home = freshDir('empty-home');
    keylessDevelopmentPosture(home);
    // The options `os verify` boots its CRUD stack with on a single-tenant host.
    reading = await bootAndSeal(home, { multiTenant: false });
  }, BOOT_TIMEOUT);

  it('no key material is created, before or after stop()', () => {
    expect(reading.homeBeforeStop).toEqual([]);
    expect(reading.homeAfterStop).toEqual([]);
  });

  it('the harness still seals and opens both producers\' secrets on a keyless host', () => {
    expectOneRowPerProducer(reading.sealed);
    expect(reading.fieldReadBack).toBe('field-plaintext');
    expect(reading.settingReadBack).toBe('setting-plaintext');
  });
});

describe('[#21499] a key file already in the key home is never the key in use', () => {
  let home: string;
  let before: string;
  let reading: BootReading;
  let opened: boolean[];

  beforeAll(async () => {
    home = freshDir('keyed-home');
    keylessDevelopmentPosture(home);
    writeFileSync(join(home, KEY_FILE), HOST_KEY.toString('base64'), { mode: 0o600 });
    before = readFileSync(join(home, KEY_FILE), 'utf8');
    reading = await bootAndSeal(home);
    opened = await Promise.all(reading.sealed.map((row) => opensUnder(HOST_KEY, row)));
  }, BOOT_TIMEOUT);

  it('the key file is left exactly as it was, and nothing joins it', () => {
    expect(reading.homeAfterStop).toEqual([KEY_FILE]);
    expect(readFileSync(join(home, KEY_FILE), 'utf8')).toBe(before);
  });

  it('nothing the boot sealed opens under the key file\'s key', () => {
    expectOneRowPerProducer(reading.sealed);
    expect(opened).toEqual([false, false]);
    expect(reading.fieldReadBack).toBe('field-plaintext');
    expect(reading.settingReadBack).toBe('setting-plaintext');
  });
});

describe('[#21499] an OS_SECRET_KEY in the environment is never the key in use', () => {
  let home: string;
  let reading: BootReading;
  let opened: boolean[];

  beforeAll(async () => {
    home = freshDir('env-key-home');
    keylessDevelopmentPosture(home);
    process.env.OS_SECRET_KEY = HOST_KEY_HEX;
    reading = await bootAndSeal(home);
    opened = await Promise.all(reading.sealed.map((row) => opensUnder(HOST_KEY, row)));
  }, BOOT_TIMEOUT);

  it('nothing the boot sealed opens under the environment\'s key', () => {
    expectOneRowPerProducer(reading.sealed);
    expect(opened).toEqual([false, false]);
    expect(reading.fieldReadBack).toBe('field-plaintext');
    expect(reading.settingReadBack).toBe('setting-plaintext');
    expect(reading.homeAfterStop).toEqual([]);
  });
});

describe('[#21499] the key is the process\'s: a restart over one database file opens what the last boot sealed', () => {
  let home: string;
  let first: BootReading;
  let fieldAfterRestart: string | null;
  let settingAfterRestart: unknown;
  let homeAfterRestart: string[];

  beforeAll(async () => {
    home = freshDir('restart-home');
    keylessDevelopmentPosture(home);
    const databaseFile = join(freshDir('restart-db'), 'verify.db');
    first = await bootAndSeal(home, { databaseFile });

    const second = await bootStack(app, { databaseFile });
    try {
      const engine: Engine = await second.kernel.getServiceAsync('objectql');
      const settings: Settings = await second.kernel.getServiceAsync('settings');
      settings.registerManifest(settingsManifest);
      const [row] = rowsOf(await engine.find(OBJECT, { context: SYS }));
      fieldAfterRestart = await engine.resolveSecretField(OBJECT, row.id, SECRET_FIELD);
      settingAfterRestart = (await settings.get(SETTINGS_NS, SETTINGS_KEY)).value;
    } finally {
      await second.stop();
    }
    homeAfterRestart = readdirSync(home);
  }, BOOT_TIMEOUT * 2);

  it('the second boot opens both secrets the first sealed, and the key home stays empty', () => {
    expectOneRowPerProducer(first.sealed);
    expect(fieldAfterRestart).toBe('field-plaintext');
    expect(settingAfterRestart).toBe('setting-plaintext');
    expect(homeAfterRestart).toEqual([]);
  });
});
