// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import fs from 'fs';
import path from 'path';
import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { normalizeStackInput } from '@objectstack/spec';
import { loadConfig } from '../../utils/config.js';
import {
  printHeader,
  printSuccess,
  printError,
  printInfo,
  printStep,
  createTimer,
} from '../../utils/format.js';
import { extractTranslations, renderTranslationModule, type FillStrategy } from '../../utils/i18n-extract.js';

const FILL_STRATEGIES: FillStrategy[] = ['empty', 'default', 'todo'];

/** Count string-leaf entries under a nested object — used for reporting. */
function countLeaves(obj: unknown): number {
  if (!obj || typeof obj !== 'object') return 0;
  let n = 0;
  for (const v of Object.values(obj as Record<string, unknown>)) {
    if (typeof v === 'string') n += 1;
    else if (v && typeof v === 'object') n += countLeaves(v);
  }
  return n;
}

/**
 * `os i18n extract` — scaffold translation skeletons.
 *
 * Walks the normalized stack config and emits ready-to-edit `TranslationData`
 * fragments for every requested locale. Designed as the companion to
 * `os i18n check`: extract bootstraps the bundle, check validates it.
 */
export default class I18nExtract extends Command {
  static override description =
    'Scaffold per-locale translation skeletons from a stack config. Default locale is filled from schema labels; other locales follow --fill.';

  static override examples = [
    '$ os i18n extract',
    '$ os i18n extract --locales=zh-CN,ja-JP,es-ES',
    '$ os i18n extract --filter="^sys_" --out=./src/translations',
    '$ os i18n extract --fill=default --out=./src/translations',
    '$ os i18n extract --json',
  ];

  static override args = {
    config: Args.string({ description: 'Configuration file path', required: false }),
  };

  static override flags = {
    json: Flags.boolean({ description: 'Output JSON instead of writing files' }),
    'default-locale': Flags.string({
      description: 'Locale filled from schema labels',
      default: 'en',
    }),
    locales: Flags.string({
      description: 'Comma-separated list of locales to emit (always includes default-locale)',
    }),
    fill: Flags.string({
      description: 'How non-default locales are filled: empty | default | todo',
      default: 'empty',
      options: FILL_STRATEGIES as unknown as string[],
    }),
    filter: Flags.string({
      description: 'Regex; only entries matching objectName, appName or path are emitted',
    }),
    out: Flags.string({
      description: 'Directory to write <locale>.objects.generated.ts files into',
    }),
    'no-merge': Flags.boolean({
      description: 'Do not merge against existing translations — emit every expected key',
      default: false,
    }),
    'objects-only': Flags.boolean({
      description: 'Emit only the objects/globalActions subtree (default). Disable to include apps/dashboards.',
      default: true,
      allowNo: true,
    }),
    'dry-run': Flags.boolean({
      description: 'Print to stdout instead of writing to --out',
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(I18nExtract);
    const timer = createTimer();

    if (!flags.json) {
      printHeader('I18n Extract');
      printStep('Loading configuration...');
    }

    try {
      const { config, absolutePath } = await loadConfig(args.config);
      if (!flags.json) printInfo(`Config: ${chalk.white(absolutePath)}`);

      const normalized = normalizeStackInput(config as Record<string, unknown>);
      const filter = flags.filter ? new RegExp(flags.filter) : undefined;
      const locales = flags.locales
        ? flags.locales.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;

      const result = extractTranslations(normalized, {
        defaultLocale: flags['default-locale'],
        locales,
        fill: flags.fill as FillStrategy,
        filter,
        mergeExisting: !flags['no-merge'],
      });

      const localesEmitted = Object.keys(result.bundles);
      const objectsOnly = flags['objects-only'];

      // Count metadataForms keys per locale (computed separately so we
      // can show users an honest summary even when --objects-only).
      const metadataFormsCounts: Record<string, number> = {};
      for (const locale of localesEmitted) {
        metadataFormsCounts[locale] = countLeaves(result.bundles[locale]?.metadataForms);
      }
      const anyMetadataForms = Object.values(metadataFormsCounts).some((n) => n > 0);

      if (flags.json) {
        console.log(JSON.stringify({
          totalExpected: result.totalExpected,
          counts: result.counts,
          metadataFormsCounts,
          bundles: objectsOnly
            ? Object.fromEntries(localesEmitted.map((l) => [l, result.bundles[l].objects ?? {}]))
            : result.bundles,
          duration: timer.elapsed(),
        }, null, 2));
        return;
      }

      console.log('');
      console.log(chalk.bold('  Skeleton summary'));
      const nameWidth = Math.max(8, ...localesEmitted.map((l) => l.length));
      for (const locale of localesEmitted) {
        const n = result.counts[locale];
        const tone = n === 0 ? chalk.green : chalk.yellow;
        const mfN = metadataFormsCounts[locale] ?? 0;
        const mfTail = mfN > 0 ? chalk.dim(`  + ${mfN} metadataForms key(s)`) : '';
        console.log(
          `    ${locale.padEnd(nameWidth)} ${tone(String(n).padStart(5))} key(s)` +
          chalk.dim(`  (of ${result.totalExpected} expected)`) + mfTail,
        );
      }
      console.log('');

      if (flags['dry-run'] || !flags.out) {
        for (const locale of localesEmitted) {
          if (result.counts[locale] === 0 && metadataFormsCounts[locale] === 0) continue;
          console.log(chalk.dim(`── ${locale} (objects) ──`));
          console.log(renderTranslationModule(result.bundles[locale], {
            locale,
            objectsOnly,
          }));
          if (metadataFormsCounts[locale] > 0) {
            console.log(chalk.dim(`── ${locale} (metadataForms) ──`));
            console.log(renderTranslationModule(result.bundles[locale], {
              locale,
              kind: 'metadataForms',
            }));
          }
        }
        printInfo('Dry run — no files written (pass --out=<dir> to write).');
        return;
      }

      const outDir = path.resolve(process.cwd(), flags.out);
      fs.mkdirSync(outDir, { recursive: true });
      let written = 0;
      for (const locale of localesEmitted) {
        if (result.counts[locale] > 0) {
          const file = path.join(outDir, `${locale}.objects.generated.ts`);
          fs.writeFileSync(
            file,
            renderTranslationModule(result.bundles[locale], { locale, objectsOnly }),
            'utf8',
          );
          written += 1;
          printInfo(`Wrote ${chalk.white(path.relative(process.cwd(), file))} (${result.counts[locale]} keys)`);
        }
        if (metadataFormsCounts[locale] > 0) {
          const file = path.join(outDir, `${locale}.metadata-forms.generated.ts`);
          fs.writeFileSync(
            file,
            renderTranslationModule(result.bundles[locale], { locale, kind: 'metadataForms' }),
            'utf8',
          );
          written += 1;
          printInfo(`Wrote ${chalk.white(path.relative(process.cwd(), file))} (${metadataFormsCounts[locale]} keys)`);
        }
      }
      if (!anyMetadataForms) {
        printInfo('(no metadataForms keys discovered for these locales)');
      }
      console.log('');
      printSuccess(`Generated ${written} file(s) ${chalk.dim(`(${timer.display()})`)}`);
    } catch (error: any) {
      if (flags.json) {
        console.log(JSON.stringify({ error: error.message }));
        process.exit(1);
      }
      console.log('');
      printError(error.message || String(error));
      process.exit(1);
    }
  }
}
