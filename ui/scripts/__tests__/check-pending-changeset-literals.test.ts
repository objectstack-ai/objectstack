import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Plain-JS CI helpers. Their types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here.
import { findings, isPendingDeclaration } from '../check-pending-changeset-literals.mjs';
import { markdownTestInputsAmong } from '../markdown-test-inputs.mjs';

/**
 * Pins for `scripts/check-pending-changeset-literals.mjs` (objectui#9583).
 *
 * The rule: a test's source may not NAME a file `.changeset/` currently
 * carries. `pnpm changeset:version` deletes exactly those files, and the only
 * instrument that notices lives on a post-version tree — a tree that exists
 * nowhere except inside the scheduled release job.
 *
 * Four groups, failing for four different reasons:
 *
 * 1. THE PREDICATE — what counts as a pending declaration, and what does not.
 * 2. THE INSTRUMENT — findings on a fixture tree, each with a FIRING CONTROL,
 *    because the passing answer here is an EMPTY LIST and an empty list is also
 *    what a scanner that resolved nothing at all would return.
 * 3. THE TREE — the repository as it stands satisfies the rule, through the
 *    CLI, so the entry guard and the exit code are exercised too.
 * 4. THE WIRING — this suite is the blocking copy, so the two pull-request
 *    shapes that can break the rule must both reach it. Neither leg is
 *    assumed; both are read off the files that decide them.
 *
 * ⛔ Every changeset name written in this file is synthetic (`fixture-` /
 * `9583-`-free). A real one would make this very file an instance of the defect
 * it pins.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GATE = 'scripts/check-pending-changeset-literals.mjs';

/**
 * A declaration name wearing the `pnpm changeset` shape, prefixed so it belongs
 * to neither namespace a committed name can come from — the same convention
 * objectui#9582 put on the overwrite gate's fixtures.
 */
const FIXTURE_DECLARATION = '.changeset/fixture-olive-donkeys-smile.md';

interface Fixture {
  root: string;
  write(relative: string, contents: string): void;
}

function fixtureTree(label: string): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pending-changeset-${label}-`));
  const write = (relative: string, contents: string): void => {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  };

  // The directory as a real checkout carries it: documentation that survives
  // every release, plus somebody's pending release declaration.
  write('.changeset/README.md', '# Changesets\n\nDocumentation, not a declaration.\n');
  write(FIXTURE_DECLARATION, '---\n"@fixture/alpha": patch\n---\n\nAn unrelated pending fix.\n');

  return { root, write };
}

/** The gate's answer over a fixture tree, as `test -> document` strings. */
const found = (root: string): string[] =>
  findings({ root }).map(({ test, document }: { test: string; document: string }) => `${test} -> ${document}`);

describe('1. the predicate — what `changeset version` consumes', () => {
  it('counts a pending declaration', () => {
    expect(isPendingDeclaration(FIXTURE_DECLARATION)).toBe(true);
    expect(isPendingDeclaration('.changeset/1234-an-issue-slug.md')).toBe(true);
  });

  it('declines `.changeset/README.md` — documentation survives every release', () => {
    expect(isPendingDeclaration('.changeset/README.md')).toBe(false);
  });

  it('declines anything outside the changeset directory', () => {
    expect(isPendingDeclaration('CHANGELOG.md')).toBe(false);
    expect(isPendingDeclaration('packages/core/README.md')).toBe(false);
    expect(isPendingDeclaration('docs/changeset/not-the-directory.md')).toBe(false);
  });

  it('declines a non-markdown file the directory also carries', () => {
    expect(isPendingDeclaration('.changeset/config.json')).toBe(false);
  });
});

describe('2. the instrument, on a fixture tree — every answer with a firing control', () => {
  it('reports a test source that names a declaration the tree carries', () => {
    const fixture = fixtureTree('names-it');
    fixture.write(
      'scripts/__tests__/subject.test.ts',
      `it('routes by prefix', () => expect(roleOf('${FIXTURE_DECLARATION}')).toBe('release-notes'));\n`,
    );

    expect(found(fixture.root)).toEqual([`scripts/__tests__/subject.test.ts -> ${FIXTURE_DECLARATION}`]);
  });

  it('says nothing about a name the directory does NOT carry', () => {
    const fixture = fixtureTree('absent');
    fixture.write(
      'scripts/__tests__/subject.test.ts',
      `it('routes by prefix', () => expect(roleOf('.changeset/fixture-never-written.md')).toBe('x'));\n`,
    );

    // The hazard has exactly this predicate: the scanner offers only documents
    // that EXIST, so a literal naming nothing cannot become a ledger entry.
    expect(found(fixture.root)).toEqual([]);
  });

  it('says nothing about `.changeset/README.md`, which tests name legitimately', () => {
    const fixture = fixtureTree('readme');
    fixture.write(
      'scripts/__tests__/subject.test.ts',
      `it('ignores docs', () => expect(isDeclaration('.changeset/README.md')).toBe(false));\n`,
    );

    expect(found(fixture.root)).toEqual([]);
  });

  it('FIRING CONTROL: the same suite fires once the literal names the declaration', () => {
    const fixture = fixtureTree('readme-control');
    fixture.write(
      'scripts/__tests__/subject.test.ts',
      `it('ignores docs', () => expect(isDeclaration('.changeset/README.md')).toBe(false));\n` +
        `it('and this one', () => expect(isDeclaration('${FIXTURE_DECLARATION}')).toBe(true));\n`,
    );

    expect(found(fixture.root)).toEqual([`scripts/__tests__/subject.test.ts -> ${FIXTURE_DECLARATION}`]);
  });

  it('⛔ DECLARED BLIND SPOT: a literal inside a comment is invisible', () => {
    const fixture = fixtureTree('commented');
    fixture.write(
      'scripts/__tests__/subject.test.ts',
      `// was ${FIXTURE_DECLARATION}, repaired\nit('x', () => expect(1).toBe(1));\n`,
    );

    // Not an oversight and not a hole: the scanner masks comments before it
    // resolves anything, so a commented literal never becomes a ledger entry
    // either. The gate's population is the hazard's population, exactly.
    expect(found(fixture.root)).toEqual([]);
  });

  it('FIRING CONTROL: the same literal fires once it is code', () => {
    const fixture = fixtureTree('commented-control');
    fixture.write(
      'scripts/__tests__/subject.test.ts',
      `// was ${FIXTURE_DECLARATION}, repaired\nit('x', () => expect(read('${FIXTURE_DECLARATION}')).toBe(1));\n`,
    );

    expect(found(fixture.root)).toEqual([`scripts/__tests__/subject.test.ts -> ${FIXTURE_DECLARATION}`]);
  });

  it('only looks at TEST sources — a gate script naming one is not this defect', () => {
    const fixture = fixtureTree('non-test');
    fixture.write('scripts/some-gate.mjs', `const example = '${FIXTURE_DECLARATION}';\n`);

    expect(found(fixture.root)).toEqual([]);
  });
});

describe('3. the tree as it stands satisfies the rule', () => {
  it('exits 0 through the CLI', () => {
    // Through the CLI rather than the export: an entry guard that answers
    // `false` makes a gate exit 0 having done nothing, which reads as a pass.
    const output = execFileSync(process.execPath, [GATE], { cwd: repoRoot, encoding: 'utf8' });

    expect(output).toContain('No test source names a pending changeset');
  });
});

describe('4. the wiring — both shapes that can break the rule reach this suite', () => {
  it('is reachable by hand as a `pnpm check:` script', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(manifest.scripts['check:pending-changeset-literals']).toContain(GATE);
  });

  it('a change to a TEST SOURCE is not excluded from the full run', () => {
    // `ci.yml`'s `Decide whether this change needs a full run` step drops paths
    // with `:(exclude,glob)` pathspecs. None of the scan roots a test can live
    // under may be among them, or a pull request could add a naming literal
    // while this suite never runs.
    const ci = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
    const excluded = [...ci.matchAll(/':\(exclude,glob\)([^']+)'/g)].map((m) => m[1]);

    expect(excluded.length, 'the exclusion list must still be readable, or this pin asserts nothing').toBeGreaterThan(0);
    expect(excluded).not.toContain('scripts/**');
    expect(excluded).not.toContain('packages/**');
  });

  it('a change that ADDS a declaration is rescued into the full run', () => {
    // `.changeset/**` IS on that exclusion list. What saves it is the second
    // stage: `markdown-test-inputs.mjs` answers that a test reads the path, and
    // the step runs everything. If that answer ever goes empty, a
    // declaration-only pull request stops reaching this suite and the gate
    // silently covers one shape instead of two.
    expect(markdownTestInputsAmong(['.changeset/fixture-newly-added.md'])).not.toEqual([]);
  });
});
