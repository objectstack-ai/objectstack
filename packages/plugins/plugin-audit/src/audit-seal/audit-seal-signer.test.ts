// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createPublicKey, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AUDIT_SEALER_ACTOR, AUDIT_SIGNING_KEY_CHANGE_ACTION, buildAuditSigningKeyChangeRow } from '../audit-signing-key-audit.js';
import { bindingCrypto, memoryEngine } from './seal-store.testkit.js';
import { LocalCheckpointSigner, signingKeyFingerprint } from './signer.js';

/**
 * ADR-0154 D6 — the default checkpoint signer: one deployment Ed25519 key,
 * trusted only through its wrapped private half.
 */

const BYTES = new TextEncoder().encode('{"sequence":0}');

const publicKeyOf = (base64: string) =>
  createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(base64, 'base64').toString('base64url') }, format: 'jwk' });

function setup() {
  const store = memoryEngine([]);
  const crypto = bindingCrypto();
  return { ...store, crypto, signer: new LocalCheckpointSigner({ engine: store.engine, crypto }) };
}

describe('the first signature creates the deployment key (D6, Q4 (a))', () => {
  it('signs with a key whose public half verifies the signature and whose id is its fingerprint', async () => {
    const { signer, hot } = setup();
    expect(await signer.activeKeyId()).toBeNull();
    const { keyId, signature } = await signer.sign(BYTES);
    const [key] = hot.table('sys_audit_signing_key');
    expect(key).toMatchObject({ fingerprint: keyId, status: 'active' });
    expect(signingKeyFingerprint(Buffer.from(key.public_key as string, 'base64'))).toBe(keyId);
    expect(verify(null, BYTES, publicKeyOf(key.public_key as string), Buffer.from(signature, 'base64'))).toBe(true);
    expect(await signer.activeKeyId()).toBe(keyId);
  });

  it('seals the private half under its own fingerprint and writes its sys_secret row below the hooks', async () => {
    const { signer, hot, inserts, crypto } = setup();
    const { keyId } = await signer.sign(BYTES);
    expect(crypto.encrypts).toEqual([{ scope: 'audit_seal', namespace: 'sys_audit_signing_key', key: keyId }]);
    const [key] = hot.table('sys_audit_signing_key');
    expect(hot.creates.map((c) => c.object)).toEqual(['sys_secret']);
    expect(hot.table('sys_secret')).toEqual([expect.objectContaining({ id: key.private_handle, namespace: 'sys_audit_signing_key', key: keyId })]);
    expect(inserts.some((i) => i.object === 'sys_secret')).toBe(false);
  });

  it('writes the audit_signing_key_change row before the key row, naming the new fingerprint and no retired one', async () => {
    const { signer, inserts } = setup();
    const { keyId } = await signer.sign(BYTES);
    expect(inserts.map((i) => i.object)).toEqual(['sys_audit_log', 'sys_audit_signing_key']);
    expect(inserts[0].row).toMatchObject({ action: AUDIT_SIGNING_KEY_CHANGE_ACTION, actor: AUDIT_SEALER_ACTOR, tenant_id: null, user_id: null });
    expect(JSON.parse(inserts[0].row.metadata as string)).toEqual({ new_fingerprint: keyId, retired_fingerprint: null });
  });

  it('reuses the key on every later signature, writing nothing more', async () => {
    const { signer, inserts } = setup();
    const first = await signer.sign(BYTES);
    const second = await signer.sign(BYTES);
    expect(second.keyId).toBe(first.keyId);
    expect(inserts).toHaveLength(2);
  });

  it('drops the sealed private half when the ledger row does not land, and leaves no key', async () => {
    const { signer, hot, engine } = setup();
    const insert = engine.insert.bind(engine);
    engine.insert = async (object, row, options) => {
      if (object === 'sys_audit_log') throw new Error('no such table: sys_audit_log');
      return insert(object, row, options);
    };
    await expect(signer.sign(BYTES)).rejects.toThrow(/no such table/);
    expect(hot.table('sys_secret')).toEqual([]);
    expect(hot.table('sys_audit_signing_key')).toEqual([]);
  });
});

describe('a key row is trusted only through its wrapped private half (D6)', () => {
  it('vouches for a key whose private half opens and derives its public half', async () => {
    const { signer, hot } = setup();
    const { keyId } = await signer.sign(BYTES);
    expect(await signer.trustedPublicKey(keyId)).toBe(hot.table('sys_audit_signing_key')[0].public_key);
  });

  it('vouches for nothing, and signs nothing, once the row names another public key', async () => {
    const { signer, hot } = setup();
    const { keyId } = await signer.sign(BYTES);
    const other = setup();
    await other.signer.sign(BYTES);
    hot.table('sys_audit_signing_key')[0].public_key = other.hot.table('sys_audit_signing_key')[0].public_key;
    expect(await signer.trustedPublicKey(keyId)).toBeNull();
    await expect(signer.sign(BYTES)).rejects.toThrow(/derives another public key/);
  });

  it('vouches for nothing when the row is re-keyed (its half opens only under its own fingerprint) or the half is missing', async () => {
    const { signer, hot } = setup();
    const { keyId } = await signer.sign(BYTES);
    hot.table('sys_audit_signing_key')[0].fingerprint = 'f'.repeat(64);
    expect(await signer.trustedPublicKey('f'.repeat(64))).toBeNull();
    hot.table('sys_audit_signing_key')[0].fingerprint = keyId;
    expect(await signer.trustedPublicKey(keyId)).not.toBeNull();
    hot.table('sys_secret').length = 0;
    expect(await signer.trustedPublicKey(keyId)).toBeNull();
    expect(await signer.trustedPublicKey('0'.repeat(64))).toBeNull();
  });
});

describe('the audit_signing_key_change row', () => {
  it('refuses anything but a fingerprint, so no key material can reach the ledger', () => {
    expect(() => buildAuditSigningKeyChangeRow({ newFingerprint: 'MC4CAQAwBQYDK2VwBCIEI', retiredFingerprint: null })).toThrow(/64 lowercase hex/);
    expect(() => buildAuditSigningKeyChangeRow({ newFingerprint: 'a'.repeat(64), retiredFingerprint: 'B'.repeat(64) })).toThrow(/64 lowercase hex/);
    expect(JSON.parse(buildAuditSigningKeyChangeRow({ newFingerprint: 'a'.repeat(64), retiredFingerprint: 'b'.repeat(64) }).metadata as string))
      .toEqual({ new_fingerprint: 'a'.repeat(64), retired_fingerprint: 'b'.repeat(64) });
  });
});
