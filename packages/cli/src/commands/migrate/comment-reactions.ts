// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { createInterface } from 'node:readline';
import {
  printHeader,
  printSuccess,
  printWarning,
  printError,
  printInfo,
  printStep,
  createTimer,
  emitJson,
  isExitSignal,
  errorCodeFields,
} from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { OCCUPANCY_HINT, probeMigrationTarget } from '../../utils/migrate-occupancy-gate.js';
import { describeOccupancy, JOURNAL_MODE_SWITCH_NOTE } from '../../utils/sqlite-occupancy.js';
import { buildDataMigrationPlugins } from '../../utils/data-migration-plugins.js';
import { absentTableReads } from '../../utils/absent-table-reads.js';
import type { MigrationFlagEngine } from '@objectstack/platform-objects/system';
import {
  COMMENT_OBJECT,
  COMMENT_REACTION_OBJECT,
  convertStoredCommentReactions,
  conversionVerified,
  recordCommentReactionsConversion,
  type CommentReactionsConversionReport,
  type CommentReactionsEngine,
} from '../../utils/comment-reactions-conversion.js';

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false; // non-interactive → require --yes
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer: string = await new Promise((resolve) => rl.question(question, resolve));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/** How each unreadable reason reads to an operator. */
const REASON_TEXT: Record<string, string> = {
  not_json: 'the stored value is not JSON',
  not_a_map: 'the stored value is not a map of emoji to user ids',
  not_a_user_list: 'this emoji does not hold a list of user ids',
  not_a_user_id: 'this entry is not a user id',
  emoji_not_storable: 'this emoji is empty or longer than a reaction record holds',
  unknown_user: 'no sys_user row has this id',
};

/**
 * `os migrate comment-reactions` — carry the emoji reactions a 17.x deployment
 * stored in `sys_comment.reactions` into `sys_comment_reaction` records (#23281).
 *
 * v18 retired the column, and schema sync is additive, so an upgraded database
 * still holds every stored reaction in a column nothing reads. Each reaction
 * becomes the reactor's own `sys_comment_reaction` row — the same comment, user
 * and emoji, in the comment's organization — and a value that does not read is
 * listed, never guessed at. The mechanism and its guarantees are documented on
 * `utils/comment-reactions-conversion.ts`.
 *
 * The shape is its siblings': `audit-metadata-bodies` for the dry run, the
 * idempotent rewrite and the plugin-audit boot; `value-shapes` for the
 * `sys_migration` verdict an `--apply` run records. Dry run by default (writes
 * nothing), `--apply` to write. A re-run converts nothing twice, so it is also
 * how an interrupted run is finished.
 *
 * ## The column drop waits for it
 *
 * `os migrate apply --allow-destructive` refuses to drop `sys_comment.reactions`
 * until this command has recorded a VERIFIED run: one whose read-back after the
 * writes finds every readable reaction converted and no value left unreadable.
 * Convert, verify, then drop — never the other way round.
 */
export default class MigrateCommentReactions extends Command {
  // The tracker id stays in the comment above and out of the strings below: a
  // command description reaches operators, who have no tracker to resolve it.
  static override description =
    'Carry the emoji reactions stored in the retired sys_comment.reactions column into sys_comment_reaction ' +
    'records: one row per comment, emoji and user, in the comment\'s organization. Values that do not read are ' +
    'listed, never guessed at. Dry run by default; --apply writes and records the verdict that lets ' +
    '"os migrate apply --allow-destructive" drop the column.';

  static override examples = [
    '$ os migrate comment-reactions',
    '$ os migrate comment-reactions --apply',
    '$ os migrate comment-reactions --apply --yes --json',
  ];

  static override flags = {
    'database-url': Flags.string({
      description: 'Database URL to migrate (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    apply: Flags.boolean({
      description: 'Write the reaction records and record the run (default is a read-only dry run)',
      default: false,
    }),
    yes: Flags.boolean({ char: 'y', description: 'Skip the --apply confirmation prompt', default: false }),
    force: Flags.boolean({
      description: 'Apply even when another process is using the database (SQLite occupancy check)',
      default: false,
    }),
    json: Flags.boolean({ description: 'Output as JSON (implies non-interactive; requires --yes to apply)' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(MigrateCommentReactions);
    const timer = createTimer();
    const apply = flags.apply;

    if (!flags.json) printHeader('Migrate · comment-reactions');

    // Occupancy gate — this command writes rows, so a live writer on the same
    // SQLite file is the hazard `audit-metadata-bodies` guards against too.
    const occupancy = await probeMigrationTarget(flags['database-url']);
    if (occupancy.status === 'busy' && apply && !flags.force) {
      if (flags.json) {
        await emitJson(
          { error: 'database_busy', database: occupancy.filename, signal: occupancy.signal, detail: occupancy.detail, hint: OCCUPANCY_HINT },
          0,
          { compact: true },
        );
        this.exit(1);
        return;
      }
      printError(describeOccupancy(occupancy));
      printWarning(OCCUPANCY_HINT);
      this.exit(1);
      return;
    }
    if (occupancy.status === 'busy' && !flags.json) {
      printWarning(apply
        ? `--force: ${describeOccupancy(occupancy)} Converting anyway — the live process may write rows mid-walk.`
        : `${describeOccupancy(occupancy)} The dry run below writes no row or table, but its counts may shift while that process is running. ${JOURNAL_MODE_SWITCH_NOTE}`);
    }
    if (occupancy.status === 'unknown' && !flags.json) {
      printWarning(`Could not check whether the database is in use — ${occupancy.detail}`);
    }

    if (apply && !flags.yes) {
      if (flags.json || !process.stdin.isTTY) {
        if (flags.json) {
          await emitJson({ error: 'confirmation_required', hint: 'pass --yes' }, 0, { compact: true });
          this.exit(1);
          return;
        }
        printWarning('Apply mode writes sys_comment_reaction rows. Re-run with --yes to confirm, or run without --apply to preview.');
        this.exit(1);
        return;
      }
      const ok = await confirm(
        chalk.bold('\nWrite a sys_comment_reaction record for every reaction stored in sys_comment.reactions on this database? [y/N] '),
      );
      if (!ok) {
        printInfo('Aborted — no changes made.');
        return;
      }
    }

    if (!flags.json) {
      printStep(apply ? 'Booting data stack (APPLY mode)…' : 'Booting data stack (dry run)…');
    }

    let stack;
    try {
      // The dry run boots READ-ONLY, the boot `os migrate plan` takes:
      // `deferSchemaDdl` holds schema DDL back and suppresses the artifact's
      // inline seed loader, and `readOnlyProbe` keeps a missing sqlite file
      // from being created. `--apply` keeps the plain boot: the reaction table
      // must exist before it is written. `audit: true` registers plugin-audit's
      // objects, `sys_comment` and `sys_comment_reaction` among them.
      stack = await bootSchemaStack({
        jsonOutput: flags.json,
        databaseUrl: flags['database-url'],
        extraPlugins: await buildDataMigrationPlugins({ audit: true }),
        ...(apply ? {} : { deferSchemaDdl: true, readOnlyProbe: true }),
      });
    } catch (error: any) {
      if (flags.json) { await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
      return;
    }

    try {
      // `SchemaStack.kernel` is untyped. The `objectql` slot serves both the
      // conversion's surface and the `sys_migration` ledger's.
      const engine: (CommentReactionsEngine & MigrationFlagEngine) | undefined = stack.kernel.getService('objectql');
      if (typeof engine?.getObject !== 'function' || typeof engine.getDriverForObject !== 'function') {
        throw new Error('No ObjectQL engine on this stack — cannot read sys_comment.');
      }
      for (const object of [COMMENT_OBJECT, COMMENT_REACTION_OBJECT]) {
        if (!engine.getObject(object)) {
          throw new Error(`${object} is not registered on this stack — plugin-audit's objects are required.`);
        }
      }

      // Not asked: a table the dry run's read-only boot measured absent holds
      // nothing (a never-booted database, or one with no reaction table yet).
      // `--apply` booted plain, so there every table exists and every read is
      // real. ⛔ Only a table MEASURED absent: any other refused read throws.
      const reads = absentTableReads(stack);

      const report = await convertStoredCommentReactions(engine, { apply, rows: reads.rows });

      // The self-check, on `--apply` only: a second, read-only walk after the
      // writes. Its verdict, not the writing walk's counts, is what the ledger
      // records and what the column drop is gated on.
      let check: CommentReactionsConversionReport | null = null;
      let flag: unknown = null;
      let verified = false;
      if (apply) {
        check = await convertStoredCommentReactions(engine, { apply: false, rows: reads.rows });
        verified = conversionVerified(report, check);
        flag = await recordCommentReactionsConversion(engine, report, check);
      }
      // What keeps the column from being dropped, as THIS run measured it.
      const outstanding = check ?? report;
      const blocked = outstanding.unreadable.length > 0 || report.failures.length > 0
        || (apply && !verified);

      if (flags.json) {
        reads.notice(true);
        await emitJson({
          database: stack.dbLabel,
          apply,
          report,
          check,
          verified: apply ? verified : null,
          flag,
          duration: timer.elapsed(),
        });
        if (blocked) this.exit(1);
        return;
      }

      printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
      reads.notice(false);
      console.log('');
      console.log(`  ${chalk.white('sys_comment')}: ${report.scannedComments} scanned, ${report.commentsWithReactions} with stored reactions`);
      console.log(
        `  ${chalk.white('reactions')}: ${report.storedReactions} readable, ${report.alreadyConverted} already converted, ` +
          `${report.converted} ${apply ? 'converted' : 'to convert'}`,
      );
      if (report.collapsedDuplicates > 0) {
        console.log(chalk.dim(`  ${report.collapsedDuplicates} user id(s) listed twice under one emoji: one reaction, one record`));
      }
      console.log('');

      if (outstanding.unreadable.length > 0) {
        printWarning(`${outstanding.unreadable.length} stored value(s) did not read and were converted into nothing:`);
        for (const u of outstanding.unreadable) {
          const where = u.emoji !== undefined ? `comment ${u.commentId}, emoji ${JSON.stringify(u.emoji)}` : `comment ${u.commentId}`;
          console.log(`    ${chalk.yellow('•')} ${where}: ${REASON_TEXT[u.reason] ?? u.reason} — ${chalk.dim(u.stored)}`);
        }
        console.log('');
      }
      for (const f of report.failures) {
        printError(`comment ${f.commentId}, ${JSON.stringify(f.emoji)} by ${f.userId}: ${f.error}`);
      }

      if (report.failures.length > 0) {
        printError(`${report.failures.length} reaction(s) could not be written — re-run to finish them.`);
      } else if (outstanding.unreadable.length > 0) {
        printWarning(
          'The column cannot be dropped until every stored value reads. Correct each value listed above so it reads ' +
            'as a map of emoji to user ids, or clear it if it holds nothing to keep, then re-run with --apply.',
        );
      } else if (apply && verified) {
        printSuccess(
          `Converted ${report.converted} reaction(s); every stored reaction now has its record, and the run is ` +
            'recorded as verified. "os migrate apply --allow-destructive" may now drop sys_comment.reactions.',
        );
      } else if (apply) {
        printError('The read-back after the writes did not find every reaction converted — re-run to finish them.');
      } else if (report.converted > 0) {
        printInfo(`Dry run only — ${report.converted} reaction(s) would be converted. Re-run with --apply.`);
      } else {
        printSuccess(
          'Nothing to convert. Run with --apply once to record it — "os migrate apply --allow-destructive" drops ' +
            'sys_comment.reactions only after this command has recorded a verified run.',
        );
      }
      console.log(chalk.dim(`  ${timer.display()}`));
      console.log('');
      if (blocked) this.exit(1);
    } catch (error: any) {
      if (isExitSignal(error)) throw error;
      if (flags.json) { await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true }); this.exit(1); }
      printError(error.message || String(error));
      this.exit(1);
    } finally {
      await stack.shutdown();
    }
  }
}
