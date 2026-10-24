import { describe, expect, it } from 'vitest';

// The shared registration reader (objectui#4894). Types are INFERRED from the
// .mjs source by `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error`.
import { readComponentRegistrations } from '../component-registrations.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ts from 'typescript';
import { build } from 'vite';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * objectui#3943: nothing in this repo ever checked that a package's
 * `sideEffects` declaration agrees with what its modules actually do when they
 * are evaluated.
 *
 * `sideEffects: false` is a PROMISE to bundlers: "no module in this package
 * does anything on evaluation, so drop any whose exports go unused". A bundler
 * that believes it does exactly that — silently. There is no error, no warning,
 * and exit code 0, because the bundler thinks it is executing your declaration
 * rather than discovering a defect.
 *
 * objectui#3899 is the specimen. `packages/layout` declared `"sideEffects":
 * false` while `src/index.ts` put six component keys into the `ComponentRegistry`
 * as a load-time side effect. Measured on main@230ffd875 by bundling the
 * documented side-effect-only import `import '@object-ui/layout';`:
 *
 *   sideEffects: false  ->  bundle is 0 bytes, zero registrations
 *   the honest array    ->  every `ComponentRegistry.register` call survives
 *
 * The failure surfaced far away, as a red `Unknown component type` panel
 * (OBJUI-001) on a green build. Nobody was bitten only because every consumer
 * that day ALSO imported a named export, which forces evaluation regardless —
 * coincidence, not design (objectui#3787 hit the hazard and routed around it by
 * calling `registerLayout()` explicitly).
 *
 * PR #3940 fixed layout and pinned it, but that pin was package-scoped: it read
 * `packages/layout/package.json` and probed layout's own entry forms. The next
 * package to repeat the mistake would turn nothing red. This file is that pin
 * generalised over the workspace — the same move objectui#3663 made for `files`
 * (`package-files-exist.test.ts`) after the drift was caught by hand twice in
 * one week.
 *
 * ## The two halves, and why both directions are checked
 *
 * A declaration is a claim about module bodies, so it can be wrong in two ways
 * and this gate rejects both:
 *
 *   - `sideEffects: false` + a load-time side effect  -> the objectui#3899 lie.
 *     The registration is dropped and the app breaks far from the cause.
 *   - `sideEffects: [...]` naming a module that has NO load-time side effect
 *     -> a phantom claim. It costs bundle size for every consumer and, worse,
 *     reads to the next author as "this module registers something", which is
 *     how a real entry gets deleted as noise.
 *
 * Same rule stated once: the manifest and the module bodies must agree, and
 * whichever half moves, the other moves with it. A red test here NEVER means
 * "put the side effect back" — it means the two halves disagree, and the fix is
 * whichever one is currently false.
 *
 * ## Why the population is derived from reachability, not from a file glob
 *
 * `sideEffects: false` licenses the bundler to drop ANY module of the package
 * whose exports go unused — not just the barrel. So the honest scan population
 * is the barrel plus every module transitively reachable from it by relative
 * import: exactly the set a bundler can drop, derived rather than listed.
 *
 * That also makes a test-file exclusion list unnecessary, which matters more
 * than it looks. A `src/**` glob would sweep in the colocated `*.test.ts` files
 * (28 top-level `describe(...)` calls in `packages/core/src` alone — measured),
 * every one of them a top-level call expression and none of them a bundling
 * hazard, because nothing imports them. Excluding them by NAME would then put a
 * hole in the gate shaped exactly like a filename. Reachability has no such
 * hole: a module the barrel cannot reach cannot be dropped from a barrel
 * import, and a module it can reach is scanned whatever it is called.
 *
 * ## What a real bundler is, and is not, used for here
 *
 * It is NOT used as the side-effect detector. That was measured before this
 * gate was written, by bundling each package's real source under a mirrored
 * `sideEffects: true` (which forces the module to be retained, so whatever
 * survives is what the bundler considers impure):
 *
 *   @object-ui/i18n         -> 1.28 MB retained  (`Object.freeze(Object.keys({...}))`
 *                              over the locale tables — module-local, harmless)
 *   @object-ui/types        -> 261 B retained    (`new Set(Object.values({...}))`)
 *   @object-ui/react-runtime-> 33 B retained     (bare imports of external deps)
 *   @object-ui/sdui-parser  -> 0 B
 *
 * Rollup's purity analysis is deliberately conservative, so "the bundler kept
 * something" does not mean "this package has an externally-visible side
 * effect". Reading those numbers as verdicts would have made this gate red on
 * three honest packages on day one. The static scan below asks the narrower,
 * decidable question instead: does a module body reach OUT — a bare call, a
 * write through a member expression, a side-effect-only import?
 *
 * The bundler IS used for the one question static analysis cannot answer: does
 * the declaration actually change what a bundler emits? Every probe below comes
 * with its `sideEffects: false` control, so a bundler that stopped honouring
 * the field would fail the control loudly instead of leaving every other
 * assertion green over nothing (PR #3940's anti-vacuity discipline, lifted).
 *
 * ## The workspace-alias trap
 *
 * The published paths are NOT the only consumption surface. In-repo bundler
 * configs alias `@object-ui/*` specifiers at a package's `src`, and a bundler
 * reads the SAME `package.json` for those source files. PR #3940 measured it:
 * with only the `dist/*` forms declared, the console's alias shape still
 * produced a 0-byte bundle. A gate that skipped alias entries would hand a
 * green light to a package that still breaks, so the alias tables are parsed
 * and folded into the entry forms below.
 *
 * The root `vitest.config.mts` has such a table and is deliberately NOT read:
 * Vitest transforms and executes modules, it does not tree-shake them, so
 * `sideEffects` has no effect on that path. It is not a bundling surface. The
 * same reasoning scopes the parse below to `resolve.alias` and not to a
 * `test.alias` inside a `vite.config.*`.
 *
 * ## What this gate deliberately does NOT prove
 *
 * That a top-level `const x = f()` is pure. A call in a variable INITIALIZER is
 * not flagged: module-local consts are the overwhelming majority (225 of them
 * in `packages/types` alone), a bundler drops the unused ones, and flagging
 * them would bury the real signal. So `const _ = registerLayout();` would slip
 * past — a contrived spelling with no instance in the tree today (verified
 * across all 157 reachable modules of the five `sideEffects: false` packages),
 * and named here rather than papered over.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** `"dist/index.js"` and `"./dist/index.js"` name one file; compare on this. */
const normalize = (p: string): string => (p.startsWith('./') ? p.slice(2) : p);

interface Manifest {
  name?: string;
  main?: unknown;
  module?: unknown;
  sideEffects?: unknown;
  exports?: unknown;
}

interface DeclaringPackage {
  name: string;
  /** Repo-relative, forward-slashed, e.g. `packages/layout`. */
  dir: string;
  manifest: Manifest;
  /** `false`, or the declared array normalised (no leading `./`). */
  declared: false | string[];
}

/**
 * The `packages:` globs from `pnpm-workspace.yaml`, read rather than hardcoded
 * so a new workspace root is covered the day it is added. Understands only the
 * two shapes the file uses (`dir/*` and a bare `dir`); anything else throws
 * rather than being skipped, because a guard that silently stops looking at
 * part of the workspace goes on reporting success over a shrinking surface.
 * (Same derivation as `package-files-exist.test.ts`.)
 */
function workspaceGlobs(): string[] {
  const yaml = fs.readFileSync(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => /^packages:\s*$/.test(l));
  expect(start, '`pnpm-workspace.yaml` must still declare a top-level `packages:` key').toBeGreaterThan(-1);

  const globs: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    if (!/^\s/.test(line)) break;
    const match = line.match(/^\s*-\s*['"]?([^'"#\s]+)['"]?\s*(#.*)?$/);
    if (!match) {
      throw new Error(
        `Unparsed entry in pnpm-workspace.yaml \`packages:\`: ${JSON.stringify(line)} — teach this guard the new syntax.`,
      );
    }
    globs.push(match[1]);
  }
  return globs;
}

function workspacePackageDirs(): string[] {
  const dirs: string[] = [];
  for (const glob of workspaceGlobs()) {
    if (glob.endsWith('/*')) {
      const parent = path.join(repoRoot, glob.slice(0, -2));
      if (!fs.existsSync(parent)) continue;
      for (const d of fs.readdirSync(parent)) {
        const full = path.join(parent, d);
        if (fs.statSync(full).isDirectory()) dirs.push(full);
      }
    } else if (!glob.includes('*')) {
      dirs.push(path.join(repoRoot, glob));
    } else {
      throw new Error(`Unsupported workspace glob ${JSON.stringify(glob)} — teach this guard how to expand it.`);
    }
  }
  return dirs;
}

/**
 * Every workspace package that DECLARES `sideEffects` as `false` or an array.
 *
 * `true` is excluded because it is unfalsifiable in the direction that hurts:
 * it hands the whole package to every bundler as unshakeable, which is
 * conservative and can never lose a registration. An omitted field is the same
 * safe default (a bundler assumes side effects), which is why every
 * `plugin-*` package — the ones `PluginLoader` dynamically imports — has never
 * been exposed to this hazard.
 */
function readDeclaringPackages(): DeclaringPackage[] {
  const found: DeclaringPackage[] = [];
  for (const dir of workspacePackageDirs()) {
    const pkgPath = path.join(dir, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    const manifest: Manifest = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (!manifest.name) continue;
    const declared = manifest.sideEffects;
    if (declared !== false && !Array.isArray(declared)) continue;
    if (Array.isArray(declared) && declared.some((e) => typeof e !== 'string')) {
      throw new Error(`${manifest.name} declares a non-string \`sideEffects\` entry — teach this guard that shape.`);
    }
    found.push({
      name: manifest.name,
      dir: path.relative(repoRoot, dir).split(path.sep).join('/'),
      manifest,
      declared: declared === false ? false : (declared as string[]).map(normalize),
    });
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

const declaringPackages = readDeclaringPackages();

/* -------------------------------------------------------------------------- */
/* Workspace alias tables — the consumption surface that is not `exports`.      */
/* -------------------------------------------------------------------------- */

interface AliasEntry {
  /** The config that declares it, repo-relative. */
  config: string;
  /** The aliased specifier, e.g. `@object-ui/layout`. */
  specifier: string;
  /** Absolute path the alias resolves to (a directory or a file). */
  target: string;
}

/**
 * Bundler configs, by strict basename.
 *
 * The strictness is load-bearing rather than tidy: a `vite.config.*` glob also
 * matches `vite.config.ts.timestamp-*.mjs`, the temp-config Vite writes beside a
 * config while loading it, and reading one would feed this guard an alias table
 * from whenever that snapshot was taken. Being git-ignored (`.gitignore:99`) does
 * not put it out of reach — `readAliasEntries` below walks the filesystem, so any
 * copy a crashed or killed Vite left behind is visible here whether or not git
 * tracks it. One such file was tracked in `packages/plugin-editor` until
 * objectui#4540 removed it.
 */
const BUNDLER_CONFIG_RE = /^vite\.config\.(ts|mts|cts|js|mjs|cjs)$/;

/** Only workspace packages are a `sideEffects` surface this repo can fix. */
const ALIAS_SPECIFIER_PREFIX = '@object-ui/';

/**
 * An `@object-ui/*` key sitting in a `resolve.alias` table that the parser
 * below could not turn into an entry. Never a silent skip: the whole failure
 * mode this shape exists to end is a surface that shrinks without saying so.
 */
interface AliasParseGap {
  config: string;
  /** The specifier, or a description of the table when the table itself is unreadable. */
  what: string;
  /** The source text that was not understood, first line, clipped. */
  text: string;
}

const aliasParseGaps: AliasParseGap[] = [];

/** `x as T`, `x satisfies T`, `(x)` — spellings that wrap the node we want. */
function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** A property's name as text, for the spellings a config uses (`k`, `'k'`, `"k"`). */
function propertyKey(prop: ts.PropertyAssignment): string | undefined {
  const name = prop.name;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text;
  }
  return undefined;
}

/**
 * A `resolve()`-shaped call, whatever the callee is spelled as: bare `resolve`
 * from `import { resolve } from 'path'`, `path.resolve`, or a renamed import
 * like `nodePath.resolve`. The ARGUMENTS are what make it an alias target —
 * `(__dirname | import.meta.dirname, '<relative>')` — so the callee only has to
 * be the right function name, not the right import style.
 */
function resolveCallTarget(value: ts.Expression): string | undefined {
  const call = unwrapExpression(value);
  if (!ts.isCallExpression(call)) return undefined;

  const callee = call.expression;
  const isResolve =
    (ts.isIdentifier(callee) && callee.text === 'resolve') ||
    (ts.isPropertyAccessExpression(callee) && callee.name.text === 'resolve');
  if (!isResolve) return undefined;

  if (call.arguments.length !== 2) return undefined;
  const base = call.arguments[0];
  const isDirname =
    (ts.isIdentifier(base) && base.text === '__dirname') ||
    (ts.isPropertyAccessExpression(base) && base.name.text === 'dirname' && ts.isMetaProperty(base.expression));
  if (!isDirname) return undefined;

  const relative = call.arguments[1];
  if (!ts.isStringLiteral(relative) && !ts.isNoSubstitutionTemplateLiteral(relative)) return undefined;
  return relative.text;
}

/**
 * The `resolve.alias` tables of one config, as expressions.
 *
 * Scoped to `alias` under a `resolve` property on purpose. A blind search for
 * any `alias:` would also pick up a `test.alias`, and the header above says why
 * that must not count: Vitest executes modules rather than tree-shaking them,
 * so a Vitest-only alias is not a bundling surface and folding it in here would
 * widen this gate past what it can justify.
 *
 * One hop of identifier indirection is followed, because two of the three
 * tables the previous regex DID read are spelled that way — `apps/console` and
 * `examples/console-starter` both declare `const workspaceAliases = { … }` and
 * then write `alias: workspaceAliases`. Reading only inline literals would drop
 * 63 of the entries this gate has been resting on, i.e. narrow the surface
 * while claiming to widen it.
 */
function aliasTableExpressions(source: ts.SourceFile, config: string): ts.Expression[] {
  const declarations = new Map<string, ts.Expression>();
  const tables: ts.Expression[] = [];

  const collectDeclarations = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      declarations.set(node.name.text, unwrapExpression(node.initializer));
    }
    ts.forEachChild(node, collectDeclarations);
  };
  collectDeclarations(source);

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && propertyKey(node) === 'alias') {
      const owner = node.parent.parent;
      const underResolve = ts.isPropertyAssignment(owner) && propertyKey(owner) === 'resolve';
      if (underResolve) {
        let table = unwrapExpression(node.initializer);
        if (ts.isIdentifier(table)) {
          const declared = declarations.get(table.text);
          if (declared === undefined) {
            aliasParseGaps.push({
              config,
              what: `resolve.alias -> \`${table.text}\``,
              text: 'alias table is an identifier this file does not declare',
            });
            ts.forEachChild(node, visit);
            return;
          }
          table = declared;
        }
        tables.push(table);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return tables;
}

/**
 * Alias tables parsed out of every bundler config in the workspace.
 *
 * Read as source rather than imported, for the reason
 * `vitest-config-alias-targets-3944.test.ts` gives: these configs pull in the
 * whole Vite plugin surface at module scope, and a guard that only needs a list
 * of strings should not boot that.
 *
 * ## Why a parser and not a regex (objectui#5158)
 *
 * Until #5158 this read the source TEXT with one regex that required the exact
 * characters `path.resolve(` after a SINGLE-quoted key inside an object
 * literal. Every config that spelled the same table any other way was not
 * checked-and-passed, it was never looked at — measured on `main@cdac3cc20`:
 * 70 of 196 entries read, 15 configs contributing zero. Three independent
 * spellings were invisible, and only the first is the one #5158 opened on:
 *
 *   - `import { resolve } from 'path'` + `resolve(__dirname, …)` — 15 configs,
 *     105 entries (every `packages/plugin-*` that has a table);
 *   - the ARRAY table form, `alias: [{ find, replacement }]` — 7 entries in
 *     `packages/components`, which a widened `(?:path\.)?resolve` regex would
 *     still have missed because there is no `'key':` at all;
 *   - DOUBLE-quoted keys — 14 entries in `packages/runner`, missed for a reason
 *     that has nothing to do with `resolve` and everything to do with `'`.
 *
 * Three invisible spellings of one structure is the argument against
 * enumerating spellings — the widened `(?:path\.)?` regex #5158 proposed closes
 * the first and leaves the other two, because they do not differ on `resolve`.
 * The AST reads the structure instead: a property of an alias table whose
 * value is a `resolve(dirname, '<relative>')` call, however the callee, the
 * quotes and the table are written.
 *
 * It also retires two decoys by construction rather than by heuristic. A
 * `rollupOptions.output.globals` map is keyed by the same specifiers
 * (`'@object-ui/core': 'ObjectUICore'`) and is not an alias table — outside
 * `resolve.alias`, so it is never reached, and its values are strings, so it
 * could not parse anyway. And a specifier quoted inside a COMMENT is not a
 * node: the previous reader stripped whole comment LINES to approximate that,
 * which left an entry inside a multi-line block comment counted as live, and
 * `examples/console-starter/vite.config.ts` still carries a note that it avoids
 * spelling a quoted specifier in prose because "that decoy already fooled one
 * scan". The parser makes the note unnecessary rather than load-bearing.
 *
 * ## What is still out of reach, named
 *
 * `apps/console` mutates its table at runtime under an env var
 * (`Object.assign(workspaceAliases, specDistInjection.aliases)`, gated on
 * `OBJECTSTACK_SPEC_DIST`). A static read sees the baseline literal, which is
 * the table every ordinary build uses, and the injected entries alias
 * `@objectstack/spec` — not an `@object-ui/*` package, so they could not
 * contribute an entry form here in any case.
 */
function readAliasEntries(): AliasEntry[] {
  const entries: AliasEntry[] = [];
  for (const dir of workspacePackageDirs()) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!BUNDLER_CONFIG_RE.test(name)) continue;
      const configPath = path.join(dir, name);
      const config = path.relative(repoRoot, configPath).split(path.sep).join('/');
      const source = ts.createSourceFile(
        configPath,
        fs.readFileSync(configPath, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const clip = (node: ts.Node): string => node.getText(source).split('\n')[0].trim().slice(0, 120);

      for (const table of aliasTableExpressions(source, config)) {
        /** `[specifier, value node, node to quote in a gap report]` */
        const pairs: [string, ts.Expression, ts.Node][] = [];

        if (ts.isObjectLiteralExpression(table)) {
          for (const prop of table.properties) {
            if (!ts.isPropertyAssignment(prop)) continue;
            const key = propertyKey(prop);
            if (key === undefined || !key.startsWith(ALIAS_SPECIFIER_PREFIX)) continue;
            pairs.push([key, prop.initializer, prop]);
          }
        } else if (ts.isArrayLiteralExpression(table)) {
          for (const element of table.elements) {
            const entry = unwrapExpression(element);
            if (!ts.isObjectLiteralExpression(entry)) continue;
            let find: ts.Expression | undefined;
            let replacement: ts.Expression | undefined;
            for (const prop of entry.properties) {
              if (!ts.isPropertyAssignment(prop)) continue;
              if (propertyKey(prop) === 'find') find = unwrapExpression(prop.initializer);
              if (propertyKey(prop) === 'replacement') replacement = prop.initializer;
            }
            // A `find` that is not a plain string is a RegExp matcher, which
            // names no single specifier and cannot yield an entry form.
            if (find === undefined) continue;
            if (!ts.isStringLiteral(find) && !ts.isNoSubstitutionTemplateLiteral(find)) continue;
            if (!find.text.startsWith(ALIAS_SPECIFIER_PREFIX)) continue;
            if (replacement === undefined) {
              aliasParseGaps.push({ config, what: find.text, text: clip(entry) });
              continue;
            }
            pairs.push([find.text, replacement, entry]);
          }
        } else {
          aliasParseGaps.push({
            config,
            what: `resolve.alias (${ts.SyntaxKind[table.kind]})`,
            text: clip(table),
          });
          continue;
        }

        for (const [specifier, value, node] of pairs) {
          const relative = resolveCallTarget(value);
          if (relative === undefined) {
            aliasParseGaps.push({ config, what: specifier, text: clip(node) });
            continue;
          }
          entries.push({ config, specifier, target: path.resolve(dir, relative) });
        }
      }
    }
  }
  return entries;
}

const aliasEntries = readAliasEntries();

/** Extensions a bundler tries, in Vite's own order. `.tsx` is why this matters. */
const RESOLVE_EXTENSIONS = ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx'];

/**
 * The module an alias target names: a file is itself, a directory is the barrel
 * inside it.
 *
 * The directory case is the one in the tree today, and resolving it here rather
 * than assuming `index.ts` is what makes `@object-ui/react-runtime` (whose
 * barrel is `index.tsx`) come out right — the exact spelling objectui#3943
 * warns a naive `index.ts` glob would miss.
 */
function resolveAliasModule(target: string): string | undefined {
  if (fs.existsSync(target) && fs.statSync(target).isFile()) return target;
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    for (const ext of RESOLVE_EXTENSIONS) {
      const candidate = path.join(target, `index${ext}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

/**
 * Every module path a bundler can resolve a package to, package-relative.
 *
 * Lifted from PR #3940's `resolvableEntryPaths()` and generalised: derived from
 * the manifest and the alias tables rather than hardcoded, so a renamed
 * `fileName` in a `vite.config.ts`, a new `exports` subpath, or a new alias
 * table shows up here as a missing declaration instead of drifting silently.
 */
function resolvableEntryPaths(pkg: DeclaringPackage): string[] {
  const found = new Set<string>();

  for (const field of [pkg.manifest.main, pkg.manifest.module]) {
    if (typeof field === 'string') found.add(normalize(field));
  }

  const walk = (node: unknown): void => {
    if (node === null || node === undefined) return;
    if (typeof node === 'string') {
      // Only a relative target names a file in this package; a bare specifier
      // is a re-export of a dependency and is that package's manifest's
      // problem, not this one's.
      if (node.startsWith('./')) found.add(normalize(node));
      return;
    }
    if (typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      // `types` points at a `.d.ts`; type declarations are erased and never
      // carry a side effect, so they are not a bundling surface.
      if (key === 'types') continue;
      walk(value);
    }
  };
  walk(pkg.manifest.exports);

  for (const alias of aliasEntries) {
    if (alias.specifier !== pkg.name && !alias.specifier.startsWith(`${pkg.name}/`)) continue;
    const module = resolveAliasModule(alias.target);
    if (module === undefined) continue;
    const rel = path.relative(path.join(repoRoot, pkg.dir), module).split(path.sep).join('/');
    if (!rel.startsWith('..')) found.add(rel);
  }

  return [...found].filter((p) => !p.includes('*')).sort();
}

/**
 * Every path git has in its index. Fails loudly if git is not usable: returning
 * an empty set would make every entry look like build output, which quietly
 * SHRINKS what this gate examines.
 */
function gitTrackedPaths(): Set<string> {
  const result = spawnSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  });
  if (result.status !== 0) {
    throw new Error(
      `\`git ls-files\` failed in ${repoRoot} (status ${result.status}): ${result.stderr}\n` +
        'This guard separates source from build output using git, so it fails closed rather than ' +
        'passing over an unknown tree.',
    );
  }
  return new Set(result.stdout.split('\0').filter(Boolean));
}

const trackedPaths = gitTrackedPaths();

/**
 * Whether an entry form is SOURCE in this repo, as opposed to build output.
 *
 * Keyed on git's index rather than on `fs.existsSync`, and the difference is the
 * whole point: `dist/index.js` exists in a built tree and not in a fresh clone,
 * so an existence check answers differently depending on whether anyone has run
 * a build. That is not hypothetical here — `packages/layout/dist` was populated
 * by a `turbo type-check` run (which `dependsOn: ^build`) while this gate was
 * being written, which would have flipped `dist/index.js` into the statically
 * scanned population on one machine and not another.
 *
 * `package-files-exist.test.ts` learned the same lesson the same way in
 * objectui#4059: its producibility check was first written against `onDisk` and
 * passed on the very state it exists to reject, because a local build had
 * already put the file there. Git's index does not move when you run
 * `pnpm build`.
 */
const isSourceEntry = (pkg: DeclaringPackage, entry: string): boolean =>
  trackedPaths.has(path.posix.join(pkg.dir, entry));

/**
 * Whether an entry form (or an array entry) is a module a parser can read.
 *
 * `@object-ui/app-shell` exports `./styles.css`, and a stylesheet IS a
 * `sideEffects` surface — webpack's classic silent bug is a dropped CSS import
 * — so it must be COVERED by the array. What it is not is something the
 * TypeScript parser below can scan for a load-time side effect, and what a
 * bundler cannot be handed is a JS marker written into a `.css` file. Both
 * narrowings below are keyed on this predicate rather than on a filename, so a
 * second non-JS export form is covered the day it is added.
 */
const isParseableModule = (entry: string): boolean => /\.(ts|tsx|mts|js|jsx|mjs)$/.test(entry);

/**
 * Array entries that name a module of the package which is not an ENTRY FORM.
 *
 * objectui#3943 was written when the only array in the workspace named entry
 * forms and nothing else (`@object-ui/layout`: its barrel, in three spellings).
 * objectui#6683 added the general case: `@object-ui/app-shell` names ten DEEP
 * modules that register SDUI widgets at load time, because those are exactly
 * the modules a bundler must not drop.
 *
 * So the phantom direction below can no longer be "not an entry form ⇒ made
 * up". It asks the weaker, still-worth-asking question — does this path name
 * anything real? — and the STRONGER question, is the set exactly right, belongs
 * to `scripts/check-side-effects-array.mjs`, which derives the enumeration from
 * the module bodies and fails on a missing OR a stale name. Two guards, two
 * derivations, on purpose.
 */
function packageModuleForms(pkg: DeclaringPackage): Set<string> {
  const forms = new Set<string>();
  const graph = entryGraphs.get(pkg.name);
  if (!graph) return forms;

  // The published spelling of a source module, derived from the barrel pair
  // this package actually declares (`src/index.ts` <-> `dist/index.js`), never
  // assumed. A package whose build does not preserve the tree simply yields no
  // published forms here, and its `dist/*` entries fall to the entry-form half.
  const sourceBarrel = resolvableEntryPaths(pkg).find((e) => isSourceEntry(pkg, e) && /(^|\/)index\./.test(e));
  const publishedBarrel = resolvableEntryPaths(pkg).find((e) => !isSourceEntry(pkg, e) && /(^|\/)index\.[cm]?js$/.test(e));

  for (const abs of graph.modules) {
    const rel = path.relative(path.join(repoRoot, pkg.dir), abs).split(path.sep).join('/');
    if (rel.startsWith('..')) continue;
    forms.add(rel);
    if (sourceBarrel && publishedBarrel) {
      const srcRoot = sourceBarrel.split('/')[0];
      const distRoot = publishedBarrel.split('/')[0];
      const publishedExt = path.extname(publishedBarrel);
      if (rel.startsWith(`${srcRoot}/`)) {
        forms.add(`${distRoot}/${rel.slice(srcRoot.length + 1).replace(/\.(tsx|ts|mts|jsx|js|mjs)$/, publishedExt)}`);
      }
    }
  }
  return forms;
}

/* -------------------------------------------------------------------------- */
/* The static scan: top-level statements that reach OUT of the module.          */
/* -------------------------------------------------------------------------- */

interface SideEffectStatement {
  /** Repo-relative file. */
  file: string;
  line: number;
  /** `top-level call`, `top-level write`, `side-effect-only import`, ... */
  kind: string;
  /** The first line of the statement, for the failure message. */
  text: string;
}

/**
 * Whether a node contains something whose evaluation can be observed outside
 * this module: a call, a construction, or a write through a member expression
 * (`globalThis.x = …`, `Registry.foo = …`).
 *
 * A call is treated as impure without trying to prove otherwise. That is the
 * safe direction for a gate — `registerLayout()` and `console.log()` are
 * indistinguishable here, and a package promising `sideEffects: false` should
 * be doing neither at load time.
 */
function impureNode(node: ts.Node): ts.Node | undefined {
  let hit: ts.Node | undefined;
  const walk = (n: ts.Node): void => {
    if (hit) return;
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) hit = n;
    else if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isPropertyAccessExpression(n.left) || ts.isElementAccessExpression(n.left))
    )
      hit = n;
    else ts.forEachChild(n, walk);
  };
  walk(node);
  return hit;
}

/** Statement kinds that RUN when the module is evaluated (as opposed to declaring). */
function isExecutedStatement(stmt: ts.Statement): boolean {
  return (
    ts.isIfStatement(stmt) ||
    ts.isForStatement(stmt) ||
    ts.isForOfStatement(stmt) ||
    ts.isForInStatement(stmt) ||
    ts.isWhileStatement(stmt) ||
    ts.isDoStatement(stmt) ||
    // `try { registerLayout(); } catch {}` — objectui#3899's actual shape, and
    // the reason this gate cannot just look for ExpressionStatements.
    ts.isTryStatement(stmt) ||
    ts.isSwitchStatement(stmt) ||
    ts.isBlock(stmt) ||
    ts.isLabeledStatement(stmt) ||
    ts.isThrowStatement(stmt)
  );
}

interface ModuleScan {
  effects: SideEffectStatement[];
  /** Relative specifiers this module imports or re-exports from. */
  relativeSpecifiers: string[];
}

function scanModule(absFile: string): ModuleScan {
  const source = ts.createSourceFile(
    absFile,
    fs.readFileSync(absFile, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );
  const rel = path.relative(repoRoot, absFile).split(path.sep).join('/');
  const at = (n: ts.Node): number => source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1;
  const firstLine = (n: ts.Node): string => n.getText(source).split('\n')[0].trim().slice(0, 120);

  const effects: SideEffectStatement[] = [];
  const relativeSpecifiers: string[] = [];

  for (const stmt of source.statements) {
    if (ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt)) {
      const specifier = stmt.moduleSpecifier;
      if (specifier && ts.isStringLiteral(specifier)) {
        if (specifier.text.startsWith('.')) relativeSpecifiers.push(specifier.text);
        // `import './register';` / `import './styles.css';` — the module is
        // pulled in for its evaluation alone, which is precisely what
        // `sideEffects: false` tells a bundler it may skip.
        if (ts.isImportDeclaration(stmt) && !stmt.importClause) {
          effects.push({ file: rel, line: at(stmt), kind: 'side-effect-only import', text: firstLine(stmt) });
        }
      }
      continue;
    }

    if (ts.isExpressionStatement(stmt)) {
      // A bare string is a directive prologue (`'use client'`), not a statement
      // anything can observe.
      if (ts.isStringLiteral(stmt.expression)) continue;
      const hit = impureNode(stmt);
      if (hit) {
        effects.push({
          file: rel,
          line: at(stmt),
          kind: ts.isBinaryExpression(hit) ? 'top-level write' : 'top-level call',
          text: firstLine(stmt),
        });
      }
      continue;
    }

    if (isExecutedStatement(stmt) && impureNode(stmt)) {
      effects.push({
        file: rel,
        line: at(stmt),
        kind: `top-level ${ts.SyntaxKind[stmt.kind].replace(/Statement$/, '').toLowerCase()}`,
        text: firstLine(stmt),
      });
    }
  }

  return { effects, relativeSpecifiers };
}

/**
 * Resolve a relative specifier the way this repo's TypeScript sources spell
 * them: ESM-style, with a `.js` extension naming the `.ts` file next to it.
 * Getting this wrong does not fail loudly — it silently truncates the reachable
 * set, so an unresolved specifier is reported by the caller rather than
 * skipped.
 */
function resolveRelative(fromFile: string, specifier: string): string | undefined {
  const rewritten = specifier
    .replace(/\.js$/, '.ts')
    .replace(/\.jsx$/, '.tsx')
    .replace(/\.mjs$/, '.mts');
  for (const candidate of [rewritten, specifier]) {
    const abs = path.resolve(path.dirname(fromFile), candidate);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  }
  const base = path.resolve(path.dirname(fromFile), specifier.replace(/\.(js|jsx|mjs)$/, ''));
  for (const ext of RESOLVE_EXTENSIONS) {
    if (fs.existsSync(base + ext)) return base + ext;
  }
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    for (const ext of RESOLVE_EXTENSIONS) {
      const index = path.join(base, `index${ext}`);
      if (fs.existsSync(index)) return index;
    }
  }
  return undefined;
}

interface EntryGraph {
  /** Every module reachable from the entry, absolute paths. */
  modules: string[];
  effects: SideEffectStatement[];
  /** Specifiers that could not be resolved — reported, never silently dropped. */
  unresolved: string[];
}

/**
 * The barrel plus every module reachable from it by relative import: the set a
 * bundler may drop when the package declares `sideEffects: false`, and
 * therefore the set that declaration is a promise about.
 *
 * Bare specifiers stop the walk. `@object-ui/core` imported from
 * `@object-ui/layout` is core's own manifest's problem, and core is scanned in
 * its own right when it declares the field.
 */
function walkEntryGraph(entryFile: string): EntryGraph {
  const seen = new Set<string>();
  const effects: SideEffectStatement[] = [];
  const unresolved: string[] = [];
  const stack = [entryFile];

  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(ts|tsx|mts|js|jsx|mjs)$/.test(file) || /\.d\.ts$/.test(file)) continue;

    const { effects: found, relativeSpecifiers } = scanModule(file);
    effects.push(...found);
    for (const specifier of relativeSpecifiers) {
      const resolved = resolveRelative(file, specifier);
      if (resolved) stack.push(resolved);
      else unresolved.push(`${path.relative(repoRoot, file)} -> ${specifier}`);
    }
  }

  return { modules: [...seen], effects, unresolved };
}

/**
 * The source barrel of a package: the module its workspace alias resolves to.
 *
 * Derived from the alias tables rather than from a filename convention, so
 * `@object-ui/react-runtime`'s `src/index.tsx` is found by the same code path
 * as everyone else's `src/index.ts`.
 */
function sourceBarrel(pkg: DeclaringPackage): string | undefined {
  const entries = resolvableEntryPaths(pkg).filter((entry) => isSourceEntry(pkg, entry));
  const barrel = entries.find((entry) => /(^|\/)index\.(ts|tsx|mts|js|jsx|mjs)$/.test(entry));
  return barrel === undefined ? undefined : path.join(repoRoot, pkg.dir, barrel);
}

/* -------------------------------------------------------------------------- */
/* The real-bundler probes (PR #3940's, hoisted and generalised).               */
/* -------------------------------------------------------------------------- */

/** The bare specifier the probes resolve, so each probe picks its own target. */
const SPECIFIER = '@objectui-3943/probe';

/** A global write: a side effect no bundler can prove away, so its absence
 *  means the MODULE was dropped, never that the statement was optimised out. */
const MARKER = '__objectui_3943_load_time_side_effect__';

/**
 * Bundle `import '<specifier>';` — nothing else, no named import — with
 * `target` supplying the module, and return the emitted code.
 *
 * Every bare specifier except the package under test is external, so the bundle
 * holds that package's own graph and nothing more. `write: false` keeps it in
 * memory; measured at ~250ms cold and ~40ms warm, so this is a real build and
 * still cheap enough to be an ordinary unit test.
 */
async function bundleSideEffectOnlyImport(target: string): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'objectui-3943-entry-'));
  try {
    const entry = path.join(dir, 'entry.mjs');
    writeFileSync(entry, `import ${JSON.stringify(SPECIFIER)};\n`);

    const result: unknown = await build({
      configFile: false,
      logLevel: 'silent',
      resolve: { alias: { [SPECIFIER]: target } },
      build: {
        write: false,
        minify: false,
        lib: { entry, formats: ['es'], fileName: 'bundle' },
        rollupOptions: {
          external: (id: string) => !/^[./]/.test(id) && !id.startsWith('/') && id !== SPECIFIER,
        },
      },
    });

    const bundles = Array.isArray(result) ? result : [result];
    const output = (bundles[0] as { output?: Array<{ type: string; code?: string }> } | undefined)?.output;
    if (!output) {
      throw new Error(
        'The probe build returned no output. It must produce an in-memory bundle to inspect — a watcher ' +
          'or an empty result means this helper needs updating, not that the assertion below passed.',
      );
    }
    return output
      .filter((chunk) => chunk.type === 'chunk')
      .map((chunk) => chunk.code ?? '')
      .join('\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A copy of a package whose manifest is byte-for-byte the real one except for
 * `sideEffects`, with a marker module written at each of `entryPaths`.
 *
 * Copying rather than mutating the real `package.json`: a test that edits a
 * package manifest leaves a dirty tree behind when it fails, and several of
 * these run in the same worker.
 *
 * Writing markers at the manifest's own relative paths is what lets the
 * published `dist/*` forms be probed in an UNBUILT worktree. Those probes
 * therefore prove that the declared globs MATCH the published paths in the
 * bundler's matcher — not that `dist` holds the registration. The static scan
 * above is the source side of that; the package build is the artifact side.
 */
function mirrorPackage(pkg: DeclaringPackage, sideEffects: unknown, entryPaths: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'objectui-3943-mirror-'));
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ ...pkg.manifest, sideEffects }, null, 2));

  for (const rel of entryPaths) {
    const file = path.join(dir, normalize(rel));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      `globalThis[${JSON.stringify(MARKER)}] = ${JSON.stringify(rel)};\n` +
        (rel.endsWith('.cjs') ? 'module.exports = { unused: 1 };\n' : 'export const unused = 1;\n'),
    );
  }
  return dir;
}

/** A package's real source tree, copied so the same probe can run under a
 *  different manifest. Returns the mirrored `src` directory. */
function mirrorSourceTree(pkg: DeclaringPackage, sideEffects: unknown): string {
  const dir = mirrorPackage(pkg, sideEffects, []);
  cpSync(path.join(repoRoot, pkg.dir, 'src'), path.join(dir, 'src'), {
    recursive: true,
    filter: (src) => !src.includes('__tests__'),
  });
  return path.join(dir, 'src');
}

/* -------------------------------------------------------------------------- */
/* Derived populations.                                                         */
/* -------------------------------------------------------------------------- */

const falsePackages = declaringPackages.filter((p) => p.declared === false);
const arrayPackages = declaringPackages.filter((p) => p.declared !== false);

const entryForms = new Map<string, string[]>(declaringPackages.map((p) => [p.name, resolvableEntryPaths(p)]));

const entryGraphs = new Map<string, EntryGraph>(
  declaringPackages.flatMap((pkg) => {
    const barrel = sourceBarrel(pkg);
    return barrel === undefined ? [] : [[pkg.name, walkEntryGraph(barrel)] as [string, EntryGraph]];
  }),
);

interface ProbeCase {
  pkg: DeclaringPackage;
  name: string;
  entry: string;
}

/**
 * Every entry form of every ARRAY package: the array's whole content is the claim.
 *
 * JS-shaped forms only. `mirrorPackage` probes a form by writing a JS marker
 * module AT that path and asking a bundler whether it survives — which is a
 * measurement for `dist/index.js` and a category error for
 * `@object-ui/app-shell`'s `./src/styles.css`, where Vite's CSS pipeline emits
 * an asset and no chunk for the marker to be in. The narrowing is keyed on the
 * extension, not on a filename, and it removes nothing from the STATIC halves
 * above: `src/styles.css` is still required to be covered by the array there.
 */
const arrayEntryProbes: ProbeCase[] = arrayPackages.flatMap((pkg) =>
  (entryForms.get(pkg.name) ?? []).filter(isParseableModule).map((entry) => ({ pkg, name: pkg.name, entry })),
);

/**
 * The source barrel of every `sideEffects: false` package.
 *
 * Only the barrel, and the reason is a boundary rather than a shortcut: a
 * `false` package's `dist/*` forms are COMPILED FROM the source this gate
 * statically scanned, so the source verdict transfers to them. What still needs
 * a bundler is that the flag is honoured at all, and that the barrel path
 * derived above is really the module a bundler picks — including the `index.tsx`
 * spelling, which is the one objectui#3943 warns a naive glob would miss.
 */
const falseBarrelProbes: ProbeCase[] = falsePackages.flatMap((pkg) => {
  const barrel = sourceBarrel(pkg);
  if (barrel === undefined) return [];
  const entry = path.relative(path.join(repoRoot, pkg.dir), barrel).split(path.sep).join('/');
  return [{ pkg, name: pkg.name, entry }];
});

/* -------------------------------------------------------------------------- */

describe('`sideEffects` declarations match load-time behaviour (objectui#3943)', () => {
  it('discovers the declaring packages (guard cannot pass by finding nothing)', () => {
    // The hazard here is a SILENT one, so a guard that inspected an empty list
    // would reproduce it exactly: green output, nothing checked. These floors
    // sit at the census re-measured for objectui#6683 — 9 packages declare the
    // field, 5 of them `false` and 2 an array (`components`/`fields` declare
    // `true`) — so a lost workspace root, a broken glob parser or a renamed
    // field is a failure and not a quiet pass.
    expect(declaringPackages.length).toBeGreaterThanOrEqual(7);
    expect(falsePackages.length).toBeGreaterThanOrEqual(5);
    expect(arrayPackages.length).toBeGreaterThanOrEqual(2);

    // The census by name. `components`/`fields` declare `true` and are excluded
    // on purpose: `true` is the conservative claim and can never lose a
    // registration, so it is not falsifiable in the direction that hurts.
    expect(declaringPackages.map((p) => p.name)).toEqual([
      '@object-ui/app-shell',
      '@object-ui/core',
      '@object-ui/i18n',
      '@object-ui/layout',
      '@object-ui/react-runtime',
      '@object-ui/sdui-parser',
      '@object-ui/types',
    ]);

    // The specimen must be in scope BY NAME and still be the array case: if
    // layout drops out, this gate has stopped watching the exact spot that
    // motivated it (objectui#3899 / PR #3940).
    const layout = declaringPackages.find((p) => p.name === '@object-ui/layout');
    expect(layout, '@object-ui/layout must still be scanned').toBeDefined();
    expect(Array.isArray(layout!.declared), '@object-ui/layout must still declare the ARRAY form').toBe(true);
  });

  it('reads every `@object-ui/*` alias table entry in the workspace, whatever its spelling', () => {
    // objectui#5158's assertion, and the one that has to be DERIVED rather than
    // listed. The defect it closes was not a wrong verdict, it was a
    // measurement surface that had quietly stopped covering most of the
    // workspace while every assertion below it stayed green — 70 of 196 entries
    // read, 15 configs contributing zero. A census written out as a literal
    // list is the same failure waiting to happen, so both sides of this
    // reconciliation come out of the scan.
    //
    // The independent side is the KEY census: every `@object-ui/*` key that
    // sits in a `resolve.alias` table, counted without looking at its value.
    // The parsed side additionally has to understand the value. They agree
    // exactly when no spelling escaped — so the gap list IS the reconciliation,
    // and a fourth spelling arriving tomorrow fails here by name instead of
    // shrinking the surface in silence.
    expect(
      aliasParseGaps.map((gap) => `${gap.config}: ${gap.what} — ${gap.text}`),
      [
        'An `@object-ui/*` entry sits in a `resolve.alias` table and this guard could not read it,',
        'so the package it aliases is missing an entry form and is being judged on an incomplete',
        'surface — the exact objectui#5158 defect, in a new spelling.',
        '',
        'Teach `readAliasEntries()` the spelling. Do NOT narrow the table or delete the entry to',
        'make this pass: a surface that shrinks is how this went unnoticed for so long.',
        '',
        ...aliasParseGaps.map((gap) => `  ${gap.config}: ${gap.what} — ${gap.text}`),
      ].join('\n'),
    ).toEqual([]);

    // A floor, not a fossil: it catches the collapse (a broken walk, a renamed
    // field, a parser that stopped matching) without going red every time a
    // package gains an alias. Measured on main@cdac3cc20: 196 entries across 20
    // configs, up from the 70 across 3 that the pre-#5158 regex could see.
    const configs = [...new Set(aliasEntries.map((a) => a.config))].sort();
    expect(aliasEntries.length, 'the alias surface collapsed — see readAliasEntries()').toBeGreaterThanOrEqual(150);
    expect(configs.length, 'the alias surface collapsed to a handful of configs').toBeGreaterThanOrEqual(18);

    // Named specimens of the three spellings #5158 found invisible, so a
    // regression to "only `path.resolve(` after a single-quoted key" fails here
    // with the reason attached rather than as a number that moved.
    expect(configs, 'bare `resolve(` (objectui#5158)').toContain('packages/plugin-editor/vite.config.ts');
    expect(configs, 'the `{ find, replacement }` table form').toContain('packages/components/vite.config.ts');
    expect(configs, 'double-quoted keys').toContain('packages/runner/vite.config.ts');

    // The trap, named: `@object-ui/layout` aliased at `packages/layout/src` is
    // the entry form that made the console's bundle 0 bytes while every
    // published path was declared.
    const layoutAliases = aliasEntries.filter((a) => a.specifier === '@object-ui/layout');
    expect(layoutAliases.map((a) => a.config).sort()).toEqual([
      'apps/console/vite.config.ts',
      'examples/console-starter/vite.config.ts',
    ]);
    for (const alias of layoutAliases) {
      expect(alias.target).toBe(path.join(repoRoot, 'packages/layout/src'));
    }
  });

  it('the three spellings objectui#5158 uncovered each parse to a real target', () => {
    // The widening asserted as CONTENT, not only as a count. Each case is a
    // different reason the pre-#5158 regex read nothing, and each is pinned on
    // an entry that must resolve to a module — so "the config is in the census"
    // cannot pass on an entry that parsed to nonsense.
    const entryFor = (config: string, specifier: string): AliasEntry | undefined =>
      aliasEntries.find((a) => a.config === config && a.specifier === specifier);

    // 1. `import { resolve } from 'path'` — 15 `packages/plugin-*` configs.
    const bare = entryFor('packages/plugin-editor/vite.config.ts', '@object-ui/core');
    expect(bare?.target).toBe(path.join(repoRoot, 'packages/core/src'));

    // 2. The array table form, `alias: [{ find, replacement }]`.
    const arrayForm = entryFor('packages/components/vite.config.ts', '@object-ui/core');
    expect(arrayForm?.target).toBe(path.join(repoRoot, 'packages/core/src'));

    // 3. Double-quoted keys.
    const doubleQuoted = entryFor('packages/runner/vite.config.ts', '@object-ui/core');
    expect(doubleQuoted?.target).toBe(path.join(repoRoot, 'packages/core/src'));

    // And a target spelled as a FILE rather than a directory, which is the one
    // shape where `resolveAliasModule` has to not append `index.*`.
    const file = entryFor('packages/plugin-map/vite.config.ts', '@object-ui/core');
    expect(file?.target).toBe(path.join(repoRoot, 'packages/core/src/index.ts'));
    for (const entry of [bare, arrayForm, doubleQuoted, file]) {
      expect(resolveAliasModule(entry!.target), `${entry!.config}: ${entry!.specifier} resolves to no module`).toBeDefined();
    }
  });

  it('a `globals` map keyed by the same specifiers is not read as an alias table', () => {
    // The false positive the widening had to avoid. Every `plugin-*` library
    // config carries `rollupOptions.output.globals`, keyed by the SAME
    // `@object-ui/*` specifiers and valued with UMD global names, and
    // `packages/plugin-calendar` / `plugin-chatbot` / `plugin-gantt` carry one
    // while their `resolve.alias` table has no `@object-ui/*` entry at all.
    // Those three are therefore the clean control: if a globals map were being
    // read as aliases, they would appear in the census.
    const configs = new Set(aliasEntries.map((a) => a.config));
    for (const config of [
      'packages/plugin-calendar/vite.config.ts',
      'packages/plugin-chatbot/vite.config.ts',
      'packages/plugin-gantt/vite.config.ts',
    ]) {
      expect(fs.readFileSync(path.join(repoRoot, config), 'utf8'), `${config} must still carry the decoy`).toContain(
        "'@object-ui/core': 'ObjectUICore'",
      );
      expect(configs.has(config), `${config}: a \`globals\` map was read as an alias table`).toBe(false);
    }
  });

  it('resolves a directory alias to the real barrel, `.tsx` spelling included', () => {
    // The `.ts`/`.tsx` half of the issue, asserted on the derivation rather
    // than left to the packages that happen to exist. `@object-ui/react-runtime`
    // is the live `.tsx` specimen; a derivation hardcoded to `index.ts` would
    // find nothing for it and silently scan an empty entry graph.
    const runtime = declaringPackages.find((p) => p.name === '@object-ui/react-runtime')!;
    expect(sourceBarrel(runtime)).toBe(path.join(repoRoot, 'packages/react-runtime/src/index.tsx'));

    const core = declaringPackages.find((p) => p.name === '@object-ui/core')!;
    expect(sourceBarrel(core)).toBe(path.join(repoRoot, 'packages/core/src/index.ts'));

    for (const pkg of declaringPackages) {
      expect(sourceBarrel(pkg), `${pkg.name}: no source barrel resolved, so nothing would be scanned`).toBeDefined();
    }
  });

  it('derives every entry form, including the workspace-alias one', () => {
    // The derivation pinned against the three forms PR #3940 measured for the
    // specimen — the ESM and UMD published entries plus the source alias. A
    // derivation that silently produced [] would make the coverage assertions
    // below pass over nothing.
    expect(entryForms.get('@object-ui/layout')).toEqual(['dist/index.js', 'dist/index.umd.cjs', 'src/index.ts']);

    for (const pkg of declaringPackages) {
      const forms = entryForms.get(pkg.name) ?? [];
      expect(forms.length, `${pkg.name}: no entry forms derived`).toBeGreaterThan(0);
      expect(
        forms.some((entry) => isSourceEntry(pkg, entry)),
        `${pkg.name}: no entry form resolves to a file in this tree, so the source side is unverifiable`,
      ).toBe(true);
    }
  });

  it('the entry-graph walk resolves every relative specifier it meets', () => {
    // An unresolved specifier does not fail loudly on its own — it just
    // truncates the reachable set, which SHRINKS the population the scan below
    // examines. That is the quiet way this gate would stop working, so it is
    // reported as its own failure. (The repo spells relative imports ESM-style,
    // `./x.js` naming `./x.ts`; missing that rewrite left 40 of core's modules
    // unreachable while the scan still reported green.)
    const unresolved = [...entryGraphs.entries()].flatMap(([name, graph]) =>
      graph.unresolved.map((u) => `${name}: ${u}`),
    );
    expect(
      unresolved,
      [
        'A relative import could not be resolved, so the module it names was never scanned.',
        'Teach resolveRelative() the spelling — do not leave the reachable set truncated.',
        '',
        ...unresolved,
      ].join('\n'),
    ).toEqual([]);

    // And the walk must actually reach a meaningful number of modules.
    // Measured on main@97da1b0d6: core 87, i18n 25, types 39, sdui-parser 5,
    // react-runtime 1, layout 8.
    const total = [...entryGraphs.values()].reduce((sum, g) => sum + g.modules.length, 0);
    expect(total, 'the entry graphs collapsed to almost nothing — the walk is not walking').toBeGreaterThanOrEqual(150);
  });

  it('no `sideEffects: false` package has a load-time side effect', () => {
    // THE objectui#3899 DIRECTION. A package promising `false` while a module in
    // its entry graph reaches out on evaluation is the lie that bundles to 0
    // bytes with exit code 0.
    const violations = falsePackages.flatMap((pkg) =>
      (entryGraphs.get(pkg.name)?.effects ?? []).map(
        (effect) => `${pkg.name} declares "sideEffects": false, but ${effect.file}:${effect.line} is a ` +
          `${effect.kind}: ${effect.text}`,
      ),
    );

    expect(
      violations,
      [
        'A package promises bundlers that nothing happens when its modules are evaluated, and then',
        'something happens. A bundler takes the promise at its word: the module is dropped whole, the',
        'side effect never runs, and the build is green with no warning (objectui#3899/#3943).',
        '',
        'Fix it in whichever direction is true — never by deleting this finding:',
        '  - the side effect is intended -> declare `sideEffects` as an ARRAY naming every entry form',
        '                                   (see packages/layout/package.json; the array must cover the',
        '                                   workspace-alias `src` form too, not just dist/*)',
        '  - the side effect is a bug    -> move it into an exported function the consumer calls',
        '',
        ...violations,
      ].join('\n'),
    ).toEqual([]);
  });

  it('every `sideEffects` array covers all of its package’s entry forms', () => {
    // PR #3940's assertion, generalised. A form the array does not name may be
    // dropped whole by a bundler resolving the package that way.
    const missing = arrayPackages.flatMap((pkg) => {
      const declared = pkg.declared as string[];
      return (entryForms.get(pkg.name) ?? [])
        .filter((entry) => !declared.includes(entry))
        .map((entry) => `${pkg.name}: "${entry}" is a resolvable module form and is not in \`sideEffects\``);
    });

    expect(
      missing,
      [
        'A module form is not covered by `sideEffects`, so a bundler resolving the package that way may',
        'drop the side effect entirely — silently, on a green build (objectui#3899/#3943).',
        '',
        'Add each path below to that package.json\'s `sideEffects`, spelled with a leading "./" to match',
        'how `exports` spells the same paths. Note the spelling is NOT what a bundler is sensitive to',
        '(measured on vite 8 / rolldown: "./dist/index.js", "dist/index.js" and "dist/*.js" all match the',
        'same file), so a finding here means the path is not covered AT ALL.',
        '',
        ...missing,
      ].join('\n'),
    ).toEqual([]);

    // The other direction. An entry naming nothing real is not harmless: it
    // reads as "this module has side effects" to the next author and makes the
    // list look maintained when it is not.
    const phantom = arrayPackages.flatMap((pkg) => {
      const forms = entryForms.get(pkg.name) ?? [];
      const modules = packageModuleForms(pkg);
      return (pkg.declared as string[])
        .filter((entry) => !forms.includes(entry) && !modules.has(entry))
        .map((entry) => `${pkg.name}: "${entry}" is neither an entry form nor a module of this package`);
    });

    expect(
      phantom,
      [
        '`sideEffects` names a path that is neither a resolvable entry form nor a module in the package’s',
        'entry graph — it points at nothing at all.',
        '',
        'A DEEP module is legitimate here (objectui#6683: `@object-ui/app-shell` names the ten modules that',
        'register SDUI widgets at load time, because those are exactly the ones a bundler must not drop).',
        'What is not legitimate is a path no derivation can find. If a NEW module genuinely has load-time',
        'side effects, make sure the barrel really reaches it; if a new ENTRY form appeared, teach',
        'resolvableEntryPaths() where it comes from (an `exports` subpath, a build output, a bundler alias)',
        'so the derivation stays the authority. Otherwise delete it.',
        '',
        'Whether the set is EXACTLY right — no missing registrar, no stale name — is the separate question',
        '`scripts/check-side-effects-array.mjs` answers by re-deriving it from the module bodies.',
        '',
        ...phantom,
      ].join('\n'),
    ).toEqual([]);
  });

  it('every declared source entry really does have a load-time side effect', () => {
    // The converse claim, and the generalised form of PR #3940's
    // `declaresLoadTimeRegistration`. An array entry is a promise that this
    // module DOES something on evaluation; when that stops being true the
    // honest manifest is `false` again.
    //
    // Only the source entries can be checked statically — `dist/*` is build
    // output, absent in an unbuilt worktree and compiled from the source that
    // IS checked here.
    const phantomClaims = arrayPackages.flatMap((pkg) =>
      (pkg.declared as string[])
        .filter((entry) => isSourceEntry(pkg, entry))
        // A `.css` entry form is a real `sideEffects` surface — a dropped
        // stylesheet import is webpack's classic silent bug — but its effect IS
        // the stylesheet, and running a TypeScript parser over it would report
        // "no top-level side effect" about a file that has no top level.
        .filter((entry) => isParseableModule(entry))
        .filter((entry) => scanModule(path.join(repoRoot, pkg.dir, entry)).effects.length === 0)
        .map((entry) => `${pkg.name}: "${entry}" is declared in \`sideEffects\` but has no top-level side effect`),
    );

    expect(
      phantomClaims,
      [
        'A `sideEffects` array names a module that does nothing when it is evaluated.',
        '',
        'This test does NOT ask for the side effect back. It asks the two halves to agree: if a load-time',
        'registration became an explicit API the consumer calls (the direction objectui#3899 left to the',
        'maintainer), then the honest manifest is `sideEffects: false` and the entry should go with it.',
        'What is forbidden is exactly one of the two moving.',
        '',
        ...phantomClaims,
      ].join('\n'),
    ).toEqual([]);

    // Anti-vacuity: the loop must have something to walk. The specimen's
    // `src/index.ts` is the one source entry any array declares today, and its
    // `try { registerLayout(); } catch {}` is the effect being detected.
    const sourceEntries = arrayPackages.flatMap((pkg) =>
      (pkg.declared as string[])
        .filter((entry) => isSourceEntry(pkg, entry) && isParseableModule(entry))
        .map((entry) => `${pkg.name}/${entry}`),
    );
    expect(sourceEntries).toContain('@object-ui/layout/src/index.ts');
    // objectui#6683's specimen: a DEEP module, not an entry form. Its presence
    // is what makes the loop above cover the general case rather than one
    // barrel, and it is one of the three registrations the 2026-08-29 ruling
    // names as controls.
    expect(sourceEntries).toContain('@object-ui/app-shell/src/console/connect/ConnectAgentWidget.tsx');
  });

  it('no array package declares a wildcard entry (this guard resolves literal paths)', () => {
    // `exports` may use `*` patterns and `@object-ui/i18n` does (`./locales/*`).
    // A pattern resolves to no single file, so it is dropped from the derived
    // forms — harmless while only `false` packages have one, and a false
    // "phantom" report the day an array package grows one. Naming it as its own
    // failure means the next author gets "teach the guard" instead of a baffling
    // verdict on a path they know is fine.
    const wildcards = arrayPackages.flatMap((pkg) =>
      (pkg.declared as string[])
        .filter((entry) => entry.includes('*'))
        .map((entry) => `${pkg.name}: "${entry}"`),
    );
    expect(
      wildcards,
      ['A `sideEffects` array entry uses a glob, which this guard does not expand.', ...wildcards].join('\n'),
    ).toEqual([]);
  });
});

/**
 * The probes. Everything above is static: it reads manifests and parses source.
 * None of it can answer the question the whole hazard turns on — does the
 * declaration actually change what a bundler emits?
 *
 * Each probe therefore comes in a PAIR: the real declaration must keep the
 * module, and `sideEffects: false` must drop the identical mirror. Without the
 * control every positive probe could be green because the bundler never shakes
 * anything here, which is the exact shape of "green for an empty reason"
 * (PR #3940 wrote this discipline down; this is it applied per package).
 */
describe('a real bundler honours the declarations (objectui#3943)', () => {
  it('has probes to run (the pairs below cannot pass by being empty)', () => {
    // `it.each([])` is a collection-time error rather than a failure, so the
    // populations are asserted here where the message can say why.
    expect(arrayEntryProbes.length, 'no array entry forms to probe').toBeGreaterThanOrEqual(3);
    expect(falseBarrelProbes.length, 'no `sideEffects: false` barrels to probe').toBeGreaterThanOrEqual(5);
  });

  it.each(arrayEntryProbes)('$name declares $entry, so a side-effect-only import keeps it', async ({ pkg, entry }) => {
    const mirror = mirrorPackage(pkg, pkg.manifest.sideEffects, [entry]);
    try {
      const code = await bundleSideEffectOnlyImport(path.join(mirror, entry));
      expect(
        code,
        `The declared \`sideEffects\` of ${pkg.name} do not cover ${entry}, so a consumer resolving the ` +
          'package that way loses whatever that module does on evaluation. Add the path — this is not a ' +
          'spelling nit: rolldown matches it with or without the leading "./", and through `dist/*.js` too.',
      ).toContain(MARKER);
    } finally {
      rmSync(mirror, { recursive: true, force: true });
    }
  });

  it.each(arrayEntryProbes)('and the declaration is what keeps it: `false` drops $name $entry', async ({ pkg, entry }) => {
    const mirror = mirrorPackage(pkg, false, [entry]);
    try {
      const code = await bundleSideEffectOnlyImport(path.join(mirror, entry));
      expect(
        code,
        `A package declaring \`sideEffects: false\` did NOT lose ${entry} on a side-effect-only import. ` +
          'The bundler no longer honours the flag the way these probes assume, so every assertion above ' +
          'has stopped measuring anything — fix the probe before trusting it again.',
      ).not.toContain(MARKER);
    } finally {
      rmSync(mirror, { recursive: true, force: true });
    }
  });

  it.each(falseBarrelProbes)('$name: $entry is the module a bundler resolves the alias to', async ({ pkg, entry }) => {
    // The derivation's own probe. Aliasing to the DIRECTORY (which is how
    // apps/console and examples/console-starter spell it) and declaring only
    // this one path means the marker survives if — and only if — the bundler
    // picks exactly the barrel this gate scanned. A `.tsx` barrel that the
    // derivation had guessed as `.ts` fails right here instead of leaving an
    // empty scan reported as green.
    const mirror = mirrorPackage(pkg, [`./${entry}`], [entry]);
    try {
      const code = await bundleSideEffectOnlyImport(path.dirname(path.join(mirror, entry)));
      expect(
        code,
        `Aliasing ${pkg.name} at its source directory did not resolve to ${entry}, the module this gate ` +
          'statically scans. The scan and the bundler disagree about which file the barrel is, so the ' +
          'scan is guarding a module nobody loads.',
      ).toContain(MARKER);
    } finally {
      rmSync(mirror, { recursive: true, force: true });
    }
  });

  it.each(falseBarrelProbes)('$name: `sideEffects: false` drops $entry, which is why the scan matters', async ({ pkg, entry }) => {
    // The control that gives the static scan its teeth: it measures that a
    // `false` declaration really does license a bundler to drop this package's
    // barrel. If it ever stops being true, the scan above is guarding against a
    // consequence that no longer follows.
    const mirror = mirrorPackage(pkg, false, [entry]);
    try {
      const code = await bundleSideEffectOnlyImport(path.dirname(path.join(mirror, entry)));
      expect(
        code,
        `${pkg.name} declares \`sideEffects: false\`, but a side-effect-only import of its barrel KEPT the ` +
          'module. Either the bundler stopped honouring the field or this probe stopped resolving — until ' +
          'that is fixed, "no load-time side effect" is an unenforced claim here.',
      ).not.toContain(MARKER);
    } finally {
      rmSync(mirror, { recursive: true, force: true });
    }
  });
});

/**
 * The objectui#3899 specimen, converged here from
 * `packages/layout/src/__tests__/side-effects-manifest.test.ts` (PR #3940).
 *
 * Everything else in that file is now derived above and applies to every
 * package: the entry-form derivation, the array coverage in both directions,
 * the "the declaration is what keeps it" controls, and the
 * `declaresLoadTimeRegistration` invariant (generalised as "a declared source
 * entry really does have a load-time side effect").
 *
 * What could NOT be generalised is this: the marker probes prove that SOME
 * module survives at each declared path, but layout's actual payload is a set
 * of registry keys, and only a bundle of the REAL source can show those
 * specific keys surviving. That is the assertion objectui#3787 needed and the
 * one OBJUI-001 reports the absence of, so it is carried over verbatim rather
 * than folded into a marker.
 */
describe('objectui#3899 specimen: @object-ui/layout registers through the source alias', () => {
  const layout = declaringPackages.find((p) => p.name === '@object-ui/layout')!;
  const layoutSrc = path.join(repoRoot, 'packages/layout/src');

  it('keeps a side-effect-only import alive through the workspace source alias', async () => {
    // The in-place, real-tree probe: the actual src/, read through the actual
    // manifest, in the shape apps/console and examples/console-starter bundle.
    const code = await bundleSideEffectOnlyImport(layoutSrc);

    expect(
      code,
      'Bundling `import "@object-ui/layout";` through the workspace src alias dropped the component ' +
        'registrations. This is objectui#3899 exactly: a bundler took the manifest at its word. Check ' +
        'that `sideEffects` names "./src/index.ts".',
      // `app-schema-renderer` since objectui#11441 retired `responsive-grid`,
      // which stood in after objectui#10859 batch 8 retired `page-header`.
    ).toContain('app-schema-renderer');

    // Every key the barrel registers, so losing all but one cannot pass on the
    // strength of that one. Read out of the source rather than listed here:
    // objectui#3899's own prose named a `sidebar-nav` key that this package has
    // never registered, and a hardcoded list is how that kind of mistake becomes
    // a test asserting a component that does not exist. (`SidebarNav` reaches
    // the registry under NO key at all — it is consumed as a plain React
    // component in JSX, corrected in objectui#3999.)
    //
    // The read is `scripts/component-registrations.mjs` (objectui#4894), shared
    // with the three pins in `packages/layout/src/__tests__/`. It replaced four
    // copies of a regex that accepted a single-quoted key and nothing else, and
    // this file was the copy whose failure was SILENT: see the census note below.
    const registrations = readComponentRegistrations(
      fs.readFileSync(path.join(layoutSrc, 'index.ts'), 'utf8'),
      'packages/layout/src/index.ts',
    );
    const registeredKeys = registrations.keys;

    // A CENSUS, not a floor — and this is the half of objectui#4894 that widening
    // a regex does not fix.
    //
    // This assertion read `toBeGreaterThanOrEqual(5)`, and its own comment said
    // "a floor, not a census". A floor cannot see a key that is MISSING FROM THE
    // READ: "five single-quoted calls plus one double-quoted call" satisfied it,
    // so the sixth key's "survives the side-effect-only bundle" assertion simply
    // never ran, and nothing anywhere went red. Of the four pins on this key
    // list, this was the one that failed in silence — the two doc-parity pins at
    // least reddened (with a backwards message), and the `app-shell` pin has a
    // live-registry second line of defence.
    //
    // An exact LITERAL was the other candidate and is worse: it read `6` until
    // objectui#4841 deregistered `app-shell`, and a number kept here reds on every
    // legitimate registration added — which is how an exact count gets loosened
    // back to a floor by the next person who adds a key. So the count is exact and
    // DERIVED: every `ComponentRegistry.register` call the reader saw in code has
    // to have yielded a key it could read. Add a key and it still holds; write one
    // in a form the reader cannot see and it does not.
    //
    // The shared reader refuses a partial read at source — it throws rather than
    // returning a short list — so on today's tree this line cannot be the thing
    // that reddens first. It is stated here anyway, because it is the fact THIS
    // loop depends on, and it is what still holds the loop honest if that refusal
    // is ever relaxed. The keys themselves are pinned by name in
    // `packages/layout/src/__tests__/guide-layout-sidebar-nav-doc.test.ts`.
    expect(
      registeredKeys.length,
      `src/index.ts has ${registrations.calls} \`ComponentRegistry.register\` call(s) but only ` +
        `${registeredKeys.length} readable key(s), so the loop below would skip one in silence. ` +
        'Unreadable: ' +
        (registrations.unreadable.map((c: { line: number }) => `line ${c.line}`).join(', ') || 'none'),
    ).toBe(registrations.calls);

    for (const key of registeredKeys) {
      expect(code, `the \`${key}\` registration must survive a side-effect-only import`).toContain(key);
    }
  });

  it('and the same control holds for the source tree', async () => {
    const mirrored = mirrorSourceTree(layout, false);
    try {
      const code = await bundleSideEffectOnlyImport(mirrored);
      expect(
        code,
        'A copy of this package declaring `sideEffects: false` kept its registrations, so the source-alias ' +
          'probe above is not measuring the manifest at all.',
      ).not.toContain('app-schema-renderer');
    } finally {
      rmSync(path.resolve(mirrored, '..'), { recursive: true, force: true });
    }
  });
});
