// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A named path that will run no tests is reported, and a run that loses nothing
 * is byte-identical (#17853, #17978).
 *
 * `../src/index.ts` carries the mechanism, the vitest readings, the measurement
 * that rejected the reporter seam and the measurement that rejected consuming
 * this package by its bare name. Pinned HERE are the directions the rulings on
 * those two cards made non-negotiable, plus the decline paths — each separately,
 * because they fail separately:
 *
 *  1. **LOST IS LOUD.** A filter that selects nothing is returned by
 *     `lostFilters`, attributed to the project it really lives in, and rendered
 *     into a notice naming the path, that project and a command that runs it.
 *     ⛔ Asserting only that the notice is non-empty would pass on a notice
 *     that says nothing useful, so each part is asserted by name.
 *
 *  2. **HEALTHY IS SILENT — the half that makes this accurate instead of merely
 *     loud.** `runFilterPreflight` returns the EMPTY STRING and calls its writer
 *     ZERO times whenever nothing was lost. Zero bytes is the whole contract: a
 *     narrowed run that loses nothing must read exactly as it read before.
 *
 *  3. **EVERY UNCERTAINTY DECLINES.** An argv the parser refuses, a `--project`
 *     that is not a project name, a `--changed` run: each returns nothing at
 *     all. ⛔ These are the cases where a guess would turn a diagnostic into a
 *     lie, and silence is exactly the status quo, so declining cannot make a run
 *     worse than it is today.
 *
 *  4. **THE NOTICE IS NOT PACKAGE-BOUND (#17978).** The `packages/cli` original
 *     hardcoded `@objectstack/cli` in the `run it:` line. A shared notice that
 *     names the wrong package sends the reader to a command that runs the wrong
 *     suite, so the filter name is a parameter and BOTH lines that carry it are
 *     asserted.
 *
 *  5. **THE GLOB PROJECT'S POPULATION IS A SUPERSET, and only ever a superset.**
 *     `testFilesUnder` is the component the original could not express, and the
 *     superset direction is its whole safety argument — so what is pinned is the
 *     family it collects, the directories it refuses to walk, and that
 *     `exactAndGlobPopulations` removes exactly the exact list from it.
 *
 *  6. **THE NO-`--project` CASE (#17978).** A real path beside a typo, no
 *     `--project` flag at all — the case the #17978 card body did not frame — is
 *     reported by the same code path off the same full-population knowledge.
 *
 * The argv cases drive vitest's REAL exported `parseCLI`, not a stand-in, so
 * what is pinned is the spelling an agent actually types.
 *
 * ⚠️ What this file deliberately does NOT do is spawn vitest. An end-to-end pin
 * would have to run vitest inside vitest. The end-to-end reading is taken once,
 * by hand, per consuming package, and recorded in the PR that landed this;
 * `config-wiring-sweep.test.ts` is what keeps these pins from going phantom in
 * the meantime.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseCLI } from 'vitest/node';
import {
  exactAndGlobPopulations,
  lostFilters,
  matchesVitestFilter,
  parseInvocation,
  renderLostFilterNotice,
  runFilterPreflight,
  splitLineSuffix,
  testFilesUnder,
  type CliParse,
} from '../src/index.js';

/** A stand-in package root; nothing in these cases touches the filesystem. */
const PKG = '/repo/packages/example';
const PKG_NAME = '@objectstack/example';

const U1 = 'src/utils/format.exit-code.test.ts';
const U2 = 'test/commands.test.ts';
const I1 = 'test/i18n-extract-companion-orphan.test.ts';
const POPULATIONS = { unit: [U1, U2], integration: [I1] };
// ⛔ No cast: vitest's real `parseCLI` is handed in unaltered, so this line is
// itself the pin that `CliParse` still describes the parser vitest ships.
const parse: CliParse = parseCLI;

/** A real `vitest run …` command line, as `process.argv` would carry it. */
const argv = (...args: string[]): string[] => ['/usr/bin/node', '/x/vitest.mjs', 'run', ...args];

/**
 * Run the preflight with a capturing writer and a FRESH once-guard scope, so
 * each case behaves like its own process.
 */
function preflight(...args: string[]): { notice: string; writes: string[] } {
  const writes: string[] = [];
  const scope: Record<string, unknown> = {};
  const notice = runFilterPreflight({
    argv: argv(...args),
    root: PKG,
    populations: POPULATIONS,
    packageName: PKG_NAME,
    parse,
    scope,
    write: (text) => void writes.push(text),
  });
  return { notice, writes };
}

describe('① a path that will run no tests is reported by name', () => {
  const { notice, writes } = preflight('--project', 'unit', U1, U2, I1);

  it('writes the notice rather than returning it silently', () => {
    expect(writes).toEqual([notice]);
    expect(notice).not.toBe('');
  });

  it('names the discarded path', () => {
    expect(notice).toContain(I1);
  });

  it('names the project it actually lives in, and the project this run selected', () => {
    expect(notice).toContain('lives in the `integration` project');
    expect(notice).toContain('this run selected project `unit`');
  });

  it('names a command that would actually run it', () => {
    expect(notice).toContain(`--project integration ${I1}`);
  });

  it('counts against the command line, not against the lost set', () => {
    expect(notice).toContain('1 of the 3 path(s)');
  });

  it('still reports when EVERY path is lost — where vitest is red but generic', () => {
    const only = preflight('--project', 'unit', I1);
    expect(only.notice).toContain(I1);
    expect(only.notice).toContain('this run selected project `unit`');
  });

  it('announces ONCE per process, however many times the config is loaded', () => {
    // ⛔ vitest loads a config once per project and each load is its own module
    // instance, so a module-level flag guards nothing: before the scope guard
    // existed, three loads printed three notices at the top and three more at
    // exit. The guard is pinned here by calling twice on one scope.
    const writes: string[] = [];
    const scope: Record<string, unknown> = {};
    const once = (): string =>
      runFilterPreflight({
        argv: argv('--project', 'unit', U1, I1),
        root: PKG,
        populations: POPULATIONS,
        packageName: PKG_NAME,
        parse,
        scope,
        write: (text) => void writes.push(text),
      });
    const first = once();
    const second = once();
    expect(first).not.toBe('');
    // ⛔ The second call still REPORTS the notice to its caller — it just does
    // not write it again. Returning '' would read as "nothing was lost".
    expect(second).toBe(first);
    expect(writes).toHaveLength(1);
  });

  it('separates a path in another project from one in no project at all', () => {
    const typo = preflight('--project', 'unit', U1, 'test/no-such-file.test.ts');
    expect(typo.notice).toContain('matches no test file in this package at all');
    expect(typo.notice).not.toContain('lives in the');
  });
});

describe('② a run that loses nothing contributes zero bytes', () => {
  it('is silent when every named path selects something', () => {
    const { notice, writes } = preflight('--project', 'unit', U1, U2);
    expect(notice).toBe('');
    expect(writes).toEqual([]);
  });

  it('is silent when no path was named at all', () => {
    expect(preflight('--project', 'unit').writes).toEqual([]);
  });

  it('is silent for the full-suite run CI performs', () => {
    expect(preflight().writes).toEqual([]);
  });

  it('is silent when an out-of-project path is named WITHOUT --project', () => {
    // Both projects are selected, so the path is collected. ⛔ Warning here
    // would make the gate louder and wrong.
    expect(preflight(U1, I1).writes).toEqual([]);
  });

  it('treats a prefix spanning both projects as the legitimate narrowing it is', () => {
    // `test/` names files in both projects; under `--project unit` the unit ones
    // are collected, which is exactly what the caller asked for.
    expect(preflight('--project', 'unit', 'test/').writes).toEqual([]);
  });

  it('renders the EMPTY STRING for an empty lost set — the byte-identity contract', () => {
    expect(renderLostFilterNotice([], 2, ['unit'], PKG_NAME)).toBe('');
  });
});

describe('③ every uncertainty declines instead of guessing', () => {
  it('declines an argv the parser refuses', () => {
    const boom: CliParse = () => {
      throw new Error('unparseable');
    };
    const inv = parseInvocation(argv('--project', 'unit', I1), boom);
    expect(inv.opaque).toBe(true);
    expect(lostFilters(inv, POPULATIONS, PKG)).toEqual([]);
  });

  it('declines a --project value that is not a project name', () => {
    // A negation or a glob is not modelled; ⛔ half-answering it would be a lie.
    expect(preflight('--project', '!integration', I1).writes).toEqual([]);
  });

  it('declines a --changed run, where no path was named by hand', () => {
    expect(parseInvocation(argv('--changed'), parse).opaque).toBe(true);
  });
});

describe('④ the notice names the package it is running in, never a hardcoded one', () => {
  it('carries the caller’s filter name in the `run it:` line', () => {
    const { notice } = preflight('--project', 'unit', U1, I1);
    expect(notice).toContain(`pnpm --filter ${PKG_NAME} exec vitest run --project integration`);
  });

  it('carries it in the run-everything line too', () => {
    expect(preflight('--project', 'unit', U1, I1).notice).toContain(
      `pnpm --filter ${PKG_NAME} test`,
    );
  });

  it('⛔ never mentions @objectstack/cli, the string the original hardcoded', () => {
    // The whole finding #17978 carries: a shared notice bound to one package
    // sends every other package's reader to the wrong suite.
    const other = runFilterPreflight({
      argv: argv('--project', 'unit', U1, I1),
      root: PKG,
      populations: POPULATIONS,
      packageName: '@objectstack/types',
      parse,
      scope: {},
      write: () => {},
    });
    expect(other).toContain('@objectstack/types');
    expect(other).not.toContain('@objectstack/cli');
  });
});

describe('⑤ the glob project’s population is a SUPERSET, walked not globbed', () => {
  const ROOT = mkdtempSync(join(tmpdir(), 'os-preflight-walk-'));
  afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

  const touch = (rel: string): void => {
    const abs = join(ROOT, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, '');
  };

  // The whole `*.{test,spec}.?(c|m)[jt]s?(x)` family vitest's own
  // `configDefaults.include` names, plus the shapes that must NOT be collected.
  const COLLECTED = [
    'src/a.test.ts',
    'src/b.spec.ts',
    'src/deep/c.test.tsx',
    'src/deep/d.spec.mts',
    'src/e.test.cjs',
    'src/f.spec.js',
    'src/g.test.jsx',
    'test/h.dogfood.test.ts',
    'scripts/i.test.ts',
  ];
  const IGNORED = [
    'src/not-a-test.ts',
    'src/tests.ts',
    'src/j.test.txt',
    'node_modules/pkg/k.test.ts',
    'dist/l.test.ts',
    'src/nested/node_modules/m.test.ts',
  ];
  for (const rel of [...COLLECTED, ...IGNORED]) touch(rel);

  it('collects every member of the family, package-root-relative and sorted', () => {
    expect(testFilesUnder(ROOT)).toEqual([...COLLECTED].sort());
  });

  it('⛔ never walks node_modules or dist — the two vitest also excludes', () => {
    const walked = testFilesUnder(ROOT);
    expect(walked.filter((p) => p.includes('node_modules'))).toEqual([]);
    expect(walked.filter((p) => p.startsWith('dist/'))).toEqual([]);
  });

  it('gives the exact project its list verbatim and the glob project the rest', () => {
    const pops = exactAndGlobPopulations({
      root: ROOT,
      exact: { repo: ['src/a.test.ts', 'scripts/i.test.ts'] },
      globProject: 'local',
    });
    expect(pops.repo).toEqual(['src/a.test.ts', 'scripts/i.test.ts']);
    // Exactly the walk minus the exact list — no file in both, none dropped.
    expect(pops.local).toEqual(
      [...COLLECTED].sort().filter((p) => p !== 'src/a.test.ts' && p !== 'scripts/i.test.ts'),
    );
    expect([...(pops.repo ?? []), ...(pops.local ?? [])].sort()).toEqual([...COLLECTED].sort());
  });

  it('an OVER-broad population can only under-report, never accuse', () => {
    // The safety argument, asserted rather than only argued: a filter matching
    // nothing in a superset matches nothing in the real subset either, so no
    // healthy run can be accused. Here `local` holds MORE than a real glob
    // project would, and the real file is still not reported.
    const pops = exactAndGlobPopulations({
      root: ROOT,
      exact: { repo: ['src/a.test.ts'] },
      globProject: 'local',
    });
    const inv = parseInvocation(argv('--project', 'local', 'src/b.spec.ts'), parse);
    expect(lostFilters(inv, pops, ROOT)).toEqual([]);
  });
});

describe('⑥ the no---project typo case — the shape the card body did not frame', () => {
  it('reports a typo named with no --project flag at all', () => {
    // MEASURED on vitest 4.1.11: `vitest run <real> <typo>` with no --project
    // exits 0, prints `Test Files 1 passed (1)`, and names the typo nowhere.
    const { notice, writes } = preflight(U1, 'test/no-such-file-here.test.ts');
    expect(writes).toEqual([notice]);
    expect(notice).toContain('test/no-such-file-here.test.ts');
    expect(notice).toContain('matches no test file in this package at all');
    expect(notice).toContain('1 of the 2 path(s)');
  });

  it('is still silent when both paths named without --project are real', () => {
    expect(preflight(U1, I1).writes).toEqual([]);
  });
});

describe('the reading mirrors vitest 4.1.11', () => {
  it('matches a substring of the project-relative path', () => {
    expect(matchesVitestFilter(U2, 'commands', PKG)).toBe(true);
  });

  it('matches case-insensitively, as vitest does', () => {
    expect(matchesVitestFilter(U2, 'COMMANDS.TEST', PKG)).toBe(true);
  });

  it('matches an absolute filter by prefix', () => {
    expect(matchesVitestFilter(U2, join(PKG, 'test'), PKG)).toBe(true);
  });

  it('does not match an unrelated path', () => {
    expect(matchesVitestFilter(U2, 'i18n-extract', PKG)).toBe(false);
  });

  it('splits a `:LINE` suffix off for matching and keeps the spelling for the reader', () => {
    expect(splitLineSuffix(`${U2}:12`)).toEqual({ spelled: `${U2}:12`, path: U2 });
    expect(splitLineSuffix(U2)).toEqual({ spelled: U2, path: U2 });
  });

  it('reads the positional filters and the project out of a real command line', () => {
    const inv = parseInvocation(argv('--project', 'unit', '--maxWorkers=2', U1), parse);
    expect(inv.opaque).toBe(false);
    expect(inv.projects).toEqual(['unit']);
    expect(inv.filters.map((f) => f.path)).toEqual([U1]);
  });
});
