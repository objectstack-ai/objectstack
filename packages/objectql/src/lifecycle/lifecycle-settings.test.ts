// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Data Lifecycle settings page is administrator copy.
 *
 * Setup renders the manifest's `description` under the page title and each
 * specifier's `label` / `description` beside its control. An ADR number, a
 * section reference or the name of an internal component tells that reader
 * nothing they can act on: the reference belongs in the docblock next to the
 * manifest, never in the string.
 */

import { describe, expect, it } from 'vitest';
import { lifecycleSettingsManifest } from './lifecycle-settings.js';

const DESIGN_RECORD_VOCABULARY: ReadonlyArray<readonly [string, RegExp]> = [
  ['an ADR number', /ADR-\d/],
  ['a section reference', /§\s?\d/],
  ['an internal component', /\bLifecycleService\b|\bReaper\b|\bRotator\b|\bArchiver\b/],
];

function vocabularyIn(text: string): string[] {
  return DESIGN_RECORD_VOCABULARY.filter(([, re]) => re.test(text)).map(([name]) => name);
}

type Copy = { label?: string; description?: string; key?: string };

describe('lifecycle settings: admin-facing copy carries no design-record vocabulary', () => {
  it('the matcher recognises each kind of vocabulary it exists to keep out', () => {
    expect(vocabularyIn('Governance for ADR-0057 data lifecycle enforcement.')).toEqual(['an ADR number']);
    expect(vocabularyIn('A regulated tenant sets years (§3.2).')).toEqual(['a section reference']);
    expect(vocabularyIn('Growth alerts for the LifecycleService (Reaper / Rotator / Archiver).')).toEqual(['an internal component']);
    expect(vocabularyIn('How long system data is kept.')).toEqual([]);
  });

  it('the page description and every specifier label and description', () => {
    const manifest = lifecycleSettingsManifest as unknown as Copy & { specifiers: Copy[] };
    const strings: Array<[string, string]> = [];
    for (const [at, item] of [['lifecycle', manifest] as const, ...manifest.specifiers.map((s) => [`lifecycle.${s.key}`, s] as const)]) {
      if (typeof item.label === 'string') strings.push([`${at}.label`, item.label]);
      if (typeof item.description === 'string') strings.push([`${at}.description`, item.description]);
    }
    // Positive control: the walk reaches the page sentence and the retention override help.
    expect(strings.map(([at]) => at)).toEqual(expect.arrayContaining(['lifecycle.description', 'lifecycle.retention_overrides.description']));
    const offenders = strings.filter(([, text]) => vocabularyIn(text).length > 0).map(([at, text]) => `${at}: ${text}`);
    expect(offenders).toEqual([]);
  });
});
