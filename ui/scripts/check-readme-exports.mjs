#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every name a `packages/<pkg>/README.md` imports FROM ITS OWN PACKAGE must be a
 * name that package really exports.
 *
 * Run:  node scripts/check-readme-exports.mjs        (also `pnpm check:readme-exports`)
 *       node scripts/check-readme-exports.mjs --list  # every self-binding judged (exit 2 if unbuilt)
 *       node scripts/check-readme-exports.mjs --json
 *       node scripts/check-readme-exports.mjs --readme packages/plugin-gantt/README.md=/tmp/x.md
 * Exit: 0 = every self-import names a real export, 1 = a fabricated name, a
 *       wrong-path name, a package that cannot be judged, or a collapsed scan.
 *       `--list` adds 2 = PRECONDITION NOT MET: a tracked package is unbuilt, so
 *       the rows it printed are what this run could SEE and not a verdict. 1 and
 *       2 are separate because a caller that reads only the status otherwise
 *       cannot tell "the gate caught a fabricated name" from "the gate could not
 *       look" -- and before objectui#9220 that second state was not even an exit
 *       code, it was an uncaught TypeError in the formatter, which also left 1.
 *
 * ## The defect (objectui#5043, the root cause of the #5010-#5016 family)
 *
 * A README in `packages/<pkg>/` teaches `import { X } from '@object-ui/<pkg>'`.
 * Nothing checked that `<pkg>` exports `X`. `check-doc-links.mjs` parses links
 * and never looks inside a code block; `check-doc-component-types.mjs` scans
 * `content/docs` and never enters `packages/<pkg>/README.md`. So a name could be
 * invented, or survive the export that once backed it being renamed, and every
 * gate in the repository stayed green.
 *
 * These READMEs are listed in each package's `files`, so they ship in the npm
 * tarball. A reader who copies the snippet gets a `TypeError` at runtime or a
 * TS2305/TS2724 at build time. One manual sweep found drift in SEVEN packages
 * (#5010 calendar, #5011 form, gantt, grid, view, #5015 dashboard, #5016
 * report), and the person who did it recorded that number as a LOWER BOUND: the
 * method they had could only see single-line import statements.
 *
 * ## Why this is an AST walk and not a regex (measured, objectui#5043)
 *
 * The card's original sketch was one cross-line regex, comments stripped, split
 * on commas. Run on `plugin-gantt` it reported FIVE names that are not imports
 * at all -- `weeks`, `title`, `selection`, `target`, `dataSource` -- and MISSED
 * both real fabrications. The root cause is a shape this whole family of
 * READMEs uses: a SIDE-EFFECT import (`import '@object-ui/plugin-gantt';`, no
 * `from`). A lazy quantifier starting there runs on to the next
 * `from '@object-ui/plugin-gantt'` twenty lines later and swallows the prose
 * and a schema literal in between as an import clause. Stripping comments and
 * splitting on commas then happens to CONTAMINATED text, so words out of the
 * prose are reported as fabricated import names.
 *
 * Extracting fenced blocks and handing each to `ts.createSourceFile` does not
 * defend against those traps -- it makes them unrepresentable:
 *
 *   - a multi-line import block is ONE `ImportDeclaration` node, so no fence
 *     and no paragraph can end up inside an import clause;
 *   - a trailing `//` comment is trivia and can never contribute a name, which
 *     is the false positive the second prototype produced;
 *   - `A as B` gives `propertyName = A` and `name = B`, so the EXPORT name is
 *     available separately from the local alias. This gate judges
 *     `propertyName` -- `import { madeUp as Real }` is a fabrication of
 *     `madeUp`, and reporting it as `Real` would send the reader to the wrong
 *     word.
 *
 * ## Why the export set is symbols, and never a grep
 *
 * Same card, measured: `GanttSchema` grepped against `packages/types/src` has
 * six hits, so a grep-based check calls it real. All six are substrings of
 * `ObjectGanttSchema`; `\bGanttSchema\b` has zero. So the export set here comes
 * from the TypeScript checker's `getExportsOfModule` over the package's own
 * declared type entry -- the exact set a consumer's editor resolves.
 *
 * ALIASES ARE RESOLVED BEFORE THE VALUE/TYPE FLAGS ARE READ. `export { Foo }`
 * from a barrel is an Alias symbol that does NOT itself carry the Value flag,
 * so reading flags off the alias marks every re-export in the repo as
 * type-only. The prototype's first version did exactly that. The flags are a
 * census-and-hint field here rather than a verdict (a `import { T }` of a
 * type-only export is legal TypeScript), but a hint that lies is worse than no
 * hint, so the resolution is done properly and pinned by the test suite.
 *
 * ## Three states, because two of them have different fixes
 *
 *   real        the package exports that name.
 *   fabricated  no package in the workspace exports it. Delete or rename it.
 *   wrong-path  the name is real but belongs to ANOTHER package. #5010's
 *               `CalendarViewSchema` is this: it lives in `@object-ui/types`,
 *               and the fix is the import PATH, not the name. Collapsing it
 *               into "fabricated" tells the reader to delete a correct symbol.
 *
 * All three are reported; `fabricated` and `wrong-path` both FAIL.
 *
 * ## A package whose types are not on disk is a FAILURE, never a skip
 *
 * The export set is read from the package's declared type entry
 * (`exports['.'].types`, else `types`/`typings`), which for almost every
 * package here is a BUILT `dist/index.d.ts`. Two ways that file can be absent,
 * and both directions of silence are wrong:
 *
 *   - treating a missing entry as "this package exports nothing" makes every
 *     import in its README read as fabricated -- a wall of false reds that
 *     ends with the gate being deleted;
 *   - skipping it shrinks the judged population invisibly, which is the same
 *     defect this gate exists to close, one level up: a scan that quietly
 *     stops looking still prints a green.
 *
 * So a package is recorded in one of four states, all of them in the census:
 *   `read`          type entry declared and present -> exports read.
 *   `unbuilt`       type entry declared, file absent -> run the build.
 *   `no-type-entry` package declares no types at all (an app bundle, an
 *                   extension). Its README cannot teach a named import.
 *   `no-readme`     nothing to judge.
 * `unbuilt` and `no-type-entry` FAIL if -- and only if -- that package's README
 * actually carries a self-binding, which is the only case where the missing
 * exports would have changed a verdict. Either way the count is printed.
 *
 * ## Non-vacuity
 *
 * The tree is expected to be GREEN AT REST, so on an ordinary day this gate's
 * output is indistinguishable from a gate that does nothing -- which is the
 * defect it exists to catch. `FLOORS` turns a collapsed walk (no READMEs, no
 * import declarations, no export symbols) into a FAILURE, and the verdict line
 * carries the census rather than a bare OK. Same discipline as
 * `scripts/check-vi-mock-specifiers.mjs` (objectui#5646).
 *
 * ## The population is TRACKED files (objectui#6545)
 *
 * Both walks are `git ls-files -- packages/`, so the population is what git
 * TRACKS, not what is on disk. A brand-new `packages/<pkg>/README.md` written
 * but not yet `git add`-ed is outside it, and this gate reports OK without ever
 * having opened the file -- true of the population it scanned, and silent about
 * the one file its author was asking about. CI never sees this (a committed
 * tree has no untracked files); it bites only the local pre-flight, which is
 * exactly where an author runs a gate to avoid a red push.
 *
 * The verdict line therefore says `tracked` beside both counts, so a green
 * reads as "green over N tracked READMEs" rather than a claim about the
 * directory. Same wording, and the same reason, as
 * `scripts/check-control-bytes.mjs`, `scripts/check-vi-mock-specifiers.mjs` and
 * `scripts/check-vi-mock-inherit.mjs`. WIDENING the population to untracked
 * files, or refusing to run on a dirty worktree, would change what this gate
 * MEANS and is deliberately not done here -- that is a decision, not a patch.
 *
 * ## The second judgement: documented `interface` blocks, BOTH directions
 *
 * A README that writes out a type it also EXPORTS is making a second claim, and
 * the name check above cannot reach it. `interface GanttTask { ... }` standing
 * in a fenced block is a LOCAL declaration: it is unrelated to the shipped
 * `GanttTask`, it compiles green no matter what it says, and a tier that only
 * compiled the block would be green for the wrong reason (objectui#6214). So
 * every fenced block that declares `interface X { ... }` (or
 * `type X = { ... }`) where `X` is an export of that README's OWN package has
 * its documented property names compared against the shipped declaration's, in
 * BOTH directions:
 *
 *   fabricated-key   a key the block documents that the shipped type does not
 *                    have. A reader who copies it writes code that does not
 *                    type-check. Judged against the type's FULL property set,
 *                    inherited members included -- documenting a key that
 *                    arrives through `extends` is correct, not a fabrication.
 *   stale-omission   a key the shipped type has that the block never mentions.
 *                    This is the direction that makes the pin bidirectional,
 *                    and it is judged against the interface's OWN declared
 *                    members only: an excerpt of a type that extends a large
 *                    base is not stale for leaving the base's keys to the base's
 *                    own documentation.
 *
 * ONE DIRECTION PINS ONLY HALF, which is why both are here. `real -> doc` alone
 * misses optional keys the block invents; `doc -> real` alone misses required
 * keys the block drops. And a RENAME is only visible as the pair: the new
 * spelling reads as `fabricated-key` and the old one as `stale-omission` in the
 * same declaration, which no single direction reports.
 *
 * ### The bound this pin exists to cover, stated because it is narrow
 *
 * Measured on objectui#6214 and recorded on the card: THE TYPED-EXAMPLE HALF
 * CANNOT CARRY THE KEY-RENAME CLASS. Given
 * `const task: GanttTask = { name: ..., start: '2024-01-01' }`, TypeScript
 * reports two `TS2322` for the property-level type errors and NEVER the missing
 * `title` -- a property-level assignment error short-circuits the
 * missing-property detail. So compiling typed examples, however strictly, does
 * not see a renamed key on this family of blocks. THIS pin is what covers
 * renames on `interface` blocks, and nothing here promises more than that.
 *
 * ### Where it deliberately stops (first cut)
 *
 *   - METHOD SIGNATURES and INDEX SIGNATURES are counted and skipped, on both
 *     sides. `packages/types/README.md`'s `DataSource` is entirely method
 *     signatures, so it is resolved and compared over ZERO keys -- the census
 *     says so rather than letting it read as a verified declaration.
 *   - Property TYPES are not compared, only NAMES. That half belongs to a
 *     compile tier (see "Compiling the blocks" below).
 *   - `X` is resolved against the README's OWN package only. Measured on
 *     objectui#6214: widening to any workspace package would pull in
 *     `packages/plugin-detail/README.md`'s `DetailViewSchema` (owned by
 *     `@object-ui/types`) at 36 omissions in one declaration, most of them
 *     inherited `BaseSchema` members. That widening needs its own inheritance
 *     policy and its own card, not a quiet flag here.
 *
 * ### Declaring a deliberate excerpt -- two homes, two different claims
 *
 * A README may document part of a type on purpose. Two mechanisms, and they do
 * NOT mean the same thing:
 *
 *   PARTIAL_MARKER    an HTML comment in the README itself, above the fence,
 *                     naming the interface and carrying a reason. It says
 *                     "this excerpt is DELIBERATE". Grammar is deliberately the
 *                     same family as `check-doc-snippet-types.mjs`'s
 *                     `FRAGMENT_MARKER` (marker word, an em/en dash or colon,
 *                     then a reason of real length) so a reader who knows one
 *                     knows the other; the verb differs because the claim does
 *                     -- `doc-snippet: fragment` says a block cannot compile,
 *                     which must not double as permission to omit a key.
 *   PARTIAL_EXCERPTS  a ledger in THIS file. It says "this is DRIFT, it is
 *                     owed to a content card, and it is recorded rather than
 *                     inherited". Shrink-only: an entry naming a declaration
 *                     that no longer exists, or that no longer omits anything,
 *                     FAILS as stale, so the list can only get shorter.
 *
 * BOTH suppress `stale-omission` for one declaration and NEITHER suppresses
 * `fabricated-key`. An excerpt may leave a key out; it may not invent one, and
 * there is no reason a ledger entry should be able to hide that.
 *
 * THE SHRINK-ONLY RULE IS SUSPENDED WHERE NOTHING WAS COMPARED. "This entry
 * suppressed no omission" has two causes that look identical from the outside:
 * the README caught up (stale -- delete it), or the declaration could not be
 * judged at all because the package is unbuilt (still true -- keep it). Reading
 * the second as the first tells a reader to delete a correct entry, and it is
 * the reading CI gets by default: the test shards run `pnpm install` then
 * `pnpm test` and NEVER build, so on CI every declaration is unjudgeable.
 * Measured -- this gate's own first CI run went red exactly there. So a
 * declaration that comes back `unjudgeable-type` suspends the rule for its
 * marker and its ledger entry, both are counted as `not judged` in the census,
 * and the run still FAILS -- under `unjudgeable-type`, which names the real
 * problem, instead of under a stale-entry verdict that names the wrong one.
 *
 * ## Deliberately out of scope
 *
 * ### Compiling the blocks
 *
 * Extracting the code blocks and COMPILING them (objectui#5043's "stronger
 * tier") is NOT done here, and by objectui#6214's measurement it does not need
 * a second implementation: `scripts/check-doc-snippet-types.mjs` already
 * collects every `packages/<name>/README.md` into its scan surface and compiles
 * the ts/tsx blocks of the ones that are covered. Measured on that card:
 * 39 package READMEs in that gate's surface, 8 compiled today, 31 named in its
 * `UNGATED_DOCS` ledger with a reason -- a shrink-only debt list that
 * objectui#5174's batches are burning down. Building a second README compiler
 * here would duplicate that gate and split its ledger in two.
 *
 * The pin above is orthogonal to compilation and cheap: a documented
 * `interface` block compiles green whether or not it matches the shipped type,
 * so no amount of progress on that ledger reaches this class.
 *
 * ### The authorable-JSON key surface
 *
 * Invisible to both judgements, and documented on the card: authorable-JSON KEY
 * surfaces. `BaseSchema` carries an index signature and its Zod mirror is
 * `.passthrough()`, so no amount of type checking rejects an invented schema
 * key. That needs a third instrument, not a wider version of this one.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { isEntrypoint } from './invoked-as.mjs';

/** Fence info strings whose body is parsed as TypeScript/JavaScript. */
export const CODE_LANGS = Object.freeze([
  'ts',
  'tsx',
  'typescript',
  'typescriptreact',
  'mts',
  'cts',
  'js',
  'jsx',
  'javascript',
  'mjs',
  'cjs',
]);

const LANG_SET = new Set(CODE_LANGS);

/** Info strings that are JSX-flavoured, so the block is parsed as TSX. */
const JSX_LANGS = new Set(['tsx', 'jsx', 'typescriptreact']);

/**
 * Floors below which a green verdict is a claim about coverage rather than a
 * statement about the tree. Set with room: the point is to catch a walk that
 * COLLAPSED, not to pin today's numbers, which move with every package added.
 */
export const FLOORS = Object.freeze({
  readmes: 25,
  codeBlocks: 150,
  importBindings: 100,
  selfBindings: 40,
  packagesRead: 25,
  exportSymbols: 400,
  // The interface-pin walk, floored SEPARATELY so that it collapsing on its own
  // -- a change to `findDocumentedTypes`, a shape resolution that stops
  // returning properties -- fails and names itself, instead of hiding behind a
  // healthy import walk. These are an order smaller than the counters above
  // because the population genuinely is: measured on objectui#6214, 6
  // declarations in 5 blocks, 4 of them resolving to a shipped object type of
  // their own package, 52 keys compared. Floored well under that, because the
  // job is catching a walk that went to ZERO and not pinning today's numbers.
  typeDeclarations: 3,
  typesResolved: 2,
  keysCompared: 20,
});

/**
 * The declaration a README carries to say an excerpt is DELIBERATE.
 *
 *   <!-- readme-exports: partial GanttTask - why only these keys are shown -->
 *
 * Deliberately the same grammar family as `check-doc-snippet-types.mjs`'s
 * `FRAGMENT_MARKER`: a marker word, a dash or colon, then a reason that has to
 * be long enough to be one. Only the HTML spelling exists here -- these are
 * `README.md` files, not MDX, so the MDX expression-comment form that gate also
 * accepts (it cannot even be quoted inside a block comment like this one, which
 * is why `FRAGMENT_MARKER_EXAMPLES` is a string array over there) would render
 * as literal text to a reader on npm.
 *
 * It names the INTERFACE, which `FRAGMENT_MARKER` has no need to do: one fenced
 * block can declare several types (`packages/plugin-kanban/README.md` declares
 * `KanbanColumn` and `KanbanCard` in one block), and a marker that silenced a
 * whole block would silence the neighbour nobody looked at.
 */
export const PARTIAL_MARKER =
  /^[ \t]*<!--[ \t]*readme-exports:[ \t]*partial[ \t]+([A-Za-z_$][A-Za-z0-9_$]*)[ \t]*(?:\u2014|\u2013|--|-|:)[ \t]*(.+?)[ \t]*-->[ \t]*$/;

/** The marker, spelled out once, so a reader never has to read the regex. */
export const PARTIAL_MARKER_EXAMPLE =
  '<!-- readme-exports: partial GanttTask \u2014 why this block documents only some keys -->';

/** A reason shorter than this is a placeholder, not a reason. Same value, and
 *  the same argument, as `check-doc-snippet-types.mjs`'s `MIN_REASON_LENGTH`. */
export const MIN_PARTIAL_REASON = 12;

/**
 * Declarations whose `stale-omission` is RECORDED DEBT rather than a deliberate
 * excerpt, keyed `<readme path>::<InterfaceName>`.
 *
 * This is the other half of the pair described in the header: the marker above
 * lives in the README and says "deliberate"; this ledger lives here and says
 * "drift, owed to a content card". objectui#6214 wired this pin and was
 * explicitly not allowed to edit README CONTENT, so the drift its first run
 * found was written down here with the card number instead of being inherited
 * silently or fixed in the gate's own PR.
 *
 * EMPTY TODAY, and that is a state and not a retirement. objectui#7302 paid off
 * the three entries #6214 opened with: `plugin-gantt`'s `GanttTask` was a
 * genuine excerpt and moved to the in-README `PARTIAL_MARKER` above, and
 * `plugin-kanban`'s `KanbanColumn` and `KanbanCard` were staleness and were
 * brought up to the shipped declarations. ⛔ Do not delete this ledger because
 * it holds nothing: the next pin that finds drift it may not fix in its own PR
 * writes the entry here, exactly as #6214 did.
 *
 * SHRINK-ONLY, enforced rather than asked for: an entry whose declaration is no
 * longer in the README, or that no longer omits anything, FAILS as a stale
 * entry. Adding one is an edit a reviewer sees; removing one happens by fixing
 * the README.
 *
 * It suppresses `stale-omission` for that declaration and NOTHING else. A
 * `fabricated-key` is never excludable here -- see the header.
 *
 * The annotation is load-bearing while the ledger is empty: without it
 * `Object.freeze({})` infers `Readonly<{}>`, `Object.entries` hands the test
 * suite `unknown` values, and `pnpm type-check:scripts` fails TS18046 at the
 * case that reads each reason. Same spelling, and the same reason, as
 * `check-doc-snippet-types.mjs`'s `UNGATED_DOCS`.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PARTIAL_EXCERPTS = Object.freeze({});

/** The NUL that `git ls-files -z` delimits with, built from its code point. */
const NUL = String.fromCharCode(0);

/**
 * Every tracked `README.md` under `packages/`, package-root and nested alike.
 *
 * The card scoped this at "packages/<pkg>/README.md". Written as a git
 * pathspec that reads as exactly that, it ALSO matches four nested ones --
 * git's default pathspec is fnmatch without FNM_PATHNAME, so `*` crosses `/`.
 * Rather than tighten the glob and lose them, they are kept and resolved to
 * their OWNING package (`packageDirOf`): `packages/types/src/zod/README.md`
 * teaching `import { X } from '@object-ui/types'` is the same defect, and
 * `packages/types` ships its whole `src/` in the tarball. The filter is done
 * here in JS so the population is a stated rule rather than an accident of
 * which pathspec magic was in force.
 */
function trackedReadmes(root) {
  return execFileSync('git', ['ls-files', '-z', '--', 'packages/'], {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  })
    .toString('utf8')
    .split(NUL)
    .filter((file) => file.endsWith('/README.md'))
    .sort();
}

/**
 * Every `packages/<pkg>/` that carries a manifest.
 *
 * Enumerated in its OWN right and not derived from the README walk. The
 * wrong-path verdict needs to know which package owns a name, and a package
 * with no README would otherwise never have its exports read -- so a README
 * naming one of ITS symbols would be reported as `fabricated`, sending the
 * reader to delete a real export instead of correcting a path. Every package
 * here happens to have a README today, which is exactly why the difference
 * would have gone unnoticed; the fixture suite is what surfaced it.
 */
function trackedPackages(root) {
  return execFileSync('git', ['ls-files', '-z', '--', 'packages/'], {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  })
    .toString('utf8')
    .split(NUL)
    .filter((file) => /^packages\/[^/]+\/package\.json$/.test(file))
    .map(dirname)
    .sort();
}

/**
 * The package directory a README belongs to: the nearest ancestor carrying a
 * `package.json` with a `name`, never deeper than `packages/<pkg>`. Derived so
 * a nested README is judged against the package that actually publishes it.
 */
export function packageDirOf(root, readmePath) {
  let dir = dirname(readmePath);
  while (dir.startsWith('packages/') && dir !== 'packages') {
    const manifest = readJson(join(root, dir, 'package.json'));
    if (manifest?.name) return dir;
    dir = dirname(dir);
  }
  return null;
}

/**
 * Every fenced block in a markdown document.
 *
 * Written against the fence rules the CommonMark spec actually states, because
 * the shortcuts are what let a scan silently lose blocks: a closing fence must
 * be at least as long as the opening one (so a ```` ```` ```` block may CONTAIN
 * a ``` line), and it carries no info string. An unterminated fence is counted
 * rather than dropped -- it is a README bug in its own right, and a scan that
 * swallowed the rest of the file would report fewer imports with no sign why.
 *
 * @returns {{ lang: string, startLine: number, body: string, terminated: boolean }[]}
 *   `startLine` is the 1-based line of the OPENING fence, so a node at body
 *   line L sits on README line `startLine + L`.
 */
export function extractCodeBlocks(markdown) {
  const lines = markdown.split('\n');
  const blocks = [];
  let open = null;
  const FENCE = /^(\s{0,3})(`{3,}|~{3,})(.*)$/;

  for (let i = 0; i < lines.length; i++) {
    const m = FENCE.exec(lines[i]);
    if (open === null) {
      if (m) open = { char: m[2][0], len: m[2].length, info: m[3].trim(), startLine: i + 1, body: [] };
      continue;
    }
    const closes = m && m[2][0] === open.char && m[2].length >= open.len && m[3].trim() === '';
    if (closes) {
      blocks.push({ lang: open.info.split(/\s+/)[0].toLowerCase(), startLine: open.startLine, body: open.body.join('\n'), terminated: true });
      open = null;
      continue;
    }
    open.body.push(lines[i]);
  }
  if (open !== null) {
    blocks.push({ lang: open.info.split(/\s+/)[0].toLowerCase(), startLine: open.startLine, body: open.body.join('\n'), terminated: false });
  }
  return blocks;
}

/**
 * Every import binding one code block declares, as the AST reports them.
 *
 * `ImportDeclaration` and a re-exporting `ExportDeclaration` are both walked:
 * `export { X } from '@object-ui/pkg'` names an export of that package exactly
 * as an import does, and a README that re-exports a name it invented is the
 * same defect.
 *
 * `kind` separates what can be judged from what cannot:
 *   `named`      a named binding -- `exportName` is the name to judge.
 *   `default`    a default import; judged against the `default` export.
 *   `namespace`  `* as X`; the whole module, no name to judge.
 *   `side-effect` no clause at all. THIS is the shape that broke the regex
 *                approach, so it is counted explicitly rather than ignored.
 *
 * @returns {{ specifier: string, kind: string, exportName: string | null,
 *             local: string | null, typeOnly: boolean, line: number }[]}
 *   `line` is 1-based WITHIN the block body.
 */
export function findImportBindings(body, { jsx = false } = {}) {
  const source = ts.createSourceFile(
    jsx ? 'block.tsx' : 'block.ts',
    body,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const out = [];
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  // The line is taken from the NARROWEST node that carries the binding, not
  // from the declaration. A 14-name multi-line import is one node; reporting
  // the declaration's line for all fourteen sends the reader to `import {` and
  // makes them find the offending name themselves.
  const push = (node, specifier, kind, exportName, local, typeOnly) => {
    out.push({ specifier, kind, exportName, local, typeOnly, line: lineOf(node) });
  };

  const readNamed = (specifier, elements, clauseTypeOnly) => {
    for (const element of elements) {
      // `A as B` -> propertyName = A (the EXPORT name), name = B (the alias).
      // Judging B would name the reader's own variable, not the package's.
      const exportName = element.propertyName ? element.propertyName.text : element.name.text;
      push(element, specifier, 'named', exportName, element.name.text, clauseTypeOnly || Boolean(element.isTypeOnly));
    }
  };

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const specifierNode = statement.moduleSpecifier;
      if (!ts.isStringLiteral(specifierNode)) continue;
      const specifier = specifierNode.text;
      const clause = statement.importClause;
      if (!clause) {
        push(statement, specifier, 'side-effect', null, null, false);
        continue;
      }
      const clauseTypeOnly = Boolean(clause.isTypeOnly);
      if (clause.name) push(clause.name, specifier, 'default', 'default', clause.name.text, clauseTypeOnly);
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        push(bindings.name, specifier, 'namespace', null, bindings.name.text, clauseTypeOnly);
      } else if (bindings && ts.isNamedImports(bindings)) {
        readNamed(specifier, bindings.elements, clauseTypeOnly);
      }
      continue;
    }

    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      const specifierNode = statement.moduleSpecifier;
      if (!ts.isStringLiteral(specifierNode)) continue;
      const specifier = specifierNode.text;
      const clauseTypeOnly = Boolean(statement.isTypeOnly);
      const clause = statement.exportClause;
      if (clause && ts.isNamedExports(clause)) {
        readNamed(specifier, clause.elements, clauseTypeOnly);
      } else {
        // `export * from '…'` / `export * as ns from '…'` -- the whole module.
        push(statement, specifier, 'namespace', null, clause && ts.isNamespaceExport(clause) ? clause.name.text : null, clauseTypeOnly);
      }
    }
  }

  return out;
}

/**
 * Every type this code block DECLARES, as the AST reports them.
 *
 * Two shapes count, because READMEs use both for the same job:
 *   `interface X { ... }`   an `InterfaceDeclaration`.
 *   `type X = { ... }`      a `TypeAliasDeclaration` over a type LITERAL. An
 *                           alias to a union, a mapped type or a conditional is
 *                           not a property list, so it is not one of these and
 *                           is not counted as one.
 *
 * Members are separated rather than merged, so the census can say what was
 * skipped instead of a green implying it was checked:
 *   `keys`     property signatures -- the only ones compared.
 *   `methods`  method signatures. Skipped on both sides (see the header), but
 *              a documented method name still counts as "mentioned", so a
 *              shipped member with that name is not reported as omitted.
 *   `other`    index signatures, call/construct signatures, `get`/`set`. Only
 *              counted.
 *
 * Nested declarations are deliberately NOT walked: only top-level statements of
 * the block are read. A type declared inside a function body in an example is
 * the example's own scaffolding, not a claim about the package's surface.
 *
 * @returns {{ name: string, kind: 'interface' | 'type', keys: string[],
 *             methods: string[], other: number, line: number }[]}
 *   `line` is 1-based WITHIN the block body, the same convention
 *   `findImportBindings` uses.
 */
export function findDocumentedTypes(body, { jsx = false } = {}) {
  const source = ts.createSourceFile(
    jsx ? 'block.tsx' : 'block.ts',
    body,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const out = [];
  for (const statement of source.statements) {
    let name = null;
    let kind = null;
    let members = null;
    if (ts.isInterfaceDeclaration(statement)) {
      name = statement.name.text;
      kind = 'interface';
      members = statement.members;
    } else if (ts.isTypeAliasDeclaration(statement) && ts.isTypeLiteralNode(statement.type)) {
      name = statement.name.text;
      kind = 'type';
      members = statement.type.members;
    }
    if (name === null) continue;

    const keys = [];
    const methods = [];
    let other = 0;
    for (const member of members) {
      const memberName =
        member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) ? member.name.text : null;
      if (memberName !== null && ts.isPropertySignature(member)) keys.push(memberName);
      else if (memberName !== null && ts.isMethodSignature(member)) methods.push(memberName);
      else other++;
    }

    out.push({
      name,
      kind,
      keys,
      methods,
      other,
      line: source.getLineAndCharacterOfPosition(statement.getStart(source)).line + 1,
    });
  }
  return out;
}

/**
 * Every `PARTIAL_MARKER` line in a README, with the fence it declares.
 *
 * BINDING RULE, stated because the failure mode of getting it wrong is a marker
 * that silently declares nothing: a marker binds to the next fenced block whose
 * OPENING fence is the first following line that is neither blank nor another
 * marker. So a run of markers can sit above one block -- which a block
 * declaring two types needs -- and a marker stranded in prose binds to nothing
 * and is reported as `stray-partial-marker` rather than being ignored.
 *
 * @param {string} markdown
 * @param {{ startLine: number }[]} blocks Blocks from `extractCodeBlocks`.
 * @returns {{ line: number, name: string, reason: string, fence: number | null }[]}
 *   `line` is the 1-based README line of the marker; `fence` is the
 *   `startLine` of the block it binds to, or `null` when it binds to nothing.
 */
export function findPartialMarkers(markdown, blocks) {
  const lines = markdown.split('\n');
  const fences = new Set(blocks.map((block) => block.startLine));
  const markers = [];
  for (let i = 0; i < lines.length; i++) {
    const match = PARTIAL_MARKER.exec(lines[i]);
    if (!match) continue;
    let j = i + 1;
    while (j < lines.length && (lines[j].trim() === '' || PARTIAL_MARKER.test(lines[j]))) j++;
    markers.push({
      line: i + 1,
      name: match[1],
      reason: match[2].trim(),
      fence: j < lines.length && fences.has(j + 1) ? j + 1 : null,
    });
  }
  return markers;
}

/**
 * The type entry a consumer of this package resolves, as the package itself
 * declares it. Derived, never assumed to be `dist/index.d.ts`: `test-support`
 * points its `exports['.'].types` straight at `src/index.ts`, and reading that
 * one correctly is the difference between a real judgement and a false red.
 *
 * @returns {{ declared: string | null, path: string | null }}
 */
export function typeEntryOf(packageJson, packageDir) {
  const dot = packageJson?.exports?.['.'];
  const fromExports =
    typeof dot === 'object' && dot !== null
      ? dot.types ?? dot.import?.types ?? dot.require?.types ?? dot.default?.types
      : null;
  const declared = fromExports ?? packageJson?.types ?? packageJson?.typings ?? null;
  if (typeof declared !== 'string') return { declared: null, path: null };
  return { declared, path: resolve(packageDir, declared) };
}

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Compiler options for the export-surface program. */
const PROGRAM_OPTIONS = Object.freeze({
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  allowJs: true,
  skipLibCheck: true,
  noEmit: true,
  strict: false,
  resolveJsonModule: true,
  allowSyntheticDefaultImports: true,
  esModuleInterop: true,
});

/**
 * The property names a shipped export declares, in the two sets the two pin
 * directions need. `null` when the export is not a type with properties at all
 * (a value, a union alias, a function type), which is a fact about the export
 * and never a failure.
 *
 * `all` is `getPropertiesOfType`, so it INCLUDES inherited members; `own` is
 * read off the symbol's own declarations, so it does not. The header says why
 * each direction takes a different one. Interface MERGING is handled for free:
 * every declaration the symbol carries contributes to `own`.
 *
 * @returns {{ all: Set<string>, own: Set<string>, ownMethods: Set<string>,
 *             methods: Set<string> } | null}
 */
function shapeOf(checker, symbol) {
  if (!(symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias))) return null;
  let type;
  try {
    type = checker.getDeclaredTypeOfSymbol(symbol);
  } catch {
    return null;
  }
  if (!type || !(type.flags & ts.TypeFlags.Object)) return null;

  const all = new Set();
  const methods = new Set();
  for (const property of checker.getPropertiesOfType(type)) {
    all.add(property.name);
    const isMethod = property.declarations?.some(
      (declaration) => ts.isMethodSignature(declaration) || ts.isMethodDeclaration(declaration),
    );
    if (isMethod) methods.add(property.name);
  }

  const own = new Set();
  const ownMethods = new Set();
  for (const declaration of symbol.declarations ?? []) {
    let members = null;
    if (ts.isInterfaceDeclaration(declaration)) members = declaration.members;
    else if (ts.isTypeAliasDeclaration(declaration) && ts.isTypeLiteralNode(declaration.type)) {
      members = declaration.type.members;
    }
    if (members === null) continue;
    for (const member of members) {
      const name =
        member.name && (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)) ? member.name.text : null;
      if (name === null) continue;
      if (ts.isPropertySignature(member)) own.add(name);
      else if (ts.isMethodSignature(member)) ownMethods.add(name);
    }
  }
  return { all, own, ownMethods, methods };
}

/**
 * `entryPath -> Map<exportName, { isValue, isType, alias, shape }>`, from ONE
 * program over every entry at once (the packages import each other, so a
 * program per package would re-read the same declaration files 39 times).
 *
 * `shape` is `null` unless the name is listed for that entry in `shapesFor`.
 * Resolving a declared type is the expensive part and only the handful of names
 * a README actually writes out need it -- 6 of the 3292 export symbols on the
 * tree this landed against.
 *
 * @param {string[]} entryPaths
 * @param {{ shapesFor?: Map<string, Set<string>> }} [options]
 */
export function readExportSurfaces(entryPaths, { shapesFor = new Map() } = {}) {
  const surfaces = new Map();
  if (entryPaths.length === 0) return surfaces;

  const program = ts.createProgram({ rootNames: [...entryPaths], options: { ...PROGRAM_OPTIONS } });
  const checker = program.getTypeChecker();

  for (const entry of entryPaths) {
    const names = new Map();
    surfaces.set(entry, names);
    const wanted = shapesFor.get(entry) ?? new Set();
    const sourceFile = program.getSourceFile(entry);
    if (!sourceFile) continue;
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) continue;

    for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
      // Resolve the alias FIRST. `export { Foo } from './foo'` is an Alias
      // symbol with no Value flag of its own; reading flags off it marks every
      // re-export as type-only, which is what the prototype's first version did.
      const alias = Boolean(symbol.flags & ts.SymbolFlags.Alias);
      let resolved = symbol;
      if (alias) {
        try {
          resolved = checker.getAliasedSymbol(symbol) ?? symbol;
        } catch {
          resolved = symbol;
        }
      }
      names.set(symbol.name, {
        isValue: Boolean(resolved.flags & ts.SymbolFlags.Value),
        isType: Boolean(resolved.flags & (ts.SymbolFlags.Type | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Interface)),
        alias,
        shape: wanted.has(symbol.name) ? shapeOf(checker, resolved) : null,
      });
    }
  }
  return surfaces;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The gate's exit codes, named so that callers and tests can talk about them.
 * `couldNotRun` is the convention this repository already declared, in
 * `check-doc-snippet-types.mjs` and `check-skill-examples.mjs`, and it is here
 * for the reason it is there: a crash and "the gate read a verdict" both leave
 * through a non-zero exit, so the exit code stops discriminating exactly where
 * a caller needs it to (objectui#9220).
 *
 * ⛔ `readmesFailed` is NOT re-derived by anything; `main()` spells `1` out
 * literally and this member does not reach it. Read it as documentation of
 * that number, never as the thing that produces it -- AGENTS.md #9. What IS
 * mechanical is the one claim that matters here: `couldNotRun` must differ from
 * it, which `check-readme-exports.test.ts` asserts.
 */
export const EXIT_CODES = Object.freeze({
  /** Every judged binding and declaration held, and the population is real. */
  verified: 0,
  /** The gate RAN. A README or the ledger is at fault -- a verdict was read. */
  readmesFailed: 1,
  /** The gate COULD NOT RUN. Nothing it printed is a verdict about a README. */
  couldNotRun: 2,
});

/**
 * ONE row shape for `documentedTypes`, whatever the verdict (objectui#9220).
 *
 * Four call sites push into that array and three of them used to push a bare
 * `{ ...site, verdict }`, so whether a consumer could read `row.fabricated`
 * depended on which branch produced the row. `--list` guarded that read with a
 * whitelist of two literal verdicts -- and a whitelist enumerated by verdict
 * cannot express a fact about FIELDS: the third bare shape, `unjudgeable-type`,
 * was not in it and the formatter died reading `undefined.length` on precisely
 * the unbuilt tree the gate's own failure text sends a developer to inspect.
 *
 * So the repair is not another string in that whitelist. Every row carries
 * every field, and the verdict goes back to governing PRESENTATION -- whether
 * this census detail is worth printing -- instead of SAFETY. `compared` is what
 * the presentation side reads, and it is the honest question: a row that
 * compared nothing has zeroes and empty arrays, and printing "0 of 0" for it
 * would state a comparison that never happened.
 *
 * @typedef {{ file: string, line: number, package: string | null, typeName: string, kind: string }} DocumentedTypeSite
 * @typedef {DocumentedTypeSite & {
 *   verdict: string,
 *   compared: boolean,
 *   documented: number,
 *   documentedMethods: number,
 *   otherMembers: number,
 *   shippedOwn: number,
 *   shippedAll: number,
 *   fabricated: string[],
 *   omitted: string[],
 *   excerpt: string | null,
 * }} DocumentedTypeRow
 *
 * @param {DocumentedTypeSite} site The README site: file, line, package, typeName, kind.
 * @param {string} verdict
 * @param {Partial<DocumentedTypeRow>} [detail] The measured half, at the ONE call site that compares.
 * @returns {DocumentedTypeRow}
 */
function documentedTypeRow(site, verdict, detail = undefined) {
  return {
    ...site,
    verdict,
    // `compared: false` and the zeroes below are not placeholders for a
    // measurement that is coming -- they are the measurement. Nothing was
    // compared, so nothing was documented against, fabricated or omitted.
    compared: detail !== undefined,
    documented: 0,
    documentedMethods: 0,
    otherMembers: 0,
    shippedOwn: 0,
    shippedAll: 0,
    fabricated: [],
    omitted: [],
    excerpt: null,
    ...detail,
  };
}

/**
 * The one scan. `main()`, `--list`, `--json` and the test suite all go through
 * here, so the tests exercise the real code path rather than an imitation.
 *
 * @param {string} root Repository root.
 * @param {{ readmes?: string[] | null,
 *           packageDirs?: string[] | null,
 *           readmeOverrides?: Record<string, string>,
 *           floors?: Record<string, number>,
 *           excerpts?: Record<string, string> }} [options]
 *   `readmes` and `packageDirs` override the two `git ls-files` walks. `readmeOverrides` maps a
 *   README path (`packages/plugin-gantt/README.md`) to a file that stands in
 *   for it -- which is how the planted-mutation self-test runs without ever
 *   writing to the working tree. `floors` overrides `FLOORS`; pass `{}` to
 *   switch the collapse check off for a fixture tree. `excerpts` overrides
 *   `PARTIAL_EXCERPTS`; pass `{}` to judge the tree with the debt ledger OFF,
 *   which is how the ablation below shows a red the ledger is not hiding.
 */
export function scan(
  root,
  { readmes = null, packageDirs = null, readmeOverrides = {}, floors = FLOORS, excerpts = PARTIAL_EXCERPTS } = {},
) {
  const readmeFiles = readmes ?? trackedReadmes(root);

  // 1. Every package, its declared type entry, and its state. The whole
  //    workspace, not only the packages that happen to carry a README --
  //    see `trackedPackages`.
  const packages = new Map(); // packageDir -> record
  for (const packageDir of packageDirs ?? trackedPackages(root)) {
    const manifest = readJson(join(root, packageDir, 'package.json'));
    const { declared, path } = typeEntryOf(manifest, join(root, packageDir));
    packages.set(packageDir, {
      dir: packageDir,
      name: manifest?.name ?? null,
      declaredEntry: declared,
      entryPath: path,
      state: declared === null ? 'no-type-entry' : isFile(path) ? 'read' : 'unbuilt',
      readmes: [],
      selfBindings: 0,
    });
  }

  const ownerOf = new Map(); // readme path -> packageDir
  const orphans = [];
  for (const readme of readmeFiles) {
    const packageDir = packageDirOf(root, readme);
    if (packageDir === null || !packages.has(packageDir)) {
      orphans.push(readme);
      continue;
    }
    ownerOf.set(readme, packageDir);
    packages.get(packageDir).readmes.push(readme);
  }

  // 2. Read every README ONCE, up front. The interface pin needs to know which
  //    names to resolve declared types for BEFORE the program is built (see
  //    `readExportSurfaces`), and re-reading and re-parsing every block for a
  //    second walk would double the cost of the expensive half of this gate.
  const documents = [];
  const shapesFor = new Map(); // entryPath -> Set<name>
  for (const readme of readmeFiles) {
    const record = packages.get(ownerOf.get(readme));
    if (!record) continue; // an orphan README -- counted, never judged
    const override = readmeOverrides[readme];
    let markdown;
    try {
      markdown = readFileSync(override ?? join(root, readme), 'utf8');
    } catch {
      continue;
    }
    const blocks = extractCodeBlocks(markdown).map((block) => ({
      ...block,
      code: LANG_SET.has(block.lang),
      jsx: JSX_LANGS.has(block.lang),
    }));
    for (const block of blocks) {
      block.documentedTypes = block.code ? findDocumentedTypes(block.body, { jsx: block.jsx }) : [];
      if (record.state !== 'read' || record.entryPath === null) continue;
      for (const declared of block.documentedTypes) {
        if (!shapesFor.has(record.entryPath)) shapesFor.set(record.entryPath, new Set());
        shapesFor.get(record.entryPath).add(declared.name);
      }
    }
    documents.push({ readme, record, markdown, blocks, markers: findPartialMarkers(markdown, blocks) });
  }

  // 3. One program over every entry that is actually on disk.
  const entryPaths = [...packages.values()].filter((p) => p.state === 'read').map((p) => p.entryPath);
  const surfaces = readExportSurfaces(entryPaths, { shapesFor });

  /** `exportName -> package names that export it`, for the wrong-path verdict. */
  const nameOwners = new Map();
  let exportSymbols = 0;
  for (const record of packages.values()) {
    if (record.state !== 'read') continue;
    const names = surfaces.get(record.entryPath) ?? new Map();
    record.exportCount = names.size;
    exportSymbols += names.size;
    for (const name of names.keys()) {
      if (!nameOwners.has(name)) nameOwners.set(name, []);
      nameOwners.get(name).push(record.name ?? record.dir);
    }
  }

  // 4. Walk each README.
  const bindings = [];
  const findings = [];
  const documentedTypes = [];
  const usedExcerpts = new Set();
  /**
   * Declarations that could not be judged at all, keyed the two ways the two
   * excerpt mechanisms are: `<readme>::<Name>` for the ledger,
   * `<fence line>::<Name>` for a marker. Membership SUSPENDS the shrink-only
   * rule rather than satisfying it -- see the `unjudgeable-type` branch.
   */
  const notJudged = new Set();
  const notJudgedMarkers = new Set();
  const counters = {
    codeBlocks: 0,
    codeBlocksParsed: 0,
    codeBlocksUntagged: 0,
    codeBlocksUnterminated: 0,
    importBindings: 0,
    selfBindings: 0,
    sideEffect: 0,
    namespace: 0,
    deepSelf: 0,
    external: 0,
    real: 0,
    fabricated: 0,
    wrongPath: 0,
    typeDeclarations: 0,
    typeBlocks: 0,
    typesResolved: 0,
    typesLocal: 0,
    typesNotAShape: 0,
    typesUnjudgeable: 0,
    typesCompared: 0,
    typesComparedOverZeroKeys: 0,
    keysCompared: 0,
    fabricatedKeys: 0,
    staleOmissions: 0,
    partialDeclared: 0,
    partialLedgered: 0,
    partialMarkers: 0,
    excerptsOutOfPopulation: 0,
    excerptsNotJudged: 0,
  };

  for (const { readme, record, blocks, markers } of documents) {
    const excerptFor = new Map(); // `<fence line>::<name>` -> { source, reason, line }
    const usedMarkers = new Set();
    for (const marker of markers) {
      counters.partialMarkers++;
      if (marker.fence === null) {
        findings.push({
          verdict: 'stray-partial-marker',
          file: readme,
          line: marker.line,
          package: record.name,
          typeName: marker.name,
          reason: marker.reason,
        });
        continue;
      }
      if (marker.reason.length < MIN_PARTIAL_REASON) {
        findings.push({
          verdict: 'partial-marker-no-reason',
          file: readme,
          line: marker.line,
          package: record.name,
          typeName: marker.name,
          reason: marker.reason,
        });
        continue;
      }
      excerptFor.set(`${marker.fence}::${marker.name}`, { source: 'marker', reason: marker.reason, line: marker.line });
    }

    for (const block of blocks) {
      counters.codeBlocks++;
      if (!block.terminated) counters.codeBlocksUnterminated++;
      if (block.lang === '') counters.codeBlocksUntagged++;
      if (!block.code) continue;
      counters.codeBlocksParsed++;

      // ── the interface pin ────────────────────────────────────────────────
      if (block.documentedTypes.length > 0) counters.typeBlocks++;
      for (const declared of block.documentedTypes) {
        counters.typeDeclarations++;
        const site = {
          file: readme,
          line: block.startLine + declared.line,
          package: record.name,
          typeName: declared.name,
          kind: declared.kind,
        };
        if (record.state !== 'read') {
          // Tier 1's rule, and for the same reason one paragraph over: with no
          // export surface on disk EVERY documented type would read as a local
          // helper, so the pin would report a serene `local-declaration` for a
          // block it never judged. Scoped exactly as the import side is -- it
          // only fails where the missing surface would have changed a verdict,
          // which is precisely "this block declares a type".
          counters.typesUnjudgeable++;
          documentedTypes.push(documentedTypeRow(site, 'unjudgeable-type'));
          findings.push({ ...site, verdict: 'unjudgeable-type', reason: record.state, declaredEntry: record.declaredEntry });
          // AND the shrink-only rule is suspended for whatever declared this
          // declaration an excerpt. An entry or a marker here suppressed nothing
          // -- but only because NOTHING WAS COMPARED, not because the README
          // caught up, and those two are opposite facts that must not share a
          // verdict. Reporting `stale-excerpt-entry` on an unbuilt tree tells a
          // reader to DELETE a ledger entry that is still true, and it is the
          // reading CI gets: the test shards run `pnpm install` then
          // `pnpm test` and never build, so on CI every declaration here is
          // unjudgeable. Measured on objectui#6214's own first CI run --
          // `Test (shard 2/4)` red with three of them.
          const unjudgedLedgerKey = `${readme}::${declared.name}`;
          const unjudgedMarkerKey = `${block.startLine}::${declared.name}`;
          notJudged.add(unjudgedLedgerKey);
          notJudgedMarkers.add(unjudgedMarkerKey);
          // Counted only where an excerpt was actually DECLARED. Incrementing on
          // every unjudgeable declaration would make the census read as excerpt
          // debt that does not exist -- the number has to mean "claims this run
          // could not check", not "declarations this run could not judge", which
          // `typesUnjudgeable` already says.
          if (excerptFor.has(unjudgedMarkerKey) || Object.prototype.hasOwnProperty.call(excerpts, unjudgedLedgerKey)) {
            counters.excerptsNotJudged++;
          }
          continue;
        }
        const surface = surfaces.get(record.entryPath) ?? new Map();
        const hit = surface.get(declared.name);
        if (!hit) {
          // Not an export of THIS package. A README is free to declare a local
          // helper type of any name, so this is a fact for the census and never
          // a failure. (Whether a name owned by ANOTHER package should be
          // judged here is measured in the header and deliberately not done.)
          counters.typesLocal++;
          documentedTypes.push(documentedTypeRow(site, 'local-declaration'));
          continue;
        }
        if (!hit.shape) {
          counters.typesNotAShape++;
          documentedTypes.push(documentedTypeRow(site, 'not-a-property-type'));
          continue;
        }
        counters.typesResolved++;

        const documentedKeys = new Set(declared.keys);
        const mentioned = new Set([...declared.keys, ...declared.methods]);
        const fabricated = declared.keys.filter((key) => !hit.shape.all.has(key));
        const omitted = [...hit.shape.own].filter((key) => !mentioned.has(key));
        counters.typesCompared++;
        counters.keysCompared += documentedKeys.size + hit.shape.own.size;
        if (documentedKeys.size === 0) counters.typesComparedOverZeroKeys++;

        const ledgerKey = `${readme}::${declared.name}`;
        const markerKey = `${block.startLine}::${declared.name}`;
        const excerpt =
          excerptFor.get(markerKey) ??
          (Object.prototype.hasOwnProperty.call(excerpts, ledgerKey)
            ? { source: 'ledger', reason: excerpts[ledgerKey] }
            : null);

        if (fabricated.length > 0) {
          // NEVER suppressed by an excerpt declaration -- see the header.
          counters.fabricatedKeys += fabricated.length;
          findings.push({ ...site, verdict: 'fabricated-key', keys: fabricated, shipped: [...hit.shape.all] });
        }
        if (omitted.length > 0) {
          // A declaration is only "used" when it actually SUPPRESSED something.
          // Marking it used on a match would let an entry whose drift is already
          // fixed sit here forever, which is the stale-entry case one line down.
          if (excerpt === null) {
            counters.staleOmissions += omitted.length;
            findings.push({ ...site, verdict: 'stale-omission', keys: omitted });
          } else if (excerpt.source === 'marker') {
            counters.partialDeclared++;
            usedMarkers.add(markerKey);
          } else {
            counters.partialLedgered++;
            usedExcerpts.add(ledgerKey);
          }
        }
        documentedTypes.push(
          documentedTypeRow(
            site,
            fabricated.length > 0 ? 'fabricated-key' : omitted.length === 0 ? 'matches' : excerpt === null ? 'stale-omission' : `partial-${excerpt.source}`,
            {
              documented: declared.keys.length,
              documentedMethods: declared.methods.length,
              otherMembers: declared.other,
              shippedOwn: hit.shape.own.size,
              shippedAll: hit.shape.all.size,
              fabricated,
              omitted,
              excerpt: excerpt === null ? null : excerpt.source,
            },
          ),
        );
      }

      for (const binding of findImportBindings(block.body, { jsx: block.jsx })) {
        // `...binding` FIRST: it carries its own block-relative `line`, and
        // spreading it last silently overwrote the README line number with it.
        const site = { ...binding, file: readme, line: block.startLine + binding.line, package: record.name };

        counters.importBindings++;
        if (binding.kind === 'side-effect') counters.sideEffect++;
        if (binding.kind === 'namespace') counters.namespace++;

        const isSelf = record.name !== null && binding.specifier === record.name;
        const isDeepSelf = record.name !== null && binding.specifier.startsWith(`${record.name}/`);
        if (isDeepSelf) counters.deepSelf++;
        if (!isSelf) {
          if (!isDeepSelf) counters.external++;
          bindings.push({ ...site, verdict: 'not-self' });
          continue;
        }
        if (binding.exportName === null) {
          bindings.push({ ...site, verdict: 'no-name' });
          continue;
        }

        counters.selfBindings++;
        record.selfBindings++;

        // Every finding carries the SAME key set, `owners`/`reason` included.
        // Three differently-shaped literals here infer as a union, and the
        // pin tests then cannot read a field without narrowing first.
        const finding = (verdict, extra) => ({
          ...site,
          verdict,
          owners: [],
          reason: null,
          declaredEntry: record.declaredEntry,
          ...extra,
        });

        if (record.state !== 'read') {
          bindings.push({ ...site, verdict: 'unjudgeable' });
          findings.push(finding('unjudgeable', { reason: record.state }));
          continue;
        }

        const names = surfaces.get(record.entryPath) ?? new Map();
        const hit = names.get(binding.exportName);
        if (hit) {
          counters.real++;
          bindings.push({ ...site, verdict: 'real', ...hit });
          continue;
        }
        const owners = (nameOwners.get(binding.exportName) ?? []).filter((owner) => owner !== record.name);
        if (owners.length > 0) {
          counters.wrongPath++;
          bindings.push({ ...site, verdict: 'wrong-path', owners });
          findings.push(finding('wrong-path', { owners }));
        } else {
          counters.fabricated++;
          bindings.push({ ...site, verdict: 'fabricated' });
          findings.push(finding('fabricated'));
        }
      }
    }

    // A marker whose declaration matches the shipped type is a stale marker: it
    // reads as "this excerpt is deliberate" over a block that is now complete,
    // and leaving it there is how a declaration outlives the fact it declared.
    // Same shrink-only rule as the ledger below.
    for (const [key, excerpt] of excerptFor) {
      if (usedMarkers.has(key)) continue;
      if (notJudgedMarkers.has(key)) continue; // suspended, not satisfied -- see above
      findings.push({
        verdict: 'stale-partial-marker',
        file: readme,
        line: excerpt.line,
        package: record.name,
        typeName: key.split('::')[1] ?? null,
        reason: excerpt.reason,
      });
    }
  }

  // A ledger entry that no longer describes a drifting declaration is a stale
  // entry, and stale entries are how a shrink-only list quietly stops shrinking.
  // Same rule, and the same reason, as `check-doc-snippet-types.mjs` re-deriving
  // `UNGATED_DOCS` on every run.
  //
  // SCOPED TO THE POPULATION THIS SCAN ACTUALLY WALKED, which is not a
  // convenience: an entry naming a README the walk never opened has not been
  // shown to be stale, it has not been LOOKED at, and reporting the two the
  // same way is the silent-skip defect this gate exists to catch, inverted. On
  // the full tracked walk the distinction still bites -- there, a README that
  // is not in the population is one that no longer exists or is no longer
  // tracked, so the entry is dead and says so under its own verdict.
  const walked = new Set(documents.map((document) => document.readme));
  for (const key of Object.keys(excerpts)) {
    if (usedExcerpts.has(key)) continue;
    if (notJudged.has(key)) continue; // suspended, not satisfied -- see above
    const [file, typeName] = key.split('::');
    const entry = { file: file ?? key, line: 0, package: null, typeName: typeName ?? null, reason: excerpts[key] };
    if (walked.has(entry.file)) {
      findings.push({ ...entry, verdict: 'stale-excerpt-entry' });
    } else if (readmes === null) {
      findings.push({ ...entry, verdict: 'orphan-excerpt-entry' });
    } else {
      counters.excerptsOutOfPopulation++;
    }
  }

  const states = { read: 0, unbuilt: 0, 'no-type-entry': 0 };
  for (const record of packages.values()) states[record.state]++;

  const census = {
    readmes: readmeFiles.length,
    readmesOrphaned: orphans.length,
    packages: packages.size,
    packagesWithReadme: [...packages.values()].filter((p) => p.readmes.length > 0).length,
    packagesRead: states.read,
    packagesUnbuilt: states.unbuilt,
    packagesNoTypeEntry: states['no-type-entry'],
    exportSymbols,
    ...counters,
  };

  const vacuous = [];
  for (const [counter, floor] of Object.entries(floors)) {
    if (census[counter] < floor) vacuous.push({ counter, value: census[counter], floor });
  }

  return { census, packages: [...packages.values()], orphans, bindings, documentedTypes, findings, vacuous };
}

/**
 * `--list`, as data: the rows it prints, the notices it prints to stderr, and
 * the code it leaves through. Split out of the entry point so the pin tests can
 * drive it over a FIXTURE tree -- the entry point can only ever scan
 * `repoRoot()`, and a build state is not something a test may arrange there.
 *
 * ## The two jobs the old formatter had jammed into one ternary (objectui#9220)
 *
 * SAFETY -- may these fields be read at all -- is now settled for every row by
 * `documentedTypeRow`, upstream of here and independent of the verdict.
 * PRESENTATION -- is this census detail worth printing -- is what is left, and
 * it reads `compared`, which is the fact it is actually asking about.
 *
 * ## Why a listing can refuse
 *
 * `--list` is this gate's own documented diagnostic, and the state a developer
 * reaches for it in is the state where the gate just failed. On an unbuilt tree
 * it used to die on the first declaration it could not judge: no rows past that
 * one, no census, and nothing naming the precondition -- while its exit code,
 * 1, was the same code the gate uses to report a genuinely fabricated name.
 *
 * So it prints everything it has AND THEN refuses, the way
 * `check-doc-snippet-types.mjs` already does for the same state: the rows are
 * what this run could see, the notice says they are not a verdict, and
 * `EXIT_CODES.couldNotRun` carries that difference to a caller that only reads
 * the status.
 *
 * @param {ReturnType<typeof scan>} result
 * @returns {{ rows: string[], notices: string[], exitCode: number }}
 */
export function renderList(result) {
  const rows = [];
  for (const b of result.bindings) {
    if (b.verdict === 'not-self') continue;
    const mark = b.verdict.padEnd(17);
    rows.push(`${mark}  ${b.file}:${b.line}  ${b.exportName ?? `(${b.kind})`}  <- ${b.specifier}`);
  }
  for (const t of result.documentedTypes) {
    const mark = t.verdict.padEnd(17);
    const detail = t.compared
      ? `  doc ${t.documented} key(s) + ${t.documentedMethods} method(s) vs own ${t.shippedOwn} of ${t.shippedAll}` +
        (t.fabricated.length > 0 ? `  fabricated: ${t.fabricated.join(', ')}` : '') +
        (t.omitted.length > 0 ? `  omitted: ${t.omitted.join(', ')}` : '')
      : '';
    rows.push(`${mark}  ${t.file}:${t.line}  ${t.kind} ${t.typeName}${detail}`);
  }
  rows.push('');
  rows.push(summarise(result));

  // Every unbuilt package, not only the ones carrying a README. An unbuilt
  // package contributes no names to `nameOwners`, so a README import of a name
  // that package really does export is judged `fabricated` instead of
  // `wrong-path` -- a package with no README of its own still moves verdicts in
  // other packages' rows. `no-type-entry` is deliberately NOT here: no build
  // fixes it, and it is a verdict about the manifest rather than a precondition.
  const unbuilt = result.packages.filter((p) => p.state === 'unbuilt');
  if (unbuilt.length === 0) return { rows, notices: [], exitCode: EXIT_CODES.verified };

  const named = unbuilt.map((p) => p.name ?? p.dir);
  // A scoped filter list stops being a scoping when it names the whole
  // population -- at that point it is `pnpm build` spelled out at forty times
  // the length, and a developer who has to edit the line before running it has
  // been handed a worse command, not a more precise one.
  const buildCommand =
    unbuilt.length === result.packages.length
      ? 'pnpm build'
      : `pnpm exec turbo run build ${named.map((n) => `--filter ${n}`).join(' ')} --concurrency=2`;

  const notices = [
    `\nPRECONDITION NOT MET (exit ${EXIT_CODES.couldNotRun}) — the rows above are NOT a verdict about any README.`,
    `${unbuilt.length} of ${result.packages.length} tracked package(s) declare a type entry that is not on disk, so ` +
      'their export surface was never read. Every declaration owned by one of them is listed above as ' +
      '`unjudgeable-type` with no census detail, and an import of a name one of them really does export reads ' +
      'above as `fabricated` rather than `wrong-path`.',
    `This is "I could not run", NOT "I ran and found a fabricated name" (exit ${EXIT_CODES.readmesFailed}). ` +
      'Build what the gate needs, then re-run:\n\n' +
      `  ${buildCommand}\n` +
      '  node scripts/check-readme-exports.mjs --list\n',
    'The package(s) that are not built:',
    ...unbuilt.map((p) => `  ${(p.name ?? p.dir).padEnd(38)} ${p.dir}  declares \`${p.declaredEntry}\``),
    '',
  ];
  return { rows, notices, exitCode: EXIT_CODES.couldNotRun };
}

function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

/** The census, as one line, for the verdict. */
export function summarise({ census }) {
  return (
    `${census.readmes} tracked README(s) under packages/ (${census.readmesOrphaned} outside any package), ` +
    `${census.codeBlocks} fenced block(s) ` +
    `(${census.codeBlocksParsed} parsed as code, ${census.codeBlocksUntagged} untagged); ` +
    `${census.importBindings} import binding(s), ${census.selfBindings} of them self-imports judged ` +
    `(${census.real} real, ${census.wrongPath} wrong-path, ${census.fabricated} fabricated); ` +
    `${census.exportSymbols} export symbol(s) read from ${census.packagesRead} of ${census.packages} tracked package(s) ` +
    `(${census.packagesWithReadme} carry a README) ` +
    `(${census.packagesUnbuilt} unbuilt, ${census.packagesNoTypeEntry} declare no types); ` +
    `${census.sideEffect} side-effect import(s), ${census.namespace} namespace, ${census.deepSelf} deep self-path, ` +
    `${census.external} to other packages; ` +
    // The interface pin, censused in the same line and with the same rule: the
    // numbers that say what was SKIPPED travel beside the ones that say what was
    // judged, so a green cannot be read as more coverage than it is.
    `${census.typeDeclarations} documented type(s) in ${census.typeBlocks} block(s) ` +
    `(${census.typesResolved} resolve to a shipped shape of their own package, ` +
    `${census.typesLocal} local, ${census.typesNotAShape} not a property type, ` +
    `${census.typesUnjudgeable} unjudgeable), ` +
    `${census.keysCompared} key(s) compared both ways ` +
    `(${census.fabricatedKeys} fabricated, ${census.staleOmissions} stale omission(s); ` +
    `${census.partialDeclared} excerpt(s) declared by marker, ${census.partialLedgered} by ledger, ` +
    `${census.excerptsNotJudged} not judged; ` +
    `${census.typesComparedOverZeroKeys} compared over ZERO documented keys)`
  );
}

/** Parses `--readme packages/x/README.md=/path/to.md` (repeatable) out of argv. */
export function parseReadmeOverrides(argv) {
  const overrides = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--readme') continue;
    const [dir, ...rest] = (argv[i + 1] ?? '').split('=');
    if (!dir || rest.length === 0) {
      throw new Error('--readme needs `<readmePath>=<path>`, e.g. --readme packages/plugin-gantt/README.md=/tmp/x.md');
    }
    overrides[dir] = rest.join('=');
  }
  return overrides;
}

function main(overrides) {
  const result = scan(repoRoot(), { readmeOverrides: overrides });
  const { findings, vacuous } = result;

  if (findings.length === 0 && vacuous.length === 0) {
    console.log(`✅  check-readme-exports: OK (${summarise(result)}).`);
    process.exit(0);
  }

  const fabricated = findings.filter((f) => f.verdict === 'fabricated');
  const wrongPath = findings.filter((f) => f.verdict === 'wrong-path');
  const unjudgeable = findings.filter((f) => f.verdict === 'unjudgeable');
  const fabricatedKeys = findings.filter((f) => f.verdict === 'fabricated-key');
  const staleOmissions = findings.filter((f) => f.verdict === 'stale-omission');
  const markerProblems = findings.filter(
    (f) => f.verdict === 'stray-partial-marker' || f.verdict === 'partial-marker-no-reason' || f.verdict === 'stale-partial-marker',
  );
  const staleEntries = findings.filter(
    (f) => f.verdict === 'stale-excerpt-entry' || f.verdict === 'orphan-excerpt-entry',
  );
  const unjudgeableTypes = findings.filter((f) => f.verdict === 'unjudgeable-type');

  if (fabricated.length > 0) {
    console.error(`❌  check-readme-exports: ${fabricated.length} README import name(s) NO package exports\n`);
    console.error('  These READMEs ship in the npm tarball. A reader who copies the snippet');
    console.error('  gets TS2305/TS2724 at build time or a TypeError at runtime:\n');
    for (const f of fabricated) {
      console.error(`    - ${f.file}:${f.line} -- import { ${f.exportName} } from '${f.specifier}'`);
    }
    console.error('\n  Fix the README, or export the name. The judged name is the EXPORT name:');
    console.error("  in `import { madeUp as Real }` the fabrication is `madeUp`.\n");
  }

  if (wrongPath.length > 0) {
    console.error(`❌  check-readme-exports: ${wrongPath.length} README import name(s) belong to ANOTHER package\n`);
    console.error('  The name is real. The PATH is wrong -- do not delete the symbol:\n');
    for (const f of wrongPath) {
      console.error(`    - ${f.file}:${f.line} -- '${f.exportName}' is exported by ${f.owners.join(', ')}, not by ${f.package}`);
    }
    console.error('');
  }

  if (unjudgeable.length > 0) {
    console.error(`❌  check-readme-exports: ${unjudgeable.length} self-import(s) could not be judged\n`);
    for (const f of unjudgeable) {
      const why =
        f.reason === 'unbuilt'
          ? `its type entry \`${f.declaredEntry}\` is not on disk -- run \`pnpm build\` first`
          : 'its package declares no `types` entry at all, so it publishes no named exports to import';
      console.error(`    - ${f.file}:${f.line} -- ${f.package} imports '${f.exportName}', but ${why}`);
    }
    console.error(`
This is a FAILURE and not a skip on purpose. Counting a missing type entry as
"exports nothing" would mark every one of these fabricated; skipping it would
shrink the judged population with nothing in the output to say so. Both are the
defect this gate exists to catch, one level up.
`);
  }

  if (fabricatedKeys.length > 0) {
    console.error(`❌  check-readme-exports: ${fabricatedKeys.length} documented type(s) declare a key the shipped type does NOT have\n`);
    console.error('  The block writes the type out, so a reader takes these keys as the shape.');
    console.error('  A rename shows up here AND as a stale omission on the same declaration:\n');
    for (const f of fabricatedKeys) {
      console.error(`    - ${f.file}:${f.line} -- ${f.kind} ${f.typeName} documents ${f.keys.map((k) => `\`${k}\``).join(', ')}, not on the shipped type`);
    }
    console.error('\n  Fix the README, or add the key. This is NEVER excludable: an excerpt may');
    console.error('  leave a key out, it may not invent one.\n');
  }

  if (staleOmissions.length > 0) {
    console.error(`❌  check-readme-exports: ${staleOmissions.length} documented type(s) are behind the shipped declaration\n`);
    console.error('  The shipped type declares these keys and the block never mentions them:\n');
    for (const f of staleOmissions) {
      console.error(`    - ${f.file}:${f.line} -- ${f.kind} ${f.typeName} omits ${f.keys.map((k) => `\`${k}\``).join(', ')}`);
    }
    console.error(`
Two honest ways out, and neither is widening the check. If the block is a
DELIBERATE excerpt, declare it in the README above the fence:

  ${PARTIAL_MARKER_EXAMPLE}

If it is drift owed to a content card, record it in \`PARTIAL_EXCERPTS\` in this
script with the card number. Both suppress this direction only, both are
shrink-only, and both fail once the declaration stops being true.
`);
  }

  if (markerProblems.length > 0) {
    console.error(`❌  check-readme-exports: ${markerProblems.length} partial-excerpt marker(s) declare nothing\n`);
    for (const f of markerProblems) {
      const why =
        f.verdict === 'stray-partial-marker'
          ? 'binds to no fenced block -- it must sit directly above the fence, blank lines and other markers aside'
          : f.verdict === 'partial-marker-no-reason'
            ? `carries no real reason (needs at least ${MIN_PARTIAL_REASON} characters)`
            : 'declares an excerpt that omits nothing any more -- delete the marker';
      console.error(`    - ${f.file}:${f.line} -- \`${f.typeName}\` ${why}`);
    }
    console.error('');
  }

  if (unjudgeableTypes.length > 0) {
    console.error(`❌  check-readme-exports: ${unjudgeableTypes.length} documented type(s) could not be judged\n`);
    for (const f of unjudgeableTypes) {
      const why =
        f.reason === 'unbuilt'
          ? `its type entry \`${f.declaredEntry}\` is not on disk -- run \`pnpm build\` first`
          : 'its package declares no `types` entry at all';
      console.error(`    - ${f.file}:${f.line} -- ${f.kind} ${f.typeName} in ${f.package}, but ${why}`);
    }
    console.error(`
A FAILURE and not a skip, exactly as on the import side above: with no export
surface to read, every documented type would read as a local helper and the pin
would report a serene green over blocks it never judged.
`);
  }

  if (staleEntries.length > 0) {
    console.error(`❌  check-readme-exports: ${staleEntries.length} stale \`PARTIAL_EXCERPTS\` entry(ies)\n`);
    console.error('  Each names a declaration that no longer exists, or no longer omits anything.');
    console.error('  The ledger is shrink-only, so this is the good failure: delete the entry.\n');
    for (const f of staleEntries) {
      const why = f.verdict === 'orphan-excerpt-entry' ? '  (that README is not in the tracked population at all)' : '';
      console.error(`    - ${f.file}::${f.typeName}${why}`);
    }
    console.error('');
  }

  if (vacuous.length > 0) {
    console.error('\n❌  check-readme-exports: the population COLLAPSED -- this run proves nothing\n');
    for (const v of vacuous) {
      console.error(`    - ${v.counter}: found ${v.value}, floor is ${v.floor}`);
    }
    console.error(`
A scan that finds nothing reports OK, and reads as coverage. Something upstream
of the judgement broke: \`git ls-files\` returned little or nothing, the fence
extraction stopped matching, or the packages were never built. Fix the walk. If
a floor is genuinely too high because the tree changed shape, move it in
\`FLOORS\` deliberately and say why -- never to make a red run green.
`);
  }

  console.error(`Census: ${summarise(result)}`);
  process.exit(1);
}

if (isEntrypoint(import.meta.url)) {
  const overrides = parseReadmeOverrides(process.argv.slice(2));
  if (process.argv.includes('--json')) {
    const result = scan(repoRoot(), { readmeOverrides: overrides });
    console.log(
      JSON.stringify(
        { census: result.census, documentedTypes: result.documentedTypes, findings: result.findings, vacuous: result.vacuous },
        null,
        2,
      ),
    );
  } else if (process.argv.includes('--list')) {
    const result = scan(repoRoot(), { readmeOverrides: overrides });
    const { rows, notices, exitCode } = renderList(result);
    for (const row of rows) console.log(row);
    for (const notice of notices) console.error(notice);
    process.exit(exitCode);
  } else {
    main(overrides);
  }
}
