import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here —
// re-adding one is now itself an error (TS2578). See objectui#3494.
import {
  analyze,
  auditPackage,
  buildsWithTsc,
  discoverTscPackages,
  expectedEmit,
  report,
} from '../check-dist-completeness.mjs';

/**
 * objectui#6703. `packages/types/dist` was seen holding 4 of its 40 top-level
 * `.d.ts` files while the build that wrote it exited 0, and the damage surfaced
 * as ordinary-looking type errors in `permissions` and `mobile`.
 *
 * The mechanism, measured rather than assumed: every `"build": "tsc"` package
 * here is `composite`, so `tsc` records what it emitted in a
 * `tsconfig.tsbuildinfo` that TypeScript resolves NEXT TO `tsconfig.json` —
 * outside the `dist/` it describes. Delete the `dist/` and leave that file, and
 * `tsc` believes the record, emits nothing and exits 0. It never stats its own
 * outputs.
 *
 * Two locks live here. The unit cases below pin the judgement on real
 * directories built in a tmpdir, because the defect IS a question about files
 * on disk and a mocked `fs` would answer it the way the mock was written. The
 * repo-state cases at the bottom pin the WIRING — a gate that no build script
 * invokes is indistinguishable from one that passes, and the wiring is the
 * whole reason this check runs before turbo can cache a green empty build.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A minimal real tsc project: N sources, a tsconfig that emits to `dist/`. */
function makeProject(dir: string, sources: string[]): void {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  for (const s of sources) {
    fs.writeFileSync(path.join(dir, 'src', s), `export const ${s.replace(/\W/g, '_')} = 1;\n`);
  }
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    `${JSON.stringify({ name: '@fixture/pkg', scripts: { build: 'tsc' } }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(dir, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          outDir: './dist',
          rootDir: './src',
          declaration: true,
          composite: true,
          module: 'ESNext',
          moduleResolution: 'bundler',
        },
        include: ['src/**/*'],
      },
      null,
      2,
    )}\n`,
  );
}

/** Pretend `tsc` ran: write the outputs the gate should expect, or some of them. */
function emit(dir: string, outputs: string[]): void {
  for (const o of outputs) {
    fs.mkdirSync(path.dirname(o), { recursive: true });
    fs.writeFileSync(o, '');
  }
  fs.writeFileSync(path.join(dir, 'tsconfig.tsbuildinfo'), '{}');
}

function withTmp<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-completeness-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('buildsWithTsc', () => {
  it('recognises a bare tsc build', () => {
    expect(buildsWithTsc({ scripts: { build: 'tsc' } })).toBe(true);
  });

  it('still recognises the build after this very gate is appended to it', () => {
    // The wiring below rewrites every one of these scripts. If the predicate
    // stopped matching its own output, `--all` would silently scan nothing.
    expect(
      buildsWithTsc({ scripts: { build: 'tsc && node ../../scripts/check-dist-completeness.mjs' } }),
    ).toBe(true);
  });

  it('does not claim a vite build', () => {
    expect(buildsWithTsc({ scripts: { build: 'vite build' } })).toBe(false);
    expect(buildsWithTsc({ scripts: {} })).toBe(false);
    expect(buildsWithTsc({})).toBe(false);
  });
});

describe('expectedEmit — derived from TypeScript, never written down', () => {
  it('asks the compiler what each input emits rather than counting files', () => {
    withTmp((dir) => {
      makeProject(dir, ['a.ts', 'b.ts', 'c.ts']);
      const { inputs, outputs, buildInfoPath } = expectedEmit(dir);

      expect(inputs).toHaveLength(3);
      // declaration:true, no maps -> exactly .js + .d.ts per input.
      expect(outputs.map((o: string) => path.relative(dir, o)).sort()).toEqual([
        'dist/a.d.ts',
        'dist/a.js',
        'dist/b.d.ts',
        'dist/b.js',
        'dist/c.d.ts',
        'dist/c.js',
      ]);
      // The buildinfo sits OUTSIDE the outDir it is a record of. That is the
      // whole defect: `rm -rf dist` cannot take it, so the two desync.
      expect(path.relative(dir, buildInfoPath as string)).toBe('tsconfig.tsbuildinfo');
    });
  });

  it('follows the tsconfig it is given instead of a fixed output shape', () => {
    withTmp((dir) => {
      makeProject(dir, ['a.ts']);
      const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'tsconfig.json'), 'utf8'));
      cfg.compilerOptions.declaration = false;
      cfg.compilerOptions.composite = false;
      cfg.compilerOptions.sourceMap = true;
      fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(cfg, null, 2));

      expect(expectedEmit(dir).outputs.map((o: string) => path.relative(dir, o)).sort()).toEqual([
        'dist/a.js',
        'dist/a.js.map',
      ]);
    });
  });
});

describe('auditPackage', () => {
  it('passes a dist that holds every file tsc emits', () => {
    withTmp((dir) => {
      makeProject(dir, ['a.ts', 'b.ts']);
      emit(dir, expectedEmit(dir).outputs);

      const audit = auditPackage({ name: '@fixture/pkg', dir }, { root: dir });
      expect(audit.state).toBe('complete');
      expect(audit.missing).toEqual([]);
      expect(audit.expected).toBe(4);
    });
  });

  it('fails the reported shape: some outputs present, the buildinfo still claiming all of them', () => {
    withTmp((dir) => {
      makeProject(dir, ['a.ts', 'b.ts', 'c.ts']);
      const { outputs } = expectedEmit(dir);
      emit(dir, outputs.slice(0, 2));

      const audit = auditPackage({ name: '@fixture/pkg', dir }, { root: dir });
      expect(audit.state).toBe('incomplete');
      expect(audit.missing).toHaveLength(4);
      expect(audit.buildInfoPresent).toBe(true);
    });
  });

  it('fails a buildinfo with NO dist at all — the state an empty turbo cache entry restores', () => {
    withTmp((dir) => {
      makeProject(dir, ['a.ts']);
      fs.writeFileSync(path.join(dir, 'tsconfig.tsbuildinfo'), '{}');

      const audit = auditPackage({ name: '@fixture/pkg', dir }, { root: dir });
      expect(audit.state).toBe('incomplete');
      expect(audit.missing).toEqual(['dist/a.js', 'dist/a.d.ts']);
    });
  });

  it('skips a package that was simply never built — no dist AND no buildinfo', () => {
    withTmp((dir) => {
      makeProject(dir, ['a.ts']);
      const audit = auditPackage({ name: '@fixture/pkg', dir }, { root: dir });
      expect(audit.state).toBe('never-built');
      expect(audit.missing).toEqual([]);
    });
  });

  it('reports a type-check-only project apart from an unbuilt one', () => {
    withTmp((dir) => {
      makeProject(dir, ['a.ts']);
      const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'tsconfig.json'), 'utf8'));
      cfg.compilerOptions.noEmit = true;
      cfg.compilerOptions.composite = false;
      fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(cfg, null, 2));

      // `fields` and `apps/console` are real instances: their `build` opens with
      // `tsc` as a CHECK and emits through vite. Collapsing this into
      // "never built" would let a package that stopped emitting read as one
      // that had merely not been built yet.
      expect(auditPackage({ name: '@fixture/pkg', dir }, { root: dir }).state).toBe('no-emit');
    });
  });
});

describe('report', () => {
  it('exits 1 and names the missing files, the stale record, and the repair', () => {
    withTmp((dir) => {
      makeProject(dir, ['a.ts', 'b.ts']);
      const { outputs } = expectedEmit(dir);
      emit(dir, outputs.slice(0, 1));

      const audit = auditPackage({ name: '@fixture/pkg', dir }, { root: dir });
      const { exitCode, lines } = report([audit], { root: dir });
      const text = lines.join('\n');

      expect(exitCode).toBe(1);
      expect(text).toContain('@fixture/pkg');
      expect(text).toContain('tsconfig.tsbuildinfo');
      expect(text).toContain('rm -f tsconfig.tsbuildinfo');
      // The cascade is the expensive half: without this sentence the reader
      // goes looking for the type error in the package that reported it.
      expect(text).toContain('It fails in the packages that');
    });
  });

  it('exits 0 with a count, so a run that verified nothing cannot read as a pass', () => {
    withTmp((dir) => {
      makeProject(dir, ['a.ts', 'b.ts']);
      emit(dir, expectedEmit(dir).outputs);

      const audit = auditPackage({ name: '@fixture/pkg', dir }, { root: dir });
      const { exitCode, lines } = report([audit], { root: dir });
      expect(exitCode).toBe(0);
      expect(lines.join('\n')).toContain('4 emitted files verified');
    });
  });
});

describe('analyze', () => {
  it('says so and passes when the package in cwd does not build with tsc', () => {
    withTmp((dir) => {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: '@fixture/vite', scripts: { build: 'vite build' } }),
      );
      const { exitCode, lines, audits } = analyze({ root: dir, cwd: dir });
      expect(exitCode).toBe(0);
      expect(audits).toEqual([]);
      expect(lines.join('\n')).toContain('does not build with tsc');
    });
  });

  it('throws rather than passing when the walk finds no packages', () => {
    withTmp((dir) => {
      // An empty scan satisfies every assertion while looking at nothing, which
      // is the one outcome a gate must never report as success.
      expect(() => analyze({ root: dir, all: true })).toThrow(/no workspace package/);
    });
  });
});

describe('this repository', () => {
  const tscPackages = discoverTscPackages(repoRoot) as Array<{ name: string; dir: string }>;

  it('finds the tsc-built packages', () => {
    expect(tscPackages.length).toBeGreaterThanOrEqual(12);
  });

  it.each(tscPackages.map((p) => [p.name, p.dir] as const))(
    'every emitting tsc package runs this check in its own build: %s',
    (name, dir) => {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if (expectedEmit(dir).outputs.length === 0) return; // type-check-only; nothing to verify

      // Placement is load-bearing, not a preference. turbo caches a task that
      // exits 0, so a `tsc` that short-circuits gets its empty `dist/` RECORDED
      // as a successful build — and that entry then replays as `cache hit …
      // FULL TURBO` into every worktree sharing the store. Checking inside the
      // build is what stops the entry from being written at all.
      expect(manifest.scripts.build).toContain('check-dist-completeness.mjs');
    },
  );

  it.each(tscPackages.map((p) => [p.name, p.dir] as const))(
    'a clean script takes the buildinfo with the dist it describes: %s',
    (name, dir) => {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      const clean = manifest.scripts?.clean;
      if (typeof clean !== 'string') return;
      // Scoped to projects that actually WRITE a buildinfo. `fields` opens its
      // build with `tsc` but is `noEmit` with neither `composite` nor
      // `incremental`, so TypeScript resolves no buildinfo path for it and
      // there is nothing for its `clean` to desync from.
      if (!expectedEmit(dir).buildInfoPath) return;

      // `rm -rf dist` alone leaves the record of what was emitted behind, so
      // `pnpm clean && pnpm build` produced an EMPTY dist and exit 0 — measured
      // on 4357ec7 before this was fixed.
      expect(clean).toContain('tsconfig.tsbuildinfo');
    },
  );

  it('turbo treats the gate as an input of the builds that run it', () => {
    const turbo = JSON.parse(fs.readFileSync(path.join(repoRoot, 'turbo.json'), 'utf8'));
    // Otherwise editing the gate does not invalidate a single cached build, and
    // the new rule is enforced only where nothing was cached.
    expect(turbo.tasks.build.inputs).toContain('$TURBO_ROOT$/scripts/check-dist-completeness.mjs');
  });

  it('has a root alias pointing at the script that exists', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const alias = pkg.scripts['check:dist-completeness'];
    expect(alias).toBe('node scripts/check-dist-completeness.mjs --all');
    expect(fs.existsSync(path.join(repoRoot, 'scripts/check-dist-completeness.mjs'))).toBe(true);
  });
});
