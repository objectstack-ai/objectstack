import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { BUILD_OUTPUT_DIRS } from '../check-published-dist-tooling.mjs';

/**
 * objectui#9189 — no incremental build RECORD may be derived into a published
 * build output directory.
 *
 * ## The defect this pins shut
 *
 * `composite` implies `incremental`, so every composite project writes a
 * `*.tsbuildinfo`. Where it writes it is DERIVED, not declared: with an
 * `outDir` and no `rootDir`, TypeScript puts the record at
 * `outDir/<configname>.tsbuildinfo` — i.e. inside `dist`, which
 * `files: ["dist", …]` publishes whole. `pnpm check:published-dist` refuses a
 * record there (objectui#7003), so the gate's verdict came to depend on WHEN it
 * ran: green before anything invoked `tsc`, red after, on a byte-identical
 * tree. A reader whose diff touched no tsconfig then reads "I broke the
 * published surface" and goes looking in the diff for something that is not
 * there. Measured on c64975e9f: 18 of the repository's 32 incremental projects
 * derived their record into `dist`.
 *
 * ## Why the assertion is DERIVED and not a grep for the option
 *
 * The hazard is not a missing line; it is a location that nobody chose. Before
 * this card 12 projects were already correct — but only as a side effect of
 * carrying `rootDir: "src"`, which rebases the derived path back out of
 * `outDir`. `packages/components/tsconfig.json` says in its own comment that
 * `rootDir` was REMOVED there for an unrelated reason, and that removal is what
 * moved its record into the published directory. So a test that checked for the
 * presence of `tsBuildInfoFile` would pass on a project whose value still
 * pointed into `dist`, and would red on a correct project that got there
 * another way. Asking TypeScript where the record goes is the only question
 * whose answer cannot drift from the compiler's.
 *
 * `BUILD_OUTPUT_DIRS` is imported from the gate rather than re-spelled, so a
 * fourth output directory added over there is covered here in the same commit.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Below this many incremental projects the enumeration is broken, not empty.
 *
 * The repository has 32 today. A collapse to a handful means `git ls-files` or
 * the config parse stopped answering, and an empty comparison would pass while
 * reading nothing — the vacuous shape `check-published-dist-tooling.mjs` calls
 * out in its own header.
 */
const MIN_INCREMENTAL_PROJECTS = 25;

/** Every tracked tsconfig, enumerated from git rather than from a hand-written list. */
function trackedConfigs(): string[] {
  return execFileSync('git', ['ls-files', '*tsconfig*.json'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

/** The record path TypeScript itself would write for `configFile`, or null if it writes none. */
function derivedRecordPath(configFile: string): string | null {
  const absolute = path.join(repoRoot, configFile);
  const read = ts.readConfigFile(absolute, ts.sys.readFile);
  if (read.error) throw new Error(`cannot read ${configFile}`);
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    path.dirname(absolute),
    undefined,
    absolute,
  );
  const derived = ts.getTsBuildInfoEmitOutputFilePath?.(parsed.options);
  return derived ? path.relative(repoRoot, derived) : null;
}

/** Whether a repo-relative path sits inside one of the gate's build output directories. */
function insideBuildOutput(relativePath: string): boolean {
  return relativePath.split('/').some((segment) => BUILD_OUTPUT_DIRS.includes(segment));
}

describe('incremental build records stay outside published build output (objectui#9189)', () => {
  const projects = trackedConfigs()
    .map((file) => ({ file, record: derivedRecordPath(file) }))
    .filter((entry): entry is { file: string; record: string } => entry.record !== null);

  it('enumerates the incremental projects it claims to judge', () => {
    expect(projects.length).toBeGreaterThanOrEqual(MIN_INCREMENTAL_PROJECTS);
  });

  it('derives no record into a build output directory', () => {
    const offenders = projects
      .filter((entry) => insideBuildOutput(entry.record))
      .map((entry) => `${entry.file} -> ${entry.record}`);
    expect(offenders).toEqual([]);
  });

  it('can fail: dropping the pin from a real project puts its record back in dist', () => {
    // The control. Without it this suite would also pass on a tree where the
    // derivation silently stopped answering — the same "confident absence" the
    // enumeration assertion above guards from the other side.
    const absolute = path.join(repoRoot, 'packages/components/tsconfig.json');
    const read = ts.readConfigFile(absolute, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(
      read.config,
      ts.sys,
      path.dirname(absolute),
      undefined,
      absolute,
    );
    const withoutPin = { ...parsed.options, tsBuildInfoFile: undefined };
    const derived = ts.getTsBuildInfoEmitOutputFilePath?.(withoutPin);
    expect(derived).toBeTruthy();
    expect(insideBuildOutput(path.relative(repoRoot, derived as string))).toBe(true);
  });
});
