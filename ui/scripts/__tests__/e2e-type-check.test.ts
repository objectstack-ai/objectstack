import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { globToRegExp, repoFilesOnDisk } from './helpers/turbo-inputs';

/**
 * objectui#4471 — the 30 Playwright specs under `e2e/` were compiled by nothing.
 *
 * `e2e/` is not a workspace package, so `pnpm type-check` (i.e. `turbo run
 * type-check`, which walks package.json `scripts`) structurally cannot reach it;
 * and no tsconfig in the repo included it — the root `tsconfig.json` includes
 * only `packages`/`examples`/`apps`, `tsconfig.scripts.json` only `scripts/**`,
 * `tsconfig.vitest-setup.json` only the root `vitest.setup*` files. Playwright
 * TRANSPILES specs rather than type-checking them, so nothing ever read them.
 *
 * That is objectui#3494's shape one directory over, and objectui#3515's one
 * directory across. It matters more for a test directory than for most: a spec
 * the compiler never reads can call a method that does not exist and still print
 * green, because the call sits in a branch the run never takes. The first compile
 * found exactly that in `e2e/live/master-detail.spec.ts` — a `waitForRequest`
 * predicate ending `r.request?.().method?.() !== 'GET'`, where `Request` has no
 * `request` member, so the optional chain made the whole conjunct
 * `undefined !== 'GET'`: always true, for the life of the file.
 *
 * `tsconfig.e2e.json` closes it. This file is what stops it reopening, and like
 * its two siblings it deliberately asserts BEHAVIOUR — which files the project
 * really resolves, what its options really accept, whether the pipeline really
 * runs it — rather than the config's spelling. A test that only checked the
 * spelling would be satisfied by a config that compiles nothing, which is the
 * failure mode it exists to prevent.
 *
 * objectui#4477 is the same statement one directory UP. The four root
 * `playwright*.config.ts` files sit beside `tsconfig.e2e.json` rather than under
 * `e2e/`, so #4471's glob did not reach them and nothing else compiled them
 * either — yet they decide which specs run, where they run, and what
 * `webServer` command builds the app under test. Widening the include cost zero
 * errors (measured on both sides of the twelve days between filing and landing),
 * so what this half pins is the GATE, not a fix: `testIgnore` or a `projects`
 * entry misspelled into `undefined` is invisible to Playwright, which transpiles
 * the config and reads the result as intent.
 *
 * Both halves are asserted the same way, and it is the way that matters: by
 * discovering what is on disk and asking whether the program resolves it, never
 * by naming the files. A four-name list would pass on the day it is written and
 * be wrong the day a fifth config lands — which is precisely the defect both
 * cards are about.
 *
 * The one structural difference from `scripts-type-check.test.ts`: that gate is
 * a direct step in ci.yml's `type-check` job, this one is a turbo ROOT TASK
 * (`//#type-check:e2e`) that the `type-check` task `dependsOn` — the shape
 * objectui#4456 introduced for `//#lint:root`. So the wiring assertions below
 * are about turbo.json rather than about a workflow step, and they include the
 * `cache: false` half: see `turbo-task-guard-coverage.test.ts` for why a task
 * that turbo could replay would owe a derived-inputs guard instead.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const configPath = path.join(repoRoot, 'tsconfig.e2e.json');
const e2eDir = path.join(repoRoot, 'e2e');

/** The root script a contributor runs, and the turbo root task that drives it. */
const SCRIPT_NAME = 'type-check:e2e';
const TURBO_TASK = `//#${SCRIPT_NAME}`;

/**
 * The project as TypeScript itself resolves it: the same parse `tsc -p` does,
 * so `fileNames` is the real program root set rather than a re-implementation
 * of TypeScript's glob semantics.
 */
function parsedProject(): ts.ParsedCommandLine {
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  expect(
    read.error && ts.flattenDiagnosticMessageText(read.error.messageText, ' '),
    'tsconfig.e2e.json must parse as JSON with comments',
  ).toBeFalsy();

  return ts.parseJsonConfigFileContent(read.config, ts.sys, repoRoot, undefined, configPath);
}

/** Every TypeScript source on disk under `e2e/`, repo-relative, POSIX-separated. */
function typeScriptSourcesOnDisk(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        out.push(path.relative(repoRoot, full).split(path.sep).join('/'));
      }
    }
  };
  walk(e2eDir);
  return out.sort();
}

/**
 * Every root-level `playwright*.config.ts` on disk, repo-relative.
 *
 * A faithful translation of the config's second `include` pattern: `*` in a
 * tsconfig glob does not cross a path separator, so the pattern matches files
 * directly at the repo root and this walk must not descend either. Discovered,
 * not listed — see the header.
 */
function rootPlaywrightConfigsOnDisk(): string[] {
  return fs
    .readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^playwright.*\.config\.ts$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/** Repo-relative, POSIX-separated program root files. */
function programFiles(): Set<string> {
  return new Set(
    parsedProject().fileNames.map((f) => path.relative(repoRoot, f).split(path.sep).join('/')),
  );
}

/**
 * Compile one throwaway source file with THIS project's real options and return
 * its diagnostics.
 *
 * The point is to ask the option set a question it can only answer by being
 * correct, instead of asserting the strings in `lib`. `"lib": ["ES2022", ...]`
 * spelled right but paired with a `target` that overrides it, or an `ES2022`
 * that a later edit trims back to `ES2021`, both pass a spelling check and both
 * reintroduce the defect.
 */
function diagnosticsFor(source: string): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-type-check-'));
  try {
    const file = path.join(dir, 'probe.ts');
    fs.writeFileSync(file, source);
    const program = ts.createProgram([file], { ...parsedProject().options, noEmit: true });
    return ts
      .getPreEmitDiagnostics(program)
      .filter((d) => d.file?.fileName === file.split(path.sep).join('/'))
      .map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Parse the REAL config against a throwaway tree that holds one root config
 * which does not exist in this repo, and return the program root set.
 *
 * This is how the glob-not-a-list doctrine is asked as a question rather than
 * asserted as a spelling. An `include` of four literal filenames satisfies every
 * on-disk sweep in this file on the day it is written; only a config that
 * resolves a name nobody has typed yet can answer for the fifth one. The tree is
 * throwaway rather than the repo root because a transient `.ts` file appearing
 * at the real root would be visible to every other guard that enumerates it.
 */
function programFilesWithSyntheticRootConfig(name: string): Set<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-type-check-fifth-'));
  try {
    const copied = path.join(dir, path.basename(configPath));
    fs.copyFileSync(configPath, copied);
    fs.writeFileSync(path.join(dir, name), 'export default {};\n');
    fs.mkdirSync(path.join(dir, 'e2e'));
    fs.writeFileSync(path.join(dir, 'e2e', 'placeholder.spec.ts'), 'export {};\n');

    const read = ts.readConfigFile(copied, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dir, undefined, copied);
    return new Set(parsed.fileNames.map((f) => path.relative(dir, f).split(path.sep).join('/')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('tsconfig.e2e.json — the project itself (objectui#4471)', () => {
  /**
   * A tsconfig that fails to parse does not fail loudly: TypeScript falls back
   * to defaults, and with no `include` surviving, `tsc -p` cheerfully compiles
   * the ENTIRE repository. `tsconfig.scripts.json` records how that was found —
   * a `**` immediately followed by `/` inside a block comment closes the comment
   * early — which is why this config, like its siblings, uses `//` comments.
   */
  it('parses with no diagnostics at all', () => {
    const parsed = parsedProject();
    const messages = parsed.errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
    expect(messages, 'tsconfig.e2e.json emitted config diagnostics').toEqual([]);
  });

  it('is a checking project, not an emitting one', () => {
    const { options } = parsedProject();

    // It must not emit: these are checks, and a stray `.js` landing next to a
    // spec would be picked up by `playwright.config.ts`'s `testDir: './e2e'` as
    // a test in its own right.
    expect(options.noEmit, 'tsconfig.e2e.json must set "noEmit": true').toBe(true);
    expect(options.strict, 'tsconfig.e2e.json must set "strict": true').toBe(true);

    // `noEmit` is only legal here because the project is standalone. If someone
    // makes it `composite` or gives it `references`, TS6310 fires and the two
    // assertions above become mutually unsatisfiable — fail on the cause, not
    // on the symptom.
    expect(options.composite, 'a composite project may not set "noEmit" (TS6310)').toBeFalsy();
    expect(parsedProject().projectReferences ?? [], 'this project must stay standalone').toEqual([]);
  });
});

describe('tsconfig.e2e.json — the option set answers the questions e2e/ asks (objectui#4471)', () => {
  /**
   * The caveat objectui#4471 measured before anyone started: PR #4470 added
   * `new Error(msg, { cause: e })` to `e2e/live/global-setup.ts` to satisfy the
   * `preserve-caught-error` lint rule, and `ErrorOptions` does not exist before
   * ES2022 — so a config inheriting the root `tsconfig.json`'s ES2020 reds with
   * `TS2554: Expected 0-1 arguments, but got 2` on a file that runs before every
   * live-suite run.
   */
  it('accepts `new Error(msg, { cause })`, so the lib is ES2022 or newer', () => {
    expect(
      diagnosticsFor('export const e = new Error("boom", { cause: new Error("why") });'),
      'tsconfig.e2e.json’s lib no longer provides ErrorOptions. e2e/live/global-setup.ts ' +
        'constructs `new Error(msg, { cause: e })` for `preserve-caught-error`; on an ES2020 lib ' +
        'that is TS2554 (objectui#4471 measured it). Restore "lib": ["ES2022", ...].',
    ).toEqual([]);
  });

  /**
   * `page.evaluate(...)` callbacks are compiled in this program while executing
   * in the browser, so DOM globals must resolve. Measured on first run: without
   * DOM, three errors — `document` in `e2e/helpers/index.ts` and
   * `e2e/smoke.spec.ts`, `HTMLElement` in `e2e/live/cascading-options.spec.ts`.
   */
  it('resolves DOM globals, which page.evaluate callbacks are written against', () => {
    expect(
      diagnosticsFor('export const n = document.getElementById("root")?.children.length ?? 0;'),
      'tsconfig.e2e.json must keep "DOM" in `lib` — page.evaluate callbacks are type-checked here.',
    ).toEqual([]);
  });

  /**
   * The specs are Node programs outside the browser callbacks: `process.env` in
   * 11 files, `Buffer` in three, `node:fs`/`node:path` in two. Measured with
   * `"types": []`: 26 errors across 12 files, every one TS2591.
   */
  it('resolves Node globals and `node:` builtins', () => {
    expect(
      diagnosticsFor(
        'import { readFileSync } from "node:fs";\n' +
          'export const p = process.env.LIVE_API_URL ?? readFileSync("x").toString();\n' +
          'export const b: Buffer = Buffer.from("x");',
      ),
      'tsconfig.e2e.json must keep "types": ["node"] — the specs read process.env and node: builtins.',
    ).toEqual([]);
  });
});

describe('tsconfig.e2e.json — coverage of e2e/ (objectui#4471)', () => {
  it('resolves every TypeScript source under e2e/, with none left out', () => {
    const onDisk = typeScriptSourcesOnDisk();

    // Non-vacuity first. Every other assertion here is satisfied by a project
    // that resolves nothing, and "compiles nothing, exits 0" is exactly what
    // this gate exists to make impossible.
    expect(onDisk.length, 'no .ts sources found under e2e/ — the walk is broken').toBeGreaterThan(20);

    const inProject = programFiles();
    const uncovered = onDisk.filter((f) => !inProject.has(f));

    expect(
      uncovered,
      'These TypeScript files under e2e/ are not in tsconfig.e2e.json’s program, so nothing ' +
        'type-checks them:\n' +
        uncovered.map((f) => `  - ${f}`).join('\n') +
        '\n\nWiden the "include" glob in tsconfig.e2e.json. A spec under e2e/ that no tsc ' +
        'invocation reads is objectui#4471 all over again — and Playwright transpiles without ' +
        'checking, so the only thing that would ever report it is a red run in CI.',
    ).toEqual([]);
  });

  it('really does cover the specs and the live global-setup, by name', () => {
    // The forward assertion above is a set difference, which stays green if the
    // directory walk ever stops descending. Name a few outright — one per
    // sub-directory shape the glob has to reach.
    const inProject = programFiles();
    for (const file of [
      'e2e/smoke.spec.ts',
      'e2e/helpers/index.ts',
      'e2e/import-console/import-console-undo.spec.ts',
      'e2e/live/global-setup.ts',
      'e2e/live/master-detail.spec.ts',
    ]) {
      expect(inProject, `${file} must be type-checked by tsconfig.e2e.json`).toContain(file);
    }
  });

  /**
   * The premise behind the wiring below: this project needs no built workspace
   * declarations, so it can be a root task that runs without waiting for
   * `^build`. `tsconfig.vitest-setup.json` is the counterexample — its program
   * side-effect-imports four `@object-ui/*` packages, which is why its ci.yml
   * step has to sit after `pnpm type-check`. If a spec ever imports a workspace
   * package, this goes red and the wiring has to be reconsidered rather than
   * silently starting to depend on `dist`.
   */
  it('imports no workspace package, so it needs no build', () => {
    const workspaceImports = parsedProject()
      .fileNames.flatMap((f) => [
        ...fs.readFileSync(f, 'utf8').matchAll(/from\s+'(@object-ui\/[^']+)'/g),
      ])
      .map((m) => m[1]);

    expect(
      [...new Set(workspaceImports)],
      'tsconfig.e2e.json’s program now imports workspace packages, so it needs their built ' +
        'declaration files — but `//#type-check:e2e` is a root task with no `dependsOn`, so ' +
        'turbo does not build anything for it. Give the task `dependsOn: ["^build"]` (and check ' +
        'that a ROOT task can express what you need), or drop the import.',
    ).toEqual([]);
  });
});

describe('tsconfig.e2e.json — coverage of the root playwright configs (objectui#4477)', () => {
  it('resolves every root playwright*.config.ts on disk, with none left out', () => {
    const onDisk = rootPlaywrightConfigsOnDisk();

    // Non-vacuity first, for the same reason as the sweep above: the set
    // difference below is satisfied by a discovery that finds nothing. Four
    // configs exist today. If one is genuinely retired, lower this floor — but
    // never satisfy it by narrowing the pattern in `rootPlaywrightConfigsOnDisk`,
    // which would be this gate reporting green about files it stopped looking at.
    expect(
      onDisk.length,
      'no playwright*.config.ts found at the repo root — the discovery is broken',
    ).toBeGreaterThanOrEqual(4);

    const inProject = programFiles();
    const uncovered = onDisk.filter((f) => !inProject.has(f));

    expect(
      uncovered,
      'These root Playwright configs are not in tsconfig.e2e.json’s program, so nothing ' +
        'type-checks them:\n' +
        uncovered.map((f) => `  - ${f}`).join('\n') +
        '\n\nWiden the "include" globs in tsconfig.e2e.json. These files decide which specs ' +
        'run, where they run, and what `webServer` command builds the app under test — and ' +
        'Playwright transpiles a config rather than checking it, so a `defineConfig` option ' +
        'misspelled into `undefined` is read as intent and surfaces only as a confusing ' +
        'runtime failure in the e2e job (objectui#4477).',
    ).toEqual([]);
  });

  it('would resolve a FIFTH root config that nobody has written yet', () => {
    // The assertion above is a set difference over what exists. It would stay
    // green under an `include` that names today's four files outright, and then
    // the next config to land would sit outside every program again — the exact
    // shape of objectui#4471 and objectui#4477. So ask the real config about a
    // name it cannot have been written against.
    const resolved = programFilesWithSyntheticRootConfig('playwright.not-yet-written.config.ts');

    expect(
      [...resolved].sort(),
      'tsconfig.e2e.json no longer picks up a NEW root playwright config. Its second ' +
        '"include" entry must stay a glob (`playwright*.config.ts`); an enumeration of the ' +
        'configs that exist today passes every other assertion in this file and still lets ' +
        'the next one land in no tsc program at all.',
    ).toContain('playwright.not-yet-written.config.ts');

    // …and that the throwaway tree really was parsed like the real project,
    // rather than the assertion above passing on an empty or defaulted program.
    expect(
      [...resolved].sort(),
      'the throwaway tree did not resolve like the real project — the probe is broken, ' +
        'not the config',
    ).toContain('e2e/placeholder.spec.ts');
  });
});

describe('the gate is actually wired up (objectui#4471)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const turbo = JSON.parse(fs.readFileSync(path.join(repoRoot, 'turbo.json'), 'utf8')) as {
    tasks: Record<string, { cache?: boolean; dependsOn?: string[]; inputs?: string[] }>;
  };

  it('is runnable locally, by name', () => {
    // A gate nobody can reproduce locally is a gate people learn to ignore.
    expect(pkg.scripts?.[SCRIPT_NAME], `package.json must define "${SCRIPT_NAME}"`).toBeDefined();
    expect(pkg.scripts?.[SCRIPT_NAME]).toContain('tsconfig.e2e.json');
  });

  it('is a turbo root task, which is what makes `pnpm type-check` reach e2e/', () => {
    // Turbo resolves `//#x` to the ROOT package.json's `x` script. Declaring the
    // task without the script (or renaming the script out from under it) is a
    // hard turbo error rather than a silent skip, but pin the pairing anyway:
    // it is the whole reason the script above is not dead weight.
    expect(
      turbo.tasks[TURBO_TASK],
      `turbo.json must declare the root task \`${TURBO_TASK}\`. Without it, ` +
        `\`pnpm type-check\` (turbo run type-check) never reaches e2e/ and this config is ` +
        'CI-invisible unless someone adds a workflow step — which is the shape objectui#4456 ' +
        'moved away from.',
    ).toBeDefined();
    expect(
      pkg.scripts?.[SCRIPT_NAME],
      `\`${TURBO_TASK}\` resolves to the root package.json script "${SCRIPT_NAME}"`,
    ).toBeDefined();
  });

  it('runs as part of `pnpm type-check`', () => {
    expect(
      turbo.tasks['type-check']?.dependsOn ?? [],
      `turbo.json's \`type-check\` task must \`dependsOn\` \`${TURBO_TASK}\`. That dependency is ` +
        'the entire wiring: ci.yml’s existing `Run type-check` step gains e2e/ coverage with ' +
        'no new workflow entry, exactly as `lint` gained `//#lint:root` in objectui#4456.',
    ).toContain(TURBO_TASK);
  });

  /**
   * objectui#12222. Turbo folds a dependency's hash into its dependent's, and
   * every package's `type-check` depends on this task — so this task's hash is
   * part of EVERY package's type-check hash. With no `inputs`, a root task
   * hashes every tracked file in the repository (turbo's default for the root
   * package), so any commit anywhere moved all of those hashes and the restored
   * `.turbo/cache` replayed nothing: `Type Check` re-ran every package on every
   * pull request and queue build. Measured on that card, before the fix: one
   * untracked file under `docs/` moved every `type-check` hash and no `build`
   * hash.
   *
   * The task stays uncached (below), so its `inputs` decide nothing but that
   * hash. They name its own program — what `tsconfig.e2e.json` includes, and
   * the config itself — so the hash moves when the e2e program does and not
   * when anything else in the repository does. Turbo adds the root
   * `package.json` and `turbo.json` on its own.
   */
  it('hashes its own program, not the whole repository, because every type-check inherits its hash', () => {
    const inputs = turbo.tasks[TURBO_TASK]?.inputs ?? [];
    expect(
      inputs,
      `\`${TURBO_TASK}\` declares no \`inputs\`, so turbo hashes every tracked file in the ` +
        'repository for it — and every package’s `type-check` inherits that hash through ' +
        '`dependsOn`, so no commit can ever replay a cached type-check (objectui#12222).',
    ).not.toHaveLength(0);
    expect(inputs, '`$TURBO_DEFAULT$` on a root task is the whole repository again').not.toContain(
      '$TURBO_DEFAULT$',
    );

    const matchers = inputs.map((glob) => globToRegExp(glob));
    const program = [...programFiles(), 'tsconfig.e2e.json'];
    const unhashed = program.filter((file) => !matchers.some((re) => re.test(file)));
    expect(
      unhashed,
      `files of the e2e program that \`${TURBO_TASK}\`'s inputs do not name — its hash would not ` +
        'move when they change:\n' +
        unhashed.map((f) => `  - ${f}`).join('\n'),
    ).toEqual([]);

    const ownProgram = /^(?:e2e\/|playwright[^/]*\.config\.ts$|tsconfig\.e2e\.json$)/;
    const beyond = [...repoFilesOnDisk()].filter(
      (file) => matchers.some((re) => re.test(file)) && !ownProgram.test(file),
    );
    expect(
      beyond,
      `\`${TURBO_TASK}\`'s inputs reach files outside its own program, and each one moves every ` +
        'package’s type-check hash when it changes:\n' +
        beyond.map((f) => `  - ${f}`).join('\n'),
    ).toEqual([]);
  });

  /**
   * The partition rule from `turbo-task-guard-coverage.test.ts`, restated where
   * it bites. That file requires every CACHEABLE task to have a
   * `turbo-<task>-inputs.test.ts` deriving its out-of-package reads — and for a
   * `//#`-prefixed task the derived name is not even a legal path, so a cached
   * root task cannot satisfy the family at all. The substantive reason is the
   * same one: tsc's real read set is the import closure (`@playwright/test`'s
   * declarations, `@types/node`), and the sibling guards deliberately narrow to
   * config root files. A cached verdict over that is replayable in a way nobody
   * derives, which is objectui#3514 with a type gate attached.
   */
  it('is uncached, the side of the guard-coverage partition it belongs on', () => {
    expect(
      turbo.tasks[TURBO_TASK]?.cache,
      `\`${TURBO_TASK}\` must stay "cache": false. If it becomes cacheable, ` +
        'turbo-task-guard-coverage.test.ts starts demanding a derived-inputs guard for it — and ' +
        'the name that guard would have to carry (turbo-//#type-check:e2e-inputs.test.ts) is not ' +
        'a path. It costs a few seconds; leave it uncached.',
    ).toBe(false);
  });
});
