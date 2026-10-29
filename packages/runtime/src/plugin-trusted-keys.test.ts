// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The trusted-key store (ADR-0025 §3.5 M1), driven against a REAL engine over
 * a real SQLite file holding the real `sys_trusted_key` definition — never a
 * hand-written double, whose looser `find` / `update` would let a refusal the
 * engine makes read as green.
 *
 * Pinned: a private-key or non-Ed25519 PEM never becomes a row; one key id
 * names one key and one key carries one key id; a revoked row stays, and
 * neither its key id nor its key is trusted again; resolution hands back a key
 * only for an active row whose fingerprint is its public key's.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { generateEd25519KeyPair, signPayload, verifyPayload } from '@objectstack/core';
import { SysTrustedKey } from '@objectstack/platform-objects/system';

import {
  TRUSTED_KEY_OBJECT,
  addTrustedKey,
  listTrustedKeys,
  publicKeyFingerprint,
  readPublisherPublicKey,
  resolveTrustedKey,
  revokeTrustedKey,
  type TrustedKeyEngine,
} from './plugin-trusted-keys.js';

const SYSTEM = { context: { isSystem: true } };

let dir: string;
let driver: SqlDriver;
let engine: ObjectQL;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-trusted-keys-'));
  driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'data.sqlite') }, useNullAsDefault: true });
  await driver.initObjects([SysTrustedKey] as any[]);
  engine = new ObjectQL();
  engine.registerDriver(driver as any, true);
  await engine.init();
  engine.registry.registerObject(SysTrustedKey as any, 'com.objectstack.platform-objects');
});

afterEach(async () => {
  await driver.disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const store = (): TrustedKeyEngine => engine as unknown as TrustedKeyEngine;

function freshKey(): { publicKeyPem: string; privateKeyPem: string; fingerprint: string } {
  const pair = generateEd25519KeyPair();
  const read = readPublisherPublicKey(pair.publicKeyPem);
  if (!read.ok) throw new Error(read.message);
  return { ...pair, fingerprint: read.fingerprint };
}

async function rowCount(): Promise<number> {
  return (await engine.find(TRUSTED_KEY_OBJECT, {}, SYSTEM)).length;
}

describe('readPublisherPublicKey', () => {
  it('reads an Ed25519 SPKI PEM and fingerprints its DER bytes', () => {
    const { publicKeyPem } = generateEd25519KeyPair();
    const read = readPublisherPublicKey(publicKeyPem);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
    expect(read.fingerprint).toBe(`sha256:${createHash('sha256').update(der).digest('hex')}`);
    expect(read.fingerprint).toBe(publicKeyFingerprint(createPublicKey(publicKeyPem)));
  });

  it('refuses a PRIVATE-key PEM by name instead of deriving its public half', () => {
    const { privateKeyPem } = generateEd25519KeyPair();
    // The control: node itself would happily derive a public key from it.
    expect(createPublicKey(privateKeyPem).asymmetricKeyType).toBe('ed25519');
    const read = readPublisherPublicKey(privateKeyPem);
    expect(read).toMatchObject({ ok: false, reason: 'private-key' });
  });

  it('refuses a public key that is not Ed25519, naming its type', () => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const read = readPublisherPublicKey(publicKey.export({ type: 'spki', format: 'pem' }).toString());
    expect(read).toMatchObject({ ok: false, reason: 'wrong-algorithm' });
    if (!read.ok) expect(read.message).toContain("'rsa'");
  });

  it('refuses text that is not a key', () => {
    expect(readPublisherPublicKey('not a pem')).toMatchObject({ ok: false, reason: 'unreadable' });
  });
});

describe('addTrustedKey / revokeTrustedKey', () => {
  it('adds an active local row, and the same key under the same id again writes nothing', async () => {
    const k = freshKey();
    const first = await addTrustedKey(store(), { keyId: 'acme-2026', publicKeyPem: k.publicKeyPem, fingerprint: k.fingerprint, addedBy: 'dev' });
    expect(first).toMatchObject({ outcome: 'added', row: { key_id: 'acme-2026', status: 'active', source: 'local', added_by: 'dev' } });
    const again = await addTrustedKey(store(), { keyId: 'acme-2026', publicKeyPem: k.publicKeyPem, fingerprint: k.fingerprint, addedBy: 'dev' });
    expect(again.outcome).toBe('already-trusted');
    expect(await rowCount()).toBe(1);
    const [row] = await listTrustedKeys(store());
    expect(row).toMatchObject({ key_id: 'acme-2026', fingerprint: k.fingerprint, status: 'active' });
  });

  it('refuses a key id that a signature string could not carry, before any write', async () => {
    const k = freshKey();
    const result = await addTrustedKey(store(), { keyId: 'acme:2026', publicKeyPem: k.publicKeyPem, fingerprint: k.fingerprint, addedBy: null });
    expect(result).toMatchObject({ outcome: 'refused', reason: 'key-id-invalid' });
    expect(await rowCount()).toBe(0);
  });

  it('one key id names one key: a different key under a taken id is refused', async () => {
    const a = freshKey();
    const b = freshKey();
    await addTrustedKey(store(), { keyId: 'acme', publicKeyPem: a.publicKeyPem, fingerprint: a.fingerprint, addedBy: null });
    const result = await addTrustedKey(store(), { keyId: 'acme', publicKeyPem: b.publicKeyPem, fingerprint: b.fingerprint, addedBy: null });
    expect(result).toMatchObject({ outcome: 'refused', reason: 'key-id-taken' });
    expect(await rowCount()).toBe(1);
  });

  it('one key carries one key id: the same key under a second id is refused', async () => {
    const a = freshKey();
    await addTrustedKey(store(), { keyId: 'acme', publicKeyPem: a.publicKeyPem, fingerprint: a.fingerprint, addedBy: null });
    const result = await addTrustedKey(store(), { keyId: 'acme-two', publicKeyPem: a.publicKeyPem, fingerprint: a.fingerprint, addedBy: null });
    expect(result).toMatchObject({ outcome: 'refused', reason: 'key-trusted-under-another-id' });
    expect(await rowCount()).toBe(1);
  });

  it('revoking keeps the row; neither the key id nor the key is trusted again', async () => {
    const a = freshKey();
    await addTrustedKey(store(), { keyId: 'acme', publicKeyPem: a.publicKeyPem, fingerprint: a.fingerprint, addedBy: null });
    expect(await revokeTrustedKey(store(), 'acme')).toMatchObject({ outcome: 'revoked', row: { status: 'revoked' } });
    expect(await revokeTrustedKey(store(), 'acme')).toMatchObject({ outcome: 'already-revoked' });
    const [row] = await listTrustedKeys(store());
    expect(row).toMatchObject({ key_id: 'acme', status: 'revoked', fingerprint: a.fingerprint });

    const b = freshKey();
    expect(await addTrustedKey(store(), { keyId: 'acme', publicKeyPem: b.publicKeyPem, fingerprint: b.fingerprint, addedBy: null }))
      .toMatchObject({ outcome: 'refused', reason: 'key-id-revoked' });
    expect(await addTrustedKey(store(), { keyId: 'acme-new', publicKeyPem: a.publicKeyPem, fingerprint: a.fingerprint, addedBy: null }))
      .toMatchObject({ outcome: 'refused', reason: 'key-revoked' });
    expect(await rowCount()).toBe(1);
  });

  it('the table itself holds both rules when a write goes around the store (two adds racing)', async () => {
    const a = freshKey();
    const b = freshKey();
    const row = (keyId: string, k: { publicKeyPem: string; fingerprint: string }) => ({
      key_id: keyId,
      public_key: k.publicKeyPem,
      fingerprint: k.fingerprint,
      source: 'local',
      status: 'active',
      added_by: null,
      added_at: new Date().toISOString(),
    });
    await engine.insert(TRUSTED_KEY_OBJECT, row('acme', a), SYSTEM);
    // The same key under a second id, and a second key under the same id.
    await expect(engine.insert(TRUSTED_KEY_OBJECT, row('acme-2', a), SYSTEM)).rejects.toThrow();
    await expect(engine.insert(TRUSTED_KEY_OBJECT, row('acme', b), SYSTEM)).rejects.toThrow();
    // Control: a second key under a second id is a second row.
    await engine.insert(TRUSTED_KEY_OBJECT, row('acme-2', b), SYSTEM);
    expect(await rowCount()).toBe(2);
  });

  it('refuses to revoke a key id it does not hold', async () => {
    expect(await revokeTrustedKey(store(), 'nobody')).toMatchObject({ outcome: 'refused', reason: 'key-id-unknown' });
  });
});

describe('resolveTrustedKey', () => {
  it('hands back the key of an active row, and that key verifies what its private half signed', async () => {
    const k = freshKey();
    await addTrustedKey(store(), { keyId: 'acme', publicKeyPem: k.publicKeyPem, fingerprint: k.fingerprint, addedBy: null });
    const resolved = await resolveTrustedKey(store(), 'acme');
    expect(resolved.verdict).toBe('active');
    if (resolved.verdict !== 'active') return;
    const bytes = new TextEncoder().encode('artifact bytes');
    expect(verifyPayload(bytes, signPayload(bytes, k.privateKeyPem, 'acme'), resolved.publicKey)).toBe(true);
  });

  it('answers unknown for a key id with no row, and revoked for a revoked one', async () => {
    expect(await resolveTrustedKey(store(), 'acme')).toEqual({ verdict: 'unknown' });
    const k = freshKey();
    await addTrustedKey(store(), { keyId: 'acme', publicKeyPem: k.publicKeyPem, fingerprint: k.fingerprint, addedBy: null });
    await revokeTrustedKey(store(), 'acme');
    expect(await resolveTrustedKey(store(), 'acme')).toMatchObject({ verdict: 'revoked' });
  });

  it('refuses a row whose stored fingerprint is not its public key\'s, rather than verifying with it', async () => {
    const k = freshKey();
    const other = freshKey();
    // A row written past the store: one key's PEM under another key's fingerprint.
    await engine.insert(TRUSTED_KEY_OBJECT, {
      key_id: 'acme',
      public_key: other.publicKeyPem,
      fingerprint: k.fingerprint,
      source: 'local',
      status: 'active',
      added_by: null,
      added_at: new Date().toISOString(),
    }, SYSTEM);
    const resolved = await resolveTrustedKey(store(), 'acme');
    expect(resolved.verdict).toBe('invalid');
    // Anti-vacuity: the PEM itself is a good Ed25519 key, so only the
    // fingerprint comparison can have refused it.
    expect(readPublisherPublicKey(other.publicKeyPem).ok).toBe(true);
    // And a signature by the key the PEM holds would verify, had it been used.
    const bytes = new TextEncoder().encode('x');
    expect(verifyPayload(bytes, `ed25519:acme:${sign(null, bytes, other.privateKeyPem).toString('base64url')}`, other.publicKeyPem)).toBe(true);
  });
});
