/**
 * Smoke tests for the @object-ui/cli bin.
 *
 * These tests invoke the built `dist/cli.js` as a child process to verify
 * that the public CLI surface (commands, flags, exit codes) matches what
 * is documented in the README and content/docs/utilities/cli.mdx.
 *
 * If you change a flag or command name, update both this test file AND the
 * docs in the same PR (Rule #2: Documentation Driven Development).
 *
 * This file holds the commands that write, refuse or validate. The read-only
 * half (package identity, `--version`, `--help`, the documented flags) is in
 * `cli-bin.surface.test.ts`. Both share `cliBin.ts`, which builds `dist/` once
 * behind a lock (objectstack#25911).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildInitFiles } from '../commands/init.js';
import { CLI_BIN, PKG_PATH, PKG_ROOT, REPO_ROOT, ensureCliBuilt, run, tree } from './cliBin.js';

/**
 * The environment a build SPAWNED BY THIS TEST runs in (objectui#8598).
 *
 * ⛔ `VITEST` must not reach it, and that is a correctness requirement rather
 * than hygiene.
 *
 * Vitest sets `VITEST=true` in the worker, and a child process inherits it. But
 * the variable means "vitest is loading this config" — and in a build this test
 * starts, that is FALSE. Every one of the 24 `packages/*` vite configs opens
 * with `if (process.env.VITEST) { assertCanonicalVitestInvocation(...) }`, and
 * that guard derives its "vitest root" from `cwd` when argv carries no `--root`.
 * `pnpm --filter PKG run build` sets cwd to the package directory, so an
 * inherited `VITEST` makes the guard compare `packages/PKG` against the repo
 * root, decide it is a vitest run launched from the wrong place, and
 * `process.exit(1)` before the bundler starts.
 *
 * ⭐ The ratchet that keeps the 24 configs identical states this property as its
 * own name — `scripts/__tests__/vitest-invocation-guard.test.ts`, "gates that
 * call on VITEST, **so `vite build` is never refused**". A leaked `VITEST` is
 * exactly what falsifies it, from the outside, where no config can see it. ⇒ the
 * repair belongs at the spawn, which is the only place that knows the child is a
 * BUILD and not a test run.
 *
 * Measured on objectui#8598: with `VITEST` inherited, `@object-ui/types`
 * (the first vite-built package a test ever builds) failed `Test (shard 2/4)`
 * in CI; with it scrubbed, the same build exits 0. `scripts/__tests__/
 * spawned-build-vitest-env-8598.test.ts` keeps every future build spawn here.
 */
const BUILD_ENV: NodeJS.ProcessEnv = (() => {
  const env = { ...process.env };
  delete env.VITEST;
  return env;
})();

describe('@object-ui/cli bin', () => {
  beforeAll(() => {
    ensureCliBuilt({
      types: () =>
        spawnSync('pnpm', ['--filter', '@object-ui/types', 'run', 'build'], {
          cwd: REPO_ROOT,
          encoding: 'utf-8',
          stdio: 'pipe',
          env: BUILD_ENV,
        }),
      cli: () =>
        spawnSync('pnpm', ['run', 'build'], {
          cwd: PKG_ROOT,
          encoding: 'utf-8',
          stdio: 'pipe',
          env: BUILD_ENV,
        }),
    });
  }, 180_000);

  // objectui#11476. `generate` used to declare `--output <dir>` (documented
  // default `schemas/`), but the action never read it: `generate(type, name)`
  // writes in the generator's own per-type layout whatever the flag said.
  // objectui#11488. It also declared `--from <source>` ("Generate schema from
  // external source"), whose branch printed "not yet implemented" and exited 0
  // having written nothing, so a script read the no-op as success. Both flags
  // are retired with no alias window, so the bin must REFUSE each one rather
  // than accept it and do nothing. Asserted through the built bin, which is
  // where both cards measured the defect. The flag-free run is the control the
  // refusals are read against: same command, same empty directory, one file
  // written.
  describe('generate refuses its retired flags (objectui#11476, objectui#11488)', () => {
    it.each([
      ['--output', 'custom/'],
      ['--from', 'openapi.yaml'],
    ])('exits non-zero naming %s as an unknown option, and writes nothing', (flag, value) => {
      const work = mkdtempSync(join(tmpdir(), 'objectui-cli-generate-retired-'));
      const res = run(['g', 'page', 'Probe', flag, value], { cwd: work });
      expect(res.code, res.stdout + res.stderr).not.toBe(0);
      expect(res.stderr).toMatch(/unknown option/i);
      expect(res.stderr).toContain(flag);
      expect(tree(work)).toEqual([]);
    });

    it('still writes pages/NAME.json when the flag is absent', () => {
      const work = mkdtempSync(join(tmpdir(), 'objectui-cli-generate-page-'));
      const res = run(['g', 'page', 'Probe'], { cwd: work });
      expect(res.code, res.stdout + res.stderr).toBe(0);
      expect(tree(work)).toEqual(['pages', 'pages/probe.json']);
    });

    it('lists neither --output nor --from in generate --help', () => {
      const res = run(['generate', '--help']);
      expect(res.code, res.stderr).toBe(0);
      // Lit control: the help text that was read is generate's own usage line.
      expect(res.stdout).toMatch(/objectui generate\|g .*<type> <name>/);
      expect(res.stdout).not.toMatch(/--output\b/);
      expect(res.stdout).not.toMatch(/--from\b/);
    });
  });

  // objectui#11496. `add <component>` was documented as adding a component
  // renderer scaffold, but its action printed "Feature not implemented yet.",
  // wrote nothing and exited 0, so a script read the no-op as success. The
  // command is retired with no placeholder, so the bin must REFUSE it the way it
  // refuses any command it never declared. The control is the same directory
  // answering a declared command: it is writable, and the tree read sees a write.
  describe('the retired add command is refused (objectui#11496)', () => {
    it('exits non-zero with the unknown-command error on `add Input`, and writes nothing', () => {
      const work = mkdtempSync(join(tmpdir(), 'objectui-cli-add-retired-'));
      const res = run(['add', 'Input'], { cwd: work });
      expect(res.code, res.stdout + res.stderr).not.toBe(0);
      expect(res.stderr).toMatch(/unknown command 'add'/i);
      expect(tree(work)).toEqual([]);

      const control = run(['g', 'page', 'Probe'], { cwd: work });
      expect(control.code, control.stdout + control.stderr).toBe(0);
      expect(tree(work)).toEqual(['pages', 'pages/probe.json']);
    });
  });

  // objectui#11500. Four commands that could only fail are retired with no
  // placeholder, so the bin must REFUSE each one the way it refuses a command it
  // never declared:
  //  - `create plugin NAME` resolved its generator one directory too high and
  //    never found it. `plugin` was `create`'s only type, so `create` goes
  //    whole; `npm create @object-ui/plugin` is the package's own initializer.
  //  - `lint` / `test` ran ESLint / Vitest in the temp app `dev` generates,
  //    which declares neither toolchain, so they failed by construction.
  //  - `studio` launched this monorepo's console, not the local project, and
  //    failed outside the monorepo.
  // PATH is emptied for these runs. A retired command that came back would then
  // fail at its first external tool instead of starting a dev server or a
  // toolchain from inside this suite, and the stderr assertion still turns red.
  // The control is the same directory answering a declared command.
  describe('the retired create, lint, test and studio commands are refused (objectui#11500)', () => {
    const runWithoutPath = (args: string[], cwd: string) => {
      const res = spawnSync(process.execPath, [CLI_BIN, ...args], {
        cwd,
        encoding: 'utf-8',
        env: { ...process.env, PATH: '' },
        timeout: 60_000,
      });
      return { code: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
    };

    const cases: Array<[string, string[]]> = [
      ['create', ['create', 'plugin', 'probe-widget']],
      ['lint', ['lint']],
      ['test', ['test']],
      ['studio', ['studio']],
    ];
    it.each(cases)('exits non-zero with the unknown-command error on `%s`, and writes nothing', (name, args) => {
      const work = mkdtempSync(join(tmpdir(), `objectui-cli-${name}-retired-`));
      const res = runWithoutPath(args, work);
      expect(res.code, res.stdout + res.stderr).not.toBe(0);
      expect(res.stderr).toContain(`unknown command '${name}'`);
      expect(tree(work)).toEqual([]);

      const control = run(['g', 'page', 'Probe'], { cwd: work });
      expect(control.code, control.stdout + control.stderr).toBe(0);
      expect(tree(work)).toEqual(['pages', 'pages/probe.json']);
    });
  });

  // objectui#11496, the family close-out over every command and flag. `analyze
  // --render-performance` printed the same fixed list of tips and ticks in any
  // directory, a built project or an empty one, and analysed nothing. It is
  // retired. `--bundle-size` only chose between that and the bundle report, so
  // with nothing left to choose from it would be read by nothing, which is the
  // shape `generate --output` was retired for; it is retired with it. `analyze`
  // with no flag is the control: it still reports the bundle under `dist/`.
  describe('analyze refuses its retired flags (objectui#11496)', () => {
    it.each(['--render-performance', '--bundle-size'])(
      'exits non-zero naming %s as an unknown option, and writes nothing',
      (flag) => {
        const work = mkdtempSync(join(tmpdir(), 'objectui-cli-analyze-retired-'));
        const res = run(['analyze', flag], { cwd: work });
        expect(res.code, res.stdout + res.stderr).not.toBe(0);
        expect(res.stderr).toMatch(/unknown option/i);
        expect(res.stderr).toContain(flag);
        expect(tree(work)).toEqual([]);
      },
    );

    it('still reports the bundle under dist/ without a flag, and no render section', () => {
      const work = mkdtempSync(join(tmpdir(), 'objectui-cli-analyze-'));
      mkdirSync(join(work, 'dist', 'assets'), { recursive: true });
      writeFileSync(join(work, 'dist', 'assets', 'probe-bundle.js'), 'x'.repeat(2048));
      const res = run(['analyze'], { cwd: work });
      expect(res.code, res.stdout + res.stderr).toBe(0);
      expect(res.stdout).toContain('Bundle Size Analysis');
      expect(res.stdout).toContain('assets/probe-bundle.js');
      expect(res.stdout).not.toMatch(/render performance/i);
    });

    // objectui#11500. With no `dist/`, analyze printed a warning, then "Analysis
    // complete", and exited 0, so a script read an analysis that never happened
    // as a pass.
    it('exits non-zero without dist/, and claims no analysis (objectui#11500)', () => {
      const work = mkdtempSync(join(tmpdir(), 'objectui-cli-analyze-nodist-'));
      const res = run(['analyze'], { cwd: work });
      expect(res.code, res.stdout + res.stderr).not.toBe(0);
      expect(res.stderr).toContain('dist/');
      expect(res.stdout).not.toMatch(/analysis complete/i);
      expect(tree(work)).toEqual([]);
    });

    it('lists neither flag in analyze --help', () => {
      const res = run(['analyze', '--help']);
      expect(res.code, res.stderr).toBe(0);
      // Lit control: the help text that was read is analyze's own usage line.
      expect(res.stdout).toMatch(/Usage: objectui analyze\b/);
      expect(res.stdout).not.toMatch(/--render-performance\b/);
      expect(res.stdout).not.toMatch(/--bundle-size\b/);
    });
  });

  describe('validate', () => {
    let work: string;
    beforeAll(() => {
      work = mkdtempSync(join(tmpdir(), 'objectui-cli-validate-'));
      writeFileSync(
        join(work, 'good.json'),
        JSON.stringify({
          type: 'div',
          className: 'p-4',
          children: { type: 'text', content: 'ok' },
        }),
      );
      writeFileSync(join(work, 'bad.json'), JSON.stringify({ no_type_field: true }));
    });

    it('exits 0 for a valid schema', () => {
      const res = run(['validate', 'good.json'], { cwd: work });
      expect(res.code, res.stdout + res.stderr).toBe(0);
      expect(res.stdout).toMatch(/Schema is valid/i);
    });

    it('exits non-zero for an invalid schema', () => {
      const res = run(['validate', 'bad.json'], { cwd: work });
      expect(res.code).not.toBe(0);
    });

    it('exits non-zero when the file is missing', () => {
      const res = run(['validate', 'does-not-exist.json'], { cwd: work });
      expect(res.code).not.toBe(0);
      expect(res.stdout + res.stderr).toMatch(/not found/i);
    });
  });

  describe('init', () => {
    let work: string;
    let appDir: string;
    // Scaffolded once in `beforeAll` rather than by the first `it`, so the
    // assertions below do not silently depend on test ordering (objectui#3892
    // added three of them to what was a single self-contained case).
    beforeAll(() => {
      work = mkdtempSync(join(tmpdir(), 'objectui-cli-init-'));
      appDir = join(work, 'sample-app');
      const res = run(['init', 'sample-app', '-t', 'simple'], { cwd: work });
      expect(res.code, res.stdout + res.stderr).toBe(0);
    });

    // objectui#11500. `init NAME -t nope` exited 1 but left an empty NAME
    // directory behind, so the next `init NAME` was refused as "already exists".
    // The control is the same directory scaffolding with a real template.
    it('refuses an unknown template before creating the directory (objectui#11500)', () => {
      const dir = mkdtempSync(join(tmpdir(), 'objectui-cli-init-unknown-template-'));
      const res = run(['init', 'probe-app', '-t', 'nope'], { cwd: dir });
      expect(res.code, res.stdout + res.stderr).not.toBe(0);
      expect(res.stderr).toMatch(/unknown template/i);
      expect(tree(dir)).toEqual([]);

      const control = run(['init', 'probe-app', '-t', 'simple'], { cwd: dir });
      expect(control.code, control.stdout + control.stderr).toBe(0);
      expect(existsSync(join(dir, 'probe-app', 'app.json'))).toBe(true);
    });

    it('scaffolds a project with the simple template', () => {
      for (const f of [
        'app.json',
        'package.json',
        'index.html',
        'vite.config.ts',
        'tsconfig.json',
        'src/App.tsx',
        'src/main.tsx',
        'src/index.css',
      ]) {
        expect(existsSync(join(appDir, f)), `expected ${f} to exist`).toBe(true);
      }
      const schema = JSON.parse(readFileSync(join(appDir, 'app.json'), 'utf-8'));
      expect(schema).toHaveProperty('type');
    });

    it('writes no tailwind.config.js, because v4 would never read it', () => {
      // objectui#3892, mirroring what objectui#3852 did for the temp-app
      // generators. The scaffold's pipeline is Tailwind 4 end to end
      // (`@tailwindcss/postcss` in `postcss.config.js`, `@import 'tailwindcss'`
      // in `src/index.css`), and v4 reads a JS config only when a stylesheet
      // points `@config` at it. The file this used to write was inert: an
      // authoritative-looking `content` list nothing consumed.
      //
      // Asserted through the real bin rather than over a file map, because
      // `init()` writes with `fs` directly — an absence is only meaningful
      // where the writes actually happen.
      expect(existsSync(join(appDir, 'tailwind.config.js'))).toBe(false);
      expect(existsSync(join(appDir, 'tailwind.config.ts'))).toBe(false);
      expect(readFileSync(join(appDir, 'src/index.css'), 'utf-8')).not.toContain('@config');
      // The v4 pipeline it is inert *relative to*, so the absence above cannot
      // be read as "this scaffold is not on Tailwind at all".
      expect(readFileSync(join(appDir, 'postcss.config.js'), 'utf-8')).toContain(
        `'@tailwindcss/postcss': {}`
      );
      expect(readFileSync(join(appDir, 'src/index.css'), 'utf-8')).toContain(
        `@import 'tailwindcss';`
      );
    });

    it('writes a src/App.tsx that fills the component registry', () => {
      // objectui#4061, asserted where the user meets it. `SchemaRenderer` looks
      // every node up in `ComponentRegistry` and renders "Unknown component
      // type" on a miss; registration happens as a side effect of importing
      // `@object-ui/components`, and `@object-ui/react` does not depend on that
      // package — so before this the scaffold's whole visible output was error
      // boxes for all three templates.
      //
      // `app-generator.test.ts` judges the file MAP structurally (declared vs
      // imported, both directions); this asserts `init()` actually writes it,
      // which is the half a unit test on the builder cannot see.
      const app = readFileSync(join(appDir, 'src/App.tsx'), 'utf-8');
      expect(app).toContain(`import '@object-ui/components';`);
      expect(app).toContain(`import { SchemaRenderer } from '@object-ui/react';`);
      // The manifest half was already there — the defect was that it was
      // declared and never imported, so pin both ends together.
      const manifest = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf-8')) as {
        dependencies: Record<string, string>;
      };
      expect(manifest.dependencies['@object-ui/components']).toBeDefined();
      // No plugin dependency is imported that the manifest does not declare:
      // the three templates name only types `@object-ui/components` registers.
      expect(app).not.toContain('@object-ui/plugin-');
    });

    it('writes a src/index.css that loads the library stylesheet', () => {
      // objectui#4062. The theme utilities the templates lean on resolve through
      // tokens declared in a `@theme` block that `files` does not publish, so an
      // installed consumer can only get them from the prebuilt
      // `@object-ui/components/style.css` — a real export
      // (`"./style.css": "./dist/index.css"`), and per objectui#3884 a strict
      // superset of anything a `node_modules` scan yields.
      const css = readFileSync(join(appDir, 'src/index.css'), 'utf-8');
      expect(css).toContain(`@import '@object-ui/components/style.css';`);
      // Tailwind entry stays first (the assertion above must not be satisfied by
      // a file that reordered the entrypoint).
      expect(css.indexOf(`@import 'tailwindcss';`)).toBe(0);
      // `@object-ui/fields` ships zero CSS at 17.3.0 and is not a dependency of
      // this scaffold, so quick-start's second line is deliberately not copied
      // (objectui#4059).
      expect(css).not.toContain('@object-ui/fields');
    });

    it('writes exactly the file map buildInitFiles returns, byte for byte', () => {
      // The equivalence the two structural gates in `app-generator.test.ts` rest
      // on: they judge `buildInitFiles`, so a file `init()` wrote some other way
      // would be judged by nothing. Every generated path and its bytes, both
      // directions — an extra file on disk fails as loudly as a missing one.
      //
      // A failure here can also mean `dist/cli.js` is stale relative to
      // `src/commands/init.ts` — `beforeAll` only builds when the bundle is
      // absent. Rebuild the package before reading it as a real defect.
      const files = buildInitFiles('sample-app', 'simple');

      const walk = (dir: string, prefix = ''): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
          entry.isDirectory()
            ? walk(join(dir, entry.name), `${prefix}${entry.name}/`)
            : [`${prefix}${entry.name}`],
        );

      expect(walk(appDir).sort()).toEqual(Object.keys(files).sort());
      expect(
        Object.fromEntries(
          Object.keys(files).map((relativePath) => [
            relativePath,
            readFileSync(join(appDir, relativePath), 'utf-8'),
          ]),
        ),
      ).toEqual(files);
    });

    it('versions the scaffold against the CLI that wrote it, not a literal', () => {
      // objectui#3892's reported defect, gated where the user meets it: the
      // manifest asked for `@object-ui/*` at `^2.0.0` while the CLI and every
      // platform package publish at 17.x from one `fixed` changeset group, so
      // `npm install` in a fresh scaffold resolved a major unrelated to the CLI
      // that produced it.
      //
      // `app-generator.test.ts` anchors `buildInitPackageJson`'s ranges; this
      // asserts `init()` actually WRITES that manifest, which is the half a
      // unit test on the builder cannot see.
      const cliVersion = JSON.parse(readFileSync(PKG_PATH, 'utf-8')).version as string;
      const manifest = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf-8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };

      expect(manifest.dependencies['@object-ui/react']).toBe(`^${cliVersion}`);
      expect(manifest.dependencies['@object-ui/components']).toBe(`^${cliVersion}`);
      expect(manifest.dependencies['@object-ui/react']).not.toBe('^2.0.0');
      // A spot check that the toolchain half is written too — the full anchor
      // judgement lives in `app-generator.test.ts`.
      expect(manifest.devDependencies.vite).not.toBe('^7.3.1');
    });
  });

  // objectstack#25911. The two cli-bin files share one build behind a lock
  // directory in `cliBin.ts`. A run killed while holding it never removes it,
  // so the next run must read the holder's pid and take over a dead one at
  // once, rather than wait out the hook timeout with nobody building. The
  // control is the same lock held by a live pid, which is waited on. Both run
  // after this file's `beforeAll`, so `dist/` is present and no build spawn may
  // be called.
  describe('the shared build lock (objectstack#25911)', () => {
    const noBuild = {
      types: (): never => {
        throw new Error('dist/ is built by beforeAll; the types build must not run');
      },
      cli: (): never => {
        throw new Error('dist/ is built by beforeAll; the cli build must not run');
      },
    };
    const plantLock = (pid: number) => {
      const lockDir = join(mkdtempSync(join(tmpdir(), 'objectui-cli-bin-lock-')), 'build.lock');
      mkdirSync(lockDir);
      writeFileSync(join(lockDir, 'pid'), String(pid));
      return lockDir;
    };

    it('takes over a lock whose holder pid is dead, without waiting', () => {
      // A child that has exited and been reaped: its pid names no process.
      const dead = spawnSync(process.execPath, ['-e', '']);
      expect(dead.status).toBe(0);
      const lockDir = plantLock(dead.pid);

      const started = Date.now();
      ensureCliBuilt(noBuild, { lockDir, waitMs: 60_000 });
      expect(Date.now() - started).toBeLessThan(5_000);
      // Released on the way out, like any lock it acquired.
      expect(existsSync(lockDir)).toBe(false);
    });

    it('control: waits on a lock whose holder pid is alive, and times out naming it', () => {
      const lockDir = plantLock(process.pid);
      expect(() => ensureCliBuilt(noBuild, { lockDir, waitMs: 600 })).toThrow(
        new RegExp(`Timed out after 600 ms .* held by pid ${process.pid}\\.`),
      );
      // Not taken over: the live holder's lock is still there.
      expect(existsSync(lockDir)).toBe(true);
      rmSync(lockDir, { recursive: true, force: true });
    });
  });
});
