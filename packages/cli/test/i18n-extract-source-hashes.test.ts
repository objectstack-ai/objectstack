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
  narrowToCommittedSections,
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

// ---------------------------------------------------------------------------
// The companion covers the sections the run COMMITS (#12559)
// ---------------------------------------------------------------------------
//
// `extractTranslations` fills the table over every generated section it built,
// `metadataForms` included, because the rule behind it is about generated
// leaves rather than about files. A package that owns only its own objects
// passes `--no-metadata-forms` and commits no metadata-forms bundle — and its
// `metadataForms` subtree, absent from its merge baseline, arrives as a fresh
// `--fill=default` copy of `en`, so every leaf of it is recordable. Unnarrowed,
// that is what the table carries: measured on `@objectstack/plugin-audit` during
// the #12559 rollout, 763 records of which 2 were its own objects and 761 were
// digests of the metadata-form baseline `@objectstack/platform-objects` owns.
//
// The narrowing is pinned here rather than mirrored from the command, because a
// mirror of an emit rule is a second contract — it agrees until the day one side
// changes, and nothing says so on that day.

describe('the provenance table is narrowed to the committed sections (#12559)', () => {
  const result = extractTranslations(
    { objects: [{ name: 'account', label: 'Account', fields: { name: { label: 'Name' } } }] },
    { defaultLocale: 'en', locales: ['zh-CN'], fill: 'default' },
  );
  const table = result.sourceHashes['zh-CN'];
  const sectionsIn = (t: Record<string, string>) => [...new Set(Object.keys(t).map((k) => k.split('.', 1)[0]))].sort();

  it('has both sections to narrow — otherwise every case below would pass vacuously', () => {
    // The registry-driven metadata-form baseline is present for any stack, so
    // this is the precondition that makes the two cases a measurement rather
    // than an empty walk.
    expect(sectionsIn(table)).toEqual(['metadataForms', 'objects']);
    expect(Object.keys(table).length).toBeGreaterThan(100);
  });

  it('drops the metadata-forms records for a set that commits no metadata-forms bundle', () => {
    const narrowed = narrowToCommittedSections(table, ['objects']);
    expect(sectionsIn(narrowed)).toEqual(['objects']);
    // Every surviving record is unchanged — this narrows the table, it does not
    // recompute it.
    for (const [path, digest] of Object.entries(narrowed)) expect(digest).toBe(table[path]);
  });

  it('keeps every record for a set that commits both, so the covered set is untouched', () => {
    expect(narrowToCommittedSections(table, ['objects', 'metadataForms'])).toEqual(table);
  });

  it('names a section by a leaf path\'s first dotted segment, never by a prefix match', () => {
    // `objects` must not be reached through a section that merely starts with
    // it, and a nested key called `objects` must not be mistaken for the section.
    const odd = { 'objectsExtra.a.label': 'aaaaaaaaaaaaaaaa', 'metadataForms.x.objects.b': 'bbbbbbbbbbbbbbbb' };
    expect(narrowToCommittedSections(odd, ['objects'])).toEqual({});
    expect(narrowToCommittedSections(odd, ['metadataForms'])).toEqual({ 'metadataForms.x.objects.b': 'bbbbbbbbbbbbbbbb' });
  });

  it('commits nothing when no section is committed', () => {
    expect(narrowToCommittedSections(table, [])).toEqual({});
  });
});
