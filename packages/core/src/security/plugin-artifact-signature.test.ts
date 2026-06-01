// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { createPublicKey, createPrivateKey } from 'node:crypto';
import {
  counterSignPayload,
  generateEd25519KeyPair,
  parseSignature,
  signPayload,
  verifyPayload,
  verifyPlatformSignature,
  verifyPluginArtifact,
  verifyPublisherSignature,
} from './plugin-artifact-signature.js';

const { publicKeyPem, privateKeyPem } = generateEd25519KeyPair();
const artifact = new Uint8Array(Buffer.from('fake .osplugin bytes'));

describe('plugin-artifact-signature: format + roundtrip', () => {
  it('signPayload emits ed25519:<keyId>:<base64url> and verifies', () => {
    const sig = signPayload(artifact, privateKeyPem, 'acme-2026');
    expect(sig).toMatch(/^ed25519:acme-2026:[A-Za-z0-9_-]+$/); // base64url alphabet
    expect(verifyPayload(artifact, sig, publicKeyPem)).toBe(true);
  });

  it('is deterministic (Ed25519) — same input yields the same signature', () => {
    expect(signPayload(artifact, privateKeyPem, 'k')).toBe(signPayload(artifact, privateKeyPem, 'k'));
  });

  it('rejects a keyId containing ":"', () => {
    expect(() => signPayload(artifact, privateKeyPem, 'bad:id')).toThrow();
  });

  it('parseSignature handles valid + malformed strings', () => {
    const sig = signPayload(artifact, privateKeyPem, 'k1');
    const parsed = parseSignature(sig);
    expect(parsed?.alg).toBe('ed25519');
    expect(parsed?.keyId).toBe('k1');
    expect(parseSignature('rsa:k:zzz')).toBeNull();
    expect(parseSignature('ed25519:onlyonepart')).toBeNull();
    expect(parseSignature(undefined)).toBeNull();
  });

  it('detects tampering of the payload and the signature', () => {
    const sig = signPayload(artifact, privateKeyPem, 'k');
    expect(verifyPayload(new Uint8Array(Buffer.from('other bytes')), sig, publicKeyPem)).toBe(false);
    const tampered = sig.slice(0, -2) + (sig.endsWith('AA') ? 'BB' : 'AA');
    expect(verifyPayload(artifact, tampered, publicKeyPem)).toBe(false);
  });
});

describe('plugin-artifact-signature: cloud contract alignment', () => {
  it('counterSignPayload is exactly [package_id, version, blob_key, signature].join("\\n")', () => {
    expect(
      counterSignPayload({ package_id: 'p', version: '1.0.0', blob_key: 'b', signature: 's' }),
    ).toBe('p\n1.0.0\nb\ns');
    // null/undefined fields collapse to empty strings (matches cloud).
    expect(counterSignPayload({ package_id: 'p', version: '1.0.0' })).toBe('p\n1.0.0\n\n');
  });
});

describe('plugin-artifact-signature: publisher verification policy', () => {
  it('no signature → ok but unverified', async () => {
    const r = await verifyPublisherSignature({ artifact, signature: null });
    expect(r).toMatchObject({ ok: true, verified: false });
  });

  it('malformed signature → not ok', async () => {
    const r = await verifyPublisherSignature({ artifact, signature: 'garbage' });
    expect(r.ok).toBe(false);
  });

  it('signature present but no key registry → ok, unverified', async () => {
    const sig = signPayload(artifact, privateKeyPem, 'k');
    const r = await verifyPublisherSignature({ artifact, signature: sig });
    expect(r).toMatchObject({ ok: true, verified: false });
  });

  it('unknown keyId → not ok', async () => {
    const sig = signPayload(artifact, privateKeyPem, 'k');
    const r = await verifyPublisherSignature({ artifact, signature: sig }, () => null);
    expect(r.ok).toBe(false);
  });

  it('valid signature + resolvable key → ok + verified', async () => {
    const sig = signPayload(artifact, privateKeyPem, 'k');
    const r = await verifyPublisherSignature({ artifact, signature: sig }, (id) =>
      id === 'k' ? publicKeyPem : null,
    );
    expect(r).toMatchObject({ ok: true, verified: true });
  });
});

describe('plugin-artifact-signature: platform counter-sign + combined chains', () => {
  const platform = generateEd25519KeyPair();
  const version = { package_id: 'com.acme.p', version: '2.1.0', blob_key: 'packages/acme/p/2.1.0.osplugin' };

  it('verifyPlatformSignature roundtrips against the version identity', () => {
    const platform_signature = signPayload(
      counterSignPayload({ ...version, signature: 'pub-sig' }),
      platform.privateKeyPem,
      'platform',
    );
    expect(
      verifyPlatformSignature({ ...version, signature: 'pub-sig', platform_signature }, platform.publicKeyPem),
    ).toBe(true);
    // Wrong signature field in the identity breaks the attestation.
    expect(
      verifyPlatformSignature({ ...version, signature: 'OTHER', platform_signature }, platform.publicKeyPem),
    ).toBe(false);
  });

  it('verifyPluginArtifact requires a valid platform counter-sign by default', async () => {
    const pubSig = signPayload(artifact, privateKeyPem, 'pub');
    const v = { ...version, signature: pubSig };
    const platform_signature = signPayload(counterSignPayload(v), platform.privateKeyPem, 'platform');

    const ok = await verifyPluginArtifact(
      { artifact, version: { ...v, platform_signature } },
      { platformPublicKey: platform.publicKeyPem, getPublisherPublicKey: () => publicKeyPem },
    );
    expect(ok).toMatchObject({ ok: true, publisherVerified: true, platformVerified: true });

    // Missing platform key → rejected under default requirePlatform.
    const noPlatform = await verifyPluginArtifact(
      { artifact, version: { ...v, platform_signature } },
      { getPublisherPublicKey: () => publicKeyPem },
    );
    expect(noPlatform.ok).toBe(false);

    // First-party opt-out: requirePlatform=false accepts publisher-only.
    const firstParty = await verifyPluginArtifact(
      { artifact, version: v },
      { getPublisherPublicKey: () => publicKeyPem, requirePlatform: false },
    );
    expect(firstParty.ok).toBe(true);
  });
});

describe('plugin-artifact-signature: KeyObject inputs', () => {
  it('accepts KeyObject as well as PEM', () => {
    const priv = createPrivateKey(privateKeyPem);
    const pub = createPublicKey(publicKeyPem);
    const sig = signPayload(artifact, priv, 'k');
    expect(verifyPayload(artifact, sig, pub)).toBe(true);
  });
});
