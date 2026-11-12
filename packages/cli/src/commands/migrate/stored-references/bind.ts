// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import { createInterface } from 'node:readline';
import chalk from 'chalk';
import { printHeader, printSuccess, printWarning, printError, printInfo, emitJson, errorCodeFields, isExitSignal } from '../../../utils/format.js';
import { bootSchemaStack } from '../../../utils/schema-migrate.js';
import { describeUnloadableHostConfig } from '../../../utils/schema-migration-plugins.js';
import { OCCUPANCY_HINT, probeMigrationTarget } from '../../../utils/migrate-occupancy-gate.js';
import { describeOccupancy } from '../../../utils/sqlite-occupancy.js';
import {
  bindStoredPackageReference,
  type StoredReferenceEngine,
  type StoredReferenceRegistry,
} from '../../../utils/stored-package-references.js';
import { COMPOSITION_FLAGS, describeCandidate } from './index.js';

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false; // non-interactive → require --yes
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer: string = await new Promise((res) => rl.question(question, res));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/**
 * `os migrate stored-references bind` — write ONE operator-chosen package into
 * ONE stored reference that `os migrate stored-references` reported as
 * ambiguous (ADR-0150 D10's reviewed bind).
 *
 * It never picks: the operator names the row (`--table`, `--id`) and the
 * package (`--package`), and the write happens only when the one D3 rule,
 * asked again at write time, still refuses that row as ambiguous and still
 * names that package among its candidates, and the row's package column is
 * still null. Every other state is refused with its reason and writes nothing,
 * so a stale report binds nothing and a second run writes 0 rows. There is no
 * bind-all. The rules are `utils/stored-package-references.ts`'s header.
 *
 * The write goes through the engine under the system context, on a boot that
 * composes the audit plugin, so each bind leaves one `sys_audit_log` row (the
 * column's old and new value). Confirmed with `[y/N]` or `--yes`.
 *
 * Exit status: 0 when the row was bound, or the prompt was declined (as its
 * siblings, a decline keeps its code); 1 when the bind was refused, was run
 * non-interactively without `--yes`, or the composition could not be read.
 */
export default class MigrateStoredReferencesBind extends Command {
  static override description =
    'Bind one stored reference "os migrate stored-references" reported as ambiguous to the package the operator '
    + 'chose after review (ADR-0150 D10). Re-asks the resolution rule at write time; never picks; one row per run.';

  static override examples = [
    '$ os migrate stored-references bind --table sys_sharing_rule --id 1bv08HButRVxI_hC --package com.example.crm',
    '$ os migrate stored-references bind --table sys_queue_member --id q1 --package com.example.crm --yes --json',
  ];

  static override flags = {
    ...COMPOSITION_FLAGS,
    table: Flags.string({ description: 'The table of the reported row', required: true }),
    id: Flags.string({ description: 'The id of the reported row', required: true }),
    package: Flags.string({ description: 'The package id chosen among the row\'s candidates', required: true }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the confirmation prompt', default: false }),
    force: Flags.boolean({
      description: 'Bind even when another process is using the database (SQLite occupancy check)',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateStoredReferencesBind);
    const json = flags.json === true;
    if (!json) printHeader('Migrate · stored-references bind');
    const fail = async (payload: Record<string, unknown>, text: string, hint?: string): Promise<void> => {
      if (json) await emitJson(payload, 0, { compact: true });
      else { printError(text); if (hint) printWarning(hint); }
      this.exit(1);
    };

    const occupancy = await probeMigrationTarget(flags['database-url'], { dev: flags.dev === true });
    if (occupancy.status === 'busy' && !flags.force) {
      return fail({ error: 'database_busy', database: occupancy.filename, signal: occupancy.signal, detail: occupancy.detail, hint: OCCUPANCY_HINT },
        describeOccupancy(occupancy), OCCUPANCY_HINT);
    }
    if (!flags.yes) {
      if (json || !process.stdin.isTTY) {
        return fail({ error: 'confirmation_required', hint: 'pass --yes' },
          'Binding writes one row. Re-run with --yes to confirm, or run "os migrate stored-references" to review first.');
      }
      const ok = await confirm(chalk.bold(`\nBind ${flags.table} "${flags.id}" to package "${flags.package}"? [y/N] `));
      if (!ok) {
        printInfo('Aborted — nothing written.');
        return;
      }
    }

    let stack;
    try {
      const { AuditPlugin } = await import('@objectstack/plugin-audit');
      stack = await bootSchemaStack({
        jsonOutput: json,
        ...(flags['database-url'] ? { databaseUrl: flags['database-url'] } : {}),
        composeHostStack: true,
        composeServedPlatform: true,
        composeAuthGatedSecurity: true,
        // Composed in full, so the bind's write leaves its `sys_audit_log` row;
        // its sealer is not armed, as on every one-shot boot [ADR-0154 D3].
        extraPlugins: [new AuditPlugin({ armSealer: false })],
        serveFlags: { dev: flags.dev === true, ...(flags.preset ? { preset: flags.preset } : {}) },
      });
    } catch (error: any) {
      return fail({ error: error.message, ...errorCodeFields(error) }, error.message || String(error));
    }
    let exitCode = 1;
    try {
      const unloadable = describeUnloadableHostConfig(stack.composition);
      if (unloadable !== null) {
        if (json) await emitJson({ error: 'host_config_unloadable', message: unloadable }, 0, { compact: true });
        else printError(unloadable);
      } else {
        const engine = stack.kernel.getService('objectql') as (StoredReferenceEngine & { registry?: StoredReferenceRegistry }) | undefined;
        if (typeof engine?.find !== 'function' || typeof engine.update !== 'function' || !engine.registry) {
          throw new Error('No ObjectQL engine on this stack, so the stored references cannot be read. '
            + 'Run this from the project root whose stack registers the ObjectQL engine.');
        }
        const outcome = await bindStoredPackageReference(engine, engine.registry, { table: flags.table, id: flags.id, packageId: flags.package });
        exitCode = outcome.outcome === 'bound' ? 0 : 1;
        if (json) {
          await emitJson({ database: stack.dbLabel, written: outcome.outcome === 'bound' ? 1 : 0, ...outcome });
        } else if (outcome.outcome === 'bound') {
          printSuccess(`${outcome.d8} ${outcome.table} "${outcome.id}": ${outcome.packageColumn} = "${outcome.packageId}" `
            + `(the reference to "${outcome.name}"). One row written; its sys_audit_log row records the change.`);
        } else {
          printError(outcome.message);
          if (outcome.candidates?.length) printInfo(`Candidates now: ${outcome.candidates.map(describeCandidate).join('; ')}`);
        }
      }
    } catch (error: any) {
      if (isExitSignal(error)) throw error;
      exitCode = 1;
      if (json) await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true });
      else printError(error.message || String(error));
    } finally {
      await stack.shutdown();
    }
    if (exitCode !== 0) this.exit(exitCode);
  }
}
