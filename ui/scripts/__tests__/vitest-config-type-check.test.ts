import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * objectui#7328 — the repo-root `vitest.config.mts` had no RUNNABLE gate.
 *
 * Not "no program": `apps/console/tsconfig.node.json` has listed
 * `../../vitest.config.mts` and `vitest.config.ts` since objectui#3476, and that
 * program is exactly the compiler that catches drift in the one file which
 * merges two config objects. What was missing was a way to RUN it. The only
 * invocation was the console's own `type-check` script — `tsc --noEmit && tsc -b
 * tsconfig.node.json --force` — reached through `turbo run type-check`, whose
 * task `dependsOn: ["^build"]`. So the cheapest compiler in the repo that reads
 * the root Vitest config was reachable only behind a full workspace build, and
 * every local gate union short of that was structurally unable to go red on it.
 *
 * PR #7291 is the measured cost: a conditionally spread `dist` project whose
 * literal `extends: true` widened to `boolean` degraded the whole `projects`
 * array to `never[]`; `type-check:scripts`, `type-check:vitest-setup` and the
 * vitest runs were all green, and CI answered with three errors, two of them
 * reported at `../../vitest.config.mts`.
 *
 * `type-check:vitest-config` closes it by giving that program its own runner.
 * This file is what stops it reopening, and like its siblings
 * `scripts-type-check.test.ts` and `vitest-setup-type-check.test.ts` it asserts
 * BEHAVIOUR — which files the project really resolves, whether CI really runs
 * it, and where — rather than the spelling of any config. A test that only read
 * spellings would be satisfied by an `include` entry matching nothing, which is
 * the objectui#3476 failure one door over: a literal, glob-less `include` entry
 * that matches no file is silently ignored by TypeScript and reads as coverage
 * that was never there.
 *
 * ⚠️ The `.mts` trap this card was triaged against belongs here too. Neither
 * root program's globs admit the extension — `tsconfig.scripts.json` includes
 * `scripts/**\/*.ts` and `tsconfig.vitest-setup.json` `./vitest.setup*.ts(x)` —
 * so "add an include entry" was never the fix, and the assertion below asks
 * TypeScript whether the `.mts` file is in the resolved program rather than
 * whether some string names it.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const configPath = path.join(repoRoot, 'apps/console/tsconfig.node.json');
const ciWorkflowPath = path.join(repoRoot, '.github/workflows/ci.yml');

/** The root script CI invokes, and the one a contributor can run locally. */
const SCRIPT_NAME = 'type-check:vitest-config';

/**
 * The project as TypeScript itself resolves it — the same parse `tsc` does, so
 * `fileNames` is the real program root set rather than a re-implementation of
 * TypeScript's `include`/`exclude` semantics.
 */
function parsedProject(): ts.ParsedCommandLine {
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  expect(
    read.error && ts.flattenDiagnosticMessageText(read.error.messageText, ' '),
    'apps/console/tsconfig.node.json must parse as JSON with comments',
  ).toBeFalsy();

  return ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath), undefined, configPath);
}

/** The program's root set, repo-relative and POSIX-separated. */
function programFiles(): Set<string> {
  return new Set(
    parsedProject().fileNames.map((f) => path.relative(repoRoot, f).split(path.sep).join('/')),
  );
}

/** Every `vitest.config.*` source sitting at the repo root, repo-relative. */
function rootVitestConfigsOnDisk(): string[] {
  return fs
    .readdirSync(repoRoot, { withFileTypes: true })
    .filter((e) => e.isFile() && /^vitest\.config\.[cm]?tsx?$/.test(e.name))
    .map((e) => e.name)
    .sort();
}

/**
 * Every `@object-ui/*` module specifier a source file actually imports or
 * re-exports, read from the AST. The reasoning behind walking nodes instead of
 * matching `from '…'` text — and the false positives that motivated it — is
 * written once, in `scripts-type-check.test.ts` (objectui#4902); objectui#6996
 * swept this directory for suites that had restated it in their own words and
 * found six describing a matcher that no longer existed, so this one points
 * there rather than adding a seventh account.
 */
function workspaceImportSpecifiers(fileName: string, sourceText: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, false);
  const specifiers: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      specifiers.push(node.moduleReference.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return specifiers.filter((specifier) => specifier.startsWith('@object-ui/'));
}

describe('the root Vitest config is inside a resolvable program (objectui#7328)', () => {
  it('parses with no diagnostics at all', () => {
    // A tsconfig that fails to parse does not fail loudly: TypeScript falls back
    // to defaults, and a project that then compiles the wrong file set still
    // exits 0. `tsconfig.scripts.json` hit exactly that while being written.
    const messages = parsedProject().errors.map((d) =>
      ts.flattenDiagnosticMessageText(d.messageText, ' '),
    );
    expect(messages, 'apps/console/tsconfig.node.json emitted config diagnostics').toEqual([]);
  });

  it('resolves every root vitest.config.* source, with none left out', () => {
    const onDisk = rootVitestConfigsOnDisk();

    // Non-vacuity first. Every assertion below is satisfied by a project that
    // resolves nothing, and "compiles nothing, exits 0" is the exact shape this
    // gate exists to make impossible.
    expect(
      onDisk,
      'no vitest.config.* source found at the repo root — the scan is broken, or the root config ' +
        'was renamed and this gate is now measuring nothing',
    ).toContain('vitest.config.mts');

    const inProject = programFiles();
    const uncovered = onDisk.filter((f) => !inProject.has(f));

    expect(
      uncovered,
      'These repo-root Vitest configs are in no runnable tsc program:\n' +
        uncovered.map((f) => `  - ${f}`).join('\n') +
        '\n\nAdd each one to apps/console/tsconfig.node.json’s "include". ⚠️ Adding it to ' +
        'tsconfig.scripts.json or tsconfig.vitest-setup.json instead does NOT work: their globs ' +
        'are `scripts/**/*.ts` and `./vitest.setup*.ts(x)`, and neither admits `.mts` ' +
        '(objectui#7328). A root Vitest config no tsc invocation reads is PR #7291 again — the ' +
        'author’s whole local gate union green, three errors on CI.',
    ).toEqual([]);
  });

  it('covers the merging consumer too, not just the root config', () => {
    // `apps/console/vitest.config.ts` is where the #7291 damage actually
    // surfaced (`Argument of type 'UserConfig & …' is not assignable to
    // parameter of type 'never'`): the root config degraded, and the merge line
    // was the call that could not type. Covering the producer without the
    // consumer would have caught two of those three errors and missed the one a
    // reader would start from.
    const inProject = programFiles();
    for (const file of ['vitest.config.mts', 'apps/console/vitest.config.ts']) {
      expect(inProject, `${file} must be type-checked by apps/console/tsconfig.node.json`).toContain(
        file,
      );
    }
  });

  it('leaves allowJs off, so the root config’s @ts-expect-error stays live', () => {
    // `vitest.config.mts` suppresses the untyped `./scripts/vitest-invocation-guard.mjs`
    // import with a `@ts-expect-error` whose own comment names `allowJs: false`.
    // Turning `allowJs` on here makes that directive unused and therefore an
    // error of its own (TS2578) — the interaction `apps/console/tsconfig.node.json`
    // documents and `tsconfig.scripts.json` deliberately paid for on its own
    // file set. Pin it so it has to be a decision rather than an accident.
    expect(
      parsedProject().options.allowJs,
      'apps/console/tsconfig.node.json must not enable allowJs — vitest.config.mts’s ' +
        '@ts-expect-error over the plain-JS invocation guard would become TS2578',
    ).toBeFalsy();
  });
});

describe('the gate is actually wired up (objectui#7328)', () => {
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
    // A gate nobody can reproduce locally is a gate people learn to ignore —
    // and "run the console's type-check before touching this file" was already
    // written down as a lane convention when #7291 happened. The convention was
    // not the missing part; a command was.
    const script = pkg.scripts?.[SCRIPT_NAME];
    expect(script, `package.json must define "${SCRIPT_NAME}"`).toBeDefined();
    expect(script).toContain('apps/console/tsconfig.node.json');
  });

  it('invokes the compiler directly, not through turbo', () => {
    // The whole point is to skip `turbo run type-check`'s `^build`. Routing this
    // script through turbo would restore the cost this card exists to remove
    // while still reading like a cheap gate.
    expect(
      pkg.scripts?.[SCRIPT_NAME],
      `"${SCRIPT_NAME}" must call tsc directly; going through turbo re-imposes the \`^build\` ` +
        'that made the root Vitest config expensive to check in the first place',
    ).not.toContain('turbo');
  });

  it('runs in ci.yml’s type-check job', () => {
    expect(
      typeCheckJob(),
      `ci.yml’s type-check job must run \`pnpm ${SCRIPT_NAME}\`. Without it the script is a ` +
        'command nobody runs, and the root Vitest config is back to being covered only when the ' +
        'console’s own type-check happens to run.',
    ).toContain(`pnpm ${SCRIPT_NAME}`);
  });

  it('runs after the install and BEFORE the build, in the cheap half of the job', () => {
    const job = typeCheckJob();
    const install = job.indexOf('pnpm install --frozen-lockfile');
    const check = job.indexOf(`pnpm ${SCRIPT_NAME}`);
    // A line that IS the bare command, as `run:`'s value or inside a `run: |`
    // block -- objectui#12222 put the two speeds' branches in that step.
    const build = job.search(/^\s+(?:run: )?pnpm type-check$/m);

    expect(install, 'the type-check job must still install dependencies').toBeGreaterThan(-1);
    expect(build, 'the type-check job must still run `pnpm type-check`').toBeGreaterThan(-1);
    expect(check, `the type-check job must run \`pnpm ${SCRIPT_NAME}\``).toBeGreaterThan(-1);

    expect(check, `\`pnpm ${SCRIPT_NAME}\` needs tsc and the vite types from node_modules`).toBeGreaterThan(
      install,
    );
    expect(
      check,
      `\`pnpm ${SCRIPT_NAME}\` must come BEFORE \`pnpm type-check\`. Its value is that it fails ` +
        'without a workspace build; placed after the build it costs the same as the console ' +
        'type-check it replaces and answers the same question later.',
    ).toBeLessThan(build);
  });

  it('still has a real reason to run before the build', () => {
    // The premise behind the placement: nothing in this project's program
    // imports an @object-ui/* package, so it needs no built declarations. The
    // 40 `@object-ui/*` occurrences in `apps/console/vite.config.ts` are alias
    // MAP VALUES — strings handed to Vite — which is exactly why this is asked
    // of the AST and not of the file text. If a real import edge ever appears,
    // this step has to move below `pnpm type-check` like the vitest-setup one.
    const workspaceImports = parsedProject().fileNames.flatMap((f) =>
      workspaceImportSpecifiers(f, fs.readFileSync(f, 'utf8')),
    );

    expect(
      [...new Set(workspaceImports)],
      'apps/console/tsconfig.node.json’s program now imports a workspace package (found via the ' +
        'AST, not a comment or an alias string), so it needs built declaration files. Move the ' +
        'ci.yml step below `pnpm type-check`, or drop the import.',
    ).toEqual([]);
  });

  it('does not displace the console’s own type-check', () => {
    // This gate is a second RUNNER for one program, not a replacement for the
    // console's job. If the console ever stopped running the project, a change
    // to `apps/console/tsconfig.node.json`'s option set would move this gate's
    // verdict with nothing else watching.
    const consolePkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'apps/console/package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };

    expect(
      consolePkg.scripts?.['type-check'],
      '@object-ui/console must still run tsconfig.node.json itself — this root script is an ' +
        'additional, cheaper runner for that program, not its owner',
    ).toContain('tsconfig.node.json');
  });
});
