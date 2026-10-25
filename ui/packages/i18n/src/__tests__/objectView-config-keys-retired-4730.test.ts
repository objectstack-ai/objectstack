// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `console.objectView.*` config-panel vocabulary is retired, and must stay
 * that way (objectui#4730, ruled 2026-08-19).
 *
 * ## What was removed and why
 *
 * The namespace held 209 keys in each of the ten packs. 116 of them labelled a
 * view-configuration settings panel that does not exist: appearance and density
 * toggles, accessibility attributes, conditional-formatting rules, row-action
 * and inline-edit switches, quick-filter builders, an advanced-settings tier.
 * They had no reader anywhere in the repo — no `t()` call site, no dynamic
 * template form reaching them, and no textual occurrence of the dotted key
 * outside the packs that define it.
 *
 * The plausible consumer confirms the story rather than contradicting it:
 * `packages/app-shell/src/views/ViewConfigPanel.tsx` was migrated off the legacy
 * `buildViewConfigSchema` engine onto `ViewVariantInspector`, a spec-driven
 * inspector whose field labels come from `@objectstack/spec` metadata (through
 * `useMetadataLocale`) rather than from this namespace. The panel these 116 keys
 * were written for was replaced; the keys were not cleaned up with it.
 *
 * ## The part that looks like a mistake and is not
 *
 * Four retired keys name `ListViewSchema` properties that are very much still
 * active — `rowActions`, `inlineEdit`, `hiddenFields`, `filterableFields`. They
 * are retired anyway, by explicit maintainer ruling: **a live schema property is
 * not a consumer of a locale string; only a labelled UI control is.** Nothing
 * renders a label for these properties, so nothing reads their label. If a
 * settings panel is ever specified, its keys are re-authored alongside it.
 *
 * ## Why this pin is NEGATIVE, and why it is needed at all
 *
 * Every i18n gate in this repo runs **call site → key**, never key → call site
 * (the same argument `report-editor-retired-4145.test.ts` sets out next door):
 * `check-i18n-call-site-keys.mjs` never visits a key with no call site,
 * `all-locales-key-parity` is fully satisfied by 116 dead keys present in all
 * ten packs, and `check-i18n-en-drift.mjs` only fires when an `en` value
 * CHANGES. `check-i18n-dead-keys.mjs` is the sweep that FOUND these, and it is
 * report-only by design — it enforces nothing and is wired into no workflow. So
 * the packs can re-accumulate this namespace with every gate green, which is
 * exactly how it grew. The guard has to be written down by name.
 *
 * Reverse-verified: restoring one retired key to one pack turns this pin red
 * (naming the pack and the key) and `all-locales-key-parity` red alongside it;
 * deleting one LIVE key instead turns this file's live-subset assertion red
 * while the retired-key assertions stay green, which is what makes this a
 * classifier rather than a rubber stamp.
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
// implicit-`any` index into a `const` map (TS7053). Same convention as
// `report-editor-retired-4145.test.ts` next door.
type LocaleCode = keyof typeof builtInLocales;
const LANGS = Object.keys(builtInLocales) as LocaleCode[];

const at = (pack: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], pack);

/**
 * The 116 retired keys, listed BY NAME in the packs' own order rather than
 * counted. A count passes when one key returns and another leaves; the names do
 * not. 209 keys existed in the namespace; 116 were retired; 93 survived — 94
 * since objectui#5232 added `viewConfigPermissionDenied`, the refusal shown when
 * a session without `manage_metadata` tries to change ORG-WIDE view config
 * (objectstack#7494's ruling). An ADDITION to a live namespace is not a
 * regression of the retirement this file pins: none of the retired keys
 * came back, which is what the `it` below actually asserts.
 *
 * ## The objectui#8754 addition — 116 retired become 118
 *
 * `groupBy` and `toolbar` joined the retired list in objectui#8754's deletion
 * round, and they are here rather than in that card's own pin because THIS file
 * owns the namespace's arithmetic: a `console.objectView.*` key retired anywhere
 * else would move the surviving count out from under the assertions below.
 *
 * Both were dead all along and were held out of objectui#4730's sweep by a
 * measurement defect, not by a reader. `check-i18n-dead-keys`' text net matched
 * on a plain substring, so each was demoted by a LONGER live sibling that merely
 * contains it — `groupBy` by `groupByField` / `groupByFieldHelp`
 * (`CreateViewDialog.tsx`), `toolbar` by `toolbarEnabledCount`. PR objectui#8753
 * put a key-boundary requirement on both sides of the probe, which is what moved
 * them into CONFIRMED. Note that `toolbarHint` was ALREADY retired here while
 * `toolbar` was not — a split with no reason behind it, which is the shape a
 * substring false-positive leaves.
 *
 * ⚠️ The total below is 225 and that is deliberate: 225 is the count of keys
 * that ever EXISTED in this namespace, split into a retired half that only
 * grows and a surviving half that shrinks to match. A retirement moves the
 * split; only a genuinely new key moves the total (objectui#10636's
 * `recordCountOne` moved it from 210; objectui#11445 retired that key and
 * added six count-family slots, `_one` / `_other` on `recordCount`,
 * `importedToast` and `bulkDeleteConfirm`, making 217; objectui#11576 added
 * eight dataset-binding keys, making 225).
 *
 * ## The objectui#11445 change — 118 retired become 119
 *
 * `recordCountOne` was the singular half of a code-selected pair; the footer
 * now asks the `recordCount` count family, so the sibling left all ten packs.
 *
 * ## The objectui#11576 change — 119 retired become 123, 217 total become 225
 *
 * The create-view dialog's chart picks were the pre-ADR-0021 inline axes, which
 * the spec's list chart block refuses by name. The dialog now binds a dataset
 * of the object, so the four axis labels it alone read (`xAxisField`,
 * `xAxisFieldHelp`, `yAxisField`, `yAxisFieldHelp`) left all ten packs, and
 * eight new keys label the dataset, measure and dimension picks (`dataset`,
 * `datasetHelp`, `chartMeasure`, `chartMeasureHelp`, `chartDimension`,
 * `chartDimensionHelp`, `viewTypeUnavailableDataset`, `noDatasetMeasure`).
 *
 * ## The objectui#12504 change — 123 retired become 124
 *
 * `viewConfigPermissionDenied` (objectui#5232's addition, above) was the toast
 * the console's toolbar write raised when the adapter's capability gate refused
 * an org-wide view-config change. The maintainer's ruling on objectui#12504
 * retired that write (`persistViewPatch`) with the adapter method and its gate
 * (`updateViewConfig`), and the toast was its only producer, so the key left
 * all ten packs. A retirement moves the split, not the total.
 */
const RETIRED_OBJECT_VIEW_KEYS = [
  'accessibility',
  'addDeleteRecordsInline',
  'addQuickFilter',
  'addRecordEnabled',
  'addRecordFormView',
  'addRecordMode',
  'addRecordPosition',
  'addRecordViaForm',
  'addRule',
  'addView',
  'advanced',
  'allowExport',
  'allowPrinting',
  'appearance',
  'ariaDescribedBy',
  'ariaLabel',
  'ariaLive',
  'bulkActions',
  'clickIntoRecordDetails',
  'closePanel',
  'collapseAllByDefault',
  'color',
  'columns',
  'columnsConfigured',
  'conditionalFormatting',
  'data',
  'dateField',
  'densityComfortable',
  'densityCompact',
  'densityMode',
  'densitySpacious',
  'description',
  'designTools',
  'editView',
  'emptyStateIcon',
  'emptyStateMessage',
  'emptyStateTitle',
  'enableColor',
  'enableDensity',
  'enableFilter',
  'enableGroup',
  'enableHideFields',
  'enableSearch',
  'enableSort',
  'enterDesignMode',
  'exitDesignMode',
  'exportFileNamePrefix',
  'exportFormats',
  'exportIncludeHeaders',
  'exportMaxRecords',
  'exportPrint',
  'exportPrintHint',
  'fieldTextColor',
  'fields',
  'fieldsVisible',
  'filterBy',
  'filterableFields',
  'filtersCount',
  'general',
  'generalHint',
  'gridOptionsHint',
  'groupBy',
  'hiddenFields',
  'hideAllFields',
  'inlineEdit',
  'listConfigHint',
  'metadataInspector',
  'navigationHint',
  'navigationMode',
  'navigationSection',
  'navigationWidth',
  'navigationWidthHint',
  'noDescription',
  'none',
  'openNewTab',
  'openNewTabHint',
  'page',
  'pageConfigHint',
  'pageSize',
  'pageSizeOptions',
  'prefixField',
  'quickFilters',
  'records',
  'recordsHint',
  'resizableColumns',
  'rowActions',
  'rowHeight',
  'searchableFields',
  'selectionMode',
  'selectionMultiple',
  'selectionNone',
  'selectionSingle',
  'sharing',
  'sharingEnabled',
  'sharingVisibility',
  'showAdvancedSettings',
  'showAllFields',
  'showDescription',
  'showFewerSettings',
  'showFieldDescriptions',
  'showRecordCount',
  'sortBy',
  'sortsCount',
  'source',
  'toolbar',
  'toolbarHint',
  'typeOptions',
  'ufAddTab',
  'ufAllowAddTab',
  'ufDropdown',
  'ufElements',
  'ufNoFields',
  'ufTabLabel',
  'ufToggle',
  'userActions',
  'userFilters',
  'viewTabs',
  'wrapHeaders',
  // objectui#11445 — the record-count footer's code-selected singular, folded
  // into the `recordCount` count family.
  'recordCountOne',
  // objectui#11576 — the create-view dialog's pre-ADR-0021 chart axes, replaced
  // by the dataset binding; the dialog was their only reader.
  'xAxisField',
  'xAxisFieldHelp',
  'yAxisField',
  'yAxisFieldHelp',
  // objectui#12504 — the refused toolbar view-write's toast; the write and the
  // adapter gate that refused it retired together, and it had no other reader.
  'viewConfigPermissionDenied',
] as const;

/**
 * How many keys the namespace keeps — the live + indirect-reference remainder.
 * 104 since objectui#13052 added `objectPackageDisabled`, the object route's
 * "this object's package is disabled" sentence (`ObjectNotFoundState`); 105
 * since objectui#13330 added `managedUsers`, Setup → Users' invite line and
 * 「未授权」 marker on a cloud-managed environment (`managedEnvironmentUsers`).
 */
const SURVIVING_KEY_COUNT = 105;

describe('console.objectView config-panel keys are retired (objectui#4730)', () => {
  it('the retired list is the measured set', () => {
    // Guards the premise the rest of the file rests on. If this arithmetic ever
    // stops holding, the assertions below are checking a set nobody chose.
    expect(RETIRED_OBJECT_VIEW_KEYS).toHaveLength(124);
    expect(new Set(RETIRED_OBJECT_VIEW_KEYS).size).toBe(124);
    // 209 at objectui#4730's landing; 210 since objectui#5232 added
    // `viewConfigPermissionDenied`; 211 since objectui#10636 added
    // `recordCountOne`, the record-count footer's singular; 217 since
    // objectui#11445 added six count-family slots (and retired `recordCountOne`,
    // which moved the split, not the total); 225 since objectui#11576 added the
    // create-view dialog's eight dataset-binding keys (and retired its four axis
    // keys); 227 since objectui#12418 added `resetView` and `resetViewTitle`,
    // the header's "Reset view" entry (and objectui#12504 retired
    // `viewConfigPermissionDenied`, which moved the split, not the total); 228
    // since objectui#13052 added `objectPackageDisabled`, the not-found view's
    // package-disabled sentence; 229 since objectui#13330 added
    // `managedUsers`, the managed environment's Users-list strings. The
    // RETIRED half is a ratchet that never
    // runs BACKWARDS — it is pinned twice above, and objectui#8754 advanced it
    // 116 -> 118 — while the surviving half is a live namespace that grows on a
    // new key and shrinks by exactly what the retired half gains. Splitting
    // them is the point: folding a new key into the total would be
    // indistinguishable from a retired key coming back.
    expect(RETIRED_OBJECT_VIEW_KEYS.length + SURVIVING_KEY_COUNT).toBe(229);
    expect(LANGS).toHaveLength(10);
  });

  it('no pack defines any retired key, in any of the ten packs', () => {
    const revived: string[] = [];
    for (const lang of LANGS) {
      for (const key of RETIRED_OBJECT_VIEW_KEYS) {
        if (at(builtInLocales[lang], `console.objectView.${key}`) !== undefined) {
          revived.push(`${lang} :: console.objectView.${key}`);
        }
      }
    }
    // Named, not counted: the failure message has to say WHICH pack and WHICH
    // key, because the repair for a half-reverted namespace differs per key.
    expect(revived).toEqual([]);
  });

  it('the namespace root survives, with the same surviving key shape in every pack', () => {
    // Deliberately NOT "the root is gone": most of this namespace is live. The
    // shape to pin is the surviving key SET, identical across packs — a root
    // that regrows a retired key is the regression this file exists for, and a
    // root that vanishes takes the live create-view dialog with it.
    const enKeys = Object.keys(at(builtInLocales.en, 'console.objectView') as Record<string, unknown>);
    expect(enKeys).toHaveLength(SURVIVING_KEY_COUNT);
    // The one key a pack may hold that `en` lacks: an `en` count family's slot
    // for a CLDR category the pack's OWN language selects (`ru` `_few`, `ar`
    // `_two` — `all-locales-key-parity.test.ts` owns that rule repo-wide).
    const SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'];
    const enFamilies = new Set(
      enKeys.flatMap((k) => {
        const s = SUFFIXES.find((x) => k.endsWith(x));
        return s ? [k.slice(0, -s.length)] : [];
      }),
    );
    const isLocalSlot = (lang: string, k: string) => {
      const s = SUFFIXES.find((x) => k.endsWith(x));
      return (
        s !== undefined &&
        !enKeys.includes(k) &&
        enFamilies.has(k.slice(0, -s.length)) &&
        (new Intl.PluralRules(lang).resolvedOptions().pluralCategories as string[]).includes(s.slice(1))
      );
    };
    for (const lang of LANGS) {
      const ns = at(builtInLocales[lang], 'console.objectView');
      expect(ns, `${lang} lost the console.objectView root`).toBeDefined();
      const keys = Object.keys(ns as Record<string, unknown>).filter((k) => !isLocalSlot(lang, k));
      expect(keys.sort(), lang).toEqual([...enKeys].sort());
    }
  });

  it('the live subset is still a real translation in all ten packs, not English by fallback', () => {
    // The deletion swept AROUND these; this asserts that no single pack had a
    // live key swept up with its retired neighbours. A live key lost that way is
    // the one unrecoverable failure mode of this retirement — it ships a missing
    // label to ten locales, and no other gate here would say so.
    const LIVE_SAMPLE = ['new', 'save', 'configureView', 'viewTypeGrid'] as const;
    for (const lang of LANGS) {
      for (const key of LIVE_SAMPLE) {
        const value = at(builtInLocales[lang], `console.objectView.${key}`);
        expect(typeof value, `${lang}.console.objectView.${key}`).toBe('string');
        expect(
          (value as string).trim().length,
          `${lang}.console.objectView.${key} is empty`,
        ).toBeGreaterThan(0);
      }
    }
    // A sample across writing systems, so "all ten packs kept the key" cannot be
    // satisfied by ten copies of the English string.
    expect(at(builtInLocales.en, 'console.objectView.save')).toBe('Save');
    expect(at(builtInLocales.zh, 'console.objectView.save')).toBe('保存');
    expect(at(builtInLocales.ru, 'console.objectView.save')).toBe('Сохранить');
    expect(at(builtInLocales.ar, 'console.objectView.save')).toBe('حفظ');
  });

  it('no consuming package asks t() for a retired key', () => {
    // Scoped to the trees that render the object-view surface: app-shell (the
    // config panel, the create-view dialog, the runtime ObjectView) and
    // plugin-view (the Studio grid toolbar that borrows this namespace).
    //
    // Why pin the READER when `check:i18n-keys` already fails on a `t()` key no
    // pack defines: that gate reports it as "key missing from `en`", and the
    // obvious repair for a missing key is to backfill it — exactly the move that
    // rebuilds the dead namespace. This assertion is where the reason lives, so
    // the next author reads "this namespace is retired" instead of "one pack is
    // behind".
    //
    // Call-SHAPED and key-SPECIFIC, the same trade `report-editor-retired-4145`
    // makes next door: a bare substring scan would score prose that NAMES a
    // retired key as the offence, and the 93 live keys in this same namespace
    // are exactly what must keep working. No dynamic-template check here, and
    // that is the one place this file diverges from its neighbour — a dynamic
    // read into this namespace can legitimately be reaching for one of the 93
    // survivors, so it is not evidence of a revival.
    const roots = ['packages/app-shell/src', 'packages/plugin-view/src'];
    const retired = new Set<string>(RETIRED_OBJECT_VIEW_KEYS);
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
        const text = readFileSync(full, 'utf8');
        for (const m of text.matchAll(/\bt?t\(\s*['"`]console\.objectView\.([A-Za-z0-9_]*)/g)) {
          if (retired.has(m[1])) offenders.push(`${full} :: console.objectView.${m[1]}`);
        }
      }
    };

    for (const root of roots) {
      // Rooted at THIS FILE, not at the cwd (objectui#7799): the invocation guard
      // pins VITEST's root, which the package `test` script sets correctly while
      // leaving cwd in the package. Asserted rather than assumed: a scan root that
      // silently does not exist walks nothing and passes, which is the one
      // direction a revival gate must not fail in.
      const abs = join(REPO_ROOT, root);
      expect(existsSync(abs), `scan root missing: ${abs}`).toBe(true);
      walk(abs);
    }

    expect(
      offenders,
      'A retired console.objectView.* key is being read again. The namespace is ' +
        'retired (objectui#4730, ruled 2026-08-19) — do NOT backfill the key ' +
        'into the packs. If a view-configuration settings panel is being built, ' +
        'its keys are re-authored alongside it.',
    ).toEqual([]);
  });
});
