// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34613] The artifact door takes a retired-mode seed dataset out of every
 * seed collection an artifact can hold (top-level `data`, `manifest.data`, each
 * assembled package body's `data` and `manifest.data`) before its strict parse,
 * and hands it back to the same collection after. The boot over a real artifact
 * is pinned in `@objectstack/runtime`
 * (`standalone-stack-artifact-retired-seed-mode-34613.test.ts`).
 */

import { describe, it, expect } from 'vitest';
import { SeedMode } from '@objectstack/spec/data';
import { restoreWithheldSeedDatasets, withholdRetiredSeedModes } from './artifact-retired-seed-modes.js';

const live = { object: 'a_region', externalId: 'name', records: [{ name: 'emea' }] };
const stale = (mode: string, object = 'a_source') => ({ object, mode, records: [{ name: 'web' }] });

describe('withholdRetiredSeedModes', () => {
  it('takes a retired-mode dataset out of every seed collection, without mutating the input', () => {
    const input = {
      data: [live, stale('insert')],
      manifest: { id: 'x', data: [stale('replace', 'm_source')] },
      packages: [{ id: 'p', data: [stale('insert', 'p_source'), live], manifest: { data: [live] } }],
    };
    const before = JSON.stringify(input);
    const { definition, withheld } = withholdRetiredSeedModes(input) as { definition: any; withheld: any[] };

    expect(JSON.stringify(input)).toBe(before);
    expect(definition.data).toEqual([live]);
    expect(definition.manifest.data).toEqual([]);
    expect(definition.packages[0].data).toEqual([live]);
    expect(definition.packages[0].manifest.data).toEqual([live]);
    expect(withheld.map((w) => [w.path.join('.'), w.object, w.mode])).toEqual([
      ['', 'a_source', 'insert'],
      ['manifest', 'm_source', 'replace'],
      ['packages.0', 'p_source', 'insert'],
    ]);
    // The prescription is SeedMode's own refusal, not restated.
    const verdict = SeedMode.safeParse('insert');
    expect(verdict.success).toBe(false);
    expect(withheld[0].prescription).toBe(verdict.success ? '' : verdict.error.issues[0]!.message);
  });

  it('hands each withheld dataset back to the collection it came from', () => {
    const { definition, withheld } = withholdRetiredSeedModes({
      data: [live, stale('insert')],
      packages: [{ id: 'p', data: [stale('replace', 'p_source')] }],
    }) as { definition: any; withheld: any[] };
    const parsed = structuredClone(definition);
    restoreWithheldSeedDatasets(parsed, withheld);
    expect(parsed.data).toEqual([live, stale('insert')]);
    expect(parsed.packages[0].data).toEqual([stale('replace', 'p_source')]);
  });

  it('CONTROL: a never-valid mode and a definition with nothing retired are left for the parse, untouched', () => {
    const input = { data: [live, stale('merge')] };
    const { definition, withheld } = withholdRetiredSeedModes(input);
    expect(definition).toBe(input);
    expect(withheld).toEqual([]);
  });
});
