// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Unit pins for the schema-closure exemption (#15870): `gen:docs` stops warning
// about `json-schema/<category>/` ONLY where the tree declares the absence is
// intended, and keeps warning everywhere else.
//
// These run in milliseconds over pure functions and over source text. The last
// describe block is the CALLER half, and it is here for the reason
// `json-schema-out-dir.test.ts` states about its own pair: a unit test over an
// extracted helper stays green forever if the caller stops calling it.
//
// ⚠️ That caller half is a SOURCE-TEXT pin, and what it cannot see is stated
// rather than left to be discovered: it proves the warning's only emission site
// is behind the predicate, NOT that a run of the generator behaves that way. A
// spawned end-to-end run was weighed and rejected — `build-docs.ts` resolves
// `json-schema/`, `api-surface/` and the repo's `content/docs/references/` from
// its own `__dirname`, so driving it takes the whole sandbox
// `build-schemas-check-mode.test.ts` builds, for one console line. The
// behavioural reading was taken once, by hand, at the change: with
// `json-schema/data/` moved aside, `gen:docs` printed the warning for `data`
// and still printed nothing for `meta-spelling`.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  CATEGORIES_WITHOUT_SCHEMA_CLOSURE,
  formatSchemaClosureExemptionCoverage,
  schemaClosureAbsenceIsDeclared,
  schemaClosureExemptionCoverage,
  schemaClosureExemptionsAreClean,
} from './lib/schema-closure';
import { CATEGORY_TITLES } from './lib/category-title';

/** This package's root — every read below stays inside it. */
const PKG_DIR = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(PKG_DIR, rel), 'utf-8');

describe('CATEGORIES_WITHOUT_SCHEMA_CLOSURE — the declared list', () => {
  it('declares meta-spelling, and nothing else', () => {
    // The boundary is the finding, not an implementation detail: `conversions`
    // and `migrations` are the OTHER two categories with no json-schema
    // directory, and a search of this tree turns up no equivalent declaration
    // for either. Pinned so that adding one is a decision someone writes down
    // rather than a line that slips in beside a refactor.
    expect(Object.keys(CATEGORIES_WITHOUT_SCHEMA_CLOSURE)).toEqual(['meta-spelling']);
  });

  it('leaves conversions and migrations warning — the un-silenced half', () => {
    expect(schemaClosureAbsenceIsDeclared('conversions')).toBe(false);
    expect(schemaClosureAbsenceIsDeclared('migrations')).toBe(false);
    expect(schemaClosureAbsenceIsDeclared('meta-spelling')).toBe(true);
  });

  it('says no for a category nobody has heard of', () => {
    // The default answer for anything unlisted, which is what makes a category
    // that goes missing by accident visible instead of self-exempting.
    expect(schemaClosureAbsenceIsDeclared('iam')).toBe(false);
    expect(schemaClosureAbsenceIsDeclared('constructor')).toBe(false);
    expect(schemaClosureAbsenceIsDeclared('toString')).toBe(false);
  });

  it('names a real citation for every entry, and the cited file really says it', () => {
    // A citation nobody checked is the shape this map exists to replace. The
    // control that makes each assertion a reading rather than a tautology: the
    // phrase is grepped out of the cited file, so deleting the declaration
    // upstream turns this red instead of leaving a dangling reference.
    expect(CATEGORIES_WITHOUT_SCHEMA_CLOSURE['meta-spelling']).toContain(
      'scripts/build-meta-url-spelling.ts',
    );
    expect(read('scripts/build-meta-url-spelling.ts')).toContain(
      '`/meta-spelling` entry ships vocabulary with no schema closure.',
    );
    expect(read('src/meta-spelling/manifest-collection-spelling.ts')).toContain(
      'no schema closure on the vocabulary path',
    );
    expect(JSON.parse(read('browser-reachable-entries.json')).browserReachable).toHaveProperty(
      './meta-spelling',
    );
  });

  it('is corroborated by the declared TITLES — Vocabulary, not Protocol', () => {
    // `CATEGORY_TITLES` is an independent, hand-declared surface, and it draws
    // the same boundary: the schema-free entry is titled "Vocabulary" while the
    // two undeclared ones carry the same word every category WITH a schema
    // closure carries. That agreement is why one entry is defensible and the
    // other two are not.
    expect(CATEGORY_TITLES['meta-spelling']).toBe('Meta-Spelling Vocabulary');
    expect(CATEGORY_TITLES['meta-spelling']).not.toContain('Protocol');
    expect(CATEGORY_TITLES.conversions).toContain('Protocol');
    expect(CATEGORY_TITLES.migrations).toContain('Protocol');
  });
});

describe('schemaClosureExemptionCoverage — an exemption may not outlive its condition', () => {
  const declared = { 'meta-spelling': 'because the tree says so' };
  const categories = ['data', 'meta-spelling', 'ui'];

  it('is clean when the declared category is on disk with no schema directory', () => {
    const coverage = schemaClosureExemptionCoverage(categories, ['data', 'ui'], declared);

    expect(coverage).toEqual({ stale: [], orphaned: [] });
    expect(schemaClosureExemptionsAreClean(coverage)).toBe(true);
  });

  it('reports an exemption whose json-schema directory has appeared', () => {
    // The category grew a closure, or the citation was never true. Either way
    // the exemption now hides a real reading, so it has to go.
    const coverage = schemaClosureExemptionCoverage(categories, ['data', 'meta-spelling', 'ui'], declared);

    expect(coverage.stale).toEqual(['meta-spelling']);
    expect(coverage.orphaned).toEqual([]);
    expect(schemaClosureExemptionsAreClean(coverage)).toBe(false);
  });

  it('reports an exemption whose module directory is gone', () => {
    const coverage = schemaClosureExemptionCoverage(['data', 'ui'], ['data', 'ui'], declared);

    expect(coverage.stale).toEqual([]);
    expect(coverage.orphaned).toEqual(['meta-spelling']);
    expect(schemaClosureExemptionsAreClean(coverage)).toBe(false);
  });

  it('does NOT report an absent, undeclared category — that is the warning, not an error', () => {
    // The direction deliberately left out. `conversions` here is absent from
    // the schema-dir list and absent from `declared`, and the coverage check
    // stays silent so `build-docs.ts` can print its warning instead of exiting.
    const coverage = schemaClosureExemptionCoverage(
      ['conversions', 'data', 'meta-spelling'],
      ['data'],
      declared,
    );

    expect(coverage).toEqual({ stale: [], orphaned: [] });
    expect(schemaClosureExemptionsAreClean(coverage)).toBe(true);
  });

  it('names the entry, the file to edit, and which direction fired', () => {
    const stale = formatSchemaClosureExemptionCoverage({ stale: ['meta-spelling'], orphaned: [] });
    expect(stale).toContain('meta-spelling');
    expect(stale).toContain('scripts/lib/schema-closure.ts');
    expect(stale).toContain('json-schema/meta-spelling/ now exists');

    const orphaned = formatSchemaClosureExemptionCoverage({ stale: [], orphaned: ['hub'] });
    expect(orphaned).toContain('packages/spec/src/hub/ is gone');
  });
});

describe('the caller — build-docs.ts, where the predicate has to be asked', () => {
  const BUILD_DOCS = read('scripts/build-docs.ts');

  it('emits the warning from exactly one place', () => {
    // Everything below is a claim about THAT site. A second emission would make
    // the pin describe half the behaviour while reading fully green.
    const sites = BUILD_DOCS.match(/Warning: Schema directory/g) ?? [];
    expect(sites).toHaveLength(1);
  });

  it('guards it with the predicate, so an undeclared absence still warns', () => {
    expect(BUILD_DOCS).toContain("from './lib/schema-closure'");
    expect(BUILD_DOCS).toMatch(
      /if \(!schemaClosureAbsenceIsDeclared\(category\)\) \{\s*\n\s*console\.log\(`Warning: Schema directory/,
    );
  });

  it('runs the both-directions coverage check on the same walk', () => {
    // The exemption is only safe because it expires: without this call a
    // declaration would outlive its condition silently, which is the failure
    // the map replaces rather than the one it introduces.
    expect(BUILD_DOCS).toContain('schemaClosureExemptionCoverage(Object.keys(CATEGORIES), categoriesWithSchemaDir)');
    expect(BUILD_DOCS).toContain('schemaClosureExemptionsAreClean(exemptions)');
  });
});
