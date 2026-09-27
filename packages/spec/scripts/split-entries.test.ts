// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Unit pins for the split-entry declaration (#18576): an entry that publishes
// part of another category's protocol keeps its schemas under the HOME
// category (JSON Schema ids, reference pages) while its import lines name the
// split entry — and the declaration expires the moment the tree stops matching.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  formatSplitEntryCoverage,
  isSplitEntry,
  SPLIT_ENTRIES,
  splitEntriesHomedAt,
  splitEntryCoverage,
} from './lib/split-entries';
import { schemaClosureAbsenceIsDeclared } from './lib/schema-closure';
import { loadEntrySurfaces, resolveImports } from './lib/docs-import-surface';
import { CATEGORY_TITLES } from './lib/category-title';

/** This package's root — every read below stays inside it. */
const PKG_DIR = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(PKG_DIR, rel), 'utf-8');

describe('SPLIT_ENTRIES — the declared list', () => {
  it('declares api-assembled, homed at api, and nothing else', () => {
    expect(Object.keys(SPLIT_ENTRIES)).toEqual(['api-assembled']);
    expect(SPLIT_ENTRIES['api-assembled'].home).toBe('api');
    expect(splitEntriesHomedAt('api')).toEqual(['api-assembled']);
    expect(splitEntriesHomedAt('data')).toEqual([]);
  });

  it('is backed by the tree it cites — the entry exists and re-exports only its home\'s source', () => {
    // The claim an entry here makes is "every export is a declaration of the
    // home protocol". The control: the entry index re-exports from the home's
    // own directory and nowhere else.
    const index = read('src/api-assembled/index.ts');
    const reexports = [...index.matchAll(/export \* from '([^']+)'/g)].map((m) => m[1]);
    expect(reexports).toEqual(['../api/package-api-assembled.zod']);
    expect(JSON.parse(read('package.json')).exports).toHaveProperty('./api-assembled');
  });

  it('is titled as an entry, not as a protocol namespace', () => {
    // `check-docs-spec-enumerations.mjs` counts a subpath whose title ends in
    // ` Protocol` as a protocol NAMESPACE. A split entry is not one.
    expect(CATEGORY_TITLES['api-assembled']).toBeDefined();
    expect(CATEGORY_TITLES['api-assembled']).not.toMatch(/ Protocol$/);
  });
});

describe('the missing-schema-directory warning treats a split entry as declared', () => {
  it('answers yes for the split entry, and still no for an undeclared category', () => {
    expect(isSplitEntry('api-assembled')).toBe(true);
    expect(schemaClosureAbsenceIsDeclared('api-assembled')).toBe(true);
    expect(schemaClosureAbsenceIsDeclared('conversions')).toBe(false);
    expect(schemaClosureAbsenceIsDeclared('api')).toBe(false);
  });
});

describe('splitEntryCoverage — a split may not outlive its condition', () => {
  const splits = { 'api-assembled': { home: 'api', citation: 'test' } };

  it('is clean while the split is on disk, publishes nothing itself, and its home publishes', () => {
    const coverage = splitEntryCoverage(['api', 'api-assembled', 'data'], ['api', 'data'], splits);
    expect(coverage).toEqual({ selfPublishing: [], homeless: [], orphaned: [] });
    expect(formatSplitEntryCoverage(coverage)).toBeNull();
  });

  it('reports a split that grew its own json-schema directory', () => {
    const coverage = splitEntryCoverage(['api', 'api-assembled'], ['api', 'api-assembled'], splits);
    expect(coverage.selfPublishing).toEqual(['api-assembled']);
    expect(formatSplitEntryCoverage(coverage)).toContain('json-schema/api-assembled/ now exists');
  });

  it('reports a split whose home publishes nothing', () => {
    const coverage = splitEntryCoverage(['api', 'api-assembled'], ['data'], splits);
    expect(coverage.homeless).toEqual(['api-assembled']);
    expect(formatSplitEntryCoverage(coverage)).toContain('its home publishes no json-schema/');
  });

  it('reports a split whose directory is gone', () => {
    const coverage = splitEntryCoverage(['api'], ['api'], splits);
    expect(coverage.orphaned).toEqual(['api-assembled']);
    expect(formatSplitEntryCoverage(coverage)).toContain('packages/spec/src/api-assembled/ is gone');
  });
});

describe('resolveImports — a page documented under the home imports from the entry that exports it', () => {
  const surfaces = loadEntrySurfaces({
    './home': ['WidgetSchema (const)', 'Widget (type)'],
    './home-split': ['GadgetSchema (const)', 'Gadget (type)'],
  });

  it('keeps the home entry for a page whose names the home exports', () => {
    const r = resolveImports('home', ['Widget'], surfaces, ['home-split']);
    expect(r.entry).toBe('home');
    expect(r.valueNames).toEqual(['WidgetSchema']);
    expect(r.gaps).toEqual([]);
  });

  it('names the split entry for a page whose names only the split exports', () => {
    const r = resolveImports('home', ['Gadget'], surfaces, ['home-split']);
    expect(r.entry).toBe('home-split');
    expect(r.valueNames).toEqual(['GadgetSchema']);
    expect(r.typeNames).toEqual(['Gadget']);
    expect(r.gaps).toEqual([]);
  });

  it('is loud about a page split across both entries — the second entry\'s names are gaps', () => {
    const r = resolveImports('home', ['Widget', 'Gadget'], surfaces, ['home-split']);
    expect(r.entry).toBe('home');
    expect(r.gaps.sort()).toEqual(['home/Gadget — no schema const export', 'home/Gadget — no type export']);
  });

  it('NEGATIVE CONTROL: without the split declared, the split-only page is all gaps', () => {
    const r = resolveImports('home', ['Gadget'], surfaces, []);
    expect(r.entry).toBe('home');
    expect(r.valueNames).toEqual([]);
    expect(r.gaps.length).toBe(2);
  });
});
