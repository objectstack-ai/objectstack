// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `os i18n extract --source-hashes` — the provenance companion (#11671,
// maintainer ruling #12069 Option A).
//
// The RULE itself lives in `@objectstack/platform-objects/apps`
// (`collectFilledFromHashes`) and is pinned by that package's
// `source-hash.test.ts`. What this file pins is the extractor's side of the
// contract: that the table reaches the result, that the emitted module is
// byte-stable, and that reading it back returns what was written — the three
// properties `--check` rests on, since it compares the companion by bytes.

import { describe, it, expect } from 'vitest';
import {
  extractTranslations,
  renderSourceHashModule,
  parseSourceHashModule,
} from '../src/utils/i18n-extract.js';

const stack = (help: string) => ({
  objects: [
    {
      name: 'sys_activity',
      label: 'Activity',
      fields: { type: { type: 'text', label: 'Type', help } },
    },
  ],
});

const SRC_V1 = 'The kind of activity. Readonly fields are skipped by validateRecord.';
const SRC_V2 = 'The kind of activity.';
const HELP = 'objects.sys_activity.fields.type.help';

describe('the extractor produces a per-locale provenance table', () => {
  it('records the leaves it filled from the source, and nothing for `en`', () => {
    const r = extractTranslations(stack(SRC_V1), {
      locales: ['zh-CN'],
      fill: 'default',
    });
    expect(r.sourceHashes.en).toBeUndefined();
    expect(r.sourceHashes['zh-CN'][HELP]).toMatch(/^[0-9a-f]{16}$/);
  });

  it('carries a record forward when the source moves — the stale fill stays visible', () => {
    const first = extractTranslations(stack(SRC_V1), { locales: ['zh-CN'], fill: 'default' });
    const recorded = first.sourceHashes['zh-CN'];

    // The source is revised. The translated bundle still holds the OLD text,
    // because merge only ever fills gaps — that is the card's whole mechanism.
    const second = extractTranslations(
      { ...stack(SRC_V2), translations: [{ 'zh-CN': first.bundles['zh-CN'] }] },
      { locales: ['zh-CN'], fill: 'default', previousSourceHashes: { 'zh-CN': recorded } },
    );
    expect(second.bundles['zh-CN'].objects?.sys_activity?.fields?.type?.help).toBe(SRC_V1);
    expect(second.sourceHashes['zh-CN'][HELP]).toBe(recorded[HELP]);
  });

  it('is idempotent — feeding its own output back changes nothing', () => {
    const first = extractTranslations(stack(SRC_V1), { locales: ['zh-CN'], fill: 'default' });
    const again = extractTranslations(
      { ...stack(SRC_V1), translations: [{ 'zh-CN': first.bundles['zh-CN'] }] },
      { locales: ['zh-CN'], fill: 'default', previousSourceHashes: first.sourceHashes },
    );
    expect(again.sourceHashes['zh-CN']).toEqual(first.sourceHashes['zh-CN']);
  });
});

describe('the emitted module', () => {
  const table = { 'objects.b.label': '00ff00ff00ff00ff', 'objects.a.label': 'a1b2c3d4e5f60718' };

  it('sorts its keys, so a walk-order change cannot fail `--check` on a tree that is in sync', () => {
    const out = renderSourceHashModule(table, { locale: 'zh-CN' });
    expect(out.indexOf('objects.a.label')).toBeLessThan(out.indexOf('objects.b.label'));
    expect(out).toContain('export const zhCNGeneratedSourceHashes: Readonly<Record<string, string>> =');
  });

  it('round-trips through the reader the command uses to recover previous records', () => {
    expect(parseSourceHashModule(renderSourceHashModule(table, { locale: 'ja-JP' }))).toEqual(table);
  });

  it('returns undefined for anything it cannot read, rather than inventing records', () => {
    expect(parseSourceHashModule('')).toBeUndefined();
    expect(parseSourceHashModule('export const x: Readonly<Record<string, string>> = { oops };')).toBeUndefined();
    expect(parseSourceHashModule('export const x: Readonly<Record<string, string>> = { "a": 3 };')).toBeUndefined();
  });
});
