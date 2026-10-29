// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os plugin trust revoke ID` — revoke a trusted publisher key in this
 * environment (ADR-0025 §3.5 M1).
 *
 * Flips the `sys_trusted_key` row's `status` to `revoked` through a one-shot
 * boot of the environment's database, with the audit CRUD mirror armed so the
 * act leaves a `sys_audit_log` row. The row is kept: from then on
 * `os plugin install` refuses an artifact signed under `ID` by name, and
 * `os plugin trust add` refuses to trust any key under `ID` again.
 *
 * Operator-only: there is no HTTP surface, and the store's API is read-only.
 */

import { Args, Command, Flags } from '@oclif/core';
import { revokeTrustedKey } from '@objectstack/runtime';
import { isExitSignal, printError, printHeader, printInfo, printKV, printSuccess } from '../../../utils/format.js';
import { bootSchemaStack } from '../../../utils/schema-migrate.js';
import { NO_TRUST_STORE_ENGINE, trustStoreEngine, trustStorePlugins } from '../../../utils/plugin-trust-store.js';

export default class PluginTrustRevoke extends Command {
  static override description =
    'Revoke a trusted publisher key in this environment; `os plugin install` refuses what it signed from then on (ADR-0025 §3.5)';

  static override examples = [
    '$ os plugin trust revoke acme-2026',
  ];

  static override args = {
    keyId: Args.string({ description: 'The key id to revoke (`os plugin trust list` shows them)', required: true }),
  };

  static override flags = {
    'database-url': Flags.string({
      description: "The environment's database (defaults to $OS_DATABASE_URL / the project DB)",
      env: 'OS_DATABASE_URL',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(PluginTrustRevoke);
    printHeader('Revoke Plugin Publisher Key');

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
      const result = await revokeTrustedKey(engine, args.keyId);
      if (result.outcome === 'refused') {
        printError(result.message);
        this.exit(1);
        return;
      }
      if (result.outcome === 'already-revoked') {
        printInfo(`Key '${args.keyId}' was already revoked in this environment; nothing was written.`);
      } else {
        printSuccess(`Revoked key '${args.keyId}'`);
      }
      printKV('  Fingerprint', result.row.fingerprint);
      printKV('  Database', stack.dbLabel);
      printInfo('`os plugin install` refuses artifacts signed under this key id from now on.');
    } catch (error) {
      if (isExitSignal(error)) throw error;
      printError(error instanceof Error ? error.message : String(error));
      this.exit(1);
    } finally {
      await stack.shutdown();
    }
  }
}
