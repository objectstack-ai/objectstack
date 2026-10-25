/**
 * Pin tests for `scripts/check-readme-exports.mjs` (objectui#5043).
 *
 * ## Why the planted mutations are in here and not in a prose paragraph
 *
 * The tree is GREEN AT REST: zero fabricated README imports when this landed,
 * and the intent is that there stay zero. So the gate's own run proves nothing
 * about whether it can FAIL, and "I planted a fake name and it caught it" in a
 * pull-request body proves it once and then stops being true. The card recorded
 * three method iterations that each looked right and each was measured wrong,
 * so the four discriminating directions live below as assertions.
 *
 * Recall alone is not enough, and that is the whole reason for the second one:
 *
 *   1. a fabricated name in a MULTI-LINE import block   -> must be REPORTED
 *   2. a fabricated name in a TRAILING `//` COMMENT     -> must NOT be reported
 *   3. `X as Y` where X is fabricated                   -> reported as X
 *   4. a fabricated name MID-BLOCK in a type import     -> must be REPORTED
 *
 * (2) is the false positive the second prototype produced; a gate tested only
 * for recall passes with it present and reddens correct documentation.
 *
 * ## And why there is a fixture tree rather than a scan of this repository
 *
 * The end-to-end verdict needs each package's DECLARED TYPE ENTRY on disk,
 * which for almost every package here is a built `dist/index.d.ts`. The test
 * shards run `pnpm install` and then `pnpm test` — they never build. A suite
 * that scanned this repository for its verdicts would therefore assert nothing
 * in CI while passing locally, which is this gate's own defect one directory
 * over. So the verdicts are asserted against a fixture tree that carries its
 * own hand-written `.d.ts` files, and the assertions about THIS repository
 * below are written to hold in both states and to say which one they are in.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REQUIRED_CONTEXTS } from '../dependabot-merge-gate.mjs';
import {
  CODE_LANGS,
  EXIT_CODES,
  FLOORS,
  MIN_PARTIAL_REASON,
  PARTIAL_EXCERPTS,
  PARTIAL_MARKER,
  PARTIAL_MARKER_EXAMPLE,
  extractCodeBlocks,
  findDocumentedTypes,
  findImportBindings,
  findPartialMarkers,
  packageDirOf,
  parseReadmeOverrides,
  renderList,
  scan,
  summarise,
  typeEntryOf,
} from '../check-readme-exports.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A throwaway `packages/` tree, written once and reused by every case below. */
function fixtureTree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-readme-exports-'));
  for (const [rel, body] of Object.entries(files)) {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
  return root;
}

const manifest = (name: string, types: string | null) =>
  `${JSON.stringify(types === null ? { name } : { name, exports: { '.': { types } } }, null, 2)}\n`;

/**
 * Alpha's export surface, written the way a real barrel is: the two names a
 * consumer sees come through a RE-EXPORT, so both are Alias symbols. That is
 * what makes the value/type flags a real assertion rather than a tautology —
 * reading flags off the alias reports every one of them as type-only, which is
 * what the prototype's first version did.
 */
const FIXTURE = {
  'packages/alpha/package.json': manifest('@fix/alpha', './dist/index.d.ts'),
  'packages/alpha/dist/inner.d.ts':
    'export declare const realValue: number;\n' + 'export interface RealShape { a: string }\n',
  'packages/alpha/dist/index.d.ts':
    "export { realValue, RealShape } from './inner.js';\n" + 'export declare function localFn(): void;\n',
  'packages/beta/package.json': manifest('@fix/beta', './dist/index.d.ts'),
  'packages/beta/dist/index.d.ts': 'export declare const ownedByBeta: string;\n',
};

const FIXTURE_PACKAGES = ['packages/alpha', 'packages/beta'];

const scanFixture = (root: string) =>
  scan(root, { readmes: ['packages/alpha/README.md'], packageDirs: FIXTURE_PACKAGES, floors: {} });

/**
 * The README shape this whole family uses, and the one that broke the regex:
 * a SIDE-EFFECT import, then twenty lines of prose, then a multi-line value
 * block with trailing comments, then a multi-line type block.
 */
const readme = (extraValue = '', extraType = '', trailingComment = '') => `# @fix/alpha

\`\`\`typescript
import '@fix/alpha';
\`\`\`

The registration above is the whole of it. There is no manual component map,
no \`alphaComponents\` record, and no \`AlphaSchema\` export to reach for; the
renderer resolves everything from the schema it is handed. Prose in this
paragraph mentions weeks, title, selection, target and dataSource on purpose —
a scan that reads an import clause by regex swallows all of it.

\`\`\`typescript
import {
  realValue, // the exported constant${trailingComment}
${extraValue}  localFn,
} from '@fix/alpha';
\`\`\`

\`\`\`ts
import type {
${extraType}  RealShape,
} from '@fix/alpha';
\`\`\`
`;

describe('extractCodeBlocks — the fence rules, because a lost block is a silent gap', () => {
  it('reads the info string and reports the opening fence line', () => {
    const blocks = extractCodeBlocks('intro\n\n```typescript\nconst a = 1;\n```\n');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ lang: 'typescript', startLine: 3, terminated: true });
    expect(blocks[0].body).toBe('const a = 1;');
  });

  it('lets a longer fence CONTAIN a shorter one, as CommonMark specifies', () => {
    const blocks = extractCodeBlocks('````md\n```ts\nimport { X } from "y";\n```\n````\n');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].lang).toBe('md');
    expect(blocks[0].body).toContain('```ts');
  });

  it('does not treat an info-carrying fence as a closer', () => {
    const blocks = extractCodeBlocks('```ts\na\n```\n\n```ts\nb\n```\n');
    expect(blocks.map((b) => b.body)).toEqual(['a', 'b']);
  });

  it('counts an unterminated fence rather than swallowing the rest of the file', () => {
    const blocks = extractCodeBlocks('```ts\nconst a = 1;\n');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].terminated).toBe(false);
  });

  it('normalises the language, so `TypeScript` and `ts` are both parsed', () => {
    expect(extractCodeBlocks('```TypeScript\na\n```\n')[0].lang).toBe('typescript');
    expect(CODE_LANGS).toContain('typescript');
    expect(CODE_LANGS).toContain('tsx');
  });
});

describe('findImportBindings — the traps the regex approach could not survive', () => {
  it('reads a multi-line block as ONE declaration, with a name per specifier', () => {
    const found = findImportBindings('import {\n  A,\n  B,\n} from "pkg";');
    expect(found.map((b) => b.exportName)).toEqual(['A', 'B']);
    expect(found.map((b) => b.line)).toEqual([2, 3]);
  });

  it('THE FALSE POSITIVE: a trailing comment can never contribute a name', () => {
    const found = findImportBindings('import {\n  A, // madeUpName is not real\n} from "pkg";');
    expect(found.map((b) => b.exportName)).toEqual(['A']);
  });

  it('judges the EXPORT name of `A as B`, never the local alias', () => {
    const [binding] = findImportBindings('import { madeUp as Real } from "pkg";');
    expect(binding.exportName).toBe('madeUp');
    expect(binding.local).toBe('Real');
  });

  it('reports a side-effect import as such — no clause means no name to judge', () => {
    const [binding] = findImportBindings('import "pkg";');
    expect(binding).toMatchObject({ kind: 'side-effect', exportName: null, specifier: 'pkg' });
  });

  it('THE ROOT CAUSE: a side-effect import cannot swallow the prose after it', () => {
    // The measured regex failure: a lazy quantifier starting at the `from`-less
    // import ran to the next `from "pkg"` and reported five words of prose as
    // fabricated import names.
    const found = findImportBindings(
      'import "pkg";\n\nweeks title selection target dataSource are prose\n\nimport { A } from "pkg";',
    );
    expect(found.map((b) => b.exportName)).toEqual([null, 'A']);
  });

  it('separates a namespace import, which names no export', () => {
    const [binding] = findImportBindings('import * as ns from "pkg";');
    expect(binding).toMatchObject({ kind: 'namespace', exportName: null });
  });

  it('carries the type-only flag from the clause and from the specifier', () => {
    expect(findImportBindings('import type { A } from "pkg";')[0].typeOnly).toBe(true);
    expect(findImportBindings('import { type A } from "pkg";')[0].typeOnly).toBe(true);
    expect(findImportBindings('import { A } from "pkg";')[0].typeOnly).toBe(false);
  });

  it('walks a re-export too — `export { X } from` names an export just as an import does', () => {
    const [binding] = findImportBindings('export { madeUp as Out } from "pkg";');
    expect(binding).toMatchObject({ exportName: 'madeUp', specifier: 'pkg' });
  });

  it('parses a tsx block without treating the JSX as a type assertion', () => {
    const found = findImportBindings('import { A } from "pkg";\nconst el = <A x={1} />;', { jsx: true });
    expect(found.map((b) => b.exportName)).toEqual(['A']);
  });
});

describe('the export surface is symbols, and aliases resolve before the flags are read', () => {
  const root = fixtureTree(FIXTURE);

  it('reads every export of the declared type entry, re-exports included', () => {
    const result = scanFixture(root);
    const alpha = result.packages.find((p) => p.name === '@fix/alpha');
    expect(alpha?.state).toBe('read');
    expect(alpha?.exportCount).toBe(3);
  });

  it('THE ALIAS TRAP: a re-exported VALUE keeps its Value flag', () => {
    // `export { realValue } from './inner.js'` is an Alias symbol carrying no
    // Value flag of its own. Reading flags off it marks every re-export in the
    // repository as type-only — the prototype's first version did exactly that.
    const result = scan(root, {
      readmes: ['packages/alpha/README.md'],
      packageDirs: FIXTURE_PACKAGES,
      readmeOverrides: { 'packages/alpha/README.md': writeReadme(root, readme()) },
      floors: {},
    });
    const byName = new Map(result.bindings.map((b) => [b.exportName, b]));
    expect(byName.get('realValue')).toMatchObject({ verdict: 'real', alias: true, isValue: true });
    expect(byName.get('RealShape')).toMatchObject({ verdict: 'real', alias: true, isType: true });
    expect(byName.get('localFn')).toMatchObject({ verdict: 'real', alias: false, isValue: true });
  });

  it('derives the type entry from the package, never assuming `dist/index.d.ts`', () => {
    // `@object-ui/test-support` really does point `exports['.'].types` at
    // `src/index.ts`; assuming the built path would call it unbuilt.
    const entry = typeEntryOf({ exports: { '.': { types: './src/index.ts' } } }, '/pkg');
    expect(entry.declared).toBe('./src/index.ts');
    expect(entry.path).toBe(path.join('/pkg', 'src/index.ts'));
    expect(typeEntryOf({ types: './t.d.ts' }, '/pkg').declared).toBe('./t.d.ts');
    expect(typeEntryOf({ name: 'x' }, '/pkg').declared).toBeNull();
  });

  it('resolves a nested README to the package that publishes it', () => {
    expect(packageDirOf(repoRoot, 'packages/types/src/zod/README.md')).toBe('packages/types');
    expect(packageDirOf(repoRoot, 'packages/types/README.md')).toBe('packages/types');
  });
});

/** Writes a README into the fixture's scratch space and returns its path. */
function writeReadme(root: string, body: string): string {
  const at = path.join(root, `readme-${Math.random().toString(36).slice(2)}.md`);
  fs.writeFileSync(at, body);
  return at;
}

describe('PLANTED MUTATIONS — the four directions, predicted before they were run', () => {
  const root = fixtureTree(FIXTURE);
  const run = (body: string) =>
    scan(root, {
      readmes: ['packages/alpha/README.md'],
      packageDirs: FIXTURE_PACKAGES,
      readmeOverrides: { 'packages/alpha/README.md': writeReadme(root, body) },
      floors: {},
    });

  it('BASELINE: the unmutated README is clean, so every red below is the mutation', () => {
    const result = run(readme());
    expect(result.findings).toEqual([]);
    expect(result.census.selfBindings).toBe(3);
    expect(result.census.real).toBe(3);
  });

  it('1. a fabricated name in a MULTI-LINE block is REPORTED', () => {
    const result = run(readme('  alphaThings,\n'));
    expect(result.findings.map((f) => `${f.verdict}:${f.exportName}`)).toEqual(['fabricated:alphaThings']);
  });

  it('2. a fabricated name in a TRAILING COMMENT is NOT reported', () => {
    // The direction a recall-only self-test cannot see.
    const result = run(readme('', '', ' — alphaComponents was never real'));
    expect(result.findings).toEqual([]);
    expect(result.census.real).toBe(3);
  });

  it('3. `X as Y` with X fabricated is reported as X, the EXPORT name', () => {
    const result = run(readme('  alphaThings as Things,\n'));
    expect(result.findings.map((f) => f.exportName)).toEqual(['alphaThings']);
    expect(result.findings.map((f) => f.local)).toEqual(['Things']);
  });

  it('4. a fabricated name MID-BLOCK in a multi-line TYPE import is REPORTED', () => {
    const result = run(readme('', '  AlphaSchema,\n'));
    expect(result.findings.map((f) => `${f.verdict}:${f.exportName}`)).toEqual(['fabricated:AlphaSchema']);
    expect(result.findings[0].typeOnly).toBe(true);
  });

  it('5. a REAL name owned by another package is WRONG-PATH, not fabricated', () => {
    // objectui#5010's `CalendarViewSchema`: the fix is the import path, and
    // telling the reader it is fabricated tells them to delete a real symbol.
    const result = run(readme('  ownedByBeta,\n'));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ verdict: 'wrong-path', exportName: 'ownedByBeta' });
    expect(result.findings[0].owners).toEqual(['@fix/beta']);
  });

  it('names the README LINE of the specifier, not of the `import {` above it', () => {
    const result = run(readme('  alphaThings,\n'));
    const body = readme('  alphaThings,\n').split('\n');
    expect(body[result.findings[0].line - 1]).toContain('alphaThings');
  });

  it('all four mutations at once are reported at once — no first-finding short circuit', () => {
    const result = run(readme('  alphaThings as Things,\n  ownedByBeta,\n', '  AlphaSchema,\n', ' — nope'));
    expect(result.findings.map((f) => `${f.verdict}:${f.exportName}`).sort()).toEqual([
      'fabricated:AlphaSchema',
      'fabricated:alphaThings',
      'wrong-path:ownedByBeta',
    ]);
  });
});

describe('a package whose types are not on disk FAILS — it never reads as "exports nothing"', () => {
  it('reports `unbuilt`, not a wall of fabricated names', () => {
    const root = fixtureTree({
      'packages/alpha/package.json': manifest('@fix/alpha', './dist/index.d.ts'),
      'packages/alpha/README.md': '```ts\nimport { realValue } from "@fix/alpha";\n```\n',
    });
    const result = scan(root, { readmes: ['packages/alpha/README.md'], packageDirs: ['packages/alpha'], floors: {} });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ verdict: 'unjudgeable', reason: 'unbuilt' });
    expect(result.census.fabricated).toBe(0);
    expect(result.census.packagesUnbuilt).toBe(1);
  });

  it('reports `no-type-entry` for a package that publishes no types at all', () => {
    const root = fixtureTree({
      'packages/alpha/package.json': manifest('@fix/alpha', null),
      'packages/alpha/README.md': '```ts\nimport { realValue } from "@fix/alpha";\n```\n',
    });
    const result = scan(root, { readmes: ['packages/alpha/README.md'], packageDirs: ['packages/alpha'], floors: {} });
    expect(result.findings[0]).toMatchObject({ verdict: 'unjudgeable', reason: 'no-type-entry' });
  });

  it('is SILENT about an unbuilt package whose README imports nothing from it', () => {
    // The failure is scoped to the case where the missing exports would have
    // changed a verdict; the count still appears in the census either way.
    const root = fixtureTree({
      'packages/alpha/package.json': manifest('@fix/alpha', './dist/index.d.ts'),
      'packages/alpha/README.md': '```ts\nimport { X } from "@other/pkg";\n```\n',
    });
    const result = scan(root, { readmes: ['packages/alpha/README.md'], packageDirs: ['packages/alpha'], floors: {} });
    expect(result.findings).toEqual([]);
    expect(result.census.packagesUnbuilt).toBe(1);
  });
});

describe('non-vacuity — the population refuses to collapse', () => {
  it('declares a floor for every counter a collapse would zero', () => {
    expect(Object.keys(FLOORS).sort()).toEqual(
      [
        'codeBlocks',
        'exportSymbols',
        'importBindings',
        'keysCompared',
        'packagesRead',
        'readmes',
        'selfBindings',
        'typeDeclarations',
        'typesResolved',
      ].sort(),
    );
  });

  it('reports every floor as breached when BOTH walks return nothing', () => {
    const result = scan(repoRoot, { readmes: [], packageDirs: [] });
    expect(result.vacuous.map((v) => v.counter).sort()).toEqual(Object.keys(FLOORS).sort());
    for (const v of result.vacuous) expect(v.value).toBe(0);
  });

  describe('the two walks breach INDEPENDENTLY', () => {
    // On the FIXTURE tree, not `repoRoot`, and that is the whole point of this
    // block. The claim is "collapse the README walk and only the README-side
    // floors breach", which needs the package-side walk to be HEALTHY so that
    // collapsing `readmes` is the only variable. Against `repoRoot` that
    // precondition is a property of the machine: the fixture carries
    // hand-written `.d.ts` files, while the test shards run `pnpm install` and
    // then `pnpm test` and never build, so on CI every `packages/*` type entry
    // is absent and the package-side floors breach too. Written against
    // `repoRoot` this test passed on a built checkout and RED on CI --
    // measured, on this branch's first CI run.
    //
    // The exact equality is deliberate and must stay exact. Loosening it to a
    // containment check would pass on a built tree AND an unbuilt one, which
    // is precisely the distinction this test exists to draw; it would assert
    // that these four breached without asserting that those two did not, and
    // the independence claim would be gone while the test still read green.
    const root = fixtureTree(FIXTURE);
    const at = writeReadme(root, readme());

    /** Fixture-scale floors: the repo's own numbers are three orders too big. */
    const floors = {
      readmes: 1,
      codeBlocks: 1,
      importBindings: 1,
      selfBindings: 1,
      packagesRead: 2,
      exportSymbols: 3,
    };

    const healthy = scan(root, {
      readmes: ['packages/alpha/README.md'],
      packageDirs: FIXTURE_PACKAGES,
      readmeOverrides: { 'packages/alpha/README.md': at },
      floors,
    });
    const collapsed = scan(root, { readmes: [], packageDirs: FIXTURE_PACKAGES, floors });

    it('breaches nothing while BOTH walks are healthy — the control leg', () => {
      // Without this, a green below could mean "the fixture is broken too".
      expect(healthy.vacuous).toEqual([]);
      expect(healthy.census.packagesRead).toBe(2);
      expect(healthy.census.selfBindings).toBe(3);
    });

    it('breaches the README-side floors ALONE when only that walk collapses', () => {
      expect(collapsed.vacuous.map((v) => v.counter).sort()).toEqual(
        ['codeBlocks', 'importBindings', 'readmes', 'selfBindings'].sort(),
      );
      for (const v of collapsed.vacuous) expect(v.value).toBe(0);
    });

    it('leaves the package-side counters untouched by that collapse', () => {
      // The other half of "independently": these two are read from the same
      // scan and are unchanged from the healthy leg.
      expect(collapsed.census.packagesRead).toBe(healthy.census.packagesRead);
      expect(collapsed.census.exportSymbols).toBe(healthy.census.exportSymbols);
      expect(collapsed.census.packagesRead).toBe(2);
      expect(collapsed.census.exportSymbols).toBe(4);
    });
  });

  it('puts the census in the verdict line, so a reader sees the population', () => {
    // Both walks overridden to empty, so this reads NOTHING off disk and its
    // verdict cannot depend on whether the checkout is built. It asserts the
    // SHAPE of the line, never a count.
    const line = summarise(scan(repoRoot, { readmes: [], packageDirs: [] }));
    expect(line).toContain('README(s) under packages/');
    expect(line).toContain('self-imports judged');
    expect(line).toContain('export symbol(s) read from');
  });

  it('names that population as TRACKED, so a green is not read as a claim about the directory (objectui#6545)', () => {
    // Both walks are `git ls-files -- packages/`. A brand-new
    // `packages/<pkg>/README.md` that has not been `git add`-ed is OUTSIDE the
    // population, and this gate reports OK without ever opening it -- measured:
    // planting an untracked `packages/<pkg>/README.md` left `census.readmes`
    // unchanged. The word is what stops a reader taking the count for a
    // statement about the directory. Same wording as check-control-bytes,
    // check-vi-mock-specifiers and check-vi-mock-inherit.
    const line = summarise(scan(repoRoot, { readmes: [], packageDirs: [] }));
    expect(line).toContain('tracked README(s) under packages/');
    expect(line).toContain('tracked package(s)');
  });
});

/**
 * ── THE INTERFACE PIN (objectui#6214) ────────────────────────────────────────
 *
 * Its own fixture tree, deliberately not `FIXTURE` above. Tier 1's independence
 * test asserts `exportSymbols` EXACTLY (`toBe(4)`), and that exactness is the
 * whole content of its claim, so adding exports to alpha to give this half
 * something to compare would have quietly turned that assertion into a number
 * nobody chose. A second tree costs one `mkdtemp`.
 *
 * The shapes are chosen for the distinctions the pin has to draw, not for
 * realism:
 *   `Widget`    a plain property list -- the ordinary case.
 *   `Themed`    EXTENDS `Widget`, so `all` and `own` differ and the two
 *               directions have to read different sets.
 *   `Handlers`  method signatures only, so a resolved declaration can still be
 *               compared over ZERO keys.
 *   `Mode`      a union alias -- a type with no properties at all.
 * Every one of them reaches the barrel through a RE-EXPORT, so the shape is
 * resolved through an Alias symbol exactly as it is for every real package.
 */
const PIN_FIXTURE = {
  'packages/pin/package.json': manifest('@fix/pin', './dist/index.d.ts'),
  'packages/pin/dist/shapes.d.ts':
    'export interface Widget { id: string; label?: string; hidden?: boolean }\n' +
    'export interface Themed extends Widget { color?: string }\n' +
    'export interface Handlers { run(): void; reset(): void }\n' +
    "export type Mode = 'a' | 'b';\n",
  'packages/pin/dist/index.d.ts': "export { Widget, Themed, Handlers, Mode } from './shapes.js';\n",
};

const PIN_PACKAGES = ['packages/pin'];
const PIN_README = 'packages/pin/README.md';

describe('findDocumentedTypes — what a block DECLARES, and what it deliberately does not count', () => {
  it('reads an `interface` and separates properties from methods', () => {
    const [found] = findDocumentedTypes('interface X {\n  a: string;\n  b?: number;\n  go(): void;\n}');
    expect(found).toMatchObject({ name: 'X', kind: 'interface', keys: ['a', 'b'], methods: ['go'], other: 0 });
  });

  it('reads `type X = { … }`, because READMEs use it for the same job', () => {
    const [found] = findDocumentedTypes('type X = { a: string };');
    expect(found).toMatchObject({ name: 'X', kind: 'type', keys: ['a'] });
  });

  it('does NOT read an alias that is not a property list', () => {
    // A union, a mapped type or a conditional makes no claim about a property
    // set, so treating it as an empty one would report every shipped key as
    // omitted -- a wall of false reds on a correct README.
    expect(findDocumentedTypes("type X = 'a' | 'b';")).toEqual([]);
    expect(findDocumentedTypes('type X = Partial<Y>;')).toEqual([]);
  });

  it('counts an index signature rather than reading it as a key', () => {
    const [found] = findDocumentedTypes('interface X {\n  a: string;\n  [k: string]: unknown;\n}');
    expect(found.keys).toEqual(['a']);
    expect(found.other).toBe(1);
  });

  it('does not walk into a nested declaration — an example’s own scaffolding is not a claim', () => {
    expect(findDocumentedTypes('function demo() {\n  interface Inner { a: string }\n  return null;\n}')).toEqual([]);
  });

  it('reports the line of the declaration WITHIN the block', () => {
    const found = findDocumentedTypes('const a = 1;\n\ninterface X { a: string }\n');
    expect(found[0].line).toBe(3);
  });
});

describe('findPartialMarkers — a marker that declares nothing is worse than no marker', () => {
  const withFences = (md: string) => findPartialMarkers(md, extractCodeBlocks(md));

  it('binds to the next fence across blank lines', () => {
    const md = 'prose\n\n<!-- readme-exports: partial Widget — the rest is in the guide -->\n\n```ts\ninterface Widget {}\n```\n';
    expect(withFences(md)).toEqual([{ line: 3, name: 'Widget', reason: 'the rest is in the guide', fence: 5 }]);
  });

  it('lets a RUN of markers sit above one block, because a block may declare two types', () => {
    const md =
      '<!-- readme-exports: partial Widget — the rest is in the guide -->\n' +
      '<!-- readme-exports: partial Themed — the rest is in the guide -->\n' +
      '```ts\ninterface Widget {}\ninterface Themed {}\n```\n';
    expect(withFences(md).map((m) => [m.name, m.fence])).toEqual([
      ['Widget', 3],
      ['Themed', 3],
    ]);
  });

  it('binds a marker stranded in prose to NOTHING, so it can be reported', () => {
    const md = '<!-- readme-exports: partial Widget — the rest is in the guide -->\nprose\n\n```ts\ninterface Widget {}\n```\n';
    expect(withFences(md)[0].fence).toBeNull();
  });

  it('accepts the em dash, the double hyphen and the colon, like FRAGMENT_MARKER', () => {
    for (const sep of ['—', '--', '-', ':']) {
      expect(PARTIAL_MARKER.test(`<!-- readme-exports: partial Widget ${sep} a reason of real length -->`)).toBe(true);
    }
  });

  it('publishes the marker as a spelled-out example that its own regex accepts', () => {
    // The example is what the failure message hands the reader. An example the
    // parser rejects is a gate telling someone to write something that will not
    // work, which is worse than printing nothing.
    expect(PARTIAL_MARKER.test(PARTIAL_MARKER_EXAMPLE)).toBe(true);
  });
});

describe('the interface pin — BOTH directions, because one of them is green for the wrong reason', () => {
  const root = fixtureTree(PIN_FIXTURE);
  const run = (body: string, excerpts: Record<string, string> = {}) =>
    scan(root, {
      readmes: [PIN_README],
      packageDirs: PIN_PACKAGES,
      readmeOverrides: { [PIN_README]: writeReadme(root, body) },
      floors: {},
      excerpts,
    });
  const block = (code: string) => `# @fix/pin\n\n\`\`\`ts\n${code}\n\`\`\`\n`;
  const kinds = (r: ReturnType<typeof scan>) => r.findings.map((f) => f.verdict);

  it('CONTROL: a correctly documented interface is `matches`, and nothing is reported', () => {
    // Without this leg every green below could just mean the walk found nothing.
    const result = run(block('interface Widget {\n  id: string;\n  label?: string;\n  hidden?: boolean;\n}'));
    expect(result.findings).toEqual([]);
    expect(result.documentedTypes).toHaveLength(1);
    expect(result.documentedTypes[0]).toMatchObject({ typeName: 'Widget', verdict: 'matches', shippedOwn: 3 });
    expect(result.census.keysCompared).toBe(6);
  });

  it('reports a FABRICATED key — one the shipped type does not have', () => {
    const result = run(block('interface Widget {\n  id: string;\n  label?: string;\n  hidden?: boolean;\n  icon?: string;\n}'));
    expect(kinds(result)).toEqual(['fabricated-key']);
    expect(result.findings[0]).toMatchObject({ typeName: 'Widget', keys: ['icon'] });
  });

  it('reports a STALE OMISSION — a shipped key the block never mentions', () => {
    const result = run(block('interface Widget {\n  id: string;\n  label?: string;\n}'));
    expect(kinds(result)).toEqual(['stale-omission']);
    expect(result.findings[0]).toMatchObject({ typeName: 'Widget', keys: ['hidden'] });
  });

  it('THE RENAME: reports the new spelling AND the old one, on the SAME declaration', () => {
    // This is the class the card records that the typed-example half cannot
    // reach: a property-level type error short-circuits the missing-property
    // detail, so compiling `const w: Widget = { caption: … }` reports the excess
    // key and never that `label` is gone. Neither direction alone reports a
    // rename either — that is what makes the pin bidirectional rather than
    // twice as strict.
    const result = run(block('interface Widget {\n  id: string;\n  caption?: string;\n  hidden?: boolean;\n}'));
    expect(kinds(result).sort()).toEqual(['fabricated-key', 'stale-omission']);
    const fabricated = result.findings.find((f) => f.verdict === 'fabricated-key');
    const stale = result.findings.find((f) => f.verdict === 'stale-omission');
    expect(fabricated).toMatchObject({ keys: ['caption'] });
    expect(stale).toMatchObject({ keys: ['label'] });
    expect(fabricated?.line).toBe(stale?.line);
  });

  describe('inheritance — the two directions read DIFFERENT sets, on purpose', () => {
    it('does not call a documented INHERITED key fabricated', () => {
      // `id` reaches `Themed` through `extends Widget`. Documenting it is
      // correct; judging the doc side against own-members-only would tell the
      // reader to delete a key their editor completes.
      const result = run(block('interface Themed {\n  color?: string;\n  id: string;\n}'));
      expect(result.findings).toEqual([]);
    });

    it('does not call an omitted INHERITED key stale', () => {
      // `Themed` documenting only its own `color` is complete. Judging the
      // shipped side against ALL properties would report `id`, `label` and
      // `hidden` on every excerpt of every type with a base -- measured on the
      // real tree at objectui#6214: 36 omissions on one declaration, most of
      // them inherited `BaseSchema` members.
      const result = run(block('interface Themed {\n  color?: string;\n}'));
      expect(result.findings).toEqual([]);
      expect(result.documentedTypes[0]).toMatchObject({ shippedOwn: 1, shippedAll: 4, verdict: 'matches' });
    });
  });

  it('skips METHODS on both sides, and SAYS SO rather than reading as verified', () => {
    const result = run(block('interface Handlers {\n  run(): void;\n}'));
    expect(result.findings).toEqual([]);
    expect(result.census.typesResolved).toBe(1);
    // The honest half: it resolved, and it compared nothing. A census that only
    // said "1 resolved" would read as a checked declaration.
    expect(result.census.typesComparedOverZeroKeys).toBe(1);
  });

  it('records a shipped name with no properties as `not-a-property-type`, never as an empty one', () => {
    const result = run(block('type Mode = { a: string };'));
    expect(result.findings).toEqual([]);
    expect(result.documentedTypes[0]).toMatchObject({ typeName: 'Mode', verdict: 'not-a-property-type' });
    expect(result.census.typesNotAShape).toBe(1);
  });

  it('leaves a name the package does not export alone — a README may declare a local helper', () => {
    const result = run(block('interface LocalOnly {\n  whatever: string;\n}'));
    expect(result.findings).toEqual([]);
    expect(result.documentedTypes[0]).toMatchObject({ typeName: 'LocalOnly', verdict: 'local-declaration' });
  });

  describe('declaring an excerpt — and the one thing neither mechanism may hide', () => {
    const partial = 'interface Widget {\n  id: string;\n  label?: string;\n}';

    it('the MARKER suppresses the omission it declares', () => {
      const body =
        '# @fix/pin\n\n<!-- readme-exports: partial Widget — the rest is in the guide -->\n' +
        `\`\`\`ts\n${partial}\n\`\`\`\n`;
      const result = run(body);
      expect(result.findings).toEqual([]);
      expect(result.census.partialDeclared).toBe(1);
    });

    it('the MARKER does NOT suppress a fabricated key', () => {
      // An excerpt may leave a key out. It may not invent one, and there is no
      // reading of "partial" under which it could.
      const body =
        '# @fix/pin\n\n<!-- readme-exports: partial Widget — the rest is in the guide -->\n' +
        '```ts\ninterface Widget {\n  id: string;\n  icon?: string;\n}\n```\n';
      expect(kinds(run(body))).toContain('fabricated-key');
    });

    it('a marker with no real reason declares nothing, and fails as such', () => {
      const body = '# @fix/pin\n\n<!-- readme-exports: partial Widget — wip -->\n' + `\`\`\`ts\n${partial}\n\`\`\`\n`;
      expect(kinds(run(body)).sort()).toEqual(['partial-marker-no-reason', 'stale-omission']);
      expect('wip'.length).toBeLessThan(MIN_PARTIAL_REASON);
    });

    it('a marker stranded in prose FAILS instead of silently declaring nothing', () => {
      const body =
        '# @fix/pin\n\n<!-- readme-exports: partial Widget — the rest is in the guide -->\nprose in between\n\n' +
        `\`\`\`ts\n${partial}\n\`\`\`\n`;
      expect(kinds(run(body)).sort()).toEqual(['stale-omission', 'stray-partial-marker']);
    });

    it('a marker over a COMPLETE declaration is stale, and fails — the rule is shrink-only', () => {
      const body =
        '# @fix/pin\n\n<!-- readme-exports: partial Widget — the rest is in the guide -->\n' +
        '```ts\ninterface Widget {\n  id: string;\n  label?: string;\n  hidden?: boolean;\n}\n```\n';
      expect(kinds(run(body))).toEqual(['stale-partial-marker']);
    });

    it('a marker names ONE interface, so the neighbour in the same block is still judged', () => {
      // `packages/plugin-kanban/README.md` declares two types in one block. A
      // marker that silenced a whole block would silence the one nobody looked
      // at, which is why the grammar carries the name.
      const body =
        '# @fix/pin\n\n<!-- readme-exports: partial Widget — the rest is in the guide -->\n' +
        '```ts\ninterface Widget {\n  id: string;\n}\ninterface Themed {\n  color?: string;\n  nope?: string;\n}\n```\n';
      const result = run(body);
      expect(kinds(result)).toEqual(['fabricated-key']);
      expect(result.findings[0]).toMatchObject({ typeName: 'Themed', keys: ['nope'] });
      expect(result.census.partialDeclared).toBe(1);
    });

    it('the LEDGER suppresses the omission it records', () => {
      const result = run(block(partial), { [`${PIN_README}::Widget`]: 'objectui#0000 -- a recorded reason' });
      expect(result.findings).toEqual([]);
      expect(result.census.partialLedgered).toBe(1);
    });

    it('the LEDGER does NOT suppress a fabricated key either', () => {
      const result = run(block('interface Widget {\n  id: string;\n  icon?: string;\n}'), {
        [`${PIN_README}::Widget`]: 'objectui#0000 -- a recorded reason',
      });
      expect(kinds(result)).toContain('fabricated-key');
    });

    it('a LEDGER entry that suppresses nothing FAILS as stale, so the list can only shrink', () => {
      const complete = block('interface Widget {\n  id: string;\n  label?: string;\n  hidden?: boolean;\n}');
      const result = run(complete, { [`${PIN_README}::Widget`]: 'objectui#0000 -- a recorded reason' });
      expect(kinds(result)).toEqual(['stale-excerpt-entry']);
    });

    it('a LEDGER entry naming a declaration that is not there FAILS too', () => {
      const result = run(block('interface Widget {\n  id: string;\n  label?: string;\n  hidden?: boolean;\n}'), {
        [`${PIN_README}::Gone`]: 'objectui#0000 -- names nothing',
      });
      expect(kinds(result)).toEqual(['stale-excerpt-entry']);
      expect(result.findings[0]).toMatchObject({ typeName: 'Gone' });
    });
  });

  it('an UNBUILT package is a FAILURE on this side too, never a serene `local-declaration`', () => {
    // The same rule as the import side, and the same reason: with no export
    // surface on disk every documented type resolves to nothing, so the pin
    // would report a clean green over blocks it never judged.
    const unbuilt = fixtureTree({ 'packages/pin/package.json': manifest('@fix/pin', './dist/index.d.ts') });
    const result = scan(unbuilt, {
      readmes: [PIN_README],
      packageDirs: PIN_PACKAGES,
      readmeOverrides: { [PIN_README]: writeReadme(unbuilt, block('interface Widget {\n  id: string;\n}')) },
      floors: {},
      excerpts: {},
    });
    expect(kinds(result)).toEqual(['unjudgeable-type']);
    expect(result.findings[0]).toMatchObject({ reason: 'unbuilt', typeName: 'Widget' });
    expect(result.census.typesUnjudgeable).toBe(1);
  });


  describe('the shrink-only rule is SUSPENDED where nothing was compared (objectui#6214, caught by CI)', () => {
    // The regression: "this entry suppressed no omission" has two causes that
    // are indistinguishable from the outside — the README caught up (stale,
    // delete it), or the declaration could not be judged at all (still true,
    // keep it). The first version reported both as `stale-excerpt-entry`, and
    // because the test shards run `pnpm install` then `pnpm test` and NEVER
    // build, CI took the second cause and printed the first verdict on all
    // three real ledger entries. On the fixture tree here, so the claim does
    // not depend on whether the machine happens to be built.
    const unbuiltRoot = fixtureTree({ 'packages/pin/package.json': manifest('@fix/pin', './dist/index.d.ts') });
    const partial = 'interface Widget {\n  id: string;\n  label?: string;\n}';
    const runUnbuilt = (body: string, excerpts: Record<string, string> = {}) =>
      scan(unbuiltRoot, {
        readmes: [PIN_README],
        packageDirs: PIN_PACKAGES,
        readmeOverrides: { [PIN_README]: writeReadme(unbuiltRoot, body) },
        floors: {},
        excerpts,
      });
    const entry = { [`${PIN_README}::Widget`]: 'objectui#0000 -- a recorded reason' };

    it('does not call a LEDGER entry stale when its declaration could not be judged', () => {
      const result = runUnbuilt(block(partial), entry);
      expect(kinds(result)).toEqual(['unjudgeable-type']);
      expect(result.findings.filter((f) => f.verdict === 'stale-excerpt-entry')).toEqual([]);
      expect(result.census.excerptsNotJudged).toBe(1);
    });

    it('does not call a MARKER stale either, for the same reason', () => {
      const body =
        '# @fix/pin\n\n<!-- readme-exports: partial Widget — the rest is in the guide -->\n' + `\`\`\`ts\n${partial}\n\`\`\`\n`;
      const result = runUnbuilt(body);
      expect(kinds(result)).toEqual(['unjudgeable-type']);
      expect(result.findings.filter((f) => f.verdict === 'stale-partial-marker')).toEqual([]);
      expect(result.census.excerptsNotJudged).toBe(1);
    });

    it('counts NOTHING when the unjudged declaration carries no excerpt at all', () => {
      // The census number must mean "claims this run could not check", not
      // "declarations this run could not judge" — `typesUnjudgeable` already
      // says the latter, and inflating this one would read as excerpt debt
      // that does not exist.
      const result = runUnbuilt(block(partial));
      expect(result.census.typesUnjudgeable).toBe(1);
      expect(result.census.excerptsNotJudged).toBe(0);
    });

    it('MUST-FAIL CONTROL: the same entry on a BUILT tree is still reported stale', () => {
      // Without this leg the three above would also pass if the suspension had
      // swallowed the shrink-only rule outright, which is the opposite defect
      // and the more expensive one — a ledger that can never shrink again.
      const complete = block('interface Widget {\n  id: string;\n  label?: string;\n  hidden?: boolean;\n}');
      const result = run(complete, entry);
      expect(kinds(result)).toEqual(['stale-excerpt-entry']);
      expect(result.census.excerptsNotJudged).toBe(0);
    });
  });

  describe('the pin walk breaches ITS floors independently of the import walk', () => {
    const floors = { packagesRead: 1, exportSymbols: 4, typeDeclarations: 1, typesResolved: 1, keysCompared: 4 };
    const healthy = scan(root, {
      readmes: [PIN_README],
      packageDirs: PIN_PACKAGES,
      readmeOverrides: {
        [PIN_README]: writeReadme(root, block('interface Widget {\n  id: string;\n  label?: string;\n  hidden?: boolean;\n}')),
      },
      floors,
      excerpts: {},
    });
    const noTypes = scan(root, {
      readmes: [PIN_README],
      packageDirs: PIN_PACKAGES,
      readmeOverrides: { [PIN_README]: writeReadme(root, '# @fix/pin\n\n```ts\nimport { Widget } from "@fix/pin";\n```\n') },
      floors,
      excerpts: {},
    });

    it('breaches nothing while both walks are healthy — the control leg', () => {
      expect(healthy.vacuous).toEqual([]);
      expect(healthy.census.typesResolved).toBe(1);
    });

    it('breaches the THREE pin floors alone when only the type walk finds nothing', () => {
      // Exact equality, for the reason tier 1's independence test states: a
      // containment check would assert that these three breached without
      // asserting that the package-side two did not.
      expect(noTypes.vacuous.map((v) => v.counter).sort()).toEqual(
        ['keysCompared', 'typeDeclarations', 'typesResolved'].sort(),
      );
      for (const v of noTypes.vacuous) expect(v.value).toBe(0);
    });

    it('leaves the package-side counters untouched by that collapse', () => {
      expect(noTypes.census.packagesRead).toBe(healthy.census.packagesRead);
      expect(noTypes.census.exportSymbols).toBe(healthy.census.exportSymbols);
      expect(noTypes.census.selfBindings).toBe(1);
    });
  });
});

/**
 * The build state of THIS repository: the per-package split every assertion
 * below partitions by, and one line naming it, fit to end an assertion message.
 *
 * objectui#7460. The three cases underneath used to split the tree with the
 * whole-tree boolean `census.packagesUnbuilt === 0`, one leg for "built" and one
 * for "unbuilt". A PARTLY built tree is a third state neither leg describes, and
 * it is not exotic — it is what another gate's own printed command produces:
 *
 *   pnpm exec turbo run build $(node scripts/check-doc-snippet-types.mjs --build-filter) --concurrency=2
 *
 * That filter covers, by design, only the packages the documents IT judges
 * import (26 of 40 here), so "run the doc gate, then run the tests that read it"
 * lands there. In it the unbuilt leg judged a mostly-built tree and two cases
 * failed with `expected false to be true` and `expected +0 to be 3` — naming
 * neither the counter nor the state, under titles promising the assertion held
 * in every state. Measured cost: one round, spent suspecting the diff under test.
 *
 * Both halves of that are fixed, and they are separate fixes:
 *
 *   the SPLIT    is now per PACKAGE, which is the split the gate itself already
 *                uses (see "THE SHRINK-ONLY RULE IS SUSPENDED WHERE NOTHING WAS
 *                COMPARED" in check-readme-exports.mjs). It is not a second
 *                build-state semantics, and it enumerates no states: built,
 *                unbuilt and every mix fall out of one rule, so there is no
 *                fourth state left to be surprised by. Measured while writing
 *                this: there WAS a fourth. `packages/plugin-tree` is unbuilt
 *                with zero README self-imports, so on a tree with only it
 *                unbuilt the old "the gate must FAIL" line reddened a correct
 *                tree — a second break in the same leg, from the same cause.
 *   the MESSAGE  names `census.packagesUnbuilt` and the packages behind it, and
 *                says outright that the state is not the cause — because after
 *                the split above it cannot be. That is the half that buys the
 *                round back, and it is owed even on assertions needing no leg.
 */
function buildState(result: ReturnType<typeof scan>) {
  const unbuilt = result.packages.filter((p) => p.state === 'unbuilt');
  const dirs = unbuilt.map((p) => p.dir).sort();
  const unbuiltDirs = new Set(dirs);
  return {
    unbuiltDirs,
    unbuiltNames: new Set(unbuilt.map((p) => p.name)),
    /** A package dir the walk could not resolve is not "unbuilt" — it is absent. */
    isUnbuilt: (dir: string | null) => dir !== null && unbuiltDirs.has(dir),
    note:
      `build state: census.packagesUnbuilt = ${result.census.packagesUnbuilt} of ` +
      `${result.census.packages} packages (${result.census.packagesRead} read, ` +
      `${result.census.packagesNoTypeEntry} declare no type entry)` +
      (dirs.length ? `; unbuilt: ${dirs.join(', ')}` : '') +
      '. Every assertion in this case is written per PACKAGE and holds on a built, ' +
      'an unbuilt and a partly built tree alike, so reaching this message means a ' +
      'real disagreement — NOT that you built the wrong subset of the tree.',
  };
}

/**
 * Every DECLARED excerpt in this repository whose own package is UNBUILT — the
 * exact population whose shrink-only rule the gate suspends, and therefore the
 * exact number `census.excerptsNotJudged` has to come back as.
 *
 * objectui#7302. This used to be spelled `Object.keys(PARTIAL_EXCERPTS)`
 * filtered by build state — the LEDGER half, alone. That was complete only
 * while every excerpt in the tree was a ledger entry. The moment a content fix
 * moved one to the in-README `PARTIAL_MARKER` — which is the disposition a
 * GENUINE excerpt is meant to end at, and the ledger's own reason said so —
 * the two assertions below expected 0 where the gate counted 1, and they went
 * red on CI: on the UNBUILT tree the shards run, which is the only state this
 * can fire in. The gate counts BOTH mechanisms in that one counter, on purpose
 * and in one sentence of its header ("BOTH suppress `stale-omission` ... both
 * are counted as `not judged` in the census"), so both belong in the
 * expectation, under the same per-PACKAGE rule the rest of these cases use.
 *
 * DERIVED FROM THE READMEs, never from the counter under test: the ledger half
 * from the exported literal, the marker half by re-reading each README of an
 * unbuilt package through the gate's own exported grammar. So these assertions
 * still cross-check the gate against something that is not the gate's count.
 *
 * The marker half is the population of the gate's `excerptFor` map — a marker
 * that BINDS a fence and carries a long enough reason — restricted to unbuilt
 * packages, and it deliberately does not re-parse the block to confirm the type
 * is declared there: a bound marker whose fence declares no type of that name
 * is reported `stale-partial-marker` in EVERY build state, and the case below
 * asserts there are none of those. Keyed the way the gate keys it
 * (`<fence>::<Name>`, per README), so a repeated marker collapses here exactly
 * as it collapses there.
 */
function suspendedExcerpts(
  result: ReturnType<typeof scan>,
  excerpts: Readonly<Record<string, string>> = PARTIAL_EXCERPTS,
) {
  const { isUnbuilt } = buildState(result);
  const ledger = Object.keys(excerpts).filter((key) =>
    isUnbuilt(packageDirOf(repoRoot, key.split('::')[0])),
  );
  /** `<readme>::<fence>::<Name>` -> `<readme>::<Name>`, the form a finding is at. */
  const markers = new Map<string, string>();
  for (const record of result.packages) {
    if (record.state !== 'unbuilt') continue;
    for (const readme of record.readmes as string[]) {
      const markdown = fs.readFileSync(path.join(repoRoot, readme), 'utf8');
      for (const marker of findPartialMarkers(markdown, extractCodeBlocks(markdown))) {
        if (marker.fence === null || marker.reason.length < MIN_PARTIAL_REASON) continue;
        markers.set(`${readme}::${marker.fence}::${marker.name}`, `${readme}::${marker.name}`);
      }
    }
  }
  return {
    ledger,
    markers: [...markers.keys()],
    /** Where each suspended marker must be REPORTED, in a finding's `<file>::<Name>` form. */
    markerSites: [...new Set(markers.values())],
    all: [...ledger, ...markers.keys()],
  };
}

describe('the PARTIAL_EXCERPTS ledger, as it stands in this repository', () => {
  it('is keyed `<readme>::<InterfaceName>` and every entry carries a card number', () => {
    for (const [key, reason] of Object.entries(PARTIAL_EXCERPTS)) {
      expect(key).toMatch(/^packages\/[^:]+\/README\.md::[A-Za-z_$][A-Za-z0-9_$]*$/);
      expect(reason).toMatch(/objectui#\d+/);
      expect(reason.length).toBeGreaterThanOrEqual(MIN_PARTIAL_REASON);
    }
  });

  it('hides ONLY omissions, at every declaration the tree can judge — in ANY build state', () => {
    // Turning the ledger OFF must red, and every red must sit at a declaration
    // the ledger names -- so the ledger is provably not covering a fabricated
    // key or anything else.
    //
    // WHICH red is decided by the declaration's OWN package, never by the tree:
    // built, and it is a `stale-omission`; unbuilt, and there is no export
    // surface to compare against, so it is `unjudgeable-type` -- the FAILURE
    // tier 1's rule requires and not a skip. That per-declaration rule is the
    // gate's own; see `buildState` above for why the whole-tree boolean this
    // replaces was wrong (objectui#7460).
    const off = scan(repoRoot, { excerpts: {} });
    const { unbuiltNames, isUnbuilt, note } = buildState(off);
    const at = (f: { file: string; typeName?: string | null }) => `${f.file}::${f.typeName}`;
    const ledgered = Object.keys(PARTIAL_EXCERPTS);
    const packageOfEntry = (key: string) => packageDirOf(repoRoot, key.split('::')[0]);
    const judgeable = new Set(ledgered.filter((key) => !isUnbuilt(packageOfEntry(key))));
    const suspendable = ledgered.filter((key) => isUnbuilt(packageOfEntry(key)));

    // THE LEDGER IS EMPTY TODAY, and this line is what says so out loud.
    // objectui#7302 paid off the three entries objectui#6214 opened with, and
    // the guard that stood here (`expect(ledgered.length).toBeGreaterThan(0)`,
    // "the ledger is empty, so this case asserts nothing") went red on that
    // content fix. It was right to: the per-ENTRY leg below does stop asserting
    // when there is no entry. But this case does NOT go vacuous with it --
    // `judgeable` becomes the empty set, so the equality two blocks down reads
    // "NO declaration in this tree reds as a stale omission with the ledger
    // off", which is the strongest state this repository can be in and reds on
    // the next README that drifts.
    //
    // So the guard is replaced by the FACT, asserted rather than assumed: an
    // entry arriving flips this line, in the same file that explains what the
    // entry then has to satisfy. The per-entry property itself never depended
    // on the repository carrying an entry -- it is pinned on the fixture tree
    // above ('the LEDGER suppresses the omission it records', 'the LEDGER does
    // NOT suppress a fabricated key either', and the two stale-entry cases),
    // which carry an entry by construction and cannot be emptied by a content
    // card.
    expect(
      ledgered,
      'the ledger is no longer empty -- flip this assertion to the entries and re-read the case above it',
    ).toEqual([]);

    const omissions = off.findings.filter((f) => f.verdict === 'stale-omission');
    const suspended = off.findings.filter((f) => f.verdict === 'unjudgeable-type');

    // Every entry the tree CAN judge reds as a stale omission with the ledger
    // off, and nothing else does -- which is what "hides ONLY omissions" means.
    // On a fully built tree `judgeable` is the whole ledger, so this is exactly
    // the assertion the old built leg made.
    expect(
      new Set(omissions.map(at)),
      `with the ledger OFF the stale-omission set is no longer exactly the ledger entries this tree can judge. ${note}`,
    ).toEqual(judgeable);

    // Every entry it CANNOT judge is REPORTED `unjudgeable-type`, not skipped.
    // On a completely unbuilt tree that is the whole ledger, so this is exactly
    // the assertion the old unbuilt leg made.
    expect(
      suspendable.filter((key) => !suspended.some((f) => at(f) === key)),
      `a ledger entry whose package is unbuilt was not reported \`unjudgeable-type\` -- a suspended rule must still FAIL. ${note}`,
    ).toEqual([]);

    // ...and each verdict is the one its own package earns.
    expect(
      suspended.filter((f) => !unbuiltNames.has(f.package)).map(at),
      `\`unjudgeable-type\` at a declaration whose package IS built -- the gate lost an export surface it has. ${note}`,
    ).toEqual([]);
    expect(
      off.findings
        .filter((f) => !['stale-omission', 'unjudgeable-type', 'unjudgeable'].includes(f.verdict))
        .map((f) => `${f.verdict} at ${at(f)}`),
      `unexpected verdict with the ledger OFF. ${note}`,
    ).toEqual([]);
    expect(
      off.findings.filter((f) => f.verdict === 'unjudgeable' && !unbuiltNames.has(f.package)).map(at),
      `\`unjudgeable\` self-import in a package that IS built. ${note}`,
    ).toEqual([]);

    // With the ledger OFF there is nothing for the sweep to call stale, so this
    // case cannot see the objectui#6214 regression on its own — the one in the
    // `repo state` block below, with the ledger ON, is the leg that does.
    // Stated so the pair is not mistaken for one assertion twice.
    //
    // NOT zero, and that is objectui#7302's correction. `excerpts: {}` turns
    // the LEDGER off, and the ledger is the only half it can turn off: a
    // README's `PARTIAL_MARKER` lives in the README, so it still declares an
    // excerpt in this scan, and on an unbuilt package it is still suspended and
    // still counted. The hard-coded 0 was quietly asserting "this repository
    // declares no excerpt by marker" under a title about the ledger, and it
    // went red the first time one did — on CI's unbuilt tree, the only build
    // state in which the marker half of this counter can be non-zero.
    const suspendedOff = suspendedExcerpts(off, {});
    expect(
      off.census.excerptsNotJudged,
      `with the LEDGER OFF the suspension count is not the number of MARKER-declared excerpts whose own package is unbuilt (${suspendedOff.markers.join(', ') || 'none'}). ${note}`,
    ).toBe(suspendedOff.markers.length);

    // ...and every one of those is REPORTED `unjudgeable-type`, exactly as a
    // ledger entry is three blocks up. A suspended rule must still FAIL, and
    // which mechanism declared the excerpt does not change that.
    expect(
      suspendedOff.markerSites.filter((key) => !suspended.some((f) => at(f) === key)),
      `a marker-declared excerpt whose package is unbuilt was not reported \`unjudgeable-type\` -- a suspended rule must still FAIL. ${note}`,
    ).toEqual([]);
  });
});

describe('repo state — assertions that hold in EVERY build state: built, unbuilt, or a mix', () => {
  const result = scan(repoRoot);
  const { unbuiltDirs, unbuiltNames, note } = buildState(result);

  it('walked the tree: READMEs, fenced blocks and import bindings were all found', () => {
    // These three need no `dist/`, so they assert in the test shards too.
    expect(result.census.readmes).toBeGreaterThanOrEqual(FLOORS.readmes);
    expect(result.census.codeBlocks).toBeGreaterThanOrEqual(FLOORS.codeBlocks);
    expect(result.census.importBindings).toBeGreaterThanOrEqual(FLOORS.importBindings);
    expect(result.census.readmesOrphaned).toBe(0);
  });

  it('finds no fabricated or wrong-path import where it can judge, and never passes silently where it cannot', () => {
    // `pnpm test` never builds, so CI reads an unbuilt tree; a local `turbo run
    // build` gives a built one; the doc gate's own printed `--build-filter`
    // command gives a mix. What varies across all three is per PACKAGE, so that
    // is what is asserted -- see `buildState` above for why the whole-tree
    // boolean this replaces was wrong (objectui#7460).
    //
    // The could-not-judge class has TWO verdicts since objectui#6214 added the
    // interface pin: `unjudgeable` for a self-import and `unjudgeable-type` for
    // a documented type. Both mean the same single thing — the package's export
    // surface is not on disk — so both are excluded here, exactly as the one
    // did before. This is the filter being kept correct as a new member of the
    // class arrived, NOT an exemption widened to make a red go green: the
    // assertions below still require an unjudgeable package to FAIL.
    const CANNOT_JUDGE = ['unjudgeable', 'unjudgeable-type'];
    const judged = result.findings.filter((f) => !CANNOT_JUDGE.includes(f.verdict));

    // Stood in BOTH legs of the old branch, so it needs no leg: nothing may
    // carry a verdict this tree could not have reached.
    expect(judged, `unexpected README drift: ${JSON.stringify(judged, null, 2)}. ${note}`).toEqual([]);

    // The specific regression these two lines exist for (objectui#6214, caught by
    // `Test (shard 2/4)`): the three `PARTIAL_EXCERPTS` entries came back
    // `stale-excerpt-entry` on CI, because they had suppressed nothing — and
    // they had suppressed nothing only because NOTHING WAS COMPARED. Named
    // explicitly rather than left to the `toEqual([])` above, so a future
    // reader sees which verdict must never appear here and why.
    expect(
      result.findings.filter((f) => f.verdict === 'stale-excerpt-entry'),
      `a ledger entry was called stale. ${note}`,
    ).toEqual([]);
    expect(
      result.findings.filter((f) => f.verdict === 'stale-partial-marker'),
      `a README marker was called stale. ${note}`,
    ).toEqual([]);

    // ...and the number of DECLARED excerpts whose shrink-only rule is
    // SUSPENDED is the number whose own package is unbuilt: all of them on CI,
    // none of them on a built tree, and in between in between. Two different
    // cards have corrected this one line, and the second is why it reads as it
    // does now rather than as a literal:
    //
    //   objectui#7460  it hard-coded `Object.keys(PARTIAL_EXCERPTS).length`,
    //                  which is only the CI answer — the line that failed
    //                  `expected +0 to be 3` on a half-built tree.
    //   objectui#7302  it then counted only the LEDGER half of the population
    //                  the gate counts. The first in-README `PARTIAL_MARKER` to
    //                  land made it expect 0 against a gate reporting 1, red on
    //                  `Test (shard 2/4)` and green on every built tree.
    //
    // See `suspendedExcerpts` for why the marker half is derived from the
    // README bytes rather than read back off the counter it checks.
    const suspended = suspendedExcerpts(result);
    expect(
      result.census.excerptsNotJudged,
      `the suspension count is not the number of DECLARED excerpts whose own package is unbuilt (ledger: ${suspended.ledger.join(', ') || 'none'}; marker: ${suspended.markers.join(', ') || 'none'}). ${note}`,
    ).toBe(suspended.all.length);

    // An unbuilt package must be REPORTED, never silently skipped. That is the
    // rule that makes this gate's never-built CI run FAIL instead of passing
    // vacuously, and stated per package it survives a mix.
    for (const record of result.packages) {
      if (record.state !== 'unbuilt') continue;
      const reported = result.bindings.filter(
        (b) => b.package === record.name && b.verdict === 'unjudgeable',
      ).length;
      expect(
        reported,
        `${record.dir} is unbuilt, so all ${record.selfBindings} of its README self-imports must be reported \`unjudgeable\`; ${reported} were. ${note}`,
      ).toBe(record.selfBindings);
    }

    // The whole-tree corollary, stated where it is TRUE. `check-readme-exports.mjs`
    // exits 0 only on an empty `findings` AND an empty `vacuous`, so "reported"
    // and "the gate fails" are one statement. The old form asserted this of any
    // tree with `packagesUnbuilt > 0`, which is NOT sound and was the same leg's
    // second break: `packages/plugin-tree` is unbuilt carrying zero README
    // self-imports and no documented type, so a tree with only it unbuilt has
    // nothing to report and passes correctly.
    const unjudgeableWork =
      result.packages
        .filter((p) => p.state === 'unbuilt')
        .reduce((n, p) => n + p.selfBindings, 0) +
      result.documentedTypes.filter((d) => unbuiltNames.has(d.package)).length;
    if (unjudgeableWork > 0) {
      expect(
        result.findings.length + result.vacuous.length,
        `${unjudgeableWork} README binding(s)/declaration(s) sit in an unbuilt package, so the gate must FAIL (unjudgeable self-imports and/or a breached floor), never report OK. ${note}`,
      ).toBeGreaterThan(0);
    }

    // Floors. `selfBindings` needs no `dist/` and so is asserted everywhere; the
    // export surface and the `vacuous` collapse sweep are about what was READ,
    // and are asserted where the whole tree was.
    expect(result.census.selfBindings).toBeGreaterThanOrEqual(FLOORS.selfBindings);
    if (result.census.packagesUnbuilt === 0) {
      expect(result.census.exportSymbols).toBeGreaterThanOrEqual(FLOORS.exportSymbols);
      expect(result.vacuous, `the population collapsed on a fully built tree. ${note}`).toEqual([]);
    }
  });

  it('judges the packages the card named, wherever the tree has built them', () => {
    const judgedIn = [
      ...new Set(
        result.bindings.filter((b) => b.verdict === 'real').map((b) => b.file.split('/').slice(0, 2).join('/')),
      ),
    ];
    // The seven packages the manual sweep hit (objectui#5010-#5016). A package
    // that is not built cannot be judged, so it is excused BY NAME rather than
    // by the whole case returning early on a whole-tree boolean: on the
    // half-built tree the early return stopped this case asserting anything at
    // all about the 34 packages that WERE built (objectui#7460).
    for (const pkg of ['plugin-calendar', 'plugin-form', 'plugin-gantt', 'plugin-grid', 'plugin-view', 'plugin-dashboard', 'plugin-report']) {
      const dir = `packages/${pkg}`;
      if (unbuiltDirs.has(dir)) {
        // Excused, and the excuse is checked against the census rather than
        // taken on trust.
        expect(result.census.packagesUnbuilt, note).toBeGreaterThan(0);
        continue;
      }
      expect(judgedIn, `${pkg}'s README is no longer being judged. ${note}`).toContain(dir);
    }
  });
});

describe('the --readme override, which is what keeps the self-test off the working tree', () => {
  it('parses a `<readme>=<path>` pair', () => {
    expect(parseReadmeOverrides(['--readme', 'packages/a/README.md=/tmp/x.md'])).toEqual({
      'packages/a/README.md': '/tmp/x.md',
    });
  });

  it('refuses a bare path rather than guessing which README it replaces', () => {
    expect(() => parseReadmeOverrides(['--readme', '/tmp/x.md'])).toThrow(/readmePath/);
  });
});

/**
 * `--list` on an UNBUILT tree (objectui#9220).
 *
 * ## Why this block exists and what the ablation leg is
 *
 * `--list` is this gate's own documented diagnostic and the only state a
 * developer reaches for it in is the state where the gate just failed. It used
 * to CRASH there: the row formatter read `t.fabricated.length` behind a guard
 * that whitelisted two literal verdicts, `unjudgeable-type` was not one of
 * them, and the run died on the first declaration it could not judge —
 * `TypeError: Cannot read properties of undefined (reading 'length')`, with no
 * census, no row past that one, and exit 1, the same code the gate uses to
 * report a genuinely fabricated name.
 *
 * ⭐ THE ABLATION LEG, and the reason this block asserts a SHAPE and not only
 * the absence of a throw: back `documentedTypeRow` out of the
 * `unjudgeable-type` push in `check-readme-exports.mjs` — restore the bare
 * `documentedTypes.push({ ...site, verdict: 'unjudgeable-type' })` — and
 * `renderList` throws again on the fixture below. Both the "prints every row"
 * case and the identical-key-set case go red; the exit-code cases go red too,
 * because nothing returns at all. Measured, not predicted, on this branch —
 * the numbers are in the pull request.
 *
 * The whitelist is NOT the repair, and this block is written so that re-adding
 * one would not satisfy it: a third verdict string would make TODAY's row safe
 * and leave the construct — a field-access guard enumerated by verdict — intact
 * for the next verdict anyone adds. What is asserted below is that EVERY row
 * carries the same key set, which is a fact about fields rather than about the
 * membership of a list.
 */
describe('`--list` REFUSES on an unbuilt tree instead of dying in it (objectui#9220)', () => {
  const UNBUILT_README = 'packages/unbuilt/README.md';
  const root = fixtureTree({
    ...PIN_FIXTURE,
    'packages/pin/README.md': '# @fix/pin\n',
    // Declares a type entry, and that entry is not on disk. This is the card's
    // `mv packages/plugin-kanban/dist /tmp/parked` as a fixture: the one state
    // the gate's own failure text sends a developer to inspect.
    'packages/unbuilt/package.json': manifest('@fix/unbuilt', './dist/index.d.ts'),
    [`packages/unbuilt/README.md`]: '# @fix/unbuilt\n',
  });

  /**
   * The unbuilt package's README is walked FIRST on purpose. The defect was not
   * only "it throws" — it was "no row past the first bad one", so a listing that
   * hit the unjudgeable declaration last would have looked almost healthy.
   */
  const run = () =>
    scan(root, {
      readmes: [UNBUILT_README, PIN_README],
      packageDirs: ['packages/unbuilt', ...PIN_PACKAGES],
      readmeOverrides: {
        [UNBUILT_README]: writeReadme(root, '# @fix/unbuilt\n\n```ts\ninterface Parked {\n  id: string;\n}\n```\n'),
        [PIN_README]: writeReadme(root, '# @fix/pin\n\n```ts\ninterface Widget {\n  id: string;\n  label?: string;\n  hidden?: boolean;\n}\n```\n'),
      },
      floors: {},
    });

  it('CONTROL: the fixture really is in the state under test', () => {
    // Without this leg every assertion below could be green because the walk
    // found nothing — the failure mode this gate itself exists to catch.
    const result = run();
    expect(result.census.packagesUnbuilt).toBe(1);
    expect(result.census.typesUnjudgeable).toBe(1);
    expect(result.documentedTypes.map((t) => t.verdict)).toEqual(['unjudgeable-type', 'matches']);
  });

  it('does NOT throw, and prints every row — including the ones AFTER the unjudgeable one', () => {
    const rendered = renderList(run());
    const rows = rendered.rows.filter((r) => r !== '');
    expect(rows.some((r) => r.startsWith('unjudgeable-type') && r.includes('interface Parked'))).toBe(true);
    expect(rows.some((r) => r.startsWith('matches') && r.includes('interface Widget'))).toBe(true);
    // The census is the other half of what the crash destroyed.
    expect(rendered.rows.at(-1)).toContain('documented type(s)');
  });

  it('leaves through a DEDICATED exit code, which is NOT the fabricated-name code', () => {
    expect(renderList(run()).exitCode).toBe(EXIT_CODES.couldNotRun);
    expect(EXIT_CODES.couldNotRun).not.toBe(EXIT_CODES.readmesFailed);
    expect(EXIT_CODES.couldNotRun).not.toBe(EXIT_CODES.verified);
  });

  it('names the precondition, the unbuilt package, and a build command scoped to it', () => {
    const notices = renderList(run()).notices.join('\n');
    expect(notices).toContain(`PRECONDITION NOT MET (exit ${EXIT_CODES.couldNotRun})`);
    expect(notices).toContain('@fix/unbuilt');
    expect(notices).toContain('--filter @fix/unbuilt');
    // Scoped: the package that IS built must not be in the build command.
    expect(notices).not.toContain('--filter @fix/pin');
  });

  it('CONTROL, known direction: with nothing unbuilt it exits 0 and issues no notice', () => {
    // The same renderer over the same fixture minus the unbuilt package. If this
    // leg ever goes green-by-accident alongside the ones above, the refusal is
    // firing unconditionally and `--list` has stopped being usable at all.
    const result = scan(root, {
      readmes: [PIN_README],
      packageDirs: PIN_PACKAGES,
      readmeOverrides: {
        [PIN_README]: writeReadme(root, '# @fix/pin\n\n```ts\ninterface Widget {\n  id: string;\n  label?: string;\n  hidden?: boolean;\n}\n```\n'),
      },
      floors: {},
    });
    expect(result.census.packagesUnbuilt).toBe(0);
    const rendered = renderList(result);
    expect(rendered.exitCode).toBe(EXIT_CODES.verified);
    expect(rendered.notices).toEqual([]);
  });

  it('gives EVERY row the same key set, whatever its verdict — the field guard is not a verdict list', () => {
    // ⭐ The assertion the whitelist repair cannot satisfy. `unjudgeable-type`,
    // `local-declaration`, `not-a-property-type` and a COMPARED row all come out
    // of one factory, so a verdict added tomorrow is safe to format without
    // anyone remembering to touch `renderList`.
    const result = scan(root, {
      readmes: [UNBUILT_README, PIN_README],
      packageDirs: ['packages/unbuilt', ...PIN_PACKAGES],
      readmeOverrides: {
        [UNBUILT_README]: writeReadme(root, '# @fix/unbuilt\n\n```ts\ninterface Parked {\n  id: string;\n}\n```\n'),
        [PIN_README]: writeReadme(
          root,
          '# @fix/pin\n\n```ts\ninterface Widget {\n  id: string;\n  label?: string;\n  hidden?: boolean;\n}\n' +
            'interface Local {\n  only: string;\n}\ntype Mode = \'a\' | \'b\';\n```\n',
        ),
      },
      floors: {},
    });
    const verdicts = result.documentedTypes.map((t) => t.verdict);
    expect(verdicts).toContain('unjudgeable-type');
    expect(verdicts).toContain('local-declaration');
    expect(verdicts).toContain('matches');
    const keySets = result.documentedTypes.map((t) => Object.keys(t).sort().join(','));
    expect(new Set(keySets).size).toBe(1);
    for (const row of result.documentedTypes) {
      expect(Array.isArray(row.fabricated)).toBe(true);
      expect(Array.isArray(row.omitted)).toBe(true);
    }
  });

  it('prints the census detail ONLY where a comparison happened — safety and presentation are separate', () => {
    const rows = renderList(run()).rows;
    const unjudgeable = rows.find((r) => r.startsWith('unjudgeable-type'));
    const compared = rows.find((r) => r.startsWith('matches'));
    // Not "0 key(s) vs own 0 of 0", which would state a comparison that never
    // ran — the same defect one level up from the crash.
    expect(unjudgeable).not.toContain('key(s)');
    expect(compared).toContain('doc 3 key(s) + 0 method(s) vs own 3 of 3');
  });
});

describe('wiring — the gate is reachable and every pull-request shape starts it', () => {
  const workflowDir = path.join(repoRoot, '.github/workflows');
  const workflowFiles = fs.readdirSync(workflowDir).filter((f) => f.endsWith('.yml'));
  const workflow = fs.readFileSync(path.join(workflowDir, 'repo-gates.yml'), 'utf8');
  const uncommented = workflow
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

  it('is runnable by name', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.scripts['check:readme-exports']).toBe('node scripts/check-readme-exports.mjs');
  });

  it('is run by EXACTLY ONE workflow — two homes is two answers', () => {
    const runners = workflowFiles.filter((file) =>
      fs.readFileSync(path.join(workflowDir, file), 'utf8').includes('check:readme-exports'),
    );
    expect(runners).toEqual(['repo-gates.yml']);
  });

  it('carries NO trigger-level path filter — a README-only PR must start it', () => {
    // This is the shape `ci.yml` structurally cannot see, which is the whole
    // reason this gate has its own workflow.
    expect(uncommented).not.toMatch(/^\s*paths(-ignore)?:/m);
  });

  it('subscribes pull_request, push, merge_group and workflow_dispatch', () => {
    for (const trigger of ['pull_request:', 'push:', 'merge_group:', 'workflow_dispatch:']) {
      expect(uncommented).toContain(trigger);
    }
  });

  it('is classified as a required context, so a Dependabot merge waits for it', () => {
    // Since objectui#12214 the check reports as a step of the ONE `Repo Gates`
    // context, which is the name the classification and the floor read.
    expect(REQUIRED_CONTEXTS).toContain('Repo Gates');
    expect(uncommented).toContain('name: Repo Gates');
    expect(uncommented).toContain('name: README Export Check');
  });

  it('builds before it judges — without `dist/` the gate can only report `unbuilt`', () => {
    const buildAt = uncommented.indexOf('turbo run build');
    const checkAt = uncommented.indexOf('pnpm check:readme-exports');
    expect(buildAt).toBeGreaterThan(-1);
    expect(checkAt).toBeGreaterThan(buildAt);
    expect(uncommented).toContain('pnpm install --frozen-lockfile');
  });
});
