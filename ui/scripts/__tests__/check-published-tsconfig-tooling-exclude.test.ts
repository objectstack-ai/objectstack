import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TOOLING_FILE } from '../check-phantom-dependencies.mjs';
import { MIN_PACKAGES, toolingConventionFrom } from '../check-published-dist-tooling.mjs';
import {
  ACCEPTED_FORMS,
  CANONICAL_FORM,
  EMITTER_CARVE_OUTS,
  TOOLING_DIRECTORIES,
  analyze,
  dtsOptionsBody,
  emitterFactsFor,
  isDirectoryForm,
  missingDirectories,
  stripJsonComments,
} from '../check-published-tsconfig-tooling-exclude.mjs';

/**
 * objectui#7212 — every published package's build tsconfig must exclude tooling
 * DIRECTORIES, not just tooling FILE NAMES.
 *
 * The defect has been repaired three times and gated never: objectui#4006,
 * objectui#4836, objectui#6943 (the third in the same package as the first).
 * Each repair was correct and local; the trap stayed armed in 29 other
 * published packages, all with ZERO offending files — green because nobody had
 * added a shared `__tests__/` helper yet, not because the config would stop
 * one. So what this file mostly pins is the ways the new gate could be green
 * about nothing:
 *
 *  1. **The convention is derived from `TOOLING_FILE`, never retyped.** A
 *     fourth tooling directory added to `check-phantom-dependencies.mjs` must
 *     become required here in the same commit.
 *  2. **The three historical name-only shapes are RED**, and the accepted
 *     directory spellings are GREEN — the red-then-green property stated as
 *     cases rather than trusted by reading.
 *  3. **The bare-directory spelling is RED although `tsc` honours it**, because
 *     it is position-anchored: `src/__tests__` does not cover
 *     `src/renderers/__tests__/`. That was `@object-ui/components`' real
 *     spelling, and it covered one of the three directories.
 *  4. **A collapsed scan is RED, never green.** "Nothing to look at, therefore
 *     clean" is the verdict this gate family must never return (objectui#4846).
 *  5. **Every carve-out re-proves itself on each run**, so an exemption cannot
 *     outlive the emitter that justified it — and a carve-out for a package npm
 *     no longer receives is a failure, not a no-op.
 *  6. **The gate is wired** into `package.json` and into a PER-PR job, which is
 *     what distinguishes it from the artifact-level sibling that deliberately
 *     is not (objectui#4846 comment 5307574139).
 *  7. **This repository is green**, which is the ratchet half of the ruling:
 *     the gate landed together with the conversion of its initial red set.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GATE = 'scripts/check-published-tsconfig-tooling-exclude.mjs';

interface Finding {
  reason: string;
  pkg?: string;
  detail?: string;
  missing?: string[];
}

// ── fixture workspaces ───────────────────────────────────────────────────────

const fixtures: string[] = [];
afterAll(() => {
  for (const dir of fixtures) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A throwaway workspace: a `.changeset/config.json` naming every package, plus
 * a manifest and (optionally) a tsconfig and a vite config per package.
 */
function makeWorkspace(
  packages: Record<
    string,
    { manifest?: Record<string, unknown>; tsconfig?: Record<string, unknown> | string; vite?: string }
  >,
  { padTo = MIN_PACKAGES } = {},
): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsconfig-tooling-exclude-'));
  fixtures.push(root);
  const names: string[] = [];

  const write = (dir: string, name: string, spec: (typeof packages)[string]) => {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(
      path.join(root, dir, 'package.json'),
      JSON.stringify({ name, ...(spec.manifest ?? {}) }),
    );
    if (spec.tsconfig !== undefined) {
      fs.writeFileSync(
        path.join(root, dir, 'tsconfig.json'),
        typeof spec.tsconfig === 'string' ? spec.tsconfig : JSON.stringify(spec.tsconfig),
      );
    }
    if (spec.vite !== undefined) fs.writeFileSync(path.join(root, dir, 'vite.config.ts'), spec.vite);
    names.push(name);
  };

  for (const [dir, spec] of Object.entries(packages)) {
    write(dir, `@fixture/${dir.split('/').pop()}`, spec);
  }
  // Filler so the scan clears its own floor; the subject packages are the ones
  // above. Each filler is already compliant, so it contributes no finding.
  for (let i = names.length; i < padTo; i += 1) {
    write(`packages/filler-${i}`, `@fixture/filler-${i}`, {
      tsconfig: { exclude: TOOLING_DIRECTORIES.map((d) => `**/${d}/**`) },
    });
  }

  fs.mkdirSync(path.join(root, '.changeset'), { recursive: true });
  fs.writeFileSync(path.join(root, '.changeset/config.json'), JSON.stringify({ fixed: [names] }));
  return root;
}

const run = (root: string, options = {}) => analyze(root, options) as { findings: Finding[]; counters: Record<string, number> };
const reasons = (findings: Finding[]) => findings.map((f) => f.reason);
const forPkg = (findings: Finding[], name: string) => findings.filter((f) => f.pkg === name);

// ── 1. the convention is derived, never retyped ──────────────────────────────

describe('the tooling convention comes out of TOOLING_FILE', () => {
  it('reads the same directories the sibling gates classify as tooling', () => {
    expect(TOOLING_DIRECTORIES).toEqual(toolingConventionFrom(TOOLING_FILE.source).directories.split('|'));
    expect(TOOLING_DIRECTORIES).toEqual(['__tests__', '__mocks__', '__benchmarks__']);
  });

  it('requires EVERY tooling directory, so a fourth one propagates in the same commit', () => {
    // The drift this rules out is invisible: both gates stay green while one
    // silently stops covering a directory.
    for (const directory of TOOLING_DIRECTORIES) {
      const exclude = TOOLING_DIRECTORIES.filter((d) => d !== directory).map((d) => `**/${d}/**`);
      expect(missingDirectories(exclude), `dropping ${directory} must be noticed`).toEqual([directory]);
    }
    expect(missingDirectories(TOOLING_DIRECTORIES.map((d) => `**/${d}/**`))).toEqual([]);
  });
});

// ── 2. red-then-green, as cases ──────────────────────────────────────────────

describe('the name form is red and the directory form is green', () => {
  it('accepts every anchored spelling in ACCEPTED_FORMS', () => {
    for (const form of ACCEPTED_FORMS) {
      for (const directory of TOOLING_DIRECTORIES) {
        expect(isDirectoryForm(form.replace('DIR', directory), directory), form).toBe(true);
      }
    }
    expect(ACCEPTED_FORMS).toContain(CANONICAL_FORM);
  });

  it('rejects the three name-only shapes this repository actually carried', () => {
    // Verbatim from the packages objectui#7212 measured: the plugin/app-shell
    // shape, the i18n/react-runtime shape, and the types shape.
    for (const exclude of [
      ['node_modules', 'dist', '**/*.test.ts', '**/*.test.tsx'],
      ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      ['node_modules', 'dist', '**/*.test.ts', '**/*.spec.ts', 'examples'],
    ]) {
      expect(missingDirectories(exclude)).toEqual(TOOLING_DIRECTORIES);
    }
  });

  it('rejects the BARE-DIRECTORY spelling, which is honoured by tsc but position-anchored', () => {
    // `@object-ui/components` carried exactly this. `tsc` excludes the named
    // directory recursively, so the config is not wrong — it just does not
    // cover `src/renderers/__tests__/`, which is the same "green until someone
    // adds a file" shape this gate exists to end. And it named ONE of three.
    expect(isDirectoryForm('src/__tests__', '__tests__')).toBe(false);
    expect(missingDirectories(['src/__tests__', '**/*.test.ts', '**/*.test.tsx'])).toEqual(TOOLING_DIRECTORIES);
  });

  it('does not accept a glob that merely mentions the directory name', () => {
    for (const glob of ['**/__tests__', '**/__tests__/*', 'src/__tests__/helpers/**', '**/not__tests__/**']) {
      expect(isDirectoryForm(glob, '__tests__'), glob).toBe(false);
    }
  });

  it('fails a name-only package end to end, and names the globs to add', () => {
    const root = makeWorkspace({
      'packages/offender': { tsconfig: { exclude: ['node_modules', 'dist', '**/*.test.ts'] } },
    });
    const { findings } = run(root, { carveOuts: {} });
    const finding = forPkg(findings, '@fixture/offender')[0];
    expect(finding?.reason).toBe('name-only-tooling-exclude');
    expect(finding?.missing).toEqual(TOOLING_DIRECTORIES);
    for (const directory of TOOLING_DIRECTORIES) {
      expect(finding?.detail).toContain(`"**/${directory}/**"`);
    }
  });

  it('passes the same package once the directory form is written', () => {
    const root = makeWorkspace({
      'packages/fixed': {
        tsconfig: {
          exclude: ['node_modules', 'dist', ...TOOLING_DIRECTORIES.map((d) => `**/${d}/**`), '**/*.test.ts'],
        },
      },
    });
    const { findings, counters } = run(root, { carveOuts: {} });
    expect(findings).toEqual([]);
    expect(counters.compliant).toBe(counters.enforced);
  });

  it('reads the exclude through JSONC comments, which every real tsconfig here has', () => {
    const root = makeWorkspace({
      'packages/commented': {
        tsconfig: `{
  // a leading comment, and one containing a "quoted \\" brace {"
  /* and a block comment */
  "include": ["src"],
  "exclude": [${TOOLING_DIRECTORIES.map((d) => `"**/${d}/**"`).join(', ')}]
}`,
      },
    });
    expect(run(root, { carveOuts: {} }).findings).toEqual([]);
  });
});

// ── 3. the vacuous verdicts are RED ──────────────────────────────────────────

describe('the verdicts this gate must never return', () => {
  it('reds when the scan collapses below the floor instead of passing on nothing', () => {
    const root = makeWorkspace({ 'packages/only': { tsconfig: { exclude: [] } } }, { padTo: 1 });
    const { findings } = run(root, { carveOuts: {} });
    expect(reasons(findings)).toContain('scan-collapsed');
    expect(findings[0]?.detail).toContain(String(MIN_PACKAGES));
  });

  it('treats a missing build tsconfig as a finding, not a skip', () => {
    const root = makeWorkspace({ 'packages/naked': {} });
    expect(reasons(run(root, { carveOuts: {} }).findings)).toContain('no-build-tsconfig');
  });

  it('treats an absent `exclude` key as red, not as "nothing to check"', () => {
    const root = makeWorkspace({ 'packages/silent': { tsconfig: { include: ['src'] } } });
    expect(reasons(run(root, { carveOuts: {} }).findings)).toContain('name-only-tooling-exclude');
  });

  it('reports an unparseable tsconfig rather than skipping the package', () => {
    const root = makeWorkspace({ 'packages/broken': { tsconfig: '{ "exclude": [ ' } });
    expect(reasons(run(root, { carveOuts: {} }).findings)).toContain('unreadable-tsconfig');
  });
});

// ── 4. scope: the same set the sibling gate publishes ────────────────────────

describe('scope', () => {
  it('skips `private` packages and covers `apps/`', () => {
    // Padded one above the floor because the private package is subtracted
    // from the published set — at exactly the floor this fixture would collapse
    // the scan instead, and the collapse verdict would mask what it is testing.
    const root = makeWorkspace(
      {
        'packages/secret': { manifest: { private: true }, tsconfig: { exclude: [] } },
        'apps/shipped': { tsconfig: { exclude: ['**/*.test.ts'] } },
      },
      { padTo: MIN_PACKAGES + 1 },
    );
    const { findings } = run(root, { carveOuts: {} });
    expect(forPkg(findings, '@fixture/secret')).toEqual([]);
    expect(reasons(forPkg(findings, '@fixture/shipped'))).toEqual(['name-only-tooling-exclude']);
  });
});

// ── 5. carve-outs re-prove themselves ────────────────────────────────────────

describe('an emitter carve-out cannot outlive its reason', () => {
  const carveOuts = {
    '@fixture/bundled': {
      reason: 'tsup emits from its entry graph',
      requires: (facts: { usesTsup: boolean; build: string }) =>
        facts.usesTsup ? null : `its build script is now \`${facts.build}\``,
    },
  };

  it('exempts the package while the stated fact still holds', () => {
    const root = makeWorkspace({
      'packages/bundled': { manifest: { scripts: { build: 'tsup' } }, tsconfig: { exclude: ['**/*.test.ts'] } },
    });
    const { findings, counters } = run(root, { carveOuts });
    expect(findings).toEqual([]);
    expect(counters.exempt).toBe(1);
  });

  it('reds the moment the emitter changes under it', () => {
    const root = makeWorkspace({
      'packages/bundled': { manifest: { scripts: { build: 'tsc' } }, tsconfig: { exclude: ['**/*.test.ts'] } },
    });
    const finding = forPkg(run(root, { carveOuts }).findings, '@fixture/bundled')[0];
    expect(finding?.reason).toBe('carve-out-no-longer-holds');
    expect(finding?.detail).toContain('tsup');
  });

  it('reds on a carve-out naming a package that is no longer published', () => {
    const root = makeWorkspace({ 'packages/present': { tsconfig: { exclude: [] } } });
    const findings = run(root, { carveOuts: { '@fixture/departed': { reason: 'x', requires: () => null } } }).findings;
    expect(reasons(findings)).toContain('stale-carve-out');
  });
});

// ── 6. the carve-out list this repository actually ships ─────────────────────

describe('the shipped carve-outs, against the emitters they claim', () => {
  it('names exactly the published packages whose emitter ignores this file list', () => {
    // The ruling named four and carried a confidence gap into implementation:
    // whether they were exhaustive was to be verified here. They were not —
    // `create-plugin` is a THIRD tsup package and `runner` is a SECOND Vite
    // application, and both sat inside the ruling's "29 name-only" red set.
    //
    // SIX until objectui#7113, which retired `@object-ui/plugin-charts` — the
    // list SHRANK, which is the only direction it should ever move. That entry
    // was exempt precisely because its build tsconfig carried no `exclude` key;
    // when the package gained the directory form, the entry's own `requires`
    // predicate fired `carve-out-no-longer-holds` and named the remedy. The
    // package is now ENFORCED (the gate's population reads 34 enforced / 5
    // carve-outs, up from 33 / 6), so this is protection gained, not waived.
    expect(Object.keys(EMITTER_CARVE_OUTS).sort()).toEqual([
      '@object-ui/cli',
      '@object-ui/console',
      '@object-ui/create-plugin',
      '@object-ui/data-objectstack',
      '@object-ui/runner',
    ]);
  });

  it('re-derives each carve-out against the package on disk', () => {
    const { packages } = analyze(repoRoot) as { packages: { name: string; dir: string; manifest: object }[] };
    for (const [name, carveOut] of Object.entries(EMITTER_CARVE_OUTS)) {
      const pkg = packages.find((p) => p.name === name);
      expect(pkg, `${name} must still be a published package`).toBeDefined();
      expect(carveOut.requires(emitterFactsFor(repoRoot, pkg!)), `${name}: ${carveOut.reason}`).toBeNull();
    }
  });

  it('records that `console` carries a live non-test helper behind its single guard', () => {
    // Required by the ruling: `console` keeps its `noEmit` protection and is
    // listed WITH the note, because it is the one carve-out that is not merely
    // latent — the file exists today.
    expect(fs.existsSync(path.join(repoRoot, 'apps/console/src/__tests__/helpers/preview-page-sources.ts'))).toBe(true);
    expect(EMITTER_CARVE_OUTS['@object-ui/console'].reason).toContain('preview-page-sources.ts');
  });

  it('reads a `dts()` options block by balancing braces, not by regexing prose', () => {
    expect(dtsOptionsBody('plugins: [dts({ include: ["src"], exclude: ["**/*.test.ts"] })]')).toContain('exclude');
    // A nested object must not end the block early, and a bare `dts()` is not
    // the same as `dts({})`.
    expect(dtsOptionsBody('dts({ compilerOptions: { paths: {} }, exclude: ["a"] })')).toContain('exclude');
    expect(dtsOptionsBody('dts()')).toBe('');
    expect(dtsOptionsBody('plugins: [react()]')).toBeNull();
  });

  it('strips comments without being fooled by braces or slashes inside strings', () => {
    expect(JSON.parse(stripJsonComments('{"a": "http://x{//}", /* c */ "b": 1 // trailing\n}')))
      .toEqual({ a: 'http://x{//}', b: 1 });
  });
});

// ── 7. wiring, and this repository's own state ───────────────────────────────

describe('wiring', () => {
  it('is exposed as `pnpm check:published-tsconfig-exclude`', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(manifest.scripts['check:published-tsconfig-exclude']).toBe(`node ${GATE}`);
  });

  it('runs PER PULL REQUEST — the half objectui#4846 could not have', () => {
    // The artifact-level sibling needs a full-repo build and therefore runs on
    // the publish path and nightly. This one reads config text, so it can run
    // where the defect is authored.
    const ci = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain('run: pnpm check:published-tsconfig-exclude');
  });

  it('leaves the artifact-level gate in place as the second line of defence', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(manifest.scripts['check:published-dist']).toBe('node scripts/check-published-dist-tooling.mjs');
    const publishGate = fs.readFileSync(path.join(repoRoot, '.github/workflows/published-dist-gate.yml'), 'utf8');
    expect(publishGate).toContain('check:published-dist');
  });

  it('is GREEN on this repository — the ratchet landed with its red set converted', () => {
    const { findings, counters } = run(repoRoot);
    expect(findings).toEqual([]);
    expect(counters.enforced).toBeGreaterThanOrEqual(MIN_PACKAGES);
    expect(counters.compliant).toBe(counters.enforced);
  });
});
