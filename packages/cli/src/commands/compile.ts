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
import { runAuthoringRules, splitBySeverity, authoringRulesFor, type AuthoringFinding } from '@objectstack/lint';
import { resolveSduiManifest } from '../utils/sdui-manifest.js';
import { preflightRequiredCapabilities, renderCapabilityMessage } from '../utils/capability-preflight.js';
import { collectAndLintDocs, type DocIssue } from '../utils/collect-docs.js';
import { buildRuntimeBundle, cleanupOldRuntimeBundles } from '../utils/build-runtime.js';
import {
  printHeader,
  printKV,
  printSuccess,
  printError,
  printStep,
  printWarning,
  printAuthoringAdvisories,
  printAuthoringRuleErrors,
  printDocIssueErrors,
  printBulletList,
  JSON_FULL_LIST_REMEDY,
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

    // [#11772] THE ADVISORY LISTS THIS RUN HAS COMPUTED SO FAR, hoisted out of
    // the `try` so that EVERY `emitJson` exit can read them — not the terminal
    // success payload alone.
    //
    // The defect: `warnings` lived on the success payload only (plus, for one
    // list, the author-time-rules failure). The text face prints the #3786
    // undeclared-authoring-key block at 3d ending `— re-run with --json for the
    // full list`, and #11529's advisory printer ends the same way. A build that
    // then failed at a LATER gate (access matrix 3e, package docs 3f, the
    // runtime bundle, or a throw caught at the bottom) emitted that gate's
    // failure payload, and none of those carried the list — so the author was
    // told to re-run with `--json` and got a payload without the withheld
    // entries in it. That is the "the remedy named is unreachable" shape of
    // #11643 and #11391.
    //
    // Maintainer ruling 2026-08-25, option 1 of the three the card offered:
    // every failure exit carries the lists the run has ALREADY COMPUTED, so
    // `warnings` means the same thing on every exit and a machine consumer has
    // exactly one way to read it. Option 2 — carry them only where the text
    // face printed them, making the payload's SHAPE depend on how far the run
    // got — was rejected as the hardest contract to declare. Option 3 (weaken
    // the pointer) was rejected as making the product worse.
    //
    // ⛔ CARRYING, NOT COMPUTING. Every list stays computed at exactly the step
    // that owns it; these bindings only make the value visible to the exits
    // DOWNSTREAM of that step. An exit that runs before a given step therefore
    // still sees that list empty, and that is the honest reading of "what the
    // run has already computed": hoisting a computation earlier so an early
    // exit looks fuller would be option 2 wearing option 1's clothes, and it
    // would change what the command costs on its failure paths as well.
    //
    // ORDER IS `os validate --json`'s, stated ONCE here and read by the success
    // payload too — the "one list cannot drift from itself" idiom #11643 and
    // #11727 applied one list over. The spread used to be written out at the
    // payload, so a tenth exit could have been added with a different order and
    // nothing would have caught it.
    let ruleAdvisories: AuthoringFinding[] = [];
    let capProviderWarnings: Array<{ token: string; message: string }> = [];
    let unknownKeyWarnings: string[] = [];
    let docWarnings: DocIssue[] = [];
    const warningsSoFar = () => [
      ...ruleAdvisories,
      ...docWarnings,
      ...unknownKeyWarnings,
      ...capProviderWarnings,
    ];

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
            await emitJson({ success: false, error: 'strict-body: missing body', issues, warnings: warningsSoFar() }, 0, { compact: true });
            this.exit(1);
          }
          console.log('');
          printError(`--strict-body: ${issues.length} callable(s) lack a metadata body`);
          // [#11642] Caps at 20, not 50, which is the only reason a sweep
          // anchored on the literal `slice(0, 50)` could not see this one. The
          // shape is the defect either way: the header states the true total
          // and the body shows 20, with nothing saying the rest exist. The cap
          // stays; the silence does not. The pointer is honest here — the
          // `--json` branch immediately above this block publishes the whole
          // list as `issues`.
          printBulletList(
            issues.map((w) => `${w.origin}: ${w.reason}`),
            { noun: 'callable(s)', limit: 20, remedy: JSON_FULL_LIST_REMEDY },
          );
          this.exit(1);
        }
      }

      // 2c. [#10678] SURFACE the warn-and-bundle. The default (non-`--strict-body`)
      //     build catches every extraction failure in `lowerCallables`, records it
      //     in `bodyExtractionWarnings`, ships the callable through the .mjs bundle
      //     and exits 0. That last part is correct and stays correct — flipping the
      //     default to a hard failure would change what `os build` ACCEPTS, which is
      //     not this change. What was wrong is that the recorded warnings reached
      //     nobody: a hook body containing `fetch()` produced a completely silent
      //     success, and the only way to learn the handler had NOT become a metadata
      //     body was to diff the artifact. The data already existed; it just never
      //     got printed. Advisory only — nothing below may touch the exit code.
      //
      //     The reason strings carry a multi-line `--- offending body source ---`
      //     dump for `--strict-body`'s per-callable diagnostic; on the default path
      //     we print the first line and point at the flag for the rest, so the
      //     default build stays readable while staying honest.
      if (lowering.bodyExtractionWarnings.length > 0 && !flags.json) {
        const n = lowering.bodyExtractionWarnings.length;
        console.log('');
        printWarning(
          `${n} handler${n === 1 ? '' : 's'} could not be lowered to a metadata body — ` +
            `bundled via the legacy runtime module instead (build still succeeds)`,
        );
        for (const w of lowering.bodyExtractionWarnings.slice(0, 20)) {
          console.log(`  • ${w.origin}: ${String(w.reason).split('\n')[0]}`);
        }
        if (n > 20) console.log(chalk.dim(`  … and ${n - 20} more`));
        console.log(chalk.dim('    → run `os build --strict-body` for the full diagnostic, or to make this fatal'));
      }

      // 3. Validate the lowered (JSON-safe) stack against the Protocol.
      if (!flags.json) printStep('Validating protocol compliance...');
      const result = ObjectStackDefinitionSchema.safeParse(lowering.lowered);

      if (!result.success) {
        if (flags.json) {
          await emitJson({ success: false, errors: (result.error as unknown as ZodError).issues, warnings: warningsSoFar() }, 0, { compact: true });
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
      const { errors: ruleErrors, advisories } = splitBySeverity(findings);
      ruleAdvisories = advisories;

      if (ruleAdvisories.length > 0 && !flags.json) {
        console.log('');
        // #11529 — rendered by ONE printer, which also names the remainder when
        // the list is cut. The loop used to sit inline here and stop dead at 50
        // with no notice, so a truncated report read exactly like a complete
        // one. See `printAuthoringAdvisories` for the measurement.
        printAuthoringAdvisories(ruleAdvisories);
      }
      if (ruleErrors.length > 0) {
        // Every failing rule reports at once — see the note in `validate.ts`.
        if (flags.json) {
          await emitJson(
            { success: false, error: 'author-time rules failed', issues: ruleErrors, warnings: warningsSoFar() },
            0,
            { compact: true },
          );
          this.exit(1);
        }
        console.log('');
        printError(`Author-time rules failed (${ruleErrors.length} issue${ruleErrors.length > 1 ? 's' : ''})`);
        // [#11642] `--json` on this same exit publishes every one of them as
        // `issues`, so the pointer resolves to a complete view of THIS list.
        printAuthoringRuleErrors(ruleErrors, { remedy: JSON_FULL_LIST_REMEDY });
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
      // [#11727] MAPPED HERE, once, and consumed by BOTH faces — the text block
      //     just below and the `--json` payload at the end of this command. The
      //     hints used to be rendered inside that print block, i.e. under
      //     `!flags.json`, so the payload could not reach them: computed, then
      //     discarded, for the one audience `--json` exists to serve. This is
      //     the same defect #11643 fixed one list over, and the same fix —
      //     hoist the formatting to the computation site so one list feeds both
      //     faces. `os validate --json` already maps to exactly this
      //     `{ token, message }` record beside its own preflight call, so
      //     mirroring it is what keeps the two commands from reporting
      //     different sets. One list cannot drift from itself.
      capProviderWarnings = capPreflight.warnings.map((c) => ({
        token: c.token,
        message: renderCapabilityMessage(c),
      }));
      if (capPreflight.errors.length > 0) {
        if (flags.json) {
          await emitJson({
            success: false,
            error: 'capability provider preflight failed',
            issues: capPreflight.errors.map((c) => ({ token: c.token, message: renderCapabilityMessage(c) })),
            warnings: warningsSoFar(),
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
      if (capProviderWarnings.length > 0 && !flags.json) {
        console.log('');
        for (const w of capProviderWarnings) {
          printWarning(w.message);
        }
      }

      // 3d. [#3786] Keys `ObjectSchema` / `FieldSchema` do not declare, and so
      //     drop silently on the way to storage. PRE-parse, since the parse is
      //     what strips them. `defineStack` already warns for configs authored
      //     through it; this covers the ones that skip it (a plain object
      //     default-export, `strict: false`) and would otherwise emit an
      //     artifact with the key quietly gone. Advisory, never fatal.
      //
      //     [#11643] FORMATTED HERE, once, and consumed by BOTH faces — the
      //     text block just below and the `--json` payload at the end of this
      //     command. The findings used to be formatted inside that print
      //     block, i.e. under `!flags.json`, which made them structurally
      //     unreachable for the payload: computed, then discarded, for the one
      //     audience `--json` exists to serve. `os validate --json` had this
      //     exact defect and fixed it this exact way —
      //     `.map(formatUnknownAuthoringKey)` at the computation site, beside
      //     its own `normalized` — so hoisting the formatting rather than
      //     restating it at the payload is what keeps the two faces from
      //     reporting different sets. One list cannot drift from itself.
      unknownKeyWarnings = [
        ...lintUnknownStackKeys(normalized as Record<string, unknown>, ObjectStackDefinitionSchema),
        ...lintUnknownAuthoringKeys(normalized as Record<string, unknown>, ObjectStackDefinitionSchema),
      ].map(formatUnknownAuthoringKey);
      if (unknownKeyWarnings.length > 0 && !flags.json) {
        printWarning(`Undeclared authoring keys (${unknownKeyWarnings.length}) — dropped at load (#3786)`);
        // [#11642] The header already states the true total, so before this
        // notice the block printed two numbers that disagreed and explained
        // neither. The pointer resolves because #11643 put this exact list
        // into the `--json` payload (`warnings`) a few lines below; it would
        // have been a dead end before that landed.
        //
        // [#11772] …and it resolves on EVERY exit now, which is what makes the
        // pointer above unconditional. It used to resolve on the SUCCESS exit
        // alone: `warnings` lived in the terminal payload, so a build that
        // failed at a LATER gate (access matrix 3e, package docs 3f, the
        // runtime bundle, or a throw) emitted that gate's failure payload and
        // none of those carried this list — the author was told to re-run with
        // `--json` and got a payload without the withheld keys in it. Every
        // `emitJson` exit reads `warningsSoFar()`, so this list now survives
        // whichever later gate stops the run. ⛔ If a tenth exit is added, it
        // carries the lists too, or this pointer goes back to being a claim
        // that holds in one branch only — the same shape as the silence
        // #11642 was about. `build-json-failure-warnings.e2e.test.ts` pins it.
        printBulletList(unknownKeyWarnings, {
          noun: 'undeclared authoring key(s)',
          remedy: JSON_FULL_LIST_REMEDY,
        });
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
                await emitJson({ success: false, error: 'access matrix drift', changes: drift, warnings: warningsSoFar() }, 0, { compact: true });
                this.exit(1);
              }
              console.log('');
              printError(`Access matrix drift (${drift.length} change${drift.length > 1 ? 's' : ''}) — capability changes must be reviewed`);
              // [#11642] `--json` on this same exit publishes the whole diff
              // as `changes`, so the pointer resolves for this list too.
              printBulletList(drift, {
                noun: 'access-matrix change(s)',
                remedy: JSON_FULL_LIST_REMEDY,
              });
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
      // [#11727] Consumed by BOTH faces — the text block below and the `--json`
      //     payload. Only the text block read it before, so the advisories were
      //     computed and then dropped for `--json`, exactly as the #3366 hints
      //     above were. Carried into the payload as the ISSUE RECORDS
      //     themselves, unmapped, because that is what `os validate --json`
      //     ships (`warnings: [..., ...docWarnings, ...]` over the same
      //     `collectAndLintDocs` output) — the text face's `path: message`
      //     rendering is a text-face concern and stays here.
      //
      //     `severity === 'warning'` and validate's `severity !== 'error'`
      //     select the same set: `DocIssue.severity` is `'error' | 'warning'`,
      //     so there is no third value for the two spellings to disagree about.
      docWarnings = docsResult.issues.filter((i) => i.severity === 'warning');
      if (docErrors.length > 0) {
        if (flags.json) {
          await emitJson({ success: false, error: 'docs validation failed', issues: docErrors, warnings: warningsSoFar() }, 0, { compact: true });
          this.exit(1);
        }
        console.log('');
        printError(`Package docs validation failed (${docErrors.length} issue${docErrors.length > 1 ? 's' : ''})`);
        // [#11642] `--json` on this same exit publishes them all as `issues`.
        printDocIssueErrors(docErrors, { remedy: JSON_FULL_LIST_REMEDY });
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
            await emitJson({ success: false, error: msg, warnings: warningsSoFar() }, 0, { compact: true });
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
              await emitJson({ success: false, error: `runtime bundle failed: ${err.message}`, warnings: warningsSoFar() }, 0, { compact: true });
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
          //
          // [#11643] …and then, still, only the RULE advisories: the #3786
          // undeclared-authoring-key findings were computed above and dropped,
          // so a CI consumer reading `warnings` off this command saw a strictly
          // smaller set than the same consumer reading it off
          // `os validate --json` on the same tree — missing exactly the "your
          // key was dropped at load" members. Two costs, both real: the machine
          // faces of two commands disagreed about one class of warning, and
          // #11529's truncation notice points the reader at `--json` "for the
          // full list", which was true of one advisory list and false of the
          // other.
          //
          // MIXED BY DESIGN, because that is what parity means here. This list
          // now carries the rule advisories as RECORDS and the undeclared-key
          // findings as formatted STRINGS — byte-for-byte the shape
          // `os validate --json` has shipped since it fixed this on its own
          // face (`warnings: [...ruleAdvisories, ...docWarnings,
          // ...unknownKeyWarnings, …]`, likewise a heterogeneous list). The
          // homogeneity this key used to have was not a contract; it was the
          // symptom of the omission.
          //
          // [#11727] …and then, still, two lists short of parity: the #3366
          // capability-provider hints and the ADR-0046 package-docs advisories
          // were computed above and dropped under the same `!flags.json` guard
          // the undeclared-key findings used to sit behind. Same defect, same
          // audience, fourth instance in these two files. A CI consumer reading
          // `warnings` off `os build --json` saw `[]` for a stack whose
          // `requires` names an unknown capability token and whose shipped doc
          // has unreadable frontmatter — while the same consumer reading
          // `os validate --json` on that same tree saw both.
          //
          // ORDER AND SHAPE MIRROR `os validate --json` rather than being
          // chosen here: that payload reads `[...ruleAdvisories, ...docWarnings,
          // ...unknownKeyWarnings, ...capProviderWarnings, ...structuralWarnings]`,
          // and this is that list minus its last member. Doc advisories ride as
          // ISSUE RECORDS and capability hints as `{ token, message }` records,
          // which is what validate ships for each — so a consumer reads one
          // shape per class from either command rather than learning two.
          //
          // `structuralWarnings` is ABSENT ON PURPOSE, and it is not this
          // omission's fourth sibling: `os validate` computes those four from
          // `collectMetadataStats`, and `os compile` never computes them at all
          // (this file has no "No objects defined" / "may not do much" string,
          // in any face). That makes it a MISSING COMPUTATION rather than a
          // dropped list — and whether a command that writes an artifact should
          // advise "No apps or plugins defined" is a judgment, not a mechanical
          // port. Measured on #11727 (this change) and split out as #11896,
          // which is where that judgment is made — deliberately NOT this card,
          // which #11727 closes.
          warnings: warningsSoFar(),
          // [#10678] Body-extraction failures that made a callable fall back to
          // the legacy .mjs bundle. A SEPARATE key on purpose, and the reason is
          // parity too — the opposite way round from `unknownKeyWarnings` just
          // above. `{origin,reason}` extraction records have NO counterpart in
          // `os validate --json`: that command lowers no handlers, so there is
          // no cross-command list for these to join, and folding a shape only
          // ONE command can ever emit into the shared key would teach consumers
          // a shape the other command never ships. The undeclared-key findings
          // are the mirror case — validate already carries them, in `warnings`,
          // so that is where build has to carry them too. Empty array when every
          // callable lowered cleanly, so a CI consumer can read the key
          // unconditionally.
          bodyExtractionWarnings: lowering.bodyExtractionWarnings,
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
      if (lowering.bodyExtractionWarnings.length > 0) {
        // [#10678] Repeat the tally in the summary: the detail printed before the
        // parse, and a long build scrolls it away.
        printWarning(
          `${lowering.bodyExtractionWarnings.length} handler(s) bundled instead of lowered to a metadata body — see above`,
        );
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
        await emitJson({ success: false, error: error.message, warnings: warningsSoFar() }, 0, { compact: true });
        this.exit(1);
      }
      console.log('');
      printError(error.message || String(error));
      this.error(error.message || String(error));
    }
  }
}
