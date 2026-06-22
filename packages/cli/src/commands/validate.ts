// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { ZodError } from 'zod';
import { ObjectStackDefinitionSchema, normalizeStackInput } from '@objectstack/spec';
import { loadConfig } from '../utils/config.js';
import { validateStackExpressions } from '@objectstack/lint';
import { validateWidgetBindings } from '@objectstack/lint';
import { validateResponsiveStyles } from '@objectstack/lint';
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

      // 2. Normalize map-formatted stack definition and validate against schema
      if (!flags.json) printStep('Validating against ObjectStack Protocol...');
      const normalized = normalizeStackInput(config as Record<string, unknown>);
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

      // 4. Collect and display stats
      const stats = collectMetadataStats(config);

      if (flags.json) {
        console.log(JSON.stringify({
          valid: true,
          manifest: config.manifest,
          stats,
          warnings: [...exprWarnings, ...widgetWarnings, ...styleWarnings],
          duration: timer.elapsed(),
        }, null, 2));
        return;
      }

      // 5. Warnings (non-blocking)
      const warnings: string[] = [];

      for (const i of exprWarnings) {
        warnings.push(`${i.where}: ${i.message}`);
      }
      for (const f of widgetWarnings) {
        warnings.push(`${f.where}: ${f.message}`);
      }
      for (const f of styleWarnings) {
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
