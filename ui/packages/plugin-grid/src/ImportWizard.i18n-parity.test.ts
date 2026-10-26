/**
 * `IMPORT_DEFAULT_TRANSLATIONS` ↔ `en.grid.import` parity (objectui#2872).
 *
 * The wizard keeps its own English map so it still renders with no
 * `I18nProvider` mounted (standalone embedding, unit tests). That is a second
 * source of English copy alongside the `en` locale pack, and the two had
 * already drifted apart before this test existed: the pack carried 62 keys,
 * the map 133, `zh` 130 — no two the same set. Because the wizard falls back
 * to the map whenever the pack lookup misses, the drift was invisible in
 * English and simply made the missing keys untranslatable everywhere else.
 *
 * Pinning the two together is what keeps that from recurring: a key added to
 * one without the other fails here.
 */
import { describe, it, expect } from 'vitest';
import en from '@object-ui/i18n/locales/en';
import { IMPORT_DEFAULT_TRANSLATIONS } from './ImportWizard';

/** Flatten a nested translation node into dot-paths. */
function flatten(node: unknown, prefix: string, out: Record<string, string>): void {
  if (node === null || typeof node !== 'object') {
    if (typeof node === 'string') out[prefix] = node;
    return;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    flatten(v, prefix ? `${prefix}.${k}` : k, out);
  }
}

const packEntries = (): Record<string, string> => {
  const out: Record<string, string> = {};
  const grid = (en as Record<string, unknown>).grid as Record<string, unknown> | undefined;
  flatten(grid?.import, 'grid.import', out);
  return out;
};

describe('ImportWizard English fallback map', () => {
  it('covers exactly the same keys as en.grid.import', () => {
    const pack = Object.keys(packEntries()).sort();
    const map = Object.keys(IMPORT_DEFAULT_TRANSLATIONS).sort();
    expect(pack.length).toBeGreaterThan(100);
    expect(map).toEqual(pack);
  });

  it('carries identical text for every key', () => {
    const pack = packEntries();
    for (const [key, value] of Object.entries(pack)) {
      expect({ key, text: IMPORT_DEFAULT_TRANSLATIONS[key] }).toEqual({ key, text: value });
    }
  });
});
