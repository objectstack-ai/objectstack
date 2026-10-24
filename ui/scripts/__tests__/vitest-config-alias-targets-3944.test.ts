import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * objectui#3944 — every `resolve.alias` target in the root `vitest.config.mts`
 * must exist on disk.
 *
 * Four entries pointed at directories that are not in the workspace:
 * `@object-ui/engine` -> `packages/engine/src`, `@object-ui/renderer` ->
 * `packages/renderer/src`, `@object-ui/plugin-aggrid` ->
 * `packages/plugin-aggrid/src`, `@object-ui/ui` -> `packages/ui/src`.
 * `packages/plugin-aggrid` was published once (the CHANGELOGs still record
 * `@object-ui/plugin-aggrid@0.4.1`) and then removed; the other three never had
 * a package at all. Nothing imported any of the four, so nothing ever resolved
 * through them and no test went red — the entries were inert.
 *
 * Why that still earns a mechanical guard rather than a one-off deletion: this
 * is the same defect class as objectui#3904 — configuration that *declares* a
 * capability the dependency graph does not have. There, `@object-ui/layout` sat
 * in `apps/site`'s `transpilePackages` while being neither a dependency nor an
 * import, read to every reader as "already wired up", and the Playground kept
 * painting the red OBJUI-001 panel until someone drove it in a browser (#3787).
 * A dead entry is worse than a missing one, because it reads as connected. The
 * guard PR #3942 added there is this file's shape sibling; this is the same
 * check for the alias table, so entry #44 cannot arrive the same way.
 *
 * Read from the SOURCE TEXT, not by importing the config: `vitest.config.mts`
 * runs `assertCanonicalVitestInvocation()` at module scope and pulls in the
 * whole Vitest config surface. A unit test that only needs a list of strings
 * should not boot that (the same reason #3904's guard parses
 * `apps/site/next.config.mjs` as text).
 *
 * Reverse verification (direction predicted before running — plain RED, no
 * inversion: the alias table is the sole input, and an added bad entry can only
 * add a finding): add `'@object-ui/ghost-3944'` pointing at
 * `packages/ghost-3944/src` and the "target directory that exists" case fails
 * naming that entry, while the two coverage cases stay green (a well-formed
 * entry is still parsed).
 *
 * ---------------------------------------------------------------------------
 * objectui#4804 — this guard now reads TWO tables.
 *
 * The paragraph that used to sit here said `tsconfig.json`'s `paths` carried
 * dead entries of the same shape for three of the four names, and left them to
 * whoever triaged it. #4804 is that triage: it deleted the six lines
 * (`@object-ui/engine`, `@object-ui/ui`, `@object-ui/renderer`, each in bare
 * and `/*`-suffixed form) and folded the table in here instead of starting a
 * second guard file — one guard watching both tables, as PR #4802 suggested.
 * The file name keeps its `3944` provenance; each `describe` names its table.
 *
 * Note the two dead sets are NOT the same: `@object-ui/plugin-aggrid` was in
 * the alias table and never in `paths`, so the pins below differ on purpose.
 *
 * Why `tsconfig.json` is read as TEXT too, when it looks like plain JSON: it is
 * JSONC. Two block comments sit in `compilerOptions` (at :9 and :16 on the
 * post-#4804 file), and `JSON.parse` throws on them — measured: `Expected
 * double-quoted property name in JSON at position 187`. The alternative is to
 * strip comments first, i.e. hand-roll a second parser that has to respect
 * string literals to avoid mangling a target that contains comment-like
 * characters. One brace-balanced text read, shared by both tables, is less
 * surface than that, and keeps the two halves of this file the same shape.
 *
 * Reverse verification for the `paths` half (direction predicted before
 * running — plain RED again, and for the same reason: the table is the sole
 * input, so an added bad entry can only add a finding): add
 * `"@object-ui/ghost-4804": ["packages/ghost-4804/src"]` and the
 * "maps to a path that exists" case fails naming that entry, while the two
 * coverage cases and both pins stay green.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG_PATH = path.join(repoRoot, 'vitest.config.mts');
const configSource = fs.readFileSync(CONFIG_PATH, 'utf8');

interface AliasEntry {
  /** The bare specifier being aliased, e.g. `@object-ui/core`. */
  specifier: string;
  /** The repo-relative target as written in the config. */
  target: string;
}

/**
 * The text of an object literal, brace-balanced from its opening `{` so a
 * nested object in a future entry cannot truncate it. Shared by both tables.
 */
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

/**
 * Comment LINES stripped, so they cannot be miscounted as entries — both the
 * `//` form and a block comment occupying a whole line.
 *
 * Only whole lines: an entry hidden inside a multi-line block comment is still
 * read as live and then fails the existence check. That is the safe direction
 * for a guard (fail loud, never silently drop a key), and the fix is the one
 * this file argues for anyway — delete a dead entry rather than commenting it
 * out.
 */
function withoutCommentLines(source: string): string {
  return source
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line) && !/^\s*\/\*.*\*\/\s*$/.test(line))
    .join('\n');
}

const block = withoutCommentLines(
  balancedObjectLiteral(configSource, /alias:\s*\{/, 'vitest.config.mts: resolve.alias')
);

const ENTRY = /(['"])([^'"]+)\1\s*:\s*path\.resolve\(\s*__dirname\s*,\s*(['"])([^'"]+)\3\s*\)/g;

const entries: AliasEntry[] = [...block.matchAll(ENTRY)].map((m) => ({
  specifier: m[2],
  target: m[4],
}));

describe('objectui#3944 — root vitest.config.mts alias table', () => {
  it('parses a plausible table (a zero-hit parse would make every case below vacuous)', () => {
    // The failure mode this guards: the config is reformatted, the regex stops
    // matching, `entries` becomes [] and the existence check passes while
    // checking nothing — the empty-fixture trap.
    expect(entries.length).toBeGreaterThanOrEqual(30);
    expect(entries.map((e) => e.specifier)).toContain('@object-ui/core');
  });

  it('parses EVERY key in the block, so no entry can dodge the existence check', () => {
    // Coverage, not style: an entry whose value is written in some other form
    // (a bare string, a template literal, a helper call) would be skipped by
    // ENTRY and silently escape. Compare the parsed count against the number of
    // keys actually present.
    const keys = [...block.matchAll(/^\s*(['"])([^'"]+)\1\s*:/gm)].map((m) => m[2]);

    expect(
      keys.filter((key) => !entries.some((e) => e.specifier === key)),
      'These alias keys are not written as `path.resolve(__dirname, "<relative path>")`, so the ' +
        'target-exists check below never sees them. Use that form, or teach this test the new one.'
    ).toEqual([]);
    expect(entries).toHaveLength(keys.length);
  });

  it.each(entries)('$specifier resolves to a path that exists ($target)', ({ specifier, target }) => {
    const abs = path.resolve(repoRoot, target);

    expect(
      fs.existsSync(abs),
      `Alias '${specifier}' points at ${target}, which does not exist in the workspace. A dead ` +
        'alias never fails a test — nothing resolves through it — it just reads as if the package ' +
        'were wired up (objectui#3944). Drop the entry, or add the package.'
    ).toBe(true);
  });

  it('aliases an extension-less target to a directory, not a stray file', () => {
    // `@object-ui/types/zod` legitimately targets a single .ts file; every other
    // entry is a package `src/` root. Existence alone would accept a file where
    // a directory is meant, which resolves for the bare specifier and breaks
    // every deep import through it.
    const wrongKind = entries.filter(
      ({ target }) =>
        path.extname(target) === '' &&
        fs.existsSync(path.resolve(repoRoot, target)) &&
        !fs.statSync(path.resolve(repoRoot, target)).isDirectory()
    );

    expect(wrongKind.map((e) => e.specifier)).toEqual([]);
  });

  it('no longer carries the four dead entries', () => {
    // Named explicitly: the generic check above would also go green if someone
    // "fixed" it by re-creating empty `packages/<name>/src` directories.
    const specifiers = entries.map((e) => e.specifier);

    expect(specifiers).not.toContain('@object-ui/engine');
    expect(specifiers).not.toContain('@object-ui/renderer');
    expect(specifiers).not.toContain('@object-ui/plugin-aggrid');
    expect(specifiers).not.toContain('@object-ui/ui');
  });
});

// ---------------------------------------------------------------------------
// objectui#4804 — the second table: root `tsconfig.json`'s `compilerOptions.paths`.
// ---------------------------------------------------------------------------

const TSCONFIG_PATH = path.join(repoRoot, 'tsconfig.json');
const tsconfigSource = fs.readFileSync(TSCONFIG_PATH, 'utf8');

const pathsBlock = withoutCommentLines(
  balancedObjectLiteral(tsconfigSource, /"paths"\s*:\s*\{/, 'tsconfig.json: compilerOptions.paths')
);

/** `"<specifier>": ["<target>", ...]` — a `paths` value is always an array. */
const PATHS_ENTRY = /(['"])([^'"]+)\1\s*:\s*\[([^\]]*)\]/g;
const QUOTED = /(['"])([^'"]+)\1/g;

/**
 * Flattened to one row per target: `paths` allows several fallback targets per
 * specifier, and every one of them is a claim that has to hold. Reuses
 * `AliasEntry` — a `paths` mapping is the same (specifier, target) pair.
 */
const pathEntries: AliasEntry[] = [...pathsBlock.matchAll(PATHS_ENTRY)].flatMap((entry) =>
  [...entry[3].matchAll(QUOTED)].map((target) => ({
    specifier: entry[2],
    target: target[2],
  }))
);

/**
 * A `paths` target may carry TypeScript's `*` substitution token
 * (`packages/core/src/*`), which is a pattern, not a path — `existsSync` on it
 * is always false. What has to exist is the prefix it substitutes into, and
 * that prefix has to be a directory for the substitution to mean anything.
 */
function resolveTarget(target: string): { abs: string; isPattern: boolean } {
  const star = target.indexOf('*');
  if (star === -1) return { abs: path.resolve(repoRoot, target), isPattern: false };

  return {
    abs: path.resolve(repoRoot, target.slice(0, star).replace(/\/$/, '')),
    isPattern: true,
  };
}

/**
 * objectui#4820 — RESOLVED, and this ratchet is empty as a result.
 *
 * It briefly carved out `@objectstack/plugin-msw` and `@objectstack/objectql`,
 * two `paths` entries pointing into `node_modules` for packages that are not
 * dependencies of this workspace at all, so no install could ever produce them.
 * #4820 ruled direction A — drop the lines rather than add the dependencies —
 * on the ground that adding a runtime dependency is a product decision that must
 * not be back-derived from a dead config line. Both lines are gone from
 * `tsconfig.json`, so the carve-out went with them.
 *
 * A shrink-only ratchet, not an exemption: it may not grow. Empty is its
 * terminal state — every `paths` entry is now guarded with no exemptions, and
 * the pin below keeps it that way. Re-adding either specifier needs the package
 * to be a real dependency first, which the existence check enforces on its own.
 */
const KNOWN_MISSING_TARGETS: readonly string[] = [];

/** The six lines #4804 removed, in both spellings. */
const REMOVED_BY_4804 = [
  '@object-ui/engine',
  '@object-ui/engine/*',
  '@object-ui/ui',
  '@object-ui/ui/*',
  '@object-ui/renderer',
  '@object-ui/renderer/*',
];

describe('objectui#4804 — root tsconfig.json compilerOptions.paths table', () => {
  it('parses a plausible table (a zero-hit parse would make every case below vacuous)', () => {
    // Same empty-fixture trap as the alias half: if the file is reformatted and
    // the regex stops matching, `pathEntries` becomes [] and every case below
    // passes while checking nothing.
    expect(pathEntries.length).toBeGreaterThanOrEqual(10);
    expect(pathEntries.map((e) => e.specifier)).toContain('@object-ui/core');
  });

  it('parses EVERY key in the block, so no entry can dodge the existence check', () => {
    // Coverage, not style. A key whose value is written in some other form — a
    // bare string instead of an array, or an empty array — would be skipped by
    // PATHS_ENTRY and silently escape.
    const keys = [...pathsBlock.matchAll(/^\s*(['"])([^'"]+)\1\s*:/gm)].map((m) => m[2]);

    expect(
      keys.filter((key) => !pathEntries.some((e) => e.specifier === key)),
      'These `paths` keys are not written as an array of at least one quoted repo-relative ' +
        'target, so the target-exists check below never sees them. Use that form, or teach this ' +
        'test the new one.'
    ).toEqual([]);
    expect(new Set(pathEntries.map((e) => e.specifier)).size).toBe(keys.length);
  });

  it.each(pathEntries.filter((e) => !KNOWN_MISSING_TARGETS.includes(e.specifier)))(
    '$specifier maps to a path that exists ($target)',
    ({ specifier, target }) => {
      const { abs, isPattern } = resolveTarget(target);

      expect(
        fs.existsSync(abs),
        `paths['${specifier}'] maps to ${target}, which does not exist in the workspace. A dead ` +
          'mapping never fails a build — nothing resolves through it — it just reads as if the ' +
          'package were wired up (objectui#4804). Drop the entry, or add the package.'
      ).toBe(true);

      if (isPattern) {
        expect(
          fs.statSync(abs).isDirectory(),
          `paths['${specifier}'] substitutes '*' into ${target.replace(/\*$/, '')}, which exists ` +
            'but is not a directory, so no deep import can resolve through it.'
        ).toBe(true);
      }
    }
  );

  it('maps an extension-less target to a directory, not a stray file', () => {
    // `@object-ui/console` legitimately targets a single `.ts` file; every
    // other non-pattern entry is a package `src/` root. Existence alone would
    // accept a file where a directory is meant.
    const wrongKind = pathEntries.filter(({ specifier, target }) => {
      if (KNOWN_MISSING_TARGETS.includes(specifier)) return false;
      const { abs, isPattern } = resolveTarget(target);
      if (isPattern || path.extname(target) !== '') return false;
      return fs.existsSync(abs) && !fs.statSync(abs).isDirectory();
    });

    expect(wrongKind.map((e) => e.specifier)).toEqual([]);
  });

  it('no longer carries the six dead engine/ui/renderer entries', () => {
    // Named explicitly, for the same reason as the alias half: the generic
    // check above would also go green if someone "fixed" these by creating
    // empty `packages/<name>/src` directories. Note `@object-ui/plugin-aggrid`
    // is absent here on purpose — it was in the alias table, never in `paths`.
    const specifiers = pathEntries.map((e) => e.specifier);

    for (const dead of REMOVED_BY_4804) {
      expect(
        specifiers,
        `objectui#4804 removed paths['${dead}'] because its target never existed. Re-adding it ` +
          'needs the package to exist first.'
      ).not.toContain(dead);
    }
  });

  it('the objectui#4820 carve-out is empty, so no paths entry is exempt', () => {
    // #4820 was resolved by deleting both carved-out lines, so this list is
    // empty and every case above covers the whole table. Asserted rather than
    // left implicit: with an empty list the two expectations below are vacuous,
    // and a silently vacuous pin is the exact trap this file guards elsewhere.
    expect(
      KNOWN_MISSING_TARGETS,
      'KNOWN_MISSING_TARGETS is a shrink-only ratchet that reached empty when objectui#4820 ' +
        'landed. Re-populating it needs a card of its own — a new dead target is meant to go ' +
        'red here, not to be carved out.'
    ).toEqual([]);

    const declared = pathEntries.filter((e) => KNOWN_MISSING_TARGETS.includes(e.specifier));

    expect(
      [...new Set(declared.map((e) => e.specifier))].sort(),
      'KNOWN_MISSING_TARGETS names an entry that is no longer in tsconfig.json. If objectui#4820 ' +
        'was resolved by deleting the line, delete it from the carve-out too.'
    ).toEqual([...KNOWN_MISSING_TARGETS].sort());

    const nowResolving = declared.filter((e) => fs.existsSync(resolveTarget(e.target).abs));

    expect(
      nowResolving.map((e) => e.specifier),
      'A carved-out target now exists, so the objectui#4820 carve-out is obsolete for it — drop ' +
        'it from KNOWN_MISSING_TARGETS so the entry is guarded like every other one.'
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// objectui#5168 — the THIRD table set: the package-level `vite.config.ts`
// alias tables.
// ---------------------------------------------------------------------------

/**
 * objectui#5168 — every `resolve.alias` target in every PACKAGE-level
 * `vite.config.ts` must resolve to something a bundler can reach.
 *
 * ## The hole
 *
 * The two halves above cover the two ROOT tables. The package-level tables were
 * covered by nothing. Measured on this tree: **24 configs declare a
 * `resolve.alias` table**, contributing **227 entries** — 200 of them
 * `@object-ui/*`, spread over 20 of those configs.
 *
 * The only other gate that reads these tables is
 * `side-effects-declaration-consistency.test.ts`, and it does NOT go red on a
 * dead entry — `resolveAliasModule()` returns undefined and
 * `resolvableEntryPaths()` `continue`s. That is correct behaviour for its own
 * question (a dead alias contributes no entry form, so no `sideEffects`
 * declaration can conflict with it), not an oversight. Target existence and
 * `sideEffects` declaration consistency are two different contracts; folding
 * this one into that gate would have it health-check alias tables it only reads
 * incidentally. So it lands here, in the file whose contract already IS "a
 * declared alias target must exist" — the same absorption #4804 did.
 *
 * ## Why an AST read here, when the two halves above read TEXT
 *
 * The halves above each read ONE table in ONE file whose spelling is fixed and
 * visible. These are 24 files written four different ways, and #5158 measured
 * what a regex costs across them: a reader requiring `path.resolve(` after a
 * SINGLE-quoted key saw 70 of 196 entries, with 15 configs contributing zero —
 * not checked-and-passed, never looked at. The four spellings in the tree:
 *
 *   - bare `resolve(__dirname, …)` from `import { resolve } from 'path'`;
 *   - `path.resolve(__dirname, …)`;
 *   - the ARRAY table form, `alias: [{ find, replacement }]`;
 *   - DOUBLE-quoted keys.
 *
 * The parser below is BORROWED from `side-effects-declaration-consistency.ts`
 * (`:397-502`, `resolveAliasModule` at `:524`) rather than written a fifth
 * time — it already reads the structure instead of the spelling. Borrowed, not
 * moved: that file is another gate's, and its copy answers its own question.
 * The spelling-coverage case below is what keeps the borrow honest — a parser
 * that silently skipped one spelling would produce a green meaning "did not
 * look", which is the exact failure this file exists to end.
 *
 * ## Two things that do NOT transfer from the halves above
 *
 * 1. **Existence is not `existsSync` alone here.** A root-table target is
 *    always a directory or an explicit file. A package table legitimately
 *    aliases an EXTENSION-LESS file: `packages/runner`'s `"@/lib/utils"` points
 *    at `packages/components/src/lib/utils`, which is `utils.tsx` on disk and
 *    resolves fine — Vite probes `resolve.extensions` after substituting an
 *    alias. `existsSync` on the written target is false for it. So the
 *    predicate is "exists, or exists with one of Vite's extensions appended".
 *
 * 2. **The "extension-less target must be a directory" case does not apply.**
 *    Up there it is right: every root entry but one is a package `src/` root, so
 *    a file where a directory is meant breaks every deep import. Down here an
 *    extension-less target landing on a FILE is the intended, common spelling
 *    (`@/lib/utils` again). Porting that case would have made a correct config
 *    red. Named rather than silently dropped.
 *
 * ## What is still out of reach, named
 *
 * `apps/console` mutates its table at runtime under `OBJECTSTACK_SPEC_DIST`
 * (`Object.assign(workspaceAliases, specDistInjection.aliases)`). A static read
 * sees the baseline literal, which is the table every ordinary build uses.
 * Scoped to `resolve.alias`: a `test.alias` would be a Vitest-only surface, and
 * no package config declares one today.
 *
 * ## Reverse verification (predicted before running; observed in PR body)
 *
 * Direction predicted: plain RED, and +1 CASE as well as +1 failure — the alias
 * tables are the sole input, an added entry can only add one `it.each` row and
 * that row can only add a finding. The case count is the load-bearing half: a
 * spelling the parser skipped would add ZERO cases and stay green, which is the
 * "did not look" green this gate exists to make impossible. Four probes, one
 * per spelling, each in the config that natively uses it, plus a fifth for the
 * no-silent-skip case:
 *
 *   A. `packages/plugin-editor` — `'@object-ui/ghost-5158': resolve(__dirname,
 *      '../ghost-5158/src')` (single-quoted key, bare `resolve`) — the probe
 *      objectui#5168 was filed with, which BOTH pre-existing gates pass.
 *   B. `packages/fields` — same shape with `path.resolve(`.
 *   C. `packages/runner` — same shape with a DOUBLE-quoted key.
 *   D. `packages/components` — the ARRAY form, `{ find, replacement }`.
 *   E. a value the parser cannot read at all — predicted to differ from A–D:
 *      NO new case, the coverage case red instead.
 *
 * No build artifact sits between any of these edits and the thing under test:
 * this file reads `node:fs` and parses source text, so nothing is compiled,
 * bundled or emitted in between. Nothing was rebuilt, and nothing needed to be.
 */

/** Bundler configs, by strict basename — see the borrowed parser's note on why
 * a `vite.config.*` GLOB is wrong: it also matches the
 * `vite.config.ts.timestamp-*.mjs` temp file Vite writes while loading a
 * config, and reading one would feed this gate a stale snapshot of a table. */
const BUNDLER_CONFIG_RE = /^vite\.config\.(ts|mts|cts|js|mjs|cjs)$/;

/** How an alias key is written. The spelling-coverage case reads this. */
type AliasKeyForm = 'single-quoted' | 'double-quoted' | 'identifier' | 'array-string' | 'array-regexp';

interface PackageAliasEntry {
  /** Repo-relative config declaring it, e.g. `packages/runner/vite.config.ts`. */
  config: string;
  /** The alias key: a specifier, or a RegExp matcher's source text. */
  specifier: string;
  /** The target exactly as written in the second `resolve()` argument. */
  target: string;
  /** Absolute path the target names, resolved from the config's own directory. */
  abs: string;
  keyForm: AliasKeyForm;
  /** `resolve(…)` vs `path.resolve(…)`. */
  calleeForm: 'bare-resolve' | 'member-resolve';
}

/**
 * An alias table entry the parser could not turn into a (key, target) pair.
 * Never a silent skip: the failure mode this whole file exists to end is a
 * surface that shrinks without saying so.
 */
interface PackageAliasParseGap {
  config: string;
  /** The key, or a description of the table when the table itself is unreadable. */
  what: string;
  /** The source text that was not understood, first line, clipped. */
  text: string;
}

const packageAliasParseGaps: PackageAliasParseGap[] = [];

/**
 * The `packages:` globs from `pnpm-workspace.yaml`, read rather than hardcoded
 * so a new workspace root is covered the day it is added. Understands only the
 * two shapes the file uses (`dir/*` and a bare `dir`); anything else throws
 * rather than being skipped, because a guard that silently stops looking at
 * part of the workspace goes on reporting success over a shrinking surface.
 */
function workspaceGlobs(): string[] {
  const yaml = fs.readFileSync(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => /^packages:\s*$/.test(l));
  if (start === -1) throw new Error('pnpm-workspace.yaml no longer declares a top-level `packages:` key');

  const globs: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    if (!/^\s/.test(line)) break;
    const match = line.match(/^\s*-\s*['"]?([^'"#\s]+)['"]?\s*(#.*)?$/);
    if (!match) {
      throw new Error(
        `Unparsed entry in pnpm-workspace.yaml \`packages:\`: ${JSON.stringify(line)} — teach this guard the new syntax.`
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

/** Quote style of a key as written — two of the four spellings differ only here. */
function keyFormOf(node: ts.Node, source: ts.SourceFile): AliasKeyForm {
  const raw = node.getText(source);
  if (raw.startsWith('"')) return 'double-quoted';
  if (raw.startsWith("'")) return 'single-quoted';
  return 'identifier';
}

/**
 * A `resolve()`-shaped call, whatever the callee is spelled as: bare `resolve`
 * from `import { resolve } from 'path'`, `path.resolve`, or a renamed import
 * like `nodePath.resolve`. The ARGUMENTS are what make it an alias target —
 * `(__dirname | import.meta.dirname, '<relative>')` — so the callee only has to
 * be the right function name, not the right import style.
 */
function resolveCallTarget(
  value: ts.Expression
): { relative: string; calleeForm: 'bare-resolve' | 'member-resolve' } | undefined {
  const call = unwrapExpression(value);
  if (!ts.isCallExpression(call)) return undefined;

  const callee = call.expression;
  const bare = ts.isIdentifier(callee) && callee.text === 'resolve';
  const member = ts.isPropertyAccessExpression(callee) && callee.name.text === 'resolve';
  if (!bare && !member) return undefined;

  if (call.arguments.length !== 2) return undefined;
  const base = call.arguments[0];
  const isDirname =
    (ts.isIdentifier(base) && base.text === '__dirname') ||
    (ts.isPropertyAccessExpression(base) && base.name.text === 'dirname' && ts.isMetaProperty(base.expression));
  if (!isDirname) return undefined;

  const relative = call.arguments[1];
  if (!ts.isStringLiteral(relative) && !ts.isNoSubstitutionTemplateLiteral(relative)) return undefined;
  return { relative: relative.text, calleeForm: bare ? 'bare-resolve' : 'member-resolve' };
}

/**
 * The `resolve.alias` tables of one config, as expressions.
 *
 * Scoped to `alias` under a `resolve` property: a blind search for any `alias:`
 * would also pick up a `test.alias` (a Vitest-only surface) and a
 * `dts({ aliasesExclude })` option. One hop of identifier indirection is
 * followed — `apps/console` and `examples/console-starter` both declare
 * `const workspaceAliases = { … }` and then write `alias: workspaceAliases`,
 * which is 65 of the entries here.
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
      if (ts.isPropertyAssignment(owner) && propertyKey(owner) === 'resolve') {
        let table = unwrapExpression(node.initializer);
        if (ts.isIdentifier(table)) {
          const declared = declarations.get(table.text);
          if (declared === undefined) {
            packageAliasParseGaps.push({
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

/** Configs that declare at least one `resolve.alias` table, repo-relative. */
const configsWithAliasTable = new Set<string>();

/**
 * Every alias entry in every package-level bundler config.
 *
 * Read as source rather than imported, for the same reason the two halves above
 * read text: these configs pull in the whole Vite plugin surface at module
 * scope, and a guard that only needs a list of strings should not boot that.
 *
 * Unlike the borrowed copy, this one keeps entries whose key is a RegExp
 * matcher. There it is right to drop them — a RegExp names no single specifier,
 * so it can yield no entry form. Here the QUESTION is about the replacement,
 * and a RegExp-keyed replacement is a path like any other:
 * `packages/components` has three, all pointing at real shim files.
 */
function readPackageAliasEntries(): PackageAliasEntry[] {
  const entries: PackageAliasEntry[] = [];

  for (const dir of workspacePackageDirs()) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      if (!BUNDLER_CONFIG_RE.test(name)) continue;
      const configPath = path.join(dir, name);
      const config = path.relative(repoRoot, configPath).split(path.sep).join('/');
      const source = ts.createSourceFile(
        configPath,
        fs.readFileSync(configPath, 'utf8'),
        ts.ScriptTarget.Latest,
        true
      );
      const clip = (node: ts.Node): string => node.getText(source).split('\n')[0].trim().slice(0, 120);

      const tables = aliasTableExpressions(source, config);
      if (tables.length > 0) configsWithAliasTable.add(config);

      for (const table of tables) {
        /** `[key, key form, value node, node to quote in a gap report]` */
        const pairs: [string, AliasKeyForm, ts.Expression, ts.Node][] = [];

        if (ts.isObjectLiteralExpression(table)) {
          for (const prop of table.properties) {
            if (!ts.isPropertyAssignment(prop)) {
              packageAliasParseGaps.push({ config, what: 'a non-assignment table member', text: clip(prop) });
              continue;
            }
            const key = propertyKey(prop);
            if (key === undefined) {
              packageAliasParseGaps.push({ config, what: 'a computed alias key', text: clip(prop) });
              continue;
            }
            pairs.push([key, keyFormOf(prop.name, source), prop.initializer, prop]);
          }
        } else if (ts.isArrayLiteralExpression(table)) {
          for (const element of table.elements) {
            const entry = unwrapExpression(element);
            if (!ts.isObjectLiteralExpression(entry)) {
              packageAliasParseGaps.push({ config, what: 'a non-object array table entry', text: clip(entry) });
              continue;
            }
            let find: ts.Expression | undefined;
            let replacement: ts.Expression | undefined;
            for (const prop of entry.properties) {
              if (!ts.isPropertyAssignment(prop)) continue;
              if (propertyKey(prop) === 'find') find = unwrapExpression(prop.initializer);
              if (propertyKey(prop) === 'replacement') replacement = prop.initializer;
            }
            if (find === undefined || replacement === undefined) {
              packageAliasParseGaps.push({ config, what: 'an array table entry missing find/replacement', text: clip(entry) });
              continue;
            }
            if (ts.isStringLiteral(find) || ts.isNoSubstitutionTemplateLiteral(find)) {
              pairs.push([find.text, 'array-string', replacement, entry]);
            } else if (ts.isRegularExpressionLiteral(find)) {
              pairs.push([find.getText(source), 'array-regexp', replacement, entry]);
            } else {
              packageAliasParseGaps.push({ config, what: 'an array table entry with an unreadable find', text: clip(entry) });
            }
          }
        } else {
          packageAliasParseGaps.push({
            config,
            what: `resolve.alias (${ts.SyntaxKind[table.kind]})`,
            text: clip(table),
          });
          continue;
        }

        for (const [specifier, keyForm, value, node] of pairs) {
          const resolved = resolveCallTarget(value);
          if (resolved === undefined) {
            packageAliasParseGaps.push({ config, what: specifier, text: clip(node) });
            continue;
          }
          entries.push({
            config,
            specifier,
            target: resolved.relative,
            abs: path.resolve(dir, resolved.relative),
            keyForm,
            calleeForm: resolved.calleeForm,
          });
        }
      }
    }
  }

  return entries;
}

const packageAliasEntries = readPackageAliasEntries();

/**
 * Vite's own `resolve.extensions`, in its own order. An alias substitution is
 * followed by ordinary resolution, so an extension-less target that names a
 * file is live — see note 1 in the header.
 */
const VITE_RESOLVE_EXTENSIONS = ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'];

/** True when a bundler can reach the target: a file, a directory, or a file one extension away. */
function packageAliasTargetExists(abs: string): boolean {
  if (fs.existsSync(abs)) return true;
  return VITE_RESOLVE_EXTENSIONS.some((ext) => fs.existsSync(`${abs}${ext}`));
}

/**
 * objectui#5380 — RESOLVED, and this ratchet is empty as a result.
 *
 * It briefly carved out `packages/runner`'s `"@app"`, which pointed at
 * `packages/runner/src/app-data`. #5380 ruled direction A′: delete the alias
 * line, on the measured ground that it had **zero importers** and that the
 * documented App Data Symlink DX does not route through it —
 * `packages/runner/src/lib/MetadataLoader.ts`'s `LocalBundleLoader` reads that
 * directory through relative `import.meta.glob('../app-data/…')`, never through
 * the alias. Deleting the line changed no behaviour.
 *
 * ⚠️ Read the ground carefully before carving out anything that looks like
 * this again: `src/app-data/` is NOT a dead target. It is git-ignored
 * (`packages/runner/.gitignore:1`) and **user-supplied** — the reader creates it
 * by following `packages/runner/README.md` or `content/docs/utilities/runner.mdx`,
 * and it is absent from a fresh checkout **by design**. What was dead was the
 * unused alias, not the thing it named. An existence check reads a
 * user-supplied directory as missing on CI and present on the machine of anyone
 * who followed the docs; that checkout-state dependence is objectui#5968's
 * subject, and this ratchet reaching empty is what removed its only instance
 * here — not a fix for the class.
 *
 * Note the entry was NOT an `@object-ui/*` key. The finding that opened
 * objectui#5168 counted 196 `@object-ui/*` entries, and a gate scoped to that
 * prefix would have shipped green over it. That is why this half takes its
 * scope from EVERY entry in every table, and why narrowing it to a prefix would
 * silently shrink the surface.
 *
 * A shrink-only ratchet, not an exemption: it may not grow. Empty is its
 * terminal state — every package alias entry is now guarded with no exemptions,
 * and the pin below keeps it that way. A NEW dead target is meant to go red in
 * the existence check above, not to be carved out.
 */
const KNOWN_MISSING_PACKAGE_ALIAS_TARGETS: readonly { config: string; specifier: string }[] = [];

const isCarvedOut = (entry: PackageAliasEntry): boolean =>
  KNOWN_MISSING_PACKAGE_ALIAS_TARGETS.some(
    (known) => known.config === entry.config && known.specifier === entry.specifier
  );

describe('objectui#5168 — package-level vite.config.ts alias tables', () => {
  it('parses a plausible set of tables (a zero-hit parse would make every case below vacuous)', () => {
    // The failure mode this guards: a config is reformatted or the walk stops
    // finding files, `packageAliasEntries` shrinks toward [] and the existence
    // check passes while checking less and less — the empty-fixture trap, which
    // across 24 files can also happen to a SUBSET without the total hitting 0.
    expect(configsWithAliasTable.size).toBeGreaterThanOrEqual(20);
    expect(packageAliasEntries.length).toBeGreaterThanOrEqual(180);
    expect(packageAliasEntries.map((e) => e.config)).toContain('apps/console/vite.config.ts');
    expect(packageAliasEntries.map((e) => e.specifier)).toContain('@object-ui/core');
  });

  it('every config that declares a resolve.alias table contributes at least one parsed entry', () => {
    // The subset form of the trap above: one config whose table stops parsing
    // is invisible in a 227-entry total, and a config contributing zero is
    // exactly what objectui#5158 measured for 15 configs at once.
    const contributing = new Set(packageAliasEntries.map((e) => e.config));

    expect(
      [...configsWithAliasTable].filter((config) => !contributing.has(config)).sort(),
      'These configs declare a `resolve.alias` table that yielded no entry at all, so the ' +
        'existence check below never sees them. That is a parser gap, not an empty table.'
    ).toEqual([]);
  });

  it('parses EVERY entry in every table, so none can dodge the existence check', () => {
    // Coverage, not style — the same case both halves above carry. An entry
    // written in some form the parser does not read would be skipped and
    // silently escape; here it is recorded and fails instead.
    expect(
      packageAliasParseGaps,
      'These `resolve.alias` entries could not be read as `resolve(__dirname, "<relative path>")`, ' +
        'so the target-exists check below never sees them. Use that form, or teach this test the new one.'
    ).toEqual([]);
  });

  it('covers all four spellings the package configs are written in', () => {
    // The load-bearing case. objectui#5158 measured what happens when a reader
    // understands one spelling: 15 configs contributed zero and the gate stayed
    // green — a green that meant "did not look". Each spelling must be
    // demonstrably reachable, so dropping support for one goes red HERE rather
    // than quietly shrinking the surface everything below rests on.
    const keyForms = new Set(packageAliasEntries.map((e) => e.keyForm));
    const calleeForms = new Set(packageAliasEntries.map((e) => e.calleeForm));

    expect(calleeForms, 'no entry is written as bare `resolve(__dirname, …)`').toContain('bare-resolve');
    expect(calleeForms, 'no entry is written as `path.resolve(__dirname, …)`').toContain('member-resolve');
    expect(keyForms, 'no entry is written with a double-quoted key').toContain('double-quoted');
    expect(keyForms, 'no entry is written in the array `{ find, replacement }` form').toContain('array-string');
  });

  it.each(packageAliasEntries.filter((entry) => !isCarvedOut(entry)))(
    '$config: $specifier resolves to a path that exists ($target)',
    ({ config, specifier, target, abs }) => {
      expect(
        packageAliasTargetExists(abs),
        `${config}: alias '${specifier}' points at ${target}, which does not exist in the workspace ` +
          '(not as a file, not as a directory, and not with any extension Vite probes). A ' +
          'dead alias never fails a test — nothing resolves through it — it just reads as if the ' +
          'package were wired up (objectui#3944, objectui#5168). Drop the entry, or add the target.'
      ).toBe(true);
    }
  );

  it('the objectui#5168 carve-out is empty, so no package alias entry is exempt', () => {
    // objectui#5380 was resolved by deleting the one carved-out line, so this
    // list is empty and the existence check above now covers every entry.
    //
    // ⚠️ Asserted rather than left implicit. With an empty list BOTH
    // expectations below are vacuous — each filters an empty list (or filters
    // by `isCarvedOut`, which is false for everything) and compares [] with [],
    // so neither can fail for ANY repo state. A silently vacuous pin is the
    // exact trap the `toBeGreaterThanOrEqual` cases at the top of this block
    // guard against, so the expectation that still bites at zero has to be
    // written down: emptiness itself. This one goes red the moment the list is
    // re-populated, which is the only way the two below become meaningful again.
    expect(
      KNOWN_MISSING_PACKAGE_ALIAS_TARGETS,
      'KNOWN_MISSING_PACKAGE_ALIAS_TARGETS is a shrink-only ratchet that reached empty when ' +
        'objectui#5380 landed. Re-populating it needs a card of its own — a new dead alias ' +
        'target is meant to go red in the existence check above, not to be carved out.'
    ).toEqual([]);

    const declared = KNOWN_MISSING_PACKAGE_ALIAS_TARGETS.filter((known) =>
      packageAliasEntries.some((e) => e.config === known.config && e.specifier === known.specifier)
    );

    expect(
      declared,
      'KNOWN_MISSING_PACKAGE_ALIAS_TARGETS names an entry that is no longer declared in its config. ' +
        'If it was resolved by deleting the line, delete it from the carve-out too.'
    ).toEqual([...KNOWN_MISSING_PACKAGE_ALIAS_TARGETS]);

    const nowResolving = packageAliasEntries.filter(
      (entry) => isCarvedOut(entry) && packageAliasTargetExists(entry.abs)
    );

    expect(
      nowResolving.map((e) => `${e.config}: ${e.specifier}`),
      'A carved-out target now exists, so the carve-out is obsolete for it — drop it from ' +
        'KNOWN_MISSING_PACKAGE_ALIAS_TARGETS so the entry is guarded like every other one.'
    ).toEqual([]);
  });
});
