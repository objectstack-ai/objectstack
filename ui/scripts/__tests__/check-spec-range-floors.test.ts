import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { RUNTIME_FIELDS } from '../check-phantom-dependencies.mjs';
import {
  MIN_FLOORED_PACKAGES,
  SPEC_PACKAGE,
  auditPackage,
  collectSpecUsage,
  compareVersions,
  declaredExportNames,
  FLOOR_VERSION,
  effectiveFloor,
  isNameableArtifact,
  lowestSatisfyingVersion,
  minVersionOf,
  replacementFloorLine,
  resolveExportTarget,
  specSubpathOf,
  specSubpathsFromLiterals,
  specSymbols,
  workspaceSpecVersion,
} from '../check-spec-range-floors.mjs';

// Plain-JS CI helper; its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here — unlike
// the 28 package-side carriers, whose `tsconfig.test.json` has `allowJs: false`
// and genuinely errors on this import (objectui#3494).
import { maskComments } from '../js-comment-mask.mjs';

// The annotation is NOT redundant under `allowJs`, and this was measured rather
// than assumed: `maskComments`'s JSDoc carries no `@param` tag (its neighbour
// `scanSource` does), so inference gives the parameter an implicit `any` and
// `maskComments(12345)` type-checks clean. Naming the signature here is what
// keeps the one call site below checked.
const mask: (source: string) => string = maskComments;

/**
 * objectui#5793 — a declared `@objectstack/spec` floor must carry every symbol
 * the declaring package's own published artifact references.
 *
 * The gate itself needs a full build and a registry fetch, so it runs on the
 * publish path and nightly (see `.github/workflows/spec-range-floors.yml`).
 * What runs per-PR is this file, and what it mostly pins is the ways this gate
 * could be GREEN ABOUT NOTHING — which is the entire failure mode of the defect
 * class it closes, where every existing check in the repository was already
 * green while `plugin-detail`'s published `.d.ts` re-exported a symbol its
 * declared floor does not have.
 *
 *  1. **Floors are computed, never assumed.** An unreadable range THROWS rather
 *     than defaulting to a permissive floor.
 *  2. **The export surface is read from the FETCHED manifest's `exports` map,
 *     under the `import` condition** — never resolved from `node_modules`,
 *     which is hoisted and would answer for 17.2.0 from every directory.
 *  3. **The UMD exclusion is guarded, not trusted**: a subpath that reaches
 *     consumers only through an unreadable bundle is a finding.
 *  4. **...and the guard reads string LITERALS, not text.** The first spelling
 *     scanned raw text and produced 30 findings, every one a doc comment.
 *  5. **`devDependencies` floors nothing**, and consumer-facing fields are
 *     derived from the sibling gate rather than retyped.
 *  6. **The vacuous verdict is RED**: a package that declares the spec and
 *     produced no artifact is a finding.
 *  7. **The gate is NOT wired into a per-PR job** — the objectui#4846 ruling.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GATE = 'scripts/check-spec-range-floors.mjs';

interface Finding {
  reason: string;
  pkg?: string;
  subpath?: string;
  symbol?: string;
  detail?: string;
}

const fixtures: string[] = [];
afterAll(() => {
  for (const dir of fixtures) fs.rmSync(dir, { recursive: true, force: true });
});

/** A stand-in for a fetched, parsed spec version. */
function fakeSpec(version: string, entries: Record<string, string[]>) {
  return {
    version,
    entryFor(subpath: string) {
      if (!(subpath in entries)) return null;
      return {
        target: `./dist${subpath === '.' ? '' : subpath}/index.d.mts`,
        path: ['import', 'types'],
        names: new Set(entries[subpath]),
        starFrom: [],
      };
    },
  };
}

const pkgOf = (name: string, manifest: Record<string, unknown> = {}) => ({
  name,
  dir: `packages/${name.split('/').pop()}`,
  manifest: { name, ...manifest },
});

/** Run `collectSpecUsage` over an in-memory artifact tree. */
const usageOf = (files: Record<string, string>) =>
  collectSpecUsage(Object.keys(files), (file: string) => files[file] ?? null);

// ── 1. floors are computed, and an unreadable range is a failure ─────────────

describe('the declared floor', () => {
  it('reads the caret ranges this workspace actually uses', () => {
    expect(minVersionOf('^17.0.0')).toBe('17.0.0');
    expect(minVersionOf('^17.1.0')).toBe('17.1.0');
    expect(minVersionOf('~17.2.0')).toBe('17.2.0');
    expect(minVersionOf('17.0.0')).toBe('17.0.0');
    expect(minVersionOf('=17.0.0')).toBe('17.0.0');
    expect(minVersionOf('>=17.1.0 <18.0.0')).toBe('17.1.0');
  });

  it('reads a PRERELEASE floor as that exact prerelease — the 18 line exists only as one', () => {
    // objectui#12334. The workspace declares `^18.0.0-next.N` since objectui#12030;
    // when this threw, no package counted as floored and the run stopped at the
    // collapse alarm, cancelling `pnpm changeset:publish`.
    expect(minVersionOf('^18.0.0-next.1')).toBe('18.0.0-next.1');
    expect(minVersionOf('~18.0.0-rc.2')).toBe('18.0.0-rc.2');
    expect(minVersionOf('18.0.0-next.1')).toBe('18.0.0-next.1');
    expect(minVersionOf('>=18.0.0-next.1 <19.0.0')).toBe('18.0.0-next.1');
    expect(FLOOR_VERSION.test('18.0.0-next.1')).toBe(true);
    expect(FLOOR_VERSION.test('18.0.0')).toBe(true);
    expect(FLOOR_VERSION.test('18.0.0-')).toBe(false);
    expect(FLOOR_VERSION.test('18.0.0-next.1+build.5')).toBe(false);
  });

  it('takes the LOWEST branch of a `||` union — a consumer may satisfy any one', () => {
    expect(minVersionOf('^17.1.0 || ^18.0.0')).toBe('17.1.0');
    expect(minVersionOf('^18.0.0 || ^17.0.0')).toBe('17.0.0');
  });

  it('THROWS on a range it does not read, rather than guessing a floor', () => {
    // The direction that matters. A range silently read as "floor 0.0.0" is
    // satisfied by every version ever published, and the gate goes green while
    // asserting nothing — which is precisely the state this card found.
    for (const range of ['*', '', 'latest', '>17.0.0', 'workspace:*', '^18.0.0-next.1+build.5', '^18.0.0-', '>18.0.0-next.1']) {
      expect(() => minVersionOf(range), range).toThrow();
    }
    // Reading a prerelease is not ORDERING one: the lowest branch of a union
    // is an ordering, so a union with a prerelease branch is still unread.
    expect(() => minVersionOf('^17.1.0 || ^18.0.0-next.1')).toThrow(/cannot order/);
    // An UPPER bound alone. Added because a mutation battery found it: every
    // range above is rejected while parsing a comparator, so none of them ever
    // reached the "parsed fine, named no floor" branch — and a mutation
    // returning '0.0.0' from that branch passed the whole suite. A range that
    // caps the version without flooring it is the one spelling that gets there.
    for (const range of ['<18.0.0', '<=18.0.0', '<18.0.0 <17.9.0']) {
      expect(() => minVersionOf(range), range).toThrow(/names no lower bound/);
    }
  });

  it('reads a workspace: range as the workspace spec\'s own version, and only when told it (objectstack ruling D1)', () => {
    // Inside the objectstack monorepo the ranges are `workspace:^`, which publishes as
    // `^<the spec's version>`: that version is the floor. Without the version the
    // spelling stays UNREADABLE (the loop above keeps `workspace:*` in its list),
    // because a workspace range read without its workspace has no floor at all.
    for (const range of ['workspace:*', 'workspace:^', 'workspace:~', 'workspace:']) {
      expect(minVersionOf(range, { workspaceVersion: '18.1.0' }), range).toBe('18.1.0');
      expect(() => minVersionOf(range), range).toThrow(/workspace package's own version/);
      expect(() => minVersionOf(range, { workspaceVersion: 'latest' }), range).toThrow(/is not one/);
    }
    // A range tail is that range, with or without the workspace version.
    expect(minVersionOf('workspace:^18.0.0-next.1')).toBe('18.0.0-next.1');
    expect(minVersionOf('workspace:~17.2.0', { workspaceVersion: '18.1.0' })).toBe('17.2.0');
    // Every non-workspace spelling reads exactly as before, version told or not.
    expect(minVersionOf('^17.0.0', { workspaceVersion: '18.1.0' })).toBe('17.0.0');
    expect(() => minVersionOf('latest', { workspaceVersion: '18.1.0' })).toThrow();
    // Through the declared floor: the workspace version takes part in "highest wins".
    const floor = effectiveFloor(
      { dependencies: { [SPEC_PACKAGE]: 'workspace:^' }, peerDependencies: { [SPEC_PACKAGE]: '^17.1.0' } },
      undefined,
      { workspaceVersion: '18.1.0' },
    );
    expect(floor?.version).toBe('18.1.0');
    expect(() => effectiveFloor({ dependencies: { [SPEC_PACKAGE]: 'workspace:^' } })).toThrow(/dependencies/);
  });

  it('finds the workspace spec\'s version in the nearest node_modules above the root, and null when none is installed', () => {
    const tree = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-range-floors-ws-'));
    try {
      expect(workspaceSpecVersion(tree)).toBeNull();
      fs.mkdirSync(path.join(tree, 'node_modules', SPEC_PACKAGE), { recursive: true });
      fs.writeFileSync(path.join(tree, 'node_modules', SPEC_PACKAGE, 'package.json'), JSON.stringify({ name: SPEC_PACKAGE, version: '18.1.0' }));
      expect(workspaceSpecVersion(tree)).toBe('18.1.0');
      // A nested tree (`ui/`) with no install of its own reads the one above it.
      fs.mkdirSync(path.join(tree, 'ui/packages'), { recursive: true });
      expect(workspaceSpecVersion(path.join(tree, 'ui'))).toBe('18.1.0');
      // This checkout resolves the installed spec, which is what a run reads by default.
      expect(workspaceSpecVersion(repoRoot)).toMatch(/^\d+\.\d+\.\d+/);
    } finally {
      fs.rmSync(tree, { recursive: true, force: true });
    }
  });

  it('is the HIGHEST minimum when several consumer-facing fields declare it', () => {
    const floor = effectiveFloor({
      dependencies: { [SPEC_PACKAGE]: '^17.0.0' },
      peerDependencies: { [SPEC_PACKAGE]: '^17.2.0' },
    });
    // A consumer install must satisfy both at once, so 17.0.0 is not admitted.
    expect(floor?.version).toBe('17.2.0');
    expect(floor?.ranges).toHaveLength(2);
  });

  it('takes a prerelease floor declared twice, and refuses two DIFFERENT ones rather than order them', () => {
    const same = effectiveFloor({
      dependencies: { [SPEC_PACKAGE]: '^18.0.0-next.1' },
      peerDependencies: { [SPEC_PACKAGE]: '^18.0.0-next.1' },
    });
    expect(same?.version).toBe('18.0.0-next.1');
    expect(() =>
      effectiveFloor({
        dependencies: { [SPEC_PACKAGE]: '^18.0.0-next.1' },
        peerDependencies: { [SPEC_PACKAGE]: '^18.0.0-next.2' },
      }),
    ).toThrow(/peerDependencies.*does not order prereleases/);
  });

  it('is null when only `devDependencies` declares it — that floors nobody', () => {
    expect(effectiveFloor({ devDependencies: { [SPEC_PACKAGE]: '^17.0.0' } })).toBeNull();
    // An artifact importing a dev-only dependency is a PHANTOM dependency,
    // which is `check-phantom-dependencies.mjs`'s finding and deliberately not
    // restated here.
    expect(RUNTIME_FIELDS).not.toContain('devDependencies');
  });

  it('derives the consumer-facing field list from the sibling gate', () => {
    // Retyping it is how two gates drift into covering different fields while
    // both stay green.
    const source = fs.readFileSync(path.join(repoRoot, GATE), 'utf8');
    expect(source).toContain("import { RUNTIME_FIELDS } from './check-phantom-dependencies.mjs'");
    expect(RUNTIME_FIELDS).toEqual(['dependencies', 'peerDependencies', 'optionalDependencies']);
  });

  it('surfaces an unreadable range by naming the field and the range', () => {
    expect(() => effectiveFloor({ dependencies: { [SPEC_PACKAGE]: 'latest' } })).toThrow(/dependencies/);
    expect(() => effectiveFloor({ dependencies: { [SPEC_PACKAGE]: 'latest' } })).toThrow(/latest/);
  });
});

// ── 2. what the artifact references ──────────────────────────────────────────

describe('the symbols an artifact takes from the spec', () => {
  it('maps a specifier to the `exports`-map spelling of its subpath', () => {
    expect(specSubpathOf(SPEC_PACKAGE)).toBe('.');
    expect(specSubpathOf(`${SPEC_PACKAGE}/ui`)).toBe('./ui');
    expect(specSubpathOf('@objectstack/spec-extras/ui')).toBeNull();
    expect(specSubpathOf('react')).toBeNull();
  });

  it('reads the IMPORTED name, never the local alias', () => {
    const { named } = specSymbols(
      `import { FeedFilterMode as Ln, FeedItemType } from '@objectstack/spec/data';`,
      'dist/index.js',
    );
    expect([...named.get('./data')!].sort()).toEqual(['FeedFilterMode', 'FeedItemType']);
    expect(named.get('./data')!.has('Ln')).toBe(false);
  });

  it('reads the exact shape objectui#5494 published — the defect in one file', () => {
    // packages/plugin-detail/dist/renderers/record-reference-rail.d.ts, verbatim.
    const { named } = specSymbols(
      [
        `import { ReferenceRailEntry } from '@objectstack/spec/ui';`,
        `export type { ReferenceRailEntry } from '@objectstack/spec/ui';`,
      ].join('\n'),
      'dist/renderers/record-reference-rail.d.ts',
    );
    expect([...named.get('./ui')!]).toEqual(['ReferenceRailEntry']);
  });

  it('covers type-only, `import()` type, and re-export forms', () => {
    const { named } = specSymbols(
      [
        `import type { ViewFilterRule } from '@objectstack/spec/ui';`,
        `export { defineView } from '@objectstack/spec/ui';`,
        `type X = import('@objectstack/spec/data').FeedFilterMode;`,
      ].join('\n'),
      'dist/a.d.ts',
    );
    expect([...named.get('./ui')!].sort()).toEqual(['ViewFilterRule', 'defineView']);
    expect([...named.get('./data')!]).toEqual(['FeedFilterMode']);
  });

  it('records a namespace import as a SUBPATH requirement naming no symbol', () => {
    const { named, subpaths } = specSymbols(`import * as spec from '@objectstack/spec/ui';`, 'dist/a.js');
    expect(subpaths.has('./ui')).toBe(true);
    expect(named.has('./ui')).toBe(false);
  });
});

// ── 3 & 4. the UMD exclusion is guarded, and the guard reads literals ────────

describe('the guard on the unreadable-bundle exclusion', () => {
  it('excludes minified UMD/CJS bundles and source maps from the name scan', () => {
    expect(isNameableArtifact('dist/index.d.ts')).toBe(true);
    expect(isNameableArtifact('dist/index.d.mts')).toBe(true);
    expect(isNameableArtifact('dist/index.js')).toBe(true);
    expect(isNameableArtifact('dist/index.umd.cjs')).toBe(false);
    expect(isNameableArtifact('dist/index.js.map')).toBe(false);
  });

  it('finds the subpaths a minified UMD still names, though no symbol survives', () => {
    // The real shape, from packages/plugin-detail/dist/index.umd.cjs.
    const umd = 'require("@object-ui/types"),require("@objectstack/spec/data")):typeof define==`function`&&define([`exports`,`@objectstack/spec/data`],t)';
    expect([...specSubpathsFromLiterals(umd, 'dist/index.umd.cjs')]).toEqual(['./data']);
  });

  it('does NOT fire on a doc comment — the 30 false findings the first spelling produced', () => {
    // Every one of these is real prose from this repository's `dist/*.d.ts`.
    const prose = [
      '/** Aligned with @objectstack/spec ReactionSchema. */',
      '// a `@objectstack/spec` `FieldType` name. `rich_text` was not one.',
      '/** Re-exported from `@objectstack/spec/data/object.zod.ts`, not restated. */',
      '/** @objectstack/spec/view is not an entry point that exists. */',
      'export declare const x: number;',
    ].join('\n');
    expect([...specSubpathsFromLiterals(prose, 'dist/a.js')]).toEqual([]);
  });

  it('reports a subpath reachable only through an unreadable bundle', () => {
    const usage = usageOf({
      'dist/index.umd.cjs': 'require("@objectstack/spec/kernel")',
      'dist/index.js': `import { defineView } from '@objectstack/spec/ui';`,
    });
    const spec = fakeSpec('17.0.0', { './ui': ['defineView'], './kernel': ['whatever'] });
    const { findings } = auditPackage(pkgOf('@object-ui/core'), usage, spec, '17.0.0') as { findings: Finding[] };
    expect(findings.map((f) => f.reason)).toEqual(['opaque-subpath']);
    expect(findings[0].subpath).toBe('./kernel');
  });

  it('says nothing when the ESM half already covers the subpaths the bundle names', () => {
    const usage = usageOf({
      'dist/index.umd.cjs': 'require("@objectstack/spec/data")',
      'dist/index.js': `import { FeedFilterMode } from '@objectstack/spec/data';`,
    });
    const spec = fakeSpec('17.0.0', { './data': ['FeedFilterMode'] });
    const { findings } = auditPackage(pkgOf('@object-ui/plugin-detail'), usage, spec, '17.0.0') as { findings: Finding[] };
    expect(findings).toEqual([]);
  });
});

// ── 5. the verdict itself ────────────────────────────────────────────────────

describe('the verdict', () => {
  const railUsage = () =>
    usageOf({
      'dist/renderers/record-reference-rail.d.ts': `export type { ReferenceRailEntry } from '@objectstack/spec/ui';`,
    });

  it('goes RED naming the symbol when the floor lacks it — objectui#5793 exactly', () => {
    const spec = fakeSpec('17.0.0', { './ui': ['ViewFilterRule', 'defineView'] });
    const { findings } = auditPackage(pkgOf('@object-ui/plugin-detail'), railUsage(), spec, '17.0.0') as {
      findings: Finding[];
    };
    expect(findings).toHaveLength(1);
    expect(findings[0].reason).toBe('floor-too-low');
    expect(findings[0].symbol).toBe('ReferenceRailEntry');
    expect(findings[0].subpath).toBe('./ui');
    // The finding must NAME the file, or the bump it justifies is unverifiable.
    expect(findings[0].detail).toContain('record-reference-rail.d.ts');
    expect(findings[0].detail).toContain('17.0.0');
  });

  it('goes GREEN once the floor carries it — the same usage, one version up', () => {
    const spec = fakeSpec('17.1.0', { './ui': ['ViewFilterRule', 'defineView', 'ReferenceRailEntry'] });
    const { findings } = auditPackage(pkgOf('@object-ui/plugin-detail'), railUsage(), spec, '17.1.0') as {
      findings: Finding[];
    };
    expect(findings).toEqual([]);
  });

  it('reports an entry point the floor does not publish at all', () => {
    const usage = usageOf({ 'dist/a.d.ts': `import { X } from '@objectstack/spec/studio';` });
    const spec = fakeSpec('17.0.0', { './ui': ['X'] });
    const { findings } = auditPackage(pkgOf('@object-ui/react'), usage, spec, '17.0.0') as { findings: Finding[] };
    expect(findings.map((f) => f.reason)).toEqual(['unknown-subpath']);
  });

  it('refuses to approve an entry whose own export set it cannot read', () => {
    const usage = usageOf({ 'dist/a.d.ts': `import { X } from '@objectstack/spec/ui';` });
    const spec = {
      version: '17.0.0',
      entryFor: () => ({ target: './dist/ui/index.d.mts', path: ['import'], names: new Set(['X']), starFrom: ['../chunk.mjs'] }),
    };
    const { findings } = auditPackage(pkgOf('@object-ui/react'), usage, spec, '17.0.0') as { findings: Finding[] };
    // `X` IS in `names`. The finding fires anyway, because a partially-read
    // export set cannot distinguish "exported" from "not seen yet".
    expect(findings.map((f) => f.reason)).toEqual(['unfollowable-star']);
  });

  it('says nothing about a package whose artifact never reaches for the spec', () => {
    // Over-declared is a different card; a floor with nothing behind it cannot
    // admit a version that lacks something.
    const spec = fakeSpec('17.0.0', {});
    const { findings } = auditPackage(pkgOf('@object-ui/mobile'), usageOf({ 'dist/a.js': 'export const a = 1;' }), spec, '17.0.0');
    expect(findings).toEqual([]);
  });

  it('names the lowest version that would satisfy the package, so a bump is justified', () => {
    const wanted = new Map([['./ui', new Map([['ReferenceRailEntry', ['dist/a.d.ts']]])]]);
    const load = (v: string) =>
      fakeSpec(v, { './ui': v === '17.0.0' ? ['other'] : ['other', 'ReferenceRailEntry'] });
    expect(lowestSatisfyingVersion(wanted, ['17.0.0', '17.1.0', '17.2.0'], load)).toBe('17.1.0');
    expect(lowestSatisfyingVersion(wanted, ['17.0.0'], load)).toBeNull();
  });

  it('names no replacement for a PRERELEASE floor, and never searches for one', () => {
    // Finding a replacement orders published versions against the floor, and
    // this gate does not order prereleases.
    const wanted = new Map([['./ui', new Map([['ReferenceRailEntry', ['dist/a.d.ts']]])]]);
    const load = () => {
      throw new Error('searched for a replacement of a prerelease floor');
    };
    const line = replacementFloorLine('@object-ui/plugin-detail', '18.0.0-next.1', wanted, ['17.7.0'], load);
    expect(line).toContain('18.0.0-next.1 is a prerelease');
    expect(line).not.toMatch(/"\^/);

    // A release floor keeps the search it always had.
    const found = replacementFloorLine('@object-ui/plugin-detail', '17.0.0', wanted, ['17.0.0', '17.1.0'], (v: string) =>
      fakeSpec(v, { './ui': v === '17.0.0' ? [] : ['ReferenceRailEntry'] }),
    );
    expect(found).toContain(`"${SPEC_PACKAGE}": "^17.1.0"`);
  });
});

// ── 6. the export surface is read from the fetched manifest, ESM half ────────

describe('reading the export surface of a published version', () => {
  it('walks the `exports` map under the `import` condition, never `require`', () => {
    // The real shape of `@objectstack/spec`'s map, trimmed.
    const exportsField = {
      './ui': {
        browser: {
          import: { types: './dist/ui/index.d.mts', default: './dist/browser/ui/index.mjs' },
          require: { types: './dist/ui/index.d.ts', default: './dist/browser/ui/index.js' },
        },
        import: { types: './dist/ui/index.d.mts', default: './dist/ui/index.mjs' },
        require: { types: './dist/ui/index.d.ts', default: './dist/ui/index.js' },
      },
    };
    const esm = resolveExportTarget(exportsField, './ui', ['import', 'types', 'default']);
    expect(esm).toEqual({ target: './dist/ui/index.d.mts', path: ['import', 'types'] });

    // The trap: `createRequire` reads a build no bundler puts in an app.
    const cjs = resolveExportTarget(exportsField, './ui', ['require', 'types', 'default']);
    expect(cjs!.target).toBe('./dist/ui/index.d.ts');
    expect(esm!.target).not.toBe(cjs!.target);

    expect(resolveExportTarget(exportsField, './nope', ['import', 'types'])).toBeNull();
  });

  it('reads the exported name out of a renaming chunk re-export, never the local one', () => {
    // Verbatim shape of `dist/ui/index.d.mts`: the spec's entries re-export
    // single-letter locals from content-hashed chunk files.
    const { names, starFrom } = declaredExportNames(
      [
        `export { A as ActionNavItem, b as ActionNavItemParsed } from '../app.zod-CH7IEmsS.mjs';`,
        `declare const ChartTypeSchema: unknown;`,
        `export { ChartTypeSchema };`,
        `export declare function defineView(): void;`,
        `export type ViewKind = 'list';`,
      ].join('\n'),
    );
    expect([...names].sort()).toEqual(['ActionNavItem', 'ActionNavItemParsed', 'ChartTypeSchema', 'ViewKind', 'defineView']);
    expect(names.has('A')).toBe(false);
    expect(starFrom).toEqual([]);
  });

  it('records an `export *` it cannot follow instead of dropping it', () => {
    const { starFrom } = declaredExportNames(`export * from '../chunk.mjs';`);
    expect(starFrom).toEqual(['../chunk.mjs']);
  });

  it('resolves nothing through `node_modules` — the hoisting trap, pinned in the source', () => {
    // Comments are stripped first, on purpose: the gate's header NAMES
    // `createRequire` and `require.resolve` to explain the trap, and a test
    // that could not tell an explanation from a call site would have to choose
    // between firing on the documentation and not existing.
    const source = fs.readFileSync(path.join(repoRoot, GATE), 'utf8');
    const code = mask(source);
    expect(code).toMatch(/loadPublishedSpec/);
    expect(code).not.toMatch(/createRequire|require\.resolve|import\.meta\.resolve/);
    expect(source).toContain('never through the installed tree');
  });

  it('orders plain releases and refuses prereleases', () => {
    expect(compareVersions('17.0.0', '17.1.0')).toBe(-1);
    expect(compareVersions('17.2.0', '17.10.0')).toBe(-1);
    expect(compareVersions('17.1.0', '17.1.0')).toBe(0);
    expect(() => compareVersions('17.0.0-rc.1', '17.0.0')).toThrow();
  });
});

// ── 7. the wiring: publish path yes, per-PR no ───────────────────────────────

describe('where the gate is wired', () => {
  const workflowDir = path.join(repoRoot, '.github/workflows');
  const rootManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  it('runs on the publish path, before a tarball can reach npm', () => {
    expect(rootManifest.scripts['changeset:publish']).toContain('check-spec-range-floors.mjs');
    expect(rootManifest.scripts['changeset:publish']).toMatch(/check-spec-range-floors\.mjs.*changeset publish/);
    expect(rootManifest.scripts['check:spec-floors']).toBe('node scripts/check-spec-range-floors.mjs');
  });

  it('is in NO workflow carrying a `pull_request` trigger — the objectui#4846 ruling', () => {
    // The criterion needs a full-repo build, and the 2026-08-16 ruling rejected
    // a per-PR full-repo build. This test is what stops it being added later by
    // someone who only sees a gate that "should" block PRs.
    for (const file of fs.readdirSync(workflowDir).filter((f) => f.endsWith('.yml'))) {
      const text = fs.readFileSync(path.join(workflowDir, file), 'utf8');
      if (!text.includes('check:spec-floors') && !text.includes('check-spec-range-floors')) continue;
      const triggers = text.slice(0, text.indexOf('\njobs:'));
      expect(triggers, `${file} must not run this gate on pull_request`).not.toMatch(/^\s*pull_request:/m);
    }
  });

  it('has a nightly alarm that builds before it reads', () => {
    const workflow = fs.readFileSync(path.join(workflowDir, 'spec-range-floors.yml'), 'utf8');
    expect(workflow).toMatch(/schedule:/);
    expect(workflow).toMatch(/turbo run build/);
    const buildAt = workflow.indexOf('turbo run build');
    const gateAt = workflow.indexOf('check:spec-floors');
    // Reading before building is the `no-artifact` verdict for the whole repo.
    expect(buildAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(buildAt);
  });

  it('keeps a collapse alarm under the population it actually has', () => {
    expect(MIN_FLOORED_PACKAGES).toBeGreaterThan(0);
    const manifests = fs
      .readdirSync(path.join(repoRoot, 'packages'))
      .map((dir) => path.join(repoRoot, 'packages', dir, 'package.json'))
      .filter((file) => fs.existsSync(file))
      .map((file) => JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, Record<string, string>>);
    const floored = manifests.filter((m) => RUNTIME_FIELDS.some((f) => m[f]?.[SPEC_PACKAGE]));
    expect(floored.length).toBeGreaterThanOrEqual(MIN_FLOORED_PACKAGES);
  });
});

// ── 8. the vacuous verdict is RED ────────────────────────────────────────────

describe('a prerelease floor is judged like any other', () => {
  /** One package declaring the spec at a prerelease floor, with one artifact. */
  function prereleaseCheckout(artifact: string) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-range-floors-pre-'));
    fixtures.push(root);
    fs.mkdirSync(path.join(root, 'packages/detail/dist'), { recursive: true });
    fs.writeFileSync(path.join(root, 'packages/detail/dist/index.d.ts'), artifact);
    const manifest = { name: '@object-ui/plugin-detail', dependencies: { [SPEC_PACKAGE]: '^18.0.0-next.1' } };
    return { root, packages: [{ name: manifest.name, dir: 'packages/detail', manifest }] };
  }

  it('fetches THAT prerelease and reds on a symbol it does not export', async () => {
    const { analyze } = await import('../check-spec-range-floors.mjs');
    const { root, packages } = prereleaseCheckout(`export type { ReferenceRailEntry } from '@objectstack/spec/ui';`);
    const asked: string[] = [];
    const result = analyze(root, {
      packages,
      load: (version: string) => {
        asked.push(version);
        return fakeSpec(version, { './ui': ['defineView'] });
      },
    }) as { findings: Finding[]; counters: { floored: number } };

    expect(asked).toEqual(['18.0.0-next.1']);
    expect(result.counters.floored).toBe(1);
    expect(result.findings.map((f) => `${f.reason} ${f.symbol}`)).toEqual(['floor-too-low ReferenceRailEntry']);
  });

  it('goes GREEN when that prerelease exports the symbol', async () => {
    const { analyze } = await import('../check-spec-range-floors.mjs');
    const { root, packages } = prereleaseCheckout(`export type { ReferenceRailEntry } from '@objectstack/spec/ui';`);
    const result = analyze(root, {
      packages,
      load: (version: string) => fakeSpec(version, { './ui': ['ReferenceRailEntry'] }),
    }) as { findings: Finding[] };
    expect(result.findings).toEqual([]);
  });

  it('still reports a range it cannot read, and does not count it as floored', async () => {
    const { analyze } = await import('../check-spec-range-floors.mjs');
    const { root, packages } = prereleaseCheckout('export {};');
    packages[0].manifest.dependencies[SPEC_PACKAGE] = '>18.0.0-next.1';
    const result = analyze(root, {
      packages,
      load: () => {
        throw new Error('the gate fetched a spec version for a range it could not read');
      },
    }) as { findings: Finding[]; counters: { floored: number } };
    expect(result.counters.floored).toBe(0);
    expect(result.findings.map((f) => f.reason)).toEqual(['unreadable-range']);
  });
});

describe('nothing to inspect is a FAILURE, not a pass', () => {
  it('reports a package that declares the spec and produced no build output', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-range-floors-'));
    fixtures.push(root);
    fs.mkdirSync(path.join(root, '.changeset'), { recursive: true });
    fs.writeFileSync(path.join(root, '.changeset/config.json'), JSON.stringify({ fixed: [['@object-ui/ghost']] }));
    fs.mkdirSync(path.join(root, 'packages/ghost'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'packages/ghost/package.json'),
      JSON.stringify({ name: '@object-ui/ghost', dependencies: { [SPEC_PACKAGE]: '^17.0.0' } }),
    );

    const { analyze } = await import('../check-spec-range-floors.mjs');
    const result = analyze(root, {
      // A load that would THROW if reached: the no-artifact verdict must be
      // decided before anything is fetched.
      load: () => {
        throw new Error('the gate fetched a spec version for a package with no artifacts');
      },
    }) as { findings: Finding[]; counters: { floored: number } };

    expect(result.counters.floored).toBe(1);
    expect(result.findings.map((f) => f.reason)).toEqual(['no-artifact']);
    expect(result.findings[0].detail).toContain('must never return');
  });
});
