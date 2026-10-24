import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * objectui#4925 — `apps/console/vite.config.ts`'s hand-written `@object-ui/*`
 * alias table must cover everything the console transitively imports.
 *
 * ## Why this property earns a gate
 *
 * The table maps each `@object-ui/*` specifier at the package's `src/`, so the
 * dev server and the production build resolve workspace code from source rather
 * than from a stale `dist/` (the `vite.config.ts` header explains what a
 * duplicated `ComponentRegistry` singleton costs). What the list has to track is
 * "what does the console transitively import", and that set moves whenever ANY
 * platform package adds one cross-package import — a change that need not touch
 * `apps/console` at all, and that no reviewer of that change has reason to
 * connect to this file.
 *
 * objectui#3890 is the same property failing on another consumer, and it is the
 * reason this is not a tidiness check: the missing aliases did not fail a build,
 * a type-check, a lint or a test. The symptom was whole pages 500-ing in the dev
 * server, discovered by driving the app, with every static check green. That is
 * the failure signature this file exists to convert into a red test.
 *
 * The card measured this table COMPLETE (34 entries / 34 closure / 0 missing) on
 * `5ffcc1432`, and it was re-derived complete again on this branch's base
 * `2c8474c04` before the test was written — so this lands green, pinning a
 * property that currently holds rather than fixing a live defect.
 *
 * ## Why the table stays hand-written (objectui#4925 ruling: option 2)
 *
 * PR #4922 landed `packages/cli/src/utils/workspace-vite.ts`, a table DERIVED
 * from `pnpm-workspace.yaml`, and the obvious-looking move is to have the
 * console call it. That was rejected, on a technical ground rather than a
 * preference: `scripts/__tests__/side-effects-declaration-consistency.test.ts`
 * finds alias tables by parsing `vite.config.*` for the LITERAL SHAPE
 * `'@object-ui/x': path.resolve(...)`. Deriving this table would make it
 * textually disappear, silently shrinking that gate's scan surface — a second,
 * unrelated gate broken in a way that STAYS GREEN. That is precisely the failure
 * class this card is about, one file over. So the table stays literal, and this
 * test reconciles it instead.
 *
 * ## The two directions, and why they are different defects
 *
 * MISSING (in the closure, not in the table) is the #3890 defect: something the
 * console imports resolves through `node_modules`/`dist` instead of source.
 * Hard red.
 *
 * STALE (in the table, not in the closure) is the objectui#3944 defect one
 * table over: an entry nothing resolves through, which reads to every reader as
 * if the package were wired up. That file's header states the repo's position on
 * it — "a dead entry is worse than a missing one, because it reads as
 * connected" — so this direction is a red too, with a shrink-only ratchet that
 * is EMPTY today and may not grow. It is deliberately a SEPARATE case with its
 * own message: the two findings call for opposite fixes (add an alias vs. delete
 * one), and collapsing them into one assertion would report each as the other.
 *
 * ## The trap in "reconcile against pnpm-workspace.yaml"
 *
 * `pnpm-workspace.yaml` lists EVERY workspace package (46 at the time of
 * writing); the console's closure is 34 of them. A naive `table == workspace`
 * assertion therefore reds on day one over packages the console legitimately
 * does not import — `@object-ui/cli`, `@object-ui/plugin-ai`,
 * `@object-ui/runner`, `@object-ui/test-support`, the examples. The workspace
 * manifest's role here is to say what a workspace package IS, not what the
 * console needs; the closure says what it needs. `does not demand an alias for a
 * workspace package the console never imports` below is a standing negative
 * control that keeps that mistake from being introduced later.
 *
 * ## Non-vacuity
 *
 * A reconciliation between two derived sets fails silently by deriving an empty
 * set — the config is reformatted and the table parses as `[]`, or the walk
 * stops matching and the closure is `{}` — after which "nothing missing" is
 * true and means nothing. Every population below has a floor, the key census
 * proves no table entry dodges the comparison, and both counts are printed in
 * the failure messages so a future reader sees the population that produced the
 * verdict.
 *
 * ## Reverse verification (predicted before running, both confirmed)
 *
 * Baseline on `2c8474c04`, unmutated: 8 passed. Population as the messages print
 * it — 35 alias entries (34 packages), closure 34 packages from 28 direct
 * imports, 93 console + 1322 package source files scanned, 46 workspace
 * packages. So `in closure, NOT in table` = 0, matching the card's measurement
 * on `5ffcc1432` six days earlier.
 *
 *  - POSITIVE control — delete `'@object-ui/plugin-map'` from the table.
 *    Predicted: `every package in the console import closure has an alias entry`
 *    reds naming it; every other case stays green (34 entries is still above the
 *    floor, and a deletion cannot create a stale entry). Observed exactly that —
 *    1 failed, 7 passed, the finding reading `@object-ui/plugin-map (reached via
 *    apps/console/src/register-plugins.ts imports '@object-ui/plugin-map')`.
 *  - NEGATIVE control — `@object-ui/plugin-ai` is a `packages/*` workspace
 *    package with no alias entry and no place in the closure. UNMUTATED this
 *    file is green, which is the control: the table is not being held to the
 *    workspace manifest. It is also asserted by name below, and probed the other
 *    way by ADDING an alias entry for it. Predicted TWO reds for that probe, not
 *    one — the stale case, plus the named clause of the negative control itself,
 *    which says in so many words that plugin-ai is not aliased. Observed exactly
 *    that: 2 failed, 6 passed, the stale finding reading `['@object-ui/plugin-ai']`.
 *
 * Mutations were confirmed on disk by anchored grep counts, not by an editor's
 * exit code, and reverted with `git checkout HEAD -- apps/console/vite.config.ts`
 * to an empty `git diff HEAD`.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONSOLE_CONFIG = path.join(repoRoot, 'apps/console/vite.config.ts');
const CONSOLE_SRC = path.join(repoRoot, 'apps/console/src');
const WORKSPACE_MANIFEST = path.join(repoRoot, 'pnpm-workspace.yaml');

/** The scope this table is about. Nothing else in it is reconciled here. */
const SCOPE = '@object-ui/';

/**
 * `@object-ui/types/zod` is an alias ENTRY but not a PACKAGE — it exists so the
 * subpath is matched before the bare package (Vite string aliases match by
 * prefix; see the note in `vite.config.ts`). Reconciliation is therefore at
 * PACKAGE granularity: both the table and the closure are folded to package
 * names before they are compared, or that entry reads as permanently stale and
 * every deep import in the closure reads as permanently missing.
 */
function packageOf(specifier: string): string | undefined {
  const match = /^(@object-ui\/[^/]+)/.exec(specifier);
  return match ? match[1] : undefined;
}

/* -------------------------------------------------------------------------- */
/* 1. The workspace manifest — what a workspace package IS.                    */
/* -------------------------------------------------------------------------- */

/**
 * `pnpm-workspace.yaml`'s `packages:` globs, expanded to `name -> dir`.
 *
 * Parsed as text rather than with a YAML dependency: this is a flat list of
 * scalars under one key, and the gates in this directory read their inputs as
 * text by convention (see `vitest-config-alias-targets-3944.test.ts`).
 */
function workspacePackages(): Map<string, string> {
  const source = fs.readFileSync(WORKSPACE_MANIFEST, 'utf8');
  const globs: string[] = [];
  let inPackages = false;

  for (const line of source.split('\n')) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const item = /^\s+-\s*['"]?([^'"#]+?)['"]?\s*$/.exec(line);
    if (item) {
      globs.push(item[1]);
      continue;
    }
    if (/^\S/.test(line)) inPackages = false;
  }

  if (globs.length === 0) {
    throw new Error('pnpm-workspace.yaml: no `packages:` entries parsed — the manifest shape changed');
  }

  const dirs: string[] = [];
  for (const glob of globs) {
    // Only the two forms the manifest actually uses: `<dir>/*` and a literal
    // directory. An unrecognised form throws rather than being skipped, so a
    // future `packages/**` cannot silently shrink this set.
    if (glob.endsWith('/*')) {
      const base = path.join(repoRoot, glob.slice(0, -2));
      if (!fs.existsSync(base)) continue;
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (entry.isDirectory()) dirs.push(path.join(base, entry.name));
      }
    } else if (!glob.includes('*')) {
      dirs.push(path.join(repoRoot, glob));
    } else {
      throw new Error(`pnpm-workspace.yaml: unsupported glob '${glob}' — teach this test how to expand it`);
    }
  }

  const packages = new Map<string, string>();
  for (const dir of dirs) {
    const manifest = path.join(dir, 'package.json');
    if (!fs.existsSync(manifest)) continue;
    const name: unknown = (JSON.parse(fs.readFileSync(manifest, 'utf8')) as { name?: unknown }).name;
    if (typeof name === 'string' && name.length > 0) packages.set(name, dir);
  }
  return packages;
}

const WORKSPACE = workspacePackages();

/* -------------------------------------------------------------------------- */
/* 2. The alias table — read from the source TEXT.                             */
/* -------------------------------------------------------------------------- */

/**
 * Read as text, never by importing the config: `apps/console/vite.config.ts`
 * pulls in the whole Vite plugin surface and runs module-scope work. The same
 * reason `vitest-config-alias-targets-3944.test.ts` gives for its table.
 */
const configSource = fs.readFileSync(CONSOLE_CONFIG, 'utf8');

/** Brace-balanced from the opening `{`, so a nested object cannot truncate it. */
function balancedObjectLiteral(source: string, header: RegExp, what: string): string {
  const match = header.exec(source);
  if (!match) throw new Error(`${what}: object literal not found`);

  const open = match.index + match[0].length - 1;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`${what}: object literal is never closed`);
}

/** Whole comment lines dropped so they cannot be miscounted as entries. */
function withoutCommentLines(source: string): string {
  return source
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line) && !/^\s*\/\*.*\*\/\s*$/.test(line))
    .join('\n');
}

const aliasBlock = withoutCommentLines(
  balancedObjectLiteral(
    configSource,
    /const workspaceAliases[^=]*=\s*\{/,
    'apps/console/vite.config.ts: workspaceAliases'
  )
);

/**
 * The literal shape the table is REQUIRED to keep — the same shape
 * `side-effects-declaration-consistency.test.ts` scans for, which is the whole
 * reason objectui#4925 chose to keep the table hand-written.
 */
const ENTRY = /(['"])([^'"]+)\1\s*:\s*path\.resolve\(/g;

const aliasSpecifiers = [...aliasBlock.matchAll(ENTRY)].map((m) => m[2]);
const aliasPackages = new Set(
  aliasSpecifiers.map(packageOf).filter((name): name is string => name !== undefined)
);

/* -------------------------------------------------------------------------- */
/* 3. The import closure — what the console actually pulls in.                 */
/* -------------------------------------------------------------------------- */

const SOURCE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/**
 * Every source file under a directory, skipping the trees a bundle never
 * contains: `node_modules`, build output, and tests. A test's imports are not
 * the console's imports, and counting them would demand aliases for packages
 * only ever used by a fixture.
 */
function listSourceFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'build', '__tests__', '__mocks__'].includes(entry.name)) continue;
      listSourceFiles(abs, out);
    } else if (
      SOURCE_FILE.test(entry.name) &&
      !/\.d\.ts$/.test(entry.name) &&
      !/\.(test|spec)\./.test(entry.name)
    ) {
      out.push(abs);
    }
  }
  return out;
}

/**
 * The module specifiers a file imports FOR VALUE — parsed, not grepped.
 *
 * Type-only imports are excluded on purpose, in all three spellings
 * (`import type ... from`, `export type ... from`, and a named clause whose
 * every binding carries `type`): TypeScript erases them, so they never reach
 * the resolver and never need an alias. Counting them would inflate the closure
 * and demand aliases that nothing resolves through — manufacturing exactly the
 * dead entries the STALE half of this file argues against.
 *
 * Dynamic `import()` with a literal specifier IS counted: a lazy route still
 * resolves at runtime, and objectui#3890's 500s were served from precisely such
 * chunks.
 */
function valueImportSpecifiers(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  const found: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const typeOnly =
        clause !== undefined &&
        (clause.isTypeOnly ||
          (clause.name === undefined &&
            clause.namedBindings !== undefined &&
            ts.isNamedImports(clause.namedBindings) &&
            clause.namedBindings.elements.length > 0 &&
            clause.namedBindings.elements.every((element) => element.isTypeOnly)));
      if (!typeOnly) found.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.exportClause;
      const typeOnly =
        node.isTypeOnly ||
        (clause !== undefined &&
          ts.isNamedExports(clause) &&
          clause.elements.length > 0 &&
          clause.elements.every((element) => element.isTypeOnly));
      if (!typeOnly) found.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
}

interface Closure {
  /** Packages the console's own sources name directly. */
  seed: Set<string>;
  /** Those plus everything reachable from them, package-granular. */
  packages: Set<string>;
  /** For each package, one file that names it — so a finding is actionable. */
  via: Map<string, string>;
  /** Populations, so an empty walk is visible rather than convenient. */
  consoleFiles: number;
  packageFiles: number;
}

/**
 * Seed from `apps/console/src`, then take the transitive closure over the
 * `src/` of each `@object-ui/*` package reached — the card's own method,
 * re-derived here rather than restated.
 *
 * PACKAGE granularity, not module granularity: every file under a reached
 * package's `src/` is scanned, not only the modules reachable from its barrel.
 * That over-approximates in the safe direction for an alias table (an alias that
 * exists but is not needed costs nothing at runtime, while a missing one is
 * objectui#3890), and it means this walk needs no relative-specifier resolver —
 * the component that silently truncates a reachable set when it gets a file
 * extension wrong.
 */
function importClosure(): Closure {
  const via = new Map<string, string>();
  const seed = new Set<string>();

  const consoleFiles = listSourceFiles(CONSOLE_SRC);
  for (const file of consoleFiles) {
    for (const specifier of valueImportSpecifiers(file)) {
      if (!specifier.startsWith(SCOPE)) continue;
      const name = packageOf(specifier);
      if (name === undefined) continue;
      seed.add(name);
      if (!via.has(name)) via.set(name, `${path.relative(repoRoot, file)} imports '${specifier}'`);
    }
  }

  const reached = new Set(seed);
  const queue = [...seed];
  let packageFiles = 0;

  while (queue.length > 0) {
    const name = queue.shift() as string;
    const dir = WORKSPACE.get(name);
    if (dir === undefined) continue;
    const files = listSourceFiles(path.join(dir, 'src'));
    packageFiles += files.length;
    for (const file of files) {
      for (const specifier of valueImportSpecifiers(file)) {
        if (!specifier.startsWith(SCOPE)) continue;
        const next = packageOf(specifier);
        if (next === undefined || reached.has(next)) continue;
        reached.add(next);
        via.set(next, `${path.relative(repoRoot, file)} imports '${specifier}'`);
        queue.push(next);
      }
    }
  }

  return { seed, packages: reached, via, consoleFiles: consoleFiles.length, packageFiles };
}

const closure = importClosure();

/** Population line, repeated in every failure message. */
const POPULATION =
  `[population: ${aliasSpecifiers.length} alias entries (${aliasPackages.size} packages), ` +
  `closure ${closure.packages.size} packages from ${closure.seed.size} direct imports, ` +
  `scanned ${closure.consoleFiles} console + ${closure.packageFiles} package source files, ` +
  `${WORKSPACE.size} workspace packages]`;

/* -------------------------------------------------------------------------- */

describe('objectui#4925 — apps/console workspace alias table vs. its import closure', () => {
  it('folds a subpath alias entry onto its package', () => {
    // The comparison below is only meaningful if both sides are folded the same
    // way. `@object-ui/types/zod` is the entry that makes this load-bearing.
    expect(packageOf('@object-ui/types/zod')).toBe('@object-ui/types');
    expect(packageOf('@object-ui/types')).toBe('@object-ui/types');
    expect(packageOf('@objectstack/client')).toBeUndefined();
  });

  it('parses a plausible alias table (a zero-hit parse makes every case below vacuous)', () => {
    expect(
      aliasSpecifiers.length,
      `Parsed ${aliasSpecifiers.length} entries out of apps/console/vite.config.ts's ` +
        '`workspaceAliases`. Either the table really shrank by two thirds, or it was reformatted ' +
        'out of the `\'@object-ui/x\': path.resolve(...)` shape this test — and ' +
        'scripts/__tests__/side-effects-declaration-consistency.test.ts — read it by. ' +
        `Keep that shape: it is why objectui#4925 kept the table hand-written. ${POPULATION}`
    ).toBeGreaterThanOrEqual(25);
    expect(aliasPackages).toContain('@object-ui/core');
  });

  it('parses EVERY key in the table, so no entry can dodge the comparison', () => {
    // Coverage, not style. An entry written in some other form (a bare string, a
    // template literal, a spread) is invisible to ENTRY and would be reported as
    // missing forever, or hide a real gap.
    const keys = [...aliasBlock.matchAll(/^\s*(['"])([^'"]+)\1\s*:/gm)].map((m) => m[2]);

    expect(
      keys.filter((key) => !aliasSpecifiers.includes(key)),
      'These `workspaceAliases` keys are not written as `<key>: path.resolve(...)`, so the ' +
        'reconciliation below never sees them. Use that form, or teach this test the new one.'
    ).toEqual([]);
    expect(aliasSpecifiers).toHaveLength(keys.length);
  });

  it('walks a plausible import closure (a zero-hit walk makes every case below vacuous)', () => {
    expect(closure.consoleFiles, `no source files found under apps/console/src ${POPULATION}`).toBeGreaterThan(20);
    expect(closure.packageFiles, `no package source files walked ${POPULATION}`).toBeGreaterThan(200);
    expect(
      closure.seed.size,
      `apps/console/src names no '${SCOPE}*' package at all — the walk stopped seeing imports ` +
        `rather than the console stopping to import. ${POPULATION}`
    ).toBeGreaterThanOrEqual(10);
    expect(closure.packages.size, POPULATION).toBeGreaterThanOrEqual(25);
    // Reached only through another package, never named by the console itself:
    // proof the walk is TRANSITIVE and not just a scan of `apps/console/src`.
    expect(closure.packages.size).toBeGreaterThan(closure.seed.size);
  });

  it('every package in the console import closure has an alias entry', () => {
    // ⛔ The objectui#3890 direction. A package here and not in the table
    // resolves through node_modules/dist instead of source — which builds, type-
    // checks and lints green, and shows up as a 500 in the dev server.
    const missing = [...closure.packages]
      .filter((name) => !aliasPackages.has(name))
      .sort()
      .map((name) => `${name}  (reached via ${closure.via.get(name) ?? 'unknown'})`);

    expect(
      missing,
      'These packages are in the console\'s transitive import closure but have NO entry in ' +
        '`workspaceAliases` in apps/console/vite.config.ts, so they resolve through ' +
        'node_modules/dist instead of the package `src/`. That is objectui#3890: every static ' +
        'check stays green and the dev server serves 500s. Add one line per package, in the ' +
        `same \`'<pkg>': path.resolve(import.meta.dirname, '../../packages/<pkg>/src')\` shape. ` +
        POPULATION
    ).toEqual([]);
  });

  it('carries no alias entry for a package outside the closure', () => {
    // The objectui#3944 direction, one table over: an entry nothing resolves
    // through still reads to every reader as if the package were wired up.
    // Separate case, separate fix — delete the line, do not add an import.
    const stale = [...aliasPackages].filter((name) => !closure.packages.has(name)).sort();

    expect(
      stale,
      'These `workspaceAliases` entries in apps/console/vite.config.ts alias a package the ' +
        'console does not (transitively) import, so nothing resolves through them — they read ' +
        'as wiring that is not there (objectui#3944). Delete the line; if the import was meant ' +
        `to exist, add the import instead. ${POPULATION}`
    ).toEqual([]);
  });

  it('does not demand an alias for a workspace package the console never imports', () => {
    // STANDING NEGATIVE CONTROL. `pnpm-workspace.yaml` lists every workspace
    // package; the console needs only the ones it imports. If someone ever
    // "simplifies" the two cases above into `table == workspace`, this reds.
    const unused = [...WORKSPACE.keys()].filter(
      (name) => name.startsWith(SCOPE) && !closure.packages.has(name)
    );

    expect(
      unused.length,
      `Every '${SCOPE}*' workspace package is in the console's closure, so this control can no ` +
        `longer tell "table == closure" apart from "table == workspace". ${POPULATION}`
    ).toBeGreaterThan(0);

    // Named, so the control cannot be satisfied by an empty-ish coincidence:
    // plugin-ai is shaped exactly like the plugins the console DOES alias.
    expect(WORKSPACE.has('@object-ui/plugin-ai')).toBe(true);
    expect(closure.packages.has('@object-ui/plugin-ai')).toBe(false);
    expect(aliasPackages.has('@object-ui/plugin-ai')).toBe(false);
  });

  it('aliases every closure package at that package\'s own workspace directory', () => {
    // A cheap consistency read on the target, so a right-key/wrong-target entry
    // (copy-paste of a neighbouring line) is not reported as "covered".
    const wrong: string[] = [];
    for (const match of aliasBlock.matchAll(
      /(['"])(@object-ui\/[^'"]+)\1\s*:\s*path\.resolve\([^,]+,\s*(['"])([^'"]+)\3\s*\)/g
    )) {
      const name = packageOf(match[2]);
      const dir = name === undefined ? undefined : WORKSPACE.get(name);
      if (dir === undefined) continue;
      const target = path.resolve(path.dirname(CONSOLE_CONFIG), match[4]);
      if (!target.startsWith(dir + path.sep)) {
        wrong.push(`${match[2]} -> ${match[4]} (expected somewhere under ${path.relative(repoRoot, dir)})`);
      }
    }

    expect(
      wrong,
      `These alias entries point outside the workspace directory of the package they name. ${POPULATION}`
    ).toEqual([]);
  });
});
