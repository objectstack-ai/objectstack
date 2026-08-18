// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import chalk from 'chalk';
import {
  ObjectStackDefinitionSchema,
  applyMetaMigrations,
  composeSpecChanges,
  normalizeStackInput,
  MigrationFloorError,
} from '@objectstack/spec';
import { PROTOCOL_MAJOR, PROTOCOL_VERSION } from '@objectstack/spec/kernel';
import { FILE_REFERENCE_TYPES, REFERENCE_VALUE_TYPES, STRUCTURED_JSON_TYPES } from '@objectstack/spec/data';
import { FILE_REFERENCES_MIGRATION_ID, VALUE_SHAPES_MIGRATION_ID } from '@objectstack/spec/system';
import { loadConfig } from '../../utils/config.js';
import {
  printHeader,
  printSuccess,
  printWarning,
  printError,
  printInfo,
  printStep,
  createTimer,
  emitJson,
} from '../../utils/format.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { buildDataMigrationPlugins } from '../../utils/data-migration-plugins.js';
import { OCCUPANCY_HINT, probeMigrationTarget } from '../../utils/migrate-occupancy-gate.js';
import { describeOccupancy } from '../../utils/sqlite-occupancy.js';

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

/** The protocol major that introduced the per-deployment value-shape gates. */
const VALUE_SHAPE_GATE_MAJOR = 17;

/** Flags that mean something only in `--stored` mode (#4327). */
const STORED_ONLY_FLAGS = ['apply', 'yes', 'force', 'type', 'database-url'] as const;

/**
 * Which stored-only flags the operator actually TYPED.
 *
 * oclif's own `dependsOn` cannot answer this: a boolean with `default: false`
 * and an `env`-backed string both read as "provided" to it, so declaring
 * `dependsOn: ['stored']` on `--database-url` would make a merely-exported
 * `OS_DATABASE_URL` break `os migrate meta --from N`. The raw argv is the only
 * signal for intent, so the guard reads that.
 */
export function storedOnlyFlagsIn(argv: readonly string[]): string[] {
  const typed = STORED_ONLY_FLAGS.filter((f) =>
    argv.some((a) => a === `--${f}` || a.startsWith(`--${f}=`)),
  ) as string[];
  if (argv.includes('-y') && !typed.includes('yes')) typed.push('yes');
  return typed;
}

interface PendingDataMigration {
  /** `sys_migration` row id the run records. */
  id: string;
  command: string;
  /** What staying un-run costs, in this deployment's terms. */
  unlocks: string;
}

/**
 * The DATA migrations a metadata chain crossing into {@link VALUE_SHAPE_GATE_MAJOR}
 * leaves for the operator (ADR-0104's 2026-07-30 addendum, #3438).
 *
 * Metadata migration and data migration are different jobs with different
 * subjects: this command rewrites an author's source, while these two rewrite
 * (or vouch for) a deployment's rows, one deployment at a time. Nothing here
 * can run them, and — with no database in reach — nothing here can say whether
 * they have run; the booting server reports that. What this can do is make
 * sure the upgrade never *ends* without naming them, because a gate nobody is
 * told about is served by nobody.
 *
 * Listed only when the author's own metadata declares the field classes each
 * gate is about, so the advice is never noise.
 */
function pendingDataMigrations(stack: any, fromMajor: number, toMajor: number): PendingDataMigration[] {
  if (!(fromMajor < VALUE_SHAPE_GATE_MAJOR && toMajor >= VALUE_SHAPE_GATE_MAJOR)) return [];

  let media = false;
  let covered = false;
  for (const obj of (Array.isArray(stack?.objects) ? stack.objects : []) as any[]) {
    for (const def of Object.values(obj?.fields ?? {}) as any[]) {
      if (!def?.type) continue;
      if (FILE_REFERENCE_TYPES.has(def.type)) media = true;
      else if (REFERENCE_VALUE_TYPES.has(def.type) || STRUCTURED_JSON_TYPES.has(def.type)) covered = true;
    }
    if (media && covered) break;
  }

  const pending: PendingDataMigration[] = [];
  if (media) {
    pending.push({
      id: FILE_REFERENCES_MIGRATION_ID,
      command: 'os migrate files-to-references',
      unlocks:
        'converts legacy file values to sys_file references, then enforces media value shapes ' +
        'and lets released files be collected. Until it passes here, media values only warn and ' +
        'released files are kept forever.',
    });
  }
  if (covered) {
    pending.push({
      id: VALUE_SHAPES_MIGRATION_ID,
      command: 'os migrate value-shapes',
      unlocks:
        'scans stored reference and structured-JSON values against their field contracts. ' +
        'Until it passes here, a malformed value only warns.',
    });
  }
  return pending;
}

/** Print the data-migration advice — the last thing a crossing upgrade sees. */
function printPendingDataMigrations(pending: PendingDataMigration[]): void {
  if (pending.length === 0) return;
  console.log(chalk.bold('  Then, against each deployment\'s database:'));
  for (const m of pending) {
    console.log(`    ${chalk.cyan('→')} ${chalk.white(m.command)}`);
    console.log(chalk.dim(`        ${m.unlocks}`));
  }
  console.log(
    chalk.dim(
      '    Both are dry-run by default and report what they would do; `--apply` is the only ' +
        'writing mode. Not running them is safe — enforcement simply stays off here.',
    ),
  );
  console.log('');
}

/**
 * `os migrate meta --from N` — replay the ADR-0087 D3 migration chain.
 *
 * Composes the per-major steps N+1 → … → current and applies each major's
 * mechanical transforms (the graduated D2 conversions) to the loaded stack in
 * one run — cross-major is the designed-for case, not an edge. It reports a
 * generated, schema-validated diff (the mechanical rewrites) plus the structured
 * TODOs for the semantic changes the chain cannot apply, so the consumer agent
 * reviews a provably-valid change instead of hand-porting from prose.
 *
 * The command does not silently rewrite TS config source (that AST rewrite is
 * unsafe and lossy); `--out` writes the canonicalized stack as a JSON snapshot
 * the agent can diff and adopt. `--step` prints a per-hop checkpoint so a failure
 * can be bisected to the exact major.
 *
 * ## `--stored`: the same chain, over data at rest (#4327)
 *
 * The default mode above has one subject — the **author's source**, read from a
 * config file, with no database in reach. `--stored` has the other: the
 * `sys_metadata` rows of **one deployment**. Same chain, same canonical target,
 * opposite ends of the contract, which is why they share a command rather than
 * splitting into two that would both be called "migrate the metadata".
 *
 * They are mutually exclusive for the same reason: `--from` describes a
 * protocol major an author wrote against, and a stored row already carries its
 * own history — the stored pass replays the full chain (retired entries
 * included) because a row at rest has no author to ask. See
 * {@link MigrateMeta.runStored}.
 */
export default class MigrateMeta extends Command {
  static override description =
    'Replay the metadata protocol migration chain from a past major to current (ADR-0087 D3). ' +
    'With --stored, replay it over this deployment\'s sys_metadata rows instead of an authored config.';

  static override examples = [
    '$ os migrate meta --from 10',
    '$ os migrate meta --from 10 --step',
    '$ os migrate meta --from 11 --to 12 --json',
    '$ os migrate meta --from 10 --out migrated.stack.json',
    '$ os migrate meta --stored',
    '$ os migrate meta --stored --apply',
    '$ os migrate meta --stored --apply --yes --json',
    '$ os migrate meta --stored --type view --type object',
  ];

  static override args = {
    config: Args.string({ description: 'Path to the stack config (defaults to auto-detected).' }),
  };

  static override flags = {
    from: Flags.integer({
      description: 'The protocol major the metadata was authored against (required without --stored).',
      exclusive: ['stored'],
    }),
    to: Flags.integer({
      description: `Target protocol major (defaults to this runtime's, ${PROTOCOL_MAJOR}).`,
      exclusive: ['stored'],
    }),
    step: Flags.boolean({
      description: 'Print a per-hop checkpoint (for per-major verify / bisection).',
      default: false,
      exclusive: ['stored'],
    }),
    out: Flags.string({
      description: 'Write the migrated stack as a JSON snapshot to this path.',
      exclusive: ['stored'],
    }),
    stored: Flags.boolean({
      description:
        "Canonicalize this deployment's sys_metadata rows in place instead of an authored config "
        + '(read-only preview unless --apply).',
      default: false,
    }),
    'database-url': Flags.string({
      description: '--stored: database to canonicalize (defaults to $OS_DATABASE_URL / the project DB)',
      env: 'OS_DATABASE_URL',
    }),
    apply: Flags.boolean({
      description: '--stored: rewrite the rows (default is a read-only preview)',
      default: false,
    }),
    yes: Flags.boolean({
      char: 'y',
      description: '--stored: skip the --apply confirmation prompt',
      default: false,
    }),
    force: Flags.boolean({
      description: '--stored: apply even when another process is using the database (SQLite occupancy check)',
      default: false,
    }),
    type: Flags.string({
      description: '--stored: restrict to this metadata type (repeatable; default: every type)',
      multiple: true,
    }),
    json: Flags.boolean({ description: 'Output the machine-readable migration result as JSON.' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MigrateMeta);
    const timer = createTimer();

    if (flags.stored) {
      await this.runStored(flags, timer);
      return;
    }

    // A stored-only flag typed without `--stored` is refused rather than
    // ignored: `--apply` in particular reads as "and write it", and the
    // authored-source mode has nothing to write to.
    const typed = storedOnlyFlagsIn(this.argv);
    if (typed.length > 0) {
      const message =
        `${typed.map((f) => `--${f}`).join(', ')} only appl${typed.length > 1 ? 'y' : 'ies'} to `
        + '`os migrate meta --stored` (the pass over a deployment\'s sys_metadata rows). '
        + 'The authored-source chain reads a config file and writes nothing but --out.';
      if (flags.json) {
        await emitJson({ error: 'stored_only_flag', flags: typed, message }, 0, { compact: true });
        this.exit(1);
        return;
      }
      printError(message);
      this.exit(1);
      return;
    }

    // `--from` is required for the authored-source chain and meaningless for
    // `--stored` (a row carries its own history), so it is validated here
    // rather than declared `required` — oclif would reject `--stored` runs.
    if (flags.from === undefined) {
      const message =
        'Missing required flag --from (the protocol major your metadata was authored against). '
        + 'To canonicalize a deployment\'s stored rows instead, run `os migrate meta --stored`.';
      if (flags.json) {
        await emitJson({ error: 'missing_from_major', message }, 0, { compact: true });
        this.exit(1);
        return;
      }
      printError(message);
      this.exit(1);
      return;
    }
    const fromMajor = flags.from;
    const toMajor = flags.to ?? PROTOCOL_MAJOR;

    if (!flags.json) printHeader('Migrate · meta');

    try {
      if (!flags.json) printStep('Loading configuration…');
      // `authoredSource`: read the config as the author WROTE it, not as the
      // current schema would have it (#9418). A retired key is a `retiredKey()`
      // tombstone — the schema rejects it rather than stripping it — and a real
      // config runs that schema itself: `os init` scaffolds
      // `export default defineStack({ … })`, and every `define*` helper is a
      // `Schema.parse()`. So the refusal used to happen while the config module
      // was being EVALUATED, inside the load, before this command reached its
      // first conversion — leaving the codemod unable to open the one input
      // class it exists for, while the message it printed was the prescription
      // telling the author to run it.
      //
      // This is where "convert before validating" has to land, because the CLI
      // has no validation step of its own to move: the load is tolerant, and
      // the schema verdict is taken below on the MIGRATED stack instead
      // (`schemaValid`), which is the stack the author is being asked to adopt.
      const { config, absolutePath } = await loadConfig(args.config, { authoredSource: true });

      // Map→array normalization ONLY (convert:false): the chain must replay the
      // conversions itself against the raw authored source so each rewrite is
      // attributed to a chain hop, not silently pre-applied by the load-time
      // D2 pass. Running the D2 pass here would leave the chain's diff empty.
      const normalized = normalizeStackInput(config as Record<string, unknown>, { convert: false });

      if (!flags.json) printStep(`Replaying chain: protocol ${fromMajor} → ${toMajor}…`);
      const result = applyMetaMigrations(normalized, fromMajor, toMajor);

      // Prove the migrated stack is schema-valid — the "generated, provably valid
      // diff" the consumer agent reviews (ADR-0087 D3/D5).
      const parsed = ObjectStackDefinitionSchema.safeParse(result.stack);
      const specChanges = composeSpecChanges(fromMajor, toMajor);
      const dataMigrations = pendingDataMigrations(result.stack, result.fromMajor, result.toMajor);

      if (flags.json) {
        await emitJson({
              from: result.fromMajor,
              to: result.toMajor,
              runtime: PROTOCOL_VERSION,
              applied: result.applied,
              todos: result.todos,
              hops: flags.step
                ? result.hops.map((h) => ({
                    toMajor: h.toMajor,
                    rationale: h.rationale,
                    applied: h.applied,
                    todos: h.todos,
                  }))
                : undefined,
              specChanges,
              schemaValid: parsed.success,
              // Per-deployment data migrations this chain leaves to the
              // operator — the metadata is only half of a crossing upgrade.
              dataMigrations,
              duration: timer.elapsed(),
            });
        if (flags.out) writeFileSync(resolve(flags.out), JSON.stringify(result.stack, null, 2));
        return;
      }

      printInfo(`Config: ${chalk.white(absolutePath)}`);
      printInfo(`Chain:  protocol ${fromMajor} → ${toMajor} (runtime ${PROTOCOL_VERSION})`);
      console.log('');

      if (result.applied.length === 0 && result.todos.length === 0) {
        printSuccess('Nothing to migrate — the metadata is already canonical for this range.');
        // Still advertise: metadata needing no rewrite says nothing about
        // whether this deployment's DATA has been migrated.
        console.log('');
        printPendingDataMigrations(dataMigrations);
        return;
      }

      // Mechanical rewrites (auto-applied).
      if (result.applied.length > 0) {
        console.log(chalk.bold(`  Applied ${result.applied.length} mechanical change(s):`));
        for (const a of result.applied) {
          console.log(`    • ${a.path}: ${chalk.red(a.from)} → ${chalk.green(a.to)} ${chalk.dim(`(${a.conversionId})`)}`);
        }
        console.log('');
      }

      // Per-hop checkpoints.
      if (flags.step) {
        for (const hop of result.hops) {
          console.log(chalk.bold(`  ── protocol ${hop.toMajor} ──`));
          console.log(chalk.dim(`     ${hop.rationale}`));
          console.log(chalk.dim(`     ${hop.applied.length} mechanical, ${hop.todos.length} manual`));
        }
        console.log('');
      }

      // Semantic TODOs (delegated to the agent — never auto-applied).
      if (result.todos.length > 0) {
        console.log(chalk.bold(chalk.yellow(`  ${result.todos.length} manual change(s) require your judgment:`)));
        for (const t of result.todos) {
          console.log(`    ${chalk.yellow('⚠')} [protocol ${t.toMajor}] ${t.surface} → ${t.replacement}`);
          console.log(chalk.dim(`        why:    ${t.reason}`));
          console.log(chalk.dim(`        verify: ${t.acceptanceCriteria}`));
        }
        console.log('');
      }

      if (flags.out) {
        writeFileSync(resolve(flags.out), JSON.stringify(result.stack, null, 2));
        printInfo(`Wrote migrated stack snapshot → ${chalk.white(resolve(flags.out))}`);
      }

      printPendingDataMigrations(dataMigrations);

      if (parsed.success) {
        printSuccess(`Migrated stack is schema-valid ${chalk.dim(`(${timer.display()})`)}`);
      } else {
        printWarning(
          'Migrated stack does not yet pass schema validation — resolve the manual changes above, ' +
            'then run `os validate`.',
        );
      }
      console.log('');
    } catch (error: any) {
      if (error instanceof MigrationFloorError) {
        if (flags.json) {
          await emitJson({ error: 'unsupported_from_major', message: error.message }, 0, { compact: true });
          this.exit(1);
        }
        printError(error.message);
        this.exit(1);
        return;
      }
      if (flags.json) {
        await emitJson({ error: error.message }, 0, { compact: true });
        this.exit(1);
      }
      printError(error.message || String(error));
      this.exit(1);
    }
  }

  /**
   * `os migrate meta --stored` — canonicalize this deployment's `sys_metadata`
   * rows so the read-path conversion chain has a finish line (#4327).
   *
   * #4317 made every stored-row rehydration seam replay the full ADR-0087 chain,
   * so a row written under any past protocol *reads* canonical forever. The rows
   * stayed legacy, though: the chain re-lowers them on every load and each one
   * warns once per boot. This run ends that — same chain, same policy, but the
   * result is written back through the normal write path (history row, checksum,
   * mutation projectors) with `source: 'migrate-stored'`.
   *
   * **Preview by default; `--apply` is the only writing mode.** That is the
   * house rule its two siblings already keep (`os migrate value-shapes`,
   * `os migrate files-to-references`, #3617's "a dry run changes nothing"), and
   * the reason applies with more force here: this rewrites *metadata*, so a
   * surprise run would move every affected row's checksum and mint a history
   * entry against each.
   *
   * Nothing gates on this having run — #3855's conclusion that operator-run
   * migrations cannot be relied on still holds, and the read path stays the
   * guarantee. What a run buys is hygiene plus one thing that was previously
   * unobtainable: **an operator can now assert it.** A second pass reporting
   * every row canonical exits 0; a deployment with work left exits 1, so "my
   * metadata is on protocol N" becomes a CI check instead of a belief.
   */
  private async runStored(
    flags: {
      json: boolean;
      apply: boolean;
      yes: boolean;
      force: boolean;
      type?: string[];
      'database-url'?: string;
    },
    timer: { elapsed: () => number; display: () => string },
  ): Promise<void> {
    const apply = flags.apply;
    if (!flags.json) printHeader('Migrate · meta --stored');

    // Occupancy gate — an apply run rewrites rows, so a live writer on the same
    // SQLite file is the same hazard `os migrate files-to-references --apply`
    // refuses for. Probed BEFORE boot (afterwards our own pool is what the probe
    // finds) and before the prompt, so nobody confirms something we then refuse.
    const occupancy = await probeMigrationTarget(flags['database-url']);
    if (occupancy.status === 'busy' && apply && !flags.force) {
      if (flags.json) {
        await emitJson({
          error: 'database_busy',
          database: occupancy.filename,
          signal: occupancy.signal,
          detail: occupancy.detail,
          hint: OCCUPANCY_HINT,
        }, 0, { compact: true });
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
        ? `--force: ${describeOccupancy(occupancy)} Rewriting anyway — the live process may save metadata mid-run.`
        : `${describeOccupancy(occupancy)} The preview below writes nothing, but a live process may `
          + 'be saving metadata while it runs.');
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
        printWarning(
          'Apply mode rewrites sys_metadata rows in place — each rewritten row gets a new checksum '
          + 'and a history entry. Re-run with --yes to confirm, or run without --apply to preview.',
        );
        this.exit(1);
        return;
      }
      const ok = await confirm(
        chalk.bold('\nRewrite the stored metadata rows that carry a pre-protocol shape? [y/N] '),
      );
      if (!ok) {
        printInfo('Aborted — nothing written.');
        return;
      }
    }

    if (!flags.json) {
      printStep(apply ? 'Booting data stack (APPLY mode)…' : 'Booting data stack (preview only)…');
    }

    let stack;
    try {
      // `PlatformObjectsPlugin` for `sys_metadata` and its history/audit
      // siblings, plus the automation engine in INERT mode so `flow` rows are
      // covered too (#4454) — flow-node conversions need its executor registry
      // for the conflict guard, and `armRuntime: false` means taking it arms
      // nothing. No storage adapter: unlike the file migration, nothing here
      // reads bytes.
      stack = await bootSchemaStack({
        jsonOutput: flags.json,
        ...(flags['database-url'] ? { databaseUrl: flags['database-url'] } : {}),
        extraPlugins: await buildDataMigrationPlugins({ automation: true }),
      });
    } catch (error: any) {
      if (flags.json) { await emitJson({ error: error.message }, 0, { compact: true }); this.exit(1); return; }
      printError(error.message || String(error));
      this.exit(1);
      return;
    }

    // Collected rather than thrown: `this.exit()` raises an oclif ExitError,
    // which the catch below would then report as a bare "EEXIT: 1" over the
    // real message. Decide the code here, exit after the stack is down.
    let exitCode = 0;
    try {
      const protocol: any = stack.kernel.getService('protocol');
      if (typeof protocol?.migrateStoredMetadata !== 'function') {
        throw new Error(
          'No metadata protocol on this stack — cannot walk sys_metadata. '
          + 'Run this from a project root whose stack registers the ObjectQL engine.',
        );
      }

      const { formatStoredMigrationReport, storedMigrationClean } =
        await import('@objectstack/metadata-protocol');

      // No `canonicalizeFlow` is threaded from here. The automation engine
      // canonicalizes `flow` rows — it holds the executor registry ADR-0078's
      // conflict guard needs (#4454) — and the protocol resolves it from the
      // kernel's service table itself (#4498), which is the same table the
      // inert engine this command boots registers into. Passing it again would
      // be a second route to one capability, and the two would drift.
      // Absent (an older stack, or a boot that skipped it), flow rows keep
      // reporting `skipped` with the reason rather than being counted done.
      const report = await protocol.migrateStoredMetadata({
        apply,
        ...(flags.type && flags.type.length > 0 ? { types: flags.type } : {}),
        actor: 'os migrate meta --stored',
      });
      const clean = storedMigrationClean(report);
      if (!clean) exitCode = 1;

      if (flags.json) {
        await emitJson({ database: stack.dbLabel, ...report, clean, duration: timer.elapsed() });
      } else {
        printInfo(`Database: ${chalk.white(stack.dbLabel)}`);
        console.log('');
        console.log(formatStoredMigrationReport(report).join('\n'));
        console.log('');

        if (report.scanned === 0) {
          // Exits 0 — nothing is wrong — but does not claim a clean bill for a
          // database it never read a row from.
          printInfo(`No stored metadata to examine ${chalk.dim(`(${timer.display()})`)}`);
        } else if (clean && apply) {
          printSuccess(
            `Stored metadata is on protocol ${report.protocol} — rewrote ${report.rewritten} row(s) `
            + `${chalk.dim(`(${timer.display()})`)}`,
          );
        } else if (clean) {
          printSuccess(
            `Stored metadata is already on protocol ${report.protocol} — nothing to rewrite `
            + `${chalk.dim(`(${timer.display()})`)}`,
          );
        } else if (report.failed > 0) {
          printError(
            `${report.failed} row(s) could not be rewritten. They keep reading canonically through the `
            + 'chain, so nothing is broken — but their stored bytes stay legacy until the reason above is fixed.',
          );
        } else {
          printWarning(
            `${report.pending} row(s) carry a pre-protocol shape. They read canonically today (the chain `
            + 'runs on every load); re-run with --apply to persist it.',
          );
        }
      }
    } catch (error: any) {
      exitCode = 1;
      if (flags.json) await emitJson({ error: error.message }, 0, { compact: true });
      else printError(error.message || String(error));
    } finally {
      await stack.shutdown();
    }
    if (exitCode !== 0) this.exit(exitCode);
  }
}
