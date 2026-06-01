// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterAll } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateEd25519KeyPair, parseSignature, verifyPayload } from '@objectstack/core';
import PluginBuild from '../src/commands/plugin/build.js';
import PluginSign from '../src/commands/plugin/sign.js';
import { MANIFEST_FILENAME } from '../src/utils/osplugin.js';

describe('os plugin sign (end-to-end, build → sign → verify)', () => {
  let dir: string;
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('produces a detached ed25519 signature over the exact artifact bytes', async () => {
    dir = await mkdtemp(join(tmpdir(), 'osplugin-sign-'));
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(
      join(dir, MANIFEST_FILENAME),
      JSON.stringify({
        id: 'com.acme.signed',
        name: 'Signed',
        version: '1.0.0',
        type: 'plugin',
        runtime: 'node',
        packaging: 'bundled',
        main: 'src/index.ts',
        permissions: { services: ['object'] },
      }),
    );
    await writeFile(join(dir, 'src', 'index.ts'), `export const v = 1;\n`);

    const { publicKeyPem, privateKeyPem } = generateEd25519KeyPair();
    await writeFile(join(dir, 'publisher.key.pem'), privateKeyPem);

    await PluginBuild.run([dir]);
    const artifactPath = join(dir, 'com.acme.signed-1.0.0.osplugin');

    await PluginSign.run([artifactPath, '--key', join(dir, 'publisher.key.pem'), '--key-id', 'acme-2026']);

    const sig = (await readFile(`${artifactPath}.sig`, 'utf-8')).trim();
    expect(parseSignature(sig)?.keyId).toBe('acme-2026');

    // The signature must verify against the EXACT bytes that were signed — the
    // same check the cloud control plane runs at publish time.
    const artifactBytes = new Uint8Array(await readFile(artifactPath));
    expect(verifyPayload(artifactBytes, sig, publicKeyPem)).toBe(true);

    // Tampering with the artifact invalidates the signature.
    const tampered = new Uint8Array(artifactBytes);
    tampered[tampered.length - 1] ^= 0xff;
    expect(verifyPayload(tampered, sig, publicKeyPem)).toBe(false);

    // Sanity: the signed artifact is a valid gzip (unchanged by signing).
    expect(() => gunzipSync(Buffer.from(artifactBytes))).not.toThrow();
  });
});
