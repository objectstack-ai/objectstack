// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Keeps this package's LEGACY-TRUSTED declaration honest (#12559).
//
// #12559 rolled the generated-leaf provenance companion (maintainer ruling
// #12069 Option A, #11671) out to eight of the nine i18n bundle sets. This one
// opted out, and `scripts/i18n-extract.config.ts` says why in prose: not one of
// its generated leaves is a byte copy of the current `en` source, and the
// companion records a leaf ONLY while it is such a copy — so opting in would
// commit three tables with zero entries, announcing an instrument that measures
// nothing while all 23 leaves stayed legacy-trusted regardless.
//
// That reason is a MEASUREMENT, and a measurement written in prose stops being
// true without telling anyone. The day `sys_presence` gains a field whose label
// is filled from the source — a new option, a new help string, anything the
// translators have not reached yet — the opt-out's premise is gone and the
// companion would have something real to record. This test is the trigger for
// that moment: it fails on the first byte copy and names the paragraph to go
// re-read.
//
// It deliberately does NOT assert the leaves differ in any particular way, and
// it is not a translation-quality check: `check:i18n-coverage` owns presence,
// and `check:i18n` owns bundle freshness. The one fact here is the one the
// opt-out rests on.

import { describe, it, expect } from 'vitest';
import { enObjects } from './en.objects.generated.js';
import { zhCNObjects } from './zh-CN.objects.generated.js';
import { jaJPObjects } from './ja-JP.objects.generated.js';
import { esESObjects } from './es-ES.objects.generated.js';

/** Every string leaf keyed by dotted path — the extractor's own leaf identity. */
function collectLeaves(node: unknown, path = '', out = new Map<string, string>()): Map<string, string> {
  if (typeof node === 'string') {
    out.set(path, node);
    return out;
  }
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    for (const [key, child] of Object.entries(node)) collectLeaves(child, path ? `${path}.${key}` : key, out);
  }
  return out;
}

const TRANSLATED = {
  'zh-CN': zhCNObjects,
  'ja-JP': jaJPObjects,
  'es-ES': esESObjects,
} as const;

describe('service-realtime is legacy-trusted by measurement, not by omission (#12559)', () => {
  const source = collectLeaves(enObjects);

  it('the bundles are non-empty, so an all-clear below is a reading rather than an empty walk', () => {
    // Without this, every assertion beneath it would pass just as loudly on a
    // bundle that failed to load — the "0 findings because 0 inputs" shape
    // #12559 was filed about.
    expect(source.size).toBeGreaterThan(0);
    for (const [locale, bundle] of Object.entries(TRANSLATED)) {
      expect(collectLeaves(bundle).size, `${locale} bundle walked to zero leaves`).toBe(source.size);
    }
  });

  it.each(Object.keys(TRANSLATED))('%s holds no leaf that is a byte copy of the current en source', (locale) => {
    const copies = [...collectLeaves(TRANSLATED[locale as keyof typeof TRANSLATED])]
      .filter(([path, value]) => source.get(path) === value)
      .map(([path]) => path);
    expect(
      copies,
      `${locale} now carries ${copies.length} leaf/leaves filled from the source (${copies.join(', ')}). ` +
        "That is exactly what the provenance companion records, so this package's opt-out in " +
        'scripts/i18n-extract.config.ts ("Provenance: LEGACY-TRUSTED BY CHOICE") no longer holds — ' +
        'either translate the leaf, or opt this set in by documenting the source-hashes flag in that ' +
        'config and committing the generated companions alongside the bundles.',
    ).toEqual([]);
  });
});
