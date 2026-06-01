// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os plugin sign` — produce a publisher signature over a built `.osplugin`
 * (ADR-0025 §3.4 step 2, framework F3).
 *
 * The signature is DETACHED and computed over the exact artifact bytes that
 * will be uploaded — the same bytes the cloud control plane verifies at
 * publish time (`verifyPublisherSignature`) and the runtime re-verifies at
 * materialize time. It is emitted as `ed25519:<keyId>:<base64url>` and
 * written to a `<artifact>.sig` sidecar (and printed), to be passed as the
 * `signature` field when publishing. The artifact itself is NOT modified, so
 * signing is idempotent and the signed bytes are exactly the built bytes.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { resolve as resolvePath } from 'node:path';
import { Args, Command, Flags } from '@oclif/core';
import { parseSignature, signPayload, verifyPayload } from '@objectstack/core';
import { printError, printHeader, printKV, printStep, printSuccess } from '../../utils/format.js';
import { OSPLUGIN_EXT } from '../../utils/osplugin.js';

export default class PluginSign extends Command {
  static override description =
    'Sign a built .osplugin with a publisher Ed25519 key (ADR-0025 §3.4)';

  static override examples = [
    '$ os plugin sign my-plugin-1.0.0.osplugin --key ./publisher.key.pem',
    '$ os plugin sign my-plugin-1.0.0.osplugin --key ./publisher.key.pem --key-id acme-2026',
  ];

  static override args = {
    artifact: Args.string({ description: 'Path to the .osplugin artifact', required: true }),
  };

  static override flags = {
    key: Flags.string({
      char: 'k',
      description: 'Path to the publisher Ed25519 private key (PKCS#8 PEM)',
      required: true,
    }),
    'key-id': Flags.string({
      description: 'Key identifier embedded in the signature (rotation handle)',
      default: 'default',
    }),
    out: Flags.string({
      char: 'o',
      description: 'Output path for the detached signature (defaults to <artifact>.sig)',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PluginSign);
    printHeader('Sign Plugin');

    const artifactPath = resolvePath(process.cwd(), args.artifact);
    if (!existsSync(artifactPath)) {
      printError(`Artifact not found: ${args.artifact}`);
      this.exit(1);
      return;
    }
    if (!artifactPath.endsWith(OSPLUGIN_EXT)) {
      printStep(`Warning: ${args.artifact} does not have a ${OSPLUGIN_EXT} extension`);
    }

    let privateKeyPem: string;
    try {
      privateKeyPem = await readFile(resolvePath(process.cwd(), flags.key), 'utf-8');
    } catch (err) {
      printError(`Cannot read private key: ${(err as Error).message}`);
      this.exit(1);
      return;
    }

    const artifact = new Uint8Array(await readFile(artifactPath));
    const keyId = flags['key-id'];

    let signature: string;
    try {
      signature = signPayload(artifact, privateKeyPem, keyId);
    } catch (err) {
      printError(`Signing failed: ${(err as Error).message}`);
      this.exit(1);
      return;
    }

    // Self-check: verify the freshly produced signature against the public
    // half so a bad key / wrong format never ships silently.
    try {
      const pub = createPublicKey(createPrivateKey(privateKeyPem));
      if (!verifyPayload(artifact, signature, pub)) {
        printError('Self-verification of the produced signature failed.');
        this.exit(1);
        return;
      }
    } catch (err) {
      printError(`Self-verification error: ${(err as Error).message}`);
      this.exit(1);
      return;
    }

    const outPath = resolvePath(process.cwd(), flags.out ?? `${args.artifact}.sig`);
    await writeFile(outPath, signature + '\n', 'utf-8');

    printSuccess('Plugin signed');
    printKV('  Artifact', args.artifact);
    printKV('  Key ID', parseSignature(signature)?.keyId ?? keyId);
    printKV('  Signature', signature);
    printKV('  Sidecar', flags.out ?? `${args.artifact}.sig`);
  }
}
