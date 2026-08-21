// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import { dirname } from 'node:path';
import chalk from 'chalk';
import { ZodError } from 'zod';
import {
  ObjectStackDefinitionSchema,
  normalizeStackInput,
  lintUnknownAuthoringKeys,
  lintUnknownStackKeys,
  formatUnknownAuthoringKey,
  type ConversionNotice,
} from '@objectstack/spec';
import { loadConfig } from '../utils/config.js';
import { runAuthoringRules, splitBySeverity, authoringRulesFor } from '@objectstack/lint';
import { resolveSduiManifest } from '../utils/sdui-manifest.js';
import { preflightRequiredCapabilities, renderCapabilityMessage } from '../utils/capability-preflight.js';
import { collectAndLintDocs } from '../utils/collect-docs.js';
import {
  printHeader,
  printKV,
  printSuccess,
  printError,
  printStep,
  createTimer,
  formatZodErrors,
  collectMetadataStats,
  printMetadataStats,
  emitJson,
  isExitSignal,
} from '../utils/format.js';
import { checkSpecVersionGap } from '../utils/spec-version.js';

export default class Validate extends Command {
  static override description =
    'Validate ObjectStack configuration against the protocol schema, CEL expressions, and widget bindings (no artifact emitted)';

  static override args = {
    config: Args.string({ description: 'Configuration file path', required: false }),
  };

  static override flags = {
    strict: Flags.boolean({ description: 'Treat warnings as errors' }),
    json: Flags.boolean({ description: 'Output results as JSON' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Validate);

    const timer = createTimer();

    if (!flags.json) {
      printHeader('Validate');
    }

    try {
      // 1. Load configuration
      if (!flags.json) printStep('Loading configuration...');
      const { config, absolutePath, duration } = await loadConfig(args.config);

      if (!flags.json) {
        printKV('Config', absolutePath);
        printKV('Load time', `${duration}ms`);
      }

      // 2. Normalize map-formatted stack definition and validate against schema.
      //    The ADR-0087 D2 conversion layer runs here (inside normalizeStackInput);
      //    surface each applied conversion as a non-blocking deprecation notice so
      //    the author knows the source still carries an old-shape key that will
      //    retire from the load path in a future major.
      if (!flags.json) printStep('Validating against ObjectStack Protocol...');
      const conversionNotices: ConversionNotice[] = [];
      const normalized = normalizeStackInput(config as Record<string, unknown>, {
        onConversionNotice: (n) => conversionNotices.push(n),
      });
      // [#3786] Keys `ObjectSchema` / `FieldSchema` do not declare, and so drop
      // silently. PRE-parse for the same reason the registry's `normalized`-tier
      // rules are: the parse is what strips them, so `result.data` no longer
      // carries the key the author actually wrote. Computed here rather than
      // down in the warnings section so the `--json` path reports it too — the
      // "computed, then discarded" shape this file already had to fix once.
      const unknownKeyWarnings = [
        ...lintUnknownStackKeys(normalized as Record<string, unknown>, ObjectStackDefinitionSchema),
        ...lintUnknownAuthoringKeys(normalized as Record<string, unknown>, ObjectStackDefinitionSchema),
      ].map(formatUnknownAuthoringKey);
      const result = ObjectStackDefinitionSchema.safeParse(normalized);

      if (!result.success) {
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: (result.error as unknown as ZodError).issues,
            duration: timer.elapsed(),
          });
          this.exit(1);
        }

        console.log('');
        printError('Validation failed');
        formatZodErrors(result.error as unknown as ZodError);
        this.exit(1);
      }

      // 3. The author-time rule registry (#4409). Every rule the three authoring
      //    commands share — expressions, view shape, widget/action/filter/name
      //    references, SDUI styling, page sources, security posture, the CLI's
      //    own authoring lints — runs from ONE table, so `os validate`,
      //    `os build` and `os lint` hold a stack to the same bar by construction.
      //    Before it, each command hand-wired its own subset: 23 of 26 rules ran
      //    on some strict subset of the three, and `os build` — the command that
      //    PUBLISHES — was the weakest gate of the three.
      //
      //    Which rules run, on which stack tier, and why any of them is scoped
      //    is declared in `lint/authoring-rules.ts`. Do not add a call site here.
      const registered = authoringRulesFor('validate');
      if (!flags.json) printStep(`Running author-time rules (${registered.length})...`);
      const findings = runAuthoringRules('validate', {
        normalized: normalized as Record<string, unknown>,
        parsed: result.data as Record<string, unknown>,
        sduiManifest: resolveSduiManifest(),
      });
      const { errors: ruleErrors, advisories: ruleAdvisories } = splitBySeverity(findings);

      if (ruleErrors.length > 0) {
        // Every failing rule reports at once. The command used to exit at the
        // first failing gate, so an author with three unrelated problems fixed
        // them in three round trips and could not see how deep the hole went.
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: ruleErrors,
            warnings: ruleAdvisories,
            duration: timer.elapsed(),
          });
          this.exit(1);
        }
        console.log('');
        printError(`Author-time rules failed (${ruleErrors.length} issue${ruleErrors.length > 1 ? 's' : ''})`);
        for (const f of ruleErrors.slice(0, 50)) {
          console.log(`  • ${f.where}: ${f.message}`);
          console.log(chalk.dim(`      ${f.hint}`));
          console.log(chalk.dim(`      rule: ${f.rule}  at ${f.path}`));
        }
        this.exit(1);
      }

      // 3b. [#3366] Installable-provider preflight — the shift-left of the
      //     `serve`-time capability check. `os validate` previously only checked
      //     the `requires` tokens against the vocabulary (ADR-0066), never
      //     whether each token's provider is resolvable in the active edition. A
      //     token whose provider has NO installable version here (e.g. `ai` →
      //     @objectstack/service-ai, cloud-only) fails; absent-but-installable is
      //     an advisory `pnpm add` hint. Mirrors the `os build` gate exactly.
      //
      //     Not a registry rule: it reads `node_modules`, not the stack.
      if (!flags.json) printStep('Checking capability providers (#3366)...');
      const capProviderPreflight = preflightRequiredCapabilities({
        requires: Array.isArray((config as { requires?: unknown[] }).requires)
          ? ((config as { requires?: unknown[] }).requires as unknown[])
          : [],
        projectDir: dirname(absolutePath),
      });
      const capProviderErrors = capProviderPreflight.errors;
      const capProviderWarnings = capProviderPreflight.warnings.map((c) => ({
        token: c.token,
        message: renderCapabilityMessage(c),
      }));
      if (capProviderErrors.length > 0) {
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: capProviderErrors.map((c) => ({ token: c.token, message: renderCapabilityMessage(c) })),
            duration: timer.elapsed(),
          });
          this.exit(1);
        }
        console.log('');
        printError(`Capability provider check failed (${capProviderErrors.length} issue${capProviderErrors.length > 1 ? 's' : ''})`);
        for (const c of capProviderErrors) {
          console.log(`  • ${renderCapabilityMessage(c)}`);
        }
        this.exit(1);
      }

      // 3c. Package docs (ADR-0046) — flatness, namespace-prefixed names, the
      //     MDX/image ban, same-package link resolution. `os build` has always
      //     FAILED on a doc error (the artifact is the publish unit, so that is
      //     the publish lint for docs) while this command never ran it: the same
      //     "build rejects what validate accepts" hole #4409 found among the
      //     metadata rules, one gate over. It went unnoticed because the parity
      //     guard keyed on the `lint*`/`validate*` naming convention and this
      //     one is called `collectAndLintDocs`.
      //
      //     Not a registry rule: it reads `src/docs/*.md` off disk.
      if (!flags.json) printStep('Checking package docs (ADR-0046)...');
      const docsResult = collectAndLintDocs(absolutePath, result.data as Record<string, unknown>);
      const docErrors = docsResult.issues.filter((i) => i.severity === 'error');
      const docWarnings = docsResult.issues.filter((i) => i.severity !== 'error');
      if (docErrors.length > 0) {
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: docErrors,
            warnings: ruleAdvisories,
            duration: timer.elapsed(),
          });
          this.exit(1);
        }
        console.log('');
        printError(`Package docs validation failed (${docErrors.length} issue${docErrors.length > 1 ? 's' : ''})`);
        for (const i of docErrors.slice(0, 50)) {
          console.log(`  • ${i.path}: ${i.message}`);
          console.log(chalk.dim(`      rule: ${i.rule}`));
        }
        this.exit(1);
      }

      // 4. Collect and display stats
      const stats = collectMetadataStats(config);

      // Spec-version drift advisory (non-blocking): if the installed platform
      // is a newer major than the app declares, point at the migration guide.
      const specGap = checkSpecVersionGap(config.manifest);

      if (flags.json) {
        await emitJson({
          valid: true,
          manifest: config.manifest,
          stats,
          // One advisory list for the whole registry. This used to be a
          // hand-maintained concatenation of per-gate arrays, and it leaked
          // twice: warnings computed and then dropped from `--json` while the
          // console printed them. A single list cannot drift from itself.
          warnings: [...ruleAdvisories, ...docWarnings, ...unknownKeyWarnings, ...capProviderWarnings],
          conversions: conversionNotices,
          specVersionGap: specGap,
          duration: timer.elapsed(),
        });
        return;
      }

      // 5. Warnings (non-blocking)
      const warnings: string[] = [];

      // [#3366] Installable-provider hints — a declared capability whose provider
      // is absent but addable (`pnpm add`), or an unknown token (typo).
      for (const w of capProviderWarnings) {
        warnings.push(w.message);
      }

      // [#3786] Undeclared object/field keys — computed pre-parse above,
      // alongside `normalized`, for the same reason.
      warnings.push(...unknownKeyWarnings);

      // ADR-0087 D2 conversion notices: the source used a deprecated shape that
      // was auto-converted at load. No action is required to keep loading, but
      // the notice steers the author to the canonical key before it retires.
      for (const n of conversionNotices) {
        warnings.push(`${n.path}: '${n.from}' → '${n.to}' (converted at load; conversion '${n.conversionId}', retires in protocol ${n.retiresIn})`);
      }

      // Every advisory the registry raised. All of them feed `--strict` now:
      // before, roughly half were printed inline and invisible to it, so
      // `--strict` failed or passed depending on which gate happened to raise
      // the finding — a second, quieter version of the same coverage drift.
      for (const f of ruleAdvisories) {
        warnings.push(`${f.where}: ${f.message}`);
      }
      for (const w of docWarnings) {
        warnings.push(`${w.path}: ${w.message}`);
      }

      if (stats.objects === 0) {
        warnings.push('No objects defined — this stack has no data model');
      }
      if (stats.apps === 0 && stats.plugins === 0) {
        warnings.push('No apps or plugins defined — this stack may not do much');
      }
      if (!config.manifest?.id) {
        warnings.push('Missing manifest.id — required for deployment');
      }
      if (!config.manifest?.namespace) {
        warnings.push('Missing manifest.namespace — required for multi-app hosting');
      }

      // 6. Display results
      console.log('');
      printSuccess(`Validation passed ${chalk.dim(`(${timer.display()})`)}`);
      console.log('');

      if (config.manifest) {
        console.log(`  ${chalk.bold(config.manifest.name || config.manifest.id || 'Unnamed')} ${chalk.dim(`v${config.manifest.version || '0.0.0'}`)}`);
        if (config.manifest.description) {
          console.log(chalk.dim(`  ${config.manifest.description}`));
        }
        console.log('');
      }

      printMetadataStats(stats);

      if (warnings.length > 0) {
        console.log('');
        for (const w of warnings) {
          console.log(chalk.yellow(`  ⚠ ${w}`));
        }
        if (flags.strict) {
          console.log('');
          printError('Strict mode: warnings treated as errors');
          this.exit(1);
        }
      }

      // Non-blocking upgrade advisory — never gated by --strict.
      if (specGap) {
        console.log('');
        console.log(chalk.yellow(`  ⚠ ${specGap.message}`));
        console.log(chalk.dim(`      → ${specGap.hint}`));
      }

      console.log('');
    } catch (error: any) {
      if (isExitSignal(error)) throw error;
      if (flags.json) {
        await emitJson({
          valid: false,
          error: error.message,
          duration: timer.elapsed(),
        });
        this.exit(1);
      }
      console.log('');
      printError(error.message || String(error));
      this.exit(1);
    }
  }
}
