/**
 * auth.remediation / auth.layout locale parity (#2870).
 *
 * `RemediationOverlay` is the ADR-0069 full-screen gate: when the backend
 * returns `PASSWORD_EXPIRED` or `MFA_REQUIRED`, it covers the app
 * (`fixed inset-0 z-[200]`) and there is no route around it. A user who cannot
 * read it cannot get back into the product — so a missing key here is not
 * cosmetic the way a missing page title is.
 *
 * i18next falls back to `en` silently (`fallbackLng: 'en'`, and the
 * missing-key handler is dev-only), so a key added to one pack and forgotten
 * in the others looks fine in whichever two locales get tested by hand. This
 * pins the whole namespace across all ten packs.
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
const NAMESPACES = ['auth.remediation', 'auth.layout'] as const;

const nodeOf = (code: LocaleCode, ns: string): unknown =>
  readPath(builtInLocales[code], ns);

describe.each(NAMESPACES)('%s translations', (ns) => {
  it('is present in every built-in locale pack', () => {
    const missing = LOCALES.filter((code) => !nodeOf(code, ns));
    expect(missing).toEqual([]);
  });

  it('exposes an identical key set in every locale', () => {
    const expected = keyPaths(nodeOf('en', ns));
    // Guard against the flattener silently returning nothing.
    expect(expected.length).toBeGreaterThan(1);

    for (const code of LOCALES) {
      expect({ code, keys: keyPaths(nodeOf(code, ns)) }).toEqual({ code, keys: expected });
    }
  });

  it('has a non-empty string at every leaf', () => {
    for (const code of LOCALES) {
      const node = nodeOf(code, ns);
      for (const path of keyPaths(node)) {
        const value = readPath(node, path);
        expect({ code, path, ok: typeof value === 'string' && value.trim().length > 0 })
          .toEqual({ code, path, ok: true });
      }
    }
  });

  it('actually translates the prose, rather than copying English', () => {
    // Short labels legitimately collide across languages ("Continue" is
    // "Continue" in French); only prose is checked, where a verbatim match
    // means the pack was never translated.
    const prose = keyPaths(nodeOf('en', ns)).filter((p) => {
      const v = readPath(nodeOf('en', ns), p);
      return typeof v === 'string' && v.length > 40;
    });
    expect(prose.length).toBeGreaterThan(0);

    for (const code of LOCALES.filter((c) => c !== 'en')) {
      for (const path of prose) {
        expect({ code, path, sameAsEnglish: readPath(nodeOf(code, ns), path) === readPath(nodeOf('en', ns), path) })
          .toEqual({ code, path, sameAsEnglish: false });
      }
    }
  });
});
