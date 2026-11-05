// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  CRYPTO_CONTEXT_SCOPES,
  type CryptoContext,
  type CryptoContextScope,
  type CryptoHandle,
} from '@objectstack/spec/contracts';
import {
  LocalCryptoProvider,
  InMemoryCryptoProvider,
  KeyedDigestKeyUnavailableError,
  CryptoContextScopeError,
  UnknownCiphertextVersionError,
  aadForVersion2,
  ciphertextDerivationStatus,
  resolvePersistedKeyFile,
  KEY_FILE_CHANNEL_ENV,
  KEY_FILE_CANDIDATE_CHANNEL_ENV,
  chooseKeyFileByTrialOpen,
  settleKeyFileChannel,
  storedSecretReaderOverEngine,
  deferredLocalCryptoProvider,
  DataKeyOpensNothingError,
  type PersistedKeyFile,
  type StoredSecretSample,
} from './local-crypto-provider.js';

const ctx: CryptoContext = { scope: 'settings', namespace: 'mail', key: 'api_key' };

describe('LocalCryptoProvider — key resolution', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'os-crypto-'));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('round-trips with an explicit key (source=explicit)', async () => {
    const p = new LocalCryptoProvider({ key: randomBytes(32) });
    expect(p.keySource).toBe('explicit');
    const h = await p.encrypt('hello', ctx);
    expect(h.ciphertext).not.toContain('hello');
    expect(await p.decrypt(h, ctx)).toBe('hello');
  });

  it('resolves OS_SECRET_KEY (hex) and survives a fresh instance', async () => {
    const hex = randomBytes(32).toString('hex');
    const env = { NODE_ENV: 'production', OS_SECRET_KEY: hex, OS_HOME: home };
    const a = new LocalCryptoProvider({ env });
    expect(a.keySource).toBe('env:OS_SECRET_KEY');
    const h = await a.encrypt('secret-value', ctx);
    // A brand-new instance with the same env key must decrypt prior ciphertext.
    const b = new LocalCryptoProvider({ env });
    expect(await b.decrypt(h, ctx)).toBe('secret-value');
  });

  it('resolves OS_SECRET_KEY (base64)', async () => {
    const b64 = randomBytes(32).toString('base64');
    const p = new LocalCryptoProvider({ env: { OS_SECRET_KEY: b64, NODE_ENV: 'production', OS_HOME: home } });
    expect(p.keySource).toBe('env:OS_SECRET_KEY');
  });

  it('throws on an invalid OS_SECRET_KEY (not 32 bytes)', () => {
    expect(
      () => new LocalCryptoProvider({ env: { OS_SECRET_KEY: 'too-short', NODE_ENV: 'production', OS_HOME: home } }),
    ).toThrow(/not a 32-byte key/);
  });

  it('fails loud in production when no key source is available', () => {
    expect(
      () => new LocalCryptoProvider({ env: { NODE_ENV: 'production', OS_HOME: home } }),
    ).toThrow(/Refusing to start in production/);
  });

  it('uses a pre-existing persisted file in production (but never mints one)', async () => {
    const keyPath = join(home, '.objectstack', 'dev-crypto-key');
    // Simulate an operator-provisioned key file on a mounted volume.
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(home, '.objectstack'), { recursive: true });
    writeFileSync(keyPath, randomBytes(32).toString('base64'), { mode: 0o600 });

    const env = { NODE_ENV: 'production', HOME: home };
    const a = new LocalCryptoProvider({ env });
    expect(a.keySource).toBe('file');
    const h = await a.encrypt('v', ctx);
    expect(await new LocalCryptoProvider({ env }).decrypt(h, ctx)).toBe('v');
  });

  it('does NOT create a key file in production', () => {
    const keyPath = join(home, '.objectstack', 'dev-crypto-key');
    expect(() => new LocalCryptoProvider({ env: { NODE_ENV: 'production', HOME: home } })).toThrow();
    expect(existsSync(keyPath)).toBe(false);
  });

  it('mints + persists a key in production when OS_CRYPTO_AUTOKEY is set (os start quickstart)', async () => {
    const env = { NODE_ENV: 'production', HOME: home, OS_CRYPTO_AUTOKEY: '1' };
    const a = new LocalCryptoProvider({ env });
    expect(a.keySource).toBe('generated-file');
    const h = await a.encrypt('quickstart-secret', ctx);
    // A fresh instance reads the persisted file and decrypts prior ciphertext.
    const b = new LocalCryptoProvider({ env });
    expect(b.keySource).toBe('file');
    expect(await b.decrypt(h, ctx)).toBe('quickstart-secret');
  });

  it('still fails loud with OS_CRYPTO_AUTOKEY when the key cannot be persisted', () => {
    // Point HOME at a path under a regular *file* so mkdir/write fails — the
    // opt-in must NOT degrade to an ephemeral key in production.
    const blocker = join(home, 'not-a-dir');
    writeFileSync(blocker, 'x');
    const env = { NODE_ENV: 'production', OS_HOME: join(blocker, 'nested'), OS_CRYPTO_AUTOKEY: '1' };
    expect(() => new LocalCryptoProvider({ env })).toThrow(/Refusing to start in production/);
  });

  it('auto-creates + persists a key in development', async () => {
    const env = { NODE_ENV: 'development', HOME: home };
    const a = new LocalCryptoProvider({ env });
    expect(a.keySource).toBe('generated-file');
    const h = await a.encrypt('dev-secret', ctx);
    // Second instance reads the persisted file (source=file) and decrypts.
    const b = new LocalCryptoProvider({ env });
    expect(b.keySource).toBe('file');
    expect(await b.decrypt(h, ctx)).toBe('dev-secret');
  });

  it('uses an ephemeral key in test mode without touching disk', () => {
    const keyPath = join(home, '.objectstack', 'dev-crypto-key');
    const p = new LocalCryptoProvider({ env: { NODE_ENV: 'test', HOME: home } });
    expect(p.keySource).toBe('ephemeral');
    expect(existsSync(keyPath)).toBe(false);
  });

  it('honours the legacy OBJECTSTACK_DEV_CRYPTO_KEY alias', () => {
    const hex = randomBytes(32).toString('hex');
    const p = new LocalCryptoProvider({
      env: { OBJECTSTACK_DEV_CRYPTO_KEY: hex, NODE_ENV: 'development', HOME: home },
    });
    expect(p.keySource).toBe('env:OS_DEV_CRYPTO_KEY');
  });
});

describe('#29934 — the key file the CLI names, and the one resolution behind it', () => {
  let home: string;
  let other: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'os-crypto-home-'));
    other = mkdtempSync(join(tmpdir(), 'os-crypto-other-'));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  });

  const canonical = () => join(home, '.objectstack', 'dev-crypto-key');
  const legacy = () => join(other, 'dev-crypto-key');
  const writeKey = (file: string): Buffer => {
    const key = randomBytes(32);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, key.toString('base64'), { mode: 0o600 });
    return key;
  };

  it('the file tier reads and mints at the channel path, over OS_HOME', async () => {
    const named = join(other, 'named', 'dev-crypto-key');
    const env = { NODE_ENV: 'production', OS_HOME: home, OS_CRYPTO_AUTOKEY: '1', [KEY_FILE_CHANNEL_ENV]: named };
    const a = new LocalCryptoProvider({ env });
    expect(a.keySource).toBe('generated-file');
    expect(existsSync(named)).toBe(true);
    expect(existsSync(join(home, 'dev-crypto-key'))).toBe(false);
    const h = await a.encrypt('v', ctx);
    expect(await new LocalCryptoProvider({ env }).decrypt(h, ctx)).toBe('v');
  });

  it('an env key still answers before the channel', () => {
    const named = join(other, 'dev-crypto-key');
    writeKey(named);
    const p = new LocalCryptoProvider({
      env: { NODE_ENV: 'production', OS_SECRET_KEY: randomBytes(32).toString('hex'), [KEY_FILE_CHANNEL_ENV]: named },
    });
    expect(p.keySource).toBe('env:OS_SECRET_KEY');
  });

  it('canonical = the file the provider reads without the channel; no legacy file → canonical', () => {
    expect(resolvePersistedKeyFile({ env: { HOME: home }, legacyKeyFile: legacy() })).toEqual({
      path: canonical(),
      kind: 'canonical',
      canonical: canonical(),
    });
  });

  it('only the legacy file holds a key → legacy-only, its path', () => {
    writeKey(legacy());
    expect(resolvePersistedKeyFile({ env: { HOME: home }, legacyKeyFile: legacy() })).toEqual({
      path: legacy(),
      kind: 'legacy-only',
      canonical: canonical(),
      legacy: legacy(),
    });
  });

  it('both hold different keys → both-differ, the canonical path', () => {
    writeKey(legacy());
    writeKey(canonical());
    expect(resolvePersistedKeyFile({ env: { HOME: home }, legacyKeyFile: legacy() })).toMatchObject({
      path: canonical(),
      kind: 'both-differ',
      legacy: legacy(),
    });
  });

  it('a legacy file that IS the canonical file is no legacy file', () => {
    writeKey(canonical());
    expect(resolvePersistedKeyFile({ env: { HOME: home }, legacyKeyFile: canonical() })?.kind).toBe('canonical');
  });

  it('an unusable legacy file counts as absent, as the file tier reads it', () => {
    mkdirSync(other, { recursive: true });
    writeFileSync(legacy(), 'not-a-key');
    expect(resolvePersistedKeyFile({ env: { HOME: home }, legacyKeyFile: legacy() })?.kind).toBe('canonical');
  });

  it('undefined when an env key answers first', () => {
    writeKey(legacy());
    expect(resolvePersistedKeyFile({ env: { OS_SECRET_KEY: 'x' }, legacyKeyFile: legacy() })).toBeUndefined();
    expect(
      resolvePersistedKeyFile({ env: { OS_DEV_CRYPTO_KEY: randomBytes(32).toString('hex') }, legacyKeyFile: legacy() }),
    ).toBeUndefined();
    // An unusable dev key falls through to the file tier, so a file is named.
    expect(resolvePersistedKeyFile({ env: { HOME: home, OS_DEV_CRYPTO_KEY: 'short' } })?.kind).toBe('canonical');
  });
});

describe('#30042 — two key files: the boot takes the one that opens a stored secret', () => {
  let home: string;
  let other: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'os-30042-home-'));
    other = mkdtempSync(join(tmpdir(), 'os-30042-other-'));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const canonical = () => join(home, '.objectstack', 'dev-crypto-key');
  const legacy = () => join(other, 'dev-crypto-key');
  const writeKey = (file: string): Buffer => {
    const key = randomBytes(32);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, key.toString('base64'), { mode: 0o600 });
    return key;
  };
  const bothDiffer = (): PersistedKeyFile => ({
    path: canonical(),
    kind: 'both-differ',
    canonical: canonical(),
    legacy: legacy(),
  });
  /** A stored row as the reader returns it: sealed under `key` by the producer of `scope`. */
  const sealed = async (key: Buffer, scope: CryptoContextScope = 'settings'): Promise<StoredSecretSample> => {
    const h = await new LocalCryptoProvider({ key }).encrypt('sk-30042', { scope, namespace: 'ai', key: 'openai_api_key' });
    return { namespace: 'ai', key: 'openai_api_key', ciphertext: h.ciphertext };
  };
  /** A reader returning this page of stored rows, newest first. */
  const reader = (...page: StoredSecretSample[]) => async () => page;

  it('the case-1 shape: a start-sealed database with a foreign home key reads with the legacy key', async () => {
    writeKey(canonical()); // `os dev` in another project minted this one
    const startKey = writeKey(legacy());
    const choice = await chooseKeyFileByTrialOpen({
      answer: bothDiffer(),
      readStoredSecret: reader(await sealed(startKey)),
      mode: 'production',
    });
    expect(choice).toMatchObject({ path: legacy(), reason: 'opens', other: canonical() });
    expect(choice.notice?.level).toBe('warn');
    expect(choice.notice?.message).toContain(legacy());
    expect(choice.notice?.message).toContain(canonical());
  });

  it('the dev-then-start shape: a database the canonical key sealed keeps the canonical key', async () => {
    const devKey = writeKey(canonical());
    writeKey(legacy());
    const choice = await chooseKeyFileByTrialOpen({
      answer: bothDiffer(),
      readStoredSecret: reader(await sealed(devKey)),
      mode: 'production',
    });
    expect(choice).toMatchObject({ path: canonical(), reason: 'opens', other: legacy() });
  });

  it.each(CRYPTO_CONTEXT_SCOPES)('a row sealed by the %s producer is judged too (sys_secret records no scope)', async (scope) => {
    writeKey(canonical());
    const startKey = writeKey(legacy());
    const choice = await chooseKeyFileByTrialOpen({
      answer: bothDiffer(),
      readStoredSecret: reader(await sealed(startKey, scope)),
      mode: 'production',
    });
    expect(choice.path).toBe(legacy());
  });

  it('a key that opens nothing refuses a production boot, naming both paths', async () => {
    writeKey(canonical());
    writeKey(legacy());
    const elsewhere = await sealed(randomBytes(32));
    const refusal = await chooseKeyFileByTrialOpen({
      answer: bothDiffer(),
      readStoredSecret: reader(elsewhere),
      mode: 'production',
    }).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(DataKeyOpensNothingError);
    const message = (refusal as Error).message;
    // serve's secret-field wiring rethrows exactly this phrase as a boot refusal.
    expect(message).toContain('Refusing to start in production');
    expect(message).toContain(canonical());
    expect(message).toContain(legacy());
  });

  it.each(['development', 'test'] as const)('%s: a key that opens nothing is a boot ERROR naming both paths, on the canonical file', async (mode) => {
    writeKey(canonical());
    writeKey(legacy());
    const choice = await chooseKeyFileByTrialOpen({
      answer: bothDiffer(),
      readStoredSecret: reader(await sealed(randomBytes(32))),
      mode,
    });
    expect(choice).toMatchObject({ path: canonical(), reason: 'opens-nothing' });
    expect(choice.notice?.level).toBe('error');
    expect(choice.notice?.message).toContain(canonical());
    expect(choice.notice?.message).toContain(legacy());
  });

  it('no stored secret: nothing to judge, the canonical file stands', async () => {
    writeKey(canonical());
    writeKey(legacy());
    const choice = await chooseKeyFileByTrialOpen({ answer: bothDiffer(), readStoredSecret: reader(), mode: 'production' });
    expect(choice).toMatchObject({ path: canonical(), reason: 'no-stored-secret' });
  });

  it('a read that fails is no verdict: the canonical file, with a boot error naming the read', async () => {
    writeKey(canonical());
    writeKey(legacy());
    const choice = await chooseKeyFileByTrialOpen({
      answer: bothDiffer(),
      readStoredSecret: async () => {
        throw new Error('connection reset');
      },
      mode: 'production',
    });
    expect(choice).toMatchObject({ path: canonical(), reason: 'not-judged' });
    expect(choice.notice?.level).toBe('error');
    expect(choice.notice?.message).toContain('connection reset');
  });

  describe('#30091 — the trial scores both keys over the whole page, not its newest row', () => {
    it.each(['production', 'development'] as const)(
      '%s: rows split between the keys is a mixed-key boot ERROR naming both paths, on the key that opens more',
      async (mode) => {
        const canonicalKey = writeKey(canonical());
        const legacyKey = writeKey(legacy());
        // Newest first: the newest row is the canonical key's, the three older ones the legacy key's.
        const page = [await sealed(canonicalKey), await sealed(legacyKey), await sealed(legacyKey), await sealed(legacyKey)];
        const choice = await chooseKeyFileByTrialOpen({ answer: bothDiffer(), readStoredSecret: reader(...page), mode });
        expect(choice).toMatchObject({
          path: legacy(),
          reason: 'mixed',
          other: canonical(),
          tally: { judged: 4, chosen: 3, other: 1 },
        });
        expect(choice.notice?.level).toBe('error');
        expect(choice.notice?.message).toContain(canonical());
        expect(choice.notice?.message).toContain(legacy());
      },
    );

    it.each([
      ['canonical', 'legacy'],
      ['legacy', 'canonical'],
    ] as const)('a tie goes to the key that opens the newest row (%s newest)', async (newest, older) => {
      const keys = { canonical: writeKey(canonical()), legacy: writeKey(legacy()) };
      const files = { canonical: canonical(), legacy: legacy() };
      const choice = await chooseKeyFileByTrialOpen({
        answer: bothDiffer(),
        readStoredSecret: reader(await sealed(keys[newest]), await sealed(keys[older])),
        mode: 'production',
      });
      expect(choice).toMatchObject({ path: files[newest], reason: 'mixed', tally: { judged: 2, chosen: 1, other: 1 } });
    });

    it('a corrupt newest row no longer refuses a production boot: an older row settles the choice', async () => {
      writeKey(canonical());
      const startKey = writeKey(legacy());
      const corrupt = await sealed(randomBytes(32)); // opens under neither key
      const choice = await chooseKeyFileByTrialOpen({
        answer: bothDiffer(),
        readStoredSecret: reader(corrupt, await sealed(startKey), await sealed(startKey, 'object_secret_field')),
        mode: 'production',
      });
      expect(choice).toMatchObject({ path: legacy(), reason: 'opens', tally: { judged: 3, chosen: 2, other: 0 } });
      expect(choice.notice?.level).toBe('warn');
    });

    it('one key opening every judged row is `opens`, with the count it was measured on', async () => {
      const devKey = writeKey(canonical());
      writeKey(legacy());
      const choice = await chooseKeyFileByTrialOpen({
        answer: bothDiffer(),
        readStoredSecret: reader(await sealed(devKey), await sealed(devKey, 'datasource_credential')),
        mode: 'production',
      });
      expect(choice).toMatchObject({ path: canonical(), reason: 'opens', tally: { judged: 2, chosen: 2, other: 0 } });
    });

    it('a page where no row opens under either key keeps the production refusal, counting the page', async () => {
      writeKey(canonical());
      writeKey(legacy());
      const refusal = await chooseKeyFileByTrialOpen({
        answer: bothDiffer(),
        readStoredSecret: reader(await sealed(randomBytes(32)), await sealed(randomBytes(32))),
        mode: 'production',
      }).catch((e: unknown) => e);
      expect(refusal).toBeInstanceOf(DataKeyOpensNothingError);
      expect((refusal as DataKeyOpensNothingError).judged).toBe(2);
      expect((refusal as Error).message).toContain('Refusing to start in production');
    });

    it('settleKeyFileChannel: a mixed page settles on the majority key and says so as console.error, once', async () => {
      const canonicalKey = writeKey(canonical());
      const legacyKey = writeKey(legacy());
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const env: Record<string, string | undefined> = {
        NODE_ENV: 'production',
        [KEY_FILE_CHANNEL_ENV]: canonical(),
        [KEY_FILE_CANDIDATE_CHANNEL_ENV]: legacy(),
      };
      const page = [await sealed(legacyKey), await sealed(canonicalKey), await sealed(canonicalKey)];
      const choice = await settleKeyFileChannel({ env, readStoredSecret: reader(...page) });
      expect(choice).toMatchObject({ path: canonical(), reason: 'mixed' });
      expect(env[KEY_FILE_CHANNEL_ENV]).toBe(canonical());
      expect(env[KEY_FILE_CANDIDATE_CHANNEL_ENV]).toBeUndefined();
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0]?.[0])).toContain(legacy());
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it('every one-file answer passes through untried', async () => {
    const read = vi.fn(async () => [] as StoredSecretSample[]);
    for (const answer of [
      { path: canonical(), kind: 'canonical', canonical: canonical() },
      { path: legacy(), kind: 'legacy-only', canonical: canonical(), legacy: legacy() },
    ] as PersistedKeyFile[]) {
      expect(await chooseKeyFileByTrialOpen({ answer, readStoredSecret: read })).toEqual({ path: answer.path, reason: 'single' });
    }
    expect(read).not.toHaveBeenCalled();
  });

  it('settleKeyFileChannel points the channel at the chosen file, drops the candidate, and says so once', async () => {
    writeKey(canonical());
    const startKey = writeKey(legacy());
    const sample = await sealed(startKey);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env: Record<string, string | undefined> = {
      NODE_ENV: 'production',
      [KEY_FILE_CHANNEL_ENV]: canonical(),
      [KEY_FILE_CANDIDATE_CHANNEL_ENV]: legacy(),
    };
    const read = vi.fn(reader(sample));
    const [a, b] = await Promise.all([
      settleKeyFileChannel({ env, readStoredSecret: read }),
      settleKeyFileChannel({ env, readStoredSecret: read }),
    ]);
    expect(a?.path).toBe(legacy());
    expect(b).toBe(a);
    expect(read).toHaveBeenCalledTimes(1);
    expect(env[KEY_FILE_CHANNEL_ENV]).toBe(legacy());
    expect(env[KEY_FILE_CANDIDATE_CHANNEL_ENV]).toBeUndefined();
    expect(warn.mock.calls.filter(([m]) => String(m).includes(legacy()))).toHaveLength(1);
    expect(await settleKeyFileChannel({ env, readStoredSecret: read })).toBeUndefined();
    // A provider built after the settlement opens the stored secret.
    const handle = { id: 'x', kmsKeyId: 'local:v1', alg: 'aes-256-gcm', version: 1, ciphertext: sample.ciphertext };
    expect(await new LocalCryptoProvider({ env }).decrypt(handle, { scope: 'settings', namespace: 'ai', key: 'openai_api_key' })).toBe('sk-30042');
  });

  it('a production refusal leaves both channels as they were', async () => {
    writeKey(canonical());
    writeKey(legacy());
    const env: Record<string, string | undefined> = {
      NODE_ENV: 'production',
      [KEY_FILE_CHANNEL_ENV]: canonical(),
      [KEY_FILE_CANDIDATE_CHANNEL_ENV]: legacy(),
    };
    await expect(
      settleKeyFileChannel({ env, readStoredSecret: reader(await sealed(randomBytes(32))) }),
    ).rejects.toBeInstanceOf(DataKeyOpensNothingError);
    expect(env[KEY_FILE_CHANNEL_ENV]).toBe(canonical());
    expect(env[KEY_FILE_CANDIDATE_CHANNEL_ENV]).toBe(legacy());
  });

  it('development: neither key opens it → console.error, never a debug line', async () => {
    writeKey(canonical());
    writeKey(legacy());
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env: Record<string, string | undefined> = {
      NODE_ENV: 'development',
      [KEY_FILE_CHANNEL_ENV]: canonical(),
      [KEY_FILE_CANDIDATE_CHANNEL_ENV]: legacy(),
    };
    const choice = await settleKeyFileChannel({ env, readStoredSecret: reader(await sealed(randomBytes(32))) });
    expect(choice?.reason).toBe('opens-nothing');
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain(legacy());
  });

  it('nothing to settle without a candidate', async () => {
    const read = vi.fn(reader());
    expect(await settleKeyFileChannel({ env: { [KEY_FILE_CHANNEL_ENV]: canonical() }, readStoredSecret: read })).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it('a provider built before the settlement says so', () => {
    writeKey(canonical());
    writeKey(legacy());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new LocalCryptoProvider({
      env: { NODE_ENV: 'production', [KEY_FILE_CHANNEL_ENV]: canonical(), [KEY_FILE_CANDIDATE_CHANNEL_ENV]: legacy() },
    });
    expect(warn.mock.calls.some(([m]) => String(m).includes(legacy()) && String(m).includes('never tried'))).toBe(true);
  });

  it('deferredLocalCryptoProvider reads its options at first use, not at construction', async () => {
    const first = writeKey(canonical());
    const env: Record<string, string | undefined> = { NODE_ENV: 'production', [KEY_FILE_CHANNEL_ENV]: '/nowhere/yet' };
    const deferred = deferredLocalCryptoProvider(() => ({ env: { ...env } }));
    env[KEY_FILE_CHANNEL_ENV] = canonical();
    const h = await new LocalCryptoProvider({ key: first }).encrypt('v', ctx);
    expect(await deferred.decrypt(h, ctx)).toBe('v');
    expect(deferred.keySource).toBe('file');
    expect(deferred.resolve()).toBe(deferred.resolve());
  });
});

describe('#30042 — the reader over the engine', () => {
  const v2 = 'v2:' + randomBytes(40).toString('base64');
  it('reads the newest page as the system, keeps its order, and skips a marker the provider does not know', async () => {
    const older = 'v2:' + randomBytes(40).toString('base64');
    const find = vi.fn(async () => [
      { namespace: 'x', key: 'y', ciphertext: 'v9:abc' },
      { namespace: 'ai', key: 'openai_api_key', ciphertext: v2 },
      { namespace: 'mail', key: 'smtp_password', ciphertext: older },
    ]);
    expect(await storedSecretReaderOverEngine({ find })()).toEqual([
      { namespace: 'ai', key: 'openai_api_key', ciphertext: v2 },
      { namespace: 'mail', key: 'smtp_password', ciphertext: older },
    ]);
    expect(find).toHaveBeenCalledWith('sys_secret', expect.objectContaining({
      orderBy: [{ field: 'created_at', order: 'desc' }],
      context: { isSystem: true },
    }));
  });

  it('a table that does not exist holds no row; any other failure rejects', async () => {
    const missing = storedSecretReaderOverEngine({ find: async () => { throw new Error('no such table: sys_secret'); } });
    expect(await missing()).toEqual([]);
    const broken = storedSecretReaderOverEngine({ find: async () => { throw new Error('connection reset'); } });
    await expect(broken()).rejects.toThrow('connection reset');
  });
});

describe('#30042 — a leading `~` in OS_HOME is the home directory, as the CLI reads it', () => {
  it.each([
    ['~/pinned', join(homedir(), 'pinned', 'dev-crypto-key')],
    ['~', join(homedir(), 'dev-crypto-key')],
  ])('OS_HOME=%s', (value, file) => {
    expect(resolvePersistedKeyFile({ env: { OS_HOME: value } })?.canonical).toBe(file);
    expect(resolvePersistedKeyFile({ env: { OBJECTSTACK_HOME: value } })?.canonical).toBe(file);
  });
});

describe('LocalCryptoProvider — crypto semantics', () => {
  it('AAD binding rejects ciphertexts swapped across (namespace,key)', async () => {
    const p = new LocalCryptoProvider({ key: randomBytes(32) });
    const handle = await p.encrypt('value', { scope: 'settings', namespace: 'mail', key: 'api_key' });
    await expect(
      p.decrypt(handle, { scope: 'settings', namespace: 'mail', key: 'smtp_password' }),
    ).rejects.toThrow();
  });

  it('rotateKey bumps version while preserving plaintext + handle id', async () => {
    const p = new LocalCryptoProvider({ key: randomBytes(32) });
    const h1 = await p.encrypt('hello', ctx);
    const h2 = await p.rotateKey(h1, ctx);
    expect(h2.id).toBe(h1.id);
    expect(h2.version).toBe(h1.version + 1);
    expect(h2.ciphertext).not.toBe(h1.ciphertext);
    expect(await p.decrypt(h2, ctx)).toBe('hello');
  });

  it('digest is a non-reversible sha256 tag', () => {
    const p = new LocalCryptoProvider({ key: randomBytes(32) });
    const d = p.digest('super-secret');
    expect(d).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(d).not.toContain('super-secret');
  });
});

/**
 * ADR-0128 D1–D3 — the AAD is producer-discriminated (D1), delimiter-safe
 * (D2), built at the producer of the AAD with no consumer-side fallback (D3),
 * and every ciphertext records the derivation that sealed it.
 */
describe('LocalCryptoProvider — scoped, versioned AAD (ADR-0128)', () => {
  /** A fixed data key for the pinned vectors (bytes 0x00..0x1f). */
  const PINNED_KEY = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex');

  /**
   * Sealed by the provider as it stood BEFORE derivations were versioned
   * (`origin/main` at 3a6d92f78b), under `PINNED_KEY`, for
   * `('legacy_ns', 'legacy_key')`. It is the shape every handle already at
   * rest has: bare base64, no marker.
   */
  const LEGACY_HANDLE: CryptoHandle = {
    id: 'sec_0cab6d627ca4a3e44ee65398eb7f5a74',
    kmsKeyId: 'local:v1',
    alg: 'aes-256-gcm',
    version: 1,
    ciphertext: '3k1P9mqvLWg6LImhxsapht2tMnc7FTBzcM55GwNJxZVLooqJ8oPHsG8bb3DttWZrP0S/Ug==',
  };
  const LEGACY_PLAIN = 'sealed-before-versioning';

  /** Sealed by this derivation under `PINNED_KEY` — pins it against drift. */
  const V2_HANDLE: CryptoHandle = {
    id: 'sec_54a8311e4159cef5d286af80f028e727',
    kmsKeyId: 'local:v1',
    alg: 'aes-256-gcm',
    version: 1,
    ciphertext: 'v2:SNo5hjab0WpiNk/LLEwVv7OslY4okZxLjKGFi7mbc9CnTqNT/pxIBtZ6rRdKj4iS8P0=',
  };
  const V2_CTX: CryptoContext = { scope: 'settings', namespace: 'pinned_ns', key: 'pinned_key' };
  const V2_PLAIN = 'sealed-under-version-2';

  const at = (scope: CryptoContextScope, namespace = 'same_ns', key = 'same_key'): CryptoContext => ({
    scope,
    namespace,
    key,
  });

  it('seals every new ciphertext under the version-2 marker', async () => {
    const p = new LocalCryptoProvider({ key: randomBytes(32) });
    for (const scope of CRYPTO_CONTEXT_SCOPES) {
      const h = await p.encrypt('x', at(scope));
      expect(h.ciphertext.startsWith('v2:')).toBe(true);
      expect(h.ciphertext.slice(3)).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(await p.decrypt(h, at(scope))).toBe('x');
    }
  });

  it('opens a handle sealed before versioning with the derivation it was sealed with', async () => {
    // The pre-versioning blob is bare base64, which has no `:` — so it reads
    // as version 1 without any row being consulted.
    expect(LEGACY_HANDLE.ciphertext).not.toContain(':');
    const p = new LocalCryptoProvider({ key: PINNED_KEY });
    expect(
      await p.decrypt(LEGACY_HANDLE, { scope: 'settings', namespace: 'legacy_ns', key: 'legacy_key' }),
    ).toBe(LEGACY_PLAIN);
    // Version 1 still binds its (namespace, key): another coordinate fails.
    await expect(
      p.decrypt(LEGACY_HANDLE, { scope: 'settings', namespace: 'legacy_ns', key: 'other_key' }),
    ).rejects.toThrow();
  });

  it('opens a version-1 handle without binding the scope — the older guarantee, until re-wrapped', async () => {
    // Version 1 never had a scope, so it cannot bind one; this is the weaker
    // guarantee CryptoContext documents for pre-versioning ciphertext.
    const p = new LocalCryptoProvider({ key: PINNED_KEY });
    for (const scope of CRYPTO_CONTEXT_SCOPES) {
      expect(await p.decrypt(LEGACY_HANDLE, at(scope, 'legacy_ns', 'legacy_key'))).toBe(LEGACY_PLAIN);
    }
  });

  it('opens a pinned version-2 vector, so the derivation cannot drift under sealed data', async () => {
    const p = new LocalCryptoProvider({ key: PINNED_KEY });
    expect(await p.decrypt(V2_HANDLE, V2_CTX)).toBe(V2_PLAIN);
  });

  it('pins the version-2 AAD bytes: lead byte, label, then each component length-prefixed', () => {
    const aad = aadForVersion2({ scope: 'datasource_credential', namespace: 'datasource', key: 'reporting' });
    expect(aad.toString('hex')).toBe(
      'ff' +
        Buffer.from('objectstack/crypto-context-aad/v2', 'utf8').toString('hex') +
        '00000015' + Buffer.from('datasource_credential', 'utf8').toString('hex') +
        '0000000a' + Buffer.from('datasource', 'utf8').toString('hex') +
        '00000009' + Buffer.from('reporting', 'utf8').toString('hex'),
    );
    expect(aad.toString('hex')).toBe(
      'ff6f626a656374737461636b2f63727970746f2d636f6e746578742d6161642f76320000001564617461736f757263655f63726564656e7469616c0000000a64617461736f75726365000000097265706f7274696e67',
    );
  });

  it('D1: a ciphertext sealed under one scope does not open under any other, for the same (namespace, key)', async () => {
    const p = new LocalCryptoProvider({ key: randomBytes(32) });
    for (const sealedAs of CRYPTO_CONTEXT_SCOPES) {
      const h = await p.encrypt('scoped', at(sealedAs));
      for (const openedAs of CRYPTO_CONTEXT_SCOPES) {
        if (openedAs === sealedAs) {
          expect(await p.decrypt(h, at(openedAs))).toBe('scoped');
        } else {
          await expect(p.decrypt(h, at(openedAs))).rejects.toThrow();
        }
      }
    }
  });

  it('D2: two contexts whose unescaped join collides produce different AAD bytes and do not open each other', async () => {
    const left: CryptoContext = { scope: 'settings', namespace: 'a|b', key: 'c' };
    const right: CryptoContext = { scope: 'settings', namespace: 'a', key: 'b|c' };
    // The collision vector: an unescaped join cannot tell these apart.
    expect([left.scope, left.namespace, left.key].join('|')).toBe(
      [right.scope, right.namespace, right.key].join('|'),
    );
    expect(aadForVersion2(left).equals(aadForVersion2(right))).toBe(false);

    const p = new LocalCryptoProvider({ key: randomBytes(32) });
    const sealedLeft = await p.encrypt('left', left);
    const sealedRight = await p.encrypt('right', right);
    await expect(p.decrypt(sealedLeft, right)).rejects.toThrow();
    await expect(p.decrypt(sealedRight, left)).rejects.toThrow();
    expect(await p.decrypt(sealedLeft, left)).toBe('left');
    expect(await p.decrypt(sealedRight, right)).toBe('right');
  });

  it('refuses a derivation it does not know — fail closed, nothing else is tried', async () => {
    const p = new LocalCryptoProvider({ key: PINNED_KEY });
    const unknown = { ...V2_HANDLE, ciphertext: 'v3:' + V2_HANDLE.ciphertext.slice(3) };
    const refusal = p.decrypt(unknown, V2_CTX);
    await expect(refusal).rejects.toBeInstanceOf(UnknownCiphertextVersionError);
    await expect(refusal).rejects.toMatchObject({ marker: 'v3' });
    // Positive control: the same body under its own marker opens.
    expect(await p.decrypt(V2_HANDLE, V2_CTX)).toBe(V2_PLAIN);
  });

  it('a ciphertext presented under the other derivation never authenticates', async () => {
    const p = new LocalCryptoProvider({ key: PINNED_KEY });
    // A version-2 body with its marker removed reads as version 1 and fails.
    const stripped = { ...V2_HANDLE, ciphertext: V2_HANDLE.ciphertext.slice(3) };
    await expect(p.decrypt(stripped, V2_CTX)).rejects.toThrow();
    // A version-1 body with a version-2 marker added fails.
    const relabelled = { ...LEGACY_HANDLE, ciphertext: 'v2:' + LEGACY_HANDLE.ciphertext };
    await expect(
      p.decrypt(relabelled, { scope: 'settings', namespace: 'legacy_ns', key: 'legacy_key' }),
    ).rejects.toThrow();
  });

  it('rotateKey re-wraps a version-1 handle under version 2, bound to the scope', async () => {
    const p = new LocalCryptoProvider({ key: PINNED_KEY });
    const sealedFor = at('settings', 'legacy_ns', 'legacy_key');
    const rotated = await p.rotateKey(LEGACY_HANDLE, sealedFor);
    expect(rotated.id).toBe(LEGACY_HANDLE.id);
    expect(rotated.version).toBe(LEGACY_HANDLE.version + 1);
    expect(rotated.ciphertext.startsWith('v2:')).toBe(true);
    expect(await p.decrypt(rotated, sealedFor)).toBe(LEGACY_PLAIN);
    await expect(p.decrypt(rotated, at('object_secret_field', 'legacy_ns', 'legacy_key'))).rejects.toThrow();
  });

  it('refuses a context without a member of the closed scope set, on every entry point', async () => {
    const p = new LocalCryptoProvider({ key: randomBytes(32) });
    const sealed = await p.encrypt('x', at('settings'));
    const invalid = [
      { namespace: 'same_ns', key: 'same_key' },
      { scope: 'setting', namespace: 'same_ns', key: 'same_key' },
      { scope: '', namespace: 'same_ns', key: 'same_key' },
    ] as unknown as CryptoContext[];
    for (const bad of invalid) {
      await expect(p.encrypt('x', bad)).rejects.toBeInstanceOf(CryptoContextScopeError);
      await expect(p.decrypt(sealed, bad)).rejects.toBeInstanceOf(CryptoContextScopeError);
      await expect(p.decrypt(LEGACY_HANDLE, bad)).rejects.toBeInstanceOf(CryptoContextScopeError);
      await expect(p.rotateKey(sealed, bad)).rejects.toBeInstanceOf(CryptoContextScopeError);
    }
    // Positive control: the same calls with a member succeed.
    expect(await p.decrypt(sealed, at('settings'))).toBe('x');
    expect((await p.rotateKey(sealed, at('settings'))).ciphertext.startsWith('v2:')).toBe(true);
  });

  /**
   * ADR-0128 §4.2 — the reading the at-rest re-wrap classifies rows with. It
   * must agree with what `decrypt` dispatches on, so each status is pinned
   * against the provider's own behaviour on the same bytes, not against a
   * spelling of the marker.
   */
  it('ciphertextDerivationStatus reads the marker decrypt dispatches on, without opening anything', async () => {
    const p = new LocalCryptoProvider({ key: PINNED_KEY });
    const legacyCtx = at('settings', 'legacy_ns', 'legacy_key');

    // Version 1: opens today, and rotateKey moves it to the current derivation.
    expect(ciphertextDerivationStatus(LEGACY_HANDLE.ciphertext)).toBe('superseded');
    expect(await p.decrypt(LEGACY_HANDLE, legacyCtx)).toBe(LEGACY_PLAIN);
    const rotated = await p.rotateKey(LEGACY_HANDLE, legacyCtx);
    expect(ciphertextDerivationStatus(rotated.ciphertext)).toBe('current');

    // Version 2: the pinned vector and every fresh seal are current.
    expect(ciphertextDerivationStatus(V2_HANDLE.ciphertext)).toBe('current');
    for (const scope of CRYPTO_CONTEXT_SCOPES) {
      expect(ciphertextDerivationStatus((await p.encrypt('x', at(scope))).ciphertext)).toBe('current');
    }

    // Unknown: exactly the bytes decrypt refuses as an unknown derivation.
    const unknown = { ...V2_HANDLE, ciphertext: 'v3:' + V2_HANDLE.ciphertext.slice(3) };
    expect(ciphertextDerivationStatus(unknown.ciphertext)).toBe('unknown');
    await expect(p.decrypt(unknown, V2_CTX)).rejects.toBeInstanceOf(UnknownCiphertextVersionError);
    for (const notAString of [undefined, null, 42, { ciphertext: V2_HANDLE.ciphertext }]) {
      expect(ciphertextDerivationStatus(notAString)).toBe('unknown');
    }
  });

  it('ciphertextDerivationStatus is a statement about the marker, not a promise that the row opens', async () => {
    // A version-1 body sealed under ANOTHER key still reads `superseded`: only
    // opening it under its producer's context can say whether it is readable,
    // which is why the re-wrap opens every row before it writes one.
    const other = new LocalCryptoProvider({ key: randomBytes(32) });
    expect(ciphertextDerivationStatus(LEGACY_HANDLE.ciphertext)).toBe('superseded');
    await expect(
      other.decrypt(LEGACY_HANDLE, at('settings', 'legacy_ns', 'legacy_key')),
    ).rejects.toThrow();
  });
});

describe('LocalCryptoProvider — keyedDigest', () => {
  const KEYED_SHAPE = /^hmac-sha256:[0-9a-f]{64}$/;
  const input = 'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a';
  const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'os-crypto-keyed-'));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('is keyed: the output differs from the unkeyed SHA-256 of the same input', async () => {
    const p = new LocalCryptoProvider({ key: randomBytes(32) });
    const out = await p.keyedDigest(input);
    expect(out).toMatch(KEYED_SHAPE);
    expect(out).toHaveLength(76);
    const hexBody = out.slice('hmac-sha256:'.length);
    expect(hexBody).not.toBe(sha256Hex(input));
    expect(out).not.toBe(p.digest(input));
    expect(out).not.toContain(input);
  });

  it('is equal for equal input under one key — within an instance and across instances', async () => {
    const hex = randomBytes(32).toString('hex');
    const env = { NODE_ENV: 'production', OS_SECRET_KEY: hex, OS_HOME: home };
    const a = new LocalCryptoProvider({ env });
    // A second instance resolving the same key stands in for another process or node.
    const b = new LocalCryptoProvider({ env });
    expect(await a.keyedDigest(input)).toBe(await a.keyedDigest(input));
    expect(await b.keyedDigest(input)).toBe(await a.keyedDigest(input));
    // The same key spelled base64 is the same key.
    const c = new LocalCryptoProvider({
      env: { NODE_ENV: 'production', OS_SECRET_KEY: Buffer.from(hex, 'hex').toString('base64'), OS_HOME: home },
    });
    expect(await c.keyedDigest(input)).toBe(await a.keyedDigest(input));
    // Equal under one key is not constant under one key.
    expect(await a.keyedDigest(input + ' ')).not.toBe(await a.keyedDigest(input));
  });

  it('differs under a different key', async () => {
    const a = new LocalCryptoProvider({ key: randomBytes(32) });
    const b = new LocalCryptoProvider({ key: randomBytes(32) });
    expect(await a.keyedDigest(input)).not.toBe(await b.keyedDigest(input));
  });

  it('keys its MAC with a key derived from the data key, never with the data key itself', async () => {
    const key = randomBytes(32);
    const out = await new LocalCryptoProvider({ key }).keyedDigest(input);
    const underDataKey = createHmac('sha256', key).update(input, 'utf8').digest('hex');
    expect(out).toMatch(KEYED_SHAPE);
    expect(out.slice('hmac-sha256:'.length)).not.toBe(underDataKey);
  });

  it('answers a pinned vector, so builds on two nodes of one rolling deploy agree', async () => {
    // Vector computed outside this implementation (Python `hmac`): the MAC key is
    // HMAC-SHA-256(dataKey, label || 0x01), the output HMAC-SHA-256(macKey, input).
    const p = new LocalCryptoProvider({ key: Buffer.from(Array.from({ length: 32 }, (_, i) => i)) });
    expect(await p.keyedDigest('hello')).toBe(
      'hmac-sha256:de27f4140f1e5db4cdabc24d91dbf5eef67eeaaacd5fefa0aa491f283bdcded6',
    );
    expect(await p.keyedDigest(input)).toBe(
      'hmac-sha256:ac3e935526f452d6e230db8667e46422fdfe53800f70c13a70006576fae8a21b',
    );
  });

  it('is computed from whichever source resolved the data key', async () => {
    const key = randomBytes(32);
    const expected = await new LocalCryptoProvider({ key }).keyedDigest(input);

    const fromSecret = new LocalCryptoProvider({
      env: { NODE_ENV: 'production', OS_SECRET_KEY: key.toString('hex'), OS_HOME: home },
    });
    expect(fromSecret.keySource).toBe('env:OS_SECRET_KEY');
    expect(await fromSecret.keyedDigest(input)).toBe(expected);

    const fromDevKey = new LocalCryptoProvider({
      env: { NODE_ENV: 'development', OS_DEV_CRYPTO_KEY: key.toString('hex'), HOME: home },
    });
    expect(fromDevKey.keySource).toBe('env:OS_DEV_CRYPTO_KEY');
    expect(await fromDevKey.keyedDigest(input)).toBe(expected);

    mkdirSync(join(home, '.objectstack'), { recursive: true });
    writeFileSync(join(home, '.objectstack', 'dev-crypto-key'), key.toString('base64'), { mode: 0o600 });
    const fromFile = new LocalCryptoProvider({ env: { NODE_ENV: 'production', HOME: home } });
    expect(fromFile.keySource).toBe('file');
    expect(await fromFile.keyedDigest(input)).toBe(expected);

    const ephemeral = new LocalCryptoProvider({ env: { NODE_ENV: 'test', HOME: home } });
    expect(ephemeral.keySource).toBe('ephemeral');
    expect(await ephemeral.keyedDigest(input)).toMatch(KEYED_SHAPE);
  });

  it('a provider without key material refuses — it never falls back to an unkeyed digest', async () => {
    // The explicit-key route is the one source that is not length-checked, so it
    // is where an instance without usable key material can exist at all. The
    // positive control takes the same route with a real key.
    const control = new LocalCryptoProvider({ key: randomBytes(32) });
    expect(await control.keyedDigest(input)).toMatch(KEYED_SHAPE);

    for (const key of [Buffer.alloc(0), randomBytes(16)]) {
      const p = new LocalCryptoProvider({ key });
      expect(p.keySource).toBe('explicit');
      const refusal = p.keyedDigest(input);
      await expect(refusal).rejects.toBeInstanceOf(KeyedDigestKeyUnavailableError);
      await expect(refusal).rejects.toMatchObject({ keyLength: key.length });
    }
  });
});

describe('InMemoryCryptoProvider backward-compat alias', () => {
  it('is the same class as LocalCryptoProvider', () => {
    expect(InMemoryCryptoProvider).toBe(LocalCryptoProvider);
  });

  it('still constructs and round-trips', async () => {
    const p = new InMemoryCryptoProvider({ key: randomBytes(32) });
    const h = await p.encrypt('x', ctx);
    expect(await p.decrypt(h, ctx)).toBe('x');
  });
});
