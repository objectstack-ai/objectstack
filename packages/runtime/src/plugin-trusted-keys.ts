// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The environment's trusted plugin-publisher keys — reads and writes of the
 * `sys_trusted_key` platform object (ADR-0025 §3.5 M1, ruling B′ on the M1
 * install card).
 *
 * `os plugin trust add | list | revoke` write and list the store, and
 * `os plugin install` resolves an artifact signature's key id in it
 * ({@link resolveTrustedKey}). Every call takes an engine-shaped handle so the
 * CLI's one-shot boot and the runtime's own boot read one implementation.
 *
 * Rules the store keeps, whoever calls it:
 *
 *  - **Public keys only.** {@link readPublisherPublicKey} refuses a private-key
 *    PEM by name instead of deriving its public half: a private key never
 *    enters the platform (ADR-0025 §7).
 *  - **Ed25519 only**, the one algorithm plugin artifact signatures use
 *    (`SIGNATURE_ALG` in `@objectstack/core`).
 *  - **A key id is never reused.** Adding a different key under a key id the
 *    store already holds is refused, revoked rows included, so a revoked key
 *    cannot return under its old handle and one handle never names two keys.
 *  - **A revoked row stays.** Revoking flips `status`; nothing deletes a row
 *    or re-activates it.
 *  - **The row is re-checked on read.** {@link resolveTrustedKey} recomputes
 *    the fingerprint from `public_key` and refuses a row whose stored
 *    fingerprint disagrees, rather than verifying with a key the row does not
 *    describe.
 */
import { createHash, createPublicKey, type KeyObject } from 'node:crypto';

import { SIGNATURE_ALG } from '@objectstack/core';

/** The platform object the trusted keys live in. */
export const TRUSTED_KEY_OBJECT = 'sys_trusted_key';

/**
 * A key id the store accepts: 1–128 letters, digits, `.`, `_` or `-`. A
 * signature string is `ed25519:KEYID:SIG`, so a key id can never hold `:`
 * (`signPayload` refuses one too).
 */
export const TRUSTED_KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export type TrustedKeyStatus = 'active' | 'revoked';
export type TrustedKeySource = 'local' | 'platform' | 'cloud';

/** One `sys_trusted_key` row, as the store reads it. */
export interface TrustedKeyRow {
  id?: string;
  key_id: string;
  public_key: string;
  fingerprint: string;
  source: TrustedKeySource;
  status: TrustedKeyStatus;
  added_by: string | null;
  added_at: string;
}

/** The engine calls this store makes. `IObjectQLEngine` satisfies it. */
export interface TrustedKeyEngine {
  find(object: string, query?: Record<string, unknown>, options?: Record<string, unknown>): Promise<any[]>;
  insert(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  update(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

const SYSTEM = { context: { isSystem: true } } as const;

/** `sha256:` + the lowercase hex sha256 of the key's SPKI DER bytes. */
export function publicKeyFingerprint(key: KeyObject): string {
  const der = key.export({ type: 'spki', format: 'der' });
  return `sha256:${createHash('sha256').update(der).digest('hex')}`;
}

/** The outcome of reading a PEM handed to `os plugin trust add`. */
export type PublisherKeyRead =
  | { ok: true; publicKeyPem: string; fingerprint: string }
  | { ok: false; reason: 'private-key' | 'unreadable' | 'wrong-algorithm'; message: string };

/**
 * Read a publisher PUBLIC key from PEM text: refuse a private key by name,
 * refuse anything that is not Ed25519, and normalize the rest to SPKI PEM
 * with its fingerprint.
 */
export function readPublisherPublicKey(pem: string): PublisherKeyRead {
  // createPublicKey() happily derives a public key from a PRIVATE-key PEM, so
  // the label is checked first: that input is refused, never converted.
  if (/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/.test(pem)) {
    return {
      ok: false,
      reason: 'private-key',
      message:
        'This PEM holds a PRIVATE key. Only a publisher PUBLIC key is ever trusted, and a private key never enters '
        + 'the platform: pass the `.pub.pem` file `os plugin keygen` wrote, and keep the `.key.pem` file to yourself.',
    };
  }
  let key: KeyObject;
  try {
    key = createPublicKey(pem);
  } catch (error) {
    return {
      ok: false,
      reason: 'unreadable',
      message: `This is not a readable public-key PEM (${(error as Error).message}). Pass the SPKI \`.pub.pem\` file \`os plugin keygen\` wrote.`,
    };
  }
  if (key.asymmetricKeyType !== SIGNATURE_ALG) {
    return {
      ok: false,
      reason: 'wrong-algorithm',
      message:
        `This public key is of type '${String(key.asymmetricKeyType)}', but plugin artifact signatures are `
        + `'${SIGNATURE_ALG}' only. Generate an Ed25519 pair with \`os plugin keygen\`.`,
    };
  }
  return {
    ok: true,
    publicKeyPem: key.export({ type: 'spki', format: 'pem' }).toString(),
    fingerprint: publicKeyFingerprint(key),
  };
}

function toRow(raw: Record<string, unknown>): TrustedKeyRow {
  return {
    id: raw.id == null ? undefined : String(raw.id),
    key_id: String(raw.key_id ?? ''),
    public_key: String(raw.public_key ?? ''),
    fingerprint: String(raw.fingerprint ?? ''),
    source: String(raw.source ?? '') as TrustedKeySource,
    status: String(raw.status ?? '') as TrustedKeyStatus,
    added_by: raw.added_by == null ? null : String(raw.added_by),
    added_at: raw.added_at == null ? '' : String(raw.added_at),
  };
}

/** Every trusted-key row in the environment, revoked rows included, by key id. */
export async function listTrustedKeys(engine: TrustedKeyEngine): Promise<TrustedKeyRow[]> {
  const rows = await engine.find(TRUSTED_KEY_OBJECT, { orderBy: [{ field: 'key_id' }] }, SYSTEM);
  return rows.map((r) => toRow(r as Record<string, unknown>));
}

async function findByKeyId(engine: TrustedKeyEngine, keyId: string): Promise<TrustedKeyRow | null> {
  const rows = await engine.find(TRUSTED_KEY_OBJECT, { where: { key_id: keyId } }, SYSTEM);
  const exact = rows.map((r) => toRow(r as Record<string, unknown>)).filter((r) => r.key_id === keyId);
  return exact[0] ?? null;
}

export type AddTrustedKeyResult =
  | { outcome: 'added' | 'already-trusted'; row: TrustedKeyRow }
  | { outcome: 'refused'; reason: 'key-id-invalid' | 'key-id-taken' | 'key-id-revoked'; message: string; row?: TrustedKeyRow };

/**
 * Add `publicKeyPem` (already read by {@link readPublisherPublicKey}) as an
 * active `local` key under `keyId`. The same key under the same id again is
 * `already-trusted` and writes nothing.
 */
export async function addTrustedKey(
  engine: TrustedKeyEngine,
  input: { keyId: string; publicKeyPem: string; fingerprint: string; addedBy: string | null; now?: Date },
): Promise<AddTrustedKeyResult> {
  const { keyId } = input;
  if (!TRUSTED_KEY_ID_PATTERN.test(keyId)) {
    return {
      outcome: 'refused',
      reason: 'key-id-invalid',
      message: `Key id ${JSON.stringify(keyId)} is not allowed: use 1-128 letters, digits, '.', '_' or '-' (the id \`os plugin sign --key-id\` embeds).`,
    };
  }
  const existing = await findByKeyId(engine, keyId);
  if (existing) {
    if (existing.status === 'revoked') {
      return {
        outcome: 'refused',
        reason: 'key-id-revoked',
        row: existing,
        message:
          `Key id '${keyId}' was revoked in this environment, and a revoked key id is never trusted again. `
          + 'Sign with a new key id (`os plugin sign --key-id NEW_ID`) and trust the key under that id.',
      };
    }
    if (existing.fingerprint === input.fingerprint) return { outcome: 'already-trusted', row: existing };
    return {
      outcome: 'refused',
      reason: 'key-id-taken',
      row: existing,
      message:
        `Key id '${keyId}' already names a different trusted key (${existing.fingerprint}). One key id names one key: `
        + 'choose a new key id for this key, or revoke the old one first (`os plugin trust revoke`).',
    };
  }
  const row: TrustedKeyRow = {
    key_id: keyId,
    public_key: input.publicKeyPem,
    fingerprint: input.fingerprint,
    source: 'local',
    status: 'active',
    added_by: input.addedBy,
    added_at: (input.now ?? new Date()).toISOString(),
  };
  await engine.insert(TRUSTED_KEY_OBJECT, { ...row }, SYSTEM);
  return { outcome: 'added', row };
}

export type RevokeTrustedKeyResult =
  | { outcome: 'revoked' | 'already-revoked'; row: TrustedKeyRow }
  | { outcome: 'refused'; reason: 'key-id-unknown'; message: string };

/** Revoke the key under `keyId`. The row stays, with `status: 'revoked'`. */
export async function revokeTrustedKey(engine: TrustedKeyEngine, keyId: string): Promise<RevokeTrustedKeyResult> {
  const existing = await findByKeyId(engine, keyId);
  if (!existing) {
    return {
      outcome: 'refused',
      reason: 'key-id-unknown',
      message: `No trusted key has key id '${keyId}' in this environment, so there is nothing to revoke. \`os plugin trust list\` shows the ids.`,
    };
  }
  if (existing.status === 'revoked') return { outcome: 'already-revoked', row: existing };
  await engine.update(TRUSTED_KEY_OBJECT, { id: existing.id, status: 'revoked' }, SYSTEM);
  return { outcome: 'revoked', row: { ...existing, status: 'revoked' } };
}

export type TrustedKeyResolution =
  | { verdict: 'active'; row: TrustedKeyRow; publicKey: KeyObject }
  | { verdict: 'revoked'; row: TrustedKeyRow }
  | { verdict: 'unknown' }
  | { verdict: 'invalid'; row: TrustedKeyRow; message: string };

/**
 * Resolve the key a signature names. Only an `active` row whose public key is
 * an Ed25519 key matching its stored fingerprint yields a key to verify with.
 */
export async function resolveTrustedKey(engine: TrustedKeyEngine, keyId: string): Promise<TrustedKeyResolution> {
  const row = await findByKeyId(engine, keyId);
  if (!row) return { verdict: 'unknown' };
  if (row.status === 'revoked') return { verdict: 'revoked', row };
  if (row.status !== 'active') {
    return { verdict: 'invalid', row, message: `its status is '${row.status}', neither 'active' nor 'revoked'` };
  }
  const read = readPublisherPublicKey(row.public_key);
  if (!read.ok) return { verdict: 'invalid', row, message: `its public_key cannot be used: ${read.message}` };
  if (read.fingerprint !== row.fingerprint) {
    return {
      verdict: 'invalid',
      row,
      message: `its stored fingerprint ${row.fingerprint} is not the fingerprint of its public_key (${read.fingerprint})`,
    };
  }
  return { verdict: 'active', row, publicKey: createPublicKey(read.publicKeyPem) };
}
