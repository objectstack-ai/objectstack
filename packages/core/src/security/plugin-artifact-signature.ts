// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Plugin artifact signing & verification (ADR-0025 §3.4–§3.7, framework F3).
 *
 * This is the CANONICAL Ed25519 detached-signature contract shared by the
 * whole plugin distribution pipeline. It is intentionally byte-for-byte
 * compatible with the cloud control plane's `package-signing.ts` so the
 * two never drift:
 *
 *   - signature string format: `ed25519:<keyId>:<base64url(signature)>`
 *   - publisher signature: Ed25519 over the raw `.osplugin` artifact bytes,
 *     produced by `os plugin sign`, verified by cloud at publish time and by
 *     the runtime when it materializes the artifact.
 *   - platform counter-signature: Ed25519 over {@link counterSignPayload}
 *     (the version identity), produced by cloud at approval, verified by the
 *     runtime at load time as the marketplace's "reviewed + approved" attest.
 *
 * Algorithm: Ed25519 via node:crypto (`sign(null, …)` / `verify(null, …)`):
 * short, deterministic, no padding ambiguity. The `keyId` is an opaque
 * rotation handle used to resolve the verifying public key.
 *
 * The two trust chains the runtime checks before loading a third-party
 * plugin are combined in {@link verifyPluginArtifact}.
 */

import {
  sign as cryptoSign,
  verify as cryptoVerify,
  createPublicKey,
  createPrivateKey,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto';

export const SIGNATURE_ALG = 'ed25519';
const SIG_PREFIX = 'ed25519:';

export type KeyInput = string | KeyObject;

function toPrivateKey(key: KeyInput): KeyObject {
  return typeof key === 'string' ? createPrivateKey(key) : key;
}
function toPublicKey(key: KeyInput): KeyObject {
  return typeof key === 'string' ? createPublicKey(key) : key;
}
function toBytes(payload: string | Uint8Array): Uint8Array {
  return typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
}

/** Generate an Ed25519 keypair as PEM strings (publisher bootstrap / tests). */
export function generateEd25519KeyPair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

/**
 * Sign `payload` with an Ed25519 private key, returning the formatted
 * signature string `ed25519:<keyId>:<base64url(sig)>`.
 */
export function signPayload(
  payload: string | Uint8Array,
  privateKey: KeyInput,
  keyId = 'default',
): string {
  if (keyId.includes(':')) throw new Error('keyId must not contain ":"');
  const sig = cryptoSign(null, toBytes(payload), toPrivateKey(privateKey));
  return `${SIG_PREFIX}${keyId}:${sig.toString('base64url')}`;
}

export interface ParsedSignature {
  alg: 'ed25519';
  keyId: string;
  signature: Uint8Array;
}

/** Parse an `ed25519:<keyId>:<base64url>` signature string. Returns null if malformed. */
export function parseSignature(s: string | undefined | null): ParsedSignature | null {
  if (typeof s !== 'string' || !s.startsWith(SIG_PREFIX)) return null;
  const rest = s.slice(SIG_PREFIX.length);
  const idx = rest.indexOf(':');
  if (idx <= 0) return null;
  const keyId = rest.slice(0, idx);
  const b64 = rest.slice(idx + 1);
  if (!keyId || !b64) return null;
  try {
    return { alg: 'ed25519', keyId, signature: new Uint8Array(Buffer.from(b64, 'base64url')) };
  } catch {
    return null;
  }
}

/** Verify a formatted signature string over `payload` with the given public key. */
export function verifyPayload(
  payload: string | Uint8Array,
  signature: string,
  publicKey: KeyInput,
): boolean {
  const parsed = parseSignature(signature);
  if (!parsed) return false;
  try {
    return cryptoVerify(null, toBytes(payload), toPublicKey(publicKey), parsed.signature);
  } catch {
    return false;
  }
}

/**
 * Canonical payload the platform counter-signs at approval. Binds the
 * attestation to the version identity + artifact location + the publisher
 * signature (which itself binds the artifact bytes). MUST match the cloud
 * control plane's `counterSignPayload` exactly.
 */
export function counterSignPayload(version: {
  package_id: string;
  version: string;
  blob_key?: string | null;
  signature?: string | null;
}): string {
  return [
    version.package_id,
    version.version,
    version.blob_key ?? '',
    version.signature ?? '',
  ].join('\n');
}

export interface PublisherVerifyResult {
  /** Whether loading may proceed on signature grounds. */
  ok: boolean;
  /** True when a signature was present AND cryptographically verified. */
  verified: boolean;
  reason?: string;
}

/**
 * Verify a publisher signature over the raw artifact bytes. `getPublicKey`
 * resolves the verifying key from the signature's embedded keyId.
 *
 * Mirrors cloud's publish-time policy:
 *   - no signature → ok, verified=false (caller decides via trust tier).
 *   - malformed / fails verification → NOT ok.
 *   - unknown keyId → NOT ok (never silently trust).
 */
export async function verifyPublisherSignature(
  args: { artifact: Uint8Array; signature?: string | null },
  getPublicKey?: (keyId: string) => Promise<KeyInput | null> | KeyInput | null,
): Promise<PublisherVerifyResult> {
  const sig = args.signature;
  if (!sig) return { ok: true, verified: false, reason: 'no signature supplied' };

  const parsed = parseSignature(sig);
  if (!parsed) return { ok: false, verified: false, reason: 'signature is malformed' };

  if (!getPublicKey) {
    return { ok: true, verified: false, reason: 'no publisher key registry configured' };
  }

  const pub = await getPublicKey(parsed.keyId);
  if (!pub) return { ok: false, verified: false, reason: `unknown publisher key '${parsed.keyId}'` };

  return verifyPayload(args.artifact, sig, pub)
    ? { ok: true, verified: true }
    : { ok: false, verified: false, reason: 'publisher signature does not match artifact' };
}

/** Verify a platform counter-signature against the version identity + platform public key. */
export function verifyPlatformSignature(
  version: {
    package_id: string;
    version: string;
    blob_key?: string | null;
    signature?: string | null;
    platform_signature?: string | null;
  },
  platformPublicKey: KeyInput,
): boolean {
  if (!version.platform_signature) return false;
  return verifyPayload(counterSignPayload(version), version.platform_signature, platformPublicKey);
}

export interface PluginArtifactVerifyResult {
  /** Overall verdict: both required chains satisfied under the given policy. */
  ok: boolean;
  publisherVerified: boolean;
  platformVerified: boolean;
  reason?: string;
}

/**
 * Verify both trust chains for a downloaded plugin artifact at load time
 * (ADR-0025 §3.7). The platform counter-signature is the authoritative
 * marketplace attestation; the publisher signature additionally binds the
 * exact bytes. `requirePlatform` (default true) rejects artifacts that lack
 * a valid platform counter-sign — set false for first-party / local builds.
 */
export async function verifyPluginArtifact(
  input: {
    artifact: Uint8Array;
    version: {
      package_id: string;
      version: string;
      blob_key?: string | null;
      signature?: string | null;
      platform_signature?: string | null;
    };
  },
  keys: {
    platformPublicKey?: KeyInput;
    getPublisherPublicKey?: (keyId: string) => Promise<KeyInput | null> | KeyInput | null;
    requirePlatform?: boolean;
  },
): Promise<PluginArtifactVerifyResult> {
  const requirePlatform = keys.requirePlatform ?? true;

  const publisher = await verifyPublisherSignature(
    { artifact: input.artifact, signature: input.version.signature },
    keys.getPublisherPublicKey,
  );
  if (!publisher.ok) {
    return { ok: false, publisherVerified: false, platformVerified: false, reason: publisher.reason };
  }

  let platformVerified = false;
  if (keys.platformPublicKey) {
    platformVerified = verifyPlatformSignature(input.version, keys.platformPublicKey);
  }
  if (requirePlatform && !platformVerified) {
    return {
      ok: false,
      publisherVerified: publisher.verified,
      platformVerified,
      reason: keys.platformPublicKey
        ? 'platform counter-signature missing or invalid'
        : 'no platform public key configured',
    };
  }

  return { ok: true, publisherVerified: publisher.verified, platformVerified };
}
