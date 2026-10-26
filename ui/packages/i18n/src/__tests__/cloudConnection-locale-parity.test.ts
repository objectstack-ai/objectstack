/**
 * cloudConnection locale parity (objectstack#3589 follow-up).
 *
 * The Cloud Connection panel shipped with every string hard-coded in English
 * while its sibling widgets (marketplace, connectAgent) were fully localized —
 * so the page rendered a translated header above an English body. The related
 * framework-side gap had the same shape: `nav_cloud_connection` existed only
 * in zh-CN, leaving ja-JP/es-ES silently on the English fallback.
 *
 * Partial coverage is the failure mode worth pinning, because it degrades
 * quietly: i18next falls back to `en` and the UI just looks half-translated.
 * This asserts the `cloudConnection` key set is identical across all ten
 * built-in packs, so adding a key to `en` alone fails here rather than in a
 * user's browser.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales';

/** Flatten a nested translation node into sorted dot-paths. */
function keyPaths(node: unknown, prefix = ''): string[] {
  if (node === null || typeof node !== 'object') return [prefix];
  return Object.entries(node as Record<string, unknown>)
    .flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k))
    .sort();
}

/** Read a dot-path out of a nested translation node. */
function readPath(node: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (acc, seg) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[seg] : undefined),
    node,
  );
}

type LocaleCode = keyof typeof builtInLocales;

const LOCALES = Object.keys(builtInLocales) as LocaleCode[];
const cloudConnectionOf = (code: LocaleCode): unknown =>
  (builtInLocales[code] as Record<string, unknown>).cloudConnection;

describe('cloudConnection translations', () => {
  it('is present in every built-in locale pack', () => {
    const missing = LOCALES.filter((code) => !cloudConnectionOf(code));
    expect(missing).toEqual([]);
  });

  it('exposes an identical key set in every locale', () => {
    const expected = keyPaths(cloudConnectionOf('en'));
    // Guard against the flattener silently returning nothing.
    expect(expected.length).toBeGreaterThan(15);

    for (const code of LOCALES) {
      expect({ code, keys: keyPaths(cloudConnectionOf(code)) }).toEqual({ code, keys: expected });
    }
  });

  it('has a non-empty string at every leaf', () => {
    for (const code of LOCALES) {
      const node = cloudConnectionOf(code);
      for (const path of keyPaths(node)) {
        const value = readPath(node, path);
        expect({ code, path, ok: typeof value === 'string' && value.trim().length > 0 })
          .toEqual({ code, path, ok: true });
      }
    }
  });

  it('actually translates the user-facing prose, not just the key structure', () => {
    // Short labels legitimately collide across languages ("Runtime" is
    // "Runtime" in de/fr/es), so only the prose keys are checked — those
    // matching English verbatim means the pack was never translated.
    const prose = ['unbound.body', 'bound.privatePackages', 'waiting.popupOpened'] as const;
    const read = (code: LocaleCode, path: string) => readPath(cloudConnectionOf(code), path);

    for (const code of LOCALES.filter((c) => c !== 'en')) {
      for (const path of prose) {
        expect({ code, path, sameAsEnglish: read(code, path) === read('en', path) })
          .toEqual({ code, path, sameAsEnglish: false });
      }
    }
  });
});
