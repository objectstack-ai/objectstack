// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

/** The protocol major that introduced the per-deployment value-shape gates. */
const VALUE_SHAPE_GATE_MAJOR = 17;

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
 */
export default class MigrateMeta extends Command {
  static override description =
    'Replay the metadata protocol migration chain from a past major to current (ADR-0087 D3).';

  static override examples = [
    '$ os migrate meta --from 10',
    '$ os migrate meta --from 10 --step',
    '$ os migrate meta --from 11 --to 12 --json',
    '$ os migrate meta --from 10 --out migrated.stack.json',
  ];

  static override args = {
    config: Args.string({ description: 'Path to the stack config (defaults to auto-detected).' }),
  };

  static override flags = {
    from: Flags.integer({
      description: 'The protocol major the metadata was authored against.',
      required: true,
    }),
    to: Flags.integer({
      description: `Target protocol major (defaults to this runtime's, ${PROTOCOL_MAJOR}).`,
    }),
    step: Flags.boolean({
      description: 'Print a per-hop checkpoint (for per-major verify / bisection).',
      default: false,
    }),
    out: Flags.string({ description: 'Write the migrated stack as a JSON snapshot to this path.' }),
    json: Flags.boolean({ description: 'Output the machine-readable migration result as JSON.' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MigrateMeta);
    const timer = createTimer();
    const toMajor = flags.to ?? PROTOCOL_MAJOR;

    if (!flags.json) printHeader('Migrate · meta');

    try {
      if (!flags.json) printStep('Loading configuration…');
      const { config, absolutePath } = await loadConfig(args.config);

      // Map→array normalization ONLY (convert:false): the chain must replay the
      // conversions itself against the raw authored source so each rewrite is
      // attributed to a chain hop, not silently pre-applied by the load-time
      // D2 pass. Running the D2 pass here would leave the chain's diff empty.
      const normalized = normalizeStackInput(config as Record<string, unknown>, { convert: false });

      if (!flags.json) printStep(`Replaying chain: protocol ${flags.from} → ${toMajor}…`);
      const result = applyMetaMigrations(normalized, flags.from, toMajor);

      // Prove the migrated stack is schema-valid — the "generated, provably valid
      // diff" the consumer agent reviews (ADR-0087 D3/D5).
      const parsed = ObjectStackDefinitionSchema.safeParse(result.stack);
      const specChanges = composeSpecChanges(flags.from, toMajor);
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
      printInfo(`Chain:  protocol ${flags.from} → ${toMajor} (runtime ${PROTOCOL_VERSION})`);
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
}
