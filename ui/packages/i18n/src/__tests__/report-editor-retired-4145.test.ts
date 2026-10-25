// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `report.editor.*` is retired down to ONE key, and must stay that way
 * (objectui#4145).
 *
 * ## What was removed and why
 *
 * The namespace held 106 keys in each of the ten packs — ~1060 translated
 * strings — labelling the hand-rolled report editor form: field labels, chart
 * type options, filter operators, validation messages, a field picker. That
 * form no longer exists. `ReportConfigPanel`'s body is `ReportDefaultInspector`,
 * a spec-driven inspector whose labels come from the report spec's own metadata
 * rather than from this namespace.
 *
 * Until objectui#4137 the namespace had exactly ONE live reader, and it was a
 * defect: the panel borrowed `report.editor.title` — the label of the report's
 * Title *field* — to name itself, so the panel was headed "Title" and its
 * `role="complementary"` landmark announced "Title" (objectui#4118). Moving that
 * slot onto a purpose-built `report.editor.panelTitle` fixed the defect and left
 * the other 105 keys with no reader anywhere: no `t()` call site, no dynamic
 * `t(`report.editor.${…}`)` form, no JSON or MDX reference. They were retired.
 *
 * ## Why this pin is NEGATIVE, and why it is needed at all
 *
 * Every i18n gate in this repo runs **call site → key**, never key → call site:
 *
 *   - `scripts/check-i18n-call-site-keys.mjs` asks whether each call site's key
 *     resolves in `en`. A key with no call site is never visited.
 *   - `all-locales-key-parity.test.ts` compares the ten packs' key SETS to each
 *     other. 105 dead keys present in all ten packs is exactly what it wants.
 *   - `scripts/check-i18n-en-drift.mjs` only fires when an `en` value CHANGES.
 *     These values were static.
 *
 * So the packs can accumulate dead namespaces indefinitely with every gate
 * green — that is how this one survived, and it is why the guard has to be
 * written down by name rather than derived. Restoring any retired key to any
 * pack must go red here.
 *
 * Reverse-verified: reviving a single retired key in a single pack turns TWO
 * independent gates red — this pin (naming the pack and the key) and
 * `all-locales-key-parity`'s "en defines every key the other packs define".
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { builtInLocales } from '../locales/index';

/**
 * The repo root, derived from THIS FILE's own location — never from
 * `process.cwd()` (objectui#7799).
 *
 * It was `process.cwd()` until then, on the reasoning that
 * `scripts/vitest-invocation-guard.mjs` refuses any invocation whose vitest root
 * is not the repo root. That guard is real, but it is a DIFFERENT invariant:
 * `--root` moves VITEST's root and moves nothing about `process.cwd()`. This
 * package's own `test` script — `vitest run --root ../.. packages/i18n/`, which
 * is what `pnpm --filter … test` and `turbo run test` both run — leaves cwd at
 * `packages/i18n/`, so every read below resolved against the package directory
 * and the assertions guarding them failed.
 *
 * Spelled in string operations, copying the landed precedent of objectui#7791
 * (PR #7796): `new URL(rel, import.meta.url)` is REWRITTEN by Vite into a
 * `http://localhost:3000/@fs/…` dev-server URL, so only bare `import.meta.url`
 * is read here and taken apart by hand. Measured on this card under both cwds
 * and in both the `unit` and the `dom` project, it is
 * `file:///…/packages/i18n/src/__tests__/<this file>`.
 */
const SELF_DEPTH_BELOW_REPO_ROOT = 5; // packages / i18n / src / __tests__ / this file
const REPO_ROOT = decodeURIComponent(new URL(import.meta.url).pathname)
  .split('/')
  .slice(0, -SELF_DEPTH_BELOW_REPO_ROOT)
  .join('/');


// Derived from the map rather than left as `string[]`: `Object.keys` erases
// which keys it enumerated, so `builtInLocales[lang]` below would be an
// implicit-`any` index into a `const` map (TS7053) and the suite would compare
// packs the compiler never confirmed exist. Same convention as
// `authRemediation-locale-parity.test.ts` next door.
type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

const at = (pack: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], pack);

/** The one key that survives — minted by objectui#4137, names the panel. */
const SURVIVOR = 'panelTitle';

/**
 * The 105 retired keys, listed BY NAME in the packs' own order rather than
 * counted. A count passes when one key returns and another leaves; the names do
 * not. For the retirement commit `check:i18n-drift` reported "0 en value(s)
 * changed (0 key(s) added, 105 removed)" — it counts the `en` KEY SET, so 105 is
 * the number there while the tree change is 1050 pack/key pairs (105 × 10).
 */
const RETIRED_REPORT_EDITOR_KEYS = [
  'breadcrumb',
  'basic',
  'title',
  'titlePlaceholder',
  'description',
  'descriptionPlaceholder',
  'type',
  'typeTabular',
  'typeSummary',
  'typeMatrix',
  'typeJoined',
  'typeHelp',
  'data',
  'objectName',
  'objectNamePlaceholder',
  'objectNameHelp',
  'limit',
  'limitPlaceholder',
  'columns',
  'columnsHint',
  'filters',
  'filtersHint',
  'filtersComplex',
  'groupBy',
  'groupByHint',
  'rows',
  'rowsHint',
  'columnsAxis',
  'columnsAxisHint',
  'values',
  'valuesHint',
  'grouping',
  'addGrouping',
  'dateGranularity',
  'dateGranularityNone',
  'day',
  'week',
  'month',
  'quarter',
  'year',
  'sortAsc',
  'sortDesc',
  'chart',
  'chartHint',
  'chartType',
  'chartTitle',
  'chartTitlePlaceholder',
  'chartXAxis',
  'chartYAxis',
  'chartShowLegend',
  'chartShowDataLabels',
  'chartNone',
  'chartBar',
  'chartLine',
  'chartArea',
  'chartPie',
  'chartDonut',
  'chartFunnel',
  'validationNeedsObject',
  'validationMatrixNeedsRowsCols',
  'validationSummaryNeedsRows',
  'blocks',
  'blocksHint',
  'addBlock',
  'removeBlock',
  'blockName',
  'blockNamePlaceholder',
  'blockLabel',
  'blockLabelPlaceholder',
  'blockDescription',
  'blockDescriptionPlaceholder',
  'validationJoinedNeedsBlocks',
  'validationBlockNameRequired',
  'validationBlockNameDuplicate',
  'validationBlockNeedsColumns',
  'noneOption',
  'addCondition',
  'combineLogic',
  'opContains',
  'opIsEmpty',
  'opIsNotEmpty',
  'formatAuto',
  'formatCurrency',
  'formatPercent',
  'formatInteger',
  'formatDate',
  'formatDatetime',
  'columnLabelPlaceholder',
  'aggregateColumn',
  'formatColumn',
  'addColumns',
  'searchFields',
  'noMatchingFields',
  'noFieldsAvailable',
  'columnsCount',
  'columnsEmpty',
  'fieldPickerTitle',
  'fieldPickerDescription',
  'fieldPickerChangeTitle',
  'fieldPickerAddGroupingTitle',
  'fieldPickerEmpty',
  'fieldPickerSelected',
  'fieldPickerClear',
  'fieldPickerAdd',
  'fieldPickerAddN',
] as const;

describe('`report.editor.*` is retired to one key (objectui#4145)', () => {
  it('the retired list is the measured set, and excludes the survivor', () => {
    // Guards the premise the rest of the file rests on. 106 keys existed; one
    // survives; 105 were retired. If this arithmetic ever stops holding, the
    // assertions below are checking a set nobody chose.
    expect(RETIRED_REPORT_EDITOR_KEYS).toHaveLength(105);
    expect(new Set(RETIRED_REPORT_EDITOR_KEYS).size).toBe(105);
    expect(RETIRED_REPORT_EDITOR_KEYS).not.toContain(SURVIVOR);
    expect(RETIRED_REPORT_EDITOR_KEYS.length + 1).toBe(106);
    expect(LANGS).toHaveLength(10);
  });

  it('no pack defines any retired key, in any of the ten packs', () => {
    const revived: string[] = [];
    for (const lang of LANGS) {
      for (const key of RETIRED_REPORT_EDITOR_KEYS) {
        if (at(builtInLocales[lang], `report.editor.${key}`) !== undefined) {
          revived.push(`${lang} :: report.editor.${key}`);
        }
      }
    }
    // Named, not counted: the failure message has to say WHICH pack and WHICH
    // key, because the repair for a half-reverted namespace differs per key.
    expect(revived).toEqual([]);
  });

  it('the namespace root survives holding exactly the one live key', () => {
    // Deliberately NOT "the root is gone" — this differs from objectui#3811's
    // retirement, where the whole namespace went. Here `report.editor` must
    // still exist because `panelTitle` lives in it and `ReportConfigPanel` reads
    // it. So the shape to pin is the exact key set: a root that grows a second
    // key is the regression, and a root that vanishes takes the live panel name
    // with it.
    for (const lang of LANGS) {
      const editor = at(builtInLocales[lang], 'report.editor');
      expect(editor, `${lang} lost the report.editor root`).toBeDefined();
      expect(Object.keys(editor as Record<string, unknown>), lang).toEqual([SURVIVOR]);
    }
  });

  it('the surviving key is a real translation in all ten packs, not English by fallback', () => {
    // The deletion swept AROUND this key; this is the assertion that it was not
    // swept up with its 105 neighbours in any single pack.
    for (const lang of LANGS) {
      const value = at(builtInLocales[lang], 'report.editor.panelTitle');
      expect(typeof value, lang).toBe('string');
      expect((value as string).length, lang).toBeGreaterThan(0);
    }
    expect(at(builtInLocales.en, 'report.editor.panelTitle')).toBe('Edit report');
    // A sample across writing systems, so "all ten packs kept the key" cannot be
    // satisfied by ten copies of the English string.
    expect(at(builtInLocales.zh, 'report.editor.panelTitle')).toBe('编辑报表');
    expect(at(builtInLocales.ru, 'report.editor.panelTitle')).toBe('Редактировать отчёт');
    expect(at(builtInLocales.ar, 'report.editor.panelTitle')).toBe('تعديل التقرير');
  });

  it('no consuming package asks `t()` for a retired key', () => {
    // Scoped to the trees that ever read this namespace: app-shell (the panel),
    // plugin-report (the nearest consumer surface — the report renderers), and
    // components (whose CHANGELOG records shipping these strings).
    //
    // Why pin the READER when `check:i18n-keys` already fails on a `t()` key no
    // pack defines: that gate reports it as "key missing from `en`", and the
    // obvious repair for a missing key is to backfill it — which is exactly the
    // move that rebuilds the dead namespace. This assertion is where the reason
    // lives, so the next author reads "this namespace is retired" instead of
    // "one pack is behind".
    const roots = [
      'packages/app-shell/src',
      'packages/plugin-report/src',
      'packages/components/src',
    ];
    const retired = new Set<string>(RETIRED_REPORT_EDITOR_KEYS);
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'dist') continue;
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        const src = readFileSync(full, 'utf8');

        // Call-SHAPED and key-SPECIFIC on purpose. Not a bare substring scan:
        // this file, `ReportConfigPanel.tsx` and its panelTitle test all NAME
        // retired keys in prose to explain why they are retired, and a naive
        // scan would score its own documentation as the offence. Key-specific
        // rather than namespace-wide because the live `t('report.editor.
        // panelTitle')` call sites are exactly what must keep working.
        //
        // Comments are NOT stripped before this runs, and that is the deliberate
        // trade: a comment stripper mishandling a `//` inside a string literal
        // drops real code from the scan, and a false negative is the one
        // direction a revival gate must not fail in. The cost is a prose
        // constraint, and it is a live one — the panelTitle test's header
        // originally quoted the defect as a spelled-out call and tripped this
        // assertion. Documentation names a key (`report.editor.title`); it does
        // not spell a call around it. See the failure message below.
        for (const m of src.matchAll(/\bt?t\(\s*['"`]report\.editor\.([A-Za-z0-9_]*)/g)) {
          if (retired.has(m[1])) offenders.push(`${full} :: report.editor.${m[1]}`);
        }
        // A dynamic read into a namespace that holds ONE key can only be
        // reaching for something that is not there.
        if (/\bt?t\(\s*`report\.editor\.\$\{/.test(src)) {
          offenders.push(`${full} :: dynamic t(\`report.editor.\${…}\`)`);
        }
      }
    };

    for (const root of roots) {
      const abs = join(REPO_ROOT, root);
      expect(existsSync(abs), `scan root missing: ${abs}`).toBe(true);
      walk(abs);
    }
    expect(
      offenders,
      'A retired `report.editor.*` key is being read again. If this is a real ' +
        'call site: the namespace is retired (objectui#4145) — the label you ' +
        'want comes from the report spec via ReportDefaultInspector, so do NOT ' +
        'backfill the key into the packs. If this is DOCUMENTATION, name the ' +
        'key on its own (`report.editor.title`) rather than spelling a t() ' +
        'call around it; comments are intentionally not stripped here.',
    ).toEqual([]);
  });

  it('the live call sites the survivor serves are still there', () => {
    // The mirror of the scan above: proving the retirement did not also silence
    // the panel. A green "no offenders" is worth nothing if the reader vanished.
    const panel = readFileSync(
      join(REPO_ROOT, 'packages/app-shell/src/views/ReportConfigPanel.tsx'),
      'utf8',
    );
    const live = [...panel.matchAll(/\bt\(\s*'report\.editor\.panelTitle'/g)];
    // Heading + `role="complementary"` aria-label; objectui#4118 is the defect
    // that made them one key rather than two.
    expect(live).toHaveLength(2);
  });
});
