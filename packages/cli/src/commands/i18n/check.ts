// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { normalizeStackInput } from '@objectstack/spec';
import { loadConfig } from '../../utils/config.js';
import {
  printHeader,
  printSuccess,
  printWarning,
  printError,
  printInfo,
  printStep,
  createTimer,
  emitJson,
  isExitSignal,
  errorCodeFields,
} from '../../utils/format.js';
import { computeI18nCoverage } from '../../utils/i18n-coverage.js';

export default class I18nCheck extends Command {
  static override description =
    'Detect missing translation keys (object/field/option/view/action labels) across all configured locales';

  static override examples = [
    '$ os i18n check',
    '$ os i18n check ./objectstack.config.ts',
    '$ os i18n check --locales=en,zh-CN,ja-JP',
    '$ os i18n check --strict --threshold=95',
    '$ os i18n check --json',
  ];

  static override args = {
    config: Args.string({ description: 'Configuration file path', required: false }),
  };

  static override flags = {
    json: Flags.boolean({ description: 'Output as JSON' }),
    'default-locale': Flags.string({
      description:
        "Locale that must be 100% translated (errors raised against it). Defaults to the config's i18n.defaultLocale, else 'en'.",
    }),
    locales: Flags.string({
      description:
        'Comma-separated list of locales to check (default: the config\'s i18n.supportedLocales, else every locale found)',
    }),
    strict: Flags.boolean({
      description: 'Treat missing keys in non-default locales as errors (CI parity gate)',
    }),
    threshold: Flags.integer({
      description: 'Fail when any locale falls below this coverage percent (0-100)',
    }),
    'show-keys': Flags.boolean({
      description: 'List every missing key (otherwise the first 20 per locale are shown)',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(I18nCheck);
    const timer = createTimer();

    if (!flags.json) {
      printHeader('I18n Coverage');
      printStep('Loading configuration...');
    }

    try {
      const { config, absolutePath } = await loadConfig(args.config);
      if (!flags.json) printInfo(`Config: ${chalk.white(absolutePath)}`);

      const normalized = normalizeStackInput(config as Record<string, unknown>);
      const report = computeI18nCoverage(normalized, {
        defaultLocale: flags['default-locale'],
        locales: flags.locales ? flags.locales.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
        strict: flags.strict,
      });

      const thresholdViolations = flags.threshold !== undefined
        ? report.stats.filter((s) => s.coveragePercent < (flags.threshold as number))
        : [];

      if (flags.json) {
        await emitJson(
          { ...report, thresholdViolations, duration: timer.elapsed() },
          report.totals.errors > 0 || thresholdViolations.length > 0 ? 1 : 0,
        );
        return;
      }

      console.log('');

      // ── Per-locale coverage table ──
      console.log(chalk.bold('  Coverage by locale'));
      const nameWidth = Math.max(8, ...report.stats.map((s) => s.locale.length));
      for (const stat of report.stats) {
        const pct = stat.coveragePercent;
        const tone = pct >= 100 ? chalk.green : pct >= 80 ? chalk.yellow : chalk.red;
        const bar = renderBar(pct, 24);
        console.log(
          `    ${stat.locale.padEnd(nameWidth)} ${bar} ${tone(pct.toFixed(1).padStart(5) + '%')}` +
          chalk.dim(`  (${stat.translated}/${stat.expected}, missing ${stat.missing})`),
        );
      }
      console.log('');

      // ── Per-locale missing keys ──
      if (report.issues.length > 0) {
        const byLocale = new Map<string, typeof report.issues>();
        for (const issue of report.issues) {
          const list = byLocale.get(issue.locale) ?? [];
          list.push(issue);
          byLocale.set(issue.locale, list);
        }
        for (const [locale, items] of byLocale) {
          const errs = items.filter((i) => i.severity === 'error');
          const warns = items.filter((i) => i.severity === 'warning');
          const tone = errs.length > 0 ? chalk.bold.red : chalk.bold.yellow;
          const tag = errs.length > 0 ? `${errs.length} error(s)` : `${warns.length} warning(s)`;
          console.log(tone(`  ${locale}  ${tag}`));
          const limit = flags['show-keys'] ? items.length : Math.min(20, items.length);
          for (let i = 0; i < limit; i++) {
            const it = items[i];
            const colour = it.severity === 'error' ? chalk.red : chalk.yellow;
            const icon = it.severity === 'error' ? '✗' : '⚠';
            console.log(`    ${colour(icon)} ${it.key}`);
            console.log(chalk.dim(`      ${it.message}`));
          }
          if (items.length > limit) {
            console.log(chalk.dim(`    … and ${items.length - limit} more (re-run with --show-keys)`));
          }
          console.log('');
        }
      }

      // ── Threshold violations ──
      if (thresholdViolations.length > 0) {
        printError(`Threshold ${flags.threshold}% not met:`);
        for (const v of thresholdViolations) {
          console.log(`    ${chalk.red('✗')} ${v.locale}: ${v.coveragePercent.toFixed(1)}%`);
        }
        console.log('');
      }

      // ── Summary ──
      const parts: string[] = [];
      if (report.totals.errors > 0) parts.push(chalk.red(`${report.totals.errors} error(s)`));
      if (report.totals.warnings > 0) parts.push(chalk.yellow(`${report.totals.warnings} warning(s)`));
      if (parts.length === 0) {
        printSuccess(`All ${report.totals.expectedKeys} translation keys covered across ${report.locales.length} locale(s) ${chalk.dim(`(${timer.display()})`)}`);
      } else {
        console.log(`  ${parts.join(', ')} across ${report.locales.length} locale(s) ${chalk.dim(`(${timer.display()})`)}`);
        if (report.totals.errors === 0 && thresholdViolations.length === 0) {
          printWarning('Non-default locales have gaps but the default locale is fully covered.');
        }
      }
      console.log('');

      if (report.totals.errors > 0 || thresholdViolations.length > 0) process.exit(1);
    } catch (error: any) {
      if (isExitSignal(error)) throw error;
      if (flags.json) {
        await emitJson({ error: error.message, ...errorCodeFields(error) }, 0, { compact: true });
        process.exit(1);
      }
      console.log('');
      printError(error.message || String(error));
      process.exit(1);
    }
  }
}

function renderBar(pct: number, width: number): string {
  const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * width);
  const empty = width - filled;
  const tone = pct >= 100 ? chalk.green : pct >= 80 ? chalk.yellow : chalk.red;
  return tone('█'.repeat(filled)) + chalk.dim('░'.repeat(empty));
}
