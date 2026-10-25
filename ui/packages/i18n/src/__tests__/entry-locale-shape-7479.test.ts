/**
 * The published entry's LOCALE SHAPE, pinned (objectui#7479).
 *
 * ## What this stops
 *
 * `packages/i18n/src/index.ts` used to carry ten lines of
 * `export { default as <code> } from './locales/<code>.js'` plus a re-export of
 * `builtInLocales`. Either spelling makes all ten catalogues statically
 * reachable from any import of this package — an object literal naming ten
 * modules is the one shape no bundler can tree-shake — and the console measured
 * the result: ~450 KB gzipped of translation data fetched before first paint,
 * for a viewer who reads one catalogue.
 *
 * Restoring one line of that is a one-line regression that no BYTE budget
 * reports as one: the bytes land in a chunk whose ceiling was sized to hold
 * them. So the shape needs a pin of its own, and it needs TWO halves that fail
 * for different reasons:
 *
 *   - this file, on the SOURCE, so the cause is legible in a unit test with no
 *     console build in sight;
 *   - `scripts/check-eager-locale-catalogues.mjs`, on the BUILT bundle, so a
 *     new route to the same outcome — a page-load module importing the all-ten
 *     door, a chunk group that merges the catalogues back together, a bundler
 *     that stops honouring `import()` — is caught even when every source file
 *     still reads correctly.
 *
 * ⛔ Neither substitutes for the other. This one cannot see the bundle; that
 * one cannot run without a full build, and exits 2 rather than 0 when it has
 * none.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as entry from '../index.js';
import { BUILT_IN_LANGUAGE_CODES, DEFAULT_BUILT_IN_LANGUAGE } from '../locales/registry.js';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

// Rooted on THIS FILE, never on `process.cwd()` — the same assertion would read
// a different tree under a package-scoped vitest run (AGENTS.md; objectui#7791,
// objectui#7799).
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const entrySource = fs.readFileSync(path.join(packageRoot, 'src/index.ts'), 'utf8');

/**
 * The entry with its comments removed.
 *
 * ⚠️ Load-bearing, not tidiness. The entry's prose NAMES the spellings it
 * forbids — that is how the next reader learns why they are forbidden — so a
 * substring check against the raw file reds on the explanation and cannot tell
 * it apart from the defect. The assertions below are about CODE.
 */
const entryCode = mask(entrySource);

/** Every `from './locales/<something>.js'` specifier the entry names. */
function localeSpecifiersInEntry(): string[] {
  return [...entryCode.matchAll(/from '\.\/locales\/([A-Za-z0-9_-]+)\.js'/g)].map((m) => m[1]);
}

describe('the entry re-exports ONE catalogue, not ten (objectui#7479)', () => {
  it('names the resident catalogue and no other', () => {
    const specifiers = localeSpecifiersInEntry();
    // Counter-probe: a regex that stopped matching would make every assertion
    // below vacuously true. The entry reaches `./locales/` for at least the
    // resident catalogue, the registry and the direction helpers.
    expect(specifiers.length).toBeGreaterThan(0);

    const catalogues = specifiers.filter((name) => BUILT_IN_LANGUAGE_CODES.includes(name));
    expect(catalogues).toEqual([DEFAULT_BUILT_IN_LANGUAGE]);
  });

  it('does not reach the all-ten barrel at all', () => {
    // `./locales/index.js` is `builtInLocales` and the ten static imports behind
    // it. One specifier is the whole regression.
    expect(localeSpecifiersInEntry()).not.toContain('index');
    expect(entryCode).not.toContain("from './locales/index.js'");
  });

  it('exports no `builtInLocales` — the one shape nothing can tree-shake', () => {
    expect(Object.keys(entry)).not.toContain('builtInLocales');
    expect(entryCode).not.toContain('builtInLocales');
    // Counter-probe: the comment stripper must not have emptied the file, or
    // every `not.toContain` above is a statement about an empty string.
    expect(entryCode).toContain("export { default as en }");
  });

  it('still exports the resident catalogue, and it is a real catalogue', () => {
    // The other direction. An entry that exported NO catalogue would satisfy
    // every case above while breaking `fallbackLng`, the app-shell splash and
    // every synchronous consumer — and this file would have applauded.
    expect(Object.keys(entry)).toContain(DEFAULT_BUILT_IN_LANGUAGE);
    const resident = (entry as Record<string, unknown>)[DEFAULT_BUILT_IN_LANGUAGE] as {
      common?: { save?: string };
    };
    expect(typeof resident?.common?.save).toBe('string');
  });

  it('exports the loader API that replaced the nine static re-exports', () => {
    // A removal without its replacement is not this change; it is a break.
    for (const name of [
      'loadBuiltInLocale',
      'getLoadedBuiltInLocales',
      'isBuiltInLanguage',
      'BUILT_IN_LANGUAGE_CODES',
      'preloadBootstrapLocale',
      'resolveBootstrapLanguage',
    ]) {
      expect(Object.keys(entry)).toContain(name);
    }
  });

  it('still enumerates all ten languages — at zero catalogue payload', () => {
    expect(entry.BUILT_IN_LANGUAGE_CODES).toHaveLength(10);
    expect(entry.BUILT_IN_LANGUAGE_CODES).toContain('zh');
    // Enumerable, but not resident: naming a language must not fetch it.
    expect(entry.isBuiltInLocaleLoaded('zh')).toBe(entry.isBuiltInLocaleLoaded('zh'));
  });
});

describe('the all-ten door is still open, and still says what it costs', () => {
  it('`locales/index.ts` exports every catalogue and `builtInLocales`', async () => {
    const barrel = await import('../locales/index.js');
    expect(Object.keys(barrel.builtInLocales)).toEqual([...BUILT_IN_LANGUAGE_CODES]);
    for (const code of BUILT_IN_LANGUAGE_CODES) {
      expect(Object.keys(barrel)).toContain(code);
    }
  });

  it('is published under a specifier a reader can see the cost of', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
    ) as { exports: Record<string, { import?: string }> };
    expect(manifest.exports['./locales']?.import).toBe('./dist/locales/index.js');
  });
});
