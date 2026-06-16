// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import { ZodError } from 'zod';
import { ObjectStackDefinitionSchema, normalizeStackInput } from '@objectstack/spec';
import { loadConfig } from '../utils/config.js';
import { lowerCallables } from '../utils/lower-callables.js';
import { validateStackExpressions } from '../utils/validate-expressions.js';
import { validateWidgetBindings } from '../utils/validate-widget-bindings.js';
import { lintFlowPatterns } from '../utils/lint-flow-patterns.js';
import { lintLivenessProperties } from '../utils/lint-liveness-properties.js';
import { collectAndLintDocs } from '../utils/collect-docs.js';
import { buildRuntimeBundle, cleanupOldRuntimeBundles } from '../utils/build-runtime.js';
import {
  printHeader,
  printKV,
  printSuccess,
  printError,
  printStep,
  printWarning,
  createTimer,
  formatZodErrors,
  collectMetadataStats,
  printMetadataStats,
} from '../utils/format.js';

export default class Compile extends Command {
  static override description = 'Compile ObjectStack configuration to JSON artifact';

  static override args = {
    config: Args.string({ description: 'Source configuration file', required: false }),
  };

  static override flags = {
    output: Flags.string({ char: 'o', description: 'Output JSON file', default: 'dist/objectstack.json' }),
    json: Flags.boolean({ description: 'Output compile result as JSON (for CI)' }),
    'strict-body': Flags.boolean({
      description: 'Fail the build if any hook/action callable could not be lowered into a metadata-only body (no .mjs fallback)',
      default: false,
    }),
    'runtime-bundle': Flags.boolean({
      description: 'Force-emit the legacy objectstack-runtime.{hash}.mjs shim even when every callable has a metadata body. Useful for back-compat with older runtime loaders. By default the bundle is auto-emitted only when at least one callable could not be lowered to a body.',
      default: false,
      allowNo: true,
    }),
    // Deprecated alias kept for back-compat. Auto-skip is now the default,
    // so this flag is a no-op except that it forces a hard failure when any
    // callable still needs the legacy bundle (same semantics as before).
    'no-runtime-bundle': Flags.boolean({
      description: '[deprecated] Auto-skip is now the default. Pass --no-runtime-bundle to fail loudly if any callable still requires the legacy bundle.',
      default: false,
      hidden: true,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Compile);
    const timer = createTimer();

    if (!flags.json) {
      printHeader('Compile');
    }

    try {
      // 1. Load Configuration
      if (!flags.json) printStep('Loading configuration...');
      const { config, absolutePath, duration } = await loadConfig(args.config);

      if (!flags.json) {
        printKV('Config', path.relative(process.cwd(), absolutePath));
        printKV('Load time', `${duration}ms`);
      }

      // 2. Normalize map-formatted stack definition.
      if (!flags.json) printStep('Normalizing stack definition...');
      const normalized = normalizeStackInput(config as Record<string, unknown>);

      // 2b. Lower inline `function` handlers (Hook.handler, top-level
      //     `functions`) to stable string refs BEFORE Zod parse. This
      //     guarantees we extract the user's real function identity (Zod's
      //     `z.function()` wraps callables and would otherwise break the
      //     mapping). The originals are bundled into a sibling ESM module
      //     by esbuild — without this step `JSON.stringify` would silently
      //     drop every handler and the production server would boot with
      //     all hooks disabled.
      if (!flags.json) printStep('Lowering inline handlers...');
      const lowering = lowerCallables(normalized);

      // Strict-body gate: refuse to ship if any callable failed body extraction.
      // Body-only is the long-term target — `--strict-body` lets CI enforce it
      // before ESM-bundle emission becomes mandatory-off.
      const missingBody = lowering.count - lowering.bodyExtracted;
      if (flags['strict-body']) {
        const issues = [
          ...lowering.bodyExtractionWarnings,
          ...(missingBody > 0
            ? [{ origin: '<aggregate>', reason: `${missingBody} callable(s) lowered to handler ref but produced no body` }]
            : []),
        ];
        if (issues.length > 0) {
          if (flags.json) {
            console.log(JSON.stringify({ success: false, error: 'strict-body: missing body', issues }));
            this.exit(1);
          }
          console.log('');
          printError(`--strict-body: ${issues.length} callable(s) lack a metadata body`);
          for (const w of issues.slice(0, 20)) {
            console.log(`  • ${w.origin}: ${w.reason}`);
          }
          this.exit(1);
        }
      }

      // 3. Validate the lowered (JSON-safe) stack against the Protocol.
      if (!flags.json) printStep('Validating protocol compliance...');
      const result = ObjectStackDefinitionSchema.safeParse(lowering.lowered);

      if (!result.success) {
        if (flags.json) {
          console.log(JSON.stringify({ success: false, errors: (result.error as unknown as ZodError).issues }));
          this.exit(1);
        }
        console.log('');
        printError('Validation failed');
        formatZodErrors(result.error as unknown as ZodError);
        this.exit(1);
      }

      // 3b. Validate expressions against the resolved schema (ADR-0032 §1a/1b).
      //     The whole normalized stack is in hand here, so flow/validation
      //     predicates are checked for CEL syntax AND that `record.<field>`
      //     references exist on the target object — failing the build with a
      //     located, corrective message instead of a silent runtime `false`.
      if (!flags.json) printStep('Validating expressions (ADR-0032)...');
      const exprIssues = validateStackExpressions(result.data as Record<string, unknown>);
      const exprErrors = exprIssues.filter((i) => i.severity !== 'warning');
      const exprWarnings = exprIssues.filter((i) => i.severity === 'warning');
      if (exprErrors.length > 0) {
        if (flags.json) {
          console.log(JSON.stringify({ success: false, error: 'expression validation failed', issues: exprErrors, warnings: exprWarnings }));
          this.exit(1);
        }
        console.log('');
        printError(`Expression validation failed (${exprErrors.length} issue${exprErrors.length > 1 ? 's' : ''})`);
        for (const i of exprErrors.slice(0, 50)) {
          console.log(`  • ${i.where}: ${i.message}`);
          console.log(`      source: \`${i.source}\``);
        }
        this.exit(1);
      }
      // Advisory expression warnings (#1928 tier 3) — surfaced, never fatal.
      if (exprWarnings.length > 0 && !flags.json) {
        printWarning(`Expression warnings (${exprWarnings.length})`);
        for (const i of exprWarnings.slice(0, 50)) {
          console.log(`  • ${i.where}: ${i.message}`);
          console.log(`      source: \`${i.source}\``);
        }
      }

      // 3c. Widget-binding diagnostics (issues #1719/#1721) — semantic checks
      //     that need the widget's `dataset` reference resolved to its dataset
      //     and `dimensions`/`values` resolved to declared names. Errors are
      //     unresolvable bindings (dangling dataset/dimension/measure or a
      //     chartConfig field the query result won't contain) and fail the
      //     build; warnings are advisory and suppressible per widget via
      //     `suppressWarnings: ['<rule-id>']`.
      if (!flags.json) printStep('Checking dashboard widget bindings (ADR-0021)...');
      const widgetFindings = validateWidgetBindings(result.data as Record<string, unknown>);
      const widgetErrors = widgetFindings.filter((f) => f.severity === 'error');
      const widgetWarnings = widgetFindings.filter((f) => f.severity === 'warning');
      if (widgetErrors.length > 0) {
        if (flags.json) {
          console.log(JSON.stringify({ success: false, error: 'widget binding validation failed', issues: widgetErrors }));
          this.exit(1);
        }
        console.log('');
        printError(`Dashboard widget integrity failed (${widgetErrors.length} issue${widgetErrors.length > 1 ? 's' : ''})`);
        for (const f of widgetErrors.slice(0, 50)) {
          console.log(`  • ${f.where}: ${f.message}`);
          console.log(chalk.dim(`      ${f.hint}`));
          console.log(chalk.dim(`      rule: ${f.rule}  at ${f.path}`));
        }
        this.exit(1);
      }
      if (widgetWarnings.length > 0 && !flags.json) {
        console.log('');
        for (const w of widgetWarnings) {
          printWarning(`${w.where}: ${w.message}`);
          console.log(chalk.dim(`    ${w.hint}`));
          console.log(chalk.dim(`    rule: ${w.rule}  at ${w.path}`));
        }
      }

      // 3d. Flow authoring anti-pattern lint (#1874) — advisory warnings for
      //     valid-but-fragile flow metadata (e.g. a record-change trigger using a
      //     date-EQUALITY time condition that only fires on the exact day). Guides
      //     the author — very often an AI generating templates — toward the robust
      //     pattern; NEVER fails the build.
      const flowLint = lintFlowPatterns(result.data as Record<string, unknown>);
      if (flowLint.length > 0 && !flags.json) {
        console.log('');
        for (const fnd of flowLint) {
          printWarning(`${fnd.where}: ${fnd.message}`);
          console.log(chalk.dim(`    ${fnd.hint}`));
          console.log(chalk.dim(`    rule: ${fnd.rule}`));
        }
      }

      // 3d-bis. Liveness author-warning lint — close the spec-liveness loop on
      //     the author side: an authored property the ledger marks dead-and-
      //     misleading (e.g. `object.enable.feeds`, `field.columnName`) or
      //     experimental is set hopefully but does nothing / isn't enforced at
      //     runtime. Advisory only; ledger-driven (entries opt in via
      //     `authorWarn`), so it's high-signal and NEVER fails the build.
      const livenessLint = lintLivenessProperties(result.data as Record<string, unknown>);
      if (livenessLint.length > 0 && !flags.json) {
        console.log('');
        for (const fnd of livenessLint) {
          printWarning(`${fnd.where}: ${fnd.message}`);
          console.log(chalk.dim(`    ${fnd.hint}`));
          console.log(chalk.dim(`    rule: ${fnd.rule}`));
        }
      }

      // 3d. Package docs (ADR-0046): compile flat `src/docs/*.md` into
      //     `docs: DocSchema[]` and lint the combined set (flatness,
      //     namespace-prefixed names, MDX/image ban, same-package link
      //     resolution). Errors fail the build — the artifact is the
      //     publish unit, so this IS the publish lint for docs.
      if (!flags.json) printStep('Collecting package docs (ADR-0046)...');
      const docsResult = collectAndLintDocs(absolutePath, result.data as Record<string, unknown>);
      const docErrors = docsResult.issues.filter((i) => i.severity === 'error');
      const docWarnings = docsResult.issues.filter((i) => i.severity === 'warning');
      if (docErrors.length > 0) {
        if (flags.json) {
          console.log(JSON.stringify({ success: false, error: 'docs validation failed', issues: docErrors }));
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
      if (docWarnings.length > 0 && !flags.json) {
        console.log('');
        for (const w of docWarnings) {
          printWarning(`${w.path}: ${w.message}`);
          console.log(chalk.dim(`    rule: ${w.rule}`));
        }
      }

      // 4. Generate Artifact
      if (!flags.json) printStep('Writing artifact...');
      const output = flags.output!;
      const artifactPath = path.resolve(process.cwd(), output);
      const artifactDir = path.dirname(artifactPath);

      if (!fs.existsSync(artifactDir)) {
        fs.mkdirSync(artifactDir, { recursive: true });
      }

      const finalBundle: Record<string, unknown> = { ...(result.data as Record<string, unknown>) };
      if (docsResult.docs.length > 0) {
        finalBundle.docs = docsResult.docs;
      }

      // 4b. Bundle handler functions into `<artifactDir>/objectstack-runtime.{hash}.mjs`
      //     and stamp the relative path into the JSON so the runtime can
      //     dynamic-import it at boot. `runtimeModule` is part of the
      //     declared protocol (see ObjectStackDefinitionSchema) so a
      //     follow-up safeParse of the artifact preserves it.
      let runtimeBundle: { outputFileName: string; hash: string; size: number } | null = null;
      if (lowering.count > 0) {
        // New default: auto-skip the legacy bundle when every callable is
        // body-only (the metadata is fully self-describing). The bundle is
        // emitted only when (a) some callable could not be lowered, or
        // (b) the user explicitly opted in via --runtime-bundle.
        const stillNeeded = lowering.count - lowering.bodyExtracted;
        const needsBundle = stillNeeded > 0 || lowering.bodyExtractionWarnings.length > 0;
        const forceBundle = flags['runtime-bundle'];
        const strictNoBundle = flags['no-runtime-bundle'];

        if (strictNoBundle && needsBundle) {
          // Legacy strict mode: explicit --no-runtime-bundle fails loudly
          // when any callable still requires the bundle. Preserved so CI
          // pipelines can guard against accidental regressions.
          const msg = `--no-runtime-bundle requires every callable to have a metadata body (${stillNeeded} missing, ${lowering.bodyExtractionWarnings.length} extraction warning(s)). Re-run with --strict-body to see details, or omit --no-runtime-bundle.`;
          if (flags.json) {
            console.log(JSON.stringify({ success: false, error: msg }));
            this.exit(1);
          }
          console.log('');
          printError(msg);
          this.exit(1);
        }

        if (!needsBundle && !forceBundle) {
          if (!flags.json) printStep(`Skipping legacy runtime bundle (all ${lowering.count} callables are body-only)`);
          // Drop any previously emitted bundle so the artifact dir doesn't carry stale code.
          cleanupOldRuntimeBundles(artifactDir, '');
        } else {
          if (!flags.json) printStep(`Bundling ${lowering.count} handler${lowering.count === 1 ? '' : 's'}...`);
          try {
            runtimeBundle = await buildRuntimeBundle({
              sourceConfigPath: absolutePath,
              refs: Object.keys(lowering.functions),
              outputDir: artifactDir,
            });
            finalBundle.runtimeModule = `./${runtimeBundle.outputFileName}`;
            cleanupOldRuntimeBundles(artifactDir, runtimeBundle.outputFileName);
          } catch (err: any) {
            if (flags.json) {
              console.log(JSON.stringify({ success: false, error: `runtime bundle failed: ${err.message}` }));
              this.exit(1);
            }
            console.log('');
            printError(`Runtime bundle failed: ${err.message}`);
            this.error(err.message);
          }
        }
      }

      const jsonContent = JSON.stringify(finalBundle, null, 2);
      fs.writeFileSync(artifactPath, jsonContent);

      const sizeKB = (jsonContent.length / 1024).toFixed(1);
      const stats = collectMetadataStats(config);

      if (flags.json) {
        console.log(JSON.stringify({
          success: true,
          output: artifactPath,
          size: jsonContent.length,
          handlersBundled: lowering.count,
          runtimeModule: runtimeBundle?.outputFileName ?? null,
          runtimeModuleSize: runtimeBundle?.size ?? 0,
          warnings: widgetWarnings,
          stats,
          duration: timer.elapsed(),
        }));
        return;
      }

      // 5. Summary
      console.log('');
      printSuccess(`Build complete ${chalk.dim(`(${timer.display()})`)}`);
      if (widgetWarnings.length > 0) {
        printWarning(`${widgetWarnings.length} widget-binding warning(s) — see above`);
      }
      console.log('');
      printMetadataStats(stats);
      console.log('');
      printKV('Artifact', `${output} ${chalk.dim(`(${sizeKB} KB`)})`);
      if (runtimeBundle) {
        const runtimeKB = (runtimeBundle.size / 1024).toFixed(1);
        printKV(
          'Runtime',
          `${path.join(path.dirname(output), runtimeBundle.outputFileName)} ${chalk.dim(`(${runtimeKB} KB, ${lowering.count} handler${lowering.count === 1 ? '' : 's'})`)}`,
        );
      }
      console.log('');

    } catch (error: any) {
      if (flags.json) {
        console.log(JSON.stringify({ success: false, error: error.message }));
        this.exit(1);
      }
      console.log('');
      printError(error.message || String(error));
      this.error(error.message || String(error));
    }
  }
}
