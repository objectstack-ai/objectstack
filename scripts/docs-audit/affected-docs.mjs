#!/usr/bin/env node
// Map a set of `packages/**` code changes to the hand-written docs that NAME something
// the change touched, so a doc-accuracy audit can be scoped to what actually changed
// instead of re-auditing every hand-written doc (178 of them today) each time.
//
// Usage:
//   node scripts/docs-audit/affected-docs.mjs [sinceRef]   # docs affected by changes since <sinceRef> (default origin/main)
//   node scripts/docs-audit/affected-docs.mjs --all         # every hand-written doc (full audit)
//   node scripts/docs-audit/affected-docs.mjs --json [...]   # emit JSON {docs, anchors, anchorlessChanges, ...} instead of a path list
//   node scripts/docs-audit/affected-docs.mjs --self-test    # pin the change classifiers, package-root and ANCHOR derivations (no repo state needed)
//
// Scope: hand-written docs only = content/docs/**/*.mdx MINUS content/docs/references/**
// (references are generated from packages/spec and handled by a separate regenerate pass).
//
// DERIVATION (#9192): a doc is "affected" when it NAMES SOMETHING THE CHANGE TOUCHED —
// an ANCHOR — not when it merely mentions the changed package.
//
// The package-mention predicate this replaced ("which hand-written docs reference
// `@objectstack/metadata-protocol`") is a DEPENDENCY-GRAPH PROXY answering a SEMANTIC
// question, and it was measured wrong in BOTH directions on one real PR (#9191, the
// three read verbs `auditMetaItem` / `historyMetaItem` / `findReferencesToMeta`):
//
//   - 3 pages listed, 1 relevant. `concepts/metadata-lifecycle.mdx` had zero hits on
//     either probe set; `kernel/services-checklist.mdx` matched only on a service SLOT
//     NAME. A page that names the package need not document the changed symbol.
//   - 2 pages that DO document the changed surface were absent: `api/client-sdk.mdx`
//     (`meta.getReferences` / `meta.getAudit`) and `kernel/contracts/metadata-service.mdx`
//     (`getHistory?(type, name, …)`). They document it through the SDK/contract surface,
//     which does not depend on the implementing package at all.
//
// Over-inclusion is NOT free here, and that is the correction: a wrong-both-ways
// advisory trains its reader to skip it, and then it fails on the PR where it is right
// (the same bill exclusion 1 below already paid). So this derivation is PRECISION-FIRST:
// a shorter right list beats a longer noisy one. Three anchor kinds, each exact:
//
//   symbol — a DOCUMENTABLE declaration the diff touched: a top-level declaration, or a
//            member of a top-level container (class / interface / type / enum / schema
//            object). Locals inside a function body are NOT documentable surface — that
//            single rule is what drops the `singular` false positive above. Taken from
//            BOTH sides of the diff, so a REMOVED export still anchors the pages naming it.
//   route  — a wire path the change touched: a path literal on a changed line, plus every
//            route whose REGISTRAR HANDLER references a changed symbol (that is the
//            mechanical `auditMetaItem` → `GET /api/v1/meta/:type/:name/audit` link).
//   sdk    — the client method a route ledger BINDS to an anchor route
//            (`meta.getAudit`). The declared cross-surface table is what carries the
//            derivation over the boundary the package graph cannot cross, and it is what
//            puts `api/client-sdk.mdx` back on the list.
//
// What this cannot see is REPORTED, never implied: files that yield no anchor at all are
// listed as `anchorlessChanges`, and the coarse package-mention set is still computed and
// emitted as `packageMentionDocs` — labelled coarse, not rendered as a work list. Silence
// from this tool must never be readable as "there is nothing there"; that misreading is
// the whole subject of #9192.
//
// Three exclusions, though — change classes that cannot make an implementation-accuracy
// doc stale, dropped before the changed package roots are derived (everything else
// stays deliberately over-inclusive):
//   - TEST files: tests do not define behaviour — they observe it. Counting them made
//     every tests-only PR light up its packages' whole doc set (three in a row on
//     #4064 / #4078 / one before), a class of finding that is always false. A reader
//     who learns the comment is usually noise stops reading it, and then it fails to
//     do its job on the PR where it is right.
//   - TOOLING scripts (`<packageRoot>/scripts/**`): build/verification tooling, not
//     the runtime behaviour docs describe (#4183 flagged 106 docs for a diff whose
//     only code change was a new check script).
//   - DEV-ONLY manifest edits (#6893): a `<packageRoot>/package.json` whose changed
//     TOP-LEVEL KEYS are all dev-time (`scripts`, `devDependencies`). The package.json
//     as a whole stays counted — `exports`/`main`/`dependencies` changes ARE
//     implementation — so this is a field-level, not a file-level, exclusion.
//
//     This is the residue of the #4183 fix: that one excluded the check *script* but
//     kept the `package.json` line that registers it, so the same PR still lit up the
//     same doc set through the manifest. Measured over 400 merged commits, FIVE had a
//     package.json as their only `packages/**` implementation change, and all five
//     touched nothing but those two keys — together flagging 152 doc-rows, none of
//     which could be stale:
//       df0605ba5 `scripts`          → 12 docs   (@objectstack/rest turbo wiring)
//       2672f855f `scripts`          → 113 docs  (@objectstack/spec build line; #6893's headline)
//       a64315556 `devDependencies`  → 10 docs   (a test migrated to sqlite)
//       77d9001c7 `devDependencies`  → 13 docs   (a test's engine shape)
//       466bd9285 `devDependencies`  → 4 docs    (test-only, two packages)
//     The last three are test-only commits, i.e. exactly the class the TEST exclusion
//     above exists to kill — leaking through the manifest instead.
//
//     Why this cannot narrow the net: the classifier is per FILE. If a PR also touches
//     that package's `src/**`, those files add the package root on their own, so this
//     branch only ever decides the case where the manifest is the package's ONLY change.
//     Unparseable, added or deleted manifests fall back to "counted".
//
// And one FORK, which is not an exclusion (#6893, following the #4920 ruling):
// `content/docs/releases/**` pages stay in `docs` — they are audited, read-only — but
// are reported separately so a reader is told to file an issue rather than edit them.
// See the RELEASE_OWNED_PREFIX block below.

import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const repoRoot = execSync('git rev-parse --show-toplevel').toString().trim();
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const all = args.includes('--all');
const sinceRef = args.find((a) => !a.startsWith('--')) || 'origin/main';

// --- 0. classifier constants -------------------------------------------------
// Declared up here, ahead of the `--self-test` short-circuit below, because `const` is
// not hoisted: the self-test exercises the classifiers that read these, so leaving them
// down beside their functions makes `--self-test` die in the temporal dead zone. The
// functions themselves can stay where they read best — those ARE hoisted.

/**
 * Release-owned pages — AGENTS.md's Documentation Guardrails forbid a code PR from
 * editing anything under this prefix, and `.claude/workflows/docs-accuracy-audit.js`
 * routes the same prefix down a read-only channel (#4920).
 *
 * This is the THIRD literal copy of that path (AGENTS.md's guardrail row, the
 * workflow's own const, and this one). Three copies is deliberate, not sloppiness:
 * the workflow is evaluated in a sandbox VM and cannot import, so a shared module
 * would leave its copy the only unanchored one — the worst of both. Instead
 * `scripts/docs-audit/check-audit-scope.mjs` anchors ALL of them to the guardrail row
 * and goes red the moment one drifts, which is the same discipline #4851 billed us for.
 *
 * NOTE this is a REPORTING fork, never an exclusion. Release pages stay in `docs`, so
 * the audit scoping command still returns them and they keep getting audited. #4920
 * considered excluding them and REJECTED it: the most-read pages in the docs would go
 * permanently unaudited and silently, and a second definition of "docs this tooling
 * covers" would grow next to the generated block. What forks is the DELIVERABLE — the
 * drift comment tells the reader to file an issue instead of editing (#6893: a comment
 * listing `content/docs/releases/v17.mdx` next to editable pages steers a dev who
 * treats the list as a worklist straight into the one edit the repo forbids).
 */
const RELEASE_OWNED_PREFIX = 'content/docs/releases/';
const isReleaseOwned = (doc) => doc.startsWith(RELEASE_OWNED_PREFIX);

/**
 * The `package.json` top-level keys that are DEV-TIME ONLY — a change confined to them
 * cannot alter the runtime behaviour a doc describes, so it cannot make one stale.
 *
 * Deliberately tiny, and deliberately an allowlist rather than a denylist: an unknown
 * or newly-invented key must fall on the "counted" side. `dependencies`,
 * `peerDependencies`, `exports`, `main`, `module`, `types`, `bin`, `files`, `engines`
 * and everything else are all implementation or publication surface and stay counted.
 *
 * Both entries have measured pull (#6893, 400 commits): `scripts` twice,
 * `devDependencies` three times — see the header table.
 */
const DEV_ONLY_PACKAGE_JSON_KEYS = new Set(['scripts', 'devDependencies']);

/**
 * Statement heads a LINE-BASED declaration probe must never mistake for a declared name.
 * `if (…) {`, `switch (x) {` and `await something(` all have the shape "identifier then
 * an opening bracket" that the member pattern looks for, and every one of them would
 * otherwise become an anchor on the strength of a control-flow line.
 */
const NON_DECLARATION_HEADS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'await', 'throw', 'new', 'else', 'do',
  'try', 'typeof', 'delete', 'void', 'yield', 'case', 'break', 'continue', 'with', 'in', 'of',
  'function', 'class', 'const', 'let', 'var', 'import', 'export', 'declare', 'this', 'super',
  'async', 'static', 'public', 'private', 'protected', 'readonly', 'abstract', 'override',
  'get', 'set', 'default', 'implements', 'extends', 'satisfies', 'as',
]);

/**
 * Declaration names too generic to identify anything. An anchor's whole job is to point
 * at ONE surface; a name that half the corpus uses in an unrelated sense points at the
 * corpus. These are dropped from the anchor set, never from the diff — the change is
 * still counted, it just contributes no anchor through that name.
 *
 * `field` / `fields` are in here despite being real metadata vocabulary, and the reason
 * is the doc side rather than the code side: as a DECLARATION name they are almost always
 * a local shape (`const fields = …`), while as a doc token they appear in a code span on
 * nearly every data-modelling page. That pairing is exactly the wrong-both-ways trade
 * this rewrite exists to stop. A genuine field-surface change anchors through the
 * property literal or the schema export instead.
 */
const GENERIC_ANCHOR_NAMES = new Set([
  'type', 'types', 'name', 'names', 'value', 'values', 'data', 'result', 'results',
  'options', 'opts', 'config', 'context', 'ctx', 'error', 'errors', 'item', 'items',
  'list', 'index', 'key', 'keys', 'ids', 'request', 'response', 'req', 'res', 'limit',
  'offset', 'count', 'total', 'message', 'status', 'code', 'path', 'paths', 'file',
  'files', 'input', 'output', 'args', 'params', 'props', 'state', 'init', 'main', 'run',
  'test', 'build', 'check', 'singular', 'plural', 'entry', 'entries', 'record', 'records',
  'row', 'rows', 'field', 'fields', 'source', 'target', 'kind', 'mode', 'level', 'scope',
  'handler', 'callback', 'result', 'output', 'events', 'event',
]);

/**
 * Declaration probes, ordered — first match wins, so the keyword forms sit ahead of the
 * catch-all member/property form (otherwise `const x = …` would be read as a member `x`).
 *
 * `container: true` marks a kind whose direct children are themselves documentable
 * surface (a class's methods, an interface's members, a schema object's keys). A
 * `function` is NOT a container: the `const` on line 2 of a function body is a local, and
 * treating it as surface is precisely how `singular` reached the advisory.
 */
const DECL_PATTERNS = [
  { kind: 'class', container: true, re: /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'interface', container: true, re: /^\s*(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'enum', container: true, re: /^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'namespace', container: true, re: /^\s*(?:export\s+)?(?:declare\s+)?(?:namespace|module)\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'type', container: true, re: /^\s*(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)/ },
  { kind: 'function', container: false, re: /^\s*(?:export\s+)?(?:declare\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/ },
  { kind: 'binding', container: null, re: /^\s*(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/ },
  // Members and object/schema keys: `name(`, `name<`, `name:`, `name?:`, `name =`.
  { kind: 'member', container: false, re: /^\s*(?:(?:public|private|protected|static|readonly|abstract|override|async|get|set)\s+)*\*?\s*([A-Za-z_$][\w$]*)\s*(?:\?\s*)?(?:[(<:]|=[^=>])/ },
];

/**
 * Where route REGISTRARS live. Deliberately a filename convention rather than a hand-kept
 * file list — the same choice the package-root derivation made for the same reason (#4162:
 * a hardcoded list fails again on container number eight). A registrar this misses costs
 * recall on the `sdk` anchor kind only, and `anchorlessChanges` reports the silence.
 */
const REGISTRAR_FILE_RE = /(?:^|\/)(?:[\w.-]*route[\w.-]*|[\w.-]*-server)\.ts$/;

/** Route LEDGERS — the declared `route` ⟷ `client` tables the `sdk` anchor rides on. */
const LEDGER_FILE_RE = /(?:^|\/)[\w.-]*route-ledger\.ts$/;

/** How far past a `path:` line a registrar's handler body is scanned for identifiers. */
const REGISTRAR_HANDLER_WINDOW = 150;

/**
 * Above this many routes, a changed symbol is a CROSS-CUTTING helper rather than one
 * route's implementation, and the symbol → route bridge stops firing for it. The three
 * read verbs the #9192 measurement is built on map to exactly one route each; the REST
 * error responders that blew the list up map to six and more.
 */
const MAX_ROUTES_PER_SYMBOL = 3;

/**
 * The share of the hand-written corpus above which an anchor is a hub term rather than an
 * identifier. Calibrated against this repo's measured hub anchors — `ObjectQL` at 59/178
 * pages (33%) and `object` at 113/178 (63%) — versus the real ones a change should keep:
 * `FieldSchema` at 10 and `SecurityPlugin` at 5. 15% (26 pages today) sits in that gap.
 */
const OVERBROAD_ANCHOR_SHARE = 0.15;

const indentOf = (line) => line.length - line.trimStart().length;

/**
 * An anchor is CODE-SHAPED when its own spelling marks it as an identifier —
 * camelCase, PascalCase, snake_case, dotted. Those may be matched anywhere in a doc.
 *
 * An all-lowercase single word cannot be told from prose, so it is matched only inside
 * code spans and fenced blocks. Same anchor set either way; the shape decides how much
 * of the page it is allowed to see.
 */
const isCodeShaped = (name) => /[A-Z]/.test(name.slice(1)) || name.includes('_') || name.includes('.');

// Short-circuit before any git or filesystem work — the self-test needs no repo state.
if (args.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

function sh(cmd) {
  return execSync(cmd, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
}

// --- 1. enumerate hand-written docs ----------------------------------------
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && p.endsWith('.mdx')) out.push(p);
  }
  return out;
}
const docsRoot = join(repoRoot, 'content/docs');
const refsRoot = join(repoRoot, 'content/docs/references');
const handwritten = walk(docsRoot)
  .filter((p) => !p.startsWith(refsRoot))
  .map((p) => relative(repoRoot, p))
  .sort();

if (all) {
  emit(handwritten, [], 'all hand-written docs');
  process.exit(0);
}

// --- 2. changed package roots since <sinceRef> -----------------------------
let changedFiles = [];
let threeDot = true;
try {
  // three-dot: changes on HEAD since the merge-base with sinceRef
  changedFiles = sh(`git diff --name-only ${sinceRef}...HEAD -- packages/`).split('\n').filter(Boolean);
} catch {
  // fall back to two-dot (e.g. detached/ranges that lack a merge-base)
  threeDot = false;
  changedFiles = sh(`git diff --name-only ${sinceRef} -- packages/`).split('\n').filter(Boolean);
}

// The ref the diff is actually measured FROM — needed to read a file's "before" side
// when a change class is decided by content rather than by path (the dev-only manifest
// rule below). Kept in lockstep with the diff above: three-dot measures from the
// merge-base, two-dot from sinceRef itself. A failing merge-base does NOT re-run the
// diff — that would silently change which files are considered.
let baseRef = sinceRef;
if (threeDot) {
  try { baseRef = sh(`git merge-base ${sinceRef} HEAD`).trim() || sinceRef; } catch { /* keep sinceRef */ }
}

/**
 * A test file — it observes behaviour rather than defining it, so changing one cannot
 * make an implementation-accuracy doc stale. Covers the repo's conventions: `*.test.*`
 * / `*.spec.*` at any depth (including `.integration.test.ts` and `.conformance.test.ts`)
 * plus anything under a `__tests__` / `__mocks__` / `__fixtures__` directory.
 *
 * Verify with `--self-test`.
 */
function isTestFile(path) {
  return /(^|\/)__(tests|mocks|fixtures)__\//.test(path)
    || /(^|\/)[^/]+\.(test|spec)\.[^/]+$/.test(path);
}

/**
 * The package root that owns a changed path: the DEEPEST ancestor directory with a
 * package.json. Derived from the filesystem, not from a hand-kept list of container
 * directories — the old regex special-cased `packages/plugins/*` only, so the other
 * six containers (services/, connectors/, apps/, qa/, triggers/, adapters/) collapsed
 * to the container dir, which has no package.json, so `name` stayed null and the
 * npm-name matching arm never fired for those 30 nested packages (#4162 — a doc that
 * says `@objectstack/service-automation` but never the path was a guaranteed miss).
 * A hardcoded list would fail the same way again on container dir number eight
 * (#3786's pattern), so: filesystem.
 *
 * A path with no package.json anywhere up it (a deleted package) falls back to the
 * top-level `packages/<x>` segment: the npm name is unresolvable either way, and the
 * coarse path token still substring-matches every doc that mentions the deleted
 * package's path.
 *
 * `hasPackageJson` is injectable so `--self-test` can pin this with no repo state.
 */
function packageRootOf(file, hasPackageJson = dirHasPackageJson) {
  const segs = file.split('/');
  if (segs[0] !== 'packages' || segs.length < 3) return null; // not a file inside a package
  for (let depth = segs.length - 1; depth >= 2; depth--) {
    const dir = segs.slice(0, depth).join('/');
    if (hasPackageJson(dir)) return dir;
  }
  return segs.slice(0, 2).join('/');
}

function dirHasPackageJson(dir) {
  return existsSync(join(repoRoot, dir, 'package.json'));
}

/**
 * A tooling script — `<packageRoot>/scripts/**` holds build/verification tooling
 * (generators, check scripts, i18n-extract configs), not the runtime behaviour docs
 * describe, so changing one cannot make an implementation-accuracy doc stale. Same
 * reasoning as the test-file exclusion, same measured symptom (#4183: a new check
 * script plus its package.json registration, zero `src/` changes, 106 docs flagged).
 * Deliberately narrow:
 *   - only `scripts/` directly under the package root — `src/scripts/**` is runtime
 *     code and stays counted;
 *   - `package.json` is NOT excluded: exports/main/deps changes are implementation;
 *   - generator output that docs do consume lands in `content/docs/references/**`,
 *     which this tool already scopes out.
 * Publication check (the one way this could hide runtime code): no package's `files`
 * allowlist ships `scripts/`; three plugins ship it only incidentally (no `files`
 * field at all) and it holds a lone `i18n-extract.config.ts` — tooling, not runtime.
 */
function isToolingScript(file, hasPackageJson = dirHasPackageJson) {
  const root = packageRootOf(file, hasPackageJson);
  return root !== null && file.startsWith(`${root}/scripts/`);
}

/**
 * The top-level keys whose values differ between two package.json texts, or `null` if
 * either side cannot be parsed as a JSON object.
 *
 * `null` (not `[]`) for unparseable input, because the two mean opposite things to the
 * caller: "nothing changed" is safe to exclude, "I could not tell" must be counted.
 */
function changedManifestKeys(beforeText, afterText) {
  let before;
  let after;
  try {
    before = JSON.parse(beforeText);
    after = JSON.parse(afterText);
  } catch {
    return null;
  }
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(before) || !isObj(after)) return null;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).sort();
}

/**
 * Is this manifest diff confined to dev-time keys?
 *
 * An EMPTY changed-key set counts as dev-only: the file was touched but nothing
 * semantically changed (reformatting, key reordering), which by definition cannot make
 * a doc stale. An unparseable side is NOT dev-only — see `changedManifestKeys`.
 */
function isDevOnlyManifestDiff(beforeText, afterText) {
  const changed = changedManifestKeys(beforeText, afterText);
  if (changed === null) return false;
  return changed.every((k) => DEV_ONLY_PACKAGE_JSON_KEYS.has(k));
}

/**
 * A dev-only manifest edit: `<packageRoot>/package.json` whose changed top-level keys
 * are all in `DEV_ONLY_PACKAGE_JSON_KEYS` (#6893).
 *
 * Only the package root's OWN manifest qualifies — a `package.json` sitting anywhere
 * else under the package (a fixture, a nested asset) is not the package manifest and
 * stays counted. Added or deleted manifests stay counted too: a package appearing or
 * disappearing is as implementation as a change gets.
 *
 * `io` is injectable so `--self-test` can pin this with no repo state; live, it reads
 * the two sides out of git.
 */
function isDevOnlyManifestChange(file, io = liveManifestIo, hasPackageJson = dirHasPackageJson) {
  const root = packageRootOf(file, hasPackageJson);
  if (root === null || file !== `${root}/package.json`) return false;
  const beforeText = io.base(file);
  const afterText = io.head(file);
  if (beforeText === null || afterText === null) return false;
  return isDevOnlyManifestDiff(beforeText, afterText);
}

const liveManifestIo = {
  base: (file) => {
    try { return sh(`git show ${baseRef}:${file}`); } catch { return null; }
  },
  // HEAD, not the working tree: the diff above is measured against HEAD, so comparing
  // against a dirty worktree could exclude a file on the strength of an edit that is
  // not in the diff at all. Falls back to the worktree only if HEAD has no such path.
  head: (file) => {
    try { return sh(`git show HEAD:${file}`); } catch { /* fall through */ }
    try { return readFileSync(join(repoRoot, file), 'utf8'); } catch { return null; }
  },
};

// --- 2b. anchors: what the change actually touched ---------------------------


/**
 * The declaration a single source LINE declares, or `null`. Line-based on purpose: this
 * script is dependency-free by contract (the CI job that runs it never installs anything),
 * so there is no TypeScript parser to reach for. The cost of that is bounded by the two
 * rules around it — `NON_DECLARATION_HEADS` throws out statement heads, and only rank 0/1
 * results are ever accepted (see `documentableDeclarationsAt`).
 */
function declarationOn(line) {
  if (/^\s*(?:[)}\]]|\/\/|\/\*|\*)/.test(line)) return null; // closers and comment bodies
  for (const { kind, container, re } of DECL_PATTERNS) {
    const m = line.match(re);
    if (!m) continue;
    const name = m[1];
    if (NON_DECLARATION_HEADS.has(name)) return null;
    // A `const` is a container only when it is not a function in disguise: a schema
    // object (`export const X = z.object({`) owns its keys, an arrow function owns locals.
    const isContainer = container === null ? !/=>|\bfunction\b/.test(line) : container;
    return { name, kind, container: isContainer };
  }
  return null;
}

/**
 * The declaration chain enclosing (or standing on) `idx`, innermost first.
 *
 * Closing-bracket lines are skipped WITHOUT lowering the running indent: `    }> {` ends a
 * multi-line signature, and letting it consume indent level 4 would hide the method
 * signature above it and hand the change to the previous sibling method instead.
 */
function declarationChainAt(lines, idx) {
  const chain = [];
  let indent = indentOf(lines[idx]);
  const own = declarationOn(lines[idx]);
  if (own) chain.push({ ...own, indent });
  for (let i = idx - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (/^\s*[)}\]]/.test(line)) continue;
    const li = indentOf(line);
    if (li >= indent) continue;
    const d = declarationOn(line);
    if (d) chain.push({ ...d, indent: li });
    indent = li;
    if (li === 0) break;
  }
  return chain;
}

/**
 * The DOCUMENTABLE declarations a changed line belongs to — at most one name.
 *
 * Most-specific-wins: a changed method body anchors on the METHOD, not on its class.
 * Emitting the container too would mean every edit anywhere in a 20k-line class flagged
 * every page that names the class — the coarse-proxy failure this rewrite is undoing,
 * reintroduced one level down. The container is the FALLBACK, used when the inner name is
 * generic or absent (a changed entry inside `export const FIELD_TYPES = [...]` has no
 * declaration of its own, and `FIELD_TYPES` is the right anchor for it).
 */
function documentableDeclarationsAt(lines, idx) {
  const chain = declarationChainAt(lines, idx);
  if (!chain.length) return [];
  const outer = chain[chain.length - 1];
  const inner = chain.length > 1 ? chain[chain.length - 2] : null;
  const usable = (d) => d && !GENERIC_ANCHOR_NAMES.has(d.name) && !GENERIC_ANCHOR_NAMES.has(d.name.toLowerCase()) && d.name.length >= 3;
  if (inner && outer.container && usable(inner)) return [inner.name];
  if (usable(outer) && outer.kind !== 'member') return [outer.name];
  return [];
}


/** New- and old-side line numbers touched, parsed out of a `-U0` unified diff. */
function changedLineNumbers(diffText) {
  const oldLines = [];
  const newLines = [];
  for (const line of diffText.split('\n')) {
    const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (!m) continue;
    const oldStart = Number(m[1]);
    const oldCount = m[2] === undefined ? 1 : Number(m[2]);
    const newStart = Number(m[3]);
    const newCount = m[4] === undefined ? 1 : Number(m[4]);
    for (let i = 0; i < oldCount; i++) oldLines.push(oldStart + i);
    for (let i = 0; i < newCount; i++) newLines.push(newStart + i);
  }
  return { oldLines, newLines };
}

/**
 * The route tail of a registrar path literal: `${metaPath}/:type/:name/audit` →
 * `/:type/:name/audit`. Interpolations are stripped rather than resolved — the tail is
 * matched against a ledger row's full wire path by suffix, so the static part is enough.
 *
 * Returns `null` unless the result looks like an API ROUTE rather than a file path: at
 * least two segments, at least one static segment, no segment carrying a source-file
 * extension, and either a `:param`/`{param}` segment or an `/api/` prefix. Without that
 * last clause every `packages/rest/src/...` written in a comment became a "route".
 */
function routeTailOf(literal) {
  const stripped = String(literal).replace(/\$\{[^}]*\}/g, '');
  const m = stripped.match(/(?:\/[A-Za-z0-9_:.$*{}-]+){2,}/);
  if (!m) return null;
  const tail = m[0];
  const segs = tail.split('/').filter(Boolean);
  if (segs.length < 2) return null;
  if (segs.some((s) => /\.(?:ts|tsx|js|mjs|cjs|json|md|mdx|ya?ml|html|css)$/.test(s))) return null;
  const isParam = (s) => s.startsWith(':') || (s.startsWith('{') && s.endsWith('}'));
  if (!segs.some((s) => !isParam(s))) return null;
  if (!segs.some(isParam) && !tail.startsWith('/api/')) return null;
  return tail;
}

/**
 * A doc-side matcher for a route tail. Parameter segments match any of the three
 * spellings a page may use — `:type`, `{type}`, or a concrete example value — so
 * `GET /api/v1/meta/object/account/history` in a code block still counts as documenting
 * `/:type/:name/history`. The static segments are what keep that from over-matching.
 */
function routePatternFor(tail) {
  const isParam = (s) => s.startsWith(':') || (s.startsWith('{') && s.endsWith('}'));
  const body = tail
    .split('/')
    .filter(Boolean)
    .map((s) => (isParam(s) ? '(?::[A-Za-z_$][\\w$]*|\\{[A-Za-z_$][\\w$]*\\}|[A-Za-z0-9_%-]+)' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`/${body}(?![\\w-])`);
}

/** Route tails and identifier-shaped string literals appearing on the changed lines. */
function literalAnchorsFromLines(lines, changed) {
  const routes = new Set();
  const literals = new Set();
  for (const n of changed) {
    const line = lines[n - 1];
    if (line === undefined) continue;
    for (const m of line.replace(/\$\{[^}]*\}/g, '').matchAll(/(?:\/[A-Za-z0-9_:.$*{}-]+){2,}/g)) {
      const tail = routeTailOf(m[0]);
      if (tail) routes.add(tail);
    }
    for (const m of line.matchAll(/['"]([A-Za-z][\w.$-]{3,63})['"]/g)) {
      const lit = m[1];
      if (GENERIC_ANCHOR_NAMES.has(lit.toLowerCase())) continue;
      // Identifier-shaped only: snake_case, camelCase or dotted. A quoted English word
      // ('ignore', 'utf8') is not a surface anyone documents by that spelling.
      if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(lit) && !/^[a-z]+(?:[A-Z][A-Za-z0-9]*)+$/.test(lit) && !/^[a-z][a-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/.test(lit)) continue;
      literals.add(lit);
    }
  }
  return { routes, literals };
}

/** Documentable declaration names touched on one side of one file's diff. */
function symbolAnchorsFromSource(text, changed) {
  const lines = text.split('\n');
  const names = new Set();
  for (const n of changed) {
    if (n - 1 < 0 || n - 1 >= lines.length) continue;
    for (const name of documentableDeclarationsAt(lines, n - 1)) names.add(name);
  }
  return names;
}

/**
 * `path:` literals in a route registrar, each mapped to the identifiers its handler body
 * mentions. This is the mechanical half of the SDK bridge: a changed protocol method
 * appears in the handler of the route it serves, which the ledger then binds to a client
 * method the docs actually name.
 */
function parseRegistrarSource(text) {
  const lines = text.split('\n');
  const sites = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/(?:^|[\s{,(])path\s*:\s*([`'"])(.*?)\1/);
    if (m) sites.push({ line: i, tail: routeTailOf(m[2]) });
  }
  const byTail = new Map();
  for (let k = 0; k < sites.length; k++) {
    const { line, tail } = sites[k];
    if (!tail) continue;
    const next = k + 1 < sites.length ? sites[k + 1].line : lines.length;
    const end = Math.min(next, line + REGISTRAR_HANDLER_WINDOW, lines.length);
    let ids = byTail.get(tail);
    if (!ids) byTail.set(tail, (ids = new Set()));
    for (let j = line; j < end; j++) {
      for (const id of lines[j].matchAll(/[A-Za-z_$][\w$]*/g)) ids.add(id[0]);
    }
  }
  return byTail;
}

/** `{ route, client }` rows out of a route ledger — the declared cross-surface table. */
function parseLedgerSource(text) {
  const rows = [];
  const routeRe = /route\s*:\s*'([^']+)'/g;
  let m;
  while ((m = routeRe.exec(text)) !== null) {
    const rest = text.slice(m.index, routeRe.lastIndex + 1200);
    const nextRoute = rest.slice(1).search(/route\s*:\s*'/);
    const window = nextRoute === -1 ? rest : rest.slice(0, nextRoute + 1);
    const client = window.match(/client\s*:\s*'([^']+)'/);
    rows.push({ route: m[1], client: client ? client[1] : null });
  }
  return rows;
}

/**
 * Pin the change classifiers and the package-root derivation against known-good and
 * known-bad paths. The two ways this tool turns into a miss: an exclusion silently
 * widens into dropping real implementation changes, or the root derivation collapses
 * a nested package into its container again (#4162 — the guard's own guard had a
 * hole: the original self-test pinned only `isTestFile`). Needs no repo state: the
 * filesystem lookup is injected as a fake tree.
 */
function selfTest() {
  let failed = 0;
  let total = 0;
  const check = (fn, label, path, want, got) => {
    total++;
    if (got !== want) {
      console.error(`  ✗ self-test "${label}": ${path} → expected ${fn}=${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
      failed++;
    }
  };

  const testFileCases = [
    // [path, isTest, label]
    ['packages/services/service-automation/src/builtin/config-schemas.test.ts', true, 'plain .test.ts'],
    ['packages/rest/src/package-envelope.conformance.test.ts', true, 'compound .conformance.test.ts'],
    ['packages/services/service-automation/src/runas-grant-resolution.integration.test.ts', true, '.integration.test.ts'],
    ['packages/spec/src/data/object.spec.ts', true, '.spec.ts'],
    ['packages/foo/src/__tests__/helper.ts', true, 'helper inside __tests__'],
    ['packages/foo/src/__mocks__/driver.ts', true, '__mocks__'],
    ['packages/foo/src/__fixtures__/stack.json', true, '__fixtures__'],

    ['packages/services/service-automation/src/engine.ts', false, 'implementation'],
    ['packages/spec/src/automation/control-flow.zod.ts', false, 'a zod schema'],
    ['packages/formula/src/validate.ts', false, 'implementation with a test-ish name'],
    ['packages/cli/src/commands/test.ts', false, 'a command NAMED test is not a test file'],
    ['packages/qa/src/testing.ts', false, 'testing.ts is implementation'],
    ['packages/spec/src/latest.ts', false, 'no false positive on a bare name'],
    ['packages/foo/src/tests-helper.ts', false, 'tests-helper is not __tests__'],
  ];
  for (const [path, want, label] of testFileCases) check('isTestFile', label, path, want, isTestFile(path));

  // Package-root derivation, against a fake tree so the self-test stays hermetic.
  // One package.json per shape the repo has: a direct child package plus a nested
  // package per container class. The containers themselves have NO package.json.
  const fakeTree = new Set([
    'packages/spec',
    'packages/services/service-automation',
    'packages/plugins/plugin-audit',
    'packages/connectors/connector-slack',
  ]);
  const inFakeTree = (dir) => fakeTree.has(dir);
  const liveRootCases = [
    // [path, expected package root, label]
    ['packages/spec/src/latest.ts', 'packages/spec', 'direct child package'],
    ['packages/spec/package.json', 'packages/spec', 'the package.json itself'],
    ['packages/services/service-automation/src/engine.ts', 'packages/services/service-automation', 'nested under services/ — NOT the container'],
    ['packages/plugins/plugin-audit/src/index.ts', 'packages/plugins/plugin-audit', 'nested under plugins/ (formerly the only special case)'],
    ['packages/connectors/connector-slack/src/client.ts', 'packages/connectors/connector-slack', 'nested under connectors/'],
  ];
  for (const [path, want, label] of liveRootCases) check('packageRootOf', label, path, want, packageRootOf(path, inFakeTree));

  // The invariant behind the whole fix: a container directory (a parent of nested
  // packages, itself without a package.json) must never come out as a package root
  // for a file that lives inside one of its packages.
  const containers = new Set(
    [...fakeTree].map((d) => d.split('/').slice(0, -1).join('/')).filter((d) => d !== 'packages'),
  );
  for (const [path] of liveRootCases) {
    check('containerIsRoot', 'a container dir is never a live package\'s root', path, false, containers.has(packageRootOf(path, inFakeTree)));
  }

  // Deliberate fallbacks, pinned so they don't silently change: a path whose
  // package.json is gone (deleted package) degrades to the coarse top-level token —
  // over-inclusive substring matching still catches docs naming the deleted path.
  const fallbackRootCases = [
    ['packages/gone/src/x.ts', 'packages/gone', 'deleted top-level package falls back to packages/<x>'],
    ['packages/services/service-gone/src/x.ts', 'packages/services', 'deleted nested package falls back to the coarse container token'],
    ['packages/README.md', null, 'a file directly under packages/ belongs to no package'],
  ];
  for (const [path, want, label] of fallbackRootCases) check('packageRootOf', label, path, want, packageRootOf(path, inFakeTree));

  // Tooling-script exclusion: `<packageRoot>/scripts/**` is build tooling; the
  // package.json next to it and anything under `src/` are implementation.
  const scriptCases = [
    // [path, isToolingScript, label]
    ['packages/spec/scripts/check-generated.ts', true, 'package check script (#4183)'],
    ['packages/plugins/plugin-audit/scripts/i18n-extract.config.ts', true, 'nested package tooling config'],
    ['packages/spec/package.json', false, 'package.json IS implementation (exports/deps)'],
    ['packages/spec/src/scripts/runner.ts', false, 'src/scripts/** is runtime code'],
    ['packages/services/service-automation/src/engine.ts', false, 'implementation'],
  ];
  for (const [path, want, label] of scriptCases) check('isToolingScript', label, path, want, isToolingScript(path, inFakeTree));

  // Dev-only manifest exclusion (#6893). Field-level, so the cases are (before, after)
  // pairs rather than paths: the whole point is that the same FILE is excluded or
  // counted depending on which top-level keys moved.
  const pkg = (extra) => JSON.stringify({ name: '@objectstack/spec', version: '1.0.0', ...extra });
  const manifestCases = [
    // [beforeText, afterText, isDevOnly, label]
    [pkg({ scripts: { build: 'tsup' } }), pkg({ scripts: { build: 'tsup && node ../../scripts/check-dev-prereqs.mjs --stamp' } }), true, 'scripts only (#6892, the 113-doc specimen)'],
    [pkg({ devDependencies: { vitest: '^1' } }), pkg({ devDependencies: { vitest: '^1', 'better-sqlite3': '^11' } }), true, 'devDependencies only (a64315556)'],
    [pkg({ scripts: { a: '1' }, devDependencies: { x: '1' } }), pkg({ scripts: { a: '2' }, devDependencies: { x: '2' } }), true, 'both dev-time keys at once'],
    [pkg({ scripts: { build: 'tsup' } }), pkg({ scripts: { build: 'tsup' } }), true, 'nothing changed at all (reformat) is not drift'],

    [pkg({ dependencies: { zod: '^3' } }), pkg({ dependencies: { zod: '^4' } }), false, 'dependencies IS implementation'],
    [pkg({ peerDependencies: { react: '^18' } }), pkg({ peerDependencies: { react: '^19' } }), false, 'peerDependencies IS implementation'],
    [pkg({ exports: { '.': './dist/index.js' } }), pkg({ exports: { '.': './dist/index.js', './x': './dist/x.js' } }), false, 'a new export IS implementation'],
    [pkg({ files: ['dist'] }), pkg({ files: ['dist', 'spec-changes.json'] }), false, 'the published file list IS implementation'],
    [pkg({ scripts: { a: '1' }, dependencies: { zod: '^3' } }), pkg({ scripts: { a: '2' }, dependencies: { zod: '^4' } }), false, 'ONE non-dev key among dev ones still counts'],
    [pkg({}), JSON.stringify({ name: '@objectstack/spec', version: '2.0.0' }), false, 'a version bump IS implementation'],
    [pkg({ engines: { node: '>=20' } }), pkg({ engines: { node: '>=22' } }), false, 'engines is documented deployment surface'],
    // The fail-open half: "I could not tell" must never read as "nothing changed".
    ['{ not json', pkg({}), false, 'unparseable BEFORE falls back to counted'],
    [pkg({}), '{ not json', false, 'unparseable AFTER falls back to counted'],
    ['[]', pkg({}), false, 'a non-object manifest falls back to counted'],
  ];
  for (const [before, after, want, label] of manifestCases) {
    check('isDevOnlyManifestDiff', label, label, want, isDevOnlyManifestDiff(before, after));
  }

  // The path gate around it: only a package ROOT's own manifest is eligible, and an
  // added/deleted one is always counted. `io` returns a scripts-only diff for every
  // path, so any `false` here is the path gate talking, not the field comparison.
  const scriptsOnlyIo = {
    base: () => pkg({ scripts: { build: 'tsup' } }),
    head: () => pkg({ scripts: { build: 'rollup' } }),
  };
  const manifestPathCases = [
    // [path, io, isDevOnly, label]
    ['packages/spec/package.json', scriptsOnlyIo, true, 'the package root manifest'],
    ['packages/services/service-automation/package.json', scriptsOnlyIo, true, 'a nested package root manifest'],
    ['packages/spec/src/__fixtures__/app/package.json', scriptsOnlyIo, false, 'a fixture package.json is not the manifest'],
    ['packages/spec/src/index.ts', scriptsOnlyIo, false, 'not a package.json at all'],
    ['packages/spec/package.json', { ...scriptsOnlyIo, base: () => null }, false, 'ADDED manifest (no before) is counted — a new package'],
    ['packages/spec/package.json', { ...scriptsOnlyIo, head: () => null }, false, 'DELETED manifest (no after) is counted — a removed package'],
  ];
  for (const [path, io, want, label] of manifestPathCases) {
    check('isDevOnlyManifestChange', label, path, want, isDevOnlyManifestChange(path, io, inFakeTree));
  }

  // The release-owned FORK (#6893/#4920). This is the one classifier whose `true` must
  // NOT remove the doc from the output — it re-routes the reporting only. Pinning the
  // predicate here keeps the prefix honest; `check-audit-scope.mjs` is what anchors it
  // to AGENTS.md's guardrail row and to the audit workflow's copy.
  const releaseOwnedCases = [
    ['content/docs/releases/v17.mdx', true, 'the specimen row from #6893'],
    ['content/docs/releases/index.mdx', true, 'the releases index'],
    ['content/docs/permissions/authorization.mdx', false, 'an editable hand-written doc'],
    ['content/docs/deployment/releases/v9.mdx', false, 'a page that merely has "releases" deeper in its path'],
  ];
  for (const [doc, want, label] of releaseOwnedCases) check('isReleaseOwned', label, doc, want, isReleaseOwned(doc));

  // ---- the anchor derivation (#9192) ----------------------------------------
  // The measured failure this replaced was wrong in BOTH directions, so the pins come in
  // both directions too: the false positive that must stay dropped (a local named
  // `singular`), and the true positive that must stay found (a changed method reaching
  // `client-sdk.mdx` through the route registrar and the route ledger).

  // A verbatim-shaped excerpt of `packages/metadata-protocol/src/protocol.ts` at the
  // change #9192 was measured on. Indentation is load-bearing — the rank rule is what
  // separates the method from the local, and `}> {` is the closer that must not consume
  // the signature's indent level.
  const protocolSource = [
    'export class ObjectStackProtocolImplementation implements IObjectStackProtocol {',
    '    /** ADR-0010 §3.6 protection-audit trail. */',
    '    async auditMetaItem(request: {',
    '        type: string;',
    '        name: string;',
    '    }): Promise<{',
    '        events: Array<{ note: string | null }>;',
    '    }> {',
    '        request = canonicalizeMetaRequestType(request);',
    '        const singular = request.type;',
    '        return this.readAudit(singular);',
    '    }',
    '',
    '    async historyMetaItem(request: { type: string }): Promise<void> {',
    '        if (!ObjectStackProtocolImplementation.isOverlayAllowed(request.type)) {',
    '            return;',
    '        }',
    '    }',
    '}',
  ].join('\n');
  const anchorsAt = (src, lineNo) => symbolAnchorsFromSource(src, [lineNo]);
  const symbolCases = [
    // [1-based line, expected anchor set, label]
    [9, ['auditMetaItem'], 'a changed METHOD BODY anchors on the method, not on its 20k-line class'],
    [10, ['auditMetaItem'], 'a local `const singular` is NOT documentable surface — the #9192 false positive'],
    [11, ['auditMetaItem'], 'a plain statement still resolves to the enclosing method'],
    [3, ['auditMetaItem'], 'the signature line itself'],
    [15, ['historyMetaItem'], 'the closer `}` of the previous method must not hand this to auditMetaItem'],
    [16, ['historyMetaItem'], 'a nested `if` block resolves past the intermediate scope'],
    [1, ['ObjectStackProtocolImplementation'], 'a changed CLASS LINE anchors on the class — the container fallback'],
  ];
  for (const [line, want, label] of symbolCases) {
    check('symbolAnchorsFromSource', label, `line ${line}`, JSON.stringify(want), JSON.stringify([...anchorsAt(protocolSource, line)]));
  }

  // A schema object: its KEYS are documentable surface, because a metadata property name
  // is exactly what a docs page names. Same rank rule, opposite verdict from the local
  // above — a `const` object is a container, a function body is not.
  const schemaSource = [
    'export const ObjectSchema = z.object({',
    '    controlled_by_parent: z.boolean().optional(),',
    '});',
    '',
    'export function buildObject(input: unknown) {',
    '    const draftBuffer = normalize(input);',
    '    return draftBuffer;',
    '}',
  ].join('\n');
  const containerCases = [
    [2, ['controlled_by_parent'], 'a schema KEY is surface — the const object is a container'],
    [6, ['buildObject'], 'a local inside a FUNCTION is not surface; the function is'],
    [1, ['ObjectSchema'], 'the schema declaration itself'],
  ];
  for (const [line, want, label] of containerCases) {
    check('symbolAnchorsFromSource', label, `line ${line}`, JSON.stringify(want), JSON.stringify([...anchorsAt(schemaSource, line)]));
  }

  // Statement heads must never be read as declarations — `if (x) {` has the same shape as
  // a class member, and a control-flow line becoming an anchor is silent noise.
  const declCases = [
    ['    if (limit > 0) {', null, 'an if-statement is not a declaration'],
    ['    switch (kind) {', null, 'a switch is not a declaration'],
    ['        return this.readAudit(singular);', null, 'a return is not a declaration'],
    ['    } else if (x) {', null, 'a closer line is never a declaration'],
    ['        // path: `/api/v1/x/:id`', null, 'a comment body is never a declaration'],
    ['export const FIELD_TYPES = [', 'FIELD_TYPES', 'an exported const'],
    ['export interface IMetadataService {', 'IMetadataService', 'an exported interface'],
    ['    async auditMetaItem(request: {', 'auditMetaItem', 'a class method'],
    ['    getHistory?(type: string): Promise<void>;', 'getHistory', 'an OPTIONAL interface member — the `?` must not hide it'],
  ];
  for (const [line, want, label] of declCases) {
    const d = declarationOn(line);
    check('declarationOn', label, line.trim(), want, d ? d.name : null);
  }
  const containerFlagCases = [
    ['export const ObjectSchema = z.object({', true, 'a schema object owns its keys'],
    ['export const handle = (req) => {', false, 'an arrow function owns locals, not surface'],
    ['export const run = function () {', false, 'a function expression is not a container'],
    ['export class Protocol {', true, 'a class owns its methods'],
    ['export function build(x) {', false, 'a function body holds locals'],
  ];
  for (const [line, want, label] of containerFlagCases) {
    const d = declarationOn(line);
    check('declarationOn.container', label, line.trim(), want, d ? d.container : null);
  }

  // The shape guard. Measured pull in both columns: the left-hand names identify one
  // surface; the right-hand ones matched 82-113 of 178 pages apiece.
  const shapeCases = [
    ['auditMetaItem', true, 'camelCase'], ['ObjectSchema', true, 'PascalCase'],
    ['ERROR_CODE_LEDGER', true, 'SCREAMING_SNAKE'], ['controlled_by_parent', true, 'snake_case'],
    ['meta.getAudit', true, 'a dotted client path'],
    ['label', false, 'a single lowercase word is corpus vocabulary'],
    ['object', false, 'ditto — 113 of 178 pages'],
    ['locale', false, 'ditto'], ['query', false, 'an SDK method tail that is also English'],
  ];
  for (const [name, want, label] of shapeCases) check('isCodeShaped', label, name, want, isCodeShaped(name));

  // Route tails: an API route is an anchor, a source path written in a comment is not.
  const routeTailCases = [
    ['${metaPath}/:type/:name/audit', '/:type/:name/audit', 'interpolation stripped, tail kept'],
    ['/api/v1/meta/:type/:name/history', '/api/v1/meta/:type/:name/history', 'a full wire path'],
    ['/api/v1/meta/types', '/api/v1/meta/types', 'static-only, but under /api/'],
    ['packages/rest/src/rest-route-ledger.ts', null, 'a SOURCE PATH is not a route'],
    ['content/docs/api/client-sdk.mdx', null, 'a docs path is not a route'],
    ['/meta/types', null, 'static-only and not under /api/ — too weak to anchor'],
    ['/audit', null, 'one segment is not a route'],
  ];
  for (const [literal, want, label] of routeTailCases) check('routeTailOf', label, literal, want, routeTailOf(literal));

  const routeMatchCases = [
    ['/:type/:name/history', 'see `GET /api/v1/meta/:type/:name/history` for the trail', true, 'the colon spelling'],
    ['/:type/:name/history', 'GET /api/v1/meta/{type}/{name}/history', true, 'the brace spelling'],
    ['/:type/:name/history', 'GET /api/v1/meta/object/account/history', true, 'a concrete example URL'],
    ['/:type/:name/history', 'GET /api/v1/meta/object/account/audit', false, 'a different static segment does not match'],
    ['/:type/:name/history', 'the history of a record', false, 'prose does not match a route'],
  ];
  for (const [tail, text, want, label] of routeMatchCases) {
    check('routePatternFor', label, `${tail} vs ${JSON.stringify(text)}`, want, routePatternFor(tail).test(text));
  }

  // `-U0` hunk headers, including the one-line form where the count is omitted.
  const diffText = [
    'diff --git a/x.ts b/x.ts',
    '@@ -6376 +6376,3 @@',
    '-old',
    '+a',
    '+b',
    '+c',
    '@@ -13396,2 +13440 @@',
  ].join('\n');
  const parsed = changedLineNumbers(diffText);
  check('changedLineNumbers', 'new-side lines', 'hunks', JSON.stringify([6376, 6377, 6378, 13440]), JSON.stringify(parsed.newLines));
  check('changedLineNumbers', 'old-side lines (a REMOVED export still anchors)', 'hunks', JSON.stringify([6376, 13396, 13397]), JSON.stringify(parsed.oldLines));

  // The two declared tables the SDK bridge rides on.
  const registrarSource = [
    'this.routeManager.register({',
    "    method: 'GET',",
    '    path: `${metaPath}/:type/:name/audit`,',
    '    handler: async (req, res) => {',
    '        const p = await this.resolveProtocol();',
    '        if (typeof p.auditMetaItem !== \'function\') return;',
    '    },',
    '});',
    'this.routeManager.register({',
    "    method: 'GET',",
    '    path: `${metaPath}/:type/:name/history`,',
    '    handler: async (req, res) => {',
    '        await p.historyMetaItem(req.params);',
    '    },',
    '});',
  ].join('\n');
  const registrar = parseRegistrarSource(registrarSource);
  check('parseRegistrarSource', 'the audit route is indexed by its tail', 'tail', true, registrar.has('/:type/:name/audit'));
  check('parseRegistrarSource', 'its handler symbols are captured', 'auditMetaItem', true, !!registrar.get('/:type/:name/audit')?.has('auditMetaItem'));
  check('parseRegistrarSource', 'a handler does NOT absorb the NEXT route\'s symbols', 'historyMetaItem', false, !!registrar.get('/:type/:name/audit')?.has('historyMetaItem'));
  check('parseRegistrarSource', 'the second route is indexed too', 'historyMetaItem', true, !!registrar.get('/:type/:name/history')?.has('historyMetaItem'));

  const ledgerSource = [
    'export const REST_ROUTE_LEDGER = [',
    "  { route: 'GET /api/v1/meta/:type/:name/references', family: 'metadata', disposition: 'sdk', client: 'meta.getReferences' },",
    "  { route: 'GET /api/v1/meta/:type/:name/audit', family: 'metadata', disposition: 'sdk', client: 'meta.getAudit' },",
    "  { route: 'GET /api/v1/health', family: 'ops', disposition: 'server-only' },",
    '];',
  ].join('\n');
  const ledger = parseLedgerSource(ledgerSource);
  check('parseLedgerSource', 'every row is read', 'row count', 3, ledger.length);
  check('parseLedgerSource', 'the audit row binds its client method', 'meta.getAudit', 'meta.getAudit', ledger.find((r) => r.route.endsWith('/audit'))?.client);
  check('parseLedgerSource', 'a server-only row claims no client', 'null client', null, ledger.find((r) => r.route.endsWith('/health'))?.client);
  check('parseLedgerSource', 'a row never inherits the NEXT row\'s client', 'references', 'meta.getReferences', ledger[0].client);

  // End to end over those three fixtures: the #9192 recall miss must come back.
  // `auditMetaItem` (changed) → `/:type/:name/audit` (registrar) → `meta.getAudit`
  // (ledger) → the token `api/client-sdk.mdx` actually contains.
  const bridged = registrar.get('/:type/:name/audit');
  const bridgeRow = ledger.find((r) => bridged && r.route.endsWith('/:type/:name/audit'));
  check('bridge', 'a changed protocol method reaches the SDK method the docs name', 'auditMetaItem → getAudit', 'getAudit', bridgeRow?.client?.split('.').pop());

  // String literals on a changed line: an identifier-shaped one is surface, English is not.
  const litLines = ["  if (rule === 'controlled_by_parent') return maskFieldValue(v);", "  fs.readFileSync(p, 'utf8');", "  logger.warn('ignore');"];
  const lits = literalAnchorsFromLines(litLines, [1, 2, 3]).literals;
  const literalCases = [
    ['controlled_by_parent', true, 'a snake_case literal IS an authoring surface'],
    ['utf8', false, 'an encoding name is not surface'],
    ['ignore', false, 'an English word is not surface'],
  ];
  for (const [lit, want, label] of literalCases) check('literalAnchorsFromLines', label, lit, want, lits.has(lit));

  if (failed) {
    console.error(`\n✗ affected-docs self-test failed (${failed} case(s)).`);
    process.exit(1);
  }
  console.log(`✓ affected-docs self-test: ${total} cases pass.`);
}


// collect package roots from the implementation changes. One pass, because the
// dev-only-manifest arm shells out to git and must not be asked the same question twice.
let testFilesSkipped = 0;
let scriptFilesSkipped = 0;
let devOnlyManifestsSkipped = 0;
const implementationChanges = [];
for (const f of changedFiles) {
  if (isTestFile(f)) { testFilesSkipped++; continue; }
  if (isToolingScript(f)) { scriptFilesSkipped++; continue; }
  if (isDevOnlyManifestChange(f)) { devOnlyManifestsSkipped++; continue; }
  implementationChanges.push(f);
}
const pkgRoots = new Set();
for (const f of implementationChanges) {
  const root = packageRootOf(f);
  if (root) pkgRoots.add(root);
}

// resolve each root to its npm name + keep the path token
const changedPackages = []; // {dir, name}
for (const dir of pkgRoots) {
  let name = null;
  const pj = join(repoRoot, dir, 'package.json');
  if (existsSync(pj)) {
    try { name = JSON.parse(readFileSync(pj, 'utf8')).name || null; } catch { /* ignore */ }
  }
  changedPackages.push({ dir, name });
}

// --- 3. derive the ANCHORS the change touched ------------------------------
// One pass per changed file, both sides of the diff: the HEAD side for what the change
// now declares, the base side so a REMOVED export still anchors the pages naming it.
const symbolAnchors = new Set();
const routeAnchors = new Set();
const literalAnchors = new Set();
const anchorlessChanges = [];

const readAt = (ref, file) => {
  try { return sh(`git show ${ref}:${file}`); } catch { return null; }
};

for (const f of implementationChanges) {
  if (!/\.(?:ts|tsx|js|mjs|cjs)$/.test(f)) { anchorlessChanges.push(f); continue; }
  let diffText = '';
  try { diffText = sh(`git diff -U0 ${baseRef} HEAD -- ${JSON.stringify(f)}`); } catch { /* keep empty */ }
  const { oldLines, newLines } = changedLineNumbers(diffText);
  const before = oldLines.length ? readAt(baseRef, f) : null;
  const after = newLines.length ? (readAt('HEAD', f) ?? (existsSync(join(repoRoot, f)) ? readFileSync(join(repoRoot, f), 'utf8') : null)) : null;
  let found = 0;
  for (const [text, changed] of [[after, newLines], [before, oldLines]]) {
    if (!text) continue;
    for (const name of symbolAnchorsFromSource(text, changed)) { symbolAnchors.add(name); found++; }
    const { routes, literals } = literalAnchorsFromLines(text.split('\n'), changed);
    for (const r of routes) { routeAnchors.add(r); found++; }
    for (const l of literals) { literalAnchors.add(l); found++; }
  }
  if (!found) anchorlessChanges.push(f);
}

// --- 3b. admit only DISCRIMINATING anchors, then bridge from the survivors --------
// Two guards stand between the raw anchor set and the list, and BOTH publish what they
// removed. They exist because the first measured build of this derivation was, on some
// PRs, noisier than the package proxy it replaced — 134 rows where the old tool gave 26.
//
//  1. SHAPE. An anchor must be code-shaped (camelCase / PascalCase / snake_case /
//     dotted). A single all-lowercase word cannot be told from the vocabulary the docs
//     are written in: `label`, `object`, `start`, `locale` and `sections` all arrived as
//     real declarations and matched 82, 113, 43, 13 and 10 pages respectively. Confining
//     them to code spans does not help — those words live in code spans too. The recall
//     cost is a genuinely lowercase export (`parse`, `mask`), listed in
//     `weakAnchorsDropped` rather than swallowed.
//  2. CORPUS SHARE. An anchor matching more than `OVERBROAD_ANCHOR_SHARE` of the corpus
//     is a hub term, not an identifier: `ObjectQL` is code-shaped, genuinely changed, and
//     named by 59 of 178 pages — it cannot tell an author which page to re-read. Dropped
//     and published in `overbroadAnchors`, with the count that condemned it.
//
// Both guards run BEFORE the bridge, not after it, and that ordering is the fix rather
// than a detail: the bridge answers "which routes mention this name", so a name left in
// the set does not merely add a noisy row — it mints noisy ROUTE and SDK anchors from
// every registrar handler that happens to mention it. Measured both ways: `label` /
// `start` / `subject` (locals in the auth-email change 445ae4deb) pulled `/:object/import`
// and `/forms/:slug` into an advisory about email templates, and `ObjectQL` did the same
// to the objectql cascade fix 650cd3daa.
const docTexts = handwritten.map((doc) => readFileSync(join(repoRoot, doc), 'utf8'));
const overbroadLimit = Math.max(3, Math.floor(handwritten.length * OVERBROAD_ANCHOR_SHARE));
const weakAnchorsDropped = [];
const overbroadAnchors = [];
const anchors = [];
const hitsByAnchor = [];
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const symbolRe = (name) => new RegExp(`(?<![\\w$.])${escape(name)}(?![\\w$])`);
const dottedRe = (name) => new RegExp(`(?<![\\w$])${escape(name)}(?![\\w$])`);

/** Admit one candidate anchor: it must be discriminating, and it must be seen to be. */
function admitAnchor(kind, token, re) {
  if (kind !== 'route' && !isCodeShaped(token)) { weakAnchorsDropped.push(`${token} (${kind})`); return false; }
  const docs = [];
  for (let i = 0; i < handwritten.length; i++) if (re.test(docTexts[i])) docs.push(i);
  if (docs.length > overbroadLimit) { overbroadAnchors.push(`${token} (${kind}, ${docs.length} pages)`); return false; }
  anchors.push({ kind, token });
  hitsByAnchor.push(docs);
  return true;
}

// PHASE 1 — the anchors read straight off the diff.
const bridgeSymbols = [];
for (const name of [...symbolAnchors].sort()) {
  if (!admitAnchor('symbol', name, symbolRe(name))) continue;
  // A SCREAMING_SNAKE constant is a data table, not a route's implementation: it is
  // referenced by handlers that merely consult it. Admitted as a doc anchor (it names a
  // real surface — `ERROR_CODE_LEDGER` found 4 pages on 30b1c636a), but kept OUT of the
  // route bridge, where it dragged `/approvals/requests/:id/remind` into a wire-code
  // registration change.
  if (!/^[A-Z0-9_$]+$/.test(name)) bridgeSymbols.push(name);
}
for (const name of [...literalAnchors].sort()) admitAnchor('literal', name, symbolRe(name));

// PHASE 2 — carry the surviving symbols across the surface boundary the package graph
// cannot cross. A changed protocol method appears in the HANDLER of the route it serves;
// the route ledgers then bind that route to the client method the SDK docs actually name.
// Both hops are declared data in the repo, not inference — and this is the hop that puts
// `api/client-sdk.mdx` back on the list for a `packages/metadata-protocol` change.
const sdkAnchors = new Set();
const crossCuttingSymbols = [];
if (bridgeSymbols.length) {
  const registrarFiles = [];
  const walkSrc = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.turbo') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walkSrc(p);
      else if (e.isFile() && e.name.endsWith('.ts') && !isTestFile(e.name)) {
        const rel = relative(repoRoot, p);
        if (LEDGER_FILE_RE.test(rel) || REGISTRAR_FILE_RE.test(rel)) registrarFiles.push(rel);
      }
    }
  };
  walkSrc(join(repoRoot, 'packages'));

  const ledgerRows = [];
  const registrarByTail = new Map();
  for (const rel of registrarFiles) {
    let text;
    try { text = readFileSync(join(repoRoot, rel), 'utf8'); } catch { continue; }
    if (LEDGER_FILE_RE.test(rel)) ledgerRows.push(...parseLedgerSource(text));
    if (REGISTRAR_FILE_RE.test(rel)) {
      for (const [tail, ids] of parseRegistrarSource(text)) {
        let acc = registrarByTail.get(tail);
        if (!acc) registrarByTail.set(tail, (acc = new Set()));
        for (const id of ids) acc.add(id);
      }
    }
  }

  // symbol → route, capped: the bridge answers "which routes mention this name", and for
  // a CROSS-CUTTING helper that is every route it is wired into. Measured on the REST
  // error-responder change 0668f02a6: `sendError` & co. pulled in six unrelated route
  // families whose pages document nothing that change touched. Above the cap a symbol
  // contributes no route anchor — and says so in `crossCuttingSymbols`.
  const routesBySymbol = new Map();
  for (const [tail, ids] of registrarByTail) {
    for (const s of bridgeSymbols) {
      if (!ids.has(s)) continue;
      let tails = routesBySymbol.get(s);
      if (!tails) routesBySymbol.set(s, (tails = new Set()));
      tails.add(tail);
    }
  }
  for (const [s, tails] of routesBySymbol) {
    if (tails.size > MAX_ROUTES_PER_SYMBOL) { crossCuttingSymbols.push(`${s} (${tails.size} routes)`); continue; }
    for (const t of tails) routeAnchors.add(t);
  }
  // route → client method (the ledger's declared binding), and the reverse direction for
  // free: a changed SDK method name pulls in the route it is bound to.
  for (const { route, client } of ledgerRows) {
    if (!client) continue;
    const tail = client.split('.').pop();
    if ([...routeAnchors].some((t) => route.endsWith(t))) {
      sdkAnchors.add(client);
      // The BARE tail is an anchor only when its own spelling is distinctive.
      // `getBookTree` identifies one method; `import` / `query` / `revoke` are English,
      // and matching them corpus-wide put 116 and 84 pages on the list respectively
      // (measured, 0668f02a6). The dotted form (`data.query`) stays, and it is precise.
      if (tail && isCodeShaped(tail) && !GENERIC_ANCHOR_NAMES.has(tail.toLowerCase())) sdkAnchors.add(tail);
    } else if (tail && bridgeSymbols.includes(tail)) {
      const routeTail = routeTailOf(route.replace(/^[A-Z]+\s+/, ''));
      if (routeTail) routeAnchors.add(routeTail);
    }
  }
}

// PHASE 3 — the bridged anchors face the same two guards.
for (const name of [...sdkAnchors].sort()) admitAnchor('sdk', name, dottedRe(name));
// Route tails are never "weak": a multi-segment wire path is distinctive by construction.
for (const tail of [...routeAnchors].sort()) admitAnchor('route', tail, routePatternFor(tail));

// --- 3c. the pages that name a surviving anchor ----------------------------
const affectedByDoc = new Map();
for (let k = 0; k < anchors.length; k++) {
  for (const i of hitsByAnchor[k]) {
    let via = affectedByDoc.get(i);
    if (!via) affectedByDoc.set(i, (via = []));
    via.push(`${anchors[k].token} (${anchors[k].kind})`);
  }
}
const affected = [];
for (let i = 0; i < handwritten.length; i++) {
  const via = affectedByDoc.get(i);
  if (via) affected.push({ doc: handwritten[i], via: [...new Set(via)], releaseOwned: isReleaseOwned(handwritten[i]) });
}

// The superseded package-mention set, kept and LABELLED rather than deleted. It is the
// coarse over-approximation this rewrite stopped presenting as a work list; an audit that
// deliberately wants the wide net (the periodic backstop) can still ask for it, and
// keeping it visible is how a reader can tell "narrow list" from "nothing found".
const packageMentionDocs = [];
for (let i = 0; i < handwritten.length; i++) {
  for (const { dir, name } of changedPackages) {
    if ((name && docTexts[i].includes(name)) || docTexts[i].includes(dir)) { packageMentionDocs.push(handwritten[i]); break; }
  }
}

// Report what was excluded rather than dropping it silently — a tool that quietly
// narrows its own scope reads as "nothing to see here" when it means "I did not look".
const skipNotes = [];
if (testFilesSkipped > 0) skipNotes.push(`${testFilesSkipped} test file(s) excluded — tests cannot make an implementation doc stale`);
if (scriptFilesSkipped > 0) skipNotes.push(`${scriptFilesSkipped} tooling script(s) excluded — a package's scripts/ dir is build tooling, not documented behaviour`);
if (devOnlyManifestsSkipped > 0) skipNotes.push(`${devOnlyManifestsSkipped} package.json edit(s) excluded — only dev-time keys (${[...DEV_ONLY_PACKAGE_JSON_KEYS].join('/')}) changed`);
const skipNote = skipNotes.length ? ` (${skipNotes.join('; ')})` : '';

const anchorSummary = anchors.length
  ? `${anchors.length} anchor(s) — ${symbolAnchors.size} symbol, ${routeAnchors.size} route, ${sdkAnchors.size} sdk, ${literalAnchors.size} literal`
  : 'no anchors derived';
const anchorlessNote = anchorlessChanges.length
  ? `; ⚠️ ${anchorlessChanges.length} changed file(s) yielded no anchor — this run cannot see pages documenting them`
  : '';
const overbroadNote = overbroadAnchors.length
  ? `; ${overbroadAnchors.length} over-broad anchor(s) dropped (${overbroadAnchors.join(', ')})`
  : '';
const crossCuttingNote = crossCuttingSymbols.length
  ? `; ${crossCuttingSymbols.length} cross-cutting symbol(s) contributed no route anchor (${crossCuttingSymbols.join(', ')})`
  : '';

emit(
  affected.map((a) => a.doc),
  changedPackages,
  `${affected.length} docs name something this change touched (${anchorSummary}) across ${changedPackages.length} changed package(s) since ${sinceRef}${skipNote}${anchorlessNote}${crossCuttingNote}${overbroadNote}`,
  affected,
  { testFilesSkipped, scriptFilesSkipped, devOnlyManifestsSkipped },
  {
    anchors: anchors.map((a) => ({ kind: a.kind, token: a.token })),
    anchorlessChanges,
    crossCuttingSymbols,
    weakAnchorsDropped,
    overbroadAnchors,
    packageMentionDocs,
  },
);

function emit(docList, changedPackages, summary, detail, skipped = {}, anchorInfo = {}) {
  const { testFilesSkipped = 0, scriptFilesSkipped = 0, devOnlyManifestsSkipped = 0 } = skipped;
  const {
    anchors: anchorList = [], anchorlessChanges: anchorless = [], crossCuttingSymbols: crossCutting = [],
    weakAnchorsDropped: weak = [], overbroadAnchors: overbroad = [], packageMentionDocs: coarse = [],
  } = anchorInfo;
  if (asJson) {
    process.stdout.write(
      JSON.stringify(
        {
          summary,
          sinceRef: all ? null : sinceRef,
          changedPackages,
          // The FULL set, release-owned pages included — this is what feeds the audit
          // workflow's `args.docs`, and #4920 requires those pages to stay audited.
          docs: docList,
          // The reporting fork: the release-owned subset, called out so a consumer can
          // route it (review + file an issue) instead of listing it as editable work.
          // A partition, not a filter — `releaseOwnedDocs ⊆ docs` always.
          releaseOwnedDocs: docList.filter(isReleaseOwned),
          detail: detail || null,
          // What the change was found to TOUCH. Published so a reader can check the
          // derivation instead of trusting it — the failure #9192 records is a derived
          // list consumed as authoritative, and an anchor set is the cheapest way to
          // make "why is this page here / why is that one not" answerable at a glance.
          anchors: anchorList,
          // The declared blind spot: changed files this run could derive nothing from.
          // Non-empty means the list below is INCOMPLETE by a known amount — never read
          // an empty `docs` as "no page documents this change" while this is non-empty.
          anchorlessChanges: anchorless,
          // The other declared narrowing: symbols wired into so many routes that the
          // route bridge would have answered "every route" instead of "this one".
          crossCuttingSymbols: crossCutting,
          // Anchors the two guards removed, each with the reason it was removed. Neither
          // guard is allowed to narrow the list silently — that is the #9192 failure mode
          // one level down, and these two fields are what keep it reviewable.
          weakAnchorsDropped: weak,
          overbroadAnchors: overbroad,
          // The superseded COARSE set: docs merely MENTIONING a changed package. Kept for
          // the deliberately-wide backstop, and labelled so it is never mistaken for the
          // work list again (it was measured wrong in both directions — see the header).
          packageMentionDocs: coarse,
          testFilesSkipped,
          scriptFilesSkipped,
          devOnlyManifestsSkipped,
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stderr.write(`# ${summary}\n`);
    process.stdout.write(docList.join('\n') + (docList.length ? '\n' : ''));
  }
}
