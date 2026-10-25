/// <reference types="node" />
/**
 * ObjectUI — the renderer-consumed-keys census, re-measured every run
 * (objectui#5709)
 *
 * `CONSUMED_WIDGET_OPTION_KEYS` is a hand-pinned list, and a hand-pinned list
 * about SOMEONE ELSE'S code is wrong the day that code moves. The 2026-08-23
 * ruling made the census the load-bearing half of the warning ("a false
 * positive on a key that IS consumed is worse than no warning"), so this file
 * re-derives every input the list was pinned from, on every test run:
 *
 *  1. the DECLARED set, from the installed `@objectstack/spec` schema — the
 *     same source the platform's save gate parses with;
 *  2. the CONSUMED set, extracted from `DatasetWidget.tsx` source text — the
 *     one component every spec-legal (dataset-bound) widget renders through.
 *     It is the declared five and nothing else: `description`, the metric
 *     sub-caption objectui#7293 read here, is retired at both ends
 *     (objectui#11389, ruling C), so the accepted set, the declared set and
 *     the measured read set are one set;
 *  3. the ABSENCE of the retired sub-caption's readers across
 *     `plugin-dashboard`, with a lit control on the same scan;
 *  4. a repo tripwire for NEW files that start reading `widget.options`.
 *
 * ## What the instrument can and cannot see — read before trusting a verdict
 *
 * The extractor is a TEXT census: it matches `options.<identifier>` in one
 * file whose `options` binding it first proves to be the widget-options bag,
 * and it counts comments as reads. Both biases point the SAFE way (a key
 * wrongly counted consumed draws no warning — a false negative, never a false
 * positive). What it CANNOT follow is a consumption shape with no `options.`
 * spelling: a spread (`{ ...options }`), a destructuring (`const { x } =
 * options`), a computed access (`options[k]`), or the bag passed wholesale to
 * a helper. Those shapes exist in this repo — on the LEGACY (non-dataset)
 * dispatch branches the warning deliberately skips — so the census stays
 * honest by REFUSING them where it measures: their appearance in
 * `DatasetWidget.tsx` fails this file loudly instead of silently
 * under-counting. The tripwire has its own stated blind spot: it matches the
 * receiver spelling `widget.options` / `widget?.options`, so a read through a
 * renamed receiver is invisible to it (`legacyRetiredWidget.ts`'s
 * `w.options?.data` is the known live example — on a branch the warning
 * skips). It exists to catch new FILES joining the surface under the common
 * spelling, not to be a proof.
 *
 * Maintenance cost, measured while building it: when a renderer gains or
 * loses a consumed key, this file goes red and the fix is editing ONE array
 * (`CONSUMED_WIDGET_OPTION_KEYS`) plus its census notes; when the spec
 * declares a new key, same; when a new file starts reading the bag, the
 * tripwire's allowlist is the edit. The scan itself is ~70ms over ~1.5k
 * files.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DashboardWidgetOptionsSchema, DashboardWidgetSchema } from '@objectstack/spec/ui';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { stripComments } from '../../../../scripts/js-comment-mask.mjs';
import {
  CONSUMED_WIDGET_OPTION_KEYS,
  UNCONSUMED_WIDGET_OPTION,
} from '../dashboard-widget-options.js';
import { uiRoot } from '../../../../scripts/ui-root.mjs';

/**
 * The RETIRED metric sub-caption key (objectui#4032 item 4, objectui#7293;
 * retired at both ends by objectui#11389, ruling C, after objectstack's half in
 * `@objectstack/spec` 17.7.0). It was the one accepted key the spec never
 * declared. Named once here so legs 1 to 3 cannot drift apart about which key
 * they keep out.
 */
const SUBCAPTION_KEY = 'description';

/** Repo root, resolved by the shared helper so the same file reads the same tree standalone and under `ui/`. */
const repoRoot = uiRoot();

const DATASET_WIDGET = join(repoRoot, 'packages/plugin-dashboard/src/DatasetWidget.tsx');
const DASHBOARD_RENDERER = join(repoRoot, 'packages/plugin-dashboard/src/DashboardRenderer.tsx');
const DASHBOARD_GRID_LAYOUT = join(repoRoot, 'packages/plugin-dashboard/src/DashboardGridLayout.tsx');
/**
 * Where the sub-caption's two limbs lived from objectui#8889 until
 * objectui#11389 deleted the module. Leg 3 pins that it stays gone.
 */
const WIDGET_SUB_CAPTION = join(repoRoot, 'packages/plugin-dashboard/src/widgetSubCaption.ts');
const PLUGIN_DASHBOARD_SRC = join(repoRoot, 'packages/plugin-dashboard/src');

const declaredKeys = Object.keys(DashboardWidgetOptionsSchema.shape).sort();

describe('leg 1 — the spec side of the pin', () => {
  it('the options schema still rides passthrough — the premise of the warning', () => {
    // If the spec ever tightens this to strict/strip, undeclared keys stop
    // parsing and this warning's subject disappears — re-visit the module.
    const parsed = DashboardWidgetOptionsSchema.safeParse({ __census_probe: 1 });
    expect(parsed.success).toBe(true);
    expect((parsed as { data: Record<string, unknown> }).data.__census_probe).toBe(1);
  });

  it('declared keys are exactly the pinned spec set', () => {
    // Derivation guard for everything below: a schema that stopped exporting
    // `shape` (or renamed keys) must fail HERE, not let ⊆-checks pass on [].
    expect(declaredKeys).toEqual(['dateGranularity', 'limit', 'sortBy', 'sortOrder', 'stageOrder']);
  });

  it('every declared key is accepted, and no undeclared key is — not even the retired `description`', () => {
    for (const key of declaredKeys) expect(CONSUMED_WIDGET_OPTION_KEYS).toContain(key);
    const extras = CONSUMED_WIDGET_OPTION_KEYS.filter((k) => !declaredKeys.includes(k));
    // `description` was the one undeclared accepted key, the metric sub-caption
    // (objectui#11389 retired it). Any undeclared entry needs its own
    // documented read-site evidence before it joins.
    expect(extras).toEqual([]);
    expect(CONSUMED_WIDGET_OPTION_KEYS).not.toContain(SUBCAPTION_KEY);
  });

  it('`dataset` is required — the fact the census scopes itself by', () => {
    // The warning only fires on dataset-bound widgets BECAUSE that is the only
    // spec-legal form. If the spec relaxes this, the legacy dispatch branches
    // become legal authoring surface and the census must grow to cover them.
    expect(DashboardWidgetSchema.shape.dataset.isOptional()).toBe(false);
  });

  it('the suppressWarnings escape hatch is spec-legal with this code in it', () => {
    const parsed = DashboardWidgetSchema.safeParse({
      id: 'sla_gauge',
      dataset: 'case_metrics',
      values: ['avg_sla_violated'],
      type: 'gauge',
      suppressWarnings: [UNCONSUMED_WIDGET_OPTION],
    });
    expect(parsed.success).toBe(true);
  });
});

describe('leg 2 — the renderer side: DatasetWidget source census', () => {
  const src = readFileSync(DATASET_WIDGET, 'utf8');

  it('the options bag is still where the census measured it', () => {
    // The binding the extractor's `options.` matches belong to. Renamed or
    // moved ⇒ the extraction below would be measuring a different variable.
    expect(src).toMatch(/widget\?\.options && typeof widget\.options === 'object'/);
  });

  it('contains no consumption shape the extractor cannot see', () => {
    // Each of these would make the text census silently under-count, which is
    // the false-POSITIVE direction (a consumed key missing from the accepted
    // set draws a warning on working metadata). Loud failure instead: whoever
    // introduces the shape extends the census in the same change.
    expect(src, 'spread of the options bag').not.toMatch(/\.\.\.options\b/);
    expect(src, 'destructuring from the options bag').not.toMatch(/\}\s*=\s*options\b/);
    expect(src, 'computed access into the options bag').not.toMatch(/\boptions\[/);
  });

  it('the extracted read set is the declared set, without the retired sub-caption key', () => {
    const extracted = new Set<string>();
    for (const m of src.matchAll(/\boptions\.([A-Za-z_$][\w$]*)/g)) extracted.add(m[1]!);
    // Instrument control: a zero here is a broken instrument, not a reading —
    // `limit` is known-present at a `options.limit` read site.
    expect(extracted.size).toBeGreaterThan(0);
    expect([...extracted]).toContain('limit');
    // objectui#7293 added `description` to this set (the metric tile's
    // sub-caption); objectui#11389 took it out again (ruling C). Its return here
    // is a renderer reading a retired key, so it is refused by name, not only
    // by the equality.
    expect([...extracted]).not.toContain(SUBCAPTION_KEY);
    expect([...extracted].sort()).toEqual([...declaredKeys].sort());
  });

  it('every accepted key has a read site in the file the census measures', () => {
    // The accepted set is no larger than what this file reads: a key accepted
    // without a read site would silence the warning on metadata that renders
    // nothing.
    const extracted = new Set<string>();
    for (const m of src.matchAll(/\boptions\.([A-Za-z_$][\w$]*)/g)) extracted.add(m[1]!);
    expect([...extracted].sort()).toEqual([...CONSUMED_WIDGET_OPTION_KEYS].sort());
  });

  it('`format` and `thresholds` are still not read on the dataset-bound path', () => {
    // The module header's BOUNDED closure claim (objectui#6186), which used to
    // ride implicitly on the `=== declaredKeys` equality above. Stated
    // explicitly so that widening the expected set can never quietly widen
    // this claim with it.
    const extracted = new Set<string>();
    for (const m of src.matchAll(/\boptions\.([A-Za-z_$][\w$]*)/g)) extracted.add(m[1]!);
    expect([...extracted]).not.toContain('format');
    expect([...extracted]).not.toContain('thresholds');
  });
});

describe('leg 3 — the retired sub-caption has no reader left (objectui#11389)', () => {
  /**
   * Every non-test TS/TSX source file of `plugin-dashboard`, comments stripped
   * through the repo's one comment scanner (`scripts/js-comment-mask.mjs`).
   * `stripComments`, not `maskComments`: this leg reports file names only,
   * never a line or an offset.
   */
  const sources = (): Array<[string, string]> => {
    const out: Array<[string, string]> = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.|\.d\.ts$/.test(entry.name)) {
          // Comments may NAME the retired key (they explain its retirement); a
          // read is code, so comments are dropped before matching.
          const code = stripComments(readFileSync(p, 'utf8')) as string;
          out.push([relative(repoRoot, p).replace(/\\/g, '/'), code]);
        }
      }
    };
    walk(PLUGIN_DASHBOARD_SRC);
    return out;
  };

  it('no source reads `options.description` or resolves a `subCaption`, and the scan is lit', () => {
    const files = sources();
    // Lit control: the same comment-stripped scan still finds a live read of
    // the bag, so an empty answer below is a reading, not a dead instrument.
    const control = files.filter(([, code]) => /\boptions\??\.limit\b/.test(code)).map(([f]) => f);
    expect(control).toContain('packages/plugin-dashboard/src/DatasetWidget.tsx');

    const readers = files
      .filter(([, code]) =>
        /\boptions\??\.description\b/.test(code) ||
        /\)\??\.description\b/.test(code) && /widget\??\.options\s+as\b/.test(code) ||
        /\bsubCaption\b/.test(code) ||
        /\bwidgetSubCaption\b/.test(code))
      .map(([f]) => f);
    expect(readers).toEqual([]);
  });

  it('the resolver module is gone and no surface calls its hook', () => {
    expect(existsSync(WIDGET_SUB_CAPTION)).toBe(false);
    for (const surface of [DASHBOARD_RENDERER, DASHBOARD_GRID_LAYOUT]) {
      const src = readFileSync(surface, 'utf8');
      expect(src).not.toMatch(/useWidgetSubCaption\(/);
      // Control on the same read: the surface is the file it claims to be.
      expect(src).toMatch(/<DatasetWidget\b/);
    }
  });
});

describe('leg 4 — repo tripwire: files reading widget.options', () => {
  it('no NEW file reads the widget options bag under the common spelling', () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (
          entry.name === 'node_modules' ||
          entry.name === 'dist' ||
          entry.name === '__tests__'
        ) {
          continue;
        }
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.|\.d\.ts$/.test(entry.name)) {
          if (/widget\??\.options/.test(readFileSync(p, 'utf8'))) {
            hits.push(relative(repoRoot, p).replace(/\\/g, '/'));
          }
        }
      }
    };
    for (const root of ['packages', 'apps']) walk(join(repoRoot, root));
    // The measured surface on origin/main@8689166f6, plus the census module
    // itself (whose header describes the bag in prose — it never renders one).
    // A new entry means a new consumer of the bag: re-run the census (module
    // header) before extending either this list or the accepted-key set.
    //
    // Two entries left with objectui#11389 (the sub-caption retired at both
    // ends): `widgetSubCaption.ts`, deleted with the resolver that read
    // `description` off the bag, and `useObjectLabel.ts`, whose only match was
    // the prose of the retired `widgetSubCaption` member. The list shrank
    // because the consumers left, not because the number was made to match.
    expect(hits.sort()).toEqual([
      'packages/plugin-dashboard/src/DashboardGridLayout.tsx',
      'packages/plugin-dashboard/src/DashboardRenderer.tsx',
      'packages/plugin-dashboard/src/DatasetWidget.tsx',
      'packages/sdui-parser/src/dashboard-widget-options.ts',
    ]);
  });
});
