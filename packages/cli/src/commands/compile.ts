// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import path from 'path';
import fs from 'fs';
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
import { lowerCallables } from '../utils/lower-callables.js';
import { buildAccessMatrix, diffAccessMatrix } from '@objectstack/lint';
import { runAuthoringRules, splitBySeverity, authoringRulesFor } from '@objectstack/lint';
import { resolveSduiManifest } from '../utils/sdui-manifest.js';
import { preflightRequiredCapabilities, renderCapabilityMessage } from '../utils/capability-preflight.js';
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
  emitJson,
  isExitSignal,
} from '../utils/format.js';
import { checkSpecVersionGap } from '../utils/spec-version.js';

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
    'update-access-matrix': Flags.boolean({
      description: '[ADR-0090 D6] Rewrite access-matrix.json from the current stack instead of failing on drift. Review the resulting diff — it IS the capability change.',
      default: false,
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
      //    The ADR-0087 D2 conversion layer runs here (inside normalizeStackInput).
      //    Each rewrite emits a structured deprecation notice, and this command
      //    used to drop every one of them: `os validate` passed a sink and
      //    surfaced them, `os build` passed none. That is the #3782 parity class
      //    — the two surfaces disagreeing about what an author is told — and it
      //    bites harder than it reads, because the notice is the ONLY warning an
      //    old-shape author gets before the conversion retires and their metadata
      //    stops loading. Five conversions are live today (protocol 11 and 15),
      //    so the gap is real, not hypothetical.
      if (!flags.json) printStep('Normalizing stack definition...');
      const conversionNotices: ConversionNotice[] = [];
      const normalized = normalizeStackInput(config as Record<string, unknown>, {
        onConversionNotice: (n) => conversionNotices.push(n),
      });
      if (conversionNotices.length > 0 && !flags.json) {
        console.log('');
        for (const n of conversionNotices) {
          printWarning(
            `${n.path}: '${n.from}' → '${n.to}' (converted at load; conversion '${n.conversionId}', retires in protocol ${n.retiresIn})`,
          );
        }
      }

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
            await emitJson({ success: false, error: 'strict-body: missing body', issues }, 0, { compact: true });
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
          await emitJson({ success: false, errors: (result.error as unknown as ZodError).issues }, 0, { compact: true });
          this.exit(1);
        }
        console.log('');
        printError('Validation failed');
        formatZodErrors(result.error as unknown as ZodError);
        this.exit(1);
      }

      // 3b. The author-time rule registry (#4409) — one table, three commands.
      //     `os build` was the WEAKEST of the three authoring gates before it:
      //     it published stacks `os validate` or `os lint` refuse, because the
      //     rules each command ran were whatever its author remembered to wire.
      //     `validateApprovalApprovers` was the worked example — a flow whose
      //     expression approver does not parse built and published green while
      //     `os lint` rejected it. The build is the command that SHIPS, so
      //     "weakest gate" here means broken metadata reaching an environment.
      //
      //     Which rules run, on which stack tier, and why any of them is scoped
      //     is declared in `lint/authoring-rules.ts`. Do not add a call site here.
      const registered = authoringRulesFor('build');
      if (!flags.json) printStep(`Running author-time rules (${registered.length})...`);
      const findings = runAuthoringRules('build', {
        normalized: normalized as Record<string, unknown>,
        parsed: result.data as Record<string, unknown>,
        sduiManifest: resolveSduiManifest(),
      });
      const { errors: ruleErrors, advisories: ruleAdvisories } = splitBySeverity(findings);

      if (ruleAdvisories.length > 0 && !flags.json) {
        console.log('');
        for (const f of ruleAdvisories.slice(0, 50)) {
          printWarning(`${f.where}: ${f.message}`);
          if (f.hint) console.log(chalk.dim(`    ${f.hint}`));
          console.log(chalk.dim(`    rule: ${f.rule}  at ${f.path}`));
        }
      }
      if (ruleErrors.length > 0) {
        // Every failing rule reports at once — see the note in `validate.ts`.
        if (flags.json) {
          await emitJson(
            { success: false, error: 'author-time rules failed', issues: ruleErrors, warnings: ruleAdvisories },
            0,
            { compact: true },
          );
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

      // 3c. [#3366] Installable-provider preflight. Every capability the app
      //     DECLARES in `requires: [...]` must have a provider resolvable in the
      //     active edition. A `requires` entry whose provider has NO installable
      //     version in this edition (e.g. `ai` → @objectstack/service-ai,
      //     cloud-only since ADR-0025) otherwise slips through to a generic
      //     `os start` crash. Absent-but-installable is a `pnpm add` hint.
      //
      //     Not a registry rule: it reads `node_modules`, not the stack.
      if (!flags.json) printStep('Checking capability providers (#3366)...');
      const capPreflight = preflightRequiredCapabilities({
        requires: Array.isArray((config as { requires?: unknown[] }).requires)
          ? ((config as { requires?: unknown[] }).requires as unknown[])
          : [],
        projectDir: path.dirname(absolutePath),
      });
      if (capPreflight.errors.length > 0) {
        if (flags.json) {
          await emitJson({
            success: false,
            error: 'capability provider preflight failed',
            issues: capPreflight.errors.map((c) => ({ token: c.token, message: renderCapabilityMessage(c) })),
          }, 0, { compact: true });
          this.exit(1);
        }
        console.log('');
        printError(`Capability provider check failed (${capPreflight.errors.length} issue${capPreflight.errors.length > 1 ? 's' : ''})`);
        for (const c of capPreflight.errors) {
          console.log(`  • ${renderCapabilityMessage(c)}`);
        }
        this.exit(1);
      }
      if (capPreflight.warnings.length > 0 && !flags.json) {
        console.log('');
        for (const c of capPreflight.warnings) {
          printWarning(renderCapabilityMessage(c));
        }
      }

      // 3d. [#3786] Keys `ObjectSchema` / `FieldSchema` do not declare, and so
      //     drop silently on the way to storage. PRE-parse, since the parse is
      //     what strips them. `defineStack` already warns for configs authored
      //     through it; this covers the ones that skip it (a plain object
      //     default-export, `strict: false`) and would otherwise emit an
      //     artifact with the key quietly gone. Advisory, never fatal.
      const unknownKeyFindings = [
        ...lintUnknownStackKeys(normalized as Record<string, unknown>, ObjectStackDefinitionSchema),
        ...lintUnknownAuthoringKeys(normalized as Record<string, unknown>, ObjectStackDefinitionSchema),
      ];
      if (unknownKeyFindings.length > 0 && !flags.json) {
        printWarning(`Undeclared authoring keys (${unknownKeyFindings.length}) — dropped at load (#3786)`);
        for (const f of unknownKeyFindings.slice(0, 50)) {
          console.log(`  • ${formatUnknownAuthoringKey(f)}`);
        }
      }

      // 3e. [ADR-0090 D6] Access-matrix snapshot gate. Opt-in per app: when
      //     `access-matrix.json` sits next to the config, the (permission set
      //     × object) capability matrix derived from THIS build must match it
      //     — a drift fails the build with a SEMANTIC diff ("'crm_admin'
      //     gains delete on 'crm_lead'") until the snapshot is updated via
      //     --update-access-matrix. An unchanged matrix auto-passes, so the
      //     gate costs nothing until someone changes who-can-do-what.
      //
      //     Not a registry rule: it reads (and with the flag, writes) a file
      //     next to the config rather than answering a question about the stack.
      {
        const matrixPath = path.join(path.dirname(absolutePath), 'access-matrix.json');
        const currentMatrix = buildAccessMatrix(result.data as Record<string, unknown>);
        if (flags['update-access-matrix']) {
          // Unconditional write — creates or refreshes the snapshot.
          fs.writeFileSync(matrixPath, JSON.stringify(currentMatrix, null, 2) + '\n');
          if (!flags.json) printStep(`Access matrix snapshot written to ${path.relative(process.cwd(), matrixPath)} (ADR-0090 D6) — review the diff.`);
        } else {
          // Single read attempt (no exists-then-read TOCTOU): a missing file
          // means the app has not opted into the gate; an unreadable/corrupt
          // one is treated as empty so the drift report shows every entry.
          let committedRaw: string | null = null;
          try { committedRaw = fs.readFileSync(matrixPath, 'utf8'); } catch { committedRaw = null; }
          if (committedRaw !== null) {
            if (!flags.json) printStep('Checking access-matrix snapshot (ADR-0090 D6)...');
            let committed: any = { version: 1, entries: [] };
            try { committed = JSON.parse(committedRaw); } catch { /* corrupt = empty */ }
            const drift = diffAccessMatrix(committed, currentMatrix);
            if (drift.length > 0) {
              if (flags.json) {
                await emitJson({ success: false, error: 'access matrix drift', changes: drift }, 0, { compact: true });
                this.exit(1);
              }
              console.log('');
              printError(`Access matrix drift (${drift.length} change${drift.length > 1 ? 's' : ''}) — capability changes must be reviewed`);
              for (const line of drift.slice(0, 50)) console.log(`  • ${line}`);
              console.log(chalk.dim('  If intended, re-run with --update-access-matrix and commit the snapshot — its diff IS the review artifact.'));
              this.exit(1);
            }
          }
        }
      }

      // 3f. Package docs (ADR-0046): compile flat `src/docs/*.md` into
      //     `docs: DocSchema[]` and lint the combined set (flatness,
      //     namespace-prefixed names, MDX/image ban, same-package link
      //     resolution). Errors fail the build — the artifact is the
      //     publish unit, so this IS the publish lint for docs.
      //
      //     Not a registry rule: it reads `src/docs/` off disk, and the docs it
      //     collects there are an INPUT to the artifact, not just a check.
      if (!flags.json) printStep('Collecting package docs (ADR-0046)...');
      const docsResult = collectAndLintDocs(absolutePath, result.data as Record<string, unknown>);
      const docErrors = docsResult.issues.filter((i) => i.severity === 'error');
      const docWarnings = docsResult.issues.filter((i) => i.severity === 'warning');
      if (docErrors.length > 0) {
        if (flags.json) {
          await emitJson({ success: false, error: 'docs validation failed', issues: docErrors }, 0, { compact: true });
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
            await emitJson({ success: false, error: msg }, 0, { compact: true });
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
              await emitJson({ success: false, error: `runtime bundle failed: ${err.message}` }, 0, { compact: true });
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

      // Spec-version drift advisory (non-blocking): installed platform newer
      // than the app declares → point at the migration guide.
      const specGap = checkSpecVersionGap((config as { manifest?: { specVersion?: unknown } }).manifest);

      if (flags.json) {
        await emitJson({
          success: true,
          output: artifactPath,
          size: jsonContent.length,
          handlersBundled: lowering.count,
          runtimeModule: runtimeBundle?.outputFileName ?? null,
          runtimeModuleSize: runtimeBundle?.size ?? 0,
          // The whole registry's advisory set, in the shape `os validate --json`
          // reports. This key used to carry the widget rule's warnings alone —
          // one gate out of the twenty-odd that raise them.
          warnings: ruleAdvisories,
          // Same key `os validate --json` uses, so a CI consumer reads one shape
          // from either command rather than learning two.
          conversions: conversionNotices,
          specVersionGap: specGap,
          stats,
          duration: timer.elapsed(),
        }, 0, { compact: true });
        return;
      }

      // 5. Summary
      console.log('');
      printSuccess(`Build complete ${chalk.dim(`(${timer.display()})`)}`);
      if (ruleAdvisories.length > 0) {
        printWarning(`${ruleAdvisories.length} author-time warning(s) — see above`);
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
      if (specGap) {
        console.log('');
        console.log(chalk.yellow(`  ⚠ ${specGap.message}`));
        console.log(chalk.dim(`      → ${specGap.hint}`));
      }
      console.log('');

    } catch (error: any) {
      if (isExitSignal(error)) throw error;
      if (flags.json) {
        await emitJson({ success: false, error: error.message }, 0, { compact: true });
        this.exit(1);
      }
      console.log('');
      printError(error.message || String(error));
      this.error(error.message || String(error));
    }
  }
}
