// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os plugin keygen` — generate a publisher Ed25519 key pair as two files
 * (ADR-0025 §3.4 step 2, §3.5 M1).
 *
 *   PATH.key.pem   PKCS#8 private key — stays with the publisher, mode 0600
 *   PATH.pub.pem   SPKI public key    — what `os plugin trust add` takes
 *
 * and prints the key id and the public key's fingerprint, then the two
 * commands that use them: `os plugin sign --key PATH.key.pem --key-id ID`
 * embeds the id in the signature, and `os plugin trust add PATH.pub.pem
 * --key-id ID` makes an environment accept it.
 *
 * ⛔ The private key is written to the developer's disk and nowhere else: the
 * platform never generates, receives or stores a publisher's private key
 * (ADR-0025 §7, "publisher keys stay with the publisher"). Neither file is
 * overwritten unless `--force` says so — a private key replaced by accident
 * is a signing identity lost.
 */

import { existsSync } from 'node:fs';
import { chmod, writeFile } from 'node:fs/promises';
import { createPublicKey } from 'node:crypto';
import { dirname, resolve as resolvePath } from 'node:path';
import { Command, Flags } from '@oclif/core';
import { generateEd25519KeyPair } from '@objectstack/core';
import { publicKeyFingerprint, TRUSTED_KEY_ID_PATTERN } from '@objectstack/runtime';
import { printError, printHeader, printKV, printStep, printSuccess } from '../../utils/format.js';

export default class PluginKeygen extends Command {
  static override description =
    'Generate a publisher Ed25519 key pair as PATH.key.pem (private, stays with you) and PATH.pub.pem (public) (ADR-0025 §3.5)';

  static override examples = [
    '$ os plugin keygen --out ./keys/acme',
    '$ os plugin keygen --out ./keys/acme --key-id acme-2026',
  ];

  static override flags = {
    out: Flags.string({
      char: 'o',
      description: 'Path prefix for the pair: writes PATH.key.pem and PATH.pub.pem',
      required: true,
    }),
    'key-id': Flags.string({
      description:
        'Key id to print for `os plugin sign --key-id` and `os plugin trust add --key-id` (default: the first 16 hex digits of the fingerprint)',
    }),
    force: Flags.boolean({
      description: 'Overwrite PATH.key.pem / PATH.pub.pem when they already exist',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(PluginKeygen);
    printHeader('Generate Plugin Signing Key');

    const prefix = resolvePath(process.cwd(), flags.out);
    const privatePath = `${prefix}.key.pem`;
    const publicPath = `${prefix}.pub.pem`;

    if (flags['key-id'] !== undefined && !TRUSTED_KEY_ID_PATTERN.test(flags['key-id'])) {
      printError(`Key id ${JSON.stringify(flags['key-id'])} is not allowed: use 1-128 letters, digits, '.', '_' or '-'.`);
      this.exit(1);
      return;
    }
    if (!existsSync(dirname(prefix))) {
      printError(`Directory does not exist: ${dirname(prefix)}`);
      this.exit(1);
      return;
    }
    const present = [privatePath, publicPath].filter((p) => existsSync(p));
    if (present.length > 0 && !flags.force) {
      printError(
        `Refusing to overwrite ${present.join(' and ')}: a private key replaced by accident is a signing identity lost. `
          + 'Choose another --out, or pass --force.',
      );
      this.exit(1);
      return;
    }

    const { publicKeyPem, privateKeyPem } = generateEd25519KeyPair();
    const fingerprint = publicKeyFingerprint(createPublicKey(publicKeyPem));
    const keyId = flags['key-id'] ?? fingerprint.slice('sha256:'.length, 'sha256:'.length + 16);

    // The private key is created owner-only; chmod again in case the file
    // already existed (`--force`) with a wider mode, which writeFile keeps.
    await writeFile(privatePath, privateKeyPem, { encoding: 'utf-8', mode: 0o600 });
    await chmod(privatePath, 0o600);
    await writeFile(publicPath, publicKeyPem, 'utf-8');

    printSuccess('Key pair written');
    printKV('  Private key', `${privatePath} (keep it; never share or upload it)`);
    printKV('  Public key', publicPath);
    printKV('  Key ID', keyId);
    printKV('  Fingerprint', fingerprint);
    printStep(`Sign:  os plugin sign ARTIFACT.osplugin --key ${privatePath} --key-id ${keyId}`);
    printStep(`Trust: os plugin trust add ${publicPath} --key-id ${keyId}`);
  }
}
