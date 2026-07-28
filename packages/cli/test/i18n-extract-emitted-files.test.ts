// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Which files `os i18n extract` writes is also what `--check` verifies, so a
// file quietly dropping out of the emit set quietly drops out of the drift
// gate — the gate keeps printing a green tick over strictly less coverage.
// That is exactly what happened while building #3370: deriving metadata-forms
// emission from `--objects-only` took the repo's own `pnpm check:i18n` from 8
// bundles to 4, silently un-checking the 803-key Studio baseline in four
// locales. These cases pin the emit set to the flags, so the next change to it
// has to be deliberate.
//
// `--objects-only` and `--metadata-forms` are orthogonal: the first picks the
// sub-tree of the *objects* module, the second decides whether the companion
// metadata-forms module is written at all.

import { describe, it, expect } from 'vitest';
import { extractTranslations } from '../src/utils/i18n-extract';

/** Mirror of the emit rule in `src/commands/i18n/extract.ts`. */
function emittedFiles(
  bundles: Record<string, { objects?: unknown; metadataForms?: unknown }>,
  flags: { objectsOnly: boolean; metadataForms: boolean },
): string[] {
  const files: string[] = [];
  for (const [locale, data] of Object.entries(bundles)) {
    if (countLeaves(flags.objectsOnly ? data.objects : data) > 0) {
      files.push(`${locale}.objects.generated.ts`);
    }
    if (flags.metadataForms && countLeaves(data.metadataForms) > 0) {
      files.push(`${locale}.metadata-forms.generated.ts`);
    }
  }
  return files.sort();
}

function countLeaves(obj: unknown): number {
  if (!obj || typeof obj !== 'object') return 0;
  let n = 0;
  for (const v of Object.values(obj as Record<string, unknown>)) {
    if (typeof v === 'string') n += 1;
    else if (v && typeof v === 'object') n += countLeaves(v);
  }
  return n;
}

const config = {
  objects: [{ name: 'account', label: 'Account', fields: { name: { label: 'Name' } } }],
};

describe('os i18n extract emit set', () => {
  const result = extractTranslations(config, { defaultLocale: 'en', locales: ['zh-CN'] });

  it('walks the platform metadata-form registry regardless of the stack config', () => {
    // The baseline is registry-driven, so it is present to emit even for a
    // stack that declares a single object.
    expect(countLeaves(result.bundles['en']?.metadataForms)).toBeGreaterThan(100);
  });

  it('writes the metadata-forms companion by default', () => {
    expect(emittedFiles(result.bundles, { objectsOnly: true, metadataForms: true })).toEqual([
      'en.metadata-forms.generated.ts',
      'en.objects.generated.ts',
      'zh-CN.metadata-forms.generated.ts',
      'zh-CN.objects.generated.ts',
    ]);
  });

  it('drops only the companion under --no-metadata-forms', () => {
    expect(emittedFiles(result.bundles, { objectsOnly: true, metadataForms: false })).toEqual([
      'en.objects.generated.ts',
      'zh-CN.objects.generated.ts',
    ]);
  });

  it('keeps the companion under --no-objects-only — the two flags are independent', () => {
    // Regression: metadata-forms emission was briefly derived from
    // `--objects-only`, which silently shrank the drift gate.
    expect(emittedFiles(result.bundles, { objectsOnly: false, metadataForms: true })).toContain(
      'en.metadata-forms.generated.ts',
    );
  });
});
