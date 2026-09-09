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
  translationModuleSections,
  countTranslationLeaves,
  type FillStrategy,
  type TranslationModuleKind,
} from '../../utils/i18n-extract.js';

const FILL_STRATEGIES: FillStrategy[] = ['empty', 'default', 'todo'];

/**
 * The refusal `--check` without `--out` ends on — one string, because two faces
 * now reach it. The console run throws it below the skeleton summary; a
 * `--json` run throws it from the machine face, where it lands in this
 * command's ordinary `{ error }` envelope (#16600).
 */
const CHECK_NEEDS_OUT =
  '--check needs --out=<dir> — it compares a fresh extract against the bundles committed there.';

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
 * flags at all. It takes the argv oclif was handed and removes the tokens that
 * make a run WRITE NOTHING, which keeps the echo correct for flags this file
 * has never heard of.
 *
 * ## Which tokens, and why it is not just `--check` (#16600)
 *
 * There are exactly two, and both are "write nothing" spellings:
 *
 *   - `--check` — the mode being escaped. Removing it is the whole point.
 *   - `--json` — "output JSON instead of writing files", so a run carrying it
 *     regenerates nothing either. It became reachable here the moment the
 *     machine face started reporting drift, and until it was dropped this
 *     function named a command that emits a payload, writes zero files, and
 *     leaves the next `--check --json` failing with the same advice: the
 *     #14895 loop above, reproduced one face over. A remedy that cannot heal
 *     the failure it is printed under is worse than none, because it looks
 *     like one.
 *
 * ⛔ It never GUESSES. If `--check` is not in the argv the flag was not spelled
 * there, this function cannot point at what it removed, and the caller prints a
 * degraded sentence instead — on the grounds that a correct vague sentence
 * beats a complete-looking wrong command. `--json`'s absence is NOT such a
 * signal: it is dropped when present and its absence means only that the run
 * was on the console face. Today's flag surface has no other way to set
 * `--check` (no `env`, no default, no `allowNo`), so the guard is defence
 * rather than a path a user can reach; it is what keeps "assemble an
 * approximation" from ever becoming the fallback.
 *
 * `--` is honoured because it changes what a token MEANS: after it, `--check`
 * is a positional argument and removing it would rewrite the invocation rather
 * than trim it. The same holds for `--json`.
 *
 * @param bin  `config.bin` — `os`, the name the command is installed under
 * @param id   `this.id` — `i18n:extract`, oclif's colon spelling of the path
 * @param argv `this.argv` — the arguments as typed, the command id stripped
 * @returns the command to print, or `undefined` when it cannot be built
 */
function rerunThatRegenerates(bin: string, id: string | undefined, argv: readonly string[]): string | undefined {
  const kept: string[] = [];
  let droppedCheck = 0;
  let afterTerminator = false;
  for (const token of argv) {
    if (!afterTerminator && token === '--') afterTerminator = true;
    else if (!afterTerminator && (token === '--check' || token.startsWith('--check='))) {
      droppedCheck += 1;
      continue;
    } else if (!afterTerminator && (token === '--json' || token.startsWith('--json='))) {
      // Dropped without being counted: only `--check`'s absence means "this
      // function cannot say what it removed".
      continue;
    }
    kept.push(token);
  }
  if (droppedCheck === 0) return undefined;
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
       * extractor's utils so it can be pinned without driving oclif.
       *
       * ⭐ And the sections are read off the PAYLOADS those modules hold
       * (`translationModuleSections`), not written here as literals. This layer
       * used to push `'objects'` and `'metadataForms'` — the emitted-module half
       * already read `emittedModules`, but what it pushed was a hand-copied
       * name, so under `kind: 'stack'` it named one of the several groups the
       * module actually commits. Nothing in this repository's provenance tables
       * is filtered by that mismatch today, because the tables only ever carry
       * the two GENERATED sections (`GENERATED_SECTIONS` in
       * `@objectstack/platform-objects`), and `'objects'` is the right name for
       * both stack kinds — the list was correct by COINCIDENCE, not by
       * construction, and a third generated section would have broken it
       * silently. It is now derived.
       *
       * ⭐ Returning `undefined` when nothing is committed is the second half,
       * and it is a file-set decision rather than a narrowing one:
       * `narrowToCommittedSections` returns `{}` for an empty section set, `{}`
       * is truthy at the emit site, and the run therefore wrote a zero-record
       * companion with NO bundle module beside it for it to be about. `--check`
       * compares the companion by bytes like any other emitted file, so that
       * orphan, once committed, is a file the gate demands forever.
       */
      const committedSourceHashes = (locale: string): Record<string, string> | undefined => {
        const table = result.sourceHashes[locale];
        if (!table) return undefined;
        const committed = new Set<string>();
        for (const mod of emittedModules(locale)) {
          for (const section of translationModuleSections(result.bundles[locale], mod.kind)) {
            committed.add(section);
          }
        }
        // No module is committed for this locale, so there is nothing beside a
        // companion for it to be ABOUT — and an orphan is worse than nothing:
        // `--check` compares by bytes against the emitted list, so a zero-record
        // companion written once is a file the gate demands forever. `{}` is
        // truthy, so returning the narrowed table here wrote exactly that.
        if (committed.size === 0) return undefined;
        return narrowToCommittedSections(table, committed);
      };

      /**
       * Every file a normal run would write into `dir`, paired with its
       * rendered content — the ONE list every face that names this run's files
       * reads: the write loop, the console `--check`, and the `--json`
       * `--check` below. So no two of them can disagree about what this run
       * produces, and in particular `--check` can never compare something the
       * write path would not have written.
       *
       * It was a straight-line `const emitted` built after the `--dry-run`
       * branch, which is below the machine face and therefore out of its reach.
       * A `--json --check` run needs the same list, so the list moved rather
       * than being rebuilt beside it (#16600).
       */
      const emittedFiles = (dir: string): Array<{ file: string; content: string; keys: number }> => {
        const files: Array<{ file: string; content: string; keys: number }> = [];
        for (const locale of localesEmitted) {
          for (const mod of emittedModules(locale)) {
            files.push({
              file: path.join(dir, `${locale}.${mod.suffix}`),
              content: renderTranslationModule(result.bundles[locale], { locale, kind: mod.kind }),
              keys: mod.keys,
            });
          }
          // The provenance companion rides in the SAME list, so `--check` compares
          // it by the same byte-for-byte rule as the bundles it belongs to and can
          // never diverge from what a real extract writes.
          const table = committedSourceHashes(locale);
          if (flags['source-hashes'] && table) {
            files.push({
              file: path.join(dir, `${locale}.source-hashes.generated.ts`),
              content: renderSourceHashModule(table, { locale }),
              keys: Object.keys(table).length,
            });
          }
        }
        return files;
      };

      /** What `--check` found: committed files that are absent, and ones whose bytes differ. */
      const compareCommitted = (
        files: ReadonlyArray<{ file: string; content: string }>,
      ): { missing: string[]; stale: string[] } => {
        const missing: string[] = [];
        const stale: string[] = [];
        for (const { file, content } of files) {
          const shown = displayPath(file);
          if (!fs.existsSync(file)) missing.push(shown);
          else if (fs.readFileSync(file, 'utf8') !== content) stale.push(shown);
        }
        return { missing, stale };
      };

      /**
       * The sentence a drifted `--check` ends on, built once so both faces end
       * on the same words. {@link rerunThatRegenerates} says which tokens the
       * command it names has had deleted and why it is spelled as a deletion.
       *
       * ⭐ The degraded line names the SAME tokens the built command would have
       * removed, so the two spellings of this advice cannot prescribe different
       * things: under `--json` a run without `--check` still writes nothing, and
       * a fallback that said only "without `--check`" would send an operator
       * round the #14895 loop exactly as a built command carrying `--json` did.
       */
      const driftMessage = (): string => {
        const rerun = rerunThatRegenerates(this.config.bin, this.id, this.argv);
        const degraded = flags.json
          ? '  re-run the same command without `--check` and without `--json` — neither of them writes files'
          : '  re-run the same command without `--check`';
        return (
          'Translation bundles have drifted from the schema. Regenerate and commit:\n' +
          (rerun ? `  ${rerun}` : degraded)
        );
      };

      if (flags.json) {
        /**
         * ⭐ `--check` is a VERDICT mode, so under `--json` the comparison runs
         * HERE — before the one document this run is allowed to write (#16600).
         *
         * ## What was wrong
         *
         * This branch emitted and returned unconditionally, which put it ahead
         * of both the `--check` needs-`--out` guard and the comparison itself.
         * Driven on one drifted fixture, the two invocations differing ONLY by
         * `--json`:
         *
         *     $ os i18n extract CONFIG --locales=zh-CN --no-metadata-forms
         *       --out=OUT --check
         *       missing:    OUT/zh-CN.objects.generated.ts
         *       Translation bundles have drifted from the schema. …
         *     -> exit 1
         *
         *     $ … --out=OUT --check --json
         *       {"totalExpected":…,"counts":…,"bundles":…}
         *     -> exit 0, nothing compared
         *
         * The first run is the second one's positive control: the drift is
         * provably there and the second reported success. Same shape as the
         * `--dry-run` branch in #16480, and `--json` is if anything the more
         * likely CI spelling of the two — a pipeline that wants to parse the
         * result reaches for it. A check that cannot fail is indistinguishable
         * from a check that finds nothing.
         *
         * ## Why the failure is this command's `{ error }` envelope and NOT a
         * new payload member
         *
         * ⛔ The drift report is deliberately NOT widened into the published
         * payload — no `drift` / `missing` / `stale` member is added here. This
         * command already has exactly one machine-readable failure envelope —
         * the `catch` at the end of this method: `{ error, …errorCodeFields }`,
         * compact, exit 1. Every other way this command can fail already speaks
         * it, the `--check` needs-`--out` refusal above included, so routing
         * drift through the same `throw` is copying the convention rather than
         * settling a second one for the same mode. Which files drifted is a
         * genuine addition to a published output face and is its own card.
         *
         * ⚠️ And it must stay ONE document: emitting the payload here and an
         * error envelope afterwards is the two-JSON-documents defect
         * {@link isExitSignal} records — unparseable as either one document or
         * as JSONL. So the verdict is reached before anything is written, and
         * the run leaves through exactly one of the two faces.
         *
         * ⛔ Returning 0 without comparing must not come back.
         */
        if (flags.check) {
          if (!flags.out) throw new Error(CHECK_NEEDS_OUT);
          const { missing, stale } = compareCommitted(emittedFiles(outDir as string));
          if (missing.length > 0 || stale.length > 0) throw new Error(driftMessage());
        }
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
        throw new Error(CHECK_NEEDS_OUT);
      }

      /**
       * The stdout dump `--dry-run` asks for — and, when `--check` is also on,
       * NOT a place this run may leave from (#16480).
       *
       * `--dry-run` and `--check` are both "write nothing" modes, so the pair
       * is not a contradiction: one says print the modules instead of writing
       * them, the other says compare them against what is committed. Neither
       * cancels the other, and an operator reaching for both in CI is reaching
       * for the spelling that looks safest.
       *
       * This branch used to `return` unconditionally, which put it AHEAD of the
       * `--check` block: `--check --dry-run --out=DIR` printed the dump and
       * exited 0 on a tree the very same invocation without `--dry-run` failed
       * on with `Translation bundles have drifted from the schema`. That is the
       * dangerous direction of an ignored flag — not bad advice on a real
       * failure, but a green tick over a comparison that never ran, and a check
       * that cannot fail is indistinguishable from a check that finds nothing.
       *
       * ⛔ So the return is conditional on `--check` being OFF, and exiting 0
       * without comparing must not come back. When `--check` is on, execution
       * falls through to the comparison below; the write loop past it is still
       * unreachable, because `--check` either returns in sync or exits 1.
       */
      if (flags['dry-run'] || !flags.out) {
        for (const locale of localesEmitted) {
          for (const mod of emittedModules(locale)) {
            console.log(chalk.dim(`── ${locale} (${mod.label}) ──`));
            console.log(renderTranslationModule(result.bundles[locale], { locale, kind: mod.kind }));
          }
        }
        if (!flags.check) {
          // The advice is for the run that HAS no `--out`. Printed
          // unconditionally, it told an operator who had just passed `--out` to
          // pass `--out`, which reads as "your directory was ignored" — and it
          // was not (#16480). With one, name it: that is the same reading in the
          // direction that is true.
          printInfo(
            outDir
              ? `Dry run — no files written to ${chalk.white(displayPath(outDir))}.`
              : 'Dry run — no files written (pass --out=<dir> to write).',
          );
          return;
        }
      }

      // `flags.out` is non-empty here. Of the branches above, the `--json` one
      // and the `--dry-run` one return; the `--dry-run` one falls through only
      // under `--check`, and `--check` without `--out` already threw.
      const resolvedOutDir = outDir as string;

      // Every file a normal run would emit, paired with its rendered content —
      // {@link emittedFiles}, the same list the machine face compares.
      const emitted = emittedFiles(resolvedOutDir);

      if (flags.check) {
        const { missing, stale } = compareCommitted(emitted);
        if (missing.length === 0 && stale.length === 0) {
          console.log('');
          printSuccess(`${emitted.length} bundle(s) are in sync with the schema ${chalk.dim(`(${timer.display()})`)}`);
          return;
        }
        for (const shown of missing) printError(`missing:    ${shown}`);
        for (const shown of stale) printError(`out of date: ${shown}`);
        console.log('');
        // The command that regenerates these bytes is THIS run without
        // `--check` — the two faces share the `emittedFiles` list above, so the
        // write path cannot produce anything other than what was just
        // compared. {@link driftMessage} is the sentence, built once so the
        // `--json` face ends on the same words.
        printError(driftMessage());
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
