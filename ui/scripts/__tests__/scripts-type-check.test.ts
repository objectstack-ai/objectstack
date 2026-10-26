import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * objectui#3494 — the pin tests in this directory had no type gate of their own.
 *
 * `scripts/` is not a workspace package. `pnpm type-check` is `turbo run
 * type-check`, which walks package.json `scripts`, so it structurally cannot
 * reach a directory that has no package.json; and
 * `scripts/check-type-check-coverage.mjs` decides coverage per PACKAGE, so it
 * could not see the gap either. Meanwhile the root `tsconfig.json` includes only
 * `packages`/`examples`/`apps`, and `tsconfig.tier-base.json` excludes the test globs
 * outright. Net: every file in `scripts/__tests__/` — ten tests that pin
 * `ci.yml`, `docs-links.yml`, `lint.yml`, the changeset guard, the control-byte
 * scanner and the shadcn local patches — was compiled by nothing at all.
 *
 * That is objectui#3009's shape one directory over, and it is the worse half of
 * it: a pin test is written precisely so that a LATER change goes red. One that
 * the compiler never reads can assert a contract that no longer type-checks and
 * still print green, and it reads to the next agent as evidence the contract
 * holds. objectui#3181 measured that directly — a provably-false
 * `Assert< Equal< 1, 2 > >` appended to an unchecked test file passed
 * `pnpm type-check` at exit 0.
 *
 * `tsconfig.scripts.json` closes it. This file is what stops it reopening, and
 * it deliberately asserts BEHAVIOUR (which files the project actually resolves,
 * whether CI actually runs it) rather than the config's spelling — a test that
 * only checked the spelling would be satisfied by a config that compiles
 * nothing, which is the failure mode it exists to prevent.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const configPath = path.join(repoRoot, 'tsconfig.scripts.json');
const consoleNodeConfigPath = path.join(repoRoot, 'apps/console/tsconfig.node.json');
const scriptsDir = path.join(repoRoot, 'scripts');
const ciWorkflowPath = path.join(repoRoot, '.github/workflows/ci.yml');

/** The root script CI invokes, and the one a contributor can run locally. */
const SCRIPT_NAME = 'type-check:scripts';

/**
 * The project as TypeScript itself resolves it: the same parse `tsc -p` does,
 * so `fileNames` is the real program root set rather than a re-implementation
 * of TypeScript's glob semantics.
 */
function parsedProject(): ts.ParsedCommandLine {
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  expect(
    read.error && ts.flattenDiagnosticMessageText(read.error.messageText, ' '),
    'tsconfig.scripts.json must parse as JSON with comments',
  ).toBeFalsy();

  return ts.parseJsonConfigFileContent(read.config, ts.sys, repoRoot, undefined, configPath);
}

/**
 * `apps/console/tsconfig.node.json`, parsed the same way — the other program
 * that compiles `scripts/vite-crypto-stub.ts` and
 * `scripts/vite-maplibre-worker.ts` (see this file's header). Used only to
 * read its `compilerOptions`; its own `include`/`fileNames` are irrelevant
 * here.
 */
function parsedConsoleNodeProject(): ts.ParsedCommandLine {
  const read = ts.readConfigFile(consoleNodeConfigPath, ts.sys.readFile);
  expect(
    read.error && ts.flattenDiagnosticMessageText(read.error.messageText, ' '),
    'apps/console/tsconfig.node.json must parse as JSON with comments',
  ).toBeFalsy();

  return ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    path.dirname(consoleNodeConfigPath),
    undefined,
    consoleNodeConfigPath,
  );
}

/**
 * Every `@object-ui/*` module specifier a source file actually imports or
 * re-exports, read from the AST rather than grepped from the file's text
 * (objectui#4902). A textual `from\s+'...'` match cannot tell a real import
 * edge apart from the same shape sitting inside a line comment, a block
 * comment, or a JSDoc `@example` — this repo has hit that exact false
 * positive (a comment explaining "there is no such import" was read as one
 * by a sibling text-level gate). Walking
 * `ImportDeclaration`/`ExportDeclaration`/`ImportEqualsDeclaration` nodes
 * instead makes the check ask "is this a module edge" rather than "does this
 * text look like one". The regex matched any `from '…'` token sequence, so
 * it already caught `import type { … }` and `export { … } from '…'`
 * incidentally, along with static imports — it did not understand statement
 * kinds, only that shape. What it missed entirely was
 * `import core = require('…')` (`ImportEqualsDeclaration`), which has no
 * `from` token at all; this walk covers that form deliberately instead.
 *
 * Sibling suites in this directory explain their own fixture spellings by
 * pointing HERE rather than restating what this matcher does. Keep it that way:
 * objectui#6996 swept the directory and found six of them describing this
 * matcher in their own words, every one of them still describing the TEXT match
 * this walk replaced. One account can be corrected; six drift apart.
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

/** Every TypeScript source on disk under `scripts/`, repo-relative, POSIX-separated. */
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
  walk(scriptsDir);
  return out.sort();
}

describe('tsconfig.scripts.json — the project itself (objectui#3494)', () => {
  /**
   * A tsconfig that fails to parse does not fail loudly: TypeScript falls back
   * to defaults, and with no `include` surviving, `tsc -p` cheerfully compiles
   * the ENTIRE repository — reporting errors from `apps/`, which reads as "this
   * config is broken" rather than "this config is unparseable".
   *
   * Not hypothetical. The first draft of the config explained itself in block
   * comments, and the glob it was explaining contains a double star immediately
   * followed by a slash — which terminates a block comment. The file silently
   * became garbage and `tsc -p` reported errors from `apps/`. Hence the config's
   * `//` line comments, and hence this test.
   */
  it('parses with no diagnostics at all', () => {
    const parsed = parsedProject();
    const messages = parsed.errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
    expect(messages, 'tsconfig.scripts.json emitted config diagnostics').toEqual([]);
  });

  it('is a checking project, not an emitting one', () => {
    const { options } = parsedProject();

    // It must not emit: these are checks, and stray .js/.d.ts next to the
    // sources is a large part of why apps/console's node project went unwired
    // for so long (objectui#3305).
    expect(options.noEmit, 'tsconfig.scripts.json must set "noEmit": true').toBe(true);
    expect(options.strict, 'tsconfig.scripts.json must set "strict": true').toBe(true);

    // `noEmit` is only legal here because the project is standalone. If someone
    // makes it `composite` or gives it `references`, TS6310 fires and the two
    // assertions above become mutually unsatisfiable — fail on the cause, not
    // on the symptom.
    expect(options.composite, 'a composite project may not set "noEmit" (TS6310)').toBeFalsy();
    expect(parsedProject().projectReferences ?? [], 'this project must stay standalone').toEqual([]);
  });
});

describe('tsconfig.scripts.json — option parity with apps/console/tsconfig.node.json (objectui#4926)', () => {
  /**
   * `scripts/vite-crypto-stub.ts` and `scripts/vite-maplibre-worker.ts` are
   * compiled by BOTH this project and `apps/console/tsconfig.node.json` (see
   * this file's header, and that file's own header). This file's header
   * states the invariant that makes sharing them safe: the two projects'
   * option sets match on the axes that matter, "so a shared file cannot be
   * green in one project and red in the other."
   *
   * objectui#4926 found that invariant asserted but not enforced:
   * `allowImportingTsExtensions` diverged (present in the console project,
   * absent here) with nothing to catch it — the gap stayed latent only
   * because neither shared file happens to use a `.ts`-extension import
   * today. This test is what the issue says would have caught it: it reads
   * both parsed configs and asserts the specific options the header claims
   * are matched, rather than trusting the prose.
   *
   * Scope, deliberately narrow: only the options this file's header names as
   * matched (strict, module, moduleResolution, allowImportingTsExtensions,
   * and the absence of noImplicitReturns). The two projects differ on plenty
   * else by design (`composite`, `outDir`, `rootDir`, `allowJs`, `target`,
   * emit) — those are NOT part of the stated invariant, and asserting them
   * equal would just recreate the `extends` trap this file's header
   * explains at length why it avoids.
   */
  it('matches the option set apps/console/tsconfig.node.json compiles the shared files with', () => {
    const scripts = parsedProject().options;
    const consoleNode = parsedConsoleNodeProject().options;

    expect(scripts.strict, 'tsconfig.scripts.json').toBe(true);
    expect(consoleNode.strict, 'apps/console/tsconfig.node.json').toBe(true);

    expect(scripts.module, 'tsconfig.scripts.json "module"').toBe(consoleNode.module);
    expect(
      scripts.moduleResolution,
      'tsconfig.scripts.json "moduleResolution"',
    ).toBe(consoleNode.moduleResolution);

    // The option objectui#4926 was filed over: `apps/console/vite.config.ts`
    // imports `../../scripts/vite-crypto-stub.ts` and
    // `../../scripts/vite-maplibre-worker.ts` with explicit `.ts` extensions
    // (objectui#3384), which only `allowImportingTsExtensions` accepts.
    expect(
      consoleNode.allowImportingTsExtensions,
      'apps/console/tsconfig.node.json must still set "allowImportingTsExtensions" — if this ' +
        'assertion is what broke, the fix belongs in tsconfig.scripts.json below, not here.',
    ).toBe(true);
    expect(
      scripts.allowImportingTsExtensions,
      'tsconfig.scripts.json must set "allowImportingTsExtensions": true to match ' +
        'apps/console/tsconfig.node.json — otherwise a `.ts`-extension import in a file shared ' +
        'between the two programs (scripts/vite-crypto-stub.ts, scripts/vite-maplibre-worker.ts) ' +
        'type-checks in one and not the other (objectui#4926).',
    ).toBe(true);

    // Both projects deliberately leave `noImplicitReturns` off — see this
    // file's header. Asserted as an explicit falsy-equality, not just
    // "both truthy", so a future divergence in either direction is caught.
    expect(scripts.noImplicitReturns, 'tsconfig.scripts.json "noImplicitReturns"').toBeFalsy();
    expect(consoleNode.noImplicitReturns, 'apps/console/tsconfig.node.json "noImplicitReturns"').toBeFalsy();
  });
});

describe('tsconfig.scripts.json — coverage of scripts/ (objectui#3494)', () => {
  it('resolves every TypeScript source under scripts/, with none left out', () => {
    const onDisk = typeScriptSourcesOnDisk();

    // Non-vacuity first. Every other assertion here is satisfied by a project
    // that resolves nothing, and "compiles nothing, exits 0" is exactly what
    // this gate exists to make impossible.
    expect(onDisk.length, 'no .ts sources found under scripts/ — the walk is broken').toBeGreaterThan(5);

    const inProject = new Set(
      parsedProject().fileNames.map((f) => path.relative(repoRoot, f).split(path.sep).join('/')),
    );
    const uncovered = onDisk.filter((f) => !inProject.has(f));

    expect(
      uncovered,
      'These TypeScript files under scripts/ are not in tsconfig.scripts.json’s program, so ' +
        'nothing type-checks them:\n' +
        uncovered.map((f) => `  - ${f}`).join('\n') +
        '\n\nWiden the "include" glob in tsconfig.scripts.json. A .ts file under scripts/ that no ' +
        'tsc invocation reads is objectui#3494 all over again — and when it is a pin test, it is a ' +
        'test that can assert a broken contract and still print green (objectui#3181).',
    ).toEqual([]);
  });

  it('really does cover the gate pin tests, by name', () => {
    // The forward assertion above is a set difference, which stays green if the
    // directory walk ever stops finding `__tests__`. Name a few outright.
    const inProject = new Set(
      parsedProject().fileNames.map((f) => path.relative(repoRoot, f).split(path.sep).join('/')),
    );
    for (const file of [
      'scripts/__tests__/ci-cd-pipeline-doc.test.ts',
      'scripts/__tests__/docs-links-workflow.test.ts',
      'scripts/__tests__/lint-workflow.test.ts',
      'scripts/__tests__/scripts-type-check.test.ts',
    ]) {
      expect(inProject, `${file} must be type-checked by tsconfig.scripts.json`).toContain(file);
    }
  });
});

describe('the gate is actually wired up (objectui#3494)', () => {
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
    // `pnpm type-check` is `turbo run type-check` and cannot reach a directory
    // with no package.json, so without a named root script this project would
    // only ever run on a CI runner — and a gate nobody can reproduce locally is
    // a gate people learn to ignore.
    expect(pkg.scripts?.[SCRIPT_NAME], `package.json must define "${SCRIPT_NAME}"`).toBeDefined();
    expect(pkg.scripts?.[SCRIPT_NAME]).toContain('tsconfig.scripts.json');
  });

  it('runs in ci.yml’s type-check job', () => {
    expect(
      typeCheckJob(),
      `ci.yml’s type-check job must run \`pnpm ${SCRIPT_NAME}\`. Without it, tsconfig.scripts.json ` +
        'is a file that looks like a gate while no CI job reads it — the same shape as the ' +
        'unchecked tests it was added to fix.',
    ).toContain(`pnpm ${SCRIPT_NAME}`);
  });

  it('runs AFTER dependencies are installed', () => {
    // `tsc`, `@types/node` and the `vite` types the plugin sources import all
    // come from node_modules. Placed above the install step it would fail with
    // a resolution error that looks nothing like its real cause.
    const job = typeCheckJob();
    const install = job.indexOf('pnpm install --frozen-lockfile');
    const check = job.indexOf(`pnpm ${SCRIPT_NAME}`);

    expect(install, 'the type-check job must still install dependencies').toBeGreaterThan(-1);
    expect(check, 'the type-check job must run the scripts type-check').toBeGreaterThan(-1);
    expect(check, `\`pnpm ${SCRIPT_NAME}\` must come after \`pnpm install\``).toBeGreaterThan(install);
  });

  it('does not need a workspace build, so it can stay in the cheap half of the job', () => {
    // The claim behind its placement: none of the project's own sources import
    // an @object-ui/* package, so unlike `pnpm type-check` (which dependsOn
    // `^build`) it needs no built .d.ts files. If that stops being true the
    // step has to move below the build, so pin the premise.
    const workspaceImports = parsedProject().fileNames.flatMap((f) =>
      workspaceImportSpecifiers(f, fs.readFileSync(f, 'utf8')),
    );

    expect(
      [...new Set(workspaceImports)],
      'tsconfig.scripts.json’s program now imports a workspace package (found via the AST, not a ' +
        'comment or example), so it needs their built declaration files. Move the ci.yml step below ' +
        'the build, or drop the import.',
    ).toEqual([]);
  });
});

describe('workspaceImportSpecifiers() — the matcher behind the workspace-import check (objectui#4902)', () => {
  // Non-vacuity first: prove the walk can find a real import edge at all,
  // before trusting any test below that asserts it finds nothing. A matcher
  // that always returns [] would make every "not caught" case beneath it
  // pass for the wrong reason.
  it('finds a real static import', () => {
    expect(
      workspaceImportSpecifiers('probe.ts', "import { widget } from '@object-ui/core';\n"),
    ).toEqual(['@object-ui/core']);
  });

  it('finds a real `import type` import', () => {
    expect(
      workspaceImportSpecifiers('probe.ts', "import type { Widget } from '@object-ui/core';\n"),
    ).toEqual(['@object-ui/core']);
  });

  it('finds a real `export … from` re-export', () => {
    expect(
      workspaceImportSpecifiers('probe.ts', "export { widget } from '@object-ui/core';\n"),
    ).toEqual(['@object-ui/core']);
  });

  // The direction this file's fix is for: the same specifier text, but never
  // reachable by the compiler, must not be reported.
  it('does not find the specifier inside a line comment (objectui#4902)', () => {
    expect(
      workspaceImportSpecifiers(
        'probe.ts',
        "// rewrite of this gate breaks on a documented `import … from '@object-ui/core'`\n",
      ),
    ).toEqual([]);
  });

  it('does not find the specifier inside a block comment (objectui#4902)', () => {
    expect(
      workspaceImportSpecifiers(
        'probe.ts',
        "/**\n * @example\n * import { widget } from '@object-ui/core';\n */\n",
      ),
    ).toEqual([]);
  });

  it('does not find the specifier inside a string that is not a module specifier', () => {
    expect(
      workspaceImportSpecifiers('probe.ts', "const doc = \"see '@object-ui/core' for details\";\n"),
    ).toEqual([]);
  });
});
