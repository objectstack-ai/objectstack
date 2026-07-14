// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import chalk from 'chalk';
import { ZodError } from 'zod';
import { ObjectStackDefinitionSchema, normalizeStackInput, type ConversionNotice } from '@objectstack/spec';
import { loadConfig } from '../utils/config.js';
import { validateStackExpressions } from '@objectstack/lint';
import { validateListViewMode } from '@objectstack/lint';
import { validateWidgetBindings } from '@objectstack/lint';
import { validateResponsiveStyles } from '@objectstack/lint';
import { validateJsxPages, validateReactPages, validateReactPageProps, validatePageSourceStyling } from '@objectstack/lint';
import { validateCapabilityReferences } from '@objectstack/lint';
import { validateSecurityPosture } from '@objectstack/lint';
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
} from '../utils/format.js';

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
      const result = ObjectStackDefinitionSchema.safeParse(normalized);

      if (!result.success) {
        if (flags.json) {
          console.log(JSON.stringify({
            valid: false,
            errors: (result.error as unknown as ZodError).issues,
            duration: timer.elapsed(),
          }, null, 2));
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
          console.log(JSON.stringify({
            valid: false,
            errors: exprErrors,
            warnings: exprWarnings,
            duration: timer.elapsed(),
          }, null, 2));
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
          console.log(JSON.stringify({
            valid: false,
            errors: listViewErrors,
            duration: timer.elapsed(),
          }, null, 2));
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
          console.log(JSON.stringify({
            valid: false,
            errors: widgetErrors,
            warnings: widgetWarnings,
            duration: timer.elapsed(),
          }, null, 2));
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
          console.log(JSON.stringify({
            valid: false,
            errors: styleErrors,
            warnings: [...widgetWarnings, ...styleWarnings],
            duration: timer.elapsed(),
          }, null, 2));
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
          console.log(JSON.stringify({
            valid: false,
            errors: jsxErrors,
            warnings: [...widgetWarnings, ...styleWarnings, ...jsxWarnings],
            duration: timer.elapsed(),
          }, null, 2));
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
          console.log(JSON.stringify({
            valid: false,
            errors: reactErrors,
            warnings: [...widgetWarnings, ...styleWarnings, ...jsxWarnings],
            duration: timer.elapsed(),
          }, null, 2));
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
          console.log(JSON.stringify({
            valid: false,
            errors: reactPropErrors,
            warnings: [...widgetWarnings, ...styleWarnings, ...jsxWarnings, ...reactPropWarnings],
            duration: timer.elapsed(),
          }, null, 2));
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

      // 3f. [ADR-0090 D7] Security posture — the same gate `os compile`/`os build`
      //     run. Without it here, `os validate` passed a stack (e.g. a custom
      //     object with no explicit sharingModel) that the build then rejected,
      //     breaking this command's contract of being the artifact-free run of
      //     the same gates. Errors gate; advisories print dimmed.
      if (!flags.json) printStep('Checking security posture (ADR-0090 D7)...');
      const securityFindings = validateSecurityPosture(result.data as Record<string, unknown>);
      const securityErrors = securityFindings.filter((f) => f.severity === 'error');
      const securityAdvisories = securityFindings.filter((f) => f.severity !== 'error');
      if (securityErrors.length > 0) {
        if (flags.json) {
          console.log(JSON.stringify({
            valid: false,
            errors: securityErrors,
            duration: timer.elapsed(),
          }, null, 2));
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

      // 4. Collect and display stats
      const stats = collectMetadataStats(config);

      if (flags.json) {
        console.log(JSON.stringify({
          valid: true,
          manifest: config.manifest,
          stats,
          warnings: [...exprWarnings, ...widgetWarnings, ...styleWarnings, ...jsxWarnings, ...capWarnings, ...securityAdvisories],
          conversions: conversionNotices,
          duration: timer.elapsed(),
        }, null, 2));
        return;
      }

      // 5. Warnings (non-blocking)
      const warnings: string[] = [];

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

      console.log('');
    } catch (error: any) {
      if (flags.json) {
        console.log(JSON.stringify({
          valid: false,
          error: error.message,
          duration: timer.elapsed(),
        }, null, 2));
        this.exit(1);
      }
      console.log('');
      printError(error.message || String(error));
      this.exit(1);
    }
  }
}
