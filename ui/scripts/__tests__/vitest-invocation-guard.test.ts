import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here —
// re-adding one is now itself an error (TS2578). See objectui#3494. (On a
// multi-line import the directive never worked anyway: TS reports the missing
// declaration at the SPECIFIER line, not at the `import {` the comment guards.)
import {
  cliHasTestFilters,
  escapeNamePattern,
  evaluateVitestInvocation,
  judgeNamePattern,
  literalReadingOfNamePattern,
  parseVitestArgv,
  repoRootFrom,
} from '../vitest-invocation-guard.mjs';

/**
 * Two invocations of this repo's Vitest passed while running none of the tests
 * the caller asked for:
 *
 *  - objectui#3378: `pnpm --filter @object-ui/app-shell test` — i.e. `vitest
 *    run` with the cwd inside the package — printed `Test Files 22 passed (22)`
 *    where all 22 files belong to `@object-ui/console` and app-shell's own 281
 *    never ran. The root-level projects glob `packages/**` RELATIVE to the
 *    cwd-derived root, so from inside a package they match nothing; only the
 *    `apps/console` project, brought in by absolute path, still resolves.
 *
 *  - objectui#3288: `pnpm --filter <pkg> test -- --run <paths>` — pnpm forwards
 *    the `--` verbatim, Vitest's parser stops there, and the path filter is
 *    discarded before Vitest ever sees a path.
 *
 * Neither warned, and neither counted zero: both summaries said 22. These tests
 * pin the guard that now refuses them, and the wiring that makes it
 * unskippable — which is the root config PLUS every package config that does
 * not lead back to it (objectui#5406; the last two describes below).
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Paths that cannot exist, so `realpath()` falls back to a plain resolve and the
// verdict is decided by the injected inputs alone.
const FAKE_ROOT = '/nonexistent-objectui-repo';
const FAKE_PKG = `${FAKE_ROOT}/packages/fields`;

const argvFor = (...args: string[]) => ['/usr/bin/node', `${FAKE_ROOT}/bin/vitest`, ...args];

const judge = (
  args: string[],
  {
    cwd = FAKE_ROOT,
    exists = () => true,
    env = {},
  }: { cwd?: string; exists?: (p: string) => boolean; env?: Record<string, string> } = {}
) => evaluateVitestInvocation({ argv: argvFor(...args), cwd, repoRoot: FAKE_ROOT, exists, env });

describe('parseVitestArgv', () => {
  it('reads the subcommand, positionals and flags apart', () => {
    const parsed = parseVitestArgv(
      argvFor('run', '--project', 'unit', '--shard=1/4', 'packages/fields/src/a.test.ts')
    );

    expect(parsed.subcommand).toBe('run');
    expect(parsed.positionals).toEqual(['packages/fields/src/a.test.ts']);
    expect(parsed.flags['--project']).toBe('unit');
    expect(parsed.flags['--shard']).toBe('1/4');
    expect(parsed.afterDoubleDash).toEqual([]);
  });

  it('does not mistake a value-taking flag value for a file filter', () => {
    // `unit` and `verbose` are values, not paths. Reading them as filters would
    // make `pnpm test:unit` look like a filtered run and flip passWithNoTests
    // underneath it.
    expect(parseVitestArgv(argvFor('run', '--project', 'unit')).positionals).toEqual([]);
    expect(parseVitestArgv(argvFor('run', '--reporter', 'verbose')).positionals).toEqual([]);
  });

  it('collects everything after a bare `--` separately', () => {
    const parsed = parseVitestArgv(argvFor('run', '--', '--run', 'packages/fields/src/a.test.ts'));

    // Exactly the shape pnpm builds for
    // `pnpm --filter @object-ui/fields test -- --run <path>`.
    expect(parsed.positionals).toEqual([]);
    expect(parsed.afterDoubleDash).toEqual(['--run', 'packages/fields/src/a.test.ts']);
  });

  it('keeps EVERY value of a repeated flag, in order, next to the last-wins scalar', () => {
    // objectui#7329. The root `test:integration` script really is
    // `vitest run --project dom --project dom-heavy`; `flags` is last-wins, so it
    // answers `dom-heavy` and drops `dom` with no symptom. A reader asking "which
    // projects does this command run" reads `flagValues` instead.
    const parsed = parseVitestArgv(argvFor('run', '--project', 'dom', '--project', 'dom-heavy'));

    expect(parsed.flagValues['--project']).toEqual(['dom', 'dom-heavy']);
    // Backward compatibility, the whole reason `flags` was not turned into arrays:
    // the guard's own `--root` / `--changed` readers still see one scalar, the last.
    expect(parsed.flags['--project']).toBe('dom-heavy');
    // Neither value leaked into the file filters.
    expect(parsed.positionals).toEqual([]);
  });

  it('lists a flag that appears once as a one-element array, so readers need no fallback', () => {
    const parsed = parseVitestArgv(argvFor('run', '--project', 'a', '--shard=1/4', '--watch'));

    expect(parsed.flagValues['--project']).toEqual(['a']);
    // Both other spellings are recorded too: `--flag=value` and a bare boolean.
    expect(parsed.flagValues['--shard']).toEqual(['1/4']);
    expect(parsed.flagValues['--watch']).toEqual([true]);
    expect(parsed.flagValues['--reporter']).toBeUndefined();
  });

  it('treats a leading subcommand as the subcommand, not a filter', () => {
    expect(parseVitestArgv(argvFor('run')).positionals).toEqual([]);
    expect(parseVitestArgv(argvFor('list')).subcommand).toBe('list');
  });
});

describe('cliHasTestFilters — what switches passWithNoTests off', () => {
  it('is true when the CLI names files', () => {
    expect(cliHasTestFilters(argvFor('run', 'packages/fields/src/a.test.ts'))).toBe(true);
    // A bare substring filter counts too: "I asked for a subset and got zero"
    // is the failure, whether or not the subset was spelled as a path.
    expect(cliHasTestFilters(argvFor('run', 'useRecordQuery'))).toBe(true);
  });

  it('is false for the unfiltered runs CI makes', () => {
    expect(cliHasTestFilters(argvFor('run'))).toBe(false);
    expect(cliHasTestFilters(argvFor('run', '--shard=1/4'))).toBe(false);
    expect(cliHasTestFilters(argvFor('run', '--project', 'unit'))).toBe(false);
    expect(cliHasTestFilters(argvFor('run', '--coverage.reporter=json'))).toBe(false);
  });

  it('is false for `related` and `--changed`, which may legitimately match nothing', () => {
    expect(cliHasTestFilters(argvFor('related', 'packages/fields/src/index.ts'))).toBe(false);
    expect(cliHasTestFilters(argvFor('run', '--changed', 'HEAD~1'))).toBe(false);
  });
});

describe('evaluateVitestInvocation — the invocations CI and humans get right', () => {
  it('passes an unfiltered run from the repo root', () => {
    expect(judge(['run'])).toBeNull();
  });

  it('passes CI shapes (sharded, coverage) unchanged', () => {
    expect(judge(['run', '--shard=1/4'])).toBeNull();
    expect(judge(['run', '--coverage.reporter=json', '--coverage.reporter=text'])).toBeNull();
  });

  it('passes the canonical path-filtered run from the repo root', () => {
    expect(judge(['run', 'packages/fields/src/a.test.ts'])).toBeNull();
  });

  it('passes a package-cwd run that points --root back at the repo root', () => {
    // The one legitimate way to launch from inside a package: Vitest's root —
    // and therefore every project `include` — is the repo root again.
    expect(judge(['run', '--root', '../..', 'packages/fields/'], { cwd: FAKE_PKG })).toBeNull();
  });
});

describe('evaluateVitestInvocation — objectui#3378, the package-cwd false green', () => {
  it('refuses a run whose Vitest root is inside a package', () => {
    const verdict = judge(['run'], { cwd: FAKE_PKG });

    expect(verdict?.code).toBe('package-cwd');
    expect(verdict?.message).toContain('objectui#3378');
    // The message has to carry the mechanism, not just "don't do that": the
    // 22-file console collection is the fingerprint the reader already saw.
    expect(verdict?.message).toContain('22');
    expect(verdict?.message).toContain('apps/console');
    // ...and the replacement command, spelled with the caller's own package.
    expect(verdict?.message).toContain('pnpm exec vitest run packages/fields/');
  });

  it('refuses `vitest list` from a package directory too, not only `run`', () => {
    // `cd packages/app-shell && pnpm exec vitest list` is the reproduction in
    // objectui#3378; a guard covering only `run` would leave it lying.
    expect(judge(['list'], { cwd: `${FAKE_ROOT}/packages/app-shell` })?.code).toBe('package-cwd');
  });

  it('refuses a --root pointing somewhere other than this repo root', () => {
    expect(judge(['run', '--root', '/somewhere/else'], { cwd: FAKE_ROOT })?.code).toBe(
      'package-cwd'
    );
  });
});

describe('evaluateVitestInvocation — objectui#3288, the filter that never lands', () => {
  it('refuses arguments parked after a bare `--`', () => {
    const verdict = judge(['run', '--', '--run', 'packages/fields/src/a.test.ts']);

    expect(verdict?.code).toBe('double-dash-args');
    expect(verdict?.message).toContain('objectui#3288');
    expect(verdict?.message).toContain('--run packages/fields/src/a.test.ts');
  });

  it('names BOTH traps when the `--` run also came from a package directory', () => {
    // `pnpm --filter <pkg> test -- --run <paths>` trips #3288 and #3378 at once.
    // Reporting only the first would send the caller back for a second lap.
    const verdict = judge(['run', '--', '--run', 'packages/fields/src/a.test.ts'], {
      cwd: FAKE_PKG,
    });

    expect(verdict?.code).toBe('double-dash-args');
    expect(verdict?.message).toContain('objectui#3288');
    expect(verdict?.message).toContain('objectui#3378');
  });

  it('refuses a concrete test path that does not exist from the Vitest root', () => {
    const verdict = judge(['run', 'packages/fields/src/typo.test.ts'], { exists: () => false });

    expect(verdict?.code).toBe('missing-path-filter');
    expect(verdict?.message).toContain('packages/fields/src/typo.test.ts');
  });

  it('leaves non-path substring filters to passWithNoTests, not to the path check', () => {
    // `vitest run useRecordQuery` is a legitimate substring filter — it names no
    // file, so "does this path exist" has nothing to say about it. Zero matches
    // still fails, via passWithNoTests being off for filtered runs.
    expect(judge(['run', 'useRecordQuery'], { exists: () => false })).toBeNull();
  });

  it('does not read a directory filter as a missing file', () => {
    expect(judge(['run', 'packages/fields/'], { exists: () => false })).toBeNull();
  });
});

describe('evaluateVitestInvocation — objectui#7814, the appended filter that WIDENS', () => {
  // The argv below is not a reconstruction. It was captured out of the guard
  // itself, on `origin/main`, during a real
  //   pnpm --filter @object-ui/cli test packages/cli/src/__tests__/app-generator.test.ts
  // by appending a dump inside `assertCanonicalVitestInvocation`. Both filters
  // arrive in ONE `positionals` array, in ONE process, and the guard returned
  // `null` for all five config loads of that run — which is the defect: the run
  // executed the whole package, exited 0, and printed a green summary that reads
  // exactly like a narrowed run for the one file.
  const CAPTURED = ['run', '--root', '../..', 'packages/cli/'];
  const APPENDED = 'packages/cli/src/__tests__/app-generator.test.ts';
  const AT_PKG = { cwd: `${FAKE_ROOT}/packages/cli` };

  it('refuses the exact invocation the card measured', () => {
    const verdict = judge([...CAPTURED, APPENDED], AT_PKG);

    expect(verdict?.code).toBe('subsumed-positional-filter');
    expect(verdict?.message).toContain('objectui#7814');
    // It has to NAME the union — which filter was swallowed by which — or the
    // reader is told "no" without being told what to drop.
    expect(verdict?.message).toContain(APPENDED);
    expect(verdict?.message).toContain('packages/cli/');
    // ...and hand back the form that actually narrows, spelled for the
    // directory the caller is standing in.
    expect(verdict?.message).toContain(`pnpm exec vitest run --root ../.. ${APPENDED}`);
  });

  it('is the control: without the appended path the SAME command stays allowed', () => {
    // `pnpm --filter @object-ui/cli test` — the baked filter alone — is the one
    // legitimate package-level run and must not become collateral. This is the
    // negative half that proves the check above discriminates rather than
    // refusing every package-level invocation.
    expect(judge(CAPTURED, AT_PKG)).toBeNull();
  });

  it('leaves disjoint filters alone — subsumption is the trigger, not arity', () => {
    expect(judge(['run', 'packages/fields/', 'packages/core/'])).toBeNull();
  });

  it('reads subsumption the way Vitest matches: substring of the path, not path prefix', () => {
    // `vitest run cli` matches every file whose path CONTAINS `cli`, so naming a
    // file underneath it adds nothing — the same union, spelled without a slash.
    expect(judge(['run', 'cli', APPENDED])?.code).toBe('subsumed-positional-filter');
    // And the containment really is textual: `packages/core` matches
    // `packages/core-extras/...` too, so that pair is genuinely redundant.
    expect(judge(['run', 'packages/core', 'packages/core-extras/src/a.test.ts'])?.code).toBe(
      'subsumed-positional-filter'
    );
  });

  it('does not fire on an exact repeat, which asks for nothing narrower', () => {
    // `vitest run packages/cli/ packages/cli/` collects what the caller asked
    // for. Nothing is misattributed, so there is nothing to refuse — pinned so
    // that stays a decision rather than an accident of the comparison.
    expect(judge(['run', 'packages/cli/', 'packages/cli/'])).toBeNull();
  });

  it('yields to the older verdicts, so this check only ever ADDS refusals', () => {
    // A `--` run and a package-cwd run both also carry a subsumed pair here.
    // They keep their original codes: the new check runs last, so no invocation
    // that was refused before is refused differently now.
    expect(judge(['run', 'packages/cli/', '--', APPENDED], AT_PKG)?.code).toBe('double-dash-args');
    // Same subsumed pair, but launched from a package directory with no --root:
    // that is objectui#3378 and it keeps saying so.
    expect(judge(['run', 'packages/cli/', APPENDED], AT_PKG)?.code).toBe('package-cwd');
    // A missing appended path is still objectui#3288's verdict, not this one.
    expect(
      judge(['run', 'packages/cli/', 'packages/cli/src/typo.test.ts'], { exists: () => false })
        ?.code
    ).toBe('missing-path-filter');
    // With none of those in play, the new verdict is what is left.
    expect(judge(['run', 'packages/cli/', APPENDED])?.code).toBe('subsumed-positional-filter');
  });

  it('stands down for the escape hatch like every other verdict', () => {
    expect(
      judge([...CAPTURED, APPENDED], { ...AT_PKG, env: { OBJECTUI_VITEST_GUARD: 'off' } })
    ).toBeNull();
  });
});

describe('evaluateVitestInvocation — objectui#9660, the `-t` name filter read as a regex', () => {
  // Measured on this card, from the repo root, against a real file whose
  // `describe` title ends in a card reference the way this repo's do:
  //
  //   pnpm exec vitest run scripts/__tests__/body-dialect-census.test.ts \
  //     -t 'the population travels with the reading (objectui#9545)'
  //   => Test Files  1 skipped (1) / Tests 22 skipped (22)   exit 0, tests 0ms
  //
  // and the LIT CONTROL on the SAME instrument and the SAME corpus — the same
  // title with the parenthesised reference dropped:
  //
  //   => Test Files  1 passed (1) / Tests 7 passed | 15 skipped (22)   exit 0
  //
  // Two zeros on one instrument would have been a broken instrument; the
  // control is what makes the first reading a reading.
  const PASTED = 'the population travels with the reading (objectui#9545)';
  const SUBSTRING = 'the population travels with the reading';
  const ESCAPED = String.raw`the population travels with the reading \(objectui#9545\)`;

  it('refuses the natural copy-paste of a title carrying a card reference', () => {
    const verdict = judge(['run', 'scripts/__tests__/body-dialect-census.test.ts', '-t', PASTED]);

    expect(verdict?.code).toBe('unmatchable-name-pattern');
    expect(verdict?.message).toContain('objectui#9660');
    // The message has to carry the mechanism — "skipped, and exit 0" is the
    // fingerprint the reader just saw on their own screen.
    expect(verdict?.message).toContain('skipped');
    expect(verdict?.message).toContain('passWithNoTests');
    // ...and hand back a command that works, not just a refusal.
    expect(verdict?.message).toContain(`-t '${ESCAPED}'`);
  });

  it('is the lit control: the metacharacter-free substring of that SAME title runs', () => {
    // The negative half. Without it this check could be refusing every `-t`,
    // and the test above would not be able to tell.
    expect(
      judge(['run', 'scripts/__tests__/body-dialect-census.test.ts', '-t', SUBSTRING])
    ).toBeNull();
  });

  it('allows the escaped spelling the refusal hands back', () => {
    // The message is only a repair if the thing it prints is accepted. Measured
    // end to end on the card: this spelling ran `Tests 7 passed | 15 skipped`.
    expect(judge(['run', '-t', ESCAPED])).toBeNull();
  });

  it('does not read anchors as the defect', () => {
    // `^…$` is a deliberate regex over a plain title and matches it exactly;
    // refusing it would make the guard fire on the most precise spelling there
    // is.
    expect(judge(['run', '-t', `^${SUBSTRING}$`])).toBeNull();
    expect(judge(['run', '-t', 'a|b'])).toBeNull();
    expect(judge(['run', '-t', 'renders.*empty'])).toBeNull();
  });

  it('reads the long spelling too', () => {
    expect(judge(['run', '--testNamePattern', PASTED])?.code).toBe('unmatchable-name-pattern');
    expect(judge(['run', `--testNamePattern=${PASTED}`])?.code).toBe('unmatchable-name-pattern');
  });

  it('refuses a pattern that is not a regex at all, under the same verdict', () => {
    // One step further along the same root cause: a title with an unbalanced
    // parenthesis. Vitest's own failure mode for this is not the point — the
    // caller still typed a literal name into a regex slot.
    expect(judge(['run', '-t', 'renders a card (objectui#1'])?.code).toBe(
      'unmatchable-name-pattern'
    );
  });

  it('says nothing about a run that passes no name filter', () => {
    expect(judge(['run'])).toBeNull();
    expect(judge(['run', '-t'])).toBeNull();
    expect(judge(['run', '-t', ''])).toBeNull();
  });

  it('leaves the one programmatic `-t` caller in this repo alone', () => {
    // `vitest-timezone-pin-8366.test.ts` spawns a child Vitest filtered by
    // `--testNamePattern` to one case. It is the only `-t` in the tree that a
    // gate runs, so a guard that refused it would turn a green pin red for a
    // reason that has nothing to do with timezones. Read from the source rather
    // than copied, so a retitled case is judged and not remembered.
    const source = fs.readFileSync(
      path.join(repoRoot, 'scripts/__tests__/vitest-timezone-pin-8366.test.ts'),
      'utf8'
    );
    const declared = source.match(/const AMBIENT_CASE = '([^']+)'/);

    expect(declared, 'the AMBIENT_CASE declaration moved or was respelled').not.toBeNull();
    expect(judgeNamePattern(declared![1])).toBeNull();
  });

  it('yields to the older verdicts, so this check only ever ADDS refusals', () => {
    // Every earlier trap keeps its own code when a vacuous `-t` rides along:
    // the new check runs last, so no invocation that was refused before is
    // refused differently now.
    expect(judge(['run', '--', '-t', PASTED])?.code).toBe('double-dash-args');
    expect(judge(['run', '-t', PASTED], { cwd: FAKE_PKG })?.code).toBe('package-cwd');
    expect(
      judge(['run', 'packages/fields/src/typo.test.ts', '-t', PASTED], { exists: () => false })
        ?.code
    ).toBe('missing-path-filter');
    expect(judge(['run', 'packages/cli/', 'packages/cli/a.test.ts', '-t', PASTED])?.code).toBe(
      'subsumed-positional-filter'
    );
    // With none of those in play, the new verdict is what is left.
    expect(judge(['run', '-t', PASTED])?.code).toBe('unmatchable-name-pattern');
  });

  it('stands down for the escape hatch like every other verdict', () => {
    expect(judge(['run', '-t', PASTED], { env: { OBJECTUI_VITEST_GUARD: 'off' } })).toBeNull();
  });
});

describe('the name-pattern helpers — what "the text it appears to spell" means', () => {
  it('reconstructs the pasted title from what the caller typed', () => {
    expect(literalReadingOfNamePattern(String.raw`prose \(objectui#7733\)`)).toBe(
      'prose (objectui#7733)'
    );
    expect(literalReadingOfNamePattern('^exact$')).toBe('exact');
    // Nothing to undo: a plain substring reads back as itself.
    expect(literalReadingOfNamePattern('plain title')).toBe('plain title');
  });

  it('escapes a title into a pattern that matches it', () => {
    const title = 'renders (objectui#1) [a] + b?';
    const escaped = escapeNamePattern(title);

    expect(new RegExp(escaped).test(title)).toBe(true);
    expect(judgeNamePattern(escaped)).toBeNull();
    // ...and the unescaped title is exactly what the guard refuses.
    expect(judgeNamePattern(title)).toBe('vacuous');
  });

  it('separates "cannot match" from "is not a regex"', () => {
    expect(judgeNamePattern('a (b)')).toBe('vacuous');
    expect(judgeNamePattern('a (b')).toBe('invalid');
    expect(judgeNamePattern('a b')).toBeNull();
  });
});

describe('evaluateVitestInvocation — the escape hatch', () => {
  it('stands down for OBJECTUI_VITEST_GUARD=off', () => {
    expect(judge(['run'], { cwd: FAKE_PKG, env: { OBJECTUI_VITEST_GUARD: 'off' } })).toBeNull();
  });

  it('is on by default (unset, or an unrelated value, does not disable it)', () => {
    expect(judge(['run'], { cwd: FAKE_PKG, env: {} })?.code).toBe('package-cwd');
    expect(judge(['run'], { cwd: FAKE_PKG, env: { OBJECTUI_VITEST_GUARD: 'on' } })?.code).toBe(
      'package-cwd'
    );
  });
});

describe('the root config actually wires the guard', () => {
  // Without this, the guard is a well-tested module nothing calls — the shape
  // objectui#2879 hit when eslint-rules shipped tests no project globbed.
  const config = fs.readFileSync(path.join(repoRoot, 'vitest.config.mts'), 'utf8');

  it('calls the guard from vitest.config.mts', () => {
    expect(config).toContain('assertCanonicalVitestInvocation({ repoRoot: __dirname })');
  });

  it('derives passWithNoTests from the CLI instead of hard-coding true', () => {
    expect(config).toContain('passWithNoTests: !cliHasTestFilters(process.argv)');
    expect(config).not.toContain('passWithNoTests: true');
  });
});

/**
 * objectui#5406 / objectui#3240 — wiring the ROOT config is not the same as
 * wiring the repo, and which files can be picked up INSTEAD of it is a property
 * of the tree, not of a docstring.
 *
 * Vitest loads whatever config it finds in the directory it was launched from.
 * The call in `vitest.config.mts` therefore only reaches a package-cwd run when
 * that directory's config resolution ends at the root file. The guard's own
 * docstring used to assert that it always does ("Every per-package
 * `vitest.config.ts` re-exports the root config") and was wrong about 11 of the
 * 18 non-root configs — they were standalone, and a run under them collected
 * the package's own files with NO alias table, going green under a config CI
 * never used.
 *
 * objectui#3240 removed the divergence at its source: the per-package vitest
 * configs are gone and the root config is the single entry, reached from a
 * package by `vitest run --root ../.. packages/<pkg>/`. That deletion moved the
 * question rather than answering it, because Vitest's fallback does not stop at
 * `vitest.config.*` — with none present it uses the directory's `vite.config.*`,
 * which every one of these packages has. Measured on `main` before the change,
 * in a package that already had no vitest config:
 *
 *   cd packages/plugin-ai && pnpm exec vitest run
 *   => RUN v4.1.10 /…/packages/plugin-ai      <- root is the PACKAGE
 *      (no guard output at all)
 *
 * So deleting 14 vitest configs would have put 14 more packages on that route —
 * widening the hole in the name of closing it. Both file kinds are therefore
 * walked below, and both blocks carry their own non-vacuity control: an
 * enumeration that silently finds nothing reports success over nothing, which is
 * the same defect class (a property declared and unenforced) in the checker
 * rather than in the thing checked.
 */
describe('objectui#5406 — every vitest config in the repo routes through the guard', () => {
  /** Directories that never hold a config we control (or hold copies of other branches). */
  const SKIP_DIRS = new Set([
    'node_modules',
    'dist',
    'build',
    'coverage',
    '.git',
    '.turbo',
    '.next',
    '.playwright-mcp',
    'playwright-report',
    'test-results',
    'storybook-static',
  ]);

  /** `vitest.config.ts` / `.mts` / `.js` / … — every spelling Vitest will load. */
  const CONFIG_NAME = /^vitest\.config\.(c|m)?[jt]s$/;
  /** The fallback Vitest uses when the directory has no `vitest.config.*`. */
  const VITE_CONFIG_NAME = /^vite\.config\.(c|m)?[jt]s$/;

  function findFiles(match: RegExp, dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // `.wt-*` are in-repo worktrees of OTHER branches (the root config
        // excludes them from every project for the same reason).
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.wt-')) continue;
        findFiles(match, path.join(dir, entry.name), out);
      } else if (entry.isFile() && match.test(entry.name)) {
        out.push(path.relative(repoRoot, path.join(dir, entry.name)).split(path.sep).join('/'));
      }
    }
    return out;
  }

  const configs = findFiles(CONFIG_NAME, repoRoot);
  const rootConfig = 'vitest.config.mts';
  const packageConfigs = configs.filter((c) => c !== rootConfig);

  const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

  // Match the IMPORT SPECIFIER, not a mention of the filename. A bare
  // `text.includes('vitest.config.mts')` was the first spelling here and it was
  // wrong in the direction that matters: the eleven standalone configs named the
  // root file in the comment explaining why they did NOT import it, so every one
  // of them classified as route 2 and the "no config skips the guard" case went
  // vacuously green over exactly the configs it exists to catch. Pinned below.
  const specifier = (module: string) =>
    new RegExp(String.raw`(?:from|import|require)\s*\(?\s*['"][^'"]*` + module + String.raw`['"]`);
  const ROOT_CONFIG_IMPORT = specifier(String.raw`vitest\.config\.mts`);
  const GUARD_IMPORT = specifier(String.raw`vitest-invocation-guard\.mjs`);

  /** Route 2: importing the root config runs its module scope, guard included. */
  const importsRootConfig = (rel: string) => ROOT_CONFIG_IMPORT.test(read(rel));
  /** Routes 3 and 4: the config imports the guard and calls it itself. */
  const callsGuard = (rel: string) => {
    const text = read(rel);
    return GUARD_IMPORT.test(text) && text.includes('assertCanonicalVitestInvocation(');
  };

  it('finds the configs — the walk is not silently empty', () => {
    // A guard whose enumeration breaks reports success over nothing. Pin that
    // the walk reaches the root file and returns the shape this repo has since
    // objectui#3240: exactly one non-root vitest config, `apps/console`'s, which
    // the root `projects` array also names by absolute path.
    expect(configs).toContain(rootConfig);
    expect(packageConfigs).toEqual(['apps/console/vitest.config.ts']);
  });

  it('leaves no config able to skip the guard', () => {
    const unguarded = packageConfigs.filter((c) => !importsRootConfig(c) && !callsGuard(c));

    expect(
      unguarded,
      `These vitest configs neither import ${rootConfig} nor call the guard, so a run launched ` +
        'from their directory skips it entirely and can go green under a config CI never uses ' +
        '(objectui#5406). Add to the top of each:\n\n' +
        "  import {\n    assertCanonicalVitestInvocation,\n    repoRootFrom,\n  } from '../../scripts/vitest-invocation-guard.mjs';\n\n" +
        '  assertCanonicalVitestInvocation({ repoRoot: repoRootFrom(import.meta.url) });\n\n' +
        'Do NOT add an exemption here — an exemption is how this guard got its hole.'
    ).toEqual([]);
  });

  it('routes the one surviving config through the root config, not around it', () => {
    // Non-vacuity for the check above: with a single config left, "no config
    // skips the guard" would also hold if that config were classified by a
    // predicate that answers true for anything. Assert the route it actually
    // takes, and that the discriminator is the IMPORT rather than the filename
    // appearing somewhere in the file.
    expect(importsRootConfig('apps/console/vitest.config.ts')).toBe(true);
    expect(ROOT_CONFIG_IMPORT.test('// mentions vitest.config.mts in prose')).toBe(false);
  });

  it('adds no per-package vitest config back under packages/ (objectui#3240)', () => {
    // The card this deletion came from measured the population growing while it
    // sat held: 17 configs at filing, 19 non-root by the time it ran. A new one
    // would not fail anything above — it would simply have to call the guard —
    // so the thing that was actually ruled is pinned here rather than left to
    // review. A package needing different test semantics states them as a
    // PROJECT in `vitest.config.mts`, where one run still yields one verdict.
    const perPackage = packageConfigs.filter((c) => c.startsWith('packages/'));
    expect(
      perPackage,
      'objectui#3240 deleted every packages/*/vitest.config.* so that one config gives one ' +
        'verdict. These reintroduce a second entry point:\n  ' +
        perPackage.join('\n  ')
    ).toEqual([]);
  });
});

/**
 * objectui#3240, route 4 — the fallback that had to be closed before the
 * per-package vitest configs could be deleted.
 *
 * With no `vitest.config.*` in a directory Vitest does not go straight to the
 * root config: it first takes that directory's `vite.config.*`. Every package
 * under `packages/` has one, and they are BUILD configs — a partial
 * `resolve.alias`, and until this card a vestigial `test` block carrying
 * `passWithNoTests: true` and a setup file the root config does not use. A run
 * there is the same false green objectui#5406 refused, reached through a
 * different door.
 *
 * The guard call in them is gated on `process.env.VITEST` because the same file
 * builds the package. Measured both ways at config-load time: under
 * `vitest run` it is `"true"`, under `vite build` it is `undefined` — so the
 * gate refuses a test run and never a build. That gating is asserted here too:
 * an ungated call would be found by the "calls the guard" check above while
 * breaking every package build, which no test in this file would notice.
 */
describe('objectui#3240 — every packages/* vite.config routes through the guard too', () => {
  const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.turbo']);

  const packagesDir = path.join(repoRoot, 'packages');
  const viteConfigs = fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name))
    .flatMap((e) =>
      fs
        .readdirSync(path.join(packagesDir, e.name), { withFileTypes: true })
        .filter((f) => f.isFile() && /^vite\.config\.(c|m)?[jt]s$/.test(f.name))
        .map((f) => `packages/${e.name}/${f.name}`)
    )
    .sort();

  const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

  it('finds them — an empty walk would pass every assertion below', () => {
    // Measured at 23 when this landed. Asserted as a floor plus a named member,
    // so adding a package does not fail it and a broken walk cannot pass it.
    expect(viteConfigs.length).toBeGreaterThanOrEqual(20);
    expect(viteConfigs).toContain('packages/plugin-grid/vite.config.ts');
  });

  it('calls the guard from every one of them', () => {
    const unguarded = viteConfigs.filter(
      (rel) => !read(rel).includes('assertCanonicalVitestInvocation(')
    );

    expect(
      unguarded,
      'Vitest falls back to these files when their package has no vitest.config.* — which is ' +
        'every package since objectui#3240 — so a run launched from their directory uses a ' +
        'BUILD config as its test config and nothing refuses it. Add to the top of each:\n\n' +
        "  import {\n    assertCanonicalVitestInvocation,\n    repoRootFrom,\n  } from '../../scripts/vitest-invocation-guard.mjs';\n\n" +
        '  if (process.env.VITEST) {\n' +
        '    assertCanonicalVitestInvocation({ repoRoot: repoRootFrom(import.meta.url) });\n' +
        '  }\n\n' +
        'Files:\n  ' +
        unguarded.join('\n  ')
    ).toEqual([]);
  });

  it('gates that call on VITEST, so `vite build` is never refused', () => {
    const ungated = viteConfigs.filter((rel) => {
      const text = read(rel);
      if (!text.includes('assertCanonicalVitestInvocation(')) return false;
      return !/if\s*\(process\.env\.VITEST\)\s*\{\s*\n\s*assertCanonicalVitestInvocation\(/.test(text);
    });

    expect(
      ungated,
      'These call the guard unconditionally. The same file is the package BUILD config, and ' +
        '`vite build` runs with the cwd inside the package — so an ungated call refuses every ' +
        'build of that package. Wrap it in `if (process.env.VITEST) { … }`:\n  ' +
        ungated.join('\n  ')
    ).toEqual([]);
  });

  it('derives the repo root instead of counting `..`', () => {
    // `repoRoot: path.resolve(__dirname, '../..')` fails SILENTLY when the count
    // is wrong: the resolved directory exists, the comparison runs, and the
    // verdict is computed against the wrong root. `repoRootFrom` searches for
    // the landmark and throws when it is not there.
    for (const rel of viteConfigs) {
      expect(read(rel), `${rel} calls the guard with a hand-counted repo root`).toContain(
        'repoRootFrom(import.meta.url)'
      );
    }
  });

  it('declares no `test` block — a build config must not carry test semantics', () => {
    // What these blocks said before objectui#3240 deleted them: `happy-dom` or
    // `jsdom`, `passWithNoTests: true`, and `setupFiles` pointing at a file the
    // root config never loads. None of it ran under the canonical invocation, so
    // it was configuration that read as live while deciding nothing — and it
    // became reachable the moment the package's vitest config was removed.
    const withTestBlock = viteConfigs.filter((rel) => /^\s{2}test:\s*\{/m.test(read(rel)));

    expect(
      withTestBlock,
      'These declare test settings in a BUILD config. The guard above refuses the only ' +
        'invocation that would read them, so they are dead config that reads as live — and if ' +
        'the guard were ever bypassed they would silently diverge from vitest.config.mts. ' +
        'Declare a project in vitest.config.mts instead:\n  ' +
        withTestBlock.join('\n  ')
    ).toEqual([]);
  });
});

describe('repoRootFrom — the landmark search the guard-calling configs use', () => {
  it('resolves the repo root from a package config, at any depth', () => {
    for (const rel of ['packages/plugin-grid/vite.config.ts', 'apps/console/vitest.config.ts']) {
      expect(repoRootFrom(pathToFileURL(path.join(repoRoot, rel)).href)).toBe(repoRoot);
    }
  });

  it('throws instead of returning a plausible-but-wrong directory', () => {
    // The failure this exists to avoid is a WRONG root, not a missing one: a
    // wrong root still compares, so the guard would keep issuing verdicts.
    expect(() => repoRootFrom(pathToFileURL('/nonexistent-objectui-5406/x.ts').href)).toThrow(
      /vitest\.config\.mts/
    );
  });

  it('composes with the verdict: a real package cwd is refused against the real root', () => {
    // End-to-end over real paths — the fake-path cases above cannot catch a
    // repoRoot that resolves to the wrong real directory.
    const cwd = path.join(repoRoot, 'packages/plugin-grid');
    const derived = repoRootFrom(pathToFileURL(path.join(cwd, 'vite.config.ts')).href);

    expect(
      evaluateVitestInvocation({
        argv: ['/usr/bin/node', path.join(repoRoot, 'bin/vitest'), 'run'],
        cwd,
        repoRoot: derived,
      })?.code
    ).toBe('package-cwd');

    // …and the canonical repo-root invocation still passes through it.
    expect(
      evaluateVitestInvocation({
        argv: ['/usr/bin/node', path.join(repoRoot, 'bin/vitest'), 'run', 'packages/plugin-grid/'],
        cwd: repoRoot,
        repoRoot: derived,
      })
    ).toBeNull();
  });
});
