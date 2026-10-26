/**
 * The gate that stops a test resolving a repository path from `process.cwd()`
 * (objectui#8953), and the floor under it.
 *
 * ## Why the enforcement lives HERE and not only in a workflow step
 *
 * Every test file under `scripts` runs inside `Test (shard N/16)`, reported by
 * the `Test` aggregator (objectui#9499), which is a
 * REQUIRED context and subscribes `merge_group` — so the scan below is what
 * actually blocks a queue build. The `Lint` step added alongside it is a second, faster
 * signal on the same gate, not the gate itself: a workflow job of one's own
 * would report on pull requests and gate nothing.
 *
 * ## The two sides, and the floor
 *
 * A gate is only worth its run time if it can FAIL, and a gate that fails on
 * things that are fine is worse than none. Both directions are pinned:
 *
 *  - it FIRES on the real historical defects — the spellings objectui#7799
 *    repaired, including the one that was invisible to that card's own census
 *    regex;
 *  - it is SILENT on the files objectui#7799 MEASURED immune under both cwds,
 *    which are a false-positive suite with readings already attached;
 *  - and the population cannot collapse: a walk that finds nothing fails
 *    instead of reporting clean.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  FLOORS,
  KNOWN_CWD_ROOTED,
  SUBJECT_IS_THE_CWD,
  scan,
  selfTest,
  sitesIn,
} from '../check-test-path-roots.mjs';

/**
 * The repo root, derived from THIS FILE's own location — never from
 * `process.cwd()`. That is the rule this file's subject enforces, and a test
 * for it that broke the rule itself would be its own first violation.
 */
const SELF_DEPTH_BELOW_REPO_ROOT = 3; // scripts / __tests__ / this file
const REPO_ROOT = decodeURIComponent(new URL(import.meta.url).pathname)
  .split('/')
  .slice(0, -SELF_DEPTH_BELOW_REPO_ROOT)
  .join('/');

const result = scan(REPO_ROOT);

/** Every filesystem call this gate would flag in `source`. */
const flagged = (source: string): ReturnType<typeof sitesIn> =>
  sitesIn('fixture/x.test.ts', source).filter((s) => s.kind === 'ambient' && s.appended);

const FS_HEAD = `import { existsSync, readFileSync, readdirSync } from 'node:fs';\nimport { join, resolve } from 'node:path';\n`;

describe('check-test-path-roots — the tree', () => {
  it('no test resolves a path below the process cwd', () => {
    expect(
      result.violations.map((v) => `${v.file}:${v.line}  ${v.sink}(${v.text})  — rooted at ${v.why}`),
    ).toEqual([]);
  });

  it('every registered entry still resolves from the cwd, so the lists cannot outlive what they excuse', () => {
    expect(result.stale).toEqual([]);
  });
});

describe('check-test-path-roots — the floor (⛔ a gate that scans nothing must not read as clean)', () => {
  it('the real walk is above every floor', () => {
    expect(result.vacuous).toEqual([]);
    for (const [counter, floor] of Object.entries(FLOORS)) {
      expect(result.census[counter as keyof typeof result.census]).toBeGreaterThanOrEqual(floor);
    }
  });

  it('a walk that finds no files FAILS rather than reporting clean', () => {
    const collapsed = scan(REPO_ROOT, { files: [] });
    expect(collapsed.violations).toEqual([]);
    // ⭐ The point: zero violations AND zero coverage is a failure, not a pass.
    expect(collapsed.vacuous.map((v) => v.counter).sort()).toEqual(Object.keys(FLOORS).sort());
  });

  it('a walk that finds files but no filesystem call also FAILS', () => {
    const noSinks = scan(REPO_ROOT, { files: Array.from({ length: 5000 }, (_, i) => `fake/${i}.test.ts`) });
    expect(noSinks.census.testFiles).toBeGreaterThanOrEqual(FLOORS.testFiles);
    expect(noSinks.vacuous.map((v) => v.counter)).toContain('sinkCalls');
  });
});

describe('check-test-path-roots — it FIRES on the real defects (⛔ not only on synthetic ones)', () => {
  it('the plain idiom objectui#7799 repaired twelve times', () => {
    expect(flagged(`${FS_HEAD}const p = join(process.cwd(), 'scripts/i18n-call-site-key-baseline.json');\nreadFileSync(p);`)).not.toEqual([]);
  });

  it('⭐ the thirteenth defect, which objectui#7799\'s OWN census regex could not see', () => {
    // Verbatim from `container-declaration-ratchet.test.tsx` as PR #7806 found
    // it. A gate that greps `process.cwd` finds the other twelve and misses
    // this one, which is the failure mode this card was filed under.
    const hidden = `${FS_HEAD}const BASELINE_PATH = join(
      (globalThis as unknown as { process: { cwd(): string } }).process.cwd(),
      'scripts/container-declaration-baseline.json',
    );
    readFileSync(BASELINE_PATH, 'utf8');`;
    expect(flagged(hidden)).not.toEqual([]);
    expect(/process\.cwd\(\)/.test(hidden.replace(/\(globalThis[\s\S]*?\)\.process\.cwd\(\)/, ''))).toBe(false);
  });

  it('the shape found in the tree by this gate and by nothing else: a root laundered through a const', () => {
    // `examples/schema-catalog/test/*-gallery-render.test.tsx`, repaired in the
    // same change. The line that reads the file carries no `cwd` at all.
    const laundered = `${FS_HEAD}const siteDir = join(process.cwd(), 'apps/site/app/components');\nconst read = (f: string) => readFileSync(join(siteDir, f), 'utf8');`;
    const sites = flagged(laundered);
    expect(sites).not.toEqual([]);
    expect(sites[0].why).toContain('siteDir');
  });

  it('a bare relative path, which names no root and so carries no `cwd` token to grep for', () => {
    expect(flagged(`${FS_HEAD}readFileSync('e2e/live/.auth/state.json', 'utf8');`)).not.toEqual([]);
  });

  it('`process.env.PWD`, `resolve()` with a relative argument, and a template literal', () => {
    expect(flagged(`${FS_HEAD}readFileSync(join(process.env.PWD as string, 'packages/x/y.ts'));`)).not.toEqual([]);
    expect(flagged(`${FS_HEAD}readFileSync(resolve('packages/x/y.ts'));`)).not.toEqual([]);
    expect(flagged(`${FS_HEAD}const r = process.cwd();\nreadFileSync(\`\${r}/packages/x/y.ts\`);`)).not.toEqual([]);
  });
});

describe('check-test-path-roots — it is SILENT on what objectui#7799 MEASURED immune', () => {
  /**
   * The false-positive suite, with readings already attached: PR #7806
   * counter-probed all four under both cwds and the `cli` probe really did
   * fire, which is what makes the other three greens a reading rather than a
   * probe that was never connected.
   *
   * ⚠️ The card objectui#8953 and its dispatch both say SIX. The measured
   * per-file table in PR #7806's report names FOUR: the census was 16 files,
   * plus the 17th the regex could not see, of which 13 were repaired. `19 − 13
   * = 6` is arithmetic on a total that was never measured.
   */
  const MEASURED_IMMUNE = [
    'packages/cli/src/__tests__/app-generator.test.ts',
    'packages/plugin-view/src/__tests__/ObjectView.hostOnlyViewTypes.test.tsx',
    'packages/plugin-view/src/__tests__/ViewSwitcher.test.tsx',
    'packages/plugin-view/src/__tests__/objectViewHostSurface.test.tsx',
  ];

  it('none of them is an unregistered violation', () => {
    const files = new Set(result.violations.map((v) => v.file));
    expect(MEASURED_IMMUNE.filter((f) => files.has(f))).toEqual([]);
  });

  it('all four are still in the tree, or the case above tests nothing', () => {
    for (const file of MEASURED_IMMUNE) expect(() => readFileSync(join(REPO_ROOT, file), 'utf8')).not.toThrow();
  });

  it('⚠️ three of the four are silent because the gate CANNOT CLASSIFY them, which is not the same as a clean verdict', () => {
    // The `plugin-view` three probe two candidate paths and take whichever
    // exists, so the root arrives out of `Array#find` and `rootOf` stops there.
    // Pinning this keeps the distinction visible: `--blind` counts them, and a
    // silent gate is not a statement about them.
    const probes = result.sites.filter(
      (s) => s.file.startsWith('packages/plugin-view/src/__tests__/') && MEASURED_IMMUNE.includes(s.file),
    );
    expect(probes.length).toBeGreaterThan(0);
    expect(probes.every((s) => s.kind === 'unknown')).toBe(true);
  });

  it('the cwd read PR #7806 deliberately KEPT is not a violation: nothing is appended to it', () => {
    // `browser-process-shim-scope.test.ts` exists to compile a `process.cwd()`
    // call. It asserts the binding names a real absolute directory and takes
    // its repo-root claim from a file-derived root instead. The rule gets that
    // right with no entry in any list.
    expect(flagged(`${FS_HEAD}const cwd = process.cwd();\nexistsSync(cwd);`)).toEqual([]);
    const shim = result.sites.filter((s) => s.file === 'packages/components/src/__tests__/browser-process-shim-scope.test.ts');
    expect(shim.length).toBeGreaterThan(0);
    expect(shim.filter((s) => s.kind === 'ambient' && s.appended)).toEqual([]);
  });

  it('the landed repair spelling, the two-argument `new URL` form, `__dirname` and temp dirs are all silent', () => {
    expect(
      flagged(
        `${FS_HEAD}const REPO = decodeURIComponent(new URL(import.meta.url).pathname).split('/').slice(0, -5).join('/');\nreadFileSync(join(REPO, 'packages/x/y.ts'));`,
      ),
    ).toEqual([]);
    expect(flagged(`${FS_HEAD}import { fileURLToPath } from 'node:url';\nreadFileSync(fileURLToPath(new URL('../x.ts', import.meta.url)));`)).toEqual([]);
    expect(flagged(`${FS_HEAD}readFileSync(join(__dirname, '../x.ts'));`)).toEqual([]);
    expect(
      flagged(`${FS_HEAD}import { mkdtempSync } from 'node:fs';\nimport { tmpdir } from 'node:os';\nconst d = mkdtempSync(join(tmpdir(), 'x-'));\nreadFileSync(join(d, 'a.txt'));`),
    ).toEqual([]);
  });

  it('a LOCAL helper that shares a node:fs name is not a filesystem call', () => {
    // `packages/cli/src/__tests__/check-jsonc-parse.test.ts` declares its own
    // `writeFile(name, body)` that writes into a `mkdtemp` directory. Matching
    // the NAME reports twelve violations there; matching the IMPORT reports
    // none, which is the true answer.
    expect(flagged(`function writeFile(name: string) { void name; }\nwriteFile('tsconfig.json');`)).toEqual([]);
  });

  it('`require.resolve` through a `createRequire` binding answers from the module graph, not the cwd', () => {
    expect(
      flagged(
        `${FS_HEAD}import { createRequire } from 'node:module';\nconst require_ = createRequire(import.meta.url);\nconst d = require_.resolve('@objectstack/spec/package.json');\nreadFileSync(join(d, 'package.json'));`,
      ),
    ).toEqual([]);
  });
});

describe('check-test-path-roots — the registries', () => {
  it('every entry carries a reason, so nothing is silently excused', () => {
    for (const entry of [...SUBJECT_IS_THE_CWD, ...KNOWN_CWD_ROOTED]) {
      expect(entry).toMatch(/^[\w./@-]+:\d+ -- \S/);
      expect(entry.split(' -- ')[1].length).toBeGreaterThan(40);
    }
  });

  it('⛔ `KNOWN_CWD_ROOTED` is SHRINK-ONLY — this is the ratchet, in one number', () => {
    // At ZERO since objectui#9188 repaired the last entry. The bound follows the
    // list down and never back up: re-admitting an instance of this class has to
    // move this number, in a diff a reviewer reads, rather than land quietly
    // inside a registry that still had room.
    expect(KNOWN_CWD_ROOTED.length).toBeLessThanOrEqual(0);
  });
});

describe('check-test-path-roots — the gate itself', () => {
  it('its own self-test passes', () => {
    expect(selfTest()).toBe(0);
  });

  it('the run is wired where CI executes it', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['check:test-path-roots']).toBe('node scripts/check-test-path-roots.mjs');

    // `Lint` is in `REQUIRED_CONTEXTS` and subscribes `merge_group`; a step
    // inside it gates without adding a context to the queue's required set.
    const lint = readFileSync(join(REPO_ROOT, '.github/workflows/lint.yml'), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');
    expect(lint).toContain('node scripts/check-test-path-roots.mjs');
  });

  it('it goes through the one entry-guard predicate rather than hand-typing one', () => {
    const source = readFileSync(join(REPO_ROOT, 'scripts/check-test-path-roots.mjs'), 'utf8');
    expect(source).toContain("import { isEntrypoint } from './invoked-as.mjs';");
    expect(source).not.toContain('process.argv[1]');
  });

  it('⚠️ it reports its own blind spot on every run, so silence cannot read as coverage', () => {
    const printed = execFileSync('node', ['scripts/check-test-path-roots.mjs'], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(printed).toContain('NOT CLASSIFIED');
    expect(result.census.unclassifiedRoots).toBeGreaterThan(0);
    // The census is a partition: every filesystem call lands in exactly one class.
    const { selfRooted, absoluteRooted, moduleRooted, ambientRooted, unclassifiedRoots, sinkCalls } = result.census;
    expect(selfRooted + absoluteRooted + moduleRooted + ambientRooted + unclassifiedRoots).toBe(sinkCalls);
  });
});
