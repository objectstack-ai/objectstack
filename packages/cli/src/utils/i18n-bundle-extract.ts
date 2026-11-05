// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * I18n Extractor
 *
 * Produces ready-to-edit `TranslationData` skeletons for every requested
 * locale from a normalized stack config, pre-populated with the source labels
 * from the schema for the default locale, and serializes them as the committed
 * `*.generated.ts` modules `os i18n extract` writes.
 *
 * What is translatable at all is not decided here: the walk,
 * `collectExpectedEntries`, lives in `@objectstack/lint`
 * (`packages/lint/src/i18n-walk.ts`), so the CLI, the coverage gate and the
 * Studio translation editor in a browser all read one walk. Its public names
 * are re-exported below, so the CLI keeps one import path for both halves.
 */

import type { TranslationBundle, TranslationData } from '@objectstack/spec/system';
import { collectExpectedEntries, type ExpectedEntry, type ExpectedEntryOptions } from '@objectstack/lint';
import { collectFilledFromHashes } from '@objectstack/platform-objects/apps';

export { authorWarnedTranslationGroups, collectExpectedEntries, humanizeFieldPath } from '@objectstack/lint';
export type { ExpectedEntry, ExpectedEntryOptions } from '@objectstack/lint';

// ─── Public types ──────────────────────────────────────────────────────

export type FillStrategy = 'empty' | 'default' | 'todo';

export interface ExtractOptions extends ExpectedEntryOptions {
  /** Default locale (filled with source values). Defaults to `'en'`. */
  defaultLocale?: string;
  /** Locales to emit. Defaults to `[defaultLocale]`. */
  locales?: string[];
  /**
   * How to populate values for non-default locales:
   *  - `'empty'`  → empty string (default)
   *  - `'default'` → copy source value verbatim
   *  - `'todo'`   → source value with a `[TODO] ` prefix
   */
  fill?: FillStrategy;
  /**
   * Regex filter applied against `objectName` / `appName` / `dashboard` / view
   * / action identifiers. When provided, only matching entries are emitted.
   */
  filter?: RegExp;
  /**
   * When true, entries that already exist in any of the stack's
   * `translations` bundles for a given locale are *omitted* for that locale.
   * This makes extract idempotent — re-running only fills the gaps.
   */
  mergeExisting?: boolean;
  /**
   * The `<locale>.source-hashes.generated.ts` tables already committed beside
   * the bundles, keyed by locale.
   *
   * This is the mechanism's ONLY memory (commit 09b4f4e4e, ruling #12069 Option A): a leaf that
   * is a byte copy of a source revision keeps its record across runs, which is
   * what makes the drift detectable after the source moves. Passing nothing
   * makes the run behave like a first extract — every record is re-derived from
   * the tree, so leaves that already drifted stay legacy-trusted rather than
   * being reported.
   */
  previousSourceHashes?: Record<string, Record<string, string>>;
}

export interface ExtractResult {
  /** Locale → TranslationData skeleton (only the entries we emitted). */
  bundles: Record<string, TranslationData>;
  /**
   * Locale → the number of leaves in `bundles[locale]`: the whole skeleton
   * built for that locale, every section of it.
   *
   * ⛔ NOT the number of keys any one emitted FILE holds. Which sections of the
   * skeleton become committed modules is the caller's decision — `os i18n
   * extract` makes it from `--objects-only` and `--metadata-forms` — so under
   * the default `--objects-only` this number is far larger than the module the
   * command writes: the registry-driven `metadataForms` baseline alone is ~773
   * keys against a one-object stack's 2 (#16121). A caller reporting a count
   * for a file takes it off that file's own payload
   * ({@link translationModulePayload}), never off this field.
   *
   * Counted off the built tree, never off the walk that built it. The walk
   * counter this replaces could not disagree with anything: it incremented once
   * per entry, unconditionally, so it equalled {@link ExtractResult.totalExpected}
   * for every locale on every config and no observation could have shown it
   * wrong. A leaf count of the bundle CAN fail — it moves the moment `setDeep`
   * collapses two entries onto one path.
   */
  counts: Record<string, number>;
  /** Total expected entries before per-locale merge filtering. */
  totalExpected: number;
  /**
   * Per translated locale, the digest of the source revision each GENERATED
   * leaf is still a byte copy of — the content of
   * `<locale>.source-hashes.generated.ts`.
   *
   * Computed by `collectFilledFromHashes` in
   * `@objectstack/platform-objects/apps`, the module maintainer ruling #8765
   * Option B put the mechanism in; the extractor supplies the tree, the
   * previous records and THE SECTIONS THIS RUN BUILT, and owns none of the
   * rule. The default locale gets no entry: it is the source, not a copy of
   * one.
   *
   * Covers every section the run generated, not just the two a default
   * `--objects-only` run happens to emit (#16872). A `--no-objects-only` run
   * fills `apps` / `dashboards` / `pages` from the source too, and before this
   * those leaves were recorded by nobody and judged by nobody.
   */
  sourceHashes: Record<string, Record<string, string>>;
}

// ─── Filter + bundle assembly ──────────────────────────────────────────

function passesFilter(entry: ExpectedEntry, filter?: RegExp): boolean {
  if (!filter) return true;
  if (entry.objectName && filter.test(entry.objectName)) return true;
  if (entry.appName && filter.test(entry.appName)) return true;
  if (entry.metadataType && filter.test(entry.metadataType)) return true;
  if (entry.flowName && filter.test(entry.flowName)) return true;
  // Allow matching against the joined path so users can target e.g. ^dashboards\.system_
  return filter.test(entry.path.join('.'));
}

function setDeep(data: TranslationData, path: string[], value: string): void {
  let cur: any = data;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    if (typeof cur[seg] !== 'object' || cur[seg] === null) cur[seg] = {};
    cur = cur[seg];
  }
  cur[path[path.length - 1]] = value;
}

function lookupDeep(data: TranslationData | undefined, path: string[]): string | undefined {
  let cur: any = data;
  for (const seg of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = cur[seg];
  }
  return typeof cur === 'string' && cur.length > 0 ? cur : undefined;
}

function mergeBundles(bundles: TranslationBundle[]): Record<string, TranslationData> {
  const out: Record<string, TranslationData> = {};
  for (const bundle of bundles) {
    if (!bundle || typeof bundle !== 'object') continue;
    for (const [locale, data] of Object.entries(bundle)) {
      if (!data || typeof data !== 'object') continue;
      out[locale] = deepMerge(out[locale] ?? {}, data as TranslationData);
    }
  }
  return out;
}

function deepMerge<T extends Record<string, any>>(target: T, source: T): T {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      target[k as keyof T] = deepMerge(((target as any)[k] ?? {}) as any, v as any);
    } else {
      (target as any)[k] = v;
    }
  }
  return target;
}

/**
 * Build per-locale skeleton bundles from a normalized stack config.
 */
export function extractTranslations(config: any, opts: ExtractOptions = {}): ExtractResult {
  const defaultLocale = opts.defaultLocale ?? 'en';
  const locales = opts.locales && opts.locales.length > 0
    ? Array.from(new Set([defaultLocale, ...opts.locales]))
    : [defaultLocale];
  const fill: FillStrategy = opts.fill ?? 'empty';

  // Seed-less entries exist only so the coverage gate can spot a bundle that
  // authors a key the metadata never writes inline — there is nothing to
  // scaffold from, so they never reach a generated skeleton.
  // `warnedGroups` rides through: a group the ledger warns authors for
  // authoring must not be scaffolded either. Scaffolding it would hand the
  // author a skeleton whose every filled-in key draws a warning — the same
  // collision the coverage gate has, arriving by a different door (#11624).
  const allEntries = collectExpectedEntries(config, { warnedGroups: opts.warnedGroups })
    .filter((e) => e.sourceValue !== undefined);
  const entries = allEntries.filter((e) => passesFilter(e, opts.filter));

  const existingBundles: TranslationBundle[] = Array.isArray(config?.translations) ? config.translations : [];
  const existing = mergeBundles(existingBundles);

  const bundles: Record<string, TranslationData> = {};
  const counts: Record<string, number> = {};

  for (const locale of locales) {
    const data: TranslationData = {};
    for (const entry of entries) {
      // Guaranteed by the seed-less filter above; narrows for the branches below.
      const seed = entry.sourceValue ?? '';
      let value: string | undefined;
      // If a translation already exists for this locale, carry it through
      // verbatim so the generated file remains a complete, self-contained
      // bundle (not just the missing-key delta). Set --no-merge to skip
      // baselines entirely.
      //
      // The default locale is deliberately NOT merged (#8543): it is a copy of
      // the source, not a translation, so "never overwrite an existing entry"
      // protects the wrong thing there — an author edits a field description,
      // the regeneration keeps the stale entry, and the served text drifts from
      // the source silently while the drift gate reports OK (measured at 53
      // stale entries across 6 packages when this branch ran for every locale).
      // The seed IS the source text for the default locale (line below), so it
      // always wins; translated locales keep merge semantics exactly as before.
      if (opts.mergeExisting !== false && locale !== defaultLocale) {
        const existingValue = lookupDeep(existing[locale], entry.path);
        if (existingValue !== undefined && existingValue !== '') {
          value = String(existingValue);
        }
      }
      if (value === undefined) {
        if (locale === defaultLocale) {
          value = seed;
        } else if (fill === 'default') {
          value = seed;
        } else if (fill === 'todo') {
          value = `[TODO] ${seed}`;
        } else {
          value = '';
        }
      }
      setDeep(data, entry.path, value);
    }
    bundles[locale] = data;
    // Off the tree that was just built, never off the walk that built it — see
    // {@link ExtractResult.counts} (#16121).
    counts[locale] = countTranslationLeaves(data);
  }

  const sourceHashes: Record<string, Record<string, string>> = {};
  const sourceBundle = bundles[defaultLocale];
  /**
   * The population the provenance rule walks is THIS RUN'S — the sections it
   * actually built — not `GENERATED_SECTIONS`, the default a caller that does
   * not know inherits (#16872).
   *
   * Every leaf in `bundles[locale]` got there through this extractor, which is
   * the discriminator the rule is written against: `--fill=default` copies it
   * from the source. Under the default `--objects-only` the sections built are
   * `objects` and `metadataForms`, so this is byte-identical to the previous
   * behaviour; under `--no-objects-only` it is the difference between a filled
   * `apps` leaf having provenance and having none.
   *
   * Read off the BUILT tree rather than off the config, for the reason #16121
   * records about counts: a number or a name derived independently of the bytes
   * it describes is a number nothing can check. WHICH of these sections becomes
   * a committed bundle stays a separate, later decision that
   * `narrowToCommittedSections` already derives from the emitted module list —
   * this layer supplies the tree and owns none of the rule.
   */
  for (const locale of locales) {
    if (locale === defaultLocale) continue;
    sourceHashes[locale] = collectFilledFromHashes(
      bundles[locale],
      sourceBundle,
      opts.previousSourceHashes?.[locale],
      Object.keys(bundles[locale] ?? {}),
    );
  }

  return { bundles, counts, totalExpected: entries.length, sourceHashes };
}

// ─── Serialization ─────────────────────────────────────────────────────

/**
 * One locale's translations MINUS the registry-driven `metadataForms`
 * baseline — everything the stack itself authors (#14894).
 *
 * The baseline is not part of any stack's authored surface: it is derived from
 * the platform's metadata-form registry, is identical for every stack, and has
 * its own module (`<locale>.metadata-forms.generated.ts`) under its own flag
 * (`--metadata-forms`). Folding it into the module beside them gave it a SECOND
 * home, and the two homes then disagreed about who governed it — see
 * {@link renderTranslationModule}.
 */
export function stackAuthoredSubtree(data: TranslationData): Omit<TranslationData, 'metadataForms'> {
  const { metadataForms: _registryBaseline, ...authored } = data;
  return authored;
}

/** Sub-tree selector shared by {@link renderTranslationModule} and its callers. */
export type TranslationModuleKind = 'objects' | 'metadataForms' | 'stack';

/**
 * The sub-tree a module of the given {@link TranslationModuleKind} holds — the
 * ONE place that decides what each emitted module contains.
 *
 * Exported so that a count reported for a module is taken off the SAME tree the
 * module is rendered from. #16121 was the other arrangement: the command
 * reported a number derived independently of the bytes it wrote, so nothing
 * could compare the two and the printed count was wrong by two orders of
 * magnitude with every gate green. A caller now counts
 * `countTranslationLeaves(translationModulePayload(data, kind))` and renders
 * `renderTranslationModule(data, { kind })` — one selector, so the number and
 * the bytes agree by construction, for a `kind` added later as much as for
 * these three.
 */
export function translationModulePayload(
  data: TranslationData,
  kind: TranslationModuleKind,
):
  | NonNullable<TranslationData['objects']>
  | NonNullable<TranslationData['metadataForms']>
  | Omit<TranslationData, 'metadataForms'> {
  return kind === 'metadataForms'
    ? (data.metadataForms ?? {})
    : kind === 'objects'
      ? (data.objects ?? {})
      : stackAuthoredSubtree(data);
}

/**
 * The `TranslationData` SECTIONS a module of the given kind COVERS — the first
 * dotted segment its leaves carry, which is the identity
 * {@link narrowToCommittedSections} narrows a provenance table by.
 *
 * Beside {@link translationModulePayload} and switched on the same `kind`, so
 * "what a module holds" and "which sections it commits" are ONE decision. The
 * caller was two literals — `committed.push('objects')` and
 * `committed.push('metadataForms')`, chosen by which modules were emitted — and
 * a literal cannot follow the payload: under `kind: 'stack'` the module holds
 * every group the stack authors (`objects`, `apps`, `dashboards`, ...) while the
 * caller named exactly one of them. Replacing that list with a longer list of
 * literals only moves the day it goes wrong to the next group added.
 *
 * ⚠️ The sections are NOT simply the payload's own top-level keys, and reading
 * them off it would be WRONG for two of the three kinds. `'objects'` and
 * `'metadataForms'` select the sub-tree ROOTED AT one section, so those keys are
 * object and form names (`kpi_metric`) — deriving the section list from them
 * would commit `['kpi_metric']` and narrow away every `objects.*` record, which
 * is the one path this repository's single `--source-hashes` config is on.
 * `'stack'` selects a `TranslationData`-shaped subtree, so THERE the top-level
 * keys are sections — every group the stack authors, today's and any added
 * later, with nothing here to update.
 *
 * The switch is exhaustive on purpose: a fourth kind that selects one section
 * needs no edit (`[kind]` already names it), and a fourth AGGREGATE kind fails
 * to compile here rather than silently committing its own name as a section.
 */
export function translationModuleSections(
  data: TranslationData,
  kind: TranslationModuleKind,
): string[] {
  switch (kind) {
    case 'stack':
      return Object.keys(stackAuthoredSubtree(data));
    case 'objects':
    case 'metadataForms':
      // The selector's own name IS the section it roots at.
      return [kind];
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/**
 * String leaves under a nested translation tree.
 *
 * The structural measure every key count in this mechanism is taken with — the
 * extractor's per-locale {@link ExtractResult.counts}, and each number
 * `os i18n extract` prints beside a module. One implementation so that two
 * counts of the same tree can never be two different numbers.
 */
export function countTranslationLeaves(node: unknown): number {
  if (!node || typeof node !== 'object') return 0;
  let n = 0;
  for (const value of Object.values(node as Record<string, unknown>)) {
    if (typeof value === 'string') n += 1;
    else if (value && typeof value === 'object') n += countTranslationLeaves(value);
  }
  return n;
}

/**
 * Render a TranslationData skeleton as a TypeScript module body.
 *
 * The module exports a single named const (`<exportName>`) typed against
 * the chosen sub-tree of `TranslationData`:
 *
 *   kind: 'objects'        → `NonNullable<TranslationData['objects']>`
 *   kind: 'metadataForms'  → `NonNullable<TranslationData['metadataForms']>`
 *   kind: 'stack'          → `Omit<TranslationData, 'metadataForms'>`
 *
 * ⚠️ The three are NOT three disjoint cells, and calling them a partition was
 * imprecise enough to correct: `'objects'` is a SUB-SELECTION of `'stack'`, not
 * a sibling of it. The invariant that actually holds — and the one this
 * function exists to keep — is about a PAIR: whichever of `'objects'` /
 * `'stack'` a run picks for the module it writes, that module and the
 * `'metadataForms'` companion beside it are disjoint, and under `'stack'` the
 * two together are the whole of what the extractor built. Measured on the
 * fixture below: 3 + 773 = 776, which is the extractor's own count for that
 * run — none dropped, none duplicated.
 *
 * `'stack'` was called `'full'` and rendered the whole `TranslationData`, which
 * broke exactly that pairing — `metadataForms` landed in the stack module AND
 * in its own companion.
 *
 * That is the #14894 defect, and it had two user-visible halves. Both were
 * driven on a `defaultLocale: 'zh-CN'` stack (one object, one app) before this
 * function changed:
 *
 *   • `--no-metadata-forms` stopped suppressing the baseline the moment
 *     `--no-objects-only` was passed. The flag gated only the companion, while
 *     `'full'` inlined the same keys next door: `zh-CN.objects.generated.ts`
 *     came out holding 773 metadata-form leaves under an explicit
 *     `--no-metadata-forms`, against 2 object leaves and 1 app leaf. Those 773
 *     were ENGLISH — the default locale is filled from the source labels, and
 *     the registry authors them in English — so a non-English default locale
 *     shipped the platform's English Studio baseline inside its own bundle.
 *   • With `--metadata-forms` left ON, the same run emitted those 773 keys
 *     TWICE, once in each module.
 *
 * `--objects-only` and `--metadata-forms` are documented as independent, and
 * they are: the first picks the stack module's sub-tree (`objects` alone, or
 * everything the stack authors), the second decides whether the baseline is
 * emitted at all. Neither has to win over the other, and this change invents no
 * precedence between them — the overlap was in the emitter, never in the two
 * meanings.
 *
 * `objectsOnly: true` (default) is a legacy alias for `kind: 'objects'`, and
 * `objectsOnly: false` for `kind: 'stack'`.
 */
export function renderTranslationModule(
  data: TranslationData,
  options: {
    locale: string;
    exportName?: string;
    /** Legacy: when true, emit only the `objects` sub-tree (typed accordingly). */
    objectsOnly?: boolean;
    /** Explicit sub-tree selector. Overrides `objectsOnly` when provided. */
    kind?: 'objects' | 'metadataForms' | 'stack';
    /** Header comment lines. */
    header?: string[];
  },
): string {
  const kind: TranslationModuleKind =
    options.kind ?? (options.objectsOnly === false ? 'stack' : 'objects');
  const defaultExport =
    kind === 'metadataForms'
      ? `${camelize(options.locale)}MetadataForms`
      : kind === 'stack'
      ? `${camelize(options.locale)}Translations`
      : `${camelize(options.locale)}Objects`;
  const exportName = options.exportName ?? defaultExport;
  const payload = translationModulePayload(data, kind);
  const typeSig =
    kind === 'metadataForms'
      ? "NonNullable<TranslationData['metadataForms']>"
      : kind === 'objects'
      ? "NonNullable<TranslationData['objects']>"
      : "Omit<TranslationData, 'metadataForms'>";
  const header = options.header ?? [
    `Auto-generated by 'os i18n extract' for locale '${options.locale}'.`,
    'Edit translations in place; re-run extract (with --merge) to fill new gaps.',
    'Do not hand-edit the structure — only the leaf string values.',
    'Merge only fills gaps: correcting a source label/description does not',
    'push the correction into a leaf here that already holds a translation —',
    'a present-but-stale string is not a gap, so it is left as-is. Re-translate',
    'it by hand when its source changes; nothing here or in `os i18n check`',
    'tells a leaf a translator updated on purpose from one nobody has looked',
    'at since the source moved.',
  ];

  const lines: string[] = [];
  lines.push('// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.');
  lines.push('');
  lines.push('/**');
  for (const h of header) lines.push(` * ${h}`);
  lines.push(' */');
  lines.push('');
  lines.push("import type { TranslationData } from '@objectstack/spec/system';");
  lines.push('');
  lines.push(`export const ${exportName}: ${typeSig} = ${stringifyTs(payload, 0)};`);
  lines.push('');
  return lines.join('\n');
}

/**
 * Render one locale's generated source-hash table as a TypeScript module body —
 * the `<locale>.source-hashes.generated.ts` companion.
 *
 * Deliberately types the export STRUCTURALLY (`Readonly<Record<string,
 * string>>`) instead of importing `SourceHashes`. The companion is written into
 * whichever package owns the bundles, and only one of those packages can spell
 * the type with a relative import; an import path guessed per package is a
 * portability bug waiting for the second package to use this. The structural
 * type is what `SourceHashes` is defined as, so nothing is lost.
 *
 * Keys are emitted sorted, and every key is quoted (they are dotted paths, so
 * `formatKey` would quote them anyway). Both are load-bearing for `--check`:
 * the comparison is byte-for-byte, so a table that reordered with the walk
 * would fail on a tree that is in fact in sync.
 */
export function renderSourceHashModule(
  hashes: Record<string, string>,
  options: { locale: string; exportName?: string },
): string {
  const exportName = options.exportName ?? `${camelize(options.locale)}GeneratedSourceHashes`;
  const keys = Object.keys(hashes).sort();
  const lines: string[] = [];
  lines.push('// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.');
  lines.push('');
  lines.push('/**');
  lines.push(` * Auto-generated by 'os i18n extract' for locale '${options.locale}'. Do not hand-edit.`);
  lines.push(' *');
  lines.push(" * Each entry is the digest of the SOURCE REVISION that this locale's leaf at");
  lines.push(' * that path is still a byte copy of — provenance for the generated half of the');
  lines.push(' * bundles (commit 09b4f4e4e): a leaf whose digest no longer matches its source is stale and serves the source text instead.');
  lines.push(' *');
  lines.push(' * An entry exists only while the leaf IS such a copy. Re-translate the leaf in');
  lines.push(' * `<locale>.objects.generated.ts` and the next extract drops its entry by');
  lines.push(' * itself — the table makes no claim about text a translator wrote. A path with');
  lines.push(' * no entry is LEGACY-TRUSTED and never reported stale.');
  lines.push(' *');
  lines.push(' * ⚠️ Do not "fix" a staleness report by editing this file. Refreshing a digest');
  lines.push(' * records that the current text was copied from the current source, which is');
  lines.push(' * the false claim the mechanism exists to detect. Fix the TRANSLATION.');
  lines.push(' */');
  lines.push('');
  lines.push(`export const ${exportName}: Readonly<Record<string, string>> = {`);
  for (const key of keys) lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(hashes[key])},`);
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

/**
 * Narrow a provenance table to the generated sections a run actually COMMITS
 * (#12559).
 *
 * {@link extractTranslations} computes the table over every generated section it
 * built — `objects` and `metadataForms` both — because the rule that fills it
 * (`collectFilledFromHashes`) is a statement about generated leaves, not about
 * files. Which of those sections becomes a committed bundle is the command
 * layer's decision, and the two must agree: a record describes the leaf sitting
 * in a bundle beside it, so a record for a section this package does not commit
 * describes nothing that exists there.
 *
 * The mismatch is measured, not hypothetical. A package that owns only its own
 * objects passes `--no-metadata-forms`, and the emitter's own note says why:
 * "without it, `--check` demands a baseline copy the package deliberately does
 * not commit". Its `metadataForms` subtree is built anyway, and — having no
 * entry in that package's merge baseline — arrives as a fresh `--fill=default`
 * copy of `en`, so EVERY leaf of it satisfies `value === currentSource` and is
 * recorded. Measured on `@objectstack/plugin-audit` while rolling the companion
 * out in #12559: 763 records, of which **2** were its own objects and 761 were
 * digests of the Studio metadata-form baseline `@objectstack/platform-objects`
 * owns — unreadable in that package (no `metadataForms` bundle exists there for
 * them to be about) and re-written in all three of its companions every time an
 * unrelated `*.form.ts` in `packages/spec` moved. That is the cross-package
 * coupling ADR-0029 D8 and each package's `bundle-ownership.test.ts` keep out of
 * the committed bundles; the companion is not exempt from it.
 *
 * A section is named by a leaf path's FIRST dotted segment — the same identity
 * `collectGeneratedLeaves` seeds its walk with, so the two cannot disagree about
 * what section a path belongs to. Callers pass the sections they are committing;
 * this function invents none, so a set that commits both (`platform-objects` is
 * the one today) keeps every record it had.
 */
export function narrowToCommittedSections(
  hashes: Record<string, string>,
  committedSections: Iterable<string>,
): Record<string, string> {
  const committed = new Set(committedSections);
  return Object.fromEntries(
    Object.entries(hashes).filter(([leafPath]) => committed.has(leafPath.split('.', 1)[0])),
  );
}

/**
 * Read a committed `<locale>.source-hashes.generated.ts` back into a table.
 *
 * The module body is written by {@link renderSourceHashModule}, which quotes
 * every key and every value, so the object literal is already valid JSON — the
 * parse needs no TypeScript and no evaluation. A file that does not parse is a
 * hard `undefined` (treated as "no previous records", i.e. everything
 * legacy-trusted) rather than a guess: inventing records from a file we cannot
 * read is how a mechanism starts asserting provenance it does not have.
 */
export function parseSourceHashModule(source: string): Record<string, string> | undefined {
  const marker = source.indexOf('export const');
  const open = marker < 0 ? -1 : source.indexOf('= {', marker);
  if (open < 0) return undefined;
  const literal = source.slice(open + 2).replace(/;\s*$/, '');
  try {
    const parsed = JSON.parse(literal.replace(/,(\s*})/g, '$1'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    for (const value of Object.values(parsed)) if (typeof value !== 'string') return undefined;
    return parsed as Record<string, string>;
  } catch {
    return undefined;
  }
}

function camelize(locale: string): string {
  // 'zh-CN' → 'zhCN', 'ja-JP' → 'jaJP', 'es-ES' → 'esES'
  return locale.replace(/-(.)/g, (_m, c) => c.toUpperCase());
}

function stringifyTs(value: unknown, indent: number): string {
  const pad = '  '.repeat(indent);
  const pad2 = '  '.repeat(indent + 1);
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return '[\n' + value.map((v) => pad2 + stringifyTs(v, indent + 1)).join(',\n') + `\n${pad}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return '{\n' + entries.map(([k, v]) => `${pad2}${formatKey(k)}: ${stringifyTs(v, indent + 1)}`).join(',\n') + `\n${pad}}`;
  }
  return JSON.stringify(value);
}

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
function formatKey(key: string): string {
  return IDENT_RE.test(key) ? key : JSON.stringify(key);
}
