import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * objectui#3515 — the four repo-ROOT `vitest.setup.*` files were in zero tsc
 * programs.
 *
 * They live at the repo root, outside every workspace package, so `pnpm
 * type-check` (`turbo run type-check`, driven by package.json `scripts`)
 * structurally cannot reach them. The root `tsconfig.json` includes only
 * `packages`/`examples`/`apps`; `tsconfig.scripts.json` only `scripts/**`. And
 * nothing IMPORTS them — every consumer names them as a Vitest `setupFiles`
 * runtime path string, so no gated program has a type edge to them either. The
 * only program that did contain them, the root `tsconfig.node.json`, has no
 * `include` (it therefore compiles the entire repository, currently ~21.6k
 * errors) and no script runs it: not a gate.
 *
 * That matters because `vitest.setup.dom.tsx` decides which package graphs get
 * registered before the `dom-heavy` project runs. Drift there does not fail as a
 * type error — it fails as a confusing "component not registered" in whichever
 * test happened to depend on the registration.
 *
 * `tsconfig.vitest-setup.json` closes it. This file is what stops it reopening,
 * and like its sibling `scripts-type-check.test.ts` it asserts BEHAVIOUR — which
 * files the project actually resolves, whether CI actually runs it, and in the
 * right place — rather than the config's spelling. A test that only checked the
 * spelling would be satisfied by a config that compiles nothing, which is the
 * exact failure mode it exists to prevent.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const configPath = path.join(repoRoot, 'tsconfig.vitest-setup.json');
const ciWorkflowPath = path.join(repoRoot, '.github/workflows/ci.yml');

/** The root script CI invokes, and the one a contributor can run locally. */
const SCRIPT_NAME = 'type-check:vitest-setup';

/**
 * The packages `vitest.setup.dom.tsx` side-effect-imports for their
 * ComponentRegistry registrations. Resolving these is the reason this project
 * needs a built workspace, and therefore the reason its CI step sits where it
 * does.
 */
const SIDE_EFFECT_PACKAGES = [
  '@object-ui/components',
  '@object-ui/fields',
  '@object-ui/plugin-dashboard',
  '@object-ui/plugin-grid',
] as const;

/**
 * The project as TypeScript itself resolves it: the same parse `tsc -p` does, so
 * `fileNames` is the real program root set rather than a re-implementation of
 * TypeScript's glob semantics.
 */
function parsedProject(): ts.ParsedCommandLine {
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  expect(
    read.error && ts.flattenDiagnosticMessageText(read.error.messageText, ' '),
    'tsconfig.vitest-setup.json must parse as JSON with comments',
  ).toBeFalsy();

  return ts.parseJsonConfigFileContent(read.config, ts.sys, repoRoot, undefined, configPath);
}

/** Every `vitest.setup*` TypeScript source sitting at the repo root, repo-relative. */
function rootSetupFilesOnDisk(): string[] {
  return fs
    .readdirSync(repoRoot, { withFileTypes: true })
    .filter((e) => e.isFile() && /^vitest\.setup.*\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts'))
    .map((e) => e.name)
    .sort();
}

describe('tsconfig.vitest-setup.json — the project itself (objectui#3515)', () => {
  /**
   * A tsconfig that fails to parse does not fail loudly: TypeScript falls back to
   * defaults, and with no `include` surviving, `tsc -p` cheerfully compiles the
   * ENTIRE repository — which reads as "this config is broken" rather than "this
   * config is unparseable". `tsconfig.scripts.json` hit exactly that while being
   * written (a `**` followed by `/` inside a block comment terminates it), which
   * is why both configs comment with `//`.
   */
  it('parses with no diagnostics at all', () => {
    const messages = parsedProject().errors.map((d) =>
      ts.flattenDiagnosticMessageText(d.messageText, ' '),
    );
    expect(messages, 'tsconfig.vitest-setup.json emitted config diagnostics').toEqual([]);
  });

  it('is a checking project, not an emitting one', () => {
    const { options } = parsedProject();

    expect(options.noEmit, 'tsconfig.vitest-setup.json must set "noEmit": true').toBe(true);
    expect(options.strict, 'tsconfig.vitest-setup.json must set "strict": true').toBe(true);

    // `noEmit` is only legal because the project is standalone. If someone makes
    // it `composite` or gives it `references`, TS6310 fires and the two
    // assertions above become mutually unsatisfiable — fail on the cause, not on
    // the symptom.
    expect(options.composite, 'a composite project may not set "noEmit" (TS6310)').toBeFalsy();
    expect(parsedProject().projectReferences ?? [], 'this project must stay standalone').toEqual([]);
  });

  it('checks the files against a DOM and can read .tsx', () => {
    const { options } = parsedProject();

    // Both were measured load-bearing, so pin them rather than trusting the
    // comment. Without DOM in `lib`, `vitest.setup.base.ts` alone produces 14
    // errors (`Storage`, `document`, `Element`); these files exist to polyfill a
    // DOM, so they have to be checked against one.
    expect(
      (options.lib ?? []).map((l) => l.toLowerCase()),
      '"lib" must include DOM — the setup files declare Storage/document/Element',
    ).toContain('lib.dom.d.ts');

    // Without `jsx`, `vitest.setup.tsx` fails with TS6142: importing a module
    // that resolves to a `.tsx` file requires `--jsx`, whether or not that file
    // contains any JSX (none of them currently does).
    expect(options.jsx, '"jsx" must be set — three of the four files are .tsx').toBeDefined();
  });

  /**
   * `allowJs` is the option objectui#3494 measured into `tsconfig.scripts.json`
   * and objectui#3513 documented the cost of: it makes a `@ts-expect-error` over
   * a plain-JS import unused, and therefore an error of its own (TS2578). This
   * project sidesteps it because none of its files import `.js`/`.mjs` — pin
   * that premise, so turning `allowJs` on later has to be a decision rather than
   * an accident.
   */
  it('needs no allowJs, because nothing in its program imports plain JS', () => {
    const { options } = parsedProject();
    expect(options.allowJs, 'tsconfig.vitest-setup.json must not enable allowJs').toBeFalsy();

    const jsImports = parsedProject()
      .fileNames.flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/from\s+'([^']+\.m?js)'/g)])
      .map((m) => m[1]);
    expect(
      jsImports,
      'a setup file now imports plain JS. Enabling `allowJs` is the fix, but read ' +
        'apps/console/tsconfig.node.json first — it turns any @ts-expect-error over such an ' +
        'import into an unused-directive error (TS2578).',
    ).toEqual([]);
  });
});

describe('tsconfig.vitest-setup.json — coverage of the root setup files (objectui#3515)', () => {
  it('resolves every root vitest.setup* source, with none left out', () => {
    const onDisk = rootSetupFilesOnDisk();

    // Non-vacuity first. Every other assertion here is satisfied by a project
    // that resolves nothing, and "compiles nothing, exits 0" is exactly what this
    // gate exists to make impossible.
    expect(
      onDisk.length,
      'no vitest.setup* sources found at the repo root — the scan is broken',
    ).toBeGreaterThanOrEqual(4);

    const inProject = new Set(
      parsedProject().fileNames.map((f) => path.relative(repoRoot, f).split(path.sep).join('/')),
    );
    const uncovered = onDisk.filter((f) => !inProject.has(f));

    expect(
      uncovered,
      'These repo-root setup files are not in tsconfig.vitest-setup.json’s program, so nothing ' +
        'type-checks them:\n' +
        uncovered.map((f) => `  - ${f}`).join('\n') +
        '\n\nWiden the "include" globs in tsconfig.vitest-setup.json. A root setup file that no ' +
        'tsc invocation reads is objectui#3515 all over again — and drift in one surfaces as a ' +
        'confusing "component not registered" test failure, not as a type error.',
    ).toEqual([]);
  });

  it('really does cover all four, by name', () => {
    // The forward assertion above is a set difference, which stays green if the
    // directory scan ever stops finding anything. Name them outright.
    const inProject = new Set(
      parsedProject().fileNames.map((f) => path.relative(repoRoot, f).split(path.sep).join('/')),
    );
    for (const file of [
      'vitest.setup.base.ts',
      'vitest.setup.dom.tsx',
      'vitest.setup.dom-light.tsx',
      'vitest.setup.tsx',
    ]) {
      expect(inProject, `${file} must be type-checked by tsconfig.vitest-setup.json`).toContain(file);
    }
  });

  /**
   * The program must stay SMALL. Mapping the four side-effect packages at their
   * `src/` instead — mirroring vitest.config.mts's `resolve.alias` — was measured
   * and rejected: it drags 318–563 foreign source files in and re-checks packages
   * that already have their own gates under a different option set (24 of the
   * residual errors are implicit-anys that `packages/components/tsconfig.json`
   * makes legal with `noImplicitAny: false`). Mapping to the package directory
   * lands on published declarations instead, which `skipLibCheck` skips.
   */
  it('checks only the root setup files, not other packages’ sources', () => {
    // Built as a real PROGRAM, not read off `fileNames`. `fileNames` is only the
    // project's ROOT set — the files the `include` globs matched — so whatever
    // `paths` pulls in never appears there. An earlier draft of this test asserted
    // over `fileNames` and stayed green when `paths` was repointed at `src/`:
    // green because nothing was produced, which is the shape it exists to catch.
    const { fileNames, options } = parsedProject();
    const foreign = ts
      .createProgram(fileNames, options)
      .getSourceFiles()
      .filter((sf) => !sf.isDeclarationFile)
      .map((sf) => path.relative(repoRoot, sf.fileName).split(path.sep).join('/'))
      .filter((f) => !f.startsWith('vitest.setup') && !f.startsWith('node_modules/'));
    // The node_modules exclusion is not a loophole: it drops exactly one file,
    // `@reduxjs/toolkit`'s vendored `dist/uncheckedindexed.ts`, which a dependency
    // declaration references. It is third-party, unactionable from here, and — as
    // a non-declaration file — the one thing in this program `skipLibCheck` does
    // not cover. The subject of this assertion is WORKSPACE sources.

    expect(
      foreign,
      'tsconfig.vitest-setup.json is now checking non-declaration files outside its subject:\n' +
        foreign.map((f) => `  - ${f}`).join('\n') +
        '\n\nIts "paths" must resolve the @object-ui/* side-effect imports to each package ' +
        'DIRECTORY (i.e. its published `exports.types`), not to `src/`. Pointing at sources ' +
        're-checks packages that already have their own gates, under this project’s stricter ' +
        'option set — the "green in one project, red in the other" hazard tsconfig.scripts.json ' +
        'documents.',
    ).toEqual([]);
  });
});

describe('the gate is actually wired up (objectui#3515)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const ciWorkflow = fs.readFileSync(ciWorkflowPath, 'utf8');

  /** The `type-check:` job body, from its key up to the next job at the same indent. */
  function typeCheckJob(): string {
    const start = ciWorkflow.search(/^ {2}type-check:[ \t]*$/m);
    expect(start, 'ci.yml must still have a `type-check:` job').toBeGreaterThan(-1);
    const rest = ciWorkflow.slice(start + 1);
    const next = rest.search(/^ {2}[a-z0-9][a-z0-9-]*:[ \t]*$/m);
    return next === -1 ? rest : rest.slice(0, next);
  }

  it('is runnable locally, not CI-only', () => {
    // `pnpm type-check` is `turbo run type-check` and cannot reach files outside
    // a workspace package, so without a named root script this project would only
    // ever run on a CI runner — and a gate nobody can reproduce locally is a gate
    // people learn to ignore.
    expect(pkg.scripts?.[SCRIPT_NAME], `package.json must define "${SCRIPT_NAME}"`).toBeDefined();
    expect(pkg.scripts?.[SCRIPT_NAME]).toContain('tsconfig.vitest-setup.json');
  });

  it('runs in ci.yml’s type-check job', () => {
    expect(
      typeCheckJob(),
      `ci.yml’s type-check job must run \`pnpm ${SCRIPT_NAME}\`. Without it, ` +
        'tsconfig.vitest-setup.json is a file that looks like a gate while no CI job reads it — ' +
        'the same shape as the unchecked setup files it was added to fix.',
    ).toContain(`pnpm ${SCRIPT_NAME}`);
  });

  /**
   * The placement premise, and the one real difference from
   * `tsconfig.scripts.json`: that project's pin test asserts its program imports
   * NO workspace package, so it may run in the cheap half of the job. This one
   * asserts the opposite, because `vitest.setup.dom.tsx` genuinely does — and the
   * declarations it resolves them through only exist after turbo's `type-check`
   * task has run its `^build`.
   */
  it('runs AFTER the build, because its program needs built declarations', () => {
    const job = typeCheckJob();
    // A line that IS the bare command, as `run:`'s value or inside a `run: |`
    // block -- objectui#12222 put the two speeds' branches in that step.
    const build = job.search(/^\s+(?:run: )?pnpm type-check$/m);
    const check = job.indexOf(`pnpm ${SCRIPT_NAME}`);

    expect(build, 'the type-check job must still run `pnpm type-check`').toBeGreaterThan(-1);
    expect(check, 'the type-check job must run the vitest-setup type-check').toBeGreaterThan(-1);
    expect(
      check,
      `\`pnpm ${SCRIPT_NAME}\` must come after \`pnpm type-check\`, whose turbo task dependsOn ` +
        '`^build`. Its program resolves @object-ui/* through those packages’ built declarations; ' +
        'run earlier it fails with four TS2882s that look nothing like their real cause.',
    ).toBeGreaterThan(build);
  });

  it('still has a real reason to run after the build', () => {
    // If the side-effect imports ever disappear, this project stops needing the
    // build and should move up into the cheap half of the job. Pin the premise so
    // the placement cannot quietly become cargo cult.
    const domSetup = fs.readFileSync(path.join(repoRoot, 'vitest.setup.dom.tsx'), 'utf8');
    const imported = SIDE_EFFECT_PACKAGES.filter((p) => domSetup.includes(`import '${p}'`));

    expect(
      imported,
      'vitest.setup.dom.tsx no longer side-effect-imports all four registration packages. If it ' +
        'imports none of them, this project needs no built workspace and its ci.yml step belongs ' +
        'next to `pnpm type-check:scripts` instead.',
    ).toEqual([...SIDE_EFFECT_PACKAGES]);
  });
});
