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
  errorCodeFields,
} from '../../utils/format.js';
import {
  extractTranslations,
  renderTranslationModule,
  renderSourceHashModule,
  parseSourceHashModule,
  narrowToCommittedSections,
  translationModulePayload,
  countTranslationLeaves,
  type FillStrategy,
  type TranslationModuleKind,
} from '../../utils/i18n-extract.js';

const FILL_STRATEGIES: FillStrategy[] = ['empty', 'default', 'todo'];

/**
 * A path for one of this command's output lines: relative to the cwd while that
 * is still a NAME for the file, absolute once it stops being one.
 *
 * Every path this command printed used to be a bare `path.relative(cwd, file)`,
 * and for an `--out` outside the project that is not a name — it is a walk.
 * Driven from `packages/cli` with `--out=/tmp/os-i18n-repro-jNrZ`, the `--check`
 * failure reported
 * `missing:    ../../../../../tmp/os-i18n-repro-jNrZ/zh-CN.objects.generated.ts`
 * for a directory the operator had just typed in full (#14895). Nothing in that
 * string is recognisable as what they wrote, and it only resolves against a cwd
 * the line does not state.
 *
 * The threshold is "does the relative form still descend from here", not a
 * length: an in-tree `--out` — which is what all nine of this repo's extract
 * configs use — keeps the short form it has always had, and only a path that
 * has to climb out of the cwd is printed absolute.
 */
function displayPath(file: string): string {
  const rel = path.relative(process.cwd(), file);
  // `path.relative` answers with an ABSOLUTE path across Windows drive roots,
  // where no relative form exists at all; that is already the answer wanted.
  if (!rel || path.isAbsolute(rel)) return file;
  return rel === '..' || rel.startsWith(`..${path.sep}`) ? file : rel;
}

/** One argv token, spelled so a POSIX shell hands it back byte-for-byte. */
function shellToken(token: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(token)) return token;
  // Close the quote, emit an escaped quote, reopen — the only way a literal
  // `'` survives single quoting.
  return `'${token.split("'").join("'\\''")}'`;
}

/**
 * This run's own invocation with `--check` taken out of it — the ONLY command
 * the `--check` failure hint may print.
 *
 * ## Why a deletion and never an assembly
 *
 * The hint used to be BUILT, from four things this file happened to have in
 * scope: the config arg, the emitted locales minus the default one, `--fill`
 * and `--out`. Everything else the operator passed was simply not in the
 * expression, so it was not in the advice either. Driven on the reporter's
 * invocation (#14895):
 *
 *     $ os i18n extract stack.config.ts --locales=zh-CN --no-metadata-forms
 *       --no-objects-only --filter=kpi_ --out=OUT --check
 *     ✗ Translation bundles have drifted from the schema. Regenerate and commit:
 *     os i18n extract stack.config.ts --locales= --fill=empty --out=OUT
 *
 * `--locales=` came out EMPTY — the emitted locale was the default locale, and
 * the filter that drops the default one from the echo then drops the only
 * locale there was — while `--no-metadata-forms`, `--no-objects-only` and
 * `--filter=kpi_` were never candidates for the line to begin with. Running
 * what it printed emitted 775 keys across two files instead of 2 across one,
 * including a `metadata-forms` companion the operator had explicitly switched
 * off; the next `--check` then failed AGAIN, on `out of date:` instead of
 * `missing:`, and printed the same wrong command. That loop is the defect: the
 * failure is self-healable and the advice is what stops it healing.
 *
 * An assembled command is wrong in exactly one way and it is unbounded — every
 * flag that exists now, and every flag added later, has to be remembered at
 * this print site or it silently goes missing. So this does not enumerate
 * flags at all. It takes the argv oclif was handed and removes one token from
 * it, which makes the echo correct for flags this file has never heard of.
 *
 * ⛔ It also never GUESSES. If `--check` is not in the argv the flag was not
 * spelled there, this function cannot point at what it removed, and the caller
 * prints "re-run the same command without `--check`" instead — the degraded
 * line the report itself asked for, on the grounds that a correct vague
 * sentence beats a complete-looking wrong command. Today's flag surface has no
 * other way to set `--check` (no `env`, no default, no `allowNo`), so that is
 * defence rather than a path a user can reach; it is what keeps "assemble an
 * approximation" from ever becoming the fallback.
 *
 * `--` is honoured because it changes what a token MEANS: after it, `--check`
 * is a positional argument and removing it would rewrite the invocation rather
 * than trim it.
 *
 * @param bin  `config.bin` — `os`, the name the command is installed under
 * @param id   `this.id` — `i18n:extract`, oclif's colon spelling of the path
 * @param argv `this.argv` — the arguments as typed, the command id stripped
 * @returns the command to print, or `undefined` when it cannot be built
 */
function rerunWithoutCheck(bin: string, id: string | undefined, argv: readonly string[]): string | undefined {
  const kept: string[] = [];
  let dropped = 0;
  let afterTerminator = false;
  for (const token of argv) {
    if (!afterTerminator && token === '--') afterTerminator = true;
    else if (!afterTerminator && (token === '--check' || token.startsWith('--check='))) {
      dropped += 1;
      continue;
    }
    kept.push(token);
  }
  if (dropped === 0) return undefined;
  return [bin, ...(id ?? 'i18n:extract').split(':'), ...kept.map(shellToken)].join(' ');
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
      description:
        'Emit only the objects/globalActions subtree (default). Disable to include apps/dashboards. Never carries the Studio metadata-form baseline either way — that is --metadata-forms, which writes it to its own file.',
      default: true,
      allowNo: true,
    }),
    'metadata-forms': Flags.boolean({
      description:
        'Also write <locale>.metadata-forms.generated.ts for the Studio metadata-form baseline (default). Pass --no-metadata-forms in a package that owns only its own objects — that baseline belongs to one package, not every plugin. This is the only control over it: no other flag emits or suppresses that baseline.',
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

      /**
       * The sub-tree the stack module holds, and the selector that picks it.
       *
       * ⭐ Every key count this command reports — the summary line, each
       * `Wrote … (N keys)` line, the `--json` payload — is a leaf count of one
       * of these payloads, taken with the same selector the module is RENDERED
       * from. It is never `result.counts`: that is the whole skeleton the
       * extractor built for the locale, sections this run does not write
       * included, which under the default `--objects-only` is the ~773-key
       * metadata-form baseline plus every non-`objects` group the stack
       * authors. Reporting it beside a 2-leaf file is #16121.
       *
       * A third emission mode later (`--apps-only`, say) adds a `kind` and is
       * counted correctly without a number here moving, because no number here
       * is arithmetic over another one. ⛔ In particular nothing subtracts the
       * baseline at a print site: that repairs today's two modes and leaves the
       * next one wrong in the same way.
       */
      const stackKind: TranslationModuleKind = objectsOnly ? 'objects' : 'stack';
      const stackPayload = (locale: string) => translationModulePayload(result.bundles[locale], stackKind);

      // Counted for every locale, emitted or not, so the operator can still see
      // how big the baseline is when their flags suppress it.
      const metadataFormsCounts: Record<string, number> = {};
      for (const locale of localesEmitted) {
        metadataFormsCounts[locale] = countTranslationLeaves(
          translationModulePayload(result.bundles[locale], 'metadataForms'),
        );
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
      //
      // ⚠️ That orthogonality was a claim this file made and did not keep
      // (#14894). It held only while `--objects-only` was in effect: under
      // `--no-objects-only` the renderer's `kind: 'full'` folded the baseline
      // into the objects module, so `--no-metadata-forms` suppressed a copy
      // that was still being written next door — and with the flag left on,
      // both copies were written. This predicate is now the ONLY thing that
      // decides whether the baseline is emitted, because the stack module no
      // longer carries it (`stackAuthoredSubtree`). Nothing here picks a winner
      // between the two flags; there is no longer anything for them to contest.
      const emitsMetadataForms = (locale: string): boolean =>
        flags['metadata-forms'] && (metadataFormsCounts[locale] ?? 0) > 0;

      /** One module this run's flags CONSIDER for one locale. */
      interface CandidateModule {
        /** Written to `<locale>.<suffix>` when {@link CandidateModule.emitted}. */
        suffix: string;
        /** Sub-tree selector — picks the payload AND the rendered module's type. */
        kind: TranslationModuleKind;
        /** How this module is named in a `--dry-run` heading and in the summary. */
        label: string;
        /** Leaves this module holds. The ONE number reported for it, anywhere. */
        keys: number;
        /** Whether this run writes it. A candidate a flag SUPPRESSED is still
         *  reported — how big the thing they switched off is, is a reading the
         *  operator needs, and 8 of this repo's 9 extract configs are on that
         *  path (`--no-metadata-forms`). */
        emitted: boolean;
      }

      /**
       * Every module one locale's run considers, in file order — the single
       * list the summary, `--dry-run`, `--check` and the write loop all read,
       * so no two of them can disagree about what this run produces. The last
       * three take the `emitted` ones; the summary reports all of them and adds
       * up only the `emitted` ones.
       *
       * A module with no leaves is not a candidate at all. The write gate used
       * to be `result.counts[locale] > 0`, which is a property of the SKELETON:
       * on a stack whose only surface is apps, the default `--objects-only`
       * wrote an `<locale>.objects.generated.ts` holding `{}` and announced it
       * as 774 keys. Measured on this repair's fixture at `f5aec38a6af`.
       */
      const candidatesFor = (locale: string): CandidateModule[] => {
        const mods: CandidateModule[] = [];
        const stackKeys = countTranslationLeaves(stackPayload(locale));
        if (stackKeys > 0) {
          mods.push({
            suffix: 'objects.generated.ts',
            kind: stackKind,
            label: 'objects',
            keys: stackKeys,
            emitted: true,
          });
        }
        if ((metadataFormsCounts[locale] ?? 0) > 0) {
          mods.push({
            suffix: 'metadata-forms.generated.ts',
            kind: 'metadataForms',
            label: 'metadataForms',
            keys: metadataFormsCounts[locale] ?? 0,
            emitted: emitsMetadataForms(locale),
          });
        }
        return mods;
      };
      const candidates: Record<string, CandidateModule[]> = {};
      for (const locale of localesEmitted) candidates[locale] = candidatesFor(locale);
      /** The candidates this run actually writes — what every file face iterates. */
      const emittedModules = (locale: string): CandidateModule[] =>
        candidates[locale].filter((m) => m.emitted);

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
       * So the section list is decided by the SAME list that decides the
       * bundle files — {@link emittedModules} — never by a second rule. A set that commits both —
       * `platform-objects` is the one today — keeps every record it had. The
       * narrowing itself is `narrowToCommittedSections`, a pure function in the
       * extractor's utils so it can be pinned without driving oclif; this layer
       * contributes only the two booleans it alone knows.
       */
      const committedSourceHashes = (locale: string): Record<string, string> | undefined => {
        const table = result.sourceHashes[locale];
        if (!table) return undefined;
        const committed: string[] = [];
        if (emittedModules(locale).some((m) => m.kind !== 'metadataForms')) committed.push('objects');
        if (emittedModules(locale).some((m) => m.kind === 'metadataForms')) committed.push('metadataForms');
        return narrowToCommittedSections(table, committed);
      };

      if (flags.json) {
        await emitJson({
          totalExpected: result.totalExpected,
          // Leaves of the `bundles` payload below, locale by locale, so this
          // count describes the tree printed beside it.
          //
          // It used to forward `result.counts`, the extractor's per-locale
          // SKELETON size, while `bundles` carried only the sub-tree this run
          // emits: on a one-object stack under the default `--objects-only`
          // that was 776 against a 2-leaf `bundles` payload (#16121). The
          // skeleton total is still here — it is `totalExpected`.
          //
          // ⚠️ This is NOT the relationship `metadataFormsCounts` has to
          // `metadataForms`, and an earlier revision of this comment claimed it
          // was. `metadataFormsCounts` reports the baseline's size whether or
          // not the baseline is emitted — under `--no-metadata-forms` the
          // payload carries `metadataFormsCounts: { 'zh-CN': 773 }` beside
          // `metadataForms: {}`, deliberately, and a sibling pin holds it there
          // so an operator can still see how big the thing they switched off
          // is. So this payload carries TWO count semantics: `counts` is what
          // was emitted, `metadataFormsCounts` is what was built. Whether it
          // SHOULD is a question for the maintainer; this change neither
          // settles it nor moves either face.
          counts: Object.fromEntries(localesEmitted.map((l) => [l, countTranslationLeaves(stackPayload(l))])),
          metadataFormsCounts,
          // `--json` is documented as "output JSON instead of writing files",
          // so this payload mirrors the FILE SET: `bundles` is the stack
          // module, `metadataForms` below is the companion (#14894).
          bundles: Object.fromEntries(localesEmitted.map((l) => [l, stackPayload(l)])),
          // The baseline's JSON home, gated by {@link emitsMetadataForms} —
          // the SAME predicate that decides the companion file, deliberately
          // not a second one.
          //
          // ⚠️ Two predicates is what the review of this card's first commit
          // caught, and the reading is worth keeping: that commit stopped the
          // `kind: 'full'` fold on this face too, and left the baseline with no
          // JSON home at all. Driven on a one-object, one-app stack with
          // `defaultLocale: 'zh-CN'`, `--json --no-objects-only` with the flag
          // ON and with `--no-metadata-forms` produced payloads that were equal
          // in every field but `duration` — 3 leaves in `bundles`, no baseline
          // in either, and `metadataFormsCounts` reporting 773 in both. So on
          // this face the flag decided NOTHING, in the opposite direction from
          // the defect the card reported (where it was the fold that ignored
          // it). A flag that is ignored is a flag that is ignored, whichever
          // way the output falls.
          //
          // Keyed by locale and PRESENT ONLY for the locales whose companion is
          // written, so the key set here and the `*.metadata-forms.generated.ts`
          // set are the same set by construction. The map itself is always
          // emitted — an empty map says "no baseline in this run", which is a
          // reading; a missing key would be indistinguishable from an older CLI.
          metadataForms: Object.fromEntries(
            localesEmitted
              .filter((l) => emitsMetadataForms(l))
              .map((l) => [l, result.bundles[l].metadataForms ?? {}]),
          ),
          duration: timer.elapsed(),
        });
        return;
      }

      console.log('');
      console.log(chalk.bold('  Skeleton summary'));
      const nameWidth = Math.max(8, ...localesEmitted.map((l) => l.length));
      for (const locale of localesEmitted) {
        const mods = candidates[locale];
        // The modules are disjoint sub-trees of the skeleton, so this line is a
        // partition of it: how many of the locale's keys reach a module, out of
        // how many were built, and which module holds which. The old line added
        // the baseline to a number that already contained it and read as 1549
        // of 776 (#16121).
        //
        // A candidate a flag SUPPRESSED is named too, with its size and the
        // words that keep it out of the sum. Dropping it was an information
        // regression on the commonest path: `--no-metadata-forms` is what 8 of
        // this repo's 9 extract configs pass, and the old line at least told
        // those runs how big the baseline they switched off was.
        const emittedKeys = mods.filter((m) => m.emitted).reduce((n, m) => n + m.keys, 0);
        const skeleton = result.counts[locale] ?? 0;
        // Green means there is nothing to translate for this locale, which is a
        // property of the SKELETON. `0 of 774 emitted` is not that: it is a run
        // whose flags excluded everything built, and reading green there is the
        // same conflation this card is about.
        const tone = skeleton === 0 ? chalk.green : chalk.yellow;
        const breakdown = mods.length > 1 || mods.some((m) => !m.emitted)
          ? chalk.dim(`   ${mods.map((m) => `${m.label} ${m.keys}${m.emitted ? '' : ' not emitted'}`).join(' · ')}`)
          : '';
        console.log(
          `    ${locale.padEnd(nameWidth)} ${tone(String(emittedKeys).padStart(5))}` +
          chalk.dim(` of ${skeleton} key(s) emitted`) + breakdown,
        );
      }
      console.log('');

      if (flags.check && !flags.out) {
        throw new Error('--check needs --out=<dir> — it compares a fresh extract against the bundles committed there.');
      }

      if (flags['dry-run'] || !flags.out) {
        for (const locale of localesEmitted) {
          for (const mod of emittedModules(locale)) {
            console.log(chalk.dim(`── ${locale} (${mod.label}) ──`));
            console.log(renderTranslationModule(result.bundles[locale], { locale, kind: mod.kind }));
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
        for (const mod of emittedModules(locale)) {
          emitted.push({
            file: path.join(resolvedOutDir, `${locale}.${mod.suffix}`),
            content: renderTranslationModule(result.bundles[locale], { locale, kind: mod.kind }),
            keys: mod.keys,
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
          const shown = displayPath(file);
          if (!fs.existsSync(file)) missing.push(shown);
          else if (fs.readFileSync(file, 'utf8') !== content) stale.push(shown);
        }
        if (missing.length === 0 && stale.length === 0) {
          console.log('');
          printSuccess(`${emitted.length} bundle(s) are in sync with the schema ${chalk.dim(`(${timer.display()})`)}`);
          return;
        }
        for (const shown of missing) printError(`missing:    ${shown}`);
        for (const shown of stale) printError(`out of date: ${shown}`);
        console.log('');
        // The command that regenerates these bytes is THIS run without
        // `--check` — the two branches share the `emitted` list above, so the
        // write path cannot produce anything other than what was just
        // compared. {@link rerunWithoutCheck} says why it is spelled as a
        // deletion and what the degraded line is for.
        const rerun = rerunWithoutCheck(this.config.bin, this.id, this.argv);
        printError(
          'Translation bundles have drifted from the schema. Regenerate and commit:\n' +
          (rerun ? `  ${rerun}` : '  re-run the same command without `--check`'),
        );
        process.exit(1);
      }

      fs.mkdirSync(resolvedOutDir, { recursive: true });
      let written = 0;
      for (const { file, content, keys } of emitted) {
        fs.writeFileSync(file, content, 'utf8');
        written += 1;
        printInfo(`Wrote ${chalk.white(displayPath(file))} (${keys} keys)`);
      }
      if (!anyMetadataForms) {
        printInfo('(no metadataForms keys discovered for these locales)');
      }
      console.log('');
      printSuccess(`Generated ${written} file(s) ${chalk.dim(`(${timer.display()})`)}`);
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
