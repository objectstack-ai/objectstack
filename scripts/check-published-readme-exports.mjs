#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-published-readme-exports -- every symbol a PUBLISHED README tells a
// reader to import must exist in the package's BUILT type surface.
//
//   node scripts/check-published-readme-exports.mjs
//   node scripts/check-published-readme-exports.mjs --self-test
//
// ## The bug it exists to prevent (#9532, from #9517)
//
// `packages/plugins/plugin-audit/README.md` documented a `PluginAudit` class
// with a static `.configure()` entry point. Neither has ever existed: the
// package exports `AuditPlugin`, and no class in this repo exposes a static
// `configure()` at all. A reader who followed that README wrote code that could
// not compile -- and because the README is in the package's `files` array with
// `private` unset, it is the page npm renders.
//
// #9517 fixed that one package by hand. A single grep then found FIVE more in
// the same shape (`ServiceAnalytics`, `ServiceAutomation`, `ServiceCache`,
// `ServiceI18n`, `ServiceJob` -- each imported from its own package, none
// exported by anything). Six instances of one defect is not six mistakes; it is
// a missing gate. Nothing in this repo read a published README against its
// package's exports, so the drift was free in both directions: a README could
// document an API that never shipped, and an export could be renamed without
// the README noticing.
//
// This is that gate. It is deliberately NOT a docs linter -- it makes exactly
// one claim, the one a reader acts on first: *the import line at the top of the
// example resolves*.
//
// ## Why the fence is this narrow, with the measurements that set it
//
// The card that asked for this warned that "a naive version will drown in false
// positives on prose and pseudo-code", and a gate that cries wolf gets muted --
// which is worse than no gate, because a muted gate still reads as coverage.
// So every widening of scope below had to survive a measurement on the real
// tree (69 publishable packages, 50 with a published README) before it was
// taken:
//
//   FENCED CODE ONLY. 145 lines across those 50 READMEs contain both the word
//   `import` and an `@objectstack/` specifier. 142 are inside a fenced code
//   block; the other 3 are ALL prose, and all 3 are false positives for any
//   scanner that reads whole files -- two markdown links in `packages/core`
//   ("You only need the schemas -- import [`@objectstack/spec`](../spec)") and
//   one table row in `plugin-audit` describing an admin *user import* feature.
//   Reading only fenced blocks removes 100% of the measured noise and 0% of the
//   measured signal.
//
//   CODE-LANGUAGE FENCES ONLY. Fence languages present: typescript (222), bash
//   (51), ts (27), untagged (19), tsx (14), json (12), sh (2), diff (1),
//   javascript (1), sql (1). Import lines appear only under typescript/ts/tsx
//   /diff. Untagged fences are accepted too (they carry zero import lines
//   today, so it costs nothing and closes the hole where someone drops the tag);
//   `bash`/`json`/`sql` are not, because an `import` there is prose about a
//   different thing.
//
//   `diff` FENCES: `-` LINES ARE SKIPPED. The one diff fence in the tree
//   (`packages/objectql`) is a migration table whose `-` lines document the OLD
//   `@objectql/core` imports and whose `+` lines document the new ones. A
//   removed import is a statement about the past. Scanning it would report the
//   deletion the fence exists to announce -- a false positive by construction.
//
//   README ONLY, NOT EVERY PUBLISHED MARKDOWN. `files` admits `CHANGELOG.md` in
//   all 69 packages, and a changelog is a record of the past: an entry
//   describing a v1 export that v3 removed is CORRECT text that this gate would
//   redden permanently, with no fix available short of rewriting history. So
//   published markdown is scanned EXCEPT `CHANGELOG.md`, which is a boundary,
//   not an oversight. Any other `.md` a package publishes is in scope
//   automatically -- coverage that grows with the tree rather than a hard-coded
//   `README.md`.
//
//   ONLY WORKSPACE TARGETS. An import of `react` or `@objectql/core` is not this
//   repo's business and is skipped. The target must be a workspace member by
//   name; the check is then made against what that member actually publishes.
//
// ## Why the BUILT `.d.ts`, and why a missing one is an ERROR
//
// The question this gate answers is "can a consumer write this line?", and a
// consumer resolves `@objectstack/x` through the `exports` map to a `.d.ts`.
// Reading `src/index.ts` instead would answer a similar-looking question about
// a file no consumer sees, and would miss the two failures that only the
// packaged surface has: a subpath the README imports that `exports` never
// declares, and a re-export that the bundler drops.
//
// That makes this gate build-dependent, and build-dependent gates have a
// characteristic failure: on a fresh checkout `dist/` is absent, the scan
// reads nothing, and a green result means "not measured" while looking exactly
// like "measured and clean" (#4690). ⇒ A missing type entry is a HARD ERROR
// naming the build command, never a skip. The gate runs in the workflow job
// that has already built the workspace, next to the other dist-reading checks.
//
// ## The population axis, and the three refusals on it (#9911)
//
// Every claim this gate makes is made against a population it narrows in three
// stages, and a zero at ANY stage means both halves check nothing:
//
//   published documents  ->  import statements  ->  workspace type entries
//
// A green over a zero at any stage is the #4690 claim ("zero is a broken scan,
// not a clean repo") in three different costumes, so all three are HARD
// REFUSALS and they are worded in one place, `populationRefusal`. Two were here
// from the start; the third was filed as an observation and is what this
// section exists to explain.
//
//   DOCUMENTS = 0 -- the scan read nothing. Refused in `publishedDocs`, which
//   `check-published-readme-links` shares, so it is attributed to whichever
//   gate asked.
//
//   IMPORT STATEMENTS = 0 -- documents were read and not one holds an import.
//   The extractor is a text scan over prose; this is what it looks like the day
//   it stops matching.
//
//   WORKSPACE TYPE ENTRIES = 0 -- documents were read, imports WERE found, and
//   not one of them resolves to a workspace member. Everything parsed; nothing
//   resolved. `targets` stays empty, so `bound` stays empty in every document,
//   so both halves check nothing -- while the run reports success. Measured
//   before it was fixed, on a fixture that publishes one document and three
//   non-workspace imports: `exit 0`, under a green line reading `3 import
//   statement(s), 0 workspace type entr(ies)` and three zeros below it.
//
// The three are mutually exclusive BY CONSTRUCTION rather than by careful
// wording: each stage is consulted only because the previous one was non-zero,
// so exactly one can fire and the third can never shadow the two above it. What
// separates them for a reader is the remedy each implies -- stage 2 sends you
// to the extractor, stage 3 to workspace resolution -- so stage 3 prints the
// two counts that are NOT zero, which is precisely what stage 2 cannot say.
//
// ## Why stage 3 stops at `targets`, and what it deliberately leaves out
//
// #9870 left this file two more quantities a run can zero. Neither is a safe
// refusal, and that was MEASURED rather than reasoned -- on a fixture with a
// wholly legitimate population of one resolving import against a built entry:
//
//   `derivedReceivers` -- 0 on that fixture, which is an ordinary healthy tree:
//   the fence imports a name and calls a static on it without constructing
//   anything. Refusing there would redden a real population. This gate is
//   merge-blocking and its own file refuses the baseline as an author remedy,
//   so a false red here has no cheap way to be lived with -- worse than the
//   silence it replaces.
//
//   `unreadCalls` / `unreadReceivers` -- the COMPLEMENT of what was checked, so
//   a no-population run drives them UP, not to zero: the empty fixture above
//   reports `NOT read: 3` against `0 ... checked`. A zero-test on them is
//   backwards; a ceiling-test on them is a coverage ratchet, which is a
//   different card and wants a population that exists.
//
// => `targets.size` is the whole condition, because it is the one quantity that
// is zero if and only if BOTH halves are structurally vacuous.
//
// ## The baseline
//
// The five packages #9532 measured are recorded in
// scripts/published-readme-exports.baseline.json. It is SHRINK-ONLY and
// reconciled in BOTH directions: an entry whose finding no longer occurs is a
// STALE entry and fails, so fixing a README forces its entry to be deleted in
// the same PR. Each entry pins the EXACT symbol, so a baselined package that
// invents a SECOND fabricated symbol still goes red -- a baseline that muted a
// whole file would be the mute button this gate exists to replace.
//
// ⛔ Adding an entry is NOT an author remedy and this gate never offers it as
// one. The remedy for a finding is to fix the README (or export the symbol).
//
// ## Two halves, and why the second one is narrow
//
//   IMPORT half -- a name in an `import { … } from '<workspace pkg>'` clause
//   must be an export of that package's type entry. This is what catches all
//   six measured instances.
//
//   CALL-SITE half -- for a receiver this gate can TYPE, `x.member(` must name
//   a real property of that type. This is where `.configure()` lives in the
//   worse version of the defect (class real, static invented), and it is also
//   where false positives live. It is kept honest by one rule: the gate must
//   have reached the receiver's type through a workspace package's built
//   `.d.ts`. Anything whose type is `any`, or which carries an index signature,
//   is not reported -- absence of a property there is not evidence.
//
// ## Which receivers it can type, and the census that set that (#9870)
//
// "A name THIS FILE imported" was the whole answer until #9870 measured what
// that excluded. Swept with this file's own `publishedDocs()`: **262** `x.y(…)`
// call sites across **39 of 60** published documents sat on receivers the gate
// could not type -- against **EIGHT** it was checking. The green line said
// `60 published document(s)`, which reads as coverage of documents; what it
// covered was the import-bound receivers inside them, and #9867 -- a fabricated
// static that shipped through every green run -- was found by a human reading
// the page, not by this gate.
//
// The card named two reasons a receiver escapes. The census sized both, and
// they did NOT come out the same size:
//
//   RECEIVER NEVER IMPORT-BOUND -- 251 sites, and **109 of them already have a
//   reachable type**, because the fence builds them from a name it did import:
//   `const kernel = new ObjectKernel()`, `const stack = await bootStack(app)`.
//   Reading those is this file's `extractLocalBindings`, and it is what took the
//   call-site half from 8 checks to 78. The other 142 are free variables,
//   function parameters, globals and non-workspace imports -- no type exists for
//   them anywhere this gate may look, and they are now COUNTED and printed
//   rather than passed over in silence.
//
//   CALL-EXPRESSION RECEIVERS (`kernel.getService('mcp').registerTool(…)`) --
//   13 sites, **zero** of which have an import-bound base. ⛔ So no rule is
//   written for that shape. One would ship scanning an empty population, which
//   this header raises to a hard error rather than a skip a few paragraphs down
//   (#4690): zero is a broken scan, not a clean repo. It becomes writable the
//   day a fence chains off an import-bound base, against a population that
//   exists.
//
// What the widening found, on the tree it was measured against: **one** finding
// in 70 newly-read call sites, and it was real -- `plugin-hono-server`'s README
// booting a kernel with `await kernel.start()`, where `ObjectKernel` ships
// `bootstrap()`/`shutdown()` and eight sibling READMEs spell that step
// `bootstrap`. Zero false positives, because every ambiguity in
// `extractLocalBindings` rejects instead of guessing; see the asymmetry argued
// there.
//
//   That fence is a CHARACTER CLASS, and #9610 measured what happens when it is
//   spelled as a consuming alternation instead of a zero-width assertion: the
//   receiver in `kernel.use(SomePlugin.configure(…))` became unreachable, because
//   the outer call had already eaten the `(` in front of it. See extractMemberCalls.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import process from 'node:process';
import ts from 'typescript';
import { isEntrypoint } from './invoked-as.mjs';

// Anchored to the script, not to cwd: the verdict must not depend on where the
// guard was invoked from.
const ROOT = resolve(import.meta.dirname, '..');
const WORKSPACE_FILE = 'pnpm-workspace.yaml';
const SELF = 'scripts/check-published-readme-exports.mjs';
const BASELINE_REL = 'scripts/published-readme-exports.baseline.json';

// ⛔ SHRINK-ONLY. The authority token the #8435 convention requires; the
// baseline is a maintainer's registry, never an author's escape hatch.
const RATCHET_AUTHORITY_MARKER = '⛔ MAINTAINER-ONLY';

/**
 * Finding kinds produced by the CALL-SITE half, as they appear in a finding id.
 * `member` is a static on an import-bound name; `instance` and `return` are the
 * receivers the fence derives from one (#9870).
 */
const CALL_SITE_KINDS = ['member', 'instance', 'return'];

/**
 * Fence info-strings whose body is TypeScript/JavaScript a reader would copy.
 * `diff` is included with its own line handling (see readFences). An EMPTY info
 * string counts: an untagged fence is still a code block, and the measured tree
 * has no untagged fence containing an import, so admitting them costs nothing.
 */
const CODE_LANGUAGES = new Set([
  '',
  'js',
  'jsx',
  'javascript',
  'ts',
  'tsx',
  'typescript',
  'mjs',
  'cjs',
  'mts',
  'cts',
  'diff',
]);

/**
 * Published markdown this gate does not read. A changelog documents the past,
 * so a symbol it names being absent TODAY is expected rather than wrong.
 */
const MARKDOWN_EXCLUDED = new Set(['CHANGELOG.md']);

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', 'coverage', 'build']);

// ---------------------------------------------------------------------------
// Pure extraction -- every function below is offline-testable, and the
// --self-test pins each against the shapes measured on the real tree.
// ---------------------------------------------------------------------------

/**
 * `files` entries are gitignore-style patterns. Same two forms the packaging
 * guard supports: a bare path (a file, or a directory taken whole) and a glob.
 */
export function filesMatcher(pattern) {
  const clean = pattern.replace(/^\.\//, '').replace(/\/$/, '');
  let src = '';
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (c === '*' && clean[i + 1] === '*') {
      const spansSlash = clean[i + 2] === '/';
      src += spansSlash ? '(?:[^/]*/)*' : '.*';
      i += spansSlash ? 2 : 1;
    } else if (c === '*') {
      src += '[^/]*';
    } else if (c === '?') {
      src += '[^/]';
    } else {
      src += /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
    }
  }
  const rx = new RegExp(`^${src}$`);
  const prefix = `${clean}/`;
  return (rel) => rx.test(rel) || rel.startsWith(prefix);
}

/**
 * The code fences of a markdown document, already normalised to plain source.
 *
 * Returns `[{ lang, startLine, lines }]` where `lines` is `[{ n, text }]` with
 * the ORIGINAL 1-based line numbers preserved, so a finding can point at the
 * README line a human will look at.
 */
export function readFences(markdown) {
  const lines = markdown.split(/\r?\n/);
  const fences = [];
  let open = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const opener = raw.match(/^(\s*)(`{3,}|~{3,})\s*([^\s`]*)/);
    if (open === null) {
      if (opener) {
        open = {
          marker: opener[2][0],
          length: opener[2].length,
          lang: opener[3].toLowerCase(),
          startLine: i + 1,
          lines: [],
        };
      }
      continue;
    }
    const closer = raw.match(/^\s*(`{3,}|~{3,})\s*$/);
    if (closer && closer[1][0] === open.marker && closer[1].length >= open.length) {
      if (CODE_LANGUAGES.has(open.lang)) fences.push(open);
      open = null;
      continue;
    }
    if (open.lang === 'diff') {
      // A `-` line documents what was REMOVED. Reading it would report the very
      // deletion the fence exists to announce.
      if (/^\s*-/.test(raw)) continue;
      open.lines.push({ n: i + 1, text: raw.replace(/^(\s*)\+/, '$1') });
      continue;
    }
    open.lines.push({ n: i + 1, text: raw });
  }
  // An unterminated fence at EOF is still a fence; dropping it would silently
  // stop reading the tail of a document.
  if (open !== null && CODE_LANGUAGES.has(open.lang)) fences.push(open);
  return fences.map(({ lang, startLine, lines: l }) => ({ lang, startLine, lines: l }));
}

/**
 * The bindings an import clause introduces.
 *
 * `import type { A }` and `import { type A }` are both kept: a type-only export
 * is still an export of the `.d.ts`, so the claim "this name resolves" is the
 * same claim. What the modifier changes is only whether the name can be USED as
 * a value, which this gate does not assert.
 */
export function parseImportClause(clause) {
  const out = { defaultLocal: null, namespaceLocal: null, named: [] };
  let rest = clause.trim().replace(/^type\s+/, '');
  const namedAt = rest.indexOf('{');
  const head = (namedAt === -1 ? rest : rest.slice(0, namedAt)).replace(/,\s*$/, '').trim();
  if (head) {
    const ns = head.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (ns) out.namespaceLocal = ns[1];
    else if (/^[A-Za-z_$][\w$]*$/.test(head)) out.defaultLocal = head;
  }
  if (namedAt !== -1) {
    const close = rest.lastIndexOf('}');
    const inner = close === -1 ? rest.slice(namedAt + 1) : rest.slice(namedAt + 1, close);
    for (const piece of inner.split(',')) {
      const spec = piece.trim().replace(/^type\s+/, '');
      if (!spec) continue;
      const alias = spec.match(/^([A-Za-z_$][\w$]*|"[^"]*"|'[^']*')\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (alias) {
        out.named.push({ imported: alias[1].replace(/^['"]|['"]$/g, ''), local: alias[2] });
      } else if (/^[A-Za-z_$][\w$]*$/.test(spec)) {
        out.named.push({ imported: spec, local: spec });
      }
    }
  }
  return out;
}

/**
 * Every `import … from '<specifier>'` statement inside the code fences of a
 * markdown document, multi-line clauses included.
 *
 * Statements are found by SCANNING FROM a line whose first token is `import`,
 * then accumulating until the specifier closes. A single regex over the whole
 * fence was tried first and is wrong in the direction that matters: it happily
 * spans two adjacent statements when the first one has no `from`.
 */
export function extractImports(markdown) {
  const found = [];
  for (const fence of readFences(markdown)) {
    for (let i = 0; i < fence.lines.length; i++) {
      if (!/^\s*import\b/.test(fence.lines[i].text)) continue;
      let buffer = '';
      let end = -1;
      for (let j = i; j < fence.lines.length && j < i + 24; j++) {
        buffer += (buffer ? '\n' : '') + fence.lines[j].text;
        // A statement is complete once a quoted specifier has closed.
        if (/\bfrom\s*['"][^'"]*['"]/.test(buffer) || /^\s*import\s*['"][^'"]*['"]/.test(buffer)) {
          end = j;
          break;
        }
        // Another `import` on a later line means the first never completed --
        // dynamic `import(` in an expression, or prose. Abandon it.
        if (j > i && /^\s*import\b/.test(fence.lines[j].text)) break;
      }
      if (end === -1) continue;
      const stmt = buffer.match(/^\s*import\s+([\s\S]*?)\s+from\s*['"]([^'"]+)['"]/);
      if (!stmt) {
        i = end;
        continue;
      }
      found.push({
        line: fence.lines[i].n,
        specifier: stmt[2],
        ...parseImportClause(stmt[1]),
      });
      i = end;
    }
  }
  return found;
}

/**
 * `Name.member(` call sites inside code fences, restricted to the local names
 * given -- which the caller supplies as "names this document imported from a
 * workspace package and which resolved". That restriction is the whole
 * false-positive defence: pseudo-code in these READMEs is overwhelmingly method
 * calls on locally-bound variables (`analytics.count(...)`,
 * `kernel.getService(...)`), and none of those are import-bound.
 */
export function extractMemberCalls(markdown, localNames) {
  const wanted = new Set(localNames);
  if (wanted.size === 0) return [];
  const out = [];
  const seen = new Set();
  for (const fence of readFences(markdown)) {
    for (const { n, text } of fence.lines) {
      // Skip the import statements themselves and single-line comments.
      if (/^\s*(import\b|\/\/|\*|\/\*)/.test(text)) continue;
      // ⛔ The leading boundary is ASSERTED, never consumed (#9610). The obvious
      // spelling -- `(^|[^\w$.'"`])` -- eats the character in front of the receiver,
      // and `rx` is global, so a receiver beginning at the very next character after
      // a previous match has no boundary left to match against. A match always ends
      // at its own `(`, which makes the swallowed position exactly `outer(Inner.m(`
      // -- and `kernel.use(SomePlugin.configure({…}))` is the house spelling of every
      // README this gate was built for, so the blind spot was the NORMAL position,
      // not a corner. Measured on the published regex, one space apart:
      //
      //   kernel.use(CacheServicePlugin.configure({…}))   -> extracted: kernel.use
      //   kernel.use( CacheServicePlugin.configure({…}))  -> extracted: both
      //
      // A negative lookbehind is zero-width, so nothing is consumed and the `^` arm
      // folds in (a negative lookbehind is satisfied at position 0). The character
      // class is byte-for-byte the old one, so the fence is unchanged: `a.b.c(` and
      // `'str'.trim(` stay out -- now in the nested position too, which is the only
      // position this change newly reaches.
      const rx = /(?<![\w$.'"`])([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
      let m;
      while ((m = rx.exec(text)) !== null) {
        if (!wanted.has(m[1])) continue;
        const key = `${m[1]}.${m[2]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ line: n, object: m[1], member: m[2] });
      }
    }
  }
  return out;
}

/**
 * Local names the fence DERIVES from an import-bound one, with how.
 *
 * ## Why this exists, and what it measured (#9870)
 *
 * `extractMemberCalls` is called with the names the fence imported, so a call
 * whose receiver was never import-bound is not read at all. Measured on the
 * tree, with the gate's own `publishedDocs()`: **262 call sites** across 39 of
 * 60 published documents sit on such receivers, against **8** the call-site
 * half was checking. The card that asked for this named two reasons a receiver
 * escapes, and the census sized each:
 *
 *   RECEIVER NEVER IMPORT-BOUND -- 251 sites. Of those, **109 have a type this
 *   gate can already reach**, because the fence builds them out of a name it
 *   DID import: 103 `const x = new <ImportedClass>(…)` and 6
 *   `const x = [await] <ImportedFn>(…)`. That is the population this function
 *   serves. The remaining 142 are free variables, function parameters, globals
 *   (`console`, `Object`) and non-workspace imports (`z` from zod) -- no type
 *   exists for them anywhere this gate is allowed to look.
 *
 *   CALL-EXPRESSION RECEIVERS (`kernel.getService('mcp').registerTool(…)`) --
 *   13 sites, of which **ZERO** have an import-bound base. Every one is rooted
 *   in a free variable or a non-workspace import (`z.string(…).url(`,
 *   `res.status(…).json(`). ⛔ So no rule is written for that shape: it would
 *   ship scanning an empty population, which this gate's own header raises to a
 *   hard error rather than a skip (#4690). When a fence one day chains off an
 *   import-bound base, THAT is the moment to write it, against a population
 *   that exists.
 *
 * ## The safe direction, and why it is safe
 *
 * This scanner has no scopes. A name it types wrongly can fail two ways, and
 * they are NOT symmetric: a wrong GREEN leaves a site unread, which is where
 * all 262 of them already sit -- no loss. A wrong RED accuses a correct README,
 * and this gate is merge-blocking with a baseline its own file refuses as an
 * author remedy, so there is no cheap way to live with one. ⇒ every ambiguity
 * below REJECTS the name rather than guessing:
 *
 *   - two declarations of one name that disagree on the source, or on `new`
 *     vs call -- the call sites belong to different scopes and nothing here
 *     can say which;
 *   - a declaration whose initialiser is any other shape (an object literal, a
 *     ternary, a member call on something unknown) -- the name is DECLARED, so
 *     a later `new Foo()` declaration must not be allowed to speak for it;
 *   - a name also introduced as a function/arrow parameter, a `for` binding, a
 *     `catch` binding, a destructuring pattern, or a `function`/`class`
 *     declaration -- all shadow the binding somewhere.
 *
 * @param markdown     the document
 * @param importBound  local names bound by an import of a workspace package
 * @returns `{ bound: Map<local, { via: 'instance' | 'return', source }>,
 *            rejected: Map<local, why> }`. The reject side is RETURNED, not
 *          discarded, because a scanner that silently stopped binding anything
 *          also returns an empty `bound` -- the self-test asserts a positive
 *          count there so "matched nothing" cannot pass as "nothing to match".
 */
export function extractLocalBindings(markdown, importBound) {
  const wanted = new Set(importBound);
  const bound = new Map();
  const rejected = new Map();
  const result = () => ({ bound, rejected });
  if (wanted.size === 0) return result();

  const reject = (name, why) => {
    bound.delete(name);
    if (!rejected.has(name)) rejected.set(name, why);
  };
  const declare = (name, binding) => {
    if (rejected.has(name)) return;
    if (!binding) return reject(name, 'initialiser shape this gate cannot type');
    const prior = bound.get(name);
    if (!prior) {
      bound.set(name, binding);
      return;
    }
    if (prior.via !== binding.via || prior.source !== binding.source) {
      reject(name, 'declared more than once, from different sources');
    }
  };

  const DECLARATION = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+?)?\s*=\s*(.+)$/;
  // Every OTHER way a document introduces the same identifier. Each is a
  // shadow: the name means something else at some call sites and this scanner
  // cannot tell those apart, so the name is dropped entirely.
  const SHADOWS = [
    /\(([^()]*)\)\s*(?::[^=]*?)?=>/g, // (a, b) => …
    /(?<![\w$.])([A-Za-z_$][\w$]*)\s*=>/g, // a => …
    /\bfunction\b[^(]*\(([^()]*)\)/g, // function f(a, b)
    /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g, // catch (err)
    /\bfor\s*\(\s*(?:const|let|var)\s*[{[]?\s*([A-Za-z_$][\w$]*)/g, // for (const x of …)
    /\b(?:const|let|var)\s*[{[]([^}\]]*)[}\]]\s*=/g, // const { a } = …
    /\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g, // function f() {} / class C {}
  ];

  const declarations = [];
  const shadowed = new Set();
  for (const fence of readFences(markdown)) {
    for (const { text } of fence.lines) {
      if (/^\s*(import\b|\/\/|\*|\/\*)/.test(text)) continue;
      for (const rx of SHADOWS) {
        rx.lastIndex = 0;
        let m;
        while ((m = rx.exec(text)) !== null) {
          for (const piece of (m[1] ?? '').split(',')) {
            const name = piece.trim().replace(/^\.\.\./, '').split(/[:=\s]/)[0];
            if (/^[A-Za-z_$][\w$]*$/.test(name)) shadowed.add(name);
          }
        }
      }
      const d = text.match(DECLARATION);
      if (!d) continue;
      const init = d[2].trim().replace(/^await\s+/, '');
      const created = init.match(/^new\s+([A-Za-z_$][\w$]*)\s*\(/);
      const called = created ? null : init.match(/^([A-Za-z_$][\w$]*)\s*\(/);
      const source = created?.[1] ?? called?.[1] ?? null;
      declarations.push({
        name: d[1],
        binding:
          source && wanted.has(source) ? { via: created ? 'instance' : 'return', source } : null,
      });
    }
  }
  for (const { name, binding } of declarations) declare(name, binding);
  for (const name of shadowed) if (bound.has(name)) reject(name, 'also introduced as a binding elsewhere');
  return result();
}

/**
 * How many `X.y(…)` call sites this run could NOT type, and on how many
 * distinct receivers -- the number the GREEN line was missing (#9870).
 *
 * Counted with the SAME matcher and the SAME dedup as `extractMemberCalls`, so
 * the two numbers the green line prints are commensurable: "checked 117, could
 * not read 153" is one population split in two, not two different censuses. A
 * shape the matcher's fence excludes on purpose (`a.b.c(`, `'str'.trim(`) is
 * neither checked nor counted here -- it is not a receiver this gate has an
 * opinion about, and folding it in would inflate the blind spot with text the
 * gate is right to ignore.
 *
 * ⚠️ This is VISIBILITY, never a verdict. It is printed by the SUCCESS path and
 * changes no exit code: the remedy for an unread call site is a human reading
 * the document, which is a programme rather than something an author can do to
 * get a build green. What it stops is the green line reading as coverage of
 * published documents when what it covers is import-bound receivers INSIDE
 * them.
 */
export function countUnreadCalls(markdown, readableNames) {
  const known = new Set(readableNames);
  const receivers = new Set();
  const seen = new Set();
  for (const fence of readFences(markdown)) {
    for (const { text } of fence.lines) {
      if (/^\s*(import\b|\/\/|\*|\/\*)/.test(text)) continue;
      const rx = /(?<![\w$.'"`])([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g;
      let m;
      while ((m = rx.exec(text)) !== null) {
        if (known.has(m[1])) continue;
        seen.add(`${m[1]}.${m[2]}`);
        receivers.add(m[1]);
      }
    }
  }
  return { calls: seen.size, receivers: receivers.size };
}

/** `@objectstack/spec/data` -> `{ name: '@objectstack/spec', subpath: './data' }`. */
export function splitSpecifier(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null;
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  const rest = specifier.slice(name.length);
  return { name, subpath: rest ? `.${rest}` : '.' };
}

/**
 * The `.d.ts` a consumer's compiler lands on for `<pkg><subpath>`.
 *
 * Both shapes this repo writes are handled: the flat one
 * (`{".": {"types": "./dist/index.d.ts", "import": …}}`) and the
 * condition-nested one (`{".": {"import": {"types": "./dist/index.d.mts"}}}`).
 * Conditions are walked `types` first, then the ESM branch -- READMEs document
 * `import` syntax, so the ESM branch is the one their reader resolves.
 */
export function resolveTypesEntry(manifest, subpath) {
  const walk = (node) => {
    if (typeof node === 'string') return /\.d\.[cm]?ts$/.test(node) ? node : null;
    if (!node || typeof node !== 'object') return null;
    for (const condition of ['types', 'import', 'module', 'node', 'default', 'require']) {
      if (condition in node) {
        const hit = walk(node[condition]);
        if (hit) return hit;
      }
    }
    return null;
  };
  const map = manifest.exports;
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    // A bare `"exports": "./dist/index.js"` (or a conditions-only object with no
    // `.` key) declares the root and nothing else.
    const hasSubpathKeys = Object.keys(map).some((k) => k.startsWith('.'));
    if (hasSubpathKeys) {
      if (!(subpath in map)) return { entry: null, declared: false };
      return { entry: walk(map[subpath]), declared: true };
    }
    if (subpath !== '.') return { entry: null, declared: false };
    return { entry: walk(map), declared: true };
  }
  if (subpath !== '.') return { entry: null, declared: false };
  const legacy = manifest.types ?? manifest.typings;
  return { entry: typeof legacy === 'string' ? legacy.replace(/^\.\//, '') : null, declared: true };
}

// ---------------------------------------------------------------------------
// Workspace + type surface
// ---------------------------------------------------------------------------

/** The `packages:` globs from pnpm-workspace.yaml. */
function workspaceGlobs() {
  const lines = readFileSync(join(ROOT, WORKSPACE_FILE), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => /^packages\s*:\s*$/.test(l));
  if (start === -1) throw new Error(`${WORKSPACE_FILE}: no top-level \`packages:\` block`);
  const globs = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].replace(/#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    const m = line.match(/^\s+-\s+['"]?([^'"\s]+)['"]?\s*$/);
    if (m) {
      globs.push(m[1]);
      continue;
    }
    if (/^\S/.test(line)) break;
  }
  if (globs.length === 0) throw new Error(`${WORKSPACE_FILE}: \`packages:\` block is empty`);
  return globs;
}

/** Workspace member directories, relative to the repo root. */
function workspaceDirs() {
  const dirs = [];
  for (const glob of workspaceGlobs()) {
    const star = glob.endsWith('/*');
    const base = star ? glob.slice(0, -2) : glob;
    if (base.includes('*')) {
      throw new Error(
        `${WORKSPACE_FILE}: pattern "${glob}" is richer than <dir> or <dir>/*; extend ${SELF}`,
      );
    }
    const abs = join(ROOT, base);
    if (!existsSync(abs)) continue;
    const candidates = star ? readdirSync(abs).map((e) => posix.join(base, e)) : [base];
    for (const c of candidates) {
      if (existsSync(join(ROOT, c, 'package.json'))) dirs.push(c);
    }
  }
  return dirs.sort();
}

/** Package-relative POSIX paths of every non-build file in a package. */
function walk(absDir, prefix = '', out = []) {
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const rel = prefix ? posix.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) walk(join(absDir, entry.name), rel, out);
    else out.push(rel);
  }
  return out;
}

/** The published markdown of a package, minus the excluded-by-design set. */
function publishedMarkdown(dir, files) {
  const matchers = files.map(filesMatcher);
  return walk(join(ROOT, dir))
    .filter((rel) => rel.toLowerCase().endsWith('.md'))
    .filter((rel) => !MARKDOWN_EXCLUDED.has(posix.basename(rel)))
    .filter((rel) => matchers.some((m) => m(rel)))
    .sort();
}

const TS_OPTIONS = {
  noEmit: true,
  skipLibCheck: true,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ESNext,
  allowJs: false,
  declaration: false,
  types: [],
};

/**
 * One program over every distinct type entry the READMEs reach. A program per
 * entry re-parsed `@objectstack/spec`'s declarations once per consumer (~2s
 * each); one shared program parses them once.
 */
function typeSurface(absEntries) {
  const program = ts.createProgram([...absEntries], TS_OPTIONS);
  const checker = program.getTypeChecker();
  const cache = new Map();
  // Shared by both member questions below, so the "not knowable is never a
  // finding" rule is written ONCE. Two copies of it would drift apart in the
  // direction that produces a false RED, which is the only direction this
  // gate cannot afford (a false green merely leaves a site unread, which is
  // where every one of them already sits).
  const unwrapAlias = (symbol) => {
    if (!(symbol.flags & ts.SymbolFlags.Alias)) return symbol;
    try {
      return checker.getAliasedSymbol(symbol);
    } catch {
      return null;
    }
  };
  const typeHasProperty = (type, member) => {
    if (!type) return true;
    const f = type.getFlags();
    if (f & ts.TypeFlags.Any || f & ts.TypeFlags.Unknown || f & ts.TypeFlags.TypeParameter) {
      return true;
    }
    if (checker.getPropertyOfType(type, member)) return true;
    for (const info of checker.getIndexInfosOfType?.(type) ?? []) if (info) return true;
    return false;
  };
  const moduleSymbol = (abs) => {
    if (!cache.has(abs)) {
      const sf = program.getSourceFile(abs);
      cache.set(abs, sf ? (checker.getSymbolAtLocation(sf) ?? null) : null);
    }
    return cache.get(abs);
  };
  return {
    /** Exported symbols of a type entry, by name. `null` if unreadable. */
    exportsOf(abs) {
      const sym = moduleSymbol(abs);
      if (!sym) return null;
      const map = new Map();
      for (const e of checker.getExportsOfModule(sym)) map.set(e.getName(), e);
      return map;
    },
    /**
     * Whether `symbol.member` is a real property.
     *
     * Returns `true` whenever the answer is not knowable -- an `any`, an index
     * signature, a symbol with no declaration. Absence of evidence is never
     * reported as a finding; that is what keeps the call-site half quiet.
     */
    hasMember(symbol, member) {
      const s = unwrapAlias(symbol);
      if (!s) return true;
      if (s.flags & ts.SymbolFlags.Module) {
        return checker.getExportsOfModule(s).some((e) => e.getName() === member);
      }
      const decl = s.valueDeclaration ?? s.declarations?.[0];
      if (!decl) return true;
      return typeHasProperty(checker.getTypeOfSymbolAtLocation(s, decl), member);
    },
    /**
     * The same question for a receiver the fence DERIVED from an import-bound
     * name -- `const kernel = new ObjectKernel()`, `const stack = await
     * bootStack(app)` -- where the member lives on the INSTANCE type or on the
     * (awaited) RETURN type, never on the static side `hasMember` reads.
     *
     * Both extra hops are gated on there being EXACTLY ONE signature. Zero means
     * the name is not constructible/callable as the fence writes it, which is a
     * different claim and one the import half already owns; more than one means
     * overload resolution, which needs the ARGUMENTS this gate deliberately does
     * not parse. Both answer "not knowable", and not knowable is never a finding
     * -- the same rule that keeps `any` and index signatures quiet above.
     */
    hasMemberVia(symbol, member, via) {
      const s = unwrapAlias(symbol);
      if (!s) return true;
      const decl = s.valueDeclaration ?? s.declarations?.[0];
      if (!decl) return true;
      const value = checker.getTypeOfSymbolAtLocation(s, decl);
      if (!value) return true;
      const signatures =
        via === 'instance' ? value.getConstructSignatures() : value.getCallSignatures();
      if (signatures.length !== 1) return true;
      const returned = checker.getReturnTypeOfSignature(signatures[0]);
      if (!returned) return true;
      return typeHasProperty(checker.getAwaitedType?.(returned) ?? returned, member);
    },
  };
}

// ---------------------------------------------------------------------------
// Analysis -- pure over its inputs, so the self-test can drive the whole
// pipeline without a build, a workspace or a disk.
// ---------------------------------------------------------------------------

/**
 * Findings for one published markdown document.
 *
 * @param doc      `{ pkg, file, text }`
 * @param resolve  `(specifier) => null` when the target is not a workspace
 *                 package (skip it), or
 *                 `{ declared, entryMissing, exports, hasMember }`.
 * @param measured optional accumulator, mutated in place, recording how much
 *                 each half READ rather than what it found. Findings alone
 *                 cannot answer "did it look?" -- zero is the same number for a
 *                 clean tree and for a scan that matched nothing (#4690), and
 *                 the call-site half is the half most likely to quietly stop
 *                 matching, being a text scan over prose. Passed in rather than
 *                 returned so the return type stays a plain array of findings.
 *
 *                 Fields: `symbolChecks`, `receivers` (import-bound),
 *                 `derivedReceivers` and `rejectedReceivers` (#9870's local
 *                 bindings, bound and refused), `callChecks`, and
 *                 `unreadCalls`/`unreadReceivers` -- what this run could NOT
 *                 type. That last pair is the one a reader needs and the run
 *                 cannot fake: it is the complement of `callChecks` over the
 *                 same matcher, so a widening that silently stopped widening
 *                 shows up as the unread count refusing to fall.
 */
export function analyzeDocument(doc, resolveTarget, measured = null) {
  const findings = [];
  const bound = new Map(); // local name -> { symbol, hasMember, specifier, imported }
  for (const imp of extractImports(doc.text)) {
    const split = splitSpecifier(imp.specifier);
    if (!split) continue;
    const target = resolveTarget(split.name, split.subpath, imp.specifier);
    if (!target) continue;
    if (!target.declared) {
      findings.push({
        id: `${doc.pkg}|${doc.file}|subpath|${imp.specifier}`,
        line: imp.line,
        text:
          `imports from '${imp.specifier}', but ${split.name} does not declare the ` +
          `subpath '${split.subpath}' in its \`exports\` map.`,
      });
      continue;
    }
    if (target.entryMissing) {
      findings.push({
        id: `${doc.pkg}|${doc.file}|entry|${imp.specifier}`,
        line: imp.line,
        text: target.entryMissing,
        fatal: true,
      });
      continue;
    }
    const names = [...imp.named];
    if (imp.defaultLocal) names.push({ imported: 'default', local: imp.defaultLocal });
    for (const { imported, local } of names) {
      if (measured) measured.symbolChecks++;
      const symbol = target.exports.get(imported);
      if (!symbol) {
        findings.push({
          id: `${doc.pkg}|${doc.file}|import|${imp.specifier}|${imported}`,
          line: imp.line,
          text:
            `documents \`import { ${imported} } from '${imp.specifier}'\`, but ` +
            `${imported} is not exported by that package's published types.`,
        });
        continue;
      }
      bound.set(local, {
        symbol,
        hasMember: target.hasMember,
        hasMemberVia: target.hasMemberVia,
        specifier: imp.specifier,
        imported,
      });
    }
    if (imp.namespaceLocal) {
      // A namespace binding has no name of its own to verify; its members are
      // checked by the call-site half against the module's export set.
      const ns = target.namespaceSymbol;
      if (ns) {
        bound.set(imp.namespaceLocal, {
          symbol: ns,
          hasMember: target.hasMember,
          hasMemberVia: target.hasMemberVia,
          specifier: imp.specifier,
          imported: '*',
        });
      }
    }
  }
  if (measured) measured.receivers += bound.size;

  // Receivers the fence BUILDS out of an import-bound name (#9870). An import
  // binding always wins over a derived one: a document that both imports
  // `Kernel` and writes `const Kernel = new Kernel()` is pathological, and the
  // import is the claim this gate was written to check.
  const readable = new Map(bound);
  const { bound: derived, rejected } = extractLocalBindings(doc.text, [...bound.keys()]);
  for (const [local, { via, source }] of derived) {
    if (readable.has(local)) continue;
    const origin = bound.get(source);
    if (!origin) continue;
    // ⛔ A target that cannot answer the DERIVED question does not get to answer
    // it with a default. The first cut of this widening fell back to
    // `() => true` here, and the fallback fired for every one of the 70 sites it
    // had just claimed to widen onto: the green line read `78 … call(s) checked`
    // while 70 of those checks were the fallback returning "not knowable". Green,
    // louder than before, and measuring less than it said — #4690 rebuilt inside
    // the fix for it. So an unanswerable receiver is simply NOT READABLE: it
    // stays out of `readable`, which keeps it out of `callChecks` and puts it in
    // the `NOT read` count, where a vacuous widening announces itself as a
    // widening that widened nothing.
    if (typeof origin.hasMemberVia !== 'function') continue;
    readable.set(local, { ...origin, via, source });
  }
  if (measured) {
    measured.derivedReceivers += readable.size - bound.size;
    measured.rejectedReceivers += rejected.size;
  }

  for (const call of extractMemberCalls(doc.text, [...readable.keys()])) {
    const b = readable.get(call.object);
    if (!b) continue;
    if (measured) measured.callChecks++;
    // A derived receiver's member lives on the instance / returned type, never
    // on the static side — so it is a DIFFERENT question, asked by a different
    // method, and a target that cannot answer it answers "not knowable".
    const known = b.via
      ? b.hasMemberVia(b.symbol, call.member, b.via)
      : b.hasMember(b.symbol, call.member);
    if (known) continue;
    const how = b.via === 'instance' ? `new ${b.source}(…)` : b.via ? `${b.source}(…)` : null;
    findings.push({
      id: `${doc.pkg}|${doc.file}|${b.via ?? 'member'}|${b.specifier}|${b.imported}.${call.member}`,
      line: call.line,
      text: how
        ? `documents \`${call.object}.${call.member}(…)\` on a value the fence builds with ` +
          `\`${how}\`, but what ${b.imported} (from '${b.specifier}') ` +
          `${b.via === 'instance' ? 'constructs' : 'returns'} has no \`${call.member}\` member ` +
          'in its published types.'
        : `documents \`${call.object}.${call.member}(…)\`, but ${b.imported} (from ` +
          `'${b.specifier}') has no \`${call.member}\` member in its published types.`,
    });
  }
  if (measured) {
    const unread = countUnreadCalls(doc.text, [...readable.keys()]);
    measured.unreadCalls += unread.calls;
    measured.unreadReceivers += unread.receivers;
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

function loadBaseline() {
  const abs = join(ROOT, BASELINE_REL);
  if (!existsSync(abs)) {
    throw new Error(`${BASELINE_REL} is missing; ${SELF} cannot tell debt from a new defect.`);
  }
  const parsed = JSON.parse(readFileSync(abs, 'utf8'));
  if (!Array.isArray(parsed.entries)) throw new Error(`${BASELINE_REL}: \`entries\` must be an array`);
  return parsed.entries;
}

/**
 * The author-facing remedy for a NEW finding.
 *
 * Rendered by a function rather than written inline so the self-test can assert
 * on the text an author actually reads. The #8435 convention is about
 * author-facing text, and every gate that interpolates `${RATCHET_AUTHORITY_MARKER}`
 * has the property that the literal token appears in its SOURCE only at the
 * `const` — so a source scan is not evidence about the message at all.
 *
 * This gate takes the REFUSAL arm of the convention, not the marking arm: the
 * baseline is named so an author can see what it is, and named as something
 * they must not add to.
 */
function freshRemedy() {
  return (
    'A published README is the page npm renders — a reader following it writes code that\n' +
    'cannot compile. Fix the README to name what the package really exports, or export the\n' +
    `symbol it documents. ${RATCHET_AUTHORITY_MARKER}: ${BASELINE_REL} is a shrink-only\n` +
    'record of the instances #9532 measured. It is not an author remedy and this gate does\n' +
    'not offer it as one — a new entry would mute exactly what the gate exists to report.\n'
  );
}

/**
 * The GREEN line's body -- what a PASSING run tells the reader.
 *
 * Rendered by a function, next to `freshRemedy()` and for the same reason: the
 * counts are interpolated, so reading the SOURCE proves nothing about the
 * sentence an author gets. The self-test asserts on the returned text.
 *
 * ## Why it reports what was READ, not a ratio over what was found (#9767)
 *
 * This clause used to end `${memberChecks} of the findings are call sites`.
 * With the ledger populated that was informative -- it said how much of the
 * baseline the call-site half accounted for. With `entries: []` (the success
 * state, #9649) it is structurally always `0 of the findings are call sites`:
 * a ratio over an EMPTY SET, printed by the one clause whose whole job is to
 * say "clean" rather than "unmeasured". A zero there is the #4690 ambiguity in
 * output rather than in a verdict -- "I scanned 60 documents and found nothing"
 * and "I scanned nothing" render identically -- and the call-site half is the
 * half most likely to quietly stop matching, being a text scan over prose.
 *
 * So each half states its INPUT VOLUME, which no clean tree can make vacuous:
 * a zero in `283 documented symbol(s) checked` or `8 documented call(s)
 * checked` says the half read nothing, which is the alarm, whereas a zero in
 * `0 of the findings are call sites` said nothing at all. The counts come from
 * the accumulator `analyzeDocument` fills as it works -- the same pass, not a
 * second one; this gate's verdict, population and exit codes are unchanged.
 *
 * The ledger clause is kept as it was: `N known instance(s) STILL in <file>`
 * carries the shrink-only direction in the word "still", and the header above
 * it already names the population that was read, so zero reads as "none left
 * to repair". Non-empty, it also carries the call-site split the old clause
 * had -- WITH its denominator, which `N of the findings` never printed.
 */
function successSummary({ measured, baselineCount, memberChecks }) {
  const ledger =
    baselineCount === 0
      ? `${baselineCount} known instance(s) still in ${BASELINE_REL}.`
      : `${baselineCount} known instance(s) still in ${BASELINE_REL} ` +
        `(${memberChecks} of the ${baselineCount} at a call site).`;
  return (
    `  ${ledger}\n` +
    `  Import half: ${measured.symbolChecks} documented symbol(s) checked against the exports ` +
    `their package publishes.\n` +
    `  Call-site half: ${measured.callChecks} documented \`X.y(…)\` call(s) checked, on ` +
    `${measured.receivers} import-bound name(s) and ${measured.derivedReceivers} name(s) ` +
    `built from one.\n` +
    `  NOT read: ${measured.unreadCalls} documented \`X.y(…)\` call(s) on ${measured.unreadReceivers} ` +
    `receiver(s) with no type this gate can reach\n` +
    `  (free variables, parameters, globals, non-workspace imports). Visibility, not a ` +
    `verdict — see #9870.`
  );
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/**
 * The #4690 population axis, in one place: the refusal for the FIRST stage that
 * is empty, or `null` when the run has a population to work on.
 *
 * The three stages narrow in the order the scan produces them (documents →
 * import statements → workspace type entries), and each is consulted only
 * because the previous one was non-zero. That is what makes the three refusals
 * mutually exclusive rather than merely differently worded; see the header.
 *
 * A stage the caller has not measured yet is OMITTED, never passed as `0`. So a
 * caller holding one quantity cannot accidentally speak for the other two --
 * `publishedDocs` knows only the document count, and passing `0` for the rest
 * to satisfy the signature would make it refuse for a reason it never measured.
 *
 * Rendered by a function, beside `freshRemedy()` and `successSummary()` and for
 * the same reason: the counts are interpolated, so reading the SOURCE proves
 * nothing about the sentence an author gets. The self-test asserts the returned
 * text.
 *
 * @param {{documents: number, importStatements?: number, targets?: number}} counts
 * @param {string} [caller] gate name the refusal is attributed to
 * @returns {string|null}
 */
export function populationRefusal({ documents, importStatements, targets }, caller = SELF) {
  if (documents === 0) {
    return `${caller}: no published markdown found — the scan read nothing (#4690).`;
  }
  if (importStatements === 0) {
    return `${caller}: read ${documents} document(s) and found no imports at all (#4690).`;
  }
  if (targets === 0) {
    return (
      `${caller}: read ${documents} document(s) and ${importStatements} import statement(s), ` +
      `but NOT ONE of them resolves to a workspace package — 0 workspace type entr(ies), ` +
      `so both halves checked nothing (#4690).\n` +
      `  Everything parsed and nothing resolved, which puts the fault in the RESOLUTION step ` +
      `rather than in any README: a ${WORKSPACE_FILE} edit that dropped the packages this ` +
      `gate resolves against, a package rename the READMEs still spell the old way, or a ` +
      `change to how a member's name is read from its package.json.\n` +
      `  ⛔ Not a skip, and ${BASELINE_REL} cannot silence it: a pass over a population of ` +
      `nothing is the same empty claim this gate already refuses at the two stages above.`
    );
  }
  return null;
}

/**
 * Pass 1's population: which workspace type entries the READMEs actually reach,
 * and how many import statements were read to find out.
 *
 * Lifted out of `run()` so the population can be MEASURED by the same code the
 * run uses. The self-test's no-population case turns on `targets.size === 0`
 * being DERIVED from a fixture rather than typed into an assertion: a
 * hand-written `targets: 0` would pin the refusal's arithmetic while proving
 * nothing about the scan that produces the zero -- which is the exact species
 * of vacuity this refusal was added to catch.
 *
 * Resolution to a `.d.ts` deliberately does NOT happen here. This answers "what
 * did the documents reach?", a question about text and the workspace map alone
 * -- no disk, no build -- so the refusal above can be decided, and tested,
 * before a single type entry is touched.
 *
 * @param docs   `[{ pkg, file, text }]`
 * @param byName workspace members by package name
 * @returns `{ importStatements, targets }`, `targets` keyed `"<name><subpath>"`
 */
export function reachedTargets(docs, byName) {
  let importStatements = 0;
  const targets = new Map();
  for (const doc of docs) {
    for (const imp of extractImports(doc.text)) {
      importStatements++;
      const split = splitSpecifier(imp.specifier);
      if (!split || !byName.has(split.name)) continue;
      const key = `${split.name}${split.subpath.slice(1)}`;
      if (targets.has(key)) continue;
      targets.set(key, { name: split.name, subpath: split.subpath });
    }
  }
  return { importStatements, targets };
}

/**
 * THE published-markdown population, derived once for every gate that needs it.
 *
 * "Published" is `private` unset AND a non-empty `files` array AND the file
 * matched by one of its patterns, minus `MARKDOWN_EXCLUDED`. That definition is
 * load-bearing for more than one gate now, and two gates deriving it separately
 * would disagree the first time a package's `files` array changed — silently,
 * each still green. So it is computed HERE and imported, never re-derived.
 *
 * @param {string} [caller] gate name to attribute an empty-population error to
 * @returns {{ members: {dir: string, manifest: any}[], byName: Map<string, any>,
 *             docs: {pkg: string, file: string, text: string}[] }}
 */
export function publishedDocs(caller = SELF) {
  const members = workspaceDirs().map((dir) => ({
    dir,
    manifest: JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8')),
  }));
  const byName = new Map();
  for (const m of members) if (m.manifest.name) byName.set(m.manifest.name, m);

  const docs = [];
  for (const { dir, manifest } of members) {
    if (!manifest.name || manifest.private === true) continue;
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    if (files.length === 0) continue; // the packaging guard owns that failure
    for (const file of publishedMarkdown(dir, files)) {
      docs.push({
        pkg: manifest.name,
        file: posix.join(dir, file),
        text: readFileSync(join(ROOT, dir, file), 'utf8'),
      });
    }
  }
  // Stage 1 of the population axis: a scan that read nothing is the #4690
  // failure -- indistinguishable from a clean tree in the output, and green
  // either way. Never a skip. Only the document count is measured here, so only
  // that stage is passed; see `populationRefusal`.
  const unread = populationRefusal({ documents: docs.length }, caller);
  if (unread) throw new Error(unread);
  return { members, byName, docs };
}

function run() {
  const { byName, docs } = publishedDocs();

  // Pass 1: which workspace type entries do the READMEs actually reach?
  const { importStatements, targets: reached } = reachedTargets(docs, byName);

  // Stages 2 and 3 of the population axis, decided BEFORE a type entry is
  // resolved: nothing below this line can check anything the population above
  // it does not contain. Stage 3 (`reached.size === 0`) is the state where
  // documents and imports both exist and NOT ONE resolves to a workspace
  // member -- everything parsed, nothing resolved, both halves vacuous, and
  // until #9911 a pass. See the header for why it stops at `targets`.
  const vacuous = populationRefusal({
    documents: docs.length,
    importStatements,
    targets: reached.size,
  });
  if (vacuous) throw new Error(vacuous);

  const targets = new Map(); // "<name><subpath>" -> { name, subpath, abs, declared, missing }
  for (const [key, { name, subpath }] of reached) {
    const { dir, manifest } = byName.get(name);
    const { entry, declared } = resolveTypesEntry(manifest, subpath);
    const abs = entry ? join(ROOT, dir, entry.replace(/^\.\//, '')) : null;
    targets.set(key, {
      name,
      subpath,
      declared,
      abs,
      missing:
        declared && !abs
          ? `imports from '${name}${subpath.slice(1)}', which declares no ` +
            `TypeScript types for that entry — this gate cannot verify it.`
          : declared && !existsSync(abs)
            ? `imports from '${name}${subpath.slice(1)}', whose type entry ` +
              `${posix.relative(ROOT, abs)} does not exist. Build first: ` +
              `\`pnpm --filter ${name} build\` (or \`pnpm build\`).`
            : null,
    });
  }

  const surface = typeSurface(
    [...targets.values()].filter((t) => t.abs && !t.missing).map((t) => t.abs),
  );

  const resolveTarget = (name, subpath) => {
    if (!byName.has(name)) return null;
    const t = targets.get(`${name}${subpath.slice(1)}`);
    if (!t) return null;
    if (!t.declared) return { declared: false };
    if (t.missing) return { declared: true, entryMissing: t.missing };
    const exports = surface.exportsOf(t.abs);
    if (!exports) {
      return {
        declared: true,
        entryMissing: `type entry ${posix.relative(ROOT, t.abs)} could not be read as a module.`,
      };
    }
    return {
      declared: true,
      exports,
      namespaceSymbol: null,
      hasMember: (sym, member) => surface.hasMember(sym, member),
      hasMemberVia: (sym, member, via) => surface.hasMemberVia(sym, member, via),
    };
  };

  const findings = [];
  const measured = {
    symbolChecks: 0,
    receivers: 0,
    derivedReceivers: 0,
    rejectedReceivers: 0,
    callChecks: 0,
    unreadCalls: 0,
    unreadReceivers: 0,
  };
  for (const doc of docs) findings.push(...analyzeDocument(doc, resolveTarget, measured));

  // Reconcile against the shrink-only baseline, BOTH directions.
  const baseline = loadBaseline();
  const baselineById = new Map(baseline.map((e) => [e.id, e]));
  const observed = new Set(findings.map((f) => f.id));
  // A missing type entry is a statement about the CHECKOUT, not about the
  // README, so it is separated out and gets its own remedy. Reported under the
  // claims heading it read as "this README is wrong" while the actual fix was
  // `pnpm build` — a gate whose failure sends the reader at the wrong file is
  // one push away from being muted.
  const unbuilt = findings.filter((f) => f.fatal);
  const fresh = findings.filter((f) => !f.fatal && !baselineById.has(f.id));
  const stale = baseline.filter((e) => !observed.has(e.id));

  // Every call-site kind, not just the import-bound one: `|instance|` and
  // `|return|` are call sites too, and counting only `|member|` would make the
  // ledger's call-site split shrink the moment the widening found something.
  const memberChecks = findings.filter((f) =>
    CALL_SITE_KINDS.some((kind) => f.id.includes(`|${kind}|`)),
  ).length;
  const header =
    `${docs.length} published document(s) across ${byName.size} workspace package(s); ` +
    `${importStatements} import statement(s), ${targets.size} workspace type entr(ies).`;

  if (unbuilt.length > 0) {
    console.error(
      `✗ check:published-readme-exports — ${unbuilt.length} package(s) are not built, so this\n` +
        '  run measured nothing there. That is reported rather than skipped: a green result\n' +
        '  over an unread tree is indistinguishable from a clean one (#4690).\n',
    );
    for (const f of unbuilt) console.error(`    ${f.id.split('|')[1]} line ${f.line}: ${f.text}`);
    console.error('');
    return 1;
  }

  if (fresh.length === 0 && stale.length === 0) {
    console.log(`✓ check:published-readme-exports — ${header}`);
    console.log(
      successSummary({ measured, baselineCount: baseline.length, memberChecks }),
    );
    return 0;
  }

  if (fresh.length > 0) {
    console.error(`✗ check:published-readme-exports — ${fresh.length} undocumented symbol claim(s)\n`);
    const byFile = new Map();
    for (const f of fresh) {
      const file = f.id.split('|')[1];
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push(f);
    }
    for (const [file, list] of byFile) {
      console.error(`  ${file}`);
      for (const f of list.sort((a, b) => a.line - b.line)) {
        console.error(`    line ${f.line}: ${f.text}`);
        // The baseline key, printed with the finding: a maintainer auditing or
        // SHRINKING the baseline needs it, and the stale-entry direction is
        // unreadable without it. Printing it is not an invitation to add one —
        // see the remedy below.
        console.error(`      key: ${f.id}`);
      }
      console.error('');
    }
    console.error(freshRemedy());
  }

  if (stale.length > 0) {
    console.error(`✗ check:published-readme-exports — ${stale.length} stale baseline entr(ies)\n`);
    for (const e of stale) console.error(`    ${e.id}\n      ${e.why ?? ''}`);
    console.error(
      `\nGood news, and it is still a failure: these README claims now resolve, so their\n` +
        `entries in ${BASELINE_REL} are dead text. Delete them in the same PR that fixed the\n` +
        `README — a baseline that can only grow rots into a list nobody trusts.\n`,
    );
  }
  return 1;
}

// ---------------------------------------------------------------------------
// Self-test
//
// A scanner that has only ever been green cannot be told apart from a scanner
// that matches nothing (#4690), and this one is a text scanner over prose —
// the failure mode where it quietly stops matching is the likely one. So the
// self-test drives the WHOLE pipeline offline, in both directions, over the
// exact shapes measured on the tree: the six fabricated-symbol READMEs must
// produce a finding, and every false positive the scoping decisions were made
// to exclude must produce none.
// ---------------------------------------------------------------------------

function selfTest() {
  const failures = [];
  const eq = (label, actual, expected) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) failures.push(`${label}\n      expected ${e}\n      actual   ${a}`);
  };

  // -- readFences: which blocks are code, and which lines survive -------------
  const fenceDoc = [
    'prose before',
    '```bash',
    'pnpm add @objectstack/service-analytics',
    '```',
    '```typescript',
    "import { A } from '@objectstack/spec';",
    '```',
    '```',
    'untagged is still code',
    '```',
    '```json',
    '{ "import": "@objectstack/spec" }',
    '```',
  ].join('\n');
  eq(
    'readFences — bash and json are not code-language fences',
    readFences(fenceDoc).map((f) => f.lang),
    ['typescript', ''],
  );

  // -- the three MEASURED prose false positives -------------------------------
  const prose = [
    '- ❌ You only need the schemas — import [`@objectstack/spec`](../spec) alone.',
    '- ❌ You only need a REST client — import [`@objectstack/client`](../client).',
    '| `import` | `@objectstack/plugin-auth` admin user import | one run-level row |',
  ].join('\n');
  eq('extractImports — prose mentioning `import` is never a claim', extractImports(prose), []);

  // -- bash fences: an install line is not an import --------------------------
  eq(
    'extractImports — a bash fence is not scanned',
    extractImports('```bash\nimport from @objectstack/spec\n```'),
    [],
  );

  // -- the `diff` migration fence, verbatim from packages/objectql -------------
  const diffFence = [
    '```diff',
    "- import { ObjectQL, SchemaRegistry } from '@objectql/core';",
    "+ import { ObjectQL, SchemaRegistry } from '@objectstack/objectql';",
    '```',
  ].join('\n');
  eq(
    'extractImports — a diff fence reads the `+` side only',
    extractImports(diffFence).map((i) => i.specifier),
    ['@objectstack/objectql'],
  );

  // -- clause shapes -----------------------------------------------------------
  eq('parseImportClause — named', parseImportClause('{ A, B }').named, [
    { imported: 'A', local: 'A' },
    { imported: 'B', local: 'B' },
  ]);
  eq('parseImportClause — alias', parseImportClause('{ A as B }').named, [
    { imported: 'A', local: 'B' },
  ]);
  eq('parseImportClause — `import type {}` is still an export claim', parseImportClause('type { A }').named, [
    { imported: 'A', local: 'A' },
  ]);
  eq('parseImportClause — inline type modifier', parseImportClause('{ type A, B }').named, [
    { imported: 'A', local: 'A' },
    { imported: 'B', local: 'B' },
  ]);
  eq('parseImportClause — default', parseImportClause('Thing').defaultLocal, 'Thing');
  eq('parseImportClause — namespace', parseImportClause('* as ns').namespaceLocal, 'ns');
  eq('parseImportClause — default plus named', parseImportClause('Thing, { A }'), {
    defaultLocal: 'Thing',
    namespaceLocal: null,
    named: [{ imported: 'A', local: 'A' }],
  });

  // -- multi-line clauses, and two statements that must not merge --------------
  const multi = ['```ts', 'import {', '  Alpha,', '  Beta,', "} from '@objectstack/spec';", '```'].join('\n');
  eq(
    'extractImports — multi-line clause',
    extractImports(multi).map((i) => i.named.map((n) => n.imported)),
    [['Alpha', 'Beta']],
  );
  const twoStatements = [
    '```ts',
    "import { Alpha } from '@objectstack/spec';",
    "import { Beta } from '@objectstack/core';",
    '```',
  ].join('\n');
  eq(
    'extractImports — adjacent statements stay separate',
    extractImports(twoStatements).map((i) => `${i.named[0].imported}@${i.specifier}`),
    ['Alpha@@objectstack/spec', 'Beta@@objectstack/core'],
  );

  // -- call sites: only import-bound receivers ---------------------------------
  const calls = [
    '```typescript',
    "import { ServiceAnalytics } from '@objectstack/service-analytics';",
    'ServiceAnalytics.configure({ defaultDriver: "objectql" });',
    'const analytics = kernel.getService("analytics");',
    'await analytics.count({ object: "order" });',
    'wrapper.ServiceAnalytics.configure({});',
    '// ServiceAnalytics.commentedOut();',
    '```',
  ].join('\n');
  eq(
    'extractMemberCalls — import-bound receiver only',
    extractMemberCalls(calls, ['ServiceAnalytics']).map((c) => `${c.object}.${c.member}`),
    ['ServiceAnalytics.configure'],
  );
  eq(
    'extractMemberCalls — nothing is bound, nothing is read',
    extractMemberCalls(calls, []),
    [],
  );

  // -- the adversarial position (#9610), which the fixture above cannot reach ----
  // Every case above puts the wanted receiver where no earlier match on the line
  // has consumed anything in front of it. That is why a gate written with
  // self-tests in BOTH directions still shipped blind to the shape below: the
  // receiver starts at the character immediately after a DISCARDED `X.y(` match,
  // with nothing separating them. It is also the house spelling of the six READMEs
  // this gate exists for, so it is the likeliest wrong rewrite of any of them.
  const nestedReceiver = [
    '```typescript',
    "import { CacheServicePlugin } from '@objectstack/service-cache';",
    'await kernel.use(CacheServicePlugin.configure({ adapter: "memory" }));',
    '```',
  ].join('\n');
  eq(
    'extractMemberCalls — a receiver directly inside a discarded call is still read',
    extractMemberCalls(nestedReceiver, ['CacheServicePlugin']).map((c) => `${c.object}.${c.member}`),
    ['CacheServicePlugin.configure'],
  );

  // The other direction, in that SAME position: reaching it must not widen the
  // fence. Property access, all three quote styles, and the CORRECT `new X(`
  // spelling stay silent when nested exactly as above.
  const nestedRejected = [
    '```typescript',
    "import { CacheServicePlugin } from '@objectstack/service-cache';",
    'await kernel.use(wrapper.CacheServicePlugin.configure({}));',
    "console.log('CacheServicePlugin.configure(');",
    'console.log("CacheServicePlugin.configure(");',
    'console.log(`CacheServicePlugin.configure(`);',
    'await kernel.use(new CacheServicePlugin({ adapter: "memory" }));',
    '```',
  ].join('\n');
  eq(
    'extractMemberCalls — the nested position does not widen the fence',
    extractMemberCalls(nestedRejected, ['CacheServicePlugin']),
    [],
  );

  // -- receivers the fence BUILDS from an import-bound name (#9870) -------------
  // The census that scoped this: 262 call sites across 39 of 60 published
  // documents sat on receivers with no type the gate could reach, against EIGHT
  // it was checking. 109 of the 262 are built out of a name the fence DID
  // import, and those are the ones these bindings reach.
  const derivedDoc = [
    '```typescript',
    "import { ObjectKernel } from '@objectstack/core';",
    "import { bootStack } from '@objectstack/verify';",
    'const kernel = new ObjectKernel();',
    'const stack = await bootStack(myApp);',
    '```',
  ].join('\n');
  eq(
    'extractLocalBindings — `new X()` and `await fn()` bind, each carrying HOW it was built',
    [...extractLocalBindings(derivedDoc, ['ObjectKernel', 'bootStack']).bound],
    [
      ['kernel', { via: 'instance', source: 'ObjectKernel' }],
      ['stack', { via: 'return', source: 'bootStack' }],
    ],
  );
  eq(
    'extractLocalBindings — a name built from something NOT import-bound is not bound',
    [...extractLocalBindings(derivedDoc, []).bound],
    [],
  );

  // Every ambiguity rejects rather than guesses, because the two ways this can
  // be wrong are not symmetric: a wrong green leaves a site unread (where all
  // 262 already sit), a wrong RED accuses a correct README on a merge-blocking
  // gate whose baseline its own file refuses as an author remedy.
  const ambiguousDoc = [
    '```typescript',
    "import { ObjectKernel } from '@objectstack/core';",
    'const shadowed = new ObjectKernel();',
    'const disagrees = new ObjectKernel();',
    'const disagrees = someUnknownFactory();',
    'const opaque = { not: "a constructor" };',
    'items.forEach((shadowed) => shadowed.bootstrap());',
    '```',
  ].join('\n');
  const ambiguous = extractLocalBindings(ambiguousDoc, ['ObjectKernel']);
  eq('extractLocalBindings — nothing ambiguous is bound', [...ambiguous.bound.keys()], []);
  // ⚠️ The REJECT side is asserted POSITIVELY and that is the point: a matcher
  // that quietly stopped binding ANYTHING also yields an empty `bound`, so
  // `bound === []` alone is the same assertion for a working scanner and a dead
  // one. The count of what was rejected, and why, is what tells them apart.
  eq(
    'extractLocalBindings — the reject side is asserted by COUNT, not by the absence of binds',
    [...ambiguous.rejected.keys()].sort(),
    ['disagrees', 'opaque', 'shadowed'],
  );
  eq(
    'extractLocalBindings — and each rejection names its reason',
    ambiguous.rejected.get('shadowed'),
    'also introduced as a binding elsewhere',
  );

  // -- the blind spot the GREEN line now has to state ---------------------------
  const unreadDoc = [
    '```typescript',
    "import { ObjectKernel } from '@objectstack/core';",
    'const kernel = new ObjectKernel();',
    'kernel.bootstrap();',
    'kernel.shutdown();',
    "const other = kernel.getService('mcp');",
    'other.registerTool({});',
    '```',
  ].join('\n');
  eq(
    'countUnreadCalls — a receiver with no reachable type is COUNTED, never silently dropped',
    countUnreadCalls(unreadDoc, ['ObjectKernel']),
    // `kernel.bootstrap`, `kernel.shutdown`, `kernel.getService` and
    // `other.registerTool` — the call on the DECLARATION line counts too, since
    // only import statements and comments are skipped.
    { calls: 4, receivers: 2 },
  );
  eq(
    'countUnreadCalls — and a receiver that BECAME readable leaves the count',
    countUnreadCalls(unreadDoc, ['ObjectKernel', 'kernel']),
    { calls: 1, receivers: 1 },
  );

  // -- specifier splitting ------------------------------------------------------
  eq('splitSpecifier — scoped root', splitSpecifier('@objectstack/spec'), {
    name: '@objectstack/spec',
    subpath: '.',
  });
  eq('splitSpecifier — scoped subpath', splitSpecifier('@objectstack/spec/data'), {
    name: '@objectstack/spec',
    subpath: './data',
  });
  eq('splitSpecifier — relative is not a package', splitSpecifier('./local.js'), null);

  // -- exports-map resolution, both shapes this repo writes ---------------------
  const flat = { exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } } };
  eq('resolveTypesEntry — flat `types` condition', resolveTypesEntry(flat, '.'), {
    entry: './dist/index.d.ts',
    declared: true,
  });
  const nested = {
    exports: {
      '.': { import: { types: './dist/index.d.mts', default: './dist/index.mjs' } },
      './data': { import: { types: './dist/data/index.d.mts', default: './dist/data/index.mjs' } },
    },
  };
  eq('resolveTypesEntry — nested conditions', resolveTypesEntry(nested, './data'), {
    entry: './dist/data/index.d.mts',
    declared: true,
  });
  eq('resolveTypesEntry — undeclared subpath', resolveTypesEntry(nested, './nope'), {
    entry: null,
    declared: false,
  });
  eq('resolveTypesEntry — legacy `types` field', resolveTypesEntry({ types: './dist/index.d.ts' }, '.'), {
    entry: 'dist/index.d.ts',
    declared: true,
  });

  // -- `files` matcher -----------------------------------------------------------
  eq('filesMatcher — a directory entry takes everything beneath it', filesMatcher('dist')('dist/index.js'), true);
  eq('filesMatcher — README.md', filesMatcher('README.md')('README.md'), true);
  eq('filesMatcher — near-miss', filesMatcher('README.md')('docs/README.md'), false);
  eq('filesMatcher — glob', filesMatcher('docs/**/*.md')('docs/guides/a.md'), true);

  // -- END TO END, both directions, on the shape #9532 measured ------------------
  // A fake symbol carries THREE surfaces, because the gate asks three different
  // questions of one exported name: what is on it (`Kernel.create`), what it
  // CONSTRUCTS (`new Kernel().bootstrap`), and what it RETURNS
  // (`defineStack().validate`). Collapsing them would let an instance-method
  // fixture pass against the static surface — the exact confusion #9870's
  // widening exists to avoid.
  const fakeSymbol = (members, derived = {}) => ({
    __members: new Set(members),
    __instance: new Set(derived.instance ?? []),
    __return: new Set(derived.return ?? []),
  });
  const target = (names, memberMap = {}, derivedMap = {}) => ({
    declared: true,
    exports: new Map(names.map((n) => [n, fakeSymbol(memberMap[n] ?? [], derivedMap[n])])),
    hasMember: (sym, m) => sym.__members.has(m),
    hasMemberVia: (sym, m, via) => (via === 'instance' ? sym.__instance : sym.__return).has(m),
  });
  const resolveFake = (name) => {
    if (name === '@objectstack/service-analytics') return target([]);
    if (name === '@objectstack/plugin-audit') return target(['AuditPlugin'], { AuditPlugin: [] });
    if (name === '@objectstack/spec') {
      return target(['defineStack'], { defineStack: [] }, { defineStack: { return: ['validate'] } });
    }
    if (name === '@objectstack/kernel') {
      return target(['Kernel'], { Kernel: ['create'] }, { Kernel: { instance: ['bootstrap'] } });
    }
    return null; // not a workspace package
  };

  const broken = {
    pkg: '@objectstack/service-analytics',
    file: 'packages/services/service-analytics/README.md',
    text: [
      '```typescript',
      "import { defineStack } from '@objectstack/spec';",
      "import { ServiceAnalytics } from '@objectstack/service-analytics';",
      "import { useState } from 'react';",
      '',
      'const stack = defineStack({',
      '  services: [ServiceAnalytics.configure({ defaultDriver: "objectql" })],',
      '});',
      '```',
    ].join('\n'),
  };
  eq(
    'analyzeDocument — the fabricated import is reported, the real one and the non-workspace one are not',
    analyzeDocument(broken, resolveFake).map((f) => f.id),
    ['@objectstack/service-analytics|packages/services/service-analytics/README.md|import|@objectstack/service-analytics|ServiceAnalytics'],
  );

  const honest = {
    pkg: '@objectstack/plugin-audit',
    file: 'packages/plugins/plugin-audit/README.md',
    text: [
      '```typescript',
      "import { defineStack } from '@objectstack/spec';",
      "import { AuditPlugin } from '@objectstack/plugin-audit';",
      '',
      'const stack = defineStack({ plugins: [new AuditPlugin()] });',
      '```',
    ].join('\n'),
  };
  eq('analyzeDocument — the negative control stays clean', analyzeDocument(honest, resolveFake), []);

  // The worse half of the defect: the class is real, the static is invented.
  // This is the case the import half alone cannot see.
  const fabricatedStatic = {
    pkg: '@objectstack/kernel',
    file: 'packages/kernel/README.md',
    text: [
      '```typescript',
      "import { Kernel } from '@objectstack/kernel';",
      'const k = Kernel.create({});',
      'const j = Kernel.configure({});',
      '```',
    ].join('\n'),
  };
  eq(
    'analyzeDocument — a real class with an invented static is reported once',
    analyzeDocument(fabricatedStatic, resolveFake).map((f) => f.id),
    ['@objectstack/kernel|packages/kernel/README.md|member|@objectstack/kernel|Kernel.configure'],
  );

  // ...and the same fabricated static written the way plugin registration is
  // actually written: nested inside another call, no separator (#9610). This ran
  // GREEN end to end on the real tree before the boundary became zero-width.
  const fabricatedStaticNested = {
    pkg: '@objectstack/kernel',
    file: 'packages/kernel/README.md',
    text: [
      '```typescript',
      "import { Kernel } from '@objectstack/kernel';",
      'await app.use(Kernel.configure({}));',
      '```',
    ].join('\n'),
  };
  eq(
    'analyzeDocument — a fabricated static nested inside another call is reported',
    analyzeDocument(fabricatedStaticNested, resolveFake).map((f) => f.id),
    ['@objectstack/kernel|packages/kernel/README.md|member|@objectstack/kernel|Kernel.configure'],
  );

  // -- END TO END on the #9870 shape: the receiver is never import-bound --------
  // `packages/plugins/plugin-hono-server/README.md` documented `await
  // kernel.start()` on a `new ObjectKernel()`. `ObjectKernel` ships
  // `bootstrap()`/`shutdown()` and no `start` — while the `IKernel` INTERFACE
  // does declare `start()`, which is why the line reads plausibly and why eight
  // sibling READMEs spell the same step `await kernel.bootstrap()`. No import
  // claim is wrong there, so the import half is silent by construction; before
  // this widening the call site was one of the 262 nobody read.
  const derivedInstance = {
    pkg: '@objectstack/kernel',
    file: 'packages/kernel/README.md',
    text: [
      '```typescript',
      "import { Kernel } from '@objectstack/kernel';",
      'const kernel = new Kernel({});',
      'await kernel.bootstrap();',
      'await kernel.start();',
      '```',
    ].join('\n'),
  };
  eq(
    'analyzeDocument — an invented method on a `new`-built receiver is reported, the real one is not',
    analyzeDocument(derivedInstance, resolveFake).map((f) => f.id),
    ['@objectstack/kernel|packages/kernel/README.md|instance|@objectstack/kernel|Kernel.start'],
  );
  // The instance surface and the STATIC surface are different questions. Asking
  // the wrong one is silent in both directions, so both directions are pinned:
  // `Kernel.create` is a static and NOT on the instance; `bootstrap` is on the
  // instance and NOT a static.
  const staticVsInstance = {
    pkg: '@objectstack/kernel',
    file: 'packages/kernel/README.md',
    text: [
      '```typescript',
      "import { Kernel } from '@objectstack/kernel';",
      'const kernel = new Kernel({});',
      'Kernel.create({});',
      'kernel.bootstrap();',
      'Kernel.bootstrap();',
      'kernel.create({});',
      '```',
    ].join('\n'),
  };
  eq(
    'analyzeDocument — the static surface and the instance surface are not interchangeable',
    analyzeDocument(staticVsInstance, resolveFake)
      .map((f) => f.id.split('|').slice(2).join('|'))
      .sort(),
    ['instance|@objectstack/kernel|Kernel.create', 'member|@objectstack/kernel|Kernel.bootstrap'],
  );
  const derivedReturn = {
    pkg: '@objectstack/spec',
    file: 'packages/spec/README.md',
    text: [
      '```typescript',
      "import { defineStack } from '@objectstack/spec';",
      'const stack = defineStack({});',
      'stack.validate();',
      'stack.explode();',
      '```',
    ].join('\n'),
  };
  eq(
    'analyzeDocument — a receiver bound to a function CALL is read against what it returns',
    analyzeDocument(derivedReturn, resolveFake).map((f) => f.id),
    ['@objectstack/spec|packages/spec/README.md|return|@objectstack/spec|defineStack.explode'],
  );

  // ⛔ THE REGRESSION THIS WIDENING NEARLY SHIPPED, and the reason the counters
  // are asserted rather than the findings. The first cut let a target that
  // cannot answer the DERIVED question answer it with `() => true`. Every
  // finding stayed absent — correctly, since nothing was knowable — and the run
  // was GREEN while the green line said `78 … call(s) checked`, of which 70 were
  // that fallback. Louder than before and measuring less: #4690 rebuilt inside
  // the fix for #4690's cousin. A findings-only assertion cannot see it, because
  // the correct answer for the vacuous case is also "no findings".
  const blank = () => ({
    symbolChecks: 0,
    receivers: 0,
    derivedReceivers: 0,
    rejectedReceivers: 0,
    callChecks: 0,
    unreadCalls: 0,
    unreadReceivers: 0,
  });
  const answering = blank();
  analyzeDocument(derivedInstance, resolveFake, answering);
  eq(
    'analyzeDocument — a target that CAN answer the derived question reads both call sites',
    { derived: answering.derivedReceivers, checked: answering.callChecks, unread: answering.unreadCalls },
    { derived: 1, checked: 2, unread: 0 },
  );
  const mute = { ...resolveFake('@objectstack/kernel'), hasMemberVia: undefined };
  const silent = blank();
  analyzeDocument(derivedInstance, () => mute, silent);
  eq(
    'analyzeDocument — a target that CANNOT answer it checks nothing there, and says so',
    { derived: silent.derivedReceivers, checked: silent.callChecks, unread: silent.unreadCalls },
    { derived: 0, checked: 0, unread: 2 },
  );

  // Undeclared subpath: the packaged surface says something the source does not.
  const badSubpath = {
    pkg: '@objectstack/service-analytics',
    file: 'packages/services/service-analytics/README.md',
    text: "```ts\nimport { Thing } from '@objectstack/spec/nowhere';\n```",
  };
  eq(
    'analyzeDocument — an undeclared subpath is its own finding',
    analyzeDocument(badSubpath, (name, subpath) =>
      name === '@objectstack/spec' && subpath === './nowhere' ? { declared: false } : null,
    ).map((f) => f.id.split('|')[2]),
    ['subpath'],
  );

  // The GREEN line (#9767). Its counts are interpolated too, so — exactly like
  // the remedy below — reading the SOURCE is not evidence about the sentence a
  // reader gets. Driven here instead, in the three states a passing run has.
  const measuredReal = {
    symbolChecks: 313,
    receivers: 233,
    derivedReceivers: 46,
    rejectedReceivers: 0,
    callChecks: 78,
    unreadCalls: 120,
    unreadReceivers: 72,
  };
  const scanned = successSummary({ measured: measuredReal, baselineCount: 0, memberChecks: 0 });
  eq(
    'successSummary — with the ledger EMPTY the line says what each half read',
    scanned.split('\n'),
    [
      '  0 known instance(s) still in scripts/published-readme-exports.baseline.json.',
      '  Import half: 313 documented symbol(s) checked against the exports their package publishes.',
      '  Call-site half: 78 documented `X.y(…)` call(s) checked, on 233 import-bound name(s) and 46 name(s) built from one.',
      '  NOT read: 120 documented `X.y(…)` call(s) on 72 receiver(s) with no type this gate can reach',
      '  (free variables, parameters, globals, non-workspace imports). Visibility, not a verdict — see #9870.',
    ],
  );
  // ⚠️ The blind spot must be stated as a SIZE and disclaimed as visibility. A
  // green line that prints only what it checked is the overclaim #9870 filed:
  // `60 published document(s)` reads as coverage of documents, when what is
  // covered is the import-bound receivers inside them.
  if (!/NOT read: \d+ documented/.test(scanned) || !/not a verdict/.test(scanned)) {
    failures.push(
      'the GREEN body must state HOW MANY call sites went unread, and mark that number as\n' +
        '      visibility rather than a verdict. Without the first it overclaims; without the\n' +
        '      second a reader takes an unread call site for a reported defect.',
    );
  }
  eq(
    'successSummary — a NON-EMPTY ledger keeps the call-site split, WITH its denominator',
    successSummary({ measured: measuredReal, baselineCount: 2, memberChecks: 1 }).split('\n')[0],
    '  2 known instance(s) still in scripts/published-readme-exports.baseline.json (1 of the 2 at a call site).',
  );

  // THE regression this card exists for. A tree where both halves read hundreds
  // of claims and a tree where they read NOTHING must not print the same green
  // body — that is #4690 moved out of the verdict and into the output. The
  // clause these pins replaced ("N of the findings are call sites") was
  // byte-identical in both, because with an empty ledger it is a ratio over an
  // empty set.
  const unscanned = successSummary({ measured: blank(), baselineCount: 0, memberChecks: 0 });
  if (scanned === unscanned) {
    failures.push(
      'the GREEN body renders IDENTICALLY for a tree that was scanned and one that was not.\n' +
        '      A reader cannot tell "60 documents read, nothing wrong" from "nothing was read",\n' +
        '      which is exactly the ambiguity this gate is emphatic about everywhere else.',
    );
  }
  if (/of the findings/.test(scanned)) {
    failures.push(
      'the GREEN body must state each half\'s INPUT VOLUME, never a ratio over the findings.\n' +
        '      A zero in "0 documented call(s) checked" is an alarm a reader can act on; a zero\n' +
        '      in "0 of the findings are call sites" is a ratio over an empty set and says\n' +
        '      nothing at all.',
    );
  }

  // -- THE POPULATION AXIS, and the third refusal on it (#9911) ---------------
  //
  // The state this refusal exists for: documents exist, import statements
  // exist, and NOT ONE resolves to a workspace member. Measured on the gate as
  // it stood before this change, over exactly this shape: `exit 0`, under a
  // green line reading `3 import statement(s), 0 workspace type entr(ies)`.
  //
  // ⭐ The zeros below are MEASURED, never typed. The fixture is a real
  // document and a real `byName`, put through `reachedTargets` -- the same
  // function `run()` calls. A hand-written `targets: 0` would pin the refusal's
  // arithmetic while proving nothing about the scan that produces the zero,
  // which is the very species of vacuity this card is about.
  const nothingResolves = [
    {
      pkg: '@fixture/alpha',
      file: 'packages/alpha/README.md',
      text: [
        '```typescript',
        "import { useState } from 'react';",
        "import { ObjectQL } from '@objectql/core';",
        "import { z } from 'zod';",
        'ObjectQL.configure({});',
        '```',
      ].join('\n'),
    },
  ];
  const otherWorkspace = new Map([['@objectstack/spec', { dir: 'packages/spec', manifest: {} }]]);
  const emptyPopulation = reachedTargets(nothingResolves, otherWorkspace);
  // ⭐ THE REJECT SIDE, ASSERTED POSITIVELY. `targets: 0` on its own is also
  // what a dead extractor returns -- so what the scan READ and then REJECTED is
  // pinned next to it. Three import statements were found, resolved against
  // `byName`, and turned away. Without this number the case below would pass
  // just as happily on an `extractImports` that had stopped matching entirely.
  eq(
    'reachedTargets — the no-population state: imports READ and REJECTED, not absent',
    { imports: emptyPopulation.importStatements, targets: emptyPopulation.targets.size },
    { imports: 3, targets: 0 },
  );
  const stage3 = populationRefusal(
    {
      documents: nothingResolves.length,
      importStatements: emptyPopulation.importStatements,
      targets: emptyPopulation.targets.size,
    },
    'gate',
  );
  if (stage3 === null) {
    failures.push(
      'a run that read documents AND import statements but resolved NOTHING to a workspace\n' +
        '      package is not refused. `targets` is empty, so `bound` is empty in every document\n' +
        '      and both halves check nothing — the #4690 claim this gate already refuses at two\n' +
        '      earlier stages, reported as a pass (#9911).',
    );
  } else {
    // Stage 3 must SAY what it read, or a CI log cannot tell it from stage 2 —
    // and the two send the reader at different files: stage 2 at the extractor,
    // stage 3 at workspace resolution.
    for (const [what, ok] of [
      ['name the documents it read', stage3.includes('1 document(s)')],
      ['name the imports it read', stage3.includes('3 import statement(s)')],
      ['carry the #4690 remedy voice', stage3.includes('(#4690)')],
      ['point at workspace resolution', stage3.includes(WORKSPACE_FILE)],
      ['refuse the baseline as a silencer', stage3.includes(BASELINE_REL)],
    ]) {
      if (!ok) failures.push(`the third population refusal must ${what}.`);
    }
  }

  // The other direction, on the SAME document: put one imported package into
  // the workspace and the refusal must fall silent — against a population of
  // ONE. A gate that reddens a legitimately small tree is worse than the
  // silence it replaces, because this one is merge-blocking and its own remedy
  // refuses the baseline as an escape.
  const onePopulation = reachedTargets(
    nothingResolves,
    new Map([...otherWorkspace, ['@objectql/core', { dir: 'packages/objectql', manifest: {} }]]),
  );
  eq(
    'reachedTargets — one resolving import IS a population, out of the same three',
    { imports: onePopulation.importStatements, targets: onePopulation.targets.size },
    { imports: 3, targets: 1 },
  );
  eq(
    'populationRefusal — a population of ONE is never refused',
    populationRefusal({
      documents: 1,
      importStatements: onePopulation.importStatements,
      targets: onePopulation.targets.size,
    }),
    null,
  );

  // The three stages are one ordered axis. Pinned so a later edit cannot
  // reorder them into a refusal that shadows the two above it, and so the
  // wording of each stays the one its remedy belongs to.
  eq(
    'populationRefusal — stage 1 speaks for a scan that read nothing',
    populationRefusal({ documents: 0, importStatements: 0, targets: 0 }, 'gate'),
    'gate: no published markdown found — the scan read nothing (#4690).',
  );
  eq(
    'populationRefusal — stage 2 speaks when documents were read and hold no imports',
    populationRefusal({ documents: 7, importStatements: 0, targets: 0 }, 'gate'),
    'gate: read 7 document(s) and found no imports at all (#4690).',
  );
  eq(
    'populationRefusal — three stages, three DIFFERENT sentences',
    new Set([
      populationRefusal({ documents: 0 }, 'gate'),
      populationRefusal({ documents: 1, importStatements: 0 }, 'gate'),
      stage3,
    ]).size,
    3,
  );
  // A stage the caller has not measured must never be refused on. This is what
  // lets `publishedDocs` — which knows only the document count — share the
  // function without speaking for quantities it never counted.
  eq(
    'populationRefusal — an UNMEASURED stage is not a zero',
    [populationRefusal({ documents: 7 }), populationRefusal({ documents: 7, importStatements: 3 })],
    [null, null],
  );

  // The authority convention (#8435): the baseline path must never be offered
  // as a co-equal author remedy.
  const remedy = freshRemedy();
  if (!remedy.includes(RATCHET_AUTHORITY_MARKER) || !remedy.includes(BASELINE_REL)) {
    failures.push(
      `the AUTHOR-FACING remedy must name ${BASELINE_REL} together with the ` +
        `${RATCHET_AUTHORITY_MARKER} token. Asserting on the file's SOURCE would not test this: ` +
        'the token is interpolated, so it appears in the source only at its `const`.',
    );
  }
  if (!/not an author remedy/.test(remedy)) {
    failures.push(
      'the remedy must REFUSE the baseline as a fix, not merely mark it — this gate takes the ' +
        'refusal arm of the #8435 convention and the text is what carries that.',
    );
  }

  if (failures.length > 0) {
    console.error(`✗ check:published-readme-exports --self-test — ${failures.length} failure(s)\n`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }
  console.log(
    '✓ check:published-readme-exports --self-test — extraction, scoping, resolution and both\n' +
      '  analysis directions pinned (fabricated import reported, fabricated static reported,\n' +
      '  fabricated INSTANCE and RETURN methods reported on receivers the fence builds,\n' +
      '  honest README clean, and every measured prose/bash/diff false positive silent), plus\n' +
      '  the reject side by COUNT (#9870: an empty bind set is also what a dead matcher\n' +
      '  returns) and the author-facing text: the remedy refuses the baseline, and the green\n' +
      '  line reports what each half READ and how much it could NOT, so a scanned tree and an\n' +
      '  unread one cannot print the same body. All THREE stages of the population axis are\n' +
      '  refusals (#9911), the third one over a fixture whose zero is measured by the same\n' +
      '  `reachedTargets` the run uses — three imports read, three rejected, nothing resolved\n' +
      '  — with the reject side pinned as a population of ONE going deliberately silent.',
  );
}

/* Run only when invoked as a program — `publishedDocs` and the extractors are
 * exported so a sibling gate can reuse this gate's population without the
 * import itself building a TypeScript program and sweeping the workspace. */
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) {
    selfTest();
    process.exit(0);
  }
  try {
    process.exit(run());
  } catch (err) {
    console.error(`✗ check:published-readme-exports — ${err.message}`);
    process.exit(1);
  }
}
