// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import { ZodError } from 'zod';
import { ObjectStackDefinitionSchema, normalizeStackInput } from '@objectstack/spec';
import { loadConfig } from '../utils/config.js';
import { lowerCallables } from '../utils/lower-callables.js';
import { validateStackExpressions } from '@objectstack/lint';
import { validateVisibilityPredicates } from '@objectstack/lint';
import { validateWidgetBindings } from '@objectstack/lint';
import { validateDashboardActionRefs } from '@objectstack/lint';
import { validateResponsiveStyles } from '@objectstack/lint';
import { validateSecurityPosture, buildAccessMatrix, diffAccessMatrix } from '@objectstack/lint';
import { validateReadonlyFlowWrites } from '@objectstack/lint';
import { lintFlowPatterns } from '../utils/lint-flow-patterns.js';
import { lintAutonumberFormats } from '../utils/lint-autonumber-formats.js';
import { lintLivenessProperties } from '../utils/lint-liveness-properties.js';
import { lintViewRefs } from '../utils/lint-view-refs.js';
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

      // 3b-ter. [#3366] Installable-provider preflight. Every capability the app
      //     DECLARES in `requires: [...]` must have a provider resolvable in the
      //     active edition. `os validate` only checks the token vocabulary and
      //     `os build` never resolved providers, so a `requires` entry whose
      //     provider has NO installable version in this edition (e.g. `ai` →
      //     @objectstack/service-ai, cloud-only since ADR-0025) slipped through
      //     to a generic `os start` crash. Fail the build with the edition-aware
      //     message instead; an absent-but-installable provider is a `pnpm add`
      //     hint (advisory), and a satisfied list passes silently.
      if (!flags.json) printStep('Checking capability providers (#3366)...');
      const capPreflight = preflightRequiredCapabilities({
        requires: Array.isArray((config as { requires?: unknown[] }).requires)
          ? ((config as { requires?: unknown[] }).requires as unknown[])
          : [],
        projectDir: path.dirname(absolutePath),
      });
      if (capPreflight.errors.length > 0) {
        if (flags.json) {
          console.log(JSON.stringify({
            success: false,
            error: 'capability provider preflight failed',
            issues: capPreflight.errors.map((c) => ({ token: c.token, message: renderCapabilityMessage(c) })),
          }));
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

      // 3b-bis. ADR-0089 D3b — deprecated visibility aliases + mis-layered
      //     binding root. Checked on `normalized` (PRE-parse): the schema folds
      //     `visibleOn`/`visibility` into `visibleWhen` at parse, so `result.data`
      //     no longer carries the alias the author wrote. Advisory, never fatal.
      const visibilityFindings = validateVisibilityPredicates(normalized as Record<string, unknown>);
      if (visibilityFindings.length > 0 && !flags.json) {
        printWarning(`Visibility warnings (${visibilityFindings.length}) — ADR-0089`);
        for (const f of visibilityFindings.slice(0, 50)) {
          console.log(`  • ${f.where}: ${f.message}`);
          console.log(`      ${f.hint}`);
          console.log(`      rule: ${f.rule}  at ${f.path}`);
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

      // 3c-bis. Dashboard action/route reference integrity (ADR-0049 for
      //     references, #3367). A header/widget action naming a `script`/`modal`
      //     target that resolves to no defined action, or a `url` target that
      //     matches no in-app route, ships a button that renders and silently
      //     does nothing on click. Dead script/modal targets fail the build
      //     (they fail open at runtime); unresolved url routes are advisory.
      if (!flags.json) printStep('Checking dashboard action references (ADR-0049)...');
      const actionRefFindings = validateDashboardActionRefs(result.data as Record<string, unknown>);
      const actionRefErrors = actionRefFindings.filter((f) => f.severity === 'error');
      const actionRefWarnings = actionRefFindings.filter((f) => f.severity === 'warning');
      if (actionRefErrors.length > 0) {
        if (flags.json) {
          console.log(JSON.stringify({ success: false, error: 'dashboard action reference validation failed', issues: actionRefErrors }));
          this.exit(1);
        }
        console.log('');
        printError(`Dashboard action reference check failed (${actionRefErrors.length} issue${actionRefErrors.length > 1 ? 's' : ''})`);
        for (const f of actionRefErrors.slice(0, 50)) {
          console.log(`  • ${f.where}: ${f.message}`);
          console.log(chalk.dim(`      ${f.hint}`));
          console.log(chalk.dim(`      rule: ${f.rule}  at ${f.path}`));
        }
        this.exit(1);
      }
      if (actionRefWarnings.length > 0 && !flags.json) {
        console.log('');
        for (const w of actionRefWarnings) {
          printWarning(`${w.where}: ${w.message}`);
          console.log(chalk.dim(`    ${w.hint}`));
          console.log(chalk.dim(`    rule: ${w.rule}  at ${w.path}`));
        }
      }

      // 3c. SDUI scoped-styling correctness (ADR-0065) — a styled node without
      //     an `id` drops its CSS silently; Tailwind-in-className does nothing
      //     from metadata. Same bar for hand-authored and AI-generated pages
      //     (ADR-0019). Errors fail the build; warnings are advisory.
      if (!flags.json) printStep('Checking SDUI styling (ADR-0065)...');
      const styleFindings = validateResponsiveStyles(result.data as Record<string, unknown>);
      const styleErrors = styleFindings.filter((f) => f.severity === 'error');
      const styleWarnings = styleFindings.filter((f) => f.severity === 'warning');
      if (styleErrors.length > 0) {
        if (flags.json) {
          console.log(JSON.stringify({ success: false, error: 'SDUI styling validation failed', issues: styleErrors }));
          this.exit(1);
        }
        console.log('');
        printError(`SDUI styling check failed (${styleErrors.length} issue${styleErrors.length > 1 ? 's' : ''})`);
        for (const f of styleErrors.slice(0, 50)) {
          console.log(`  • ${f.where}: ${f.message}`);
          console.log(chalk.dim(`      ${f.hint}`));
          console.log(chalk.dim(`      rule: ${f.rule}  at ${f.path}`));
        }
        this.exit(1);
      }
      if (styleWarnings.length > 0 && !flags.json) {
        console.log('');
        for (const w of styleWarnings) {
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
      //     misleading (e.g. `object.enable.files`, `field.columnName`) or
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

      // 3d-ter. Autonumber `{field}` interpolation lint. A format like
      //     `{plan_no}{000}` makes the referenced field part of the counter
      //     scope, so it must exist and be set at create time — otherwise the
      //     runtime throws (or, unlinted, silently mis-numbers). An unknown
      //     field is broken → fails the build; an optional field is fragile →
      //     advisory warning. Mirrors the broken/fragile two-level guardrail.
      const autonumberLint = lintAutonumberFormats(result.data as Record<string, unknown>);
      const autonumberErrors = autonumberLint.filter((f) => f.severity === 'error');
      const autonumberWarnings = autonumberLint.filter((f) => f.severity === 'warning');
      if (autonumberErrors.length > 0) {
        if (flags.json) {
          console.log(JSON.stringify({ success: false, error: 'autonumber format validation failed', issues: autonumberErrors }));
          this.exit(1);
        }
        console.log('');
        printError(`Autonumber format validation failed (${autonumberErrors.length} issue${autonumberErrors.length > 1 ? 's' : ''})`);
        for (const f of autonumberErrors) {
          console.log(`  • ${f.where}: ${f.message}`);
          console.log(chalk.dim(`      ${f.hint}`));
          console.log(chalk.dim(`      rule: ${f.rule}`));
        }
        this.exit(1);
      }
      if (autonumberWarnings.length > 0 && !flags.json) {
        console.log('');
        for (const f of autonumberWarnings) {
          printWarning(`${f.where}: ${f.message}`);
          console.log(chalk.dim(`    ${f.hint}`));
          console.log(chalk.dim(`    rule: ${f.rule}`));
        }
      }

      // 3d-quater. View-reference lint (#2554) — resolves form action targets
      //     and view-key collisions at build time. A `type:'form'` target that
      //     names a missing view or a LIST view opens a broken/blank form at
      //     runtime; a list/form key collision silently renames one view so
      //     references resolve to the OTHER. Both are broken → fail the build.
      //     This shifts objectui's runtime `viewKind` guard left to compile.
      const viewRefLint = lintViewRefs(result.data as Record<string, unknown>);
      const viewRefErrors = viewRefLint.filter((f) => f.severity === 'error');
      const viewRefWarnings = viewRefLint.filter((f) => f.severity === 'warning');
      if (viewRefErrors.length > 0) {
        if (flags.json) {
          console.log(JSON.stringify({ success: false, error: 'view reference validation failed', issues: viewRefErrors }));
          this.exit(1);
        }
        console.log('');
        printError(`View reference validation failed (${viewRefErrors.length} issue${viewRefErrors.length > 1 ? 's' : ''})`);
        for (const f of viewRefErrors) {
          console.log(`  • ${f.where}: ${f.message}`);
          console.log(chalk.dim(`      ${f.hint}`));
          console.log(chalk.dim(`      rule: ${f.rule}`));
        }
        this.exit(1);
      }
      if (viewRefWarnings.length > 0 && !flags.json) {
        console.log('');
        for (const f of viewRefWarnings) {
          printWarning(`${f.where}: ${f.message}`);
          console.log(chalk.dim(`    ${f.hint}`));
          console.log(chalk.dim(`    rule: ${f.rule}`));
        }
      }

      // 3e. [ADR-0090 D7] Security-domain publish linter. Every error rule
      //     mirrors a runtime enforcement point (fail-closed OWD default,
      //     canonical enum, anchor binding gate, vocabulary freeze) — the lint
      //     moves the failure from a runtime deny to an author-time fix-it.
      //     Errors GATE the build (per ADR-0049 this is not advisory
      //     security); `info` findings are printed dimmed and never fatal.
      if (!flags.json) printStep('Checking security posture (ADR-0090 D7)...');
      const securityFindings = validateSecurityPosture(result.data as Record<string, unknown>);
      const securityErrors = securityFindings.filter((f) => f.severity === 'error');
      const securityAdvisories = securityFindings.filter((f) => f.severity !== 'error');
      if (securityErrors.length > 0) {
        if (flags.json) {
          console.log(JSON.stringify({ success: false, error: 'security posture validation failed', issues: securityErrors }));
          this.exit(1);
        }
        console.log('');
        printError(`Security posture check failed (${securityErrors.length} issue${securityErrors.length > 1 ? 's' : ''})`);
        for (const f of securityErrors.slice(0, 50)) {
          console.log(`  • ${f.where}: ${f.message}`);
          console.log(chalk.dim(`      ${f.hint}`));
          console.log(chalk.dim(`      rule: ${f.rule}  at ${f.path}`));
        }
        this.exit(1);
      }
      if (securityAdvisories.length > 0 && !flags.json) {
        console.log('');
        for (const f of securityAdvisories) {
          printWarning(`${f.where}: ${f.message}`);
          console.log(chalk.dim(`    ${f.hint}`));
          console.log(chalk.dim(`    rule: ${f.rule}`));
        }
      }

      // 3e2. [#3425] Readonly flow-write guardrail. A `runAs:user` update_record
      //      writing a static-`readonly` field is a silent no-op — the engine
      //      strips it from the UPDATE payload (#2948) while the step reports
      //      success. This GATES the build (shift-left of the #3407/#3413
      //      run-time strip warning); `readonlyWhen` writes are per-record-state,
      //      so they are advisory, printed dimmed and never fatal.
      if (!flags.json) printStep('Checking readonly flow writes (#3425)...');
      const readonlyWriteFindings = validateReadonlyFlowWrites(result.data as Record<string, unknown>);
      const readonlyWriteErrors = readonlyWriteFindings.filter((f) => f.severity === 'error');
      const readonlyWriteAdvisories = readonlyWriteFindings.filter((f) => f.severity !== 'error');
      if (readonlyWriteErrors.length > 0) {
        if (flags.json) {
          console.log(JSON.stringify({ success: false, error: 'readonly flow-write validation failed', issues: readonlyWriteErrors }));
          this.exit(1);
        }
        console.log('');
        printError(`Readonly flow-write check failed (${readonlyWriteErrors.length} issue${readonlyWriteErrors.length > 1 ? 's' : ''})`);
        for (const f of readonlyWriteErrors.slice(0, 50)) {
          console.log(`  • ${f.where}: ${f.message}`);
          console.log(chalk.dim(`      ${f.hint}`));
          console.log(chalk.dim(`      rule: ${f.rule}  at ${f.path}`));
        }
        this.exit(1);
      }
      if (readonlyWriteAdvisories.length > 0 && !flags.json) {
        console.log('');
        for (const f of readonlyWriteAdvisories) {
          printWarning(`${f.where}: ${f.message}`);
          console.log(chalk.dim(`    ${f.hint}`));
          console.log(chalk.dim(`    rule: ${f.rule}`));
        }
      }

      // 3f. [ADR-0090 D6] Access-matrix snapshot gate. Opt-in per app: when
      //     `access-matrix.json` sits next to the config, the (permission set
      //     × object) capability matrix derived from THIS build must match it
      //     — a drift fails the build with a SEMANTIC diff ("'crm_admin'
      //     gains delete on 'crm_lead'") until the snapshot is updated via
      //     --update-access-matrix. An unchanged matrix auto-passes, so the
      //     gate costs nothing until someone changes who-can-do-what.
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
                console.log(JSON.stringify({ success: false, error: 'access matrix drift', changes: drift }));
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

      // Spec-version drift advisory (non-blocking): installed platform newer
      // than the app declares → point at the migration guide.
      const specGap = checkSpecVersionGap((config as { manifest?: { specVersion?: unknown } }).manifest);

      if (flags.json) {
        console.log(JSON.stringify({
          success: true,
          output: artifactPath,
          size: jsonContent.length,
          handlersBundled: lowering.count,
          runtimeModule: runtimeBundle?.outputFileName ?? null,
          runtimeModuleSize: runtimeBundle?.size ?? 0,
          warnings: widgetWarnings,
          specVersionGap: specGap,
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
      if (specGap) {
        console.log('');
        console.log(chalk.yellow(`  ⚠ ${specGap.message}`));
        console.log(chalk.dim(`      → ${specGap.hint}`));
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
