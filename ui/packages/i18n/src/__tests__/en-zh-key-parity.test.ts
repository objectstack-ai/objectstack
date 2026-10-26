/**
 * Full `en` ↔ `zh` key parity (objectui#2872 parts b and c).
 *
 * `fallbackLng: 'en'` means a key missing from a pack degrades silently — the
 * UI just renders English and looks "not translated yet" rather than broken.
 * The missing-key handler only fires in dev. So the packs had quietly drifted
 * in BOTH directions:
 *
 *   - 74 keys existed only in `zh` (`grid.import.*`, `auth.setPassword.*`).
 *     They were never in `en`, so no other locale could translate them — the
 *     English text came from call-site `defaultValue:` args and a private map
 *     inside `ImportWizard`.
 *   - 4 `en` keys were missing from `zh`, so Chinese users saw English.
 *
 * `en` and `zh` are the two packs that are actually maintained in full, so
 * they are pinned to each other here. The remaining eight packs are tracked
 * separately (objectui#2872 part a) — they are missing ~357 keys each and
 * cannot be asserted this way until that backfill lands.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales';

/** Flatten a nested translation node into sorted dot-paths. */
function keyPaths(node: unknown, prefix = ''): string[] {
  return node !== null && typeof node === 'object'
    ? Object.entries(node as Record<string, unknown>)
        .flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k))
        .sort()
    : [prefix];
}

describe('en ↔ zh key parity', () => {
  const en = keyPaths(builtInLocales.en);
  const zh = keyPaths(builtInLocales.zh);

  it('flattens a realistic number of keys', () => {
    // Guard against the walker silently returning nothing and the two
    // set-difference assertions below passing vacuously.
    expect(en.length).toBeGreaterThan(2000);
  });

  it('has no en key missing from zh', () => {
    const zhSet = new Set(zh);
    expect(en.filter((k) => !zhSet.has(k))).toEqual([]);
  });

  it('has no zh key absent from en', () => {
    // This direction matters just as much: a key only in `zh` cannot be
    // translated into any other language, because `en` is what translators
    // and the extraction tooling read as the source of truth.
    const enSet = new Set(en);
    expect(zh.filter((k) => !enSet.has(k))).toEqual([]);
  });
});
