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
import { collectAndLintDocs, type DocIssue } from '../utils/collect-docs.js';
import {
  printHeader,
  printKV,
  printSuccess,
  printError,
  printStep,
  printAuthoringRuleErrors,
  printDocIssueErrors,
  JSON_FULL_LIST_REMEDY,
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

    // [#12047] THE ADVISORY LISTS THIS RUN HAS COMPUTED SO FAR, hoisted out of
    // the `try` so that EVERY `emitJson` exit can read them — not the terminal
    // success payload alone.
    //
    // The defect: all five failure exits published strictly less than the run
    // had already computed. Two carried `ruleAdvisories` and nothing else; the
    // other three carried no advisory list at all. The text face prints these
    // blocks ending `— re-run with --json for the full list`, so an author
    // whose tree failed a LATER gate was told to re-run with `--json` and got
    // a payload without the withheld entries in it — the "the remedy named is
    // unreachable" shape of #11643 and #11391.
    //
    // The strongest instance is the parse-failure exit. `unknownKeyWarnings`
    // is computed PRE-parse (see its own note below) precisely so the finding
    // survives an unrelated schema error — and then that exit dropped it
    // anyway, defeating the one hoist that existed to prevent exactly this.
    //
    // Maintainer ruling 2026-08-25 on #11772, inherited here under the
    // same-family rule: every failure exit carries the lists the run has
    // ALREADY COMPUTED, so `warnings` means the same thing on every exit and a
    // machine consumer has exactly one way to read it. Option 2 — carry them
    // only where the text face printed them, making the payload's SHAPE depend
    // on how far the run got — was rejected as the hardest contract to
    // declare. Option 3 (weaken the pointer) was rejected as making the
    // product worse.
    //
    // ⛔ CARRYING, NOT COMPUTING. Every list stays computed at exactly the step
    // that owns it; these bindings only make the value visible to the exits
    // DOWNSTREAM of that step. An exit that runs before a given step therefore
    // still reports that list empty, and that is the honest reading of "what
    // the run has already computed". Hoisting a computation earlier so an
    // early exit looks fuller would be option 2 wearing option 1's clothes,
    // and it would change what the command costs on its failure paths too.
    //
    // ⛔ `structuralWarnings` is the member that is measured, not assumed. It
    // is computed LAST — below every one of the five failure exits — so it
    // rides `warningsSoFar()` as an empty list on all of them, and the only
    // exit that can ever see it non-empty is the success payload. It is a
    // member of the same class as the other four (a non-blocking advisory
    // about the stack, gated by `--strict`, already in the success payload's
    // `warnings`); it differs only in WHEN it becomes available, which is the
    // same axis `docWarnings` and `capProviderWarnings` already differ on. It
    // is included here rather than special-cased so the order lives at ONE
    // site — ⛔ do not "fix" its emptiness by moving its computation up.
    //
    // ORDER IS THE SUCCESS PAYLOAD'S, stated ONCE here and read by that
    // payload too — the "one list cannot drift from itself" idiom this file
    // has already had to apply three times. The spread used to be written out
    // at the payload, so a seventh exit could have been added with a different
    // member order and nothing would have caught it.
    // Typed off `splitBySeverity` rather than by naming `AuthoringFinding`: the
    // #4409 import scan (packages/lint/src/authoring-rule-wiring.test.ts) reads
    // every symbol this file names from `@objectstack/lint` and strips `type `
    // rather than exempting it, and `splitBySeverity` — which produces this
    // list — is already ratcheted there. Binding the annotation to the producer
    // is also the tighter statement: the list cannot disagree with the function
    // that fills it.
    let ruleAdvisories: ReturnType<typeof splitBySeverity>['advisories'] = [];
    let capProviderWarnings: Array<{ token: string; message: string }> = [];
    let unknownKeyWarnings: string[] = [];
    let docWarnings: DocIssue[] = [];
    let structuralWarnings: string[] = [];
    const warningsSoFar = () => [
      ...ruleAdvisories,
      ...docWarnings,
      ...unknownKeyWarnings,
      ...capProviderWarnings,
      ...structuralWarnings,
    ];

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
      unknownKeyWarnings = [
        ...lintUnknownStackKeys(normalized as Record<string, unknown>, ObjectStackDefinitionSchema),
        ...lintUnknownAuthoringKeys(normalized as Record<string, unknown>, ObjectStackDefinitionSchema),
      ].map(formatUnknownAuthoringKey);
      const result = ObjectStackDefinitionSchema.safeParse(normalized);

      if (!result.success) {
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: (result.error as unknown as ZodError).issues,
            // [#12047] The list computed at `unknownKeyWarnings` above — six
            // lines up, and dropped here until now. This is the exit the card
            // called the strongest instance: the hoist exists so the finding
            // SURVIVES a schema error, and this payload discarded it anyway.
            warnings: warningsSoFar(),
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
      const { errors: ruleErrors, advisories } = splitBySeverity(findings);
      ruleAdvisories = advisories;

      if (ruleErrors.length > 0) {
        // Every failing rule reports at once. The command used to exit at the
        // first failing gate, so an author with three unrelated problems fixed
        // them in three round trips and could not see how deep the hole went.
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: ruleErrors,
            // [#12047] Was `ruleAdvisories` alone. Reading the shared site adds
            // the pre-parse `unknownKeyWarnings` — computed long before this
            // gate — and keeps the member ORDER identical to every other exit.
            warnings: warningsSoFar(),
            duration: timer.elapsed(),
          });
          this.exit(1);
        }
        console.log('');
        printError(`Author-time rules failed (${ruleErrors.length} issue${ruleErrors.length > 1 ? 's' : ''})`);
        // [#11642] The comment above is the reason this render may not be
        // silently capped: reporting every failing rule at once is the whole
        // point of the block, and a cut with no notice restores a smaller
        // version of the round-trip it removed. `--json` on this same exit
        // publishes all of them as `errors`, so the pointer resolves.
        printAuthoringRuleErrors(ruleErrors, { remedy: JSON_FULL_LIST_REMEDY });
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
      capProviderWarnings = capProviderPreflight.warnings.map((c) => ({
        token: c.token,
        message: renderCapabilityMessage(c),
      }));
      if (capProviderErrors.length > 0) {
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: capProviderErrors.map((c) => ({ token: c.token, message: renderCapabilityMessage(c) })),
            // [#12047] The FATAL tokens ride `errors`; the advisory ones ride
            // `warnings` beside the two lists computed before this gate. The
            // two classes being separate is the whole point of the split.
            warnings: warningsSoFar(),
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
      docWarnings = docsResult.issues.filter((i) => i.severity !== 'error');
      if (docErrors.length > 0) {
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: docErrors,
            // [#12047] Was `ruleAdvisories` alone, on the very exit that had
            // the most computed: the doc advisories from this same call, the
            // capability hints, and the pre-parse key findings were all in
            // hand and none of them reached the payload.
            warnings: warningsSoFar(),
            duration: timer.elapsed(),
          });
          this.exit(1);
        }
        console.log('');
        printError(`Package docs validation failed (${docErrors.length} issue${docErrors.length > 1 ? 's' : ''})`);
        // [#11642] `--json` on this same exit publishes them all as `errors`.
        printDocIssueErrors(docErrors, { remedy: JSON_FULL_LIST_REMEDY });
        this.exit(1);
      }

      // 4. Collect and display stats
      const stats = collectMetadataStats(config);

      // Spec-version drift advisory (non-blocking): if the installed platform
      // is a newer major than the app declares, point at the migration guide.
      const specGap = checkSpecVersionGap(config.manifest);

      // 4b. Structural advisories (non-blocking) — computed HERE, above the
      //     `if (flags.json)` branch, for exactly the reason `unknownKeyWarnings`
      //     is computed up beside `normalized`: everything below that branch only
      //     ever feeds the text path. These four were in that state — printed for
      //     a human, structurally unreachable for `--json`, which is the one
      //     audience the flag exists for. A CI script gating on
      //     `os validate --json` advisories saw `warnings: []` however true the
      //     conditions were. Computed once and consumed by BOTH faces below, so
      //     the two cannot disagree by construction — the same "a single list
      //     cannot drift from itself" move this file already had to make twice.
      structuralWarnings = [];
      if (stats.objects === 0) {
        structuralWarnings.push('No objects defined — this stack has no data model');
      }
      if (stats.apps === 0 && stats.plugins === 0) {
        structuralWarnings.push('No apps or plugins defined — this stack may not do much');
      }
      if (!config.manifest?.id) {
        structuralWarnings.push('Missing manifest.id — required for deployment');
      }
      if (!config.manifest?.namespace) {
        structuralWarnings.push('Missing manifest.namespace — required for multi-app hosting');
      }

      // 5. Warnings (non-blocking) — assembled HERE, above the `if (flags.json)`
      //    branch, because this is the list `--strict` gates on and the JSON
      //    face has to reach the SAME verdict from it. It could not: the payload
      //    was emitted and `return`ed above the only `flags.strict` reader, so
      //    `os validate --json --strict` exited 0 on the very configs
      //    `os validate --strict` exited 1 for. The flag was accepted,
      //    documented (`content/docs/deployment/cli.mdx` spells the pair twice
      //    in its CI/CD section, once as a GitHub Actions step) and inert — a
      //    pipeline gating on the exit status of the documented invocation read
      //    0 and called the stack clean.
      //
      //    Hoisting the assembly rather than restating the condition is the same
      //    move `structuralWarnings` just above and `unknownKeyWarnings` up
      //    beside `normalized` already made, for the third time in this file:
      //    ONE list, consumed by both faces, so the two exit codes cannot drift
      //    from each other by construction. The push ORDER is unchanged, so the
      //    text face's warning output is byte-for-byte what it was.
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

      // The four structural advisories, computed further up so the `--json`
      // payload can carry them too. Appended HERE, last, in the position the
      // four inline `if` blocks used to occupy, so the text face's warning ORDER
      // is byte-for-byte what it was.
      warnings.push(...structuralWarnings);

      if (flags.json) {
        await emitJson(
          {
            valid: true,
            manifest: config.manifest,
            stats,
            // One advisory list for the whole registry. This used to be a
            // hand-maintained concatenation of per-gate arrays, and it leaked
            // twice: warnings computed and then dropped from `--json` while the
            // console printed them. A single list cannot drift from itself.
            // [#12047] The spread that used to be written out here now lives
            // at `warningsSoFar()` above, which every one of the six exits
            // reads. Content is unchanged on this payload — what changed is
            // that a seventh exit cannot be added with a different member
            // order, and the five failure exits no longer publish less than
            // this one.
            warnings: warningsSoFar(),
            conversions: conversionNotices,
            specVersionGap: specGap,
            duration: timer.elapsed(),
          },
          // `--strict` means one thing — "treat warnings as errors" — and it now
          // means it on both faces. The gate reads `warnings`, the text face's
          // OWN list, rather than the payload's `warnings` field: the two differ
          // by the ADR-0087 conversion notices, which the text face folds into
          // its `⚠` block while the payload carries them under `conversions`.
          // Gating on the payload field would have left `--json --strict` at 0
          // for a config whose only advisories are conversion notices — the
          // same divergence one collection narrower. `specVersionGap` stays out
          // on both faces; it is never gated by `--strict` (see below).
          //
          // `valid: true` beside a 1 is not a contradiction, it is the text
          // face verbatim: that path prints "Validation passed" and THEN fails
          // for strict. The stack IS schema-valid; `--strict` is what promotes
          // its advisories to a failure.
          //
          // The status rides in `emitJson`'s `CliExitCode` slot rather than a
          // following `this.exit(1)`, unlike the failure paths above: those
          // must stop a fall-through into the text rendering, while here the
          // payload is complete and the `return` is right there. The slot is
          // the declared channel for pairing a `--json` document with the
          // status the shell reads (`utils/format.ts`; pinned by
          // `utils/format.exit-code.test.ts` and `test/migrate-exit-code.e2e.test.ts`),
          // and it emits the one document without an ExitError unwinding
          // through the catch below.
          flags.strict && warnings.length > 0 ? 1 : 0,
        );
        return;
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
        // The text face's half of the `--strict` gate. Its JSON counterpart is
        // the `CliExitCode` argument at the `emitJson` call above, reading this
        // same `warnings` list — change one and change the other, or the two
        // faces start disagreeing about the exit status again.
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
          // [#12047] Whatever the run had reached before the throw. A config
          // that dies in `loadConfig` reports `[]` here honestly — nothing was
          // computed yet — while a throw from a later step (a `src/docs` that
          // is a FILE, say, which makes `readdirSync` raise ENOTDIR) carries
          // the three lists already in hand.
          warnings: warningsSoFar(),
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
