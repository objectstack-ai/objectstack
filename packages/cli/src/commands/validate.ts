// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import chalk from 'chalk';
import { ZodError } from 'zod';
import {
  ObjectStackDefinitionSchema,
  normalizeStackInput,
  lintUnknownAuthoringKeys,
  formatUnknownAuthoringKey,
  type ConversionNotice,
} from '@objectstack/spec';
import { loadConfig } from '../utils/config.js';
import { validateStackExpressions } from '@objectstack/lint';
import { validateListViewMode } from '@objectstack/lint';
import { validateViewContainers } from '@objectstack/lint';
import { validateWidgetBindings } from '@objectstack/lint';
import { validateDashboardActionRefs } from '@objectstack/lint';
import { validateFilterTokens } from '@objectstack/lint';
import { validateReferenceIntegrity } from '@objectstack/lint';
import { validateResponsiveStyles } from '@objectstack/lint';
import { validateJsxPages, validateReactPages, validateReactPageProps, validatePageSourceStyling } from '@objectstack/lint';
import { validateCapabilityReferences } from '@objectstack/lint';
import { validateVisibilityPredicates } from '@objectstack/lint';
import { validateSecurityPosture, validateOrgAxisRedLines } from '@objectstack/lint';
import { validateFlowTriggerReadiness } from '@objectstack/lint';
import { validateReadonlyFlowWrites } from '@objectstack/lint';
import { lintFlowPatterns } from '../utils/lint-flow-patterns.js';
import { lintAutonumberFormats } from '../utils/lint-autonumber-formats.js';
import { lintUniqueDeclarations } from '../lint/data-model-rules.js';
import { lintLivenessProperties } from '../utils/lint-liveness-properties.js';
import { lintViewRefs } from '../utils/lint-view-refs.js';
import { preflightRequiredCapabilities, renderCapabilityMessage } from '../utils/capability-preflight.js';
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
      // silently. PRE-parse for the same reason the visibility rule below is:
      // the parse is what strips them, so `result.data` no longer carries the
      // key the author actually wrote. Computed here rather than down in the
      // warnings section so the `--json` path reports it too — the
      // "computed, then discarded" shape this file already had to fix once.
      const unknownKeyWarnings = lintUnknownAuthoringKeys(normalized as Record<string, unknown>)
        .map(formatUnknownAuthoringKey);
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

      // 2b. Expression validation (ADR-0032 §1a/1b) — the same gate `os build`
      //     runs, brought to the read-only check so authors catch it without
      //     emitting an artifact. CEL predicates in actions/validations/flows/
      //     sharing/hooks are checked for syntax AND that `record.<field>`
      //     references resolve on the target object. This is what catches a
      //     BARE field ref (`done` instead of `record.done`) that would
      //     otherwise silently hide an action on every record (#2183/#2185).
      if (!flags.json) printStep('Validating expressions (ADR-0032)...');
      const exprIssues = validateStackExpressions(result.data as Record<string, unknown>);
      const exprErrors = exprIssues.filter((i) => i.severity !== 'warning');
      const exprWarnings = exprIssues.filter((i) => i.severity === 'warning');

      if (exprErrors.length > 0) {
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: exprErrors,
            warnings: exprWarnings,
            duration: timer.elapsed(),
          });
          this.exit(1);
        }
        console.log('');
        printError(`Expression validation failed (${exprErrors.length} issue${exprErrors.length > 1 ? 's' : ''})`);
        for (const i of exprErrors.slice(0, 50)) {
          console.log(`  • ${i.where}: ${i.message}`);
          console.log(chalk.dim(`      source: \`${i.source}\``));
        }
        this.exit(1);
      }

      // 2c. ADR-0053 list-view navigation modes — `userFilters`/`quickFilters`
      //     on an object list view ("views" mode) are silently dropped: the
      //     object-list schema (ObjectListViewSchema) OMITS them, so this is
      //     checked on `normalized` (PRE-parse) — `result.data` has already had
      //     the field stripped. They belong to a page list ("filters" mode).
      //     See objectui #2219 and ADR-0053 phase 4.
      if (!flags.json) printStep('Checking list-view navigation modes (ADR-0053)...');
      const listViewFindings = validateListViewMode(normalized as Record<string, unknown>);
      const listViewErrors = listViewFindings.filter((f) => f.severity === 'error');

      if (listViewErrors.length > 0) {
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: listViewErrors,
            duration: timer.elapsed(),
          });
          this.exit(1);
        }
        console.log('');
        printError(`List-view mode check failed (${listViewErrors.length} issue${listViewErrors.length > 1 ? 's' : ''})`);
        for (const f of listViewErrors.slice(0, 50)) {
          console.log(`  • ${f.where}: ${f.message}`);
          console.log(chalk.dim(`      ${f.hint}`));
          console.log(chalk.dim(`      rule: ${f.rule}  at ${f.path}`));
        }
        this.exit(1);
      }

      // 2d. View container shape — a flat list-view object in `views: []`
      //     parses to an EMPTY container (ViewSchema strips unknown keys), so
      //     the schema step passes while zero views register and the Console
      //     silently renders nothing. Checked on `normalized` (PRE-parse) —
      //     `result.data` has already had the flat keys stripped.
      if (!flags.json) printStep('Checking view container shape...');
      const viewContainerFindings = validateViewContainers(normalized as Record<string, unknown>);
      const viewContainerErrors = viewContainerFindings.filter((f) => f.severity === 'error');

      if (viewContainerErrors.length > 0) {
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: viewContainerErrors,
            duration: timer.elapsed(),
          });
          this.exit(1);
        }
        console.log('');
        printError(`View container check failed (${viewContainerErrors.length} issue${viewContainerErrors.length > 1 ? 's' : ''})`);
        for (const f of viewContainerErrors.slice(0, 50)) {
          console.log(`  • ${f.where}: ${f.message}`);
          console.log(chalk.dim(`      ${f.hint}`));
          console.log(chalk.dim(`      rule: ${f.rule}  at ${f.path}`));
        }
        this.exit(1);
      }

      // 3. Dashboard widget reference integrity (issue #1721) — a semantic
      //    cross-reference pass the protocol schema cannot express: every
      //    widget's `dataset`/`dimensions`/`values` and chartConfig
      //    axis/series fields must resolve against the declared datasets
      //    (ADR-0021). Errors fail validation; warnings are advisory.
      if (!flags.json) printStep('Checking dashboard widget bindings (ADR-0021)...');
      const widgetFindings = validateWidgetBindings(result.data as Record<string, unknown>);
      const widgetErrors = widgetFindings.filter((f) => f.severity === 'error');
      const widgetWarnings = widgetFindings.filter((f) => f.severity === 'warning');

      if (widgetErrors.length > 0) {
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: widgetErrors,
            warnings: widgetWarnings,
            duration: timer.elapsed(),
          });
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

      // 3a-bis. Dashboard action/route reference integrity (ADR-0049 for
      //     references, #3367) — a header/widget action names a `script`/`modal`
      //     target that resolves to no defined action, or a `url` target that
      //     matches no in-app route. Nothing else flags it, so it ships as a
      //     button that renders and silently does nothing on click (a false
      //     affordance). Dead script/modal targets are errors (fail open at
      //     runtime); unresolved url routes are advisory warnings.
      if (!flags.json) printStep('Checking dashboard action references (ADR-0049)...');
      const actionRefFindings = validateDashboardActionRefs(result.data as Record<string, unknown>);
      const actionRefErrors = actionRefFindings.filter((f) => f.severity === 'error');
      const actionRefWarnings = actionRefFindings.filter((f) => f.severity === 'warning');
      if (actionRefErrors.length > 0) {
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: actionRefErrors,
            warnings: [...widgetWarnings, ...actionRefWarnings],
            duration: timer.elapsed(),
          });
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
      if (!flags.json) {
        for (const w of actionRefWarnings.slice(0, 50)) {
          console.log(chalk.yellow(`  ⚠ ${w.where}: ${w.message}`));
          console.log(chalk.dim(`      ${w.hint}`));
        }
      }

      // 3a-ter. Filter placeholder resolvability (#3574) — a filter value like
      //     `{current_user}` resolves in no vocabulary, reaches the data engine
      //     as a literal, matches nothing, and the surface renders empty with
      //     no error anywhere. Silent-zero is indistinguishable from a genuine
      //     zero, so it survives human review; and an AI author reads the 0 as
      //     a successful query. Caught here because authoring time is the only
      //     place the diagnostic can still reach the author.
      if (!flags.json) printStep('Checking filter placeholders (#3574)...');
      const filterTokenFindings = validateFilterTokens(result.data as Record<string, unknown>);
      const filterTokenErrors = filterTokenFindings.filter((f) => f.severity === 'error');
      if (filterTokenErrors.length > 0) {
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: filterTokenErrors,
            warnings: [...widgetWarnings, ...actionRefWarnings],
            duration: timer.elapsed(),
          });
          this.exit(1);
        }
        console.log('');
        printError(`Filter placeholder check failed (${filterTokenErrors.length} issue${filterTokenErrors.length > 1 ? 's' : ''})`);
        for (const f of filterTokenErrors.slice(0, 50)) {
          console.log(`  • ${f.where}: ${f.message}`);
          console.log(chalk.dim(`      ${f.hint}`));
          console.log(chalk.dim(`      rule: ${f.rule}  at ${f.path}`));
        }
        this.exit(1);
      }

      // 3a-quater. Object-name + action-name reference integrity (#3583). The
      //     reference sites `defineStack` does not cover: action-param
      //     `reference`/`objectOverride`, dashboard filter `optionsFrom.object`,
      //     nav `requiresObject` gates, and the name-bound action surfaces
      //     (`bulkActions`/`rowActions`, page quick-actions, nav action items).
      //     Plus page-component field bindings and the chart surfaces outside
      //     dashboards (report charts, list-view charts, dataset-bound page
      //     chart components) — same ADR-0021 semantic layer, where an axis
      //     naming a raw field instead of a measure renders an empty series.
      //     All are plain strings in the schema, so a name resolving to nothing
      //     parses, ships, and fails silently at runtime. An unprefixed miss is
      //     a typo (error); a platform-prefixed name no known package registers
      //     is advisory (a third-party package may still provide it).
      //     Translation bundles get the same treatment in reverse: a key naming
      //     a field/view/action/section that no longer exists — or an option
      //     keyed by its display label instead of its stored value — resolves
      //     to nothing and renders the source string (advisory: inert, not
      //     broken).
      if (!flags.json) printStep('Checking object & action references (#3583)...');
      const refFindings = validateReferenceIntegrity(result.data as Record<string, unknown>);
      const refErrors = refFindings.filter((f) => f.severity === 'error');
      const refWarnings = refFindings.filter((f) => f.severity === 'warning');
      if (refErrors.length > 0) {
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: refErrors,
            warnings: [...widgetWarnings, ...actionRefWarnings, ...refWarnings],
            duration: timer.elapsed(),
          });
          this.exit(1);
        }
        console.log('');
        printError(`Reference integrity check failed (${refErrors.length} issue${refErrors.length > 1 ? 's' : ''})`);
        for (const f of refErrors.slice(0, 50)) {
          console.log(`  • ${f.where}: ${f.message}`);
          console.log(chalk.dim(`      ${f.hint}`));
          console.log(chalk.dim(`      rule: ${f.rule}  at ${f.path}`));
        }
        this.exit(1);
      }
      if (!flags.json) {
        for (const w of refWarnings.slice(0, 50)) {
          console.log(chalk.yellow(`  ⚠ ${w.where}: ${w.message}`));
          console.log(chalk.dim(`      ${w.hint}`));
        }
      }

      // 3b. SDUI scoped-styling correctness (ADR-0065) — a styled node's
      //     responsiveStyles must be scopable (needs an `id`), reference real
      //     CSS properties + design tokens, and carry a `large` base;
      //     Tailwind-in-className silently does nothing. Same bar for
      //     hand-authored and AI-generated pages (ADR-0019).
      if (!flags.json) printStep('Checking SDUI styling (ADR-0065)...');
      const styleFindings = validateResponsiveStyles(result.data as Record<string, unknown>);
      const styleErrors = styleFindings.filter((f) => f.severity === 'error');
      const styleWarnings = styleFindings.filter((f) => f.severity === 'warning');

      if (styleErrors.length > 0) {
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: styleErrors,
            warnings: [...widgetWarnings, ...styleWarnings],
            duration: timer.elapsed(),
          });
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

      // 3b. JSX-source pages (ADR-0080) — a kind:'jsx' page's `source` is
      //     parsed (never executed) and compiled to the SDUI tree at save
      //     time. Parse it now so malformed source fails loudly (ADR-0078)
      //     instead of being stored and breaking only at render.
      if (!flags.json) printStep('Checking JSX-source pages (ADR-0080)...');
      // Optional component manifest (ADR-0080): if the project ships a
      // `sdui.manifest.json` (generated from the registry's public tier), the
      // gate does full component/prop validation; otherwise parse-level.
      let sduiManifest: unknown;
      try {
        const mp = join(process.cwd(), 'sdui.manifest.json');
        if (existsSync(mp)) sduiManifest = JSON.parse(readFileSync(mp, 'utf8'));
        if (!sduiManifest) {
          // Fall back to the manifest shipped inside @objectstack/console
          // (built from objectui's public-tier registry; cli already deps it).
          const cp = createRequire(import.meta.url).resolve('@objectstack/console/dist/sdui.manifest.json');
          if (existsSync(cp)) sduiManifest = JSON.parse(readFileSync(cp, 'utf8'));
        }
      } catch { /* fall back to parse-level */ }
      const jsxFindings = validateJsxPages(
        result.data as Record<string, unknown>,
        sduiManifest ? { manifest: sduiManifest as never } : {},
      );
      const jsxErrors = jsxFindings.filter((f) => f.severity === 'error');
      const jsxWarnings = jsxFindings.filter((f) => f.severity === 'warning');

      if (jsxErrors.length > 0) {
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: jsxErrors,
            warnings: [...widgetWarnings, ...styleWarnings, ...jsxWarnings],
            duration: timer.elapsed(),
          });
          this.exit(1);
        }
        console.log('');
        printError(`JSX-source page check failed (${jsxErrors.length} issue${jsxErrors.length > 1 ? 's' : ''})`);
        for (const f of jsxErrors.slice(0, 50)) {
          console.log(`  \u2022 ${f.where}: ${f.message}`);
          console.log(chalk.dim(`      ${f.hint}`));
          console.log(chalk.dim(`      rule: ${f.rule}  at ${f.path}`));
        }
        this.exit(1);
      }

      // 3c. React-source pages (ADR-0081) — a kind:'react' page's `source` is
      //     real React executed at render. Transpile it now (Sucrase, never
      //     executed) so syntax errors fail loudly at build, not at render.
      if (!flags.json) printStep('Checking React-source pages (ADR-0081)...');
      const reactFindings = validateReactPages(result.data as Record<string, unknown>);
      const reactErrors = reactFindings.filter((f) => f.severity === 'error');
      if (reactErrors.length > 0) {
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: reactErrors,
            warnings: [...widgetWarnings, ...styleWarnings, ...jsxWarnings],
            duration: timer.elapsed(),
          });
          this.exit(1);
        }
        console.log('');
        printError(`React-source page check failed (${reactErrors.length} issue${reactErrors.length > 1 ? 's' : ''})`);
        for (const f of reactErrors.slice(0, 50)) {
          console.log(`  \u2022 ${f.where}: ${f.message}`);
          console.log(chalk.dim(`      ${f.hint}`));
          console.log(chalk.dim(`      rule: ${f.rule}  at ${f.path}`));
        }
        this.exit(1);
      }

      // 3d. React-source pages — prop usage against the component contract
      //     (ADR-0081 Phase 2): missing required bindings (error) + likely
      //     prop typos (warning), parsed from the real JSX.
      if (!flags.json) printStep('Checking React-source page props (ADR-0081)...');
      const reactPropFindings = validateReactPageProps(result.data as Record<string, unknown>);
      const reactPropErrors = reactPropFindings.filter((f) => f.severity === 'error');
      const reactPropWarnings = reactPropFindings.filter((f) => f.severity === 'warning');
      if (!flags.json) {
        for (const w of reactPropWarnings.slice(0, 50)) {
          console.log(chalk.yellow(`  \u26a0 ${w.where}: ${w.message}`));
          console.log(chalk.dim(`      ${w.hint}`));
        }
      }
      if (reactPropErrors.length > 0) {
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: reactPropErrors,
            warnings: [...widgetWarnings, ...styleWarnings, ...jsxWarnings, ...reactPropWarnings],
            duration: timer.elapsed(),
          });
          this.exit(1);
        }
        console.log('');
        printError(`React-source page prop check failed (${reactPropErrors.length} issue${reactPropErrors.length > 1 ? 's' : ''})`);
        for (const f of reactPropErrors.slice(0, 50)) {
          console.log(`  \u2022 ${f.where}: ${f.message}`);
          console.log(chalk.dim(`      ${f.hint}`));
          console.log(chalk.dim(`      rule: ${f.rule}  at ${f.path}`));
        }
        this.exit(1);
      }

      // 3e. Source-tier page styling (ADR-0065): Tailwind className in a
      //     kind:'html'/'react' page source silently no-ops (the build never
      //     scans authored metadata) — warn with the inline-style fix.
      if (!flags.json) printStep('Checking source-page styling (ADR-0065)...');
      const sourceStyleFindings = validatePageSourceStyling(result.data as Record<string, unknown>);
      const sourceStyleWarnings = sourceStyleFindings.filter((f) => f.severity === 'warning');
      if (!flags.json) {
        for (const w of sourceStyleWarnings.slice(0, 50)) {
          console.log(chalk.yellow(`  \u26a0 ${w.where}: ${w.message}`));
          console.log(chalk.dim(`      ${w.hint}`));
        }
      }

      // 3f. Capability references (ADR-0066 ⑨): a requiredPermissions entry
      //     naming a capability registered nowhere (no built-in, no permission
      //     set grants it, no sys_capability seed) is almost certainly a typo —
      //     it fails closed at runtime. Advisory: the capability may legitimately
      //     be provided by another installed package.
      if (!flags.json) printStep('Checking capability references (ADR-0066)...');
      const capFindings = validateCapabilityReferences(result.data as Record<string, unknown>);
      const capWarnings = capFindings.filter((f) => f.severity === 'warning');
      if (!flags.json) {
        for (const w of capWarnings.slice(0, 50)) {
          console.log(chalk.yellow(`  ⚠ ${w.where}: ${w.message}`));
          console.log(chalk.dim(`      ${w.hint}`));
        }
      }

      // 3g. Auto-launched flow trigger wiring (2026-07-17 third-party eval):
      //     a record-change flow whose start-node objectName matches nothing
      //     never fires — silently. Also nudges auto-triggered flows to declare
      //     an explicit deployment status (the schema default is 'draft', and
      //     draft flows DO still fire — ambiguous intent). Advisory: objects
      //     may come from other installed packages.
      if (!flags.json) printStep('Checking flow trigger wiring...');
      const flowReadinessFindings = validateFlowTriggerReadiness(normalized as Record<string, unknown>);
      const flowReadinessWarnings = flowReadinessFindings.filter((f) => f.severity === 'warning');
      if (!flags.json) {
        for (const w of flowReadinessWarnings.slice(0, 50)) {
          console.log(chalk.yellow(`  ⚠ ${w.where}: ${w.message}`));
          console.log(chalk.dim(`      ${w.hint}`));
        }
      }

      // 3g-bis. Flow template path references (#3426) used to be checked here by
      //     hand. It is a reference rule — a `{record.<field>}` token resolved
      //     against the bound object's declared fields — so it now runs as a
      //     member of REFERENCE_INTEGRITY_RULES in step 3 above, which reaches
      //     `os lint` and `os compile` at the same time. Those two accepted a
      //     flow whose filter token the runtime refuses (#3810) for as long as
      //     this call site was the only one.

      // 3e2. [#3425] Readonly flow-write guardrail. A `runAs:user` update_record
      //      that writes a static-`readonly` field is a SILENT no-op — the engine
      //      strips it from the UPDATE payload (#2948) yet the step reports
      //      success. This is the shift-left of the run-time strip warning
      //      (#3407/#3413): a static readonly + literal field is a certain no-op
      //      → error (gates); a `readonlyWhen` field is per-record-state → advisory.
      if (!flags.json) printStep('Checking readonly flow writes (#3425)...');
      const readonlyWriteFindings = validateReadonlyFlowWrites(normalized as Record<string, unknown>);
      const readonlyWriteErrors = readonlyWriteFindings.filter((f) => f.severity === 'error');
      const readonlyWriteWarnings = readonlyWriteFindings.filter((f) => f.severity === 'warning');
      if (readonlyWriteErrors.length > 0) {
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: readonlyWriteErrors,
            duration: timer.elapsed(),
          });
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
      if (!flags.json) {
        for (const f of readonlyWriteWarnings.slice(0, 50)) {
          console.log(chalk.yellow(`  ⚠ ${f.where}: ${f.message}`));
          console.log(chalk.dim(`      ${f.hint}`));
        }
      }

      // 3e3. [#3782] The four authoring lints that live in the CLI itself rather
      //      than in `@objectstack/lint`. Every other gate on this command is a
      //      `@objectstack/lint` import, so these four were only ever reachable
      //      from `compile.ts` — `os build` ran them, `os validate` did not, and
      //      the drift went unnoticed while all of their findings were advisory.
      //      Two of them already GATE the build (`lintAutonumberFormats`,
      //      `lintViewRefs` emit `severity: 'error'`), which made this command
      //      report a clean stack that `os build` then rejected — exactly the
      //      contract this command exists to uphold. Severity handling mirrors
      //      `compile.ts` per lint, so the two surfaces agree by construction.
      if (!flags.json) printStep('Running authoring lints (#3782)...');

      // Flow authoring anti-patterns (#1874). Advisory today; `severity: 'error'`
      // is honoured so a blocking rule (#3760's `flow-runas-unscoped`) gates here
      // the moment it gates the build, with no further wiring.
      const flowLint = lintFlowPatterns(result.data as Record<string, unknown>);
      const flowLintErrors = flowLint.filter((f) => f.severity === 'error');
      const flowLintWarnings = flowLint.filter((f) => f.severity !== 'error');

      // Liveness author-warnings — an authored property the ledger marks
      // dead-and-misleading or experimental. Advisory only, never fatal.
      const livenessLint = lintLivenessProperties(result.data as Record<string, unknown>);

      // Autonumber `{field}` interpolation — an unknown field is broken (error);
      // an optional one is fragile (warning).
      const autonumberLint = lintAutonumberFormats(result.data as Record<string, unknown>);
      const autonumberErrors = autonumberLint.filter((f) => f.severity === 'error');
      const autonumberWarnings = autonumberLint.filter((f) => f.severity !== 'error');

      // View references (#2554) — a form action target naming a missing or LIST
      // view, and list/form view-key collisions. Both are broken → error.
      const viewRefLint = lintViewRefs(result.data as Record<string, unknown>);
      const viewRefErrors = viewRefLint.filter((f) => f.severity === 'error');
      const viewRefWarnings = viewRefLint.filter((f) => f.severity !== 'error');

      // Contradictory uniqueness declarations (#3991) — a column carrying both a
      // field-level `unique: true` and a single-column declared unique index has
      // two intents, of which exactly one takes effect. Advisory. Mapped into the
      // `{ where, hint }` shape the shared renderer below expects; the rule lives
      // in `lint/data-model-rules.ts` so `os lint` reports the same finding.
      const uniqueLintWarnings = lintUniqueDeclarations(
        Array.isArray((result.data as Record<string, unknown>).objects)
          ? ((result.data as Record<string, unknown>).objects as any[])
          : [],
      ).map((f) => ({ where: f.path, message: f.message, hint: f.fix ?? '', rule: f.rule, severity: 'warning' as const }));

      const authoringLintErrors = [...flowLintErrors, ...autonumberErrors, ...viewRefErrors];
      const authoringLintWarnings = [
        ...flowLintWarnings,
        ...livenessLint,
        ...autonumberWarnings,
        ...viewRefWarnings,
        ...uniqueLintWarnings,
      ];
      if (authoringLintErrors.length > 0) {
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: authoringLintErrors,
            duration: timer.elapsed(),
          });
          this.exit(1);
        }
        console.log('');
        printError(`Authoring lint failed (${authoringLintErrors.length} issue${authoringLintErrors.length > 1 ? 's' : ''})`);
        for (const f of authoringLintErrors.slice(0, 50)) {
          console.log(`  • ${f.where}: ${f.message}`);
          console.log(chalk.dim(`      ${f.hint}`));
          console.log(chalk.dim(`      rule: ${f.rule}`));
        }
        this.exit(1);
      }
      if (!flags.json) {
        for (const f of authoringLintWarnings.slice(0, 50)) {
          console.log(chalk.yellow(`  ⚠ ${f.where}: ${f.message}`));
          console.log(chalk.dim(`      ${f.hint}`));
        }
      }

      // 3f. [ADR-0090 D7] Security posture — the same gate `os compile`/`os build`
      //     run. Without it here, `os validate` passed a stack (e.g. a custom
      //     object with no explicit sharingModel) that the build then rejected,
      //     breaking this command's contract of being the artifact-free run of
      //     the same gates. Errors gate; advisories print dimmed.
      if (!flags.json) printStep('Checking security posture (ADR-0090 D7)...');
      const securityFindings = [
        ...validateSecurityPosture(result.data as Record<string, unknown>),
        // [ADR-0105 D6] Organization-axis red lines: no permission inheritance
        // along the org tree, and business-unit trees stay org-internal. Same
        // finding shape, same gate — an `error` here blocks exactly as a
        // security-posture error does.
        ...validateOrgAxisRedLines(result.data as Record<string, unknown>),
      ];
      const securityErrors = securityFindings.filter((f) => f.severity === 'error');
      const securityAdvisories = securityFindings.filter((f) => f.severity !== 'error');
      if (securityErrors.length > 0) {
        if (flags.json) {
          await emitJson({
            valid: false,
            errors: securityErrors,
            duration: timer.elapsed(),
          });
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
      if (!flags.json) {
        for (const f of securityAdvisories.slice(0, 50)) {
          console.log(chalk.yellow(`  ⚠ ${f.where}: ${f.message}`));
          console.log(chalk.dim(`      ${f.hint}`));
        }
      }

      // 3h. [#3366] Installable-provider preflight — the shift-left of the
      //     `serve`-time capability check. `os validate` previously only checked
      //     the `requires` tokens against the vocabulary (ADR-0066), never
      //     whether each token's provider is resolvable in the active edition. A
      //     token whose provider has NO installable version here (e.g. `ai` →
      //     @objectstack/service-ai, cloud-only) fails; absent-but-installable is
      //     an advisory `pnpm add` hint. Mirrors the `os build` gate exactly.
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
          // `refWarnings` carries the whole reference-integrity suite, which now
          // includes the flow-template-path rule this list used to name directly.
          // It was absent here before: on a CLEAN run `--json` reported none of
          // the suite's warnings, though the failure path (above) and the console
          // both did. Same shape of bug as the dropped errors — computed, then
          // discarded — so it is fixed rather than reproduced under a new name.
          warnings: [...exprWarnings, ...widgetWarnings, ...actionRefWarnings, ...styleWarnings, ...jsxWarnings, ...capWarnings, ...flowReadinessWarnings, ...refWarnings, ...readonlyWriteWarnings, ...authoringLintWarnings, ...unknownKeyWarnings, ...securityAdvisories, ...capProviderWarnings],
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

      // ADR-0089 D3b — deprecated visibility aliases + mis-layered binding root.
      // Checked on `normalized` (PRE-parse): the schema folds `visibleOn`/
      // `visibility` into `visibleWhen` during parse, so `result.data` no longer
      // carries the alias the author actually wrote.
      const visibilityFindings = validateVisibilityPredicates(normalized as Record<string, unknown>);
      for (const f of visibilityFindings) {
        warnings.push(`${f.where}: ${f.message} — ${f.hint}`);
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
      for (const i of exprWarnings) {
        warnings.push(`${i.where}: ${i.message}`);
      }
      for (const f of widgetWarnings) {
        warnings.push(`${f.where}: ${f.message}`);
      }
      for (const f of styleWarnings) {
        warnings.push(`${f.where}: ${f.message}`);
      }
      for (const f of jsxWarnings) {
        warnings.push(`${f.where}: ${f.message}`);
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
