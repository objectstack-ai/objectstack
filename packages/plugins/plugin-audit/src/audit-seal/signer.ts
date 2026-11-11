// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';
import type {
  AuditCheckpointSignature,
  CryptoContext,
  CryptoHandle,
  IAuditCheckpointSigner,
  ICryptoProvider,
} from '@objectstack/spec/contracts';
import { writeAuditSigningKeyChange } from '../audit-signing-key-audit.js';
import { AUDIT_SIGNING_KEY_OBJECT, signingKeyContext } from './seed.js';

/**
 * ADR-0154 D6 — the default `IAuditCheckpointSigner`: one deployment Ed25519
 * key, its public half a row of `sys_audit_signing_key`, its private half
 * persisted only as an `ICryptoProvider.encrypt` handle (a `sys_secret` row,
 * scope `audit_seal`, keyed by the key's own fingerprint).
 *
 * ⛔ A key row is trusted only through its wrapped private half. Every
 * signature and every `trustedPublicKey` answer first opens the private half
 * under the row's own fingerprint and derives the public half from it; a row
 * whose handle is missing, will not open, or derives another key signs nothing
 * and is vouched for by nothing.
 *
 * The first `sign` on a deployment with no active key creates one: the private
 * half is sealed and its `sys_secret` row written below the hooks, the
 * `audit_signing_key_change` ledger row is written, and only then the key row,
 * so a key nothing recorded never signs.
 */

/** What the signer reads and writes storage through: a slice of the ObjectQL engine. */
export interface SealStorageDriver {
  find(object: string, query: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  count?(object: string, query?: Record<string, unknown>): Promise<number>;
  create(object: string, row: Record<string, unknown>): Promise<unknown>;
  delete?(object: string, id: string): Promise<unknown>;
}

/** The engine surface the signer and the sealer use. */
export interface SealStorageEngine {
  insert(object: string, row: Record<string, unknown>, options: { context: { isSystem: true } }): Promise<unknown>;
  getDriverForObject(object: string): SealStorageDriver | undefined;
}

function driverFor(engine: SealStorageEngine, object: string): SealStorageDriver {
  const driver = engine.getDriverForObject(object);
  if (!driver) throw new Error(`no driver resolves for '${object}'`);
  return driver;
}

/**
 * Write the `sys_secret` row of a handle sealed under `audit_seal`, through the
 * driver: below the engine's hooks, so the audit writer records no row about
 * it and the sealer never seals its own writes (ruling 3d).
 */
export async function writeAuditSealSecret(engine: SealStorageEngine, handle: CryptoHandle, context: CryptoContext): Promise<void> {
  await driverFor(engine, 'sys_secret').create('sys_secret', {
    id: handle.id,
    namespace: context.namespace,
    key: context.key,
    kms_key_id: handle.kmsKeyId,
    alg: handle.alg,
    version: handle.version,
    ciphertext: handle.ciphertext,
    created_at: new Date().toISOString(),
  });
}

/** Remove a `sys_secret` row this producer wrote and no holder came to name. Best-effort; never throws. */
export async function dropAuditSealSecret(engine: SealStorageEngine, id: string): Promise<void> {
  try {
    await engine.getDriverForObject('sys_secret')?.delete?.('sys_secret', id);
  } catch {
    /* an unreferenced audit_seal row is what `os secret orphans` reports */
  }
}

/** The handle of a `sys_secret` row, or `null` when there is no such row. */
export async function readAuditSealSecret(engine: SealStorageEngine, id: string): Promise<CryptoHandle | null> {
  const [row] = await driverFor(engine, 'sys_secret').find('sys_secret', { where: { id }, limit: 1 });
  if (!row) return null;
  return {
    id: String(row.id),
    kmsKeyId: String(row.kms_key_id),
    alg: String(row.alg),
    version: Number(row.version),
    ciphertext: String(row.ciphertext),
  };
}

/** A key's fingerprint — its id: lowercase hex SHA-256 of the raw 32-byte public key. */
export function signingKeyFingerprint(rawPublicKey: Uint8Array): string {
  return createHash('sha256').update(rawPublicKey).digest('hex');
}

function rawPublicKeyOf(key: KeyObject): Buffer {
  const jwk = key.export({ format: 'jwk' }) as { x?: string };
  if (typeof jwk.x !== 'string') throw new Error('not an Ed25519 public key');
  return Buffer.from(jwk.x, 'base64url');
}

/** A `sys_audit_signing_key` row, as the signer reads it. */
interface SigningKeyRow {
  readonly fingerprint: string;
  readonly public_key: string;
  readonly private_handle: string;
}

function keyRowOf(row: Record<string, unknown> | undefined): SigningKeyRow | null {
  if (!row) return null;
  const { fingerprint, public_key, private_handle } = row;
  if (typeof fingerprint !== 'string' || typeof public_key !== 'string' || typeof private_handle !== 'string') return null;
  return { fingerprint, public_key, private_handle };
}

export interface LocalCheckpointSignerOptions {
  engine: SealStorageEngine;
  crypto: ICryptoProvider;
  now?: () => Date;
}

/** The default signer of ADR-0154 D6. */
export class LocalCheckpointSigner implements IAuditCheckpointSigner {
  constructor(private readonly options: LocalCheckpointSignerOptions) {}

  private keys(): SealStorageDriver {
    return driverFor(this.options.engine, AUDIT_SIGNING_KEY_OBJECT);
  }

  /** The id of the key the next `sign` uses, or `null` when the deployment has none yet. */
  async activeKeyId(): Promise<string | null> {
    return (await this.activeKey())?.fingerprint ?? null;
  }

  private async activeKey(): Promise<SigningKeyRow | null> {
    const rows = await this.keys().find(AUDIT_SIGNING_KEY_OBJECT, {
      where: { status: 'active' },
      orderBy: [{ field: 'created_at', order: 'desc' }],
      limit: 1,
    });
    return keyRowOf(rows[0]);
  }

  /**
   * The private half of `key`, opened under the key's own fingerprint, and
   * only when it derives exactly the row's public half and fingerprint.
   */
  private async openPrivateHalf(key: SigningKeyRow): Promise<KeyObject> {
    const handle = await readAuditSealSecret(this.options.engine, key.private_handle);
    if (!handle) throw new Error(`audit signing key ${key.fingerprint}: its wrapped private half is missing`);
    const pkcs8 = await this.options.crypto.decrypt(handle, signingKeyContext(key.fingerprint));
    const privateKey = createPrivateKey({ key: Buffer.from(pkcs8, 'base64'), format: 'der', type: 'pkcs8' });
    if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error(`audit signing key ${key.fingerprint}: not an Ed25519 key`);
    const raw = rawPublicKeyOf(createPublicKey(privateKey));
    if (raw.toString('base64') !== key.public_key || signingKeyFingerprint(raw) !== key.fingerprint) {
      throw new Error(`audit signing key ${key.fingerprint}: its private half derives another public key`);
    }
    return privateKey;
  }

  /** Create the deployment's key: sealed private half, the ledger row, then the key row. */
  private async createKey(): Promise<SigningKeyRow> {
    const { engine, crypto } = this.options;
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const raw = rawPublicKeyOf(publicKey);
    const fingerprint = signingKeyFingerprint(raw);
    const context = signingKeyContext(fingerprint);
    const pkcs8 = (privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer).toString('base64');
    const handle = await crypto.encrypt(pkcs8, context);
    await writeAuditSealSecret(engine, handle, context);
    const key: SigningKeyRow = { fingerprint, public_key: raw.toString('base64'), private_handle: handle.id };
    try {
      await writeAuditSigningKeyChange(engine, { newFingerprint: fingerprint, retiredFingerprint: null });
    } catch (err) {
      await dropAuditSealSecret(engine, handle.id); // no key row was attempted, so nothing names the half
      throw err;
    }
    try {
      await engine.insert(AUDIT_SIGNING_KEY_OBJECT, {
        id: randomUUID(),
        ...key,
        status: 'active',
        created_at: (this.options.now?.() ?? new Date()).toISOString(),
        retired_at: null,
      }, { context: { isSystem: true } });
    } catch (err) {
      // M1: an insert can reject after its row is stored, so the half is kept either way: an active key
      // row naming a dropped half would stop all signing. Unstored, it is an orphan for `os secret orphans`.
      const [stored] = await this.keys().find(AUDIT_SIGNING_KEY_OBJECT, { where: { fingerprint }, limit: 1 }).catch(() => []);
      if (keyRowOf(stored)?.private_handle !== handle.id) throw err;
    }
    return key;
  }

  async sign(bytes: Uint8Array): Promise<AuditCheckpointSignature> {
    const key = (await this.activeKey()) ?? (await this.createKey());
    const privateKey = await this.openPrivateHalf(key);
    return { keyId: key.fingerprint, signature: sign(null, bytes, privateKey).toString('base64') };
  }

  async trustedPublicKey(keyId: string): Promise<string | null> {
    const rows = await this.keys().find(AUDIT_SIGNING_KEY_OBJECT, { where: { fingerprint: keyId }, limit: 1 });
    const key = keyRowOf(rows[0]);
    if (!key) return null;
    try {
      await this.openPrivateHalf(key);
      return key.public_key;
    } catch {
      return null;
    }
  }
}
