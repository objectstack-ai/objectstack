import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * objectui#9106 — the three workspace members that have NO test files anywhere,
 * recorded as an explicit exclusion from the package-`test`-script class, in the
 * one place a future derivation of that class has to read.
 *
 * ## Why this file exists rather than a sentence somewhere
 *
 * objectui#8991 derived the population "workspace members with no `test` script"
 * by invoking every manifest, split it into two groups, fixed one group
 * (objectui#9105 gave `packages/layout`, `packages/test-support` and
 * `examples/console-starter` the standard filtered entry) and stopped on the
 * other. It then landed NOTHING that records the derivation — measured on
 * `1e0e46af9`, `git grep -ln 8991 -- scripts packages apps examples` returns two
 * incidental files, a vector fixture and a screenshot. So the next person to
 * derive this population re-discovers these three and re-asks the same question,
 * which is exactly what produced objectui#9106.
 *
 * A prose exclusion is the thing this repo has already proved does not hold, in
 * this very directory and about this very subject:
 * `scripts/vitest-invocation-guard.mjs`'s own docstring asserted that every
 * per-package vitest config re-exports the root config while ELEVEN standalone
 * ones did not (objectui#5406), and the remedy was to make
 * `scripts/__tests__/vitest-invocation-guard.test.ts` walk the repo instead.
 * This file is that shape.
 *
 * ## The measurement the exclusion rests on, re-run on `1e0e46af9`
 *
 * From the repo root, all four in one sitting (the fourth is the control of
 * known direction — three 1s with no 0 beside them is a broken harness, not a
 * measurement):
 *
 *   pnpm exec vitest run apps/site/                     exit 1  no test files found
 *   pnpm exec vitest run examples/hello-world/          exit 1  no test files found
 *   pnpm exec vitest run examples/byo-backend-console/  exit 1  no test files found
 *   pnpm exec vitest run packages/layout/               exit 0  21 files, 217 tests
 *
 * The exit 1 is the root config working as designed: it does not set
 * `passWithNoTests` to a constant, it sets it to the negation of whether the CLI
 * named test filters, so a positional filter collecting nothing is precisely the
 * case it rejects loudly. That premise is pinned below, because the whole reason
 * these three get no `test` script depends on it.
 *
 * ⇒ giving them a `test` script would need `--passWithNoTests`, which would make
 * the package entry exit 0 while the root-config comparison exits 1 —
 * manufacturing divergence between exactly the two invocations objectui#8991's
 * acceptance requires to AGREE, in the name of closing the card. The board
 * carries the class one repo over (objectstack#13799: "a battery that never ran
 * is indistinguishable from one that passed").
 *
 * ## The property that makes this an exclusion and not a permanent excuse
 *
 * The list below is asserted by EQUALITY against a derivation, not by subset, so
 * it goes red in both directions:
 *
 *  1. a member with no `test` script and no test files appears and is not on the
 *     list — nobody adjudicated it;
 *  2. a listed member stops being one — it gains a test file, or gains a `test`
 *     script — so the exclusion has EXPIRED and must be removed, not renewed.
 *
 * Direction 2 is the one that matters and the one a subset assertion silently
 * drops. `scripts/__tests__/runner-package-test-entry-3746.test.ts` records its
 * `BARE_ENTRY_BASELINE` as a deliberate ceiling ("may shrink and must not grow")
 * and is therefore green forever once a listed package leaves the population;
 * that is the right call for a ceiling being worked down, and the wrong one for
 * an exclusion that is supposed to end.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROOT_VITEST_CONFIG = path.join(repoRoot, 'vitest.config.mts');
const WORKSPACE_YAML = path.join(repoRoot, 'pnpm-workspace.yaml');

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

/**
 * Workspace members that have no `test` script AND no test file anywhere, with
 * the reason each one is here. ⛔ Do not add a row to make this file green: a new
 * row is an adjudication, and the two questions it answers are "does this member
 * have tests that nothing runs" (then give it the standard filtered entry, as
 * objectui#9105 did) and "is it genuinely test-less" (then record it here).
 */
const ZERO_TEST_MEMBERS = [
  {
    dir: 'apps/site',
    pkgName: '@object-ui/site',
    // A second, independent reason, re-derived below: no vitest project collects
    // this directory at all, so any positional entry would be green by
    // construction and could never notice a test file appearing.
    why: 'the docs site; no test files, and no vitest project covers apps/site',
  },
  {
    dir: 'examples/byo-backend-console',
    pkgName: '@object-ui/example-byo-backend-console',
    why: 'a runnable example app; no test files',
  },
  {
    dir: 'examples/hello-world',
    pkgName: '@object-ui/example-hello-world',
    why: 'a runnable example app; no test files',
  },
] as const;

type Member = {
  /** Repo-relative directory, e.g. `packages/layout`. */
  dir: string;
  pkgName: string;
  testScript: string | null;
  testFileCount: number;
};

/**
 * The workspace globs, read from `pnpm-workspace.yaml` rather than hard-coded.
 *
 * The two existing pins in this directory both spell `['packages','apps','examples']`
 * as a literal. That is correct today and silently incomplete the day a fourth
 * group is added — and a derivation that quietly stops covering part of the
 * workspace is the failure mode this whole file is about.
 */
function workspaceGroups(): string[] {
  const text = fs.readFileSync(WORKSPACE_YAML, 'utf8');
  const groups: string[] = [];
  let inPackages = false;

  for (const rawLine of text.split('\n')) {
    if (/^packages:\s*$/.test(rawLine)) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^\S/.test(rawLine)) break;
    if (!inPackages) continue;

    const match = rawLine.match(/^\s*-\s*'?"?([^'"\s]+)"?'?\s*$/);
    if (match) groups.push(match[1]);
  }

  return groups;
}

/** Every directory in the workspace that actually carries a `package.json`. */
function memberDirs(): string[] {
  const dirs = new Set<string>();

  for (const group of workspaceGroups()) {
    if (group.endsWith('/*')) {
      const base = group.slice(0, -2);
      const abs = path.join(repoRoot, base);
      if (!fs.existsSync(abs)) continue;
      for (const name of fs.readdirSync(abs).sort()) {
        if (fs.existsSync(path.join(abs, name, 'package.json'))) dirs.add(`${base}/${name}`);
      }
      continue;
    }
    // A literal directory entry (`docs`). It carries no manifest today; the
    // workspace tolerates that, so this does too — silently, because the count
    // control below is what notices a group going missing.
    if (fs.existsSync(path.join(repoRoot, group, 'package.json'))) dirs.add(group);
  }

  return [...dirs].sort();
}

/**
 * Test files under a member directory.
 *
 * Skips the same two directories the sibling pins skip (`node_modules`, `dist`)
 * plus dot-directories: the root config's shared exclude list drops
 * `.{idea,git,cache,output,temp}`, `.claude` and `.wt-*`, and `apps/site` carries
 * a generated `.source/` tree. Counting a file the root config would never
 * collect would make a member look testable when the runner disagrees.
 */
function collectTestFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
      continue;
    }
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTestFiles(abs));
    else if (TEST_FILE.test(entry.name)) out.push(abs);
  }
  return out;
}

function readMembers(): Member[] {
  return memberDirs().map((dir) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, dir, 'package.json'), 'utf8')) as {
      name?: string;
      scripts?: Record<string, string>;
    };
    return {
      dir,
      pkgName: pkg.name ?? '',
      testScript: pkg.scripts?.test ?? null,
      testFileCount: collectTestFiles(path.join(repoRoot, dir)).length,
    };
  });
}

const members = readMembers();
const rootConfigText = fs.readFileSync(ROOT_VITEST_CONFIG, 'utf8');

const withScriptAndFiles = members.filter((m) => m.testScript !== null && m.testFileCount > 0);
const withScriptNoFiles = members.filter((m) => m.testScript !== null && m.testFileCount === 0);
const noScriptWithFiles = members.filter((m) => m.testScript === null && m.testFileCount > 0);
const noScriptNoFiles = members.filter((m) => m.testScript === null && m.testFileCount === 0);

describe('objectui#9106 — the derivation itself can fail', () => {
  it('reads the workspace groups instead of assuming them', () => {
    // Vacuity control: a parser that returned [] would make every assertion in
    // this file pass over an empty population.
    const groups = workspaceGroups();
    expect(groups).toContain('packages/*');
    expect(groups).toContain('apps/*');
    expect(groups).toContain('examples/*');
  });

  it('finds the whole workspace, not a slice of it', () => {
    // Measured on 1e0e46af9: 46 manifests under the three globbed groups.
    // A floor, not an equality — new packages are routine — but a floor low
    // enough to be honest and high enough that a half-broken enumeration fails.
    expect(members.length).toBeGreaterThanOrEqual(40);
    expect(members.map((m) => m.dir)).toContain('packages/layout');
    expect(members.map((m) => m.dir)).toContain('apps/console');
  });

  it('can see test files where test files are', () => {
    // The negative control for `collectTestFiles`: a collector that returned []
    // for everything would put all 46 members in the excluded bucket and this
    // file would then be asserting nothing at all.
    const layout = members.find((m) => m.dir === 'packages/layout');
    expect(layout?.testFileCount).toBeGreaterThan(0);
    expect(withScriptAndFiles.length).toBeGreaterThanOrEqual(40);
  });
});

describe('objectui#9106 — the zero-test exclusion, asserted by EQUALITY so it can expire', () => {
  it('names exactly the members that have neither a `test` script nor a test file', () => {
    const derived = noScriptNoFiles.map((m) => m.dir).sort();
    const recorded = ZERO_TEST_MEMBERS.map((m) => m.dir).sort();

    expect(
      derived,
      'The zero-test workspace members no longer match the recorded exclusion.\n' +
        `  derived:  ${derived.join(', ') || '(none)'}\n` +
        `  recorded: ${recorded.join(', ')}\n` +
        'A member in `derived` but not `recorded` has never been adjudicated: either give ' +
        'it the standard filtered entry (`vitest run --root ../.. DIR/`) if it has tests ' +
        'nothing runs, or add it here with the reason.\n' +
        'A member in `recorded` but not `derived` means the exclusion EXPIRED — it gained ' +
        'a test file or a `test` script. ⛔ Delete its row; do NOT relax this assertion ' +
        'to a subset (objectui#9106).'
    ).toEqual(recorded);
  });

  for (const entry of ZERO_TEST_MEMBERS) {
    describe(entry.dir, () => {
      const member = members.find((m) => m.dir === entry.dir);

      it('is still a workspace member under the recorded package name', () => {
        expect(member, `${entry.dir} is no longer a workspace member`).toBeDefined();
        expect(member!.pkgName).toBe(entry.pkgName);
      });

      it('still has no test file anywhere — the moment it does, this exclusion is over', () => {
        expect(
          member!.testFileCount,
          `${entry.dir} now carries test files. Nothing runs them: it has no \`test\` script ` +
            'and the root-config invocation was the only other route. Give it ' +
            `\`"test": "vitest run --root ../.. ${entry.dir}/"\` and delete its row here.`
        ).toBe(0);
      });

      it('still declares no `test` script — a green entry over nothing is what this prevents', () => {
        expect(
          member!.testScript,
          `${entry.dir} gained a \`test\` script (${member!.testScript}). If it has tests now, ` +
            'delete its row here. If it does not, that entry can only pass via ' +
            '`--passWithNoTests`, which is the exit-0-having-run-nothing shape objectui#9106 ' +
            'exists to refuse.'
        ).toBeNull();
      });
    });
  }
});

describe('objectui#9106 — the two buckets either side of the exclusion', () => {
  it('leaves no member with test files that nothing runs (objectui#8991 stays closed)', () => {
    expect(
      noScriptWithFiles.map((m) => `${m.dir} (${m.testFileCount} test files)`),
      'These members carry test files and declare no `test` script, so ' +
        '`pnpm --filter PKG test` exits 0 having run nothing — the objectui#8991 defect. ' +
        'Give each the standard filtered entry: "vitest run --root ../.. DIR/".'
    ).toEqual([]);
  });

  it('leaves no member whose `test` script can only ever collect zero files', () => {
    expect(
      withScriptNoFiles.map((m) => `${m.dir} → ${m.testScript}`),
      'These members declare a `test` script and have no test files. Measured on ' +
        '1e0e46af9, a positional filter that collects nothing exits 1 — so this entry is ' +
        'permanently red, unless it reaches for `--passWithNoTests` and becomes ' +
        'permanently green over nothing. Neither is a state to land in: add tests, or ' +
        'drop the script and record the member in ZERO_TEST_MEMBERS.'
    ).toEqual([]);
  });
});

describe('objectui#9106 — the premises the exclusion rests on', () => {
  it('the root config still derives passWithNoTests from the CLI, so a named path that collects nothing is loud', () => {
    // If this ever becomes a constant `true`, the measured exit 1 above stops
    // being true and the reason these three have no `test` script needs
    // re-reading rather than re-spelling.
    expect(rootConfigText).toMatch(/passWithNoTests:\s*!cliHasTestFilters\(process\.argv\)/);
  });

  it('apps/site is reached by NO vitest project, which is why no entry could work for it', () => {
    // Re-derived, not cited. objectui#8240 established for `apps/console` that an
    // app comes back through the root config's `projects` array as its OWN
    // project rooted at the app directory, so a positional naming `apps/console/`
    // is matched against project-relative paths and can never contain it.
    //
    // For `apps/site` that mechanism does not even get to apply, and the reason
    // is stronger: `apps/site` is in no project at all. The root-level projects
    // exclude `apps/**` and their include globs name packages/examples/
    // eslint-rules/scripts, and the only app config the `projects` array pulls in
    // is the console's. So a `--passWithNoTests` positional entry for apps/site
    // would be green BY CONSTRUCTION, and `--project @object-ui/site` names a
    // project that does not exist.
    expect(rootConfigText).toContain("'./apps/console/vitest.config.ts'");
    expect(rootConfigText).not.toContain('./apps/site/vitest.config.ts');
    expect(fs.existsSync(path.join(repoRoot, 'apps/site/vitest.config.ts'))).toBe(false);
    expect(rootConfigText).toContain("'apps/**'");
  });
});
