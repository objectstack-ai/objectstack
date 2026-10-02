// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
  LocalCryptoProvider,
  InMemoryCryptoProvider,
  KeyedDigestKeyUnavailableError,
} from './local-crypto-provider.js';

const ctx = { namespace: 'mail', key: 'api_key' };

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

describe('LocalCryptoProvider — crypto semantics', () => {
  it('AAD binding rejects ciphertexts swapped across (namespace,key)', async () => {
    const p = new LocalCryptoProvider({ key: randomBytes(32) });
    const handle = await p.encrypt('value', { namespace: 'mail', key: 'api_key' });
    await expect(
      p.decrypt(handle, { namespace: 'mail', key: 'smtp_password' }),
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
