// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os plugin trust add PUB.pem --key-id ID` — trust a publisher's Ed25519
 * PUBLIC key in this environment (ADR-0025 §3.5 M1).
 *
 * Writes one `sys_trusted_key` row (`source: 'local'`, `status: 'active'`)
 * through a one-shot boot of the environment's database, the composition
 * `os secret rewrap --apply` takes, with the audit CRUD mirror armed so the act
 * leaves a `sys_audit_log` row. From then on `os plugin install` accepts an
 * artifact whose signature names `ID` and verifies under this key.
 *
 * Refused, each by name, before anything is written:
 *  - a PRIVATE-key PEM — never converted to its public half, because a private
 *    key never enters the platform (ADR-0025 §7);
 *  - a key that is not Ed25519;
 *  - a key id already naming a different key, or a key id that was revoked —
 *    a revoked key id is never trusted again.
 * The same key under the same id again changes nothing.
 *
 * Operator-only: there is no HTTP surface, and the store's API is read-only.
 */

import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { Args, Command, Flags } from '@oclif/core';
import { addTrustedKey, readPublisherPublicKey, TRUSTED_KEY_ID_PATTERN } from '@objectstack/runtime';
import { isExitSignal, printError, printHeader, printInfo, printKV, printStep, printSuccess } from '../../../utils/format.js';
import { bootSchemaStack } from '../../../utils/schema-migrate.js';
import { NO_TRUST_STORE_ENGINE, operatorName, trustStoreEngine, trustStorePlugins } from '../../../utils/plugin-trust-store.js';

export default class PluginTrustAdd extends Command {
  static override description =
    "Trust a publisher's Ed25519 public key in this environment, so `os plugin install` accepts artifacts it signed (ADR-0025 §3.5)";

  static override examples = [
    '$ os plugin trust add ./keys/acme.pub.pem --key-id acme-2026',
  ];

  static override args = {
    publicKey: Args.string({ description: 'Path to the publisher public key (SPKI PEM, e.g. PATH.pub.pem from `os plugin keygen`)', required: true }),
  };

  static override flags = {
    'key-id': Flags.string({
      description: 'The key id signatures name (`os plugin sign --key-id`)',
      required: true,
    }),
    'database-url': Flags.string({
      description: "The environment's database (defaults to $OS_DATABASE_URL / the project DB)",
      env: 'OS_DATABASE_URL',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PluginTrustAdd);
    printHeader('Trust Plugin Publisher Key');

    const keyId = flags['key-id'];
    if (!TRUSTED_KEY_ID_PATTERN.test(keyId)) {
      printError(`Key id ${JSON.stringify(keyId)} is not allowed: use 1-128 letters, digits, '.', '_' or '-'.`);
      this.exit(1);
      return;
    }

    let pem: string;
    try {
      pem = await readFile(resolvePath(process.cwd(), args.publicKey), 'utf-8');
    } catch (error) {
      printError(`Cannot read public key: ${(error as Error).message}`);
      this.exit(1);
      return;
    }
    const read = readPublisherPublicKey(pem);
    if (!read.ok) {
      printError(read.message);
      this.exit(1);
      return;
    }

    let stack;
    try {
      stack = await bootSchemaStack({
        jsonOutput: false,
        databaseUrl: flags['database-url'],
        extraPlugins: await trustStorePlugins(true),
      });
    } catch (error) {
      printError(error instanceof Error ? error.message : String(error));
      this.exit(1);
      return;
    }

    try {
      const engine = trustStoreEngine(stack);
      if (!engine) {
        printError(NO_TRUST_STORE_ENGINE);
        this.exit(1);
        return;
      }
      const result = await addTrustedKey(engine, {
        keyId,
        publicKeyPem: read.publicKeyPem,
        fingerprint: read.fingerprint,
        addedBy: operatorName(),
      });
      if (result.outcome === 'refused') {
        printError(result.message);
        this.exit(1);
        return;
      }
      if (result.outcome === 'already-trusted') {
        printInfo(`Key '${keyId}' is already trusted in this environment with this fingerprint; nothing was written.`);
      } else {
        printSuccess(`Trusted key '${keyId}'`);
      }
      printKV('  Key ID', result.row.key_id);
      printKV('  Fingerprint', result.row.fingerprint);
      printKV('  Source', result.row.source);
      printKV('  Database', stack.dbLabel);
      printStep(`\`os plugin install\` now accepts artifacts signed with --key-id ${keyId} by this key.`);
    } catch (error) {
      if (isExitSignal(error)) throw error;
      printError(error instanceof Error ? error.message : String(error));
      this.exit(1);
    } finally {
      await stack.shutdown();
    }
  }
}
