// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A named path that will run no tests is reported, and a run that loses nothing
 * is byte-identical (#17853).
 *
 * `../vitest-filter-preflight.ts` carries the mechanism, the vitest readings,
 * and the measurement that rejected the reporter seam. Pinned HERE are the two
 * directions the ruling on this card made non-negotiable, the decline paths,
 * and the wiring — pinned separately because they fail separately:
 *
 *  1. **LOST IS LOUD.** A filter that selects nothing is returned by
 *     `lostFilters`, attributed to the tier it really lives in, and rendered
 *     into a notice naming the path, that tier and a command that runs it.
 *     ⛔ Asserting only that the notice is non-empty would pass on a notice
 *     that says nothing useful, so each part is asserted by name.
 *
 *  2. **HEALTHY IS SILENT — the half that makes this accurate instead of merely
 *     loud.** `runFilterPreflight` returns the EMPTY STRING and calls its writer
 *     ZERO times whenever nothing was lost. Zero bytes is the whole contract: a
 *     narrowed run that loses nothing must read exactly as it read before.
 *
 *  3. **EVERY UNCERTAINTY DECLINES.** An argv the parser refuses, a `--project`
 *     that is not a tier name, a `--changed` run: each returns nothing at all.
 *     ⛔ These are the cases where a guess would turn a diagnostic into a lie,
 *     and silence is exactly the status quo, so declining cannot make a run
 *     worse than it is today.
 *
 *  4. **THE WIRING**, both halves. A preflight nobody invoked is a phantom
 *     check — it evaluates never, and deleting it leaves every assertion above
 *     just as green — so the config's own source is read, comments masked, and
 *     the call asserted in CODE position. The NEGATIVE half is equally
 *     load-bearing and is the measured regression this file exists downstream
 *     of: the config must NOT name `test.reporters`, because naming it replaces
 *     vitest's reporter defaulting (`agent` vs `default`, and the
 *     `github-actions` reporter in CI) instead of extending it.
 *
 * The argv cases drive vitest's REAL exported `parseCLI`, not a stand-in, so
 * what is pinned is the spelling an agent actually types.
 *
 * ⚠️ What this file deliberately does NOT do is spawn vitest. An end-to-end pin
 * would have to run vitest inside vitest, which the tier predicate classifies
 * as `integration` (SPAWN) — a permanently expensive file in the tier this card
 * is not authorised to reshape. The end-to-end reading is taken once, by hand,
 * and recorded in the PR that landed this; case 4 is what keeps these pins from
 * going phantom in the meantime.
 *
 * Runs in the `unit` tier: pure functions plus one source read, no child
 * process and no kernel.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCLI } from 'vitest/node';
import { maskComments } from '../../../scripts/js-comment-mask.mjs';
import {
  lostFilters,
  matchesVitestFilter,
  parseInvocation,
  renderLostFilterNotice,
  runFilterPreflight,
  splitLineSuffix,
  type CliParse,
} from '../vitest-filter-preflight.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..');

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

  it('names the tier it actually lives in, and the project this run selected', () => {
    expect(notice).toContain('lives in the `integration` tier');
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
    // ⛔ vitest loads this config once per project and each load is its own
    // module instance, so a module-level flag guards nothing: before the scope
    // guard existed, three loads printed three notices at the top and three
    // more at exit. The guard is pinned here by calling twice on one scope.
    const writes: string[] = [];
    const scope: Record<string, unknown> = {};
    const once = (): string =>
      runFilterPreflight({
        argv: argv('--project', 'unit', U1, I1),
        root: PKG,
        populations: POPULATIONS,
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

  it('separates a path in the other tier from one in no tier at all', () => {
    const typo = preflight('--project', 'unit', U1, 'test/no-such-file.test.ts');
    expect(typo.notice).toContain('matches no test file in this package at all');
    expect(typo.notice).not.toContain('lives in the');
  });

  it('reports a path that is in no tier even with no --project at all', () => {
    expect(preflight(U1, 'test/no-such-file.test.ts').notice).toContain('no test file in this package');
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

  it('is silent when an integration path is named WITHOUT --project', () => {
    // Both projects are selected, so the path is collected. ⛔ Warning here
    // would make the gate louder and wrong.
    expect(preflight(U1, I1).writes).toEqual([]);
  });

  it('treats a prefix spanning both tiers as the legitimate narrowing it is', () => {
    // `test/` names files in both tiers; under `--project unit` the unit ones
    // are collected, which is exactly what the caller asked for.
    expect(preflight('--project', 'unit', 'test/').writes).toEqual([]);
  });

  it('renders the EMPTY STRING for an empty lost set — the byte-identity contract', () => {
    expect(renderLostFilterNotice([], 2, ['unit'])).toBe('');
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

  it('declines a --project value that is not a tier name', () => {
    // A negation or a glob is not modelled; ⛔ half-answering it would be a lie.
    expect(preflight('--project', '!integration', I1).writes).toEqual([]);
  });

  it('declines a --changed run, where no path was named by hand', () => {
    expect(parseInvocation(argv('--changed'), parse).opaque).toBe(true);
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

describe('the preflight is still wired — ⛔ an uninvoked one is a phantom check', () => {
  const config = maskComments(readFileSync(join(PKG, 'vitest.config.ts'), 'utf8'));

  it('imports it, and imports vitest’s own parser for the argv', () => {
    expect(config).toContain("from './vitest-filter-preflight.js'");
    expect(config).toContain("from 'vitest/node'");
  });

  it('invokes it in code position', () => {
    expect(config).toMatch(/runFilterPreflight\(\{/);
    expect(config).toMatch(/parse:\s*parseCLI/);
  });

  it('feeds it the SAME derived arrays the projects use as their `include`', () => {
    // ⛔ A second derivation would be a copy of a fact already on disk and would
    // go stale exactly where this one cannot.
    expect(config).toMatch(
      /populations:\s*\{\s*unit:\s*UNIT_FILES,\s*integration:\s*INTEGRATION_FILES\s*\}/,
    );
  });

  it('⛔ does NOT name `test.reporters` — the measured regression this avoids', () => {
    // Naming it replaces vitest's reporter defaulting rather than extending it:
    // it pins `default` where an agent terminal gets `agent` (measured: a
    // healthy run gained two lines) and drops the `github-actions` reporter in
    // CI, which no local control run can observe.
    expect(config).not.toMatch(/\breporters\s*:/);
  });
});
