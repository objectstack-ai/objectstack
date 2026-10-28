// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os plugin trust list` — the publisher keys this environment trusts, revoked
 * ones included (ADR-0025 §3.5 M1).
 *
 * Reads `sys_trusted_key` through the READ-ONLY one-shot boot (`os migrate
 * plan`'s): no row, table or missing database file is written. A database
 * whose boot measured the table absent has never trusted a key, and says so.
 */

import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { listTrustedKeys, TRUSTED_KEY_OBJECT, type TrustedKeyRow } from '@objectstack/runtime';
import { emitJson, errorCodeFields, isExitSignal, printError, printHeader, printInfo } from '../../../utils/format.js';
import { bootSchemaStack } from '../../../utils/schema-migrate.js';
import { absentTableReads } from '../../../utils/absent-table-reads.js';
import { NO_TRUST_STORE_ENGINE, trustStoreEngine, trustStorePlugins } from '../../../utils/plugin-trust-store.js';

export default class PluginTrustList extends Command {
  static override description =
    'List the publisher keys this environment trusts, revoked ones included (ADR-0025 §3.5)';

  static override examples = [
    '$ os plugin trust list',
    '$ os plugin trust list --json',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: "The environment's database (defaults to $OS_DATABASE_URL / the project DB)",
      env: 'OS_DATABASE_URL',
    }),
    json: Flags.boolean({ description: 'Output as JSON', default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(PluginTrustList);
    const json = flags.json;
    if (!json) printHeader('Trusted Plugin Publisher Keys');

    let stack;
    try {
      stack = await bootSchemaStack({
        jsonOutput: json,
        databaseUrl: flags['database-url'],
        extraPlugins: await trustStorePlugins(false),
        deferSchemaDdl: true,
        readOnlyProbe: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (json) { await emitJson({ error: 'boot_failed', message }, 1, { compact: true }); return; }
      printError(message);
      this.exit(1);
      return;
    }

    try {
      const engine = trustStoreEngine(stack);
      if (!engine) {
        if (json) { await emitJson({ error: 'no_engine', message: NO_TRUST_STORE_ENGINE }, 1, { compact: true }); return; }
        printError(NO_TRUST_STORE_ENGINE);
        this.exit(1);
        return;
      }
      const reads = absentTableReads(stack);
      const keys: TrustedKeyRow[] = await reads.rows(TRUSTED_KEY_OBJECT, () => listTrustedKeys(engine));
      reads.notice(json);
      if (json) { await emitJson({ keys }, 0, { compact: true }); return; }
      if (keys.length === 0) {
        printInfo('No publisher key is trusted in this environment. Add one with `os plugin trust add PUB.pem --key-id ID`.');
        return;
      }
      for (const k of keys) {
        const status = k.status === 'active' ? chalk.green(k.status) : chalk.red(k.status);
        console.log(`  ${chalk.bold(k.key_id)}  ${status}  ${k.source}  ${k.fingerprint}`);
        console.log(chalk.dim(`      added ${k.added_at}${k.added_by ? ` by ${k.added_by}` : ''}`));
      }
    } catch (error) {
      if (isExitSignal(error)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (json) { await emitJson({ error: 'read_failed', message, ...errorCodeFields(error) }, 1, { compact: true }); return; }
      printError(message);
      this.exit(1);
    } finally {
      await stack.shutdown();
    }
  }
}
