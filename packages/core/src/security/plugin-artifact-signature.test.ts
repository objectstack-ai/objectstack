// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  createPublicKey,
  createPrivateKey,
  createSecretKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';
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

describe('plugin-artifact-signature: the Ed25519 algorithm is enforced by key type', () => {
  // node's sign(null, …) / verify(null, …) follow whatever key they are
  // handed, so without a key-type check an RSA or EC key signs under the
  // `ed25519` label and verifies against its own public half.
  const foreign = [
    { type: 'rsa', pair: generateKeyPairSync('rsa', { modulusLength: 2048 }) },
    { type: 'ec', pair: generateKeyPairSync('ec', { namedCurve: 'P-256' }) },
  ] as const;

  /** A signature the unchecked contract used to emit: a foreign algorithm under the ed25519 label. */
  function mislabelled(priv: KeyObject): string {
    return `ed25519:k:${cryptoSign(null, artifact, priv).toString('base64url')}`;
  }

  for (const { type, pair } of foreign) {
    const privPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const pubPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const named = new RegExp(`of type '${type}'`);

    it(`signPayload refuses an ${type} private key, naming its type (PEM and KeyObject)`, () => {
      expect(() => signPayload(artifact, privPem, 'k')).toThrow(named);
      expect(() => signPayload(artifact, pair.privateKey, 'k')).toThrow(named);
    });

    it(`verifyPayload refuses an ${type} public key, naming its type (PEM and KeyObject)`, () => {
      const sig = mislabelled(pair.privateKey);
      // The signature is cryptographically valid for this key: only the key-type
      // check stands between it and `true`.
      expect(cryptoVerify(null, artifact, pair.publicKey, parseSignature(sig)!.signature)).toBe(true);
      expect(() => verifyPayload(artifact, sig, pubPem)).toThrow(named);
      expect(() => verifyPayload(artifact, sig, pair.publicKey)).toThrow(named);
    });

    it(`every trust path of verifyPluginArtifact refuses an ${type} key`, async () => {
      const sig = mislabelled(pair.privateKey);
      const v = { package_id: 'com.acme.p', version: '1.0.0', signature: sig };
      // Publisher key registry hands back an rsa/ec key.
      await expect(
        verifyPluginArtifact(
          { artifact, version: v },
          { getPublisherPublicKey: () => pubPem, requirePlatform: false },
        ),
      ).rejects.toThrow(named);
      // Platform key is an rsa/ec key.
      const pubSig = signPayload(artifact, privateKeyPem, 'pub');
      const counter = `ed25519:platform:${cryptoSign(null, Buffer.from(counterSignPayload({ ...v, signature: pubSig })), pair.privateKey).toString('base64url')}`;
      await expect(
        verifyPluginArtifact(
          { artifact, version: { ...v, signature: pubSig, platform_signature: counter } },
          { platformPublicKey: pubPem, getPublisherPublicKey: () => publicKeyPem },
        ),
      ).rejects.toThrow(named);
    });
  }

  it('an Ed25519 key signs and verifies as before, as PEM and as KeyObject', () => {
    const pemSig = signPayload(artifact, privateKeyPem, 'k');
    const objSig = signPayload(artifact, createPrivateKey(privateKeyPem), 'k');
    expect(objSig).toBe(pemSig);
    expect(verifyPayload(artifact, pemSig, publicKeyPem)).toBe(true);
    expect(verifyPayload(artifact, pemSig, createPublicKey(publicKeyPem))).toBe(true);
    // A private key still verifies through its public half, as node allows.
    expect(verifyPayload(artifact, pemSig, privateKeyPem)).toBe(true);
  });

  it('a label that disagrees with the key type is refused, in both directions', () => {
    const [{ pair: rsa }] = foreign;
    const rsaPub = rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const rsaSig = cryptoSign(null, artifact, rsa.privateKey).toString('base64url');
    // `ed25519` label over an rsa key: the label is checked against the key, not trusted.
    expect(() => verifyPayload(artifact, `ed25519:k:${rsaSig}`, rsaPub)).toThrow(/of type 'rsa'/);
    // A truthful `rsa` label is not a label this contract accepts at all.
    expect(verifyPayload(artifact, `rsa:k:${rsaSig}`, rsaPub)).toBe(false);
    // A valid Ed25519 signature relabelled as anything else does not verify.
    const edSig = signPayload(artifact, privateKeyPem, 'k').slice('ed25519:'.length);
    expect(verifyPayload(artifact, `rsa:${edSig}`, publicKeyPem)).toBe(false);
  });

  it('a symmetric key is refused as `secret`', () => {
    expect(() => signPayload(artifact, createSecretKey(Buffer.alloc(32)), 'k')).toThrow(/of type 'secret'/);
  });

  it('an unreadable key or a malformed signature still answers false, not a throw', () => {
    const sig = signPayload(artifact, privateKeyPem, 'k');
    expect(verifyPayload(artifact, sig, 'not a pem')).toBe(false);
    expect(verifyPayload(artifact, 'garbage', publicKeyPem)).toBe(false);
  });
});
