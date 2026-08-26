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
  emitJson,
  isExitSignal,
} from '../../utils/format.js';
import {
  extractTranslations,
  renderTranslationModule,
  renderSourceHashModule,
  parseSourceHashModule,
  narrowToCommittedSections,
  type FillStrategy,
} from '../../utils/i18n-extract.js';

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
      description: "Locale filled from schema labels. Defaults to the config's i18n.defaultLocale, else 'en'.",
    }),
    locales: Flags.string({
      description:
        "Comma-separated list of locales to emit (always includes default-locale). Defaults to the config's i18n.supportedLocales.",
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
    'metadata-forms': Flags.boolean({
      description:
        'Also write <locale>.metadata-forms.generated.ts for the Studio metadata-form baseline (default). Pass --no-metadata-forms in a package that owns only its own objects — that baseline belongs to one package, not every plugin.',
      default: true,
      allowNo: true,
    }),
    'source-hashes': Flags.boolean({
      description:
        'Also write <locale>.source-hashes.generated.ts — the provenance companion that lets a stale fill be told from a translation (#11671). Off by default: it is a format addition, so a bundle set opts in by documenting the flag in its extract config.',
      default: false,
      allowNo: true,
    }),
    'dry-run': Flags.boolean({
      description: 'Print to stdout instead of writing to --out',
      default: false,
    }),
    check: Flags.boolean({
      description: 'Write nothing; fail if the committed bundles in --out differ from a fresh extract',
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
      // The stack's own `i18n` block already names the languages it ships, so
      // scaffolding those by default saves repeating them on every invocation.
      const declared = (normalized as { i18n?: { defaultLocale?: unknown; supportedLocales?: unknown } }).i18n;
      const declaredLocales = Array.isArray(declared?.supportedLocales)
        ? declared.supportedLocales.filter((l): l is string => typeof l === 'string' && l.length > 0)
        : [];
      const locales = flags.locales
        ? flags.locales.split(',').map((s) => s.trim()).filter(Boolean)
        : declaredLocales.length > 0
          ? declaredLocales
          : undefined;
      const defaultLocale =
        flags['default-locale'] ??
        (typeof declared?.defaultLocale === 'string' && declared.defaultLocale.length > 0
          ? declared.defaultLocale
          : 'en');

      // Resolved before the extract because the previously committed provenance
      // records are an INPUT to it: they are the mechanism's only memory, and a
      // run that could not read them would silently re-derive every record from
      // the current tree and forget the drift it is supposed to be holding on to.
      const outDir = flags.out ? path.resolve(process.cwd(), flags.out) : undefined;
      const previousSourceHashes: Record<string, Record<string, string>> = {};
      if (flags['source-hashes'] && outDir) {
        for (const locale of locales ?? []) {
          const file = path.join(outDir, `${locale}.source-hashes.generated.ts`);
          if (!fs.existsSync(file)) continue;
          const table = parseSourceHashModule(fs.readFileSync(file, 'utf8'));
          if (table) previousSourceHashes[locale] = table;
        }
      }

      const result = extractTranslations(normalized, {
        defaultLocale,
        locales,
        previousSourceHashes,
        fill: flags.fill as FillStrategy,
        filter,
        // Merge (the default) never overwrites an existing non-default-locale
        // entry, so correcting a source label/description does not propagate
        // into a locale that already holds a translation of the old text —
        // a present-but-stale string is not a gap, only a missing one is. This
        // is deliberate, not an oversight: the alternative, --no-merge, wipes
        // every hand translation in the bundle, not just the ones the schema
        // changed. The maintenance path is a translator re-editing the leaf in
        // place (the generated bundle header names it); nothing here or in
        // `os i18n check` distinguishes that deliberate edit from a leaf
        // nobody has looked at since the source moved.
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
      // Whether the companion `<locale>.metadata-forms.generated.ts` file is
      // written is its own question, orthogonal to `--objects-only` (which only
      // picks the sub-tree of the *objects* module). The Studio metadata-form
      // baseline is registry-driven and identical for every stack, so exactly
      // one package should own it — `platform-objects` does. A plugin that owns
      // only its own objects passes `--no-metadata-forms`; without it, `--check`
      // demands a baseline copy the package deliberately does not commit and
      // fails on a tree that is in fact in sync.
      const emitsMetadataForms = (locale: string): boolean =>
        flags['metadata-forms'] && (metadataFormsCounts[locale] ?? 0) > 0;

      /**
       * The provenance table for one locale, narrowed to the sections this run
       * actually COMMITS (#12559).
       *
       * `extractTranslations` computes the table over every generated section it
       * built — `objects` and `metadataForms` both — because the rule that fills
       * it (`collectFilledFromHashes`) is a statement about generated leaves, not
       * about files. Which of those sections becomes a committed bundle is this
       * layer's decision, and the two must agree: a record describes the leaf
       * sitting in a bundle beside it, and a record for a leaf this package does
       * not commit describes nothing that exists here.
       *
       * The mismatch is not hypothetical — it is what the eight-set rollout in
       * #12559 measured on first contact. A package that owns only its own
       * objects passes `--no-metadata-forms`, and the emitter's own note two
       * blocks up says why: "without it, `--check` demands a baseline copy the
       * package deliberately does not commit". Its `metadataForms` subtree is
       * nonetheless built, and — having no entry in that package's merge
       * baseline — arrives as a fresh `--fill=default` copy of `en`, so EVERY
       * leaf of it satisfies `value === currentSource` and gets recorded.
       * Measured on `plugin-audit`: 763 records, of which **2** were its own
       * objects and 761 were digests of the Studio metadata-form baseline that
       * `@objectstack/platform-objects` owns. Those records are unreadable here
       * (no `metadataForms` bundle exists in this package for them to be about),
       * and they would move all three of this package's companions every time an
       * unrelated `*.form.ts` in `packages/spec` changed — the same cross-package
       * coupling ADR-0029 D8 and each package's `bundle-ownership.test.ts` exist
       * to keep out of its committed bundles.
       *
       * So the section list is decided by the SAME predicates that decide the
       * bundle files, never by a second rule: `result.counts` for `objects` and
       * {@link emitsMetadataForms} for `metadataForms`. A set that commits both —
       * `platform-objects` is the one today — keeps every record it had. The
       * narrowing itself is `narrowToCommittedSections`, a pure function in the
       * extractor's utils so it can be pinned without driving oclif; this layer
       * contributes only the two booleans it alone knows.
       */
      const committedSourceHashes = (locale: string): Record<string, string> | undefined => {
        const table = result.sourceHashes[locale];
        if (!table) return undefined;
        const committed: string[] = [];
        if ((result.counts[locale] ?? 0) > 0) committed.push('objects');
        if (emitsMetadataForms(locale)) committed.push('metadataForms');
        return narrowToCommittedSections(table, committed);
      };

      if (flags.json) {
        await emitJson({
          totalExpected: result.totalExpected,
          counts: result.counts,
          metadataFormsCounts,
          bundles: objectsOnly
            ? Object.fromEntries(localesEmitted.map((l) => [l, result.bundles[l].objects ?? {}]))
            : result.bundles,
          duration: timer.elapsed(),
        });
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

      if (flags.check && !flags.out) {
        throw new Error('--check needs --out=<dir> — it compares a fresh extract against the bundles committed there.');
      }

      if (flags['dry-run'] || !flags.out) {
        for (const locale of localesEmitted) {
          if (result.counts[locale] === 0 && metadataFormsCounts[locale] === 0) continue;
          console.log(chalk.dim(`── ${locale} (objects) ──`));
          console.log(renderTranslationModule(result.bundles[locale], {
            locale,
            objectsOnly,
          }));
          if (emitsMetadataForms(locale)) {
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

      // `flags.out` is non-empty here — the two branches above return otherwise.
      const resolvedOutDir = outDir as string;

      // Every file a normal run would emit, paired with its rendered content.
      // Both branches below iterate this, so `--check` can never diverge from
      // what a real extract writes.
      const emitted: Array<{ file: string; content: string; keys: number }> = [];
      for (const locale of localesEmitted) {
        if (result.counts[locale] > 0) {
          emitted.push({
            file: path.join(resolvedOutDir, `${locale}.objects.generated.ts`),
            content: renderTranslationModule(result.bundles[locale], { locale, objectsOnly }),
            keys: result.counts[locale],
          });
        }
        if (emitsMetadataForms(locale)) {
          emitted.push({
            file: path.join(resolvedOutDir, `${locale}.metadata-forms.generated.ts`),
            content: renderTranslationModule(result.bundles[locale], { locale, kind: 'metadataForms' }),
            keys: metadataFormsCounts[locale],
          });
        }
        // The provenance companion rides in the SAME list, so `--check` compares
        // it by the same byte-for-byte rule as the bundles it belongs to and can
        // never diverge from what a real extract writes.
        const table = committedSourceHashes(locale);
        if (flags['source-hashes'] && table) {
          emitted.push({
            file: path.join(resolvedOutDir, `${locale}.source-hashes.generated.ts`),
            content: renderSourceHashModule(table, { locale }),
            keys: Object.keys(table).length,
          });
        }
      }

      if (flags.check) {
        const stale: string[] = [];
        const missing: string[] = [];
        for (const { file, content } of emitted) {
          const rel = path.relative(process.cwd(), file);
          if (!fs.existsSync(file)) missing.push(rel);
          else if (fs.readFileSync(file, 'utf8') !== content) stale.push(rel);
        }
        if (missing.length === 0 && stale.length === 0) {
          console.log('');
          printSuccess(`${emitted.length} bundle(s) are in sync with the schema ${chalk.dim(`(${timer.display()})`)}`);
          return;
        }
        for (const rel of missing) printError(`missing:    ${rel}`);
        for (const rel of stale) printError(`out of date: ${rel}`);
        console.log('');
        printError(
          'Translation bundles have drifted from the schema. Regenerate and commit:\n' +
          `  os i18n extract ${args.config ?? ''} --locales=${localesEmitted.filter((l) => l !== defaultLocale).join(',')} ` +
          `--fill=${flags.fill} --out=${flags.out}`.replace(/\s+/g, ' '),
        );
        process.exit(1);
      }

      fs.mkdirSync(resolvedOutDir, { recursive: true });
      let written = 0;
      for (const { file, content, keys } of emitted) {
        fs.writeFileSync(file, content, 'utf8');
        written += 1;
        printInfo(`Wrote ${chalk.white(path.relative(process.cwd(), file))} (${keys} keys)`);
      }
      if (!anyMetadataForms) {
        printInfo('(no metadataForms keys discovered for these locales)');
      }
      console.log('');
      printSuccess(`Generated ${written} file(s) ${chalk.dim(`(${timer.display()})`)}`);
    } catch (error: any) {
      if (isExitSignal(error)) throw error;
      if (flags.json) {
        await emitJson({ error: error.message }, 0, { compact: true });
        process.exit(1);
      }
      console.log('');
      printError(error.message || String(error));
      process.exit(1);
    }
  }
}
