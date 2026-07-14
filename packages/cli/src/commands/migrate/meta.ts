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
import { loadConfig } from '../../utils/config.js';
import {
  printHeader,
  printSuccess,
  printWarning,
  printError,
  printInfo,
  printStep,
  createTimer,
} from '../../utils/format.js';

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

      if (flags.json) {
        console.log(
          JSON.stringify(
            {
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
              duration: timer.elapsed(),
            },
            null,
            2,
          ),
        );
        if (flags.out) writeFileSync(resolve(flags.out), JSON.stringify(result.stack, null, 2));
        return;
      }

      printInfo(`Config: ${chalk.white(absolutePath)}`);
      printInfo(`Chain:  protocol ${flags.from} → ${toMajor} (runtime ${PROTOCOL_VERSION})`);
      console.log('');

      if (result.applied.length === 0 && result.todos.length === 0) {
        printSuccess('Nothing to migrate — the metadata is already canonical for this range.');
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
          console.log(JSON.stringify({ error: 'unsupported_from_major', message: error.message }));
          this.exit(1);
        }
        printError(error.message);
        this.exit(1);
        return;
      }
      if (flags.json) {
        console.log(JSON.stringify({ error: error.message }));
        this.exit(1);
      }
      printError(error.message || String(error));
      this.exit(1);
    }
  }
}
