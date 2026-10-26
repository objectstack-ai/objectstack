#!/usr/bin/env node
/**
 * Every non-test source file in a COVERED package must be reachable from that
 * package's published entry, or be named directly by its build config.
 *
 * Run:  node scripts/check-unreferenced-sources.mjs   (also `pnpm check:unreferenced-sources`)
 * Exit: 0 = every covered package's sources are reachable, 1 = at least one is
 *       not, or the coverage table has gone stale, or a build config grew a
 *       shape this gate cannot evaluate
 *
 * ## The gap this closes (objectui#7515)
 *
 * Before this file, none of the 42 `scripts/check-*.mjs` gates could see an
 * unreferenced source file. The nearest neighbours each answer a DIFFERENT
 * question and none of them is this one:
 *
 *   - `check-dist-completeness` asks whether `dist/` holds every file `tsc`
 *     says it emits — a question about the artifact, downstream of the graph;
 *   - `check-readme-exports` compares DOCUMENTED exports against shipped ones —
 *     a file that exports nothing anybody ships is invisible to it;
 *   - `check-i18n-dead-keys` covers message keys, not modules.
 *
 * So a `.tsx` that nothing imports and nothing exports sits in a PUBLISHED
 * package indefinitely, and the detection mechanism is a human happening to
 * read unrelated code. That is not a hypothetical: objectui#7319 and
 * objectui#7397 were both found exactly that way, in the same week.
 *
 * ## Why an orphan is worth a gate rather than a tidy-up
 *
 * An orphan file is cheap. An orphan file WEARING A LIVE NAME is a trap. The
 * file objectui#7319 removed carried the same export name as a live engine one
 * package over and evaluated no predicate — name-completion alone could have
 * wired a silently wrong renderer into a published package. The cost of the
 * class is not the bytes; it is that the dead copy is indistinguishable from
 * the live one at the call site.
 *
 * ## The alias leg is not optional, and it is the whole difficulty
 *
 * A plain import-graph walk over `packages/components` reports THREE unreached
 * files, and two of them are alive:
 *
 *   packages/components/src/lib/use-sync-external-store-shim.ts
 *   packages/components/src/lib/use-sync-external-store-with-selector-shim.ts
 *
 * Nothing in the package imports either one. They are reached because
 * `packages/components/vite.config.ts` names them as `resolve.alias`
 * REPLACEMENTS:
 *
 *     { find: /^use-sync-external-store\/shim(\.js)?$/,
 *       replacement: resolve(__dirname, 'src/lib/use-sync-external-store-shim.ts') }
 *
 * The importer is a bundled third-party module, and the edge exists only inside
 * the bundler's resolver — an import-graph walk cannot see it from any source
 * file in the repository. A gate that skips this leg reports those two live
 * files as dead on its FIRST RUN, and a gate that cries wolf on live files gets
 * switched off rather than fixed.
 *
 * So reachability here has two roots, not one:
 *
 *   1. the package's published ENTRY (`build.lib.entry`), walked transitively;
 *   2. every build-config ALIAS whose replacement is a FILE inside the package
 *      — the bundler names it, so something can reach it by that name — also
 *      walked transitively.
 *
 * An alias whose replacement is a DIRECTORY (`{ find: '@', replacement:
 * resolve(__dirname, './src') }`) is not a root: it is a RESOLUTION RULE, used
 * while walking to turn `@/ui/button` into a file. Both kinds are read from the
 * same array, and the distinction is made by asking the filesystem which one it
 * is rather than by pattern-matching the spelling.
 *
 * ## What this gate refuses to guess
 *
 * Every alias and entry expression is evaluated by {@link evaluatePath}, which
 * understands exactly `resolve(...)`/`join(...)` over `__dirname` and string
 * literals. Anything else is a FINDING, never a skip. That direction is
 * deliberate and it is the only one that stays safe: an alias this gate cannot
 * read is an alias whose target it will report as dead, so the choice is
 * between failing loudly on the config and accusing a live file. The same rule
 * covers a missing entry and a missing package.
 *
 * ## Scope: covered packages are DECLARED, and the remainder is MEASURED
 *
 * {@link COVERED_PACKAGES} is small on purpose. A gate that covers one package
 * correctly beats one that covers forty with false positives, and the alias
 * mechanisms differ per package — other build configs, tsconfig `paths`,
 * re-export barrels. Every run therefore prints how many workspace packages
 * with a `src/` tree are NOT covered, DERIVED from the workspace rather than
 * written down, so the remainder cannot rot into a stale claim.
 *
 * Adding a package is a deliberate act with a verification cost: read its build
 * config, confirm this gate evaluates every alias in it, and confirm the run is
 * green for the right reason rather than because the walk collapsed.
 *
 * ## Two things this gate does NOT claim
 *
 * **It does not prove an alias is USED.** An alias entry pointing at a file
 * nobody imports makes that file reachable here, because the build config
 * names it. Deciding whether a bundled dependency still imports
 * `use-sync-external-store/shim` means walking `node_modules`, which is a
 * different gate on a different input.
 *
 * **`reachable from the entry` is not `referenced by anything`.** A helper used
 * only by tests is unreachable from the published entry and IS reported — it is
 * dead weight in the published artifact even though it has importers. The
 * finding says so explicitly (`referenced only by test files`) so the reader
 * can tell the two apart instead of guessing. `packages/components` has no such
 * file today; the count is printed on every run.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { SKIP_DIRS, TOOLING_FILE, listSourceFiles, moduleSpecifiers } from './check-phantom-dependencies.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));

/** Workspace directories that hold one package per subdirectory. */
export const PACKAGE_ROOTS = ['packages', 'apps'];

/**
 * The `find` half of an alias, as a value. A regex `find` matches a specifier
 * whole; a string `find` is a PREFIX, which is what makes `'@'` resolve
 * `@/ui/button`.
 *
 * @typedef {{ kind: 'string', value: string, text: string }
 *         | { kind: 'regex', source: string, flags: string, text: string }} AliasFind
 * @typedef {{ find: AliasFind, replacement: string }} Alias
 * @typedef {Alias & { file: string }} AliasRoot
 * @typedef {{ reason: string, pkg?: string, file?: string, detail?: string, testImporters?: string[] }} Finding
 */

/**
 * The packages this gate has been VERIFIED against, and why each one is here.
 *
 * `buildConfig` is the file the entry and the aliases are read from. `notes`
 * records what was checked by hand when the package was added — an entry
 * without one is an unreviewable claim, so {@link auditCoverage} rejects it.
 *
 * @type {Record<string, { buildConfig: string, notes: string }>}
 */
export const COVERED_PACKAGES = {
  'packages/components': {
    buildConfig: 'vite.config.ts',
    notes:
      'objectui#7515. Entry `src/index.ts` from `build.lib.entry`. Ten `resolve.alias` entries: ' +
      'one directory alias inside the package (`@` -> `./src`, matching its tsconfig `paths`), six ' +
      'pointing at sibling packages (outside this population), and three regex aliases naming the two ' +
      '`use-sync-external-store` shims, which no source file imports and which are alive only through ' +
      'this config.',
  },
};

/** Extensions tried, in order, when a specifier names no extension of its own. */
export const RESOLVE_ORDER = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Turn a module specifier's target path into the file it actually names.
 *
 * Handles the three spellings a TypeScript source uses: the exact path, the
 * extensionless path, and the directory whose `index.*` is meant. The `.js`
 * rewrite is the fourth — a specifier written `./x.js` against `x.ts` on disk,
 * which `moduleResolution: bundler` and every bundler here accept.
 *
 * @param {string} target absolute, extension optional
 * @returns {string | null}
 */
export function resolveTarget(target) {
  const isFile = (candidate) => existsSync(candidate) && statSync(candidate).isFile();
  if (isFile(target)) return target;
  for (const ext of RESOLVE_ORDER) if (isFile(target + ext)) return target + ext;
  for (const ext of RESOLVE_ORDER) if (isFile(join(target, `index${ext}`))) return join(target, `index${ext}`);
  const withoutJs = target.match(/^(.*)\.([cm]?js)x?$/);
  if (withoutJs) {
    for (const ext of RESOLVE_ORDER) if (isFile(withoutJs[1] + ext)) return withoutJs[1] + ext;
  }
  return null;
}

// ── reading the build config ─────────────────────────────────────────────────

/**
 * Evaluate a path expression from a build config, or refuse to.
 *
 * The grammar is deliberately tiny — `resolve(...)` / `join(...)` (bare or on
 * `path`) over `__dirname` and string literals, plus a bare string literal.
 * Everything else returns `null`, and every caller turns a `null` into a
 * FINDING rather than a skip: see the module header for why that direction is
 * the only safe one.
 *
 * @param {ts.Node} node
 * @param {string} packageDir absolute; what `__dirname` means in this config
 * @returns {string | null} an absolute path, or null when the shape is unknown
 */
export function evaluatePath(node, packageDir) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isIdentifier(node) && node.text === '__dirname') return packageDir;
  if (ts.isCallExpression(node)) {
    const callee = ts.isPropertyAccessExpression(node.expression)
      ? node.expression.name.text
      : ts.isIdentifier(node.expression)
        ? node.expression.text
        : null;
    if (callee !== 'resolve' && callee !== 'join') return null;
    const parts = [];
    for (const argument of node.arguments) {
      const value = evaluatePath(argument, packageDir);
      if (value === null) return null;
      parts.push(value);
    }
    if (parts.length === 0) return null;
    return callee === 'resolve' ? resolve(...parts) : join(...parts);
  }
  return null;
}

/** The object literal a `defineConfig({...})` or a bare `{...}` default export carries. */
function defaultExportObject(source) {
  let found = null;
  const visit = (node) => {
    if (found) return;
    if (ts.isExportAssignment(node)) {
      let expression = node.expression;
      if (ts.isCallExpression(expression) && expression.arguments.length > 0) [expression] = expression.arguments;
      if (ts.isObjectLiteralExpression(expression)) found = expression;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** The initializer of `name` on an object literal, or null. */
function propertyOf(object, name) {
  if (!object || !ts.isObjectLiteralExpression(object)) return null;
  for (const member of object.properties) {
    if (!ts.isPropertyAssignment(member)) continue;
    const key = ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) ? member.name.text : null;
    if (key === name) return member.initializer;
  }
  return null;
}

/**
 * The `find` half of an alias entry, as a VALUE rather than as source text.
 *
 * Read structurally because the text is not parseable as JSON: TypeScript
 * sources spell strings with single quotes, and the first version of this file
 * stored `findNode.getText()` and then tried `JSON.parse` on it. That failed on
 * every single-quoted alias in the repository and made
 * {@link auditAliasMechanisms} report `packages/components`' own `@` alias as
 * unmodelled — a false alarm on the one package this gate covers, caught on the
 * first run (objectui#7515).
 *
 * @param {ts.Node} node
 * @param {ts.SourceFile} source
 * @returns {{ kind: 'string', value: string, text: string } | { kind: 'regex', source: string, flags: string, text: string } | null}
 */
export function readFind(node, source) {
  const text = node.getText(source);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return { kind: 'string', value: node.text, text };
  }
  if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
    const match = text.match(/^\/(.*)\/([a-z]*)$/s);
    if (!match) return null;
    return { kind: 'regex', source: match[1], flags: match[2], text };
  }
  return null;
}

/**
 * One package's declared entry and alias table, read from its build config.
 *
 * Returns `problems` alongside the data: an alias whose `replacement` this
 * parser cannot evaluate, or a missing/unreadable entry. Callers report those;
 * nothing here decides.
 *
 * @param {string} packageDir absolute
 * @param {string} configName e.g. `vite.config.ts`
 * @returns {{ entries: string[], aliases: Alias[], problems: Finding[] }}
 */
export function readBuildConfig(packageDir, configName) {
  /** @type {Finding[]} */
  const problems = [];
  const configPath = join(packageDir, configName);
  if (!existsSync(configPath)) {
    return { entries: [], aliases: [], problems: [{ reason: 'missing-build-config', detail: configName }] };
  }
  const source = ts.createSourceFile(
    configName,
    readFileSync(configPath, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    ts.ScriptKind.TS,
  );
  const config = defaultExportObject(source);
  if (!config) {
    return {
      entries: [],
      aliases: [],
      problems: [{ reason: 'unreadable-build-config', detail: `${configName}: no default-exported object literal` }],
    };
  }

  // ── entry ──
  const entries = [];
  const entryNode = propertyOf(propertyOf(propertyOf(config, 'build'), 'lib'), 'entry');
  if (!entryNode) {
    problems.push({ reason: 'no-entry', detail: `${configName}: build.lib.entry is absent` });
  } else {
    const nodes = ts.isArrayLiteralExpression(entryNode)
      ? [...entryNode.elements]
      : ts.isObjectLiteralExpression(entryNode)
        ? entryNode.properties.filter(ts.isPropertyAssignment).map((p) => p.initializer)
        : [entryNode];
    for (const node of nodes) {
      const value = evaluatePath(node, packageDir);
      if (value === null) {
        problems.push({ reason: 'unevaluatable-entry', detail: `${configName}: ${node.getText(source)}` });
        continue;
      }
      const file = resolveTarget(resolve(packageDir, value));
      if (!file) {
        problems.push({ reason: 'entry-not-on-disk', detail: `${configName}: ${value}` });
        continue;
      }
      entries.push(file);
    }
  }

  // ── aliases ──
  const aliases = [];
  const aliasNode = propertyOf(propertyOf(config, 'resolve'), 'alias');
  if (aliasNode && ts.isArrayLiteralExpression(aliasNode)) {
    for (const element of aliasNode.elements) {
      if (!ts.isObjectLiteralExpression(element)) {
        problems.push({ reason: 'unevaluatable-alias', detail: `${configName}: ${element.getText(source)}` });
        continue;
      }
      const findNode = propertyOf(element, 'find');
      const replacementNode = propertyOf(element, 'replacement');
      if (!findNode || !replacementNode) {
        problems.push({ reason: 'unevaluatable-alias', detail: `${configName}: ${element.getText(source)}` });
        continue;
      }
      const replacement = evaluatePath(replacementNode, packageDir);
      const find = readFind(findNode, source);
      if (replacement === null || find === null) {
        const offender = replacement === null ? replacementNode : findNode;
        problems.push({ reason: 'unevaluatable-alias', detail: `${configName}: ${offender.getText(source)}` });
        continue;
      }
      aliases.push({ find, replacement: resolve(packageDir, replacement) });
    }
  } else if (aliasNode && ts.isObjectLiteralExpression(aliasNode)) {
    for (const member of aliasNode.properties) {
      if (!ts.isPropertyAssignment(member)) {
        problems.push({ reason: 'unevaluatable-alias', detail: `${configName}: ${member.getText(source)}` });
        continue;
      }
      const name = ts.isIdentifier(member.name) || ts.isStringLiteral(member.name) ? member.name.text : null;
      const replacement = evaluatePath(member.initializer, packageDir);
      if (name === null || replacement === null) {
        problems.push({ reason: 'unevaluatable-alias', detail: `${configName}: ${member.getText(source)}` });
        continue;
      }
      aliases.push({ find: { kind: 'string', value: name, text: name }, replacement: resolve(packageDir, replacement) });
    }
  } else if (aliasNode) {
    problems.push({ reason: 'unevaluatable-alias', detail: `${configName}: resolve.alias is neither array nor object` });
  }

  return { entries, aliases, problems };
}

/**
 * Split an alias table into the two roles the header describes.
 *
 * A replacement that IS a file on disk is a ROOT: the bundler names that module
 * by that alias, so something outside the source graph can reach it. A
 * replacement that is a DIRECTORY is a RESOLUTION RULE, applied to specifiers
 * during the walk. The filesystem decides, not the spelling.
 *
 * Aliases pointing outside `srcDir` are neither — they belong to another
 * package's population.
 *
 * @param {Alias[]} aliases
 * @param {string} srcDir absolute
 * @returns {{ roots: AliasRoot[], rules: Alias[], outside: Alias[] }}
 */
export function classifyAliases(aliases, srcDir) {
  /** @type {AliasRoot[]} */
  const roots = [];
  /** @type {Alias[]} */
  const rules = [];
  /** @type {Alias[]} */
  const outside = [];
  for (const alias of aliases) {
    const inside = alias.replacement === srcDir || alias.replacement.startsWith(srcDir + sep);
    if (!inside) {
      outside.push(alias);
      continue;
    }
    if (existsSync(alias.replacement) && statSync(alias.replacement).isDirectory()) {
      rules.push(alias);
      continue;
    }
    const file = resolveTarget(alias.replacement);
    if (file) roots.push({ ...alias, file });
    else outside.push(alias);
  }
  return { roots, rules, outside };
}

/**
 * A bare-specifier alias rule applied to a specifier, or null.
 *
 * Vite's string `find` is a PREFIX match with a literal replacement of that
 * prefix, which is what makes `{ find: '@' }` resolve `@/ui/button`. The
 * `find` text arrives here as it was written in the config, so a regex literal
 * stays a regex and a quoted string stays a string.
 *
 * @param {Alias} rule
 * @param {string} specifier
 * @returns {string | null} absolute path, extension optional
 */
export function applyAliasRule(rule, specifier) {
  if (rule.find.kind === 'regex') {
    let pattern;
    try {
      pattern = new RegExp(rule.find.source, rule.find.flags);
    } catch {
      return null;
    }
    return pattern.test(specifier) ? rule.replacement : null;
  }
  if (!specifier.startsWith(rule.find.value)) return null;
  return rule.replacement + specifier.slice(rule.find.value.length);
}

// ── the walk ─────────────────────────────────────────────────────────────────

/**
 * Every file reachable from `roots`, following relative and alias specifiers.
 *
 * Bare specifiers that no alias rule matches are external and stop the walk;
 * that is the whole reason the alias table is read at all.
 *
 * @param {string[]} roots absolute file paths
 * @param {{ srcDir: string, rules: Alias[] }} options
 * @returns {{ reached: Set<string>, specifiers: number }}
 */
export function walkFrom(roots, { srcDir, rules }) {
  const reached = new Set();
  const queue = [...roots];
  let specifiers = 0;
  while (queue.length > 0) {
    const file = queue.pop();
    if (reached.has(file)) continue;
    reached.add(file);
    const inPackage = file === srcDir || file.startsWith(srcDir + sep);
    if (!inPackage) continue; // a sibling package's file: counted as reached, not walked
    const text = readFileSync(file, 'utf8');
    if (!/\b(?:import|export|require)\b/.test(text)) continue;
    for (const use of moduleSpecifiers(text, file)) {
      specifiers += 1;
      const { specifier } = use;
      let target = null;
      if (specifier.startsWith('.')) target = resolve(dirname(file), specifier);
      else {
        for (const rule of rules) {
          const applied = applyAliasRule(rule, specifier);
          if (applied !== null) {
            target = applied;
            break;
          }
        }
      }
      if (target === null) continue;
      const resolved = resolveTarget(target);
      if (resolved) queue.push(resolved);
    }
  }
  return { reached, specifiers };
}

// ── the judgement ────────────────────────────────────────────────────────────

/** Files that ship: every source under `src/` that is not tooling and not a declaration. */
export function population(srcDir) {
  return listSourceFiles(srcDir).filter((file) => !TOOLING_FILE.test(file.split('\\').join('/')));
}

/** Test files under `src/`, used only to describe a finding, never to judge one. */
export function toolingFiles(srcDir) {
  /** @type {string[]} */
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (TOOLING_FILE.test(full.split('\\').join('/')) && /\.[cm]?[jt]sx?$/.test(entry.name)) found.push(full);
    }
  };
  walk(srcDir);
  return found;
}

/**
 * One covered package's verdict.
 *
 * @param {string} root repository root, absolute
 * @param {string} pkgPath e.g. `packages/components`
 * @param {{ buildConfig: string, notes: string }} coverage
 */
export function auditPackage(root, pkgPath, coverage) {
  const packageDir = join(root, pkgPath);
  const srcDir = join(packageDir, 'src');
  const rel = (file) => relative(root, file).split('\\').join('/');

  const { entries, aliases, problems } = readBuildConfig(packageDir, coverage.buildConfig);
  /** @type {Finding[]} */
  const findings = problems.map((problem) => ({ ...problem, pkg: pkgPath }));

  const { roots: aliasRoots, rules, outside } = classifyAliases(aliases, srcDir);
  const roots = [...entries, ...aliasRoots.map((alias) => alias.file)];
  const files = population(srcDir);

  if (roots.length === 0) {
    findings.push({
      reason: 'no-roots',
      pkg: pkgPath,
      detail: `${coverage.buildConfig} yielded no entry and no in-package alias target — every source file would read as unreachable`,
    });
    return {
      findings,
      counters: { files: files.length, reached: 0, specifiers: 0, entries: entries.length, aliasRoots: 0, rules: 0, outside: outside.length },
    };
  }

  const { reached, specifiers } = walkFrom(roots, { srcDir, rules });
  const unreached = files.filter((file) => !reached.has(file));

  // Only to DESCRIBE a finding: a file with test importers is dead weight in the
  // artifact all the same, but the reader should not have to work out which kind
  // of dead it is.
  const testImporters = new Map();
  if (unreached.length > 0) {
    const wanted = new Set(unreached);
    for (const test of toolingFiles(srcDir)) {
      const text = readFileSync(test, 'utf8');
      if (!/\b(?:import|export|require)\b/.test(text)) continue;
      for (const use of moduleSpecifiers(text, test)) {
        let target = null;
        if (use.specifier.startsWith('.')) target = resolve(dirname(test), use.specifier);
        else {
          for (const rule of rules) {
            const applied = applyAliasRule(rule, use.specifier);
            if (applied !== null) {
              target = applied;
              break;
            }
          }
        }
        if (target === null) continue;
        const resolved = resolveTarget(target);
        if (resolved && wanted.has(resolved)) {
          if (!testImporters.has(resolved)) testImporters.set(resolved, []);
          testImporters.get(resolved).push(rel(test));
        }
      }
    }
  }

  for (const file of unreached) {
    findings.push({
      reason: 'unreferenced-source',
      pkg: pkgPath,
      file: rel(file),
      testImporters: (testImporters.get(file) ?? []).sort(),
    });
  }

  return {
    findings,
    counters: {
      files: files.length,
      reached: files.filter((file) => reached.has(file)).length,
      specifiers,
      entries: entries.length,
      aliasRoots: aliasRoots.length,
      rules: rules.length,
      outside: outside.length,
    },
  };
}

/**
 * Coverage-table entries that no longer describe the repository.
 *
 * A covered package that has moved, lost its `src/` tree or lost its build
 * config leaves this gate quietly checking nothing — the silent-widening
 * direction every sibling gate here treats as worse than a red run.
 */
export function auditCoverage(root, covered = COVERED_PACKAGES) {
  /** @type {Finding[]} */
  const findings = [];
  for (const [pkgPath, entry] of Object.entries(covered)) {
    if (!existsSync(join(root, pkgPath, 'src'))) {
      findings.push({ reason: 'stale-coverage', pkg: pkgPath, detail: 'no src/ directory' });
      continue;
    }
    if (!existsSync(join(root, pkgPath, entry.buildConfig))) {
      findings.push({ reason: 'stale-coverage', pkg: pkgPath, detail: `${entry.buildConfig} is gone` });
    }
    if (!entry.notes || entry.notes.trim().length === 0) {
      findings.push({ reason: 'stale-coverage', pkg: pkgPath, detail: 'no notes — an unreviewable coverage claim' });
    }
  }
  return findings;
}

/**
 * A covered package must not carry an alias mechanism this gate does not read.
 *
 * `packages/components` declares its `@` alias TWICE — once in `vite.config.ts`
 * for the bundler, once in `tsconfig.json` `paths` for the type program — and
 * this gate reads only the first. That is sound exactly as long as the second
 * says nothing the first does not, so the claim is re-derived here on every run
 * instead of being asserted in a comment. A `paths` key with no matching alias
 * is a resolution route the walk would miss.
 */
export function auditAliasMechanisms(root, pkgPath, aliases) {
  /** @type {Finding[]} */
  const findings = [];
  const tsconfigPath = join(root, pkgPath, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) return findings;
  let paths;
  try {
    // Comment-tolerant: these tsconfigs carry `//` commentary.
    const parsed = ts.parseConfigFileTextToJson(tsconfigPath, readFileSync(tsconfigPath, 'utf8'));
    paths = parsed.config?.compilerOptions?.paths;
  } catch {
    return [{ reason: 'unreadable-tsconfig', pkg: pkgPath, detail: 'tsconfig.json could not be parsed' }];
  }
  if (!paths) return findings;
  const aliasFinds = new Set(
    aliases.filter((alias) => alias.find.kind === 'string').map((alias) => alias.find.value),
  );
  for (const key of Object.keys(paths)) {
    const stem = key.endsWith('/*') ? key.slice(0, -2) : key;
    if (!aliasFinds.has(stem) && !aliasFinds.has(key)) {
      findings.push({
        reason: 'unmodelled-alias-mechanism',
        pkg: pkgPath,
        detail: `tsconfig.json paths declares '${key}', which ${pkgPath}'s build config does not`,
      });
    }
  }
  return findings;
}

/**
 * Workspace packages with a `src/` tree that this gate does NOT cover.
 *
 * Derived every run. The remainder is the honest half of a scoped gate, and a
 * written-down number would be a claim nothing recomputes.
 */
export function uncoveredPackages(root, covered = COVERED_PACKAGES) {
  /** @type {string[]} */
  const found = [];
  for (const scanRoot of PACKAGE_ROOTS) {
    let entries;
    try {
      entries = readdirSync(join(root, scanRoot), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const pkgPath = `${scanRoot}/${entry.name}`;
      if (!existsSync(join(root, pkgPath, 'package.json'))) continue;
      if (!existsSync(join(root, pkgPath, 'src'))) continue;
      if (covered[pkgPath]) continue;
      found.push(pkgPath);
    }
  }
  return found;
}

/**
 * The whole verdict for `root`.
 *
 * @param {string} root repository root
 * @param {Record<string, { buildConfig: string, notes: string }>} covered
 */
export function analyze(root, covered = COVERED_PACKAGES) {
  /** @type {Finding[]} */
  const findings = [...auditCoverage(root, covered)];
  const counters = { packages: 0, files: 0, reached: 0, specifiers: 0, entries: 0, aliasRoots: 0, rules: 0 };

  for (const [pkgPath, entry] of Object.entries(covered)) {
    if (findings.some((finding) => finding.reason === 'stale-coverage' && finding.pkg === pkgPath)) continue;
    const { aliases } = readBuildConfig(join(root, pkgPath), entry.buildConfig);
    findings.push(...auditAliasMechanisms(root, pkgPath, aliases));
    const result = auditPackage(root, pkgPath, entry);
    findings.push(...result.findings);
    counters.packages += 1;
    counters.files += result.counters.files;
    counters.reached += result.counters.reached;
    counters.specifiers += result.counters.specifiers;
    counters.entries += result.counters.entries;
    counters.aliasRoots += result.counters.aliasRoots;
    counters.rules += result.counters.rules;
  }

  return { findings, counters, uncovered: uncoveredPackages(root, covered) };
}

const HINTS = {
  'unreferenced-source':
    'Nothing reaches this file — not the package entry, not a build-config alias. Delete it, or, if it ' +
    'is meant to ship, wire it into the barrel it belongs to. Before deleting, confirm separately that ' +
    'it contributes no PUBLIC export: unreferenced and not-exported are two questions, and an orphan ' +
    'wearing a live export name is the hazard objectui#7515 exists for.',
  'unevaluatable-alias':
    'This alias entry uses a shape scripts/check-unreferenced-sources.mjs cannot evaluate, so it cannot ' +
    'know which file the bundler names. Reported rather than skipped: skipping it would accuse whatever ' +
    'file it points at of being dead. Teach `evaluatePath` the shape, or spell the alias with ' +
    '`resolve(__dirname, ...)`.',
  'unevaluatable-entry': 'Same as unevaluatable-alias, for `build.lib.entry`.',
  'entry-not-on-disk': 'The declared entry does not resolve to a file — the whole walk would start nowhere.',
  'no-entry': 'The build config declares no `build.lib.entry`, so this gate has no root to walk from.',
  'missing-build-config': 'COVERED_PACKAGES names a build config this package does not have.',
  'unreadable-build-config': 'The build config has no default-exported object literal to read.',
  'no-roots': 'Neither an entry nor an in-package alias target survived — a walk from nothing reports everything.',
  'stale-coverage':
    'An entry in COVERED_PACKAGES no longer describes the repository. Fix it or remove it — a coverage ' +
    'claim whose package has moved leaves this gate checking nothing while still reporting a pass.',
  'unmodelled-alias-mechanism':
    "A covered package resolves modules through a mechanism this gate does not read (tsconfig `paths` " +
    'without a matching build-config alias). Until it is modelled, the walk can miss an edge and accuse ' +
    'a live file.',
  'unreadable-tsconfig': 'A covered package tsconfig could not be parsed, so its alias mechanisms are unknown.',
};

const invokedDirectly = isEntrypoint(import.meta.url);

if (invokedDirectly) {
  const argOf = (name) => {
    const index = process.argv.indexOf(name);
    return index > -1 ? process.argv[index + 1] : null;
  };
  const root = resolve(argOf('--root') ?? resolve(scriptDir, '..'));

  let result;
  try {
    result = analyze(root);
  } catch (error) {
    console.error(
      `x  ${error.message}\n\n` +
        '    Reported as a failure rather than a pass: this gate decides whether a package ships a file\n' +
        '    nothing reaches, so losing an input means it cannot decide, and a green verdict would have\n' +
        '    looked at nothing.',
    );
    process.exit(1);
  }

  const { findings, counters, uncovered } = result;

  // A refactor that quietly emptied the walk would satisfy every assertion in
  // the test file while checking nothing — the same size guard the sibling
  // gates open with.
  if (counters.packages === 0 || counters.files < 20 || counters.specifiers < 200 || counters.entries === 0) {
    console.error(
      `The scan collapsed: ${counters.packages} covered package(s), ${counters.files} source file(s), ` +
        `${counters.specifiers} module specifier(s), ${counters.entries} entry point(s). The population walk ` +
        'or the config reader is broken, and an empty comparison would pass while asserting nothing.',
    );
    process.exit(1);
  }

  console.log(
    `Scanned ${counters.packages} covered package(s): ${counters.files} shipped source file(s), ` +
      `${counters.reached} reached, ${counters.specifiers} module specifier(s) followed from ` +
      `${counters.entries} declared entry point(s) and ${counters.aliasRoots} build-config alias target(s), ` +
      `through ${counters.rules} alias resolution rule(s).`,
  );
  console.log(
    `Not covered by this gate: ${uncovered.length} workspace package(s) with a src/ tree ` +
      `(${PACKAGE_ROOTS.join(', ')}). Adding one means verifying its alias mechanisms first — ` +
      'see COVERED_PACKAGES in scripts/check-unreferenced-sources.mjs.',
  );

  if (findings.length === 0) {
    console.log('OK  Every shipped source file in every covered package is reachable.');
    process.exit(0);
  }

  console.error(`\nx  ${findings.length} problem(s):\n`);
  for (const finding of findings) {
    if (finding.reason === 'unreferenced-source') {
      const extra =
        finding.testImporters.length > 0
          ? `  (referenced only by test files: ${finding.testImporters.join(', ')})`
          : '';
      console.error(`      ${finding.file}  [unreferenced-source]  nothing reaches this file${extra}`);
      continue;
    }
    console.error(`      ${finding.pkg}  [${finding.reason}]  ${finding.detail}`);
  }
  for (const reason of Object.keys(HINTS)) {
    if (findings.some((finding) => finding.reason === reason)) console.error(`\n${reason}: ${HINTS[reason]}`);
  }
  console.error(
    '\nTwo were found by a human reading unrelated code in one week (objectui#7319, objectui#7397), which ' +
      'is\nthe detection mechanism this gate replaces. See the header of ' +
      'scripts/check-unreferenced-sources.mjs (objectui#7515).',
  );
  process.exit(1);
}
