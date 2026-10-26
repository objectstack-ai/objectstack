import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here —
// re-adding one is now itself an error (TS2578). See objectui#3494.
import {
  CALL_RE,
  FLOORS,
  SOURCE_EXTENSIONS,
  candidatesFor,
  findCallSites,
  resolveSpecifier,
  scan,
  summarise,
} from '../check-vi-mock-specifiers.mjs';

/**
 * objectui#5646 — the test for `scripts/check-vi-mock-specifiers.mjs`.
 *
 * ## Why this file carries more weight than usual
 *
 * The tree has ZERO unresolvable specifiers and is expected to keep having zero,
 * so a green run of the gate over this repo proves only that the tree is clean.
 * It cannot distinguish a working gate from one that matches nothing at all —
 * which is this card's own defect, one level up.
 *
 * So the ABLATION below is the evidence the gate exists. It is not synthetic:
 * the fixture tree reproduces the geometry of the real instance (PR #5645), and
 * `THE HISTORICAL INSTANCE` reconstructs the exact specifier that was written.
 * The discriminating half sits right beside it — the neighbours in that same
 * real file step up one level and two levels and are BOTH correct, so a
 * resolver that got depth wrong would flag them and be deleted by the first
 * person it annoyed.
 *
 * ## Fixture discipline: never write a matchable call site into this source
 *
 * This file is inside the gate's own scan scope. Two things keep its fixtures
 * out of the repo census, and they are belt and braces on purpose:
 *
 *   1. every fixture is built through `mockCall()`, which interpolates the
 *      quote — the source text here reads `vi.${fn}(` and the pattern needs a
 *      literal `mock`/`doMock` followed by a quote, so it never matches;
 *   2. and any text that DID match would be inside a string literal, which the
 *      gate classifies as `embedded` and declines to judge anyway.
 *
 * The first is what keeps the census figure honest: without it this suite's
 * fixtures would dominate the `embedded` count and drown the real signal.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A quote, from its code point — see "Fixture discipline" above. */
const Q = String.fromCharCode(39);

/** A mock call as SOURCE TEXT, unmatchable in this file, matchable on disk. */
const mockCall = (spec: string, fn: 'mock' | 'doMock' = 'mock') => `vi.${fn}(${Q}${spec}${Q}, () => ({}));`;

/** The same, in the `import()` form the dispatch ruling asked to cover for free. */
const mockCallViaImport = (spec: string) => `vi.${'mock'}(import(${Q}${spec}${Q}), () => ({}));`;

/** Build a throwaway tree and hand back its root plus a relative file list. */
function fixtureTree(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-vi-mock-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return { root, files: Object.keys(files) };
}

/** Fixture scans pass their own file list and switch the floors off. */
const scanFixture = (root: string, files: string[]) => scan(root, { files, floors: {} });

// ---------------------------------------------------------------------------
// The pattern
// ---------------------------------------------------------------------------

describe('findCallSites — what counts as a call site at all', () => {
  it('matches both mock functions and classifies a relative specifier', () => {
    const sites = findCallSites([mockCall('./a'), mockCall('../b', 'doMock')].join('\n'));
    expect(sites.map((s: { fn: string; specifier: string; kind: string }) => [s.fn, s.specifier, s.kind])).toEqual([
      ['mock', './a', 'relative'],
      ['doMock', '../b', 'relative'],
    ]);
  });

  it('classifies a bare specifier as out of scope rather than judging it', () => {
    const sites = findCallSites(mockCall('@object-ui/react'));
    expect(sites[0].kind).toBe('bare');
  });

  it('covers the import() form, and marks it as such', () => {
    const sites = findCallSites(mockCallViaImport('../thing'));
    expect(sites).toHaveLength(1);
    expect(sites[0].kind).toBe('relative');
    expect(sites[0].viaImport).toBe(true);
  });

  it('reports the line the call is on, so a finding is navigable', () => {
    const sites = findCallSites(['// a comment', '', mockCall('./a')].join('\n'));
    expect(sites[0].line).toBe(3);
  });

  it('leaves an interpolated specifier unjudged instead of guessing at it', () => {
    // Not a static path, so there is nothing to resolve. Counted, never resolved.
    const sites = findCallSites(`vi.${'mock'}(\`./\${name}\`, () => ({}));`);
    expect(sites[0].kind).toBe('dynamic');
  });

  it('does not match a mention with no specifier — prose and partial calls', () => {
    expect(findCallSites('see vi.mock(..., ...) for details')).toEqual([]);
  });

  it('is a global pattern that is safe to reuse (lastIndex is reset per call)', () => {
    const src = mockCall('./a');
    expect(findCallSites(src)).toHaveLength(1);
    expect(findCallSites(src)).toHaveLength(1);
    expect(CALL_RE.global).toBe(true);
  });
});

describe('findCallSites — only text the language would execute', () => {
  it('ignores a commented-out mock: it is not executed, so it cannot be inert', () => {
    expect(findCallSites(`// ${mockCall('./gone')}`)).toEqual([]);
    expect(findCallSites(`/* ${mockCall('./gone')} */`)).toEqual([]);
  });

  it('counts a call quoted inside a literal as `embedded`, and does not judge it', () => {
    // The real instance of this shape:
    // `eslint-rules/no-dynamic-import-in-test-hook.test.js` lints code SAMPLES
    // held in template literals, and one of them mocks a fictional './dep'. An
    // ESLint fixture is source text — there is no directory it is relative to
    // and no mock to be inert, so flagging it fabricates a finding.
    const sites = findCallSites(`const sample = \`beforeAll(() => { ${mockCall('./dep', 'doMock')} });\`;`);
    expect(sites).toHaveLength(1);
    expect(sites[0].kind).toBe('embedded');
  });

  it('separates the two by the CALL TOKEN, not by the specifier', () => {
    // Both spellings below carry an identical specifier. Nothing about it
    // separates them; only whether `vi` is code does.
    const real = findCallSites(mockCall('./dep'));
    const quoted = findCallSites(`const s = \`${mockCall('./dep')}\`;`);
    expect(real[0].specifier).toBe(quoted[0].specifier);
    expect([real[0].kind, quoted[0].kind]).toEqual(['relative', 'embedded']);
  });

  it('still sees a real call in a file that also holds prose about one', () => {
    // The blinding direction: a mask that dropped too much would report clean
    // over live code. This gate's own header quotes the defect in prose.
    const sites = findCallSites([`/** docs mentioning ${mockCall('./prose')} */`, mockCall('./real')].join('\n'));
    expect(sites.map((s: { specifier: string }) => s.specifier)).toEqual(['./real']);
  });
});

// ---------------------------------------------------------------------------
// The resolver
// ---------------------------------------------------------------------------

describe('resolveSpecifier — the ladder this repo actually needs', () => {
  const { root } = fixtureTree({
    'src/runtime-config.ts': 'export const x = 1;\n',
    'src/hooks/surfaceAgent.ts': 'export const a = 1;\n',
    'src/hooks/index.ts': 'export * from "./surfaceAgent";\n',
    'src/layout/AiUsageIndicator.tsx': 'export const C = () => null;\n',
    'src/legacy/thing.jsx': 'export const y = 1;\n',
    'src/empty-dir/.keep': '',
  });
  const from = path.join(root, 'src/layout/__tests__');

  const resolves = (spec: string) => Boolean(resolveSpecifier(from, spec).resolved);

  it('resolves a bare path by appending an extension', () => {
    expect(resolves('../../runtime-config')).toBe(true);
    expect(resolves('../AiUsageIndicator')).toBe(true);
  });

  it('resolves a directory specifier through its index file', () => {
    expect(resolves('../../hooks')).toBe(true);
  });

  it('strips a trailing .js — src/ is NodeNext throughout', () => {
    expect(resolves('../../runtime-config.js')).toBe(true);
    expect(resolves('../../hooks/surfaceAgent.js')).toBe(true);
    // ...and the same for the sibling JS-ish extensions. `thing.jsx` really is
    // on disk here, so this leg is about the extension, not about the depth.
    expect(resolves('../../legacy/thing.jsx')).toBe(true);
  });

  it('does NOT accept a directory that has no index — isFile, not existsSync', () => {
    // The directory exists. A bare existence check would call this resolved and
    // let a real inert mock through.
    expect(fs.existsSync(path.join(root, 'src/empty-dir'))).toBe(true);
    expect(resolves('../../empty-dir')).toBe(false);
  });

  it('reports a miss, with the candidates it tried', () => {
    const { resolved, tried } = resolveSpecifier(from, './nowhere');
    expect(resolved).toBeNull();
    expect(tried.length).toBeGreaterThan(1);
    expect(tried[0]).toBe(path.join(from, 'nowhere'));
  });

  it('offers every declared extension, and the index form of each', () => {
    const tried = candidatesFor(from, '../x');
    for (const ext of SOURCE_EXTENSIONS) {
      expect(tried).toContain(path.join(root, 'src/layout', `x${ext}`));
      expect(tried).toContain(path.join(root, 'src/layout/x', `index${ext}`));
    }
  });
});

// ---------------------------------------------------------------------------
// THE ABLATION — the real historical instance, and its correct neighbours
// ---------------------------------------------------------------------------

describe('ablation — PR #5645, reconstructed', () => {
  /**
   * The geometry of the real file, reproduced: the suite sits in
   * `layout/__tests__/`, one mock target is a sibling of `layout/` and another
   * is two levels up in `src/`. That difference in depth is the whole reason the
   * bug was invisible to a reader scanning the mock block.
   */
  const tree = {
    'src/runtime-config.ts': 'export const getRuntimeConfig = () => ({});\n',
    'src/hooks/surfaceAgent.ts': 'export const resolveSurfaceAgent = () => null;\n',
    'src/hooks/index.ts': 'export * from "./surfaceAgent";\n',
    'src/layout/AiUsageIndicator.tsx': 'export const AiUsageIndicator = () => null;\n',
  };

  const suiteAt = 'src/layout/__tests__/ChatDock.partialRuntimeConfig.test.tsx';

  const runWith = (mockBlock: string[]) => {
    const { root, files } = fixtureTree({ ...tree, [suiteAt]: `${mockBlock.join('\n')}\n` });
    return scanFixture(root, files);
  };

  const flagged = (result: { unresolvable: { specifier: string }[] }) =>
    result.unresolvable.map((u) => u.specifier);

  it('THE HISTORICAL INSTANCE: one .. short, and the gate goes RED', () => {
    // What PR #5645 actually wrote. The suite passed — it passed even with the
    // code under test reverted to the shape the suite was written to catch.
    const result = runWith([mockCall('../runtime-config')]);
    expect(flagged(result)).toEqual(['../runtime-config']);
  });

  it('the corrected specifier resolves — the fix is recognised as a fix', () => {
    expect(flagged(runWith([mockCall('../../runtime-config')]))).toEqual([]);
  });

  it('THE DISCRIMINATING HALF: the correct neighbours are NOT flagged', () => {
    // Both are real specifiers from that same file, at DIFFERENT depths, and
    // both are correct. A resolver that got depth wrong flags these — and a
    // gate that flags hundreds of correct call sites gets deleted, not fixed.
    const result = runWith([
      mockCall('../AiUsageIndicator'), //        one level up  — a sibling of layout/
      mockCall('../../hooks/surfaceAgent'), //   two levels up — under src/
      mockCall('../../hooks'), //                two levels up — resolved via index
      mockCall('@object-ui/i18n'), //            bare — out of scope, never judged
    ]);
    expect(flagged(result)).toEqual([]);
    expect(result.census.relative).toBe(3);
    expect(result.census.bare).toBe(1);
  });

  it('catches the broken one while its correct neighbours sit around it', () => {
    // The mock block as the file really reads: a plausible mix of depths with
    // exactly one wrong. This is the case a human reviewer failed.
    const result = runWith([
      mockCall('@object-ui/i18n'),
      mockCall('../runtime-config'), // the defect
      mockCall('../../hooks/surfaceAgent'),
      mockCall('../../hooks'),
      mockCall('../AiUsageIndicator'),
    ]);
    expect(flagged(result)).toEqual(['../runtime-config']);
  });

  it('names the file and the line, so the finding is actionable', () => {
    const result = runWith([mockCall('@object-ui/i18n'), mockCall('../runtime-config')]);
    expect(result.unresolvable[0].file).toBe(suiteAt);
    expect(result.unresolvable[0].line).toBe(2);
  });

  it('catches the same defect written as vi.doMock and as the import() form', () => {
    expect(flagged(runWith([mockCall('../runtime-config', 'doMock')]))).toEqual(['../runtime-config']);
    expect(flagged(runWith([mockCallViaImport('../runtime-config')]))).toEqual(['../runtime-config']);
  });

  it('judges a setup file too — the walk is not restricted to test-NAMED files', () => {
    // Measured on this tree: two files carrying real call sites match no
    // test-file naming convention at all, and both are vitest setup files.
    const { root, files } = fixtureTree({ ...tree, 'vitest.setup.ts': `${mockCall('../runtime-config')}\n` });
    expect(flagged(scanFixture(root, files))).toEqual(['../runtime-config']);
  });
});

// ---------------------------------------------------------------------------
// NON-VACUITY — a scan that finds nothing must FAIL, not pass
// ---------------------------------------------------------------------------

describe('non-vacuity — the population refuses to collapse', () => {
  /**
   * objectui#6195 landed this discipline one level over. The reasoning is the
   * card's own: a scan that silently finds nothing reports OK and reads as
   * coverage, which is the exact failure this gate exists to catch. So an empty
   * population is a FAILURE here, not a pass.
   */
  it('declares a floor for every counter a collapse would zero', () => {
    expect(Object.keys(FLOORS).sort()).toEqual(['relative', 'sources', 'testFiles']);
    for (const [name, floor] of Object.entries(FLOORS)) {
      expect(floor, `FLOORS.${name} must be a real floor, not zero`).toBeGreaterThan(0);
    }
  });

  it('reports every floor as breached when the walk returns nothing at all', () => {
    const result = scan(repoRoot, { files: [] });
    expect(result.unresolvable).toEqual([]); // clean by the only measure it has...
    expect(result.vacuous.map((v: { counter: string }) => v.counter).sort()).toEqual([
      'relative',
      'sources',
      'testFiles',
    ]); // ...and that is exactly why it must still fail
  });

  it('breaches the test-file floor when the walk finds sources but no tests', () => {
    const files = Array.from({ length: 2000 }, (_, i) => `packages/p/src/mod${i}.ts`);
    const result = scan(repoRoot, { files });
    const breached = result.vacuous.map((v: { counter: string }) => v.counter);
    expect(breached).toContain('testFiles');
    expect(breached).toContain('relative');
    expect(breached).not.toContain('sources');
  });

  it('exits non-zero on a collapsed population, with the census in the message', () => {
    // End to end through `main()`, because the exit code is the whole contract
    // with CI — the two assertions above are about the scan's return value, and
    // a `main()` that swallowed `vacuous` would pass both.
    //
    // The gate resolves its repo root from its OWN location, never from `cwd`,
    // so pointing a child process at an empty directory would still scan THIS
    // tree and exit 0. The probe therefore copies the whole import graph into a
    // throwaway git repo and runs it from there.
    const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'check-vi-mock-empty-'));
    fs.mkdirSync(path.join(probe, 'scripts'));
    for (const f of ['check-vi-mock-specifiers.mjs', 'invoked-as.mjs', 'js-comment-mask.mjs']) {
      fs.copyFileSync(path.join(repoRoot, 'scripts', f), path.join(probe, 'scripts', f));
    }
    execFileSync('git', ['init', '-q'], { cwd: probe });

    let status = 0;
    let output = '';
    try {
      // Nothing is `git add`ed, so `git ls-files` succeeds and returns nothing.
      execFileSync('node', ['scripts/check-vi-mock-specifiers.mjs'], { cwd: probe, encoding: 'utf8' });
    } catch (err) {
      const e = err as { status: number; stdout: string; stderr: string };
      status = e.status;
      output = `${e.stdout}${e.stderr}`;
    } finally {
      fs.rmSync(probe, { recursive: true, force: true });
    }
    expect(status, 'an empty scan must be RED — a green here is the defect itself').toBe(1);
    expect(output).toMatch(/population COLLAPSED/);
    expect(output, 'the message must name which counters collapsed').toMatch(/sources: found 0, floor is/);
  });
});

// ---------------------------------------------------------------------------
// The tree as it stands
// ---------------------------------------------------------------------------

describe('repo state — the gate is green on this tree', () => {
  const result = scan(repoRoot);

  it('has no vi.mock specifier resolving to nothing', () => {
    expect(
      result.unresolvable.map((u: { file: string; line: number; specifier: string }) => `${u.file}:${u.line} ${u.specifier}`),
      'Run `pnpm check:vi-mock-specifiers` for the full report and the fix guidance.',
    ).toEqual([]);
  });

  it('actually walked the tree rather than silently matching nothing', () => {
    // The empty-verdict trap: without these, the assertion above passes for the
    // wrong reason on the day the walk breaks. Floors, not exact counts — the
    // measured figures move every day (they were 3694 / 2012 / 675 when this
    // landed, against 1807 / 577 in the card three days earlier).
    expect(result.census.sources).toBeGreaterThan(1000);
    expect(result.census.testFiles).toBeGreaterThan(1000);
    expect(result.census.relative).toBeGreaterThan(100);
    expect(result.vacuous).toEqual([]);
  });

  it('puts the census in the verdict, so a reader sees the population', () => {
    // "OK" alone is what a gate that does nothing also prints.
    const line = summarise(result);
    expect(line).toMatch(/\d+ tracked source file\(s\)/);
    expect(line).toMatch(/\d+ relative specifier\(s\) resolved/);
    const out = execFileSync('node', ['scripts/check-vi-mock-specifiers.mjs'], { cwd: repoRoot, encoding: 'utf8' });
    expect(out).toMatch(/check-vi-mock-specifiers: OK/);
    expect(out).toContain(`${result.census.relative} relative specifier(s) resolved`);
  });

  it('needs no install and no build — it is a cheap-tier gate', () => {
    // The claim the tier rests on. `node_modules` is not consulted: the whole
    // import graph is builtins plus repo-relative modules, which
    // `check-pre-install-import-graph.mjs` enforces for every pre-install gate.
    const src = fs.readFileSync(path.join(repoRoot, 'scripts/check-vi-mock-specifiers.mjs'), 'utf8');
    const imports = [...src.matchAll(/^import .*? from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(3);
    for (const spec of imports) {
      expect(spec.startsWith('node:') || spec.startsWith('./'), `${spec} would need an install`).toBe(true);
    }
  });
});

describe('objectui#5646 — the real file the instance was written in', () => {
  const target = 'packages/app-shell/src/layout/__tests__/ChatDock.partialRuntimeConfig.test.tsx';

  it('still exists — or the case below tests nothing', () => {
    expect(fs.existsSync(path.join(repoRoot, target))).toBe(true);
  });

  it('has every relative mock in it resolving, at all three depths', () => {
    // Pins the corrected specifier AND its neighbours against the real tree, so
    // a future move of `runtime-config.ts` or `hooks/` reddens here too.
    const source = fs.readFileSync(path.join(repoRoot, target), 'utf8');
    const from = path.dirname(path.join(repoRoot, target));
    const relative = findCallSites(source).filter((s: { kind: string }) => s.kind === 'relative');
    expect(relative.length).toBeGreaterThan(2);
    for (const site of relative) {
      expect(resolveSpecifier(from, site.specifier).resolved, `${site.specifier} resolves to nothing`).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

describe('wiring — the gate is reachable and every PR shape starts it', () => {
  const SCRIPT = 'scripts/check-vi-mock-specifiers.mjs';
  const WORKFLOW = 'repo-gates.yml';
  const workflowDir = path.join(repoRoot, '.github/workflows');
  const workflowFiles = fs.readdirSync(workflowDir).filter((f) => f.endsWith('.yml'));

  /**
   * A workflow's YAML with whole-line comments removed — this workflow's header
   * discusses `paths` and `paths-ignore` in prose, and the sibling cheap gates
   * name each other's scripts in theirs. A scan that counted comments would
   * report filters and duplicate homes that no file has.
   */
  const yamlOf = (file: string) =>
    fs
      .readFileSync(path.join(workflowDir, file), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');

  it('is exposed as a root package script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.scripts['check:vi-mock-specifiers']).toBe(`node ${SCRIPT}`);
  });

  it('has a workflow that gates pull requests, not just pushes', () => {
    expect(fs.existsSync(path.join(workflowDir, WORKFLOW)), 'a check nothing runs is not a gate').toBe(true);
    const yaml = yamlOf(WORKFLOW);
    expect(yaml).toMatch(new RegExp(`run:\\s*node\\s+${SCRIPT.replace(/[.]/g, '\\.')}`));
    expect(yaml).toMatch(/^\s*pull_request:/m);
    expect(yaml).toMatch(/^\s*push:/m);
  });

  it('subscribes merge_group — a required check that skips a queue build stalls it', () => {
    // objectui#3523: `main` sits behind an enforced queue, and a required
    // context that never reports on the queue build does not fail it, it hangs
    // it until the ruleset's 60-minute timeout.
    expect(yamlOf(WORKFLOW)).toMatch(/^\s*merge_group:/m);
  });

  it('runs it in NO path-filtered workflow', () => {
    // A mock can be written into any package, so no path filter is correct —
    // and reporting on every PR shape is also what makes the check requirable.
    expect(workflowFiles.length, 'the workflow directory scan returned implausibly few files').toBeGreaterThan(5);
    for (const file of workflowFiles) {
      const yaml = yamlOf(file);
      if (!yaml.includes(SCRIPT)) continue;
      expect(yaml, `${file} runs ${SCRIPT} behind a paths-ignore`).not.toMatch(/paths-ignore:/);
      expect(yaml, `${file} runs ${SCRIPT} behind a paths filter — see objectui#3448`).not.toMatch(/^\s+paths:/m);
    }
  });

  it('has exactly one home', () => {
    // A second copy in a path-filtered workflow is how a gate ends up looking
    // covered while the change it exists for still slips past.
    expect(workflowFiles.filter((f) => yamlOf(f).includes(SCRIPT))).toEqual([WORKFLOW]);
  });

  it('installs nothing before running the gate — the cheap tier, mechanically', () => {
    // Since objectui#12214 the home is `repo-gates.yml`, ONE job that installs
    // after its install-free gates: the property is now an ORDER -- this gate's
    // step sits before the job's `pnpm install` -- and no longer an absence.
    const yaml = yamlOf(WORKFLOW);
    const gateAt = yaml.indexOf(SCRIPT);
    const installAt = yaml.indexOf('pnpm install');
    expect(gateAt).toBeGreaterThan(-1);
    expect(installAt === -1 || gateAt < installAt, 'the gate step moved below the install step').toBe(true);
  });
});
