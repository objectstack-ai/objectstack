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
//   node scripts/docs-audit/affected-docs.mjs --bridge-coverage [--json]   # how much of the DECLARED client-bound route surface the `sdk` bridge can reach (diff-free)
//
// Scope: hand-written docs only = content/docs/**/*.mdx MINUS content/docs/references/**
// (references are generated from packages/spec and handled by a separate regenerate pass).
//
// THE ABOVE SCOPE IS THE RECALL DENOMINATOR (#13306, maintainer ruling 2026-08-31). Any
// recall figure for this tool — "of the docs pages that should have been listed, how many
// were" — MUST use the scope above (hand-written docs, generated pages excluded) as its
// denominator. Excluding `content/docs/references/**` is not a gap this tool happens to
// have: those pages are AUTO-GENERATED and nobody hand-edits them, so telling an author
// "you may have affected this page" would be WRONG ADVICE, not missing advice — the
// exclusion is constructive, by design, same as the Scope line states.
//
// ⇒ a recall ratio computed against a WIDER denominator — every edit under content/docs,
// generated pages included — is not measuring this tool at all. It is measuring how often
// the docs generator happened to run inside whatever window was sampled, because every one
// of those runs counts as a "miss" this tool could structurally never have avoided. This is
// exactly how the one such figure ever computed got it wrong: measured 2026-08-30 over a
// 91-commit window ending at `c4ecf0c49` (method, replay and the corrected re-derivation in
// #13306), 31 of its 46 ground-truth entries were `content/docs/references/**` pages this
// tool cannot list on any run, at any recall — the ratio moved by a factor of 2.7 just from
// widening the sampling window, which is the signature of a denominator not measuring the
// thing.
//
// ⛔ Maintainer ruling: this ceiling is honest, not a defect, and does not license widening
// the corpus to improve the number — that trades a real regression (prompting authors about
// pages they must never touch) for a paper gain. The tool's advisory-only posture (see
// .github/workflows/docs-drift-check.yml's own header) is unchanged. That file documents
// the OTHER half of "why a listed number can still miss something" — a page already IN this
// scope that goes unlisted because it restates a rule without naming what this tool anchors
// on. Read both; they compose into one picture, not two competing ones.
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
// a shorter right list beats a longer noisy one. Four anchor kinds, each exact:
//
//   symbol  — a DOCUMENTABLE declaration the diff touched: a top-level declaration, or a
//             member of a top-level container (class / interface / type / enum / schema
//             object). Locals inside a function body are NOT documentable surface — that
//             single rule is what drops the `singular` false positive above. Taken from
//             BOTH sides of the diff, so a REMOVED export still anchors the pages naming it.
//   route   — a wire path the change touched: a path literal on a changed line, plus every
//             route whose REGISTRAR HANDLER references a changed symbol (that is the
//             mechanical `auditMetaItem` → `GET /api/v1/meta/:type/:name/audit` link).
//   sdk     — the client method a route ledger BINDS to an anchor route
//             (`meta.getAudit`). The declared cross-surface table is what carries the
//             derivation over the boundary the package graph cannot cross, and it is what
//             puts `api/client-sdk.mdx` back on the list.
//             ⚠️ ITS REACH IS PARTIAL AND NOW SAYS SO (#9572). The hop needs a registrar
//             `path:` tail to select the ledger row; measured on `9ff11921a`, 45 of the
//             221 client-bound rows have one and 176 do not, so those 176 are invisible
//             to EVERY run rather than to some. `bridgeCoverage` publishes that ratio on
//             every run that uses the bridge, and `--bridge-coverage` answers it with no
//             diff at all — because a reader who cannot see the shortfall reads the
//             bridge's silence as "no page documents this", which is the #9192 failure
//             one surface down.
//             ⚠️ THAT RATIO IS REF-PINNED AND THE TREE HAS MOVED SINCE (#12966).
//             `9ff11921a`'s "45 of 221" remains a true statement about `9ff11921a`;
//             it is not the current figure and must not be read as one. On
//             `8f10a79f7a` the same command reads 47 of 219 — measured row by row,
//             not inferred, and every move has a named cause:
//               · 222 → 219 client-bound: three `:type/:section/:name` rows were
//                 DELETED from `rest-route-ledger.ts`. All three were already
//                 unreachable, so this moves `reachable` by zero.
//               · 43 → 44 tails: `rest-server.ts` unrolled its
//                 `for (const publishedPath of […])` loop into a LITERAL `path:`.
//                 A variable `path:` yields no tail and a literal one does, so this
//                 minted exactly one new tail, `/:type/:name/published`.
//               · 45 → 47 reachable: that single tail selects two rows that no tail
//                 could select before — `meta.getPublished` on the rest ledger and
//                 `meta.getPublished` on the runtime ledger.
//             ⭐ So 45 → 47 is the bridge working BETTER, not drifting, and the
//             registrar-count fix in `isMigrationLedgerEntry` deliberately LEAVES IT
//             AT 47. ⛔ Never "restore" 45: the one recognizer change that reproduces
//             it does so by dropping ten real registrars (see that docblock).
//   command — the CLI command PHRASE a changed command file implements
//             (`packages/cli/src/commands/meta/resync.ts` → `os meta resync`). Derived
//             from the oclif filesystem convention, never from a curated table — see the
//             `commandIdFor` block below for the derivation and the shapes it declines.
//   rule    — an EXPRESSION a changed `@docs-rule` doc comment states. A module whose
//             doc comment IS the canonical statement of a rule that pages restate in
//             prose exports no symbol the restating pages name; the expressions the rule
//             is written in are what they have in common. Derived from the block's own
//             code spans, never authored as an anchor list — see `ruleAnchorsFromSource`.
//
// WHY `command` IS A KIND AND NOT A LOOSENING OF THE SHAPE GUARD (#9230). The shape guard
// in §3b drops a single all-lowercase word because it cannot be told from the vocabulary
// the docs are written in; neutralising it took one measured PR from 19 pages to 49.
// `resync` alone is exactly that shape and stays dropped, deliberately. `os meta resync`
// is not that shape: binary name plus topic plus command is a multi-word phrase no page
// supplies by accident, so it is distinctive by CONSTRUCTION in the same way a
// multi-segment wire path is, and it is admitted the same way — BESIDE the guard, never
// through it. The guard is untouched for bare tokens and must stay that way.
//
// WHY `rule` EXISTS, AND WHY THE COARSE FALLBACK WAS MEASURED AND REJECTED (#9282). A
// module can carry a rule that pages restate without exporting anything those pages name.
// The measured specimen is `packages/objectql/src/declared-fields.ts`: 191 lines, 179 of
// them one doc comment that is the canonical statement of the sparse-face guard rule, and
// one exported function. A change confined to that comment derived NOTHING — the run said
// "no opinion" while three pages restating the rule sat unlisted.
//
// The cheap close considered first was to fall back, for an anchorless file, to the coarse
// package-mention set of that file's package. Measured on this specimen, that fallback is
// WRONG IN BOTH DIRECTIONS — the exact failure the #9192 rewrite above exists to undo:
//
//   - it lists 14 pages, because 14 name `@objectstack/objectql` or `packages/objectql`;
//   - and NOT ONE of them is one of the three that restate the rule. `automation/flows.mdx`,
//     `protocol/objectui/actions.mdx` and `ui/actions.mdx` document the AUTHORING face and
//     never name the implementing package at all.
//
// So the fallback is not merely noisy, it is 0-for-3 on recall on the one instance it was
// proposed for; bounded width (14, not 140) does not rescue it. What the restating pages
// DO share with the rule is the EXPRESSIONS the rule is written in — `record.x != null`,
// `has(record.x) && record.x != null`. Those are what this kind anchors on, and they are
// read off the block's own code spans, so nothing is authored twice and nothing can drift
// from the rule: the marker lives INSIDE the block it describes, and dies with it. Measured
// on the same specimen: 12 anchors, 7 pages, all three restating pages found.
//
// ⛔ Not claimed: that this class matters often. It is a BOUNDED precision improvement.
// The #9192 sample measured ten PRs and exactly ONE missed for this reason — the worked
// example 07ad42463 (`fix(cli): explain os meta resync's skip count`), which derived
// `MetaResync` / `resyncSkipExplanationLine`, matched 0 pages, and left the reader with
// only the coarse 22-page package-mention set, while one hand-written page names
// `os meta resync` outright.
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
// The one answer to "is this span a comment, or code?" (#9367). Dependency-free and
// side-effect-free on import, so the no-install contract this script runs under holds.
import { blank, maskComments, scanSource } from '../js-comment-mask.mjs';

const repoRoot = execSync('git rev-parse --show-toplevel').toString().trim();
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const all = args.includes('--all');
const sinceRef = args.find((a) => !a.startsWith('--')) || 'origin/main';
// The commit the change set is actually measured FROM, published in `computedOn`
// below (#9519). Declared up here so both `emit` call sites can read it — the `--all`
// arm returns long before §2 assigns it, and a `let` in §2 would put that arm in the
// temporal dead zone. `null` is the honest answer for `--all`: it diffs nothing.
let diffBaseRef = null;

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
 * recall on the `sdk` anchor kind only.
 *
 * ⛔ THE SECOND HALF OF THAT SENTENCE USED TO READ "and `anchorlessChanges` reports the
 * silence". It does not, and #9572 measured why: `anchorlessChanges` fires per changed
 * FILE that yielded ZERO anchors, while a handler change in a missed registrar yields its
 * own symbol anchors, so the run is never anchorless and prints nothing. The silence was
 * reported by no field at all until `bridgeCoverage` existed. Keep that distinction in
 * mind before leaning on any other field to "report" a gap: the populations differ.
 */
const REGISTRAR_FILE_RE = /(?:^|\/)(?:[\w.-]*route[\w.-]*|[\w.-]*-server)\.ts$/;

/** Route LEDGERS — the declared `route` ⟷ `client` tables the `sdk` anchor rides on. */
const LEDGER_FILE_RE = /(?:^|\/)[\w.-]*route-ledger\.ts$/;

/**
 * THE selection rule of the `sdk` bridge, defined once: a registrar tail selects a ledger
 * row when the row's wire path ends with it (the `GET ` prefix is stripped first, which
 * a suffix test does not need but a reader does). PHASE 2 bridges with this exact test.
 *
 * ⛔ Never restate it at a call site. `bridgeCoverageFrom` counts the unreachable rows and
 * `--bridge-coverage --json` enumerates them, and a second copy of the rule lets the list
 * disagree with the count it is supposed to be the detail of — the machine-readable half
 * of this report is the source a ratchet would read, so a silent disagreement there is the
 * same class of defect the report exists to end. Same reasoning that split `scanRouteSurface`
 * out rather than walking `packages/**` twice (#4851).
 */
const selectsFrom = (tails) => {
  const tailList = [...tails];
  return (route) => tailList.some((t) => route.replace(/^[A-Z*]+\s+/, '').endsWith(t));
};

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

/**
 * Anchor kinds the shape guard does not judge, because their tokens are distinctive by
 * CONSTRUCTION rather than by spelling — all three are multi-segment phrases carrying
 * literals prose cannot supply by accident (a wire path's static segments; a command
 * phrase's binary name and topic; a rule expression's operators).
 *
 * ⛔ This is an exemption BESIDE the guard, never a loosening OF it. `isCodeShaped` still
 * governs every single-token kind (`symbol`, `literal`, `sdk`) exactly as before: the
 * measured cost of neutralising it there is one PR going from 19 pages to 49, and `label`
 * / `object` matching 82 / 113 of 178 pages. Adding a kind here is only ever legitimate
 * for a token that cannot BE a bare lowercase word — check that before extending it.
 *
 * `rule` passes that check by CONSTRUCTION rather than by inspection: `isRuleExpression`
 * admits a span only when it carries a comparison or logical operator, and a token
 * carrying `&&` or `!=` is not a word. That predicate is what earns the exemption, so it
 * is the thing to defend if this kind is ever loosened — not this set.
 */
const PHRASE_ANCHOR_KINDS = new Set(['route', 'command', 'rule']);

/**
 * Where an oclif CLI keeps one source file per command, relative to its package root.
 * `packages/cli/package.json` declares `oclif.commands.target = './dist/commands'`, and
 * `dist/` mirrors `src/`, so this is that declaration expressed on the source side.
 */
const OCLIF_COMMANDS_DIR = 'src/commands';

/**
 * The doc-comment tag that opts a block in as the canonical statement of a rule pages
 * restate. Bare — it takes no argument, and any text after it is ignored.
 *
 * ⭐ THE TAG IS A MARKER, NOT A REGISTRY. It says "derive anchors from this block"; it
 * never says WHICH. The anchors come from the block's own code spans, so an author cannot
 * write one, cannot forget to update one, and cannot leave one behind: the marker lives
 * inside the prose it describes and is deleted with it. That is the whole difference from
 * the hand-kept registry of canonical-rule sites #9282 considered and rejected — a second
 * source of truth beside the rule drifts from it silently (the same reason `packageRootOf`,
 * `REGISTRAR_FILE_RE` and `commandIdFor` are all derived rather than listed).
 *
 * The opt-in itself is deliberate and is the only authored bit. Deriving from EVERY doc
 * comment in `packages/**` would hand the corpus-share guard a flood to filter rather than
 * a claim to check, and most doc comments describe an export the `symbol` kind already
 * anchors. This kind is for the residue: a block that IS the surface.
 */
const DOCS_RULE_TAG = '@docs-rule';

/**
 * An operator that makes a code span an EXPRESSION rather than a name. `=>`, `->` and the
 * `=` half of `<=` / `>=` are excluded from the bare `<` / `>` arm so an arrow function or
 * a comparison already matched by the earlier alternatives cannot be counted twice.
 */
const RULE_EXPR_OPERATOR = /&&|\|\||==|!=|<=|>=|(?<![=!<>-])[<>](?![=>])/;

/** A dotted or called identifier — the half that keeps bare operator soup out. */
const RULE_EXPR_REFERENCE = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\s*\()/;

/**
 * Is this code span an expression the docs could restate?
 *
 * BOTH halves are load-bearing, and each one drops a measured class from the specimen
 * block (`declared-fields.ts`, 72 spans):
 *   - the OPERATOR half drops bare names — `visibleWhen`, `requiredWhen`, `readonlyWhen`,
 *     `sys_approval_request`. Those are real surface, but they are the block's CALLER LIST
 *     rather than its rule, and they are what took the specimen's page count from 7 to 27.
 *     A genuine change to any of them anchors through the `symbol` kind on its own file.
 *   - the REFERENCE half drops prose that a stray backtick pairs across two lines
 *     (`" is uniformly TRUE (a materialised "`), plus table punctuation (`" | "`, `"<="`).
 *
 * Together they are also what lets `rule` sit in `PHRASE_ANCHOR_KINDS`: a span carrying
 * `&&` or `!=` cannot be the bare lowercase word the shape guard exists to drop.
 */
function isRuleExpression(span) {
  if (span.length < 4 || span.length > 120) return false;
  return RULE_EXPR_OPERATOR.test(span) && RULE_EXPR_REFERENCE.test(span);
}

/**
 * Every `/** … *\/` doc comment in a source text, as INCLUSIVE 0-based line ranges, each
 * flagged with whether it carries `DOCS_RULE_TAG`.
 *
 * Line-based like every other probe here — this script is dependency-free by contract, so
 * there is no parser to reach for. The cost is bounded because the tag is an opt-in: a
 * mis-detected block that nobody tagged contributes nothing at all. An UNTERMINATED block
 * (a truncated file, a `*\/` inside a string) runs to end-of-file rather than being
 * dropped: over-reaching in an opted-in block costs recall precision, dropping it costs
 * the whole anchor, and the corpus-share guard already prices the first.
 */
function docCommentBlocks(lines) {
  const blocks = [];
  let start = -1;
  let tagged = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (start === -1) {
      const open = line.indexOf('/**');
      if (open === -1) continue;
      start = i;
      tagged = line.includes(DOCS_RULE_TAG);
      if (line.indexOf('*/', open + 3) !== -1) {
        blocks.push({ start, end: i, tagged });
        start = -1;
        tagged = false;
      }
      continue;
    }
    if (line.includes(DOCS_RULE_TAG)) tagged = true;
    if (line.includes('*/')) {
      blocks.push({ start, end: i, tagged });
      start = -1;
      tagged = false;
    }
  }
  if (start !== -1) blocks.push({ start, end: lines.length - 1, tagged });
  return blocks;
}

/**
 * The rule expressions a changed line puts in play, plus whether a tagged block was
 * touched at all. Returns `{ touched, spans }`.
 *
 * Scope is the WHOLE tagged block, not the changed line: the specimen's rule is stated
 * across 179 lines of tables and prose, and a one-line refinement to any of them can make
 * any page restating any part of it stale. Line-scoping measured that specimen down to
 * zero anchors — the changed line's own span was `has()`, which is not an expression.
 *
 * `touched` is reported separately from `spans` because the two answer different
 * questions, and conflating them is how a tool starts reading as "nothing to check": a
 * tagged block that changed and yielded NO expression is a declared blind spot the caller
 * must publish (`unanchoredRuleBlocks`), not an empty set to swallow.
 *
 * A change OUTSIDE every tagged block — the function body below the comment — yields
 * `touched: false`. The rule's statement did not change, so the pages restating it did not
 * go stale, and that file anchors through `symbol` exactly as it always did.
 */
function ruleAnchorsFromSource(text, changed) {
  const lines = text.split('\n');
  const spans = new Set();
  let touched = false;
  for (const { start, end, tagged } of docCommentBlocks(lines)) {
    if (!tagged) continue;
    if (!changed.some((n) => n - 1 >= start && n - 1 <= end)) continue;
    touched = true;
    for (let i = start; i <= end; i++) {
      for (const m of lines[i].matchAll(/`([^`]+)`/g)) {
        const span = m[1].trim();
        if (isRuleExpression(span)) spans.add(span);
      }
    }
  }
  return { touched, spans };
}

/**
 * A doc-side matcher for a rule expression: the span's tokens separated by run-of-the-mill
 * horizontal whitespace, so a page that reformats `record.x  !=  null` still counts.
 *
 * Newlines are deliberately NOT whitespace, for the same reason `commandPatternFor` says
 * so: allowing a line break would let two unrelated sentences straddle into a match.
 */
function rulePatternFor(span) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = span.trim().split(/\s+/).map(esc).join('[ \\t]+');
  return new RegExp(`(?<![\\w$.-])${body}(?![\\w$-])`);
}

// Short-circuit before any git or filesystem work — the self-test needs no repo state.
if (args.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

// --- 0b. `--bridge-coverage` — the sdk bridge's reach over the DECLARED surface -------
//
// Diff-free on purpose: reach is a fact about the TREE, so this mode answers on any
// checkout with no ref, which is what makes the number replayable and ratchetable
// (#9572). The advisory run reports the same numbers inline, but only when a change
// happened to carry a bridgeable symbol; this mode is the one that always answers.
//
// EXIT CODE. The 45-of-221 ratio is REPORTED, never a verdict — the #9747 family's
// ruling is that a narrow recognizer should say "unrecognised", and turning today's
// shortfall into a red would be widening-by-CI, which that card declines. What DOES
// exit non-zero is `brokenScan`: a scan that found no ledger, no tail, a ledger it could
// no longer parse, or a ledger it read only PARTIALLY (#9896 — the shape that renders like
// a complete read) is broken rather than clean, and no such verdict can fire on a tree
// where the scan works at all.
if (args.includes('--bridge-coverage')) {
  const { registrarFiles, sourceFiles, ledgers, registrarByTail } = scanRouteSurface();
  // THE CEILING (#11178) — read lazily off the walk this scan already did, so the census
  // holds one file's source at a time rather than the tree's. Since #11867 the PHASE 2
  // advisory run pays for it too, through this same `ceilingTailsFrom` — one derivation,
  // so the two paths cannot report the same three buckets from two populations.
  const ceiling = ceilingTailsFrom(sourceFiles);
  const coverage = bridgeCoverageFrom(ledgers, registrarByTail.keys(), ceiling.keys());
  const selects = selectsFrom(registrarByTail.keys());
  const causeOf = new Map(coverage.ledgers.map((l) => [l.file, l.cause]));
  // Through the one definition, per tail, so naming a witness cannot drift from the rule
  // that decided the row was remediable in the first place (⛔ never restate the suffix test).
  const witnessesFor = (route) => [...ceiling.keys()].filter((t) => selectsFrom([t])(route)).flatMap((t) => ceiling.get(t));
  if (asJson) {
    process.stdout.write(JSON.stringify({
      ...coverage,
      registrarFiles: registrarFiles.filter((f) => !LEDGER_FILE_RE.test(f)),
      unreachableRows: ledgers.flatMap(({ file, rows }) =>
        rows.filter((r) => r.client && !selects(r.route)).map((r) => {
          const witnesses = witnessesFor(r.route);
          // The row-level half of the same partition: a row with a witness is remediable
          // whatever its ledger looks like; a row without one inherits its ledger's verdict,
          // because "no registration site anywhere on this surface" is a claim only the
          // whole ledger can support (see `bridgeCoverageFrom`).
          return { file, route: r.route, client: r.client, cause: witnesses.length ? 'discovery-gap' : causeOf.get(file), witnesses };
        })),
    }, null, 2) + '\n');
  } else {
    console.log(`sdk route bridge — reach over the declared client-bound surface`);
    console.log(`  registrar files scanned .... ${registrarFiles.filter((f) => !LEDGER_FILE_RE.test(f)).length}`);
    console.log(`  route tails produced ....... ${coverage.tails}`);
    console.log(`  ledger files ............... ${coverage.ledgers.length}`);
    // BOTH HALVES OF THE FRACTION, ALWAYS. A bare "221" cannot be told apart from a 221
    // that used to be 222 before one row was respelled into a quote the recognizer
    // declines; printing what the ledgers DECLARED beside what was READ is what makes the
    // difference visible without anyone having to know the number by heart.
    console.log(`  ledger rows read ........... ${coverage.rowsParsed} of ${coverage.routesDeclared} declared`);
    console.log(`  client-bound ledger rows ... ${coverage.clientRows} of ${coverage.clientsDeclared} declared`);
    // #10683, and normally 0. A lead spelled the way the recognizer reads, sitting where
    // the mask says code is not — a comment, or a string payload. Printed on every run
    // rather than only when non-zero, for the reason the fraction above is printed whole:
    // a number nobody ever sees at rest is a number nobody notices moving.
    console.log(`  prose-quoted leads (no row) . ${coverage.leadsOutsideCode}`);
    for (const l of coverage.ledgers) {
      for (const d of l.outsideCode) console.log(`      ${l.file}:${d.line}  ${d.text}`);
    }
    console.log(`    reachable ................ ${coverage.reachable}`);
    console.log(`    UNREACHABLE .............. ${coverage.unreachable}`);
    // WHY, beside the number, on every line (#11178). `56 of 56` and `46 of 87` printed in
    // the same words read as one remediable cause, and they are not: the first surface has
    // no in-repo registration site at all, so the discovery change the second one wants
    // moves it by zero rows. That misreading is the reason this split exists — it aimed a
    // whole card at widening a recognizer that was never the constraint.
    const CAUSE_NOTE = {
      'no-in-repo-registrar': () => 'NO in-repo registrar for ANY row — discovery cannot reach this surface',
      'discovery-gap': (l) => `all ${l.remediable} remediable by discovery`,
      'undecided': (l) => `${l.remediable} remediable by discovery, ${l.unwitnessed} undecided`,
      'no-client-surface': () => 'no client-bound rows to reach',
      'fully-reachable': () => 'every client-bound row is reachable',
      'unmeasured': () => 'cause not measured on this run',
    };
    for (const l of coverage.ledgers) {
      const note = CAUSE_NOTE[l.cause];
      console.log(`      ${String(l.unreachable).padStart(4)} of ${String(l.clientRows).padEnd(4)} unreachable  ${l.file}`
        + (note ? `   ← ${note(l)}` : ''));
    }
    // A PARTITION of the number above, printed whole for the reason the declared/read
    // fraction is: remediable + structural + undecided === UNREACHABLE, so a reader can see
    // it stay whole, and a bucket that starts absorbing another cannot do it quietly.
    if (coverage.causes.measured) {
      console.log(`    why — against every \`path:\` any packages/** file declares (${coverage.causes.ceilingTails}-tail ceiling vs the ${coverage.tails} the filename convention yields):`);
      const n = (v) => String(v).padStart(4);
      console.log(`        remediable by discovery ..${n(coverage.causes.remediable)}   an in-repo file declares the row's path; the convention did not scan that file`);
      console.log(`        NO in-repo registrar .....${n(coverage.causes.structural)}   on a ledger where not ONE row is declared in-repo — declared upstream and catch-all-mounted, so no discovery change reaches it`);
      console.log(`        undecided ................${n(coverage.causes.undecided)}   no in-repo declaration, on a ledger that HAS in-repo registrars — absence and an unreadable spelling are not distinguishable here`);
    } else {
      console.log(`    why ........................ ${coverage.causes.reason}`);
    }
    // The 176 rows themselves are one flag away, never printed by default: this mode is
    // a CI gate step (`check-affected-docs.mjs`), and 176 lines of known blind spot in
    // every job log is the noise that trains a reader to stop reading the whole section.
    console.log(`  → the unreachable rows themselves: this command with --json`);
  }
  for (const v of coverage.brokenScan) console.error(`✗ broken scan: ${v}`);
  process.exit(coverage.brokenScan.length ? 1 : 0);
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
// Publish it (#9519). READ-ONLY of a value §2 has already settled — this line adds no
// input to any derivation, it only lets the answer say what it was measured from.
diffBaseRef = baseRef;

/**
 * A test file — it observes behaviour rather than defining it, so changing one cannot
 * make an implementation-accuracy doc stale. Covers the repo's conventions:
 *
 *   1. `*.test.*` / `*.spec.*` / `*.bench.*` at any depth (including compound infixes
 *      like `.integration.test.ts` and `.conformance.test.ts`);
 *   2. anything under a `__tests__` / `__mocks__` / `__fixtures__` directory;
 *   3. anything under a NON-underscore `test/` or `tests/` directory — the same
 *      convention as (2), spelled without the underscores. Six packages use it
 *      (`cli`, `client`, `metadata-core`, `metadata-fs`, `qa/dogfood`,
 *      `qa/downstream-contract`), and `test/fixtures/` falls out of it by shape rather
 *      than by being named.
 *
 * ⛔ ARMS 1(bench) AND 3 ARE HERE BECAUSE THE PREDICATE WAS THE DEFECT, NOT THE TWO
 * FILES THAT EXPOSED IT. `packages/qa/dogfood/test/fixtures/endpoint-policy-fixture.ts`
 * and `packages/spec/src/benchmark.bench.ts` were the instances observed; a pair of
 * path literals would have been the hand-written map this whole file refuses, and would
 * have rotted at the third fixture. The arms are written over the CONVENTION so the
 * next fixture and the next benchmark are covered on arrival.
 *
 * DELIBERATELY NOT EXCLUDED, so a later reader knows these were decided rather than
 * missed — each is a file the repo ships or could ship as implementation:
 *   · `*.testkit.ts` (8 files) — exported harness code, the same class as
 *     `packages/qa/src/testing.ts`, which the self-test below already pins as
 *     implementation;
 *   · `*.fixture.ts` / `*.fixtures.ts` (5) and `*.pin.ts` (6) — infixes with no
 *     established exclusion convention here, and widening an exclusion on a guess is
 *     the failure mode `selfTest`'s own docblock names first;
 *   · a BARE `fixtures/` or `mocks/` directory outside `test/` — zero population
 *     today, so admitting it would be speculative reach, and `test/fixtures/` is
 *     already covered by arm 3.
 *
 * Verify with `--self-test`.
 */
function isTestFile(path) {
  return /(^|\/)__(tests|mocks|fixtures)__\//.test(path)
    || /(^|\/)tests?\//.test(path)
    || /(^|\/)[^/]+\.(test|spec|bench)\.[^/]+$/.test(path);
}

/**
 * An ADR-0049 MIGRATION LEDGER ENTRY — a file under `migrations/entries/` whose whole job
 * is to record that a key was RETIRED. It is the one class of file that names a surface
 * precisely BECAUSE THAT SURFACE NO LONGER EXISTS, so the filename convention means the
 * opposite of what it means anywhere else: a retirement entry for a `route`-named key is
 * spelled exactly like a registrar and registers nothing.
 *
 * ⛔ ANCHORING DOES NOT FIX THIS, AT ANY SPELLING — MEASURED, NOT ASSUMED (#12966). The
 * obvious remedy is to require `route` to be a whole dot/dash-delimited token rather than
 * any substring. It fails because in BOTH of today's entries `routes` ALREADY IS a whole
 * token, split identically to every genuine registrar:
 *
 *   18.kernel__Manifest__contributes.routes.ts        [18] [kernel__Manifest__contributes] [routes]
 *   18.plugin-manifest-contributes-routes-retired.ts  [18] [plugin] … [routes] [retired]
 *   hmr-routes.ts                                     [hmr] [routes]          ← a real registrar
 *
 * Both anchorings were implemented against this tree and measured on `8f10a79f7a`:
 *   · token `route|routes` — excludes ZERO of the two entries, and costs
 *     `packages/spec/src/api/router.zod.ts`, which is the Zod-contract admission question
 *     #11857 half A is open on. Fixes nothing, pre-empts a pending ruling.
 *   · token `route` alone — excludes 10 of the 14, including the tail-producing
 *     `external-datasource-routes.ts`, and lands `reachable` back on 45 BY BREAKING THE
 *     BRIDGE. ⚠️ That is the dangerous one: 45 is the previously published figure, so the
 *     control appears to recover at the exact moment the recognizer stops working.
 *
 * A DIRECTORY CLASS IS THE ONLY CUT that separates the two populations, and it is the
 * durable one: the entry count grows every time a `route`-named key is retired, so a
 * per-file exclusion would rot on the third entry — the same bill `isTestFile`'s arms 1
 * and 3 were written over the convention to avoid.
 *
 * Excluded from the CEILING population too, for the reason `walkSourceFiles` already
 * gives about test directories: a row counted `remediable by discovery` claims that
 * widening the FILENAME CONVENTION would reach it, and no widening may legitimately admit
 * a file that records a key's deletion. Measured on `8f10a79f7a`: 275 `.ts` files under
 * the one such tree (`packages/spec/src/migrations/entries/`), of which 2 match the
 * registrar convention and 0 declare a `path:` — so the ceiling moves by zero tails.
 *
 * Verify with `--self-test`.
 */
function isMigrationLedgerEntry(path) {
  return /(^|\/)migrations\/entries\//.test(path);
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
 * The oclif command id a source path under `<packageRoot>/src/commands/**` implements,
 * spelled the way the CLI is invoked (`meta/resync.ts` → `meta resync`), or `null`.
 *
 * ⭐ DERIVED FROM THE FILESYSTEM, NOT FROM A CURATED TABLE. oclif resolves command ids
 * from paths — topic = directory, command = filename — so the machine-readable registry
 * this anchor kind needs ALREADY EXISTS as the convention, and a hand-kept ledger beside
 * it would be a second source of truth that drifts silently (the same reasoning that made
 * `packageRootOf` and `REGISTRAR_FILE_RE` filesystem-derived rather than listed).
 *
 * Shapes it handles, all mechanically:
 *   - `build.ts`             → `build`               (a top-level command)
 *   - `meta/resync.ts`       → `meta resync`         (topic + command)
 *   - `migrate/recorded-by.ts` → `migrate recorded-by` (hyphens are ordinary id chars)
 *   - `migrate/index.ts`     → `migrate`             (oclif: a topic's index IS the topic)
 *   - `a/b/c.ts`             → `a b c`               (nesting is read off the path, so a
 *                                                     deeper topic tree needs no change
 *                                                     here — measured: today's tree is
 *                                                     one level deep, 45 commands at the
 *                                                     root and 43 under 11 topics)
 *
 * Shapes it DECLINES, and says so rather than guessing — the caller collects them in
 * `unmappedCommandFiles`:
 *   - any segment that is not an oclif id segment (`__tests__/`, a `*.test.ts` whose
 *     residual `.test` survives the extension strip, a `.json` fixture);
 *   - a bare `index` directly under the commands root, which would name the root binary
 *     rather than a command.
 *
 * One shape is knowingly OUT of reach and is documented rather than detected: a command
 * that overrides its id in code (`static id` / `static topic`) can disagree with its path.
 * Measured on this tree: zero commands declare `static topic`, and the one `static id`
 * (`init.ts` → `'init'`) agrees with its path, so nothing is mis-derived today. The
 * failure direction if that ever changes is a phrase matching NO page — a recall miss the
 * anchor list makes visible, not a false positive that pollutes the work list.
 */
function commandIdFor(relPath) {
  const segs = relPath.replace(/\.(?:ts|tsx|js|mjs|cjs)$/, '').split('/').filter(Boolean);
  if (segs.length && segs[segs.length - 1] === 'index') segs.pop(); // topic/index → the topic
  if (!segs.length) return null;
  if (!segs.every((s) => /^[a-z0-9][a-z0-9-]*$/.test(s))) return null;
  return segs.join(' ');
}

/**
 * Every binary name a package declares for itself: `oclif.bin` (the canonical one, used
 * in help output) plus each `bin` key. Declared data, so a page writing either spelling
 * is matched without either being guessed at.
 */
function oclifBinNamesOf(pkg) {
  if (!pkg || typeof pkg !== 'object' || !pkg.oclif) return [];
  const names = [];
  if (typeof pkg.oclif.bin === 'string' && pkg.oclif.bin) names.push(pkg.oclif.bin);
  if (pkg.bin && typeof pkg.bin === 'object' && !Array.isArray(pkg.bin)) {
    for (const k of Object.keys(pkg.bin)) if (/^[A-Za-z0-9][\w.-]*$/.test(k)) names.push(k);
  } else if (typeof pkg.bin === 'string' && typeof pkg.name === 'string') {
    const short = pkg.name.split('/').pop();
    if (short && /^[A-Za-z0-9][\w.-]*$/.test(short)) names.push(short);
  }
  return [...new Set(names)];
}

/**
 * The `command` anchor a changed file yields, or `null` if it is not an oclif command
 * source at all. Returns `{ id, bins, token, unmapped }`:
 *   - `token` is the CANONICAL phrase (`oclif.bin` first) — one anchor per command, so
 *     the anchor list stays readable; the alternate binary spellings live in the doc
 *     matcher instead, exactly as `routePatternFor` carries a route's three param
 *     spellings behind one route tail.
 *   - `unmapped: true` means "this file IS under a commands dir but yielded no id" — the
 *     caller must publish it rather than drop it.
 *
 * Gated on the package DECLARING `oclif`, not on a hardcoded `packages/cli` path: a
 * second CLI package would be covered on the day it lands, and a `src/commands/` dir in a
 * package that is not a CLI is correctly ignored.
 *
 * `readPkg`/`hasPackageJson` are injectable so `--self-test` can pin this with no repo state.
 */
function commandAnchorFor(file, readPkg = livePackageJsonOf, hasPackageJson = dirHasPackageJson) {
  const root = packageRootOf(file, hasPackageJson);
  if (root === null) return null;
  const prefix = `${root}/${OCLIF_COMMANDS_DIR}/`;
  if (!file.startsWith(prefix)) return null;
  const bins = oclifBinNamesOf(readPkg(root));
  if (!bins.length) return null;
  const id = commandIdFor(file.slice(prefix.length));
  if (id === null) return { id: null, bins, token: null, unmapped: true };
  return { id, bins, token: `${bins[0]} ${id}`, unmapped: false };
}

const livePackageJsonOf = (dir) => {
  try { return JSON.parse(readFileSync(join(repoRoot, dir, 'package.json'), 'utf8')); } catch { return null; }
};

/**
 * A doc-side matcher for a command phrase: the id's words separated by run-of-the-mill
 * horizontal whitespace, behind ANY of the binary names the package declares — so
 * `os meta resync`, `objectstack meta resync` and `npx objectstack meta resync` all
 * count, while `resync` on its own never does.
 *
 * Newlines are deliberately NOT whitespace here: a command is written on one line, and
 * allowing a line break would let two unrelated sentences straddle into a match.
 */
function commandPatternFor(id, bins) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alt = bins.map(esc).join('|');
  const body = id.split(' ').map(esc).join('[ \\t]+');
  return new RegExp(`(?<![\\w$.-])(?:${alt})[ \\t]+${body}(?![\\w$-])`);
}

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
 * The DOCUMENTABLE declarations a changed line belongs to — at most one, as
 * `{ name, container }`.
 *
 * Most-specific-wins: a changed method body anchors on the METHOD, not on its class.
 * Emitting the container too would mean every edit anywhere in a 20k-line class flagged
 * every page that names the class — the coarse-proxy failure this rewrite is undoing,
 * reintroduced one level down. The container is the FALLBACK, used when the inner name is
 * generic or absent (a changed entry inside `export const FIELD_TYPES = [...]` has no
 * declaration of its own, and `FIELD_TYPES` is the right anchor for it).
 *
 * `container` reports WHICH of those two the name came from, because the answer is a
 * doc anchor either way but a ROUTE-BRIDGE symbol only one way (#9294 — see the
 * `bridgeSymbols` block in §3b). It is read off the winning declaration rather than
 * from the branch, so a container reached as `inner` (an interface nested in a
 * namespace) is reported the same as one reached as the fallback.
 */
function documentableDeclarationsAt(lines, idx) {
  const chain = declarationChainAt(lines, idx);
  if (!chain.length) return [];
  const outer = chain[chain.length - 1];
  const inner = chain.length > 1 ? chain[chain.length - 2] : null;
  const usable = (d) => d && !GENERIC_ANCHOR_NAMES.has(d.name) && !GENERIC_ANCHOR_NAMES.has(d.name.toLowerCase()) && d.name.length >= 3;
  if (inner && outer.container && usable(inner)) return [{ name: inner.name, container: !!inner.container }];
  if (usable(outer) && outer.kind !== 'member') return [{ name: outer.name, container: !!outer.container }];
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

/**
 * Documentable declaration names touched on one side of one file's diff.
 *
 * Two sets, and the second one is the point: `names` is every symbol anchor the side
 * yields, `bridgeable` is the subset that named a LEAF declaration rather than a
 * container. Positive, not subtractive — a name that reached the set through a leaf
 * derivation anywhere stays bridgeable even if some other line derived it as a
 * container. `bridgeable ⊆ names` always.
 */
function symbolAnchorsFromSource(text, changed) {
  const lines = text.split('\n');
  const names = new Set();
  const bridgeable = new Set();
  for (const n of changed) {
    if (n - 1 < 0 || n - 1 >= lines.length) continue;
    for (const d of documentableDeclarationsAt(lines, n - 1)) {
      names.add(d.name);
      if (!d.container) bridgeable.add(d.name);
    }
  }
  return { names, bridgeable };
}

/**
 * `path:` literals in a route registrar, each mapped to the identifiers its handler body
 * mentions. This is the mechanical half of the SDK bridge: a changed protocol method
 * appears in the handler of the route it serves, which the ledger then binds to a client
 * method the docs actually name.
 *
 * ⛔ READ OFF CODE, NEVER OFF PROSE (#9432). Everything this function claims is a claim
 * about what a handler DOES: the premise the bridge tests is "this symbol IS this route's
 * implementation, so the handler that implements the route mentions it". A name that a
 * handler mentions only in an English sentence satisfies a bare token scan without
 * satisfying that premise — and an implementation comment naming a neighbouring symbol is
 * ordinary, careful writing, not a smell. Measured on `40d5b2d4c` (#9405, a
 * `metadata-protocol` batch-publish change): BOTH route anchors the run produced came from
 * prose and nothing else — `promoteDraftForPublish` from two comment lines in the publish
 * handler, and `publishPackageDrafts` from two more that put the state-machine route (and
 * `meta.getLegalNextStates` through the ledger) on the advisory for a diff that never
 * touched a state machine. Comments contribute 4329 of the 7649 identifier slots this scan
 * sees on today's tree, so the surface is more than half prose.
 *
 * The mask covers the `path:` scan too, not just the identifier scan, and that is the same
 * rule rather than a second one: a route registration written inside a JSDoc `@example` is
 * an illustration, not a registration (`route-manager.ts` has exactly one, minting a
 * phantom `/api/users/:id`), and a `path:` line inside a comment must not truncate the
 * previous handler's window either. `maskComments` is the projection — this scan reasons in
 * LINE POSITIONS (a window is 150 lines past a site) and in what precedes `path:` on a
 * line, and blanking keeps both while deleting would move columns. The #9367 lazy-matcher
 * hazard does not apply: the one lazy quantifier here is `(.*?)` inside a per-LINE regex,
 * bounded by a line, never dragged across the file. Cost measured: 115 ms to mask the 19
 * registrar files (888 KB), taking a whole run from 387 ms to 480 ms.
 *
 * Measured cost in RECALL, which is the question the card said to answer before assuming:
 * ZERO, over the last 60 commits touching `packages/`. Three runs changed at all, and every
 * row that moved is a wrong row — including the one that looked most like a real loss,
 * `api/client-sdk.mdx` on `40d5b2d4c`: the hunks that made `promoteDraftForPublish` an
 * anchor there are DOC-COMMENT-only, so `publishItem`'s behaviour never moved, and the page
 * names none of the three symbols that did.
 */
function parseRegistrarSource(text) {
  const lines = maskComments(text).split('\n');
  const sites = [];
  for (let i = 0; i < lines.length; i++) {
    // TWO QUESTIONS, AND THEY ARE NOT THE SAME ONE (#9503). "Does a registration's
    // property list start here?" decides the WINDOW BOUNDARY; "what route is it?"
    // decides the TAIL. Only the second one needs a literal. A site with no tail was
    // always allowed here — 38 of today's 86 literal `path:` lines yield no tail (a
    // bare `/api/v1`, a mount prefix) and the loop below already skips them for window
    // production while still honouring them as the previous site's `next`. This makes a
    // NON-LITERAL `path:` line behave the same way, which is the whole change.
    if (!/(?:^|[\s{,(])path\s*:/.test(lines[i])) continue;
    const m = lines[i].match(/(?:^|[\s{,(])path\s*:\s*([`'"])(.*?)\1/);
    sites.push({ line: i, tail: m ? routeTailOf(m[2]) : null });
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

/**
 * Every route tail ANY file under `packages/**` could yield, with the filename convention
 * ignored entirely — the CEILING on what a widened discovery could ever reach (#11178).
 *
 * ⛔ THIS IS NOT A SECOND DISCOVERY ROUTE, and nothing downstream of it selects a row.
 * `REGISTRAR_FILE_RE` is untouched, the bridge still rides on `registrarByTail` alone, and
 * the published `reachable` figure is computed exactly where it was. This function exists
 * only so the REPORT can name WHY a row is unreachable, which the report could not do
 * while it had one number for two causes:
 *
 *   - a row the convention missed but SOME in-repo file declares — the recognizer is
 *     narrower than the repo, and widening discovery would reach it;
 *   - a row NO in-repo file declares at all — the surface is declared upstream and mounted
 *     through a catch-all, so no discovery change reaches it at any price.
 *
 * Measured on `589758d22`, that is the difference between 14 rows and 163: the auth
 * ledger's `56 of 56` and the rest ledger's `46 of 87` print identically today and are not
 * the same finding. That conflation is not hypothetical — it is what aimed #11178 at
 * discovery, whose own remedy was then measured to move the auth ledger by ZERO rows.
 *
 * SUPERSET BY CONSTRUCTION, which is what makes the comparison legitimate: the same
 * `parseRegistrarSource`, over the same walk's files, minus the convention test. So every
 * tail discovery yields appears here too, and `reachable` can never exceed this ceiling —
 * an invariant `bridgeCoverageFrom` turns into a broken-scan verdict rather than trusting.
 *
 * The `includes('path')` prefilter is a SOUND superset, not a heuristic: `parseRegistrarSource`
 * yields a tail only from a line matching `path\s*:` in the MASKED source, and masking
 * replaces bytes with spaces rather than inserting any, so those four bytes must be present
 * in the raw text for any tail to exist. Positive control on `589758d22`: masking all 1930
 * files instead of the 1093 the prefilter keeps produces a byte-identical census — the same
 * 82 tails and the same 14/163 split — for 1.76s instead of 1.47s.
 *
 * @param {Iterable<{file: string, text: string}>} sources  candidate files and their source
 * @returns {Map<string, string[]>} tail ⟶ the files that declare it, so a "discovery could
 *   reach this" claim can always NAME the witness rather than asserting one exists.
 */
/**
 * The CEILING, built off a walk's `sourceFiles` — ONE derivation, both callers (#11867).
 *
 * ⛔ Never inline this at a call site. `--bridge-coverage` and the PHASE 2 advisory run
 * both measure causes now, and a census the two paths build differently would report the
 * same three buckets from two populations — the exact class of defect the cause split was
 * introduced to end, one level up. Read LAZILY, one file's source at a time, so neither
 * caller holds the tree in memory.
 *
 * @param {Iterable<string>} sourceFiles  repo-relative paths, as `walkSourceFiles` yields them
 * @returns {Map<string, string[]>} exactly what `maximalTailsFrom` returns
 */
function ceilingTailsFrom(sourceFiles) {
  return maximalTailsFrom((function* () {
    for (const rel of sourceFiles) {
      try { yield { file: rel, text: readFileSync(join(repoRoot, rel), 'utf8') }; } catch { /* unreadable file contributes no tail */ }
    }
  })());
}

function maximalTailsFrom(sources) {
  const byTail = new Map();
  for (const { file, text } of sources) {
    if (!text.includes('path')) continue;
    for (const [tail] of parseRegistrarSource(text)) {
      let owners = byTail.get(tail);
      if (!owners) byTail.set(tail, (owners = []));
      owners.push(file);
    }
  }
  return byTail;
}

/**
 * How much of the DECLARED client-bound route surface the `sdk` bridge can actually
 * reach — pure, so `--self-test` pins it with fixtures and no repo state (#9572).
 *
 * WHY THIS IS REPORTED AND NOT INFERRED. The bridge's one hop from a changed symbol to
 * `api/client-sdk.mdx` is `registrar tail` ⟶ `ledger row`, and a ledger row no registrar
 * tail can select is STRUCTURALLY unreachable: no symbol change bridges to it, ever. The
 * file's own note on `REGISTRAR_FILE_RE` says a missed registrar "costs recall on the
 * `sdk` anchor kind only, and `anchorlessChanges` reports the silence" — measured on
 * `9ff11921a`, neither half of that holds. `anchorlessChanges` fires per changed FILE
 * with ZERO anchors, and a handler change yields its own symbol anchors, so the run is
 * never anchorless; the reach shortfall prints nowhere. 45 of 221 client-bound rows are
 * reachable and the other 176 are silent — and 88 of those 176 name a client method that
 * at least one hand-written page carries, so half the blind spot is a finding this tool
 * would report if it could see it, not an empty region (measured; see the header of
 * `--bridge-coverage`).
 *
 * ⛔ This function MEASURES, it does not widen. Nothing here changes which rows bridge;
 * the recognizer is exactly as narrow as it was. The #9747 family's ruling is that a
 * recognizer narrower than the repo must report "unrecognised" rather than render as a
 * verdict, and this is that report for this bridge.
 *
 * @param {Array<{file: string, rows: Array<{route: string, client: string|null}>, declined: Array<{key: string, line: number, text: string}>, routesDeclared: number, clientsDeclared: number, outsideCode: Array<{key: string, line: number, text: string}>}>} ledgers
 *   as `parseLedgerSource` returns them. ⛔ No `?? []` / `?? rows.length` defaults are
 *   applied to the declared counts below: an ABSENT report of what a ledger declared must
 *   never render as "it declared exactly what we read", which is the one reading this
 *   whole verdict exists to prevent. A caller that omits them throws here instead — and
 *   `outsideCode` (#10683) is read on the same terms, for the same reason.
 * @param {Iterable<string>} tails  every route tail the registrar scan produced
 * @param {Iterable<string>} [maximalTails]  the CEILING — every tail any `packages/**` file
 *   could yield with the filename convention ignored (`maximalTailsFrom`). Supplying it is
 *   what lets each ledger's cause be DERIVED. ⛔ Omitting it is not an empty ceiling: every
 *   cause reports `unmeasured` and the three counts are `null`, on the same terms as the
 *   declared counts above — an absent reading must never render as a reading.
 */
function bridgeCoverageFrom(ledgers, tails, maximalTails) {
  const tailList = [...tails];
  // The same suffix test PHASE 2 bridges with and the same one `--bridge-coverage --json`
  // enumerates with, taken from the single definition beside `LEDGER_FILE_RE` so this
  // cannot drift from either what it measures or the row list it is the count of.
  const selects = selectsFrom(tailList);
  // WHY a row is unreachable, and `undefined` is not an empty census (#11178). A caller
  // that measured no ceiling gets `unmeasured` spelled out on every ledger — never a
  // default into one of the two buckets, which is the whole failure this split exists to
  // end. Same rule as `measured: false` on the advisory path and `computedOn.dirty`'s null
  // arm: an ABSENT reading must not render as a reading.
  const censusMeasured = maximalTails !== undefined;
  // Materialised ONCE, exactly like `tailList` above and for the same reason: callers pass
  // a `Map.keys()` iterator, and a second spread of a spent iterator reads as an EMPTY
  // ceiling — which renders as a clean `0-tail` census rather than as an error.
  const ceilingList = censusMeasured ? [...maximalTails] : null;
  // Through `selectsFrom`, never a second copy of the suffix test — the cause counts are a
  // partition of `unreachable`, so a restatement here lets the split disagree with the
  // total it is the breakdown of.
  const reaches = censusMeasured ? selectsFrom(ceilingList) : null;
  const byLedger = [];
  let clientRows = 0;
  let reachable = 0;
  let rowsParsed = 0;
  let routesDeclaredAll = 0;
  let clientsDeclaredAll = 0;
  let leadsOutsideCode = 0;
  let remediableRows = 0;
  let structuralRows = 0;
  let undecidedRows = 0;
  let censusBroken = null;
  for (const { file, rows, declined, routesDeclared, clientsDeclared, outsideCode } of ledgers) {
    const bound = rows.filter((r) => r.client);
    const hit = bound.filter((r) => selects(r.route));
    const miss = bound.filter((r) => !selects(r.route));
    clientRows += bound.length;
    reachable += hit.length;
    rowsParsed += rows.length;
    routesDeclaredAll += routesDeclared;
    clientsDeclaredAll += clientsDeclared;
    leadsOutsideCode += outsideCode.length;
    // THE SPLIT. `witnessed` = some in-repo file declares this exact path and the filename
    // convention simply did not scan it, so widening discovery reaches the row and the
    // witness can be NAMED. `unwitnessed` = no in-repo file declares it at all.
    const witnessed = censusMeasured ? miss.filter((r) => reaches(r.route)) : [];
    const unwitnessed = censusMeasured ? miss.filter((r) => !reaches(r.route)) : [];
    // THE CEILING CANNOT BE BELOW THE FLOOR. `maximalTails` is built from the same parser
    // over a superset of the same files, so a reachable row it cannot reach is a broken
    // census, not a finding — it cannot fire on a census built the way this one is.
    if (censusMeasured && !censusBroken) {
      const below = hit.find((r) => !reaches(r.route));
      if (below) censusBroken = `${file}: \`${below.route}\` is reachable by the ${tailList.length}-tail discovery scan but not by the ${ceilingList.length}-tail ceiling it is measured against — the ceiling is not the superset it is built to be, so every cause below is unsound`;
    }
    let cause;
    if (!censusMeasured) cause = 'unmeasured';
    else if (bound.length === 0) cause = 'no-client-surface';
    else if (miss.length === 0) cause = 'fully-reachable';
    // STRUCTURAL, and the test is a property of the SURFACE rather than a list of ledger
    // names: not one client-bound row of this ledger is declared by any file in this repo.
    // That is the auth surface — better-auth declares those routes inside `node_modules`
    // and the plugin mounts them with a single catch-all — and it is derived here rather
    // than asserted, so a ledger that grows an in-repo registrar leaves this bucket by
    // itself. Measured on `589758d22`: exactly one ledger of the seven.
    else if (hit.length === 0 && witnessed.length === 0) cause = 'no-in-repo-registrar';
    else if (unwitnessed.length === 0) cause = 'discovery-gap';
    // ⛔ NOT defaulted into either bucket. This ledger HAS in-repo registrars, so its
    // unwitnessed rows are not the auth shape — but nothing here can tell "no registration
    // site" apart from "a registration site whose path this recognizer cannot read", and
    // rendering that ignorance as either verdict is exactly the #9747 false green.
    else cause = 'undecided';
    if (cause === 'no-in-repo-registrar') structuralRows += unwitnessed.length;
    else undecidedRows += unwitnessed.length;
    remediableRows += witnessed.length;
    byLedger.push({ file, clientRows: bound.length, reachable: hit.length, unreachable: bound.length - hit.length, rowsParsed: rows.length, routesDeclared, clientsDeclared, declined, outsideCode, cause, remediable: censusMeasured ? witnessed.length : null, unwitnessed: censusMeasured ? unwitnessed.length : null });
  }
  // ZERO IS NOT A CLEAN REPO, IT IS A BROKEN SCAN — `check-engine-double-contract`'s
  // invariant, applied to this population (#9747 quotes it as the germ worth
  // generalising). Each of these is a structural break in the scan itself, not a
  // coverage number: they cannot fire on a tree where the scan works at all, so they
  // carry a VERDICT while the 45/221 ratio carries only a report.
  //
  // ⛔ NOT here, deliberately: "a ledger with zero CLIENT-bound rows". Two of today's
  // seven ledgers (`datasource-route-ledger.ts`, `settings-route-ledger.ts`) are wholly
  // `server-only` by design — 16 rows, no client binding — so that shape is a correct
  // answer, and pinning it would be a false red on an accurate ledger.
  const brokenScan = [];
  if (!ledgers.length) brokenScan.push('no route-ledger file was found at all — the ledger walk selected nothing, so every `sdk` anchor is silently unavailable');
  if (!tailList.length) brokenScan.push('the registrar scan produced no route tail at all — the symbol → route → sdk bridge cannot fire for any change');
  if (censusBroken) brokenScan.push(censusBroken);
  for (const l of byLedger) {
    if (l.rowsParsed === 0) brokenScan.push(`${l.file} matched the ledger convention but parsed 0 rows — the row recognizer no longer reads this file's shape`);
    // ONE LEVEL DOWN, AND THE LIKELIER SHAPE: a PARTIAL read. The guard above is the
    // all-or-nothing case; a ledger where SOME rows are spelled in a quote the recognizer
    // declines parses fine, and the population it reports is simply smaller — or silently
    // mis-bound — than what the file declares. Keyed on the DECLINED SPELLING as well as on
    // the shortfall, because the window-inheritance case leaves the COUNT intact and only
    // the spelling betrays it (measured; see `parseLedgerSource`).
    //
    // A VERDICT rather than a report, on the same test the block above uses: this cannot
    // fire on a tree whose ledgers are spelled the way the recognizer reads (today: 259 of
    // 259, delta 0). It is a break in the SCAN, not a property of the route surface — unlike
    // the 45-of-221 reach ratio, which is a fact about the repo and stays reported.
    const unreadRows = l.routesDeclared - l.rowsParsed;
    if (l.declined.length || unreadRows > 0) {
      const declinedRoutes = l.declined.filter((d) => d.key === 'route').length;
      const named = l.declined.slice(0, 3).map((d) => `line ${d.line}: ${d.text}`).join(', ');
      brokenScan.push(
        `${l.file} is a PARTIAL read of that ledger, not its shape — the row recognizer reads single-quoted values only`
        + ` and read ${l.rowsParsed} of ${l.routesDeclared} declared \`route:\` value(s)`
        + ` and ${l.clientRows} of ${l.clientsDeclared} declared \`client:\` value(s)`
        + (l.declined.length
          ? `; declined ${l.declined.length}: ${named}${l.declined.length > 3 ? `, +${l.declined.length - 3} more` : ''}`
          : '')
        + (unreadRows > declinedRoutes
          ? `; and ${unreadRows - declinedRoutes} single-quoted \`route:\` value(s) the recognizer did not read either`
          : ''));
    }
  }
  // ⛔ `leadsOutsideCode` is deliberately NOT pushed to `brokenScan` above. It is the one
  // number here that describes the ledger's PROSE rather than its route surface, and a
  // comment that quotes a retired path is not a broken scan — before #10683 it was a
  // phantom ROW, which is what makes counting it worth doing and gating it wrong.
  // The cause split is published as a PARTITION of `unreachable` — 14 + 56 + 107 = 177 on
  // `589758d22` — so a reader (or a ratchet) can see it stay whole. `causesMeasured: false`
  // is the honest shape for a caller that passed no ceiling, and the three counts are
  // `null` there rather than `0`: nobody may read "no structural rows" out of "nobody looked".
  const causes = censusMeasured
    ? { measured: true, ceilingTails: ceilingList.length, remediable: remediableRows, structural: structuralRows, undecided: undecidedRows }
    : { measured: false, reason: 'no in-repo ceiling was supplied — why a row is unreachable was not measured on this run', ceilingTails: null, remediable: null, structural: null, undecided: null };
  return { measured: true, clientRows, reachable, unreachable: clientRows - reachable, tails: tailList.length, rowsParsed, routesDeclared: routesDeclaredAll, clientsDeclared: clientsDeclaredAll, leadsOutsideCode, causes, ledgers: byLedger, brokenScan };
}

/**
 * The walk itself, split out of `scanRouteSurface` so `--self-test` can pin the one
 * decision that broke here — WHICH FILES THE WALK ADMITS — against a fake tree.
 * `readDir` is injectable for exactly the reason `packageRootOf`'s `hasPackageJson` is:
 * the pin needs no repo state, and a pin that re-asks the predicate instead of walking
 * would re-pin the half that was already right.
 *
 * ⛔ `isTestFile` IS DEFINED OVER A PATH AND MUST BE GIVEN ONE (#11866). This call site
 * used to pass `e.name` — a BASENAME — so the `__tests__` / `__mocks__` / `__fixtures__`
 * arm, which requires a `/`, could never match: only the `*.test.*` / `*.spec.*` arm did
 * any work here, and the directory exclusion the function documents was not happening.
 * The self-test did not catch it because it pins `isTestFile` with paths, and the
 * function was never the broken half — its CALLER was. That is why the pin walks a fake
 * tree through this function rather than calling the predicate a fourth time.
 *
 * A STRICT TIGHTENING, measured rather than assumed: on `d63b01436`, of the 4625 `.ts`
 * files under `packages/**`, exactly 3 were admitted by the basename test and are
 * excluded by the path test, and ZERO go the other way — the file arms are anchored
 * `(^|\/)`, so a basename they match is matched inside a path too. Reordering `rel`
 * ahead of the test therefore cannot admit anything the old order excluded.
 *
 * ⭐ AND THE EXCLUSION IS RIGHT FOR THE CEILING TOO, which is the question this walk's
 * two consumers make live. `sourceFiles` is the #11178 ceiling population and
 * `registrarFiles` is the bridge's own discovery — one walk, both. It is tempting to
 * argue the ceiling wants the WIDEST possible population and so should keep test
 * directories; it does not, because of what the ceiling's verdict MEANS. A row counted
 * `remediable by discovery` is a claim that widening the FILENAME CONVENTION would reach
 * it, and no widening of that convention may legitimately admit a test double — so a
 * witness under `__tests__/` would move a row into `remediable` against a remedy that
 * cannot be taken, i.e. exactly the misreading `bridgeCoverageFrom`'s split exists to
 * end ("it aimed a whole card at widening a recognizer that was never the constraint").
 * The superset invariant survives either way — both populations come off this one walk,
 * so they narrow together and `reachable` still cannot exceed the ceiling. And no gate
 * ratchets these counts: `check-affected-docs.mjs` fails on `brokenScan` alone, so
 * nothing here moves a shrink-only number down.
 *
 * @param {string} root  the tree to walk (`packages/**` under it); paths come back
 *   relative to it, which is what `isTestFile` and both file regexes are defined over.
 * @param {(dir: string, opts: {withFileTypes: true}) => Array<{name: string, isFile(): boolean, isDirectory(): boolean}>} [readDir]
 * @returns {{registrarFiles: string[], sourceFiles: string[]}}
 */
function walkSourceFiles(root, readDir = readdirSync) {
  const registrarFiles = [];
  // EVERY candidate the convention CHOSE FROM, collected in the same walk (#11178). This
  // is not a second discovery route and nothing downstream of the bridge reads it: it is
  // the population `maximalTailsFrom` measures the convention against, so that "the
  // recognizer missed a registrar" can be told apart from "there is no registrar". Filled
  // here rather than by a second walk for the reason `scanRouteSurface` exists at all —
  // two walks of `packages/**` is the drift #4851 billed us for.
  const sourceFiles = [];
  const walkSrc = (dir) => {
    let entries;
    try { entries = readDir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.turbo') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) { walkSrc(p); continue; }
      if (!e.isFile() || !e.name.endsWith('.ts')) continue;
      // The PATH, never `e.name` — see above.
      const rel = relative(root, p);
      if (isTestFile(rel) || isMigrationLedgerEntry(rel)) continue;
      sourceFiles.push(rel);
      if (LEDGER_FILE_RE.test(rel) || REGISTRAR_FILE_RE.test(rel)) registrarFiles.push(rel);
    }
  };
  walkSrc(join(root, 'packages'));
  return { registrarFiles, sourceFiles };
}

/**
 * Walk `packages/**` for the two declared tables the `sdk` bridge rides on. Split out of
 * PHASE 2 so `--bridge-coverage` can measure the same surface the bridge uses, from the
 * same walk — a second walk here is exactly the drift #4851 billed us for.
 */
function scanRouteSurface() {
  const { registrarFiles, sourceFiles } = walkSourceFiles(repoRoot);

  const ledgers = [];
  const ledgerRows = [];
  const registrarByTail = new Map();
  for (const rel of registrarFiles) {
    let text;
    try { text = readFileSync(join(repoRoot, rel), 'utf8'); } catch { continue; }
    if (LEDGER_FILE_RE.test(rel)) {
      const { rows, declined, routesDeclared, clientsDeclared, outsideCode } = parseLedgerSource(text);
      ledgers.push({ file: rel, rows, declined, routesDeclared, clientsDeclared, outsideCode });
      ledgerRows.push(...rows);
    }
    if (REGISTRAR_FILE_RE.test(rel)) {
      for (const [tail, ids] of parseRegistrarSource(text)) {
        let acc = registrarByTail.get(tail);
        if (!acc) registrarByTail.set(tail, (acc = new Set()));
        for (const id of ids) acc.add(id);
      }
    }
  }
  return { registrarFiles, sourceFiles, ledgers, ledgerRows, registrarByTail };
}

/**
 * The source with comments AND string/template/regex CONTENTS blanked, quotes and all other
 * code bytes kept in place. Both masks come from the one answer to "is this span code?"
 * (`js-comment-mask.mjs`), so this cannot drift from what the rest of the repo means by it.
 *
 * The quote characters SURVIVE the blanking, which is the property `unreadableIn` rides on:
 * a value that still opens with a quote here is one the recognizer or `declinedIn` already
 * accounts for, and a value that does not is one nothing has read.
 */
function codeOnly(source) {
  const { comment, literal } = scanSource(source);
  const both = new Uint8Array(comment.length);
  for (let i = 0; i < both.length; i++) both[i] = comment[i] || literal[i];
  return blank(source, both);
}

/**
 * The spans of every `interface X { … }` / `type X = { … }` declaration in already-blanked
 * source. This is the EXACT discriminator against the `route: string;` member that all seven
 * ledgers' own entry interfaces declare — the one thing a widened counter must not bill as a
 * row (#10500). It is structural, not a guess about the value's spelling: a type member is
 * inside a type declaration's braces and a table row never is, whatever either is written as.
 *
 * A `type X = string;` with no object body is skipped rather than brace-matched onto some
 * later block: the `;` arriving before any `{` is what says the declaration has no members.
 */
function typeDeclRegions(code) {
  const regions = [];
  const re = /\b(?:interface\s+[A-Za-z_$][\w$]*|type\s+[A-Za-z_$][\w$]*\s*=)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const open = code.indexOf('{', m.index);
    if (open === -1) continue;
    const semi = code.indexOf(';', m.index);
    if (semi !== -1 && semi < open) continue;
    let depth = 0;
    let end = code.length;
    for (let i = open; i < code.length; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}' && --depth === 0) { end = i; break; }
    }
    regions.push([m.index, end]);
  }
  return regions;
}

/**
 * THE ONE SPELLING of a `route:` / `client:` LEAD — the key, the colon, and whatever may
 * sit between the colon and the VALUE. Every scan below that asks "is a declaration written
 * here?" builds its regex from this, so the eight of them cannot answer the same question
 * differently while all eight look right.
 *
 * WHAT THE EIGHTH COPY COST (#11494). `declarationsIn` spelled the run after the colon
 * `[ \t]*` and the other seven spelled it `\s*`. One character class, one character of
 * difference — a NEWLINE — and a declaration whose value sits on the NEXT line was seen by
 * BOTH scans, in two different buckets, and billed to the denominator twice: `declinedIn`
 * read it as a declined quote and named it correctly, while `declarationsIn` saw `\n` as
 * the character after the colon, classified `quote === null`, and `unreadableIn` billed the
 * same declaration a second time as a non-literal. Measured on `cd932772`, one file
 * declaring TWO `route:` values:
 *
 *     export const L = [
 *       { route:
 *           "GET /api/v1/gone", family: 'metadata', disposition: 'sdk' },
 *       { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },
 *     ];
 *   ⇒ rows 1 · routesDeclared 3 · declined 2 · brokenScan 1
 *
 * …and the second declined entry read `route: ` — an EMPTY value, naming nothing a reader
 * can act on, which is the silence every other report in this file exists to break. Note
 * `rows + declined === routesDeclared` still BALANCED (1 + 2 === 3): the partition held
 * arithmetically over a population that counts one declaration twice, which is exactly the
 * "correct from inside" shape #10500 / #10793 / #10901 each closed one instance of.
 *
 * `\s*` IS THE CLASS THAT WINS, and it is not a coin flip. The ROW RECOGNIZER spells
 * `\s*`, so a wrapped SINGLE-quoted value is ALREADY read as a row — and was then billed
 * unread by the same file, firing a PARTIAL-read verdict with exit 1 on a wholly accurate
 * ledger (measured: `rows 1 · routesDeclared 2 · declined 1 · brokenScan 1` on a file
 * declaring ONE row, the declined entry again empty-valued; the `client:` column did the
 * same to `clientsDeclared`). That is the FALSE RED direction, which this file prices as
 * costing the same trust a false green does. Making `[ \t]*` win instead would have had to
 * move the recognizer too — a change to the MEASURED POPULATION, which the header of
 * `--bridge-coverage` attaches a before/after standard to — and would have kept the
 * empty-valued entry as the surviving one.
 *
 * Priced on the tree where the move is provably free: none of the seven ledgers ends a line
 * at a `route:` / `client:` colon (`grep -nE '\b(route|client)[ \t]*:[ \t]*$'`, 0 hits),
 * and `268 of 268` / `222 of 222` / 177 UNREACHABLE are byte-identical across the change.
 *
 * A FUNCTION DECLARATION rather than a `const`, for `declinedIn`'s reason: `--self-test`
 * short-circuits near the top of this file, before any `const` down here has initialized,
 * and a TDZ error there takes the whole self-test down instead of failing one check.
 *
 * THE KEY IS ANCHORED HERE TOO, AND ONLY HERE (#11542). It used to be each call site's own
 * argument: `declarationsIn` wrote `\b(route|client)` and the other seven wrote the key bare,
 * so `subroute: 'GET /api/v1/gone'` was a declaration to SEVEN of the eight scans and not to
 * the eighth — the same family of divergence one spelling further out, and it minted a silent
 * phantom ROW. Silent for the reason #10683 and #10793 were: the partial-read verdict is keyed
 * on the gap between `rows` and `routesDeclared` and BOTH terms read the unanchored spelling,
 * so both moved together and no verdict fired. `outsideCode` could not see it either, because
 * the lead genuinely IS in code position, and `declarationsIn` — the one scan that got it
 * right — sat on the side of the ledger where being right shows up only as a SHORTFALL, which
 * is precisely what that arithmetic hides. Measured on `cd932772`, one file declaring ONE
 * `route:`:
 *
 *     export const L = [
 *       { subroute: 'GET /api/v1/gone', family: 'metadata', disposition: 'sdk' },
 *       { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },
 *     ];
 *   ⇒ rows 2 · routesDeclared 2 · clientsDeclared 1 · declined 0 · outsideCode 0 · brokenScan 0
 *
 * The phantom carries a path nobody mounts. In THAT fixture it carries no `client:` either,
 * so it merely inflated `rows` and the denominator together and stopped there. Where the
 * stray key sits BETWEEN a real `route:` and its `client:` it did worse, and this is the half
 * a count comparison cannot see at all: the row WINDOW is delimited by the same lead, so the
 * phantom CLOSED the real row's window, took its binding, and joined the UNREACHABLE
 * population as a client-bound row on a path no registrar mounts — while the real row lost
 * the binding it plainly declares. Same shape #10636 measured for the quote spellings,
 * arriving through the key; `--self-test` pins that one on its own fixture.
 *
 * `\b` IS THE ANSWER ON THE MERITS, and it is the spelling the one scan that got it right
 * already used: `subroute` is not `route`. The other direction — un-anchoring
 * `declarationsIn` so that the eight agree — buys agreement at the price of being
 * agreed-and-wrong, and no key exists that it would be meant to catch.
 *
 * ⛔ THIS MOVED THE MEASURED POPULATION, which the header of `--bridge-coverage` attaches a
 * before/after standard to: anchoring REMOVES rows, it does not add them. Priced on the tree
 * where the move is provably free — across all seven live ledgers there are ZERO leads that
 * the unanchored spelling reads and the anchored one does not (every match of
 * `(route|client)\s*:\s*` over RAW text is also a match of `\b(route|client)\s*:\s*` at the
 * same index; 0 divergent leads), and `269 of 269` / `222 of 222` / 45 reachable /
 * 177 UNREACHABLE / 0 prose-quoted leads / `brokenScan` 0 are byte-identical across the
 * change. That is the same "provably free tree" argument #10683 and #10793 each made
 * explicitly for their own population moves, and it is made explicitly here for the same
 * reason: the alternative is moving a reported number quietly.
 *
 * ⛔ THE ANCHOR IS A LOOKBEHIND, NOT `\b` (#11630) — and the SET is the load-bearing half.
 * `\b` fails only against a preceding WORD character (`[A-Za-z0-9_]`), so `$route:` — a legal
 * JS identifier — was read as a declaration by all eight scans. They agreed, and they agreed
 * by being wrong together, which is the shape #11542's own card rejected on sight when
 * "make `declarationsIn` match the other seven" was proposed as the other direction.
 *
 * The set is `[\w$.]` — `symbolRe`'s, NOT `dottedRe`'s. Three lookbehind idioms already live
 * in this file and they exclude THREE DIFFERENT classes, so copying the nearest one is how a
 * fix comes out right about the mechanism and wrong about the class:
 *   • `symbolRe`      `(?<![\w$.])`   a BARE token — not a longer identifier, not a member
 *   • `dottedRe`      `(?<![\w$])`    a DOTTED token, which must tolerate its own dots
 *   • `rulePatternFor`/`commandPatternFor` `(?<![\w$.-])`  a doc-side PROSE span, where `-`
 *     glues tokens in English
 * ⛔ AND THAT TABLE IS WHY THIS IS NOW AN ALLOWLIST (#11717). Every idiom above names a class
 * it EXCLUDES, so every one of them has a residue — and this key's residue was worked through
 * one card at a time: #11494 the colon run, #11542 the word boundary (`subroute:`), #11630 `$`
 * and `.` (`$route:`, `cond ? obj.route : x`), #11711 queued for Unicode because `\w` is
 * ASCII-only. Each card was small, provably free and honestly priced, and each named the next
 * residue as a pin for the next card to flip. That is a good discipline for an open-ended
 * defect and the wrong one for a BOUNDED defect: over code points 0..0x2FFF the `\b` anchor
 * admitted 12225 characters and `(?<![\w$.])` admitted 12223, so the whole family was arguing
 * about a handful at the edge of a set of twelve thousand.
 *
 * SO THE ANCHOR IS INVERTED rather than shrunk a fifth time. It no longer enumerates what may
 * not PRECEDE the key; it names the positions where an object-literal property key may BEGIN —
 * start of input, whitespace, `{`, `,` — and rejects everything else. Spelled as a negative
 * lookbehind over the COMPLEMENT of that allowlist, `(?<![^\s{,])`, which also gives
 * start-of-input for free rather than as a second alternative. The set is bounded at three
 * characters where a blocklist is not bounded at all, and it closes `$`, `.`, `-`, Unicode and
 * every future escapee of that shape in ONE move instead of one per card.
 *
 * ⛔ AND IT NEEDS NO `u` FLAG, which is the concrete cost the blocklist route was carrying:
 * closing the Unicode residue as a class meant `\p{L}` under `u`, which changes the escape
 * semantics of every source these leads are COMPOSED with at the eight call sites. An
 * allowlist of ASCII positions needs none, so #11711 is subsumed at no cost at all.
 *
 * ⛔ THE RESIDUE THIS LEAVES — and it is the end of what ANY left-anchor can reach, so it is a
 * BOUNDARY rather than the next link in the chain. A key in EXPRESSION position preceded by
 * whitespace, `cond ? route : 'GET /api/v1/x'`, is byte-for-byte what a property key looks
 * like, so the allowlist admits it — correctly, by its own rule. #11630 named this same class
 * as the one no lookbehind can reach, and that is exactly why it left `-` admitted: `a-route`
 * really is the whole token `route`. The allowlist closes every spelling of the class that
 * WEARS a character (`$route`, `.route`, `-route`, `éroute`) and leaves the plainest one.
 * Closing THAT needs the colon's enclosing expression, not its left neighbour — a parser
 * question, not an anchor question, and a different card if a puller ever appears. Pinned in
 * `--self-test` as deliberately unmoved.
 *
 * ⛔ THIS IS THE THIRD POPULATION MOVE, and like #11630's it moves BOTH the ledger rows and
 * `declarationsIn`. Priced with its own before/after against the header of `--bridge-coverage`,
 * at ROW IDENTITY rather than counter equality, and re-derived against THIS base rather than
 * inherited from #11630: `--bridge-coverage --json` carries all 177 `unreachableRows` by
 * `{file, route, client}` and still hashes `d04a5cedfb613370e5b46ac4725db1d941e5dc88`, and the
 * `declarationsIn` population is byte-identical across the change. Counters agreeing is
 * consistent with two rows swapping places; row identity is not. Provably free for the direct
 * reason: across the seven live ledgers all 499 `route:`/`client:` leads are preceded by a
 * SPACE — 0 by `$`, 0 by `.`, 0 by `-`, 0 by `{`, 0 by `,`, 0 by anything outside the
 * allowlist at all (positive control: the same scan reports every one of those classes the
 * moment a fixture carries them, so the zeros are readings and not a blind scan).
 *
 * ⛔ AND IT CAN ONLY EVER REMOVE, swept rather than argued — against the anchor it actually
 * replaces, not against the one two cards ago. Over code points 0..0x2FFF `(?<![\w$.])` admits
 * 12223 and this allowlist admits 25, and the allowlist admits 0 that `(?<![\w$.])` does not.
 * Both numbers and the zero are pinned in `--self-test`.
 *
 * WHY THERE IS NO RIGHT-HAND ANCHOR, since every idiom above carries one: the `\s*:` that
 * follows IS the right anchor, exactly. `routes:` cannot match — after `route` the `\s*` takes
 * nothing and the `:` meets `s` — while `route :` legitimately does. A trailing class would be
 * a second spelling of a constraint the colon already makes exact.
 *
 * @param {string} keys  the key alternation ONLY — `(route|client)`, `route`,
 *   `(?:route|client)`. The capture groups are the call site's question; the ANCHOR, the
 *   colon and the run between the colon and the value are this function's. ⛔ A call site must
 *   NOT restate the anchor — neither the old `\b` nor a lookbehind of its own: a second copy
 *   is a second spelling, which is the entire defect this closes, and `--self-test` pins that
 *   no argument carries either form.
 */
function declLead(keys) {
  return String.raw`(?<![^\s{,])${keys}\s*:\s*`;
}

/**
 * Every `route:` / `client:` declaration a ledger makes IN CODE POSITION, with the quote its
 * value opens in (`'`, `"`, backtick) or `null` for a value that is not a string literal at
 * all — `route: ROUTES.health`, `route: BASE + '/types'`. The two readers below are filters
 * over this one list, so what counts as a declaration is decided once: the non-literal half
 * is read by NEITHER the recognizer (which needs a leading `'`) NOR `declinedIn` (which needs
 * a leading `"` or backtick), and before #10500 such a row left the population with no verdict
 * at all — not read, not declined, not counted in the denominator. That is the same silence
 * #9896 closed for the quote spellings, one spelling further out, and silence is the defect
 * either way.
 *
 * ⛔ This does NOT widen the recognizer either. Like `declinedIn`, it only reports what could
 * not be read — `rows` is untouched, byte for byte.
 *
 * Two exclusions, both exact rather than heuristic, and both measured on the seven live
 * ledgers (`route:` 267 raw occurrences, 259 read, 8 non-quoted — and all 8 are excluded here):
 *   • COMMENTS and STRING CONTENTS are blanked, so the English sentence in
 *     `runtime/src/route-ledger.ts` ("It never named a mounted route: the branch") is gone by
 *     construction rather than by an allowlist.
 *   • TYPE DECLARATIONS are skipped, so the `route: string;` member each of the seven entry
 *     interfaces declares is not billed as an unread row. #9896 kept the quote requirement
 *     precisely because it was the only exact discriminator it had against that member;
 *     `typeDeclRegions` is a second exact one, which is what lets the counter widen at all.
 */
function declarationsIn(text) {
  const code = codeOnly(text);
  const skip = typeDeclRegions(code);
  const out = [];
  // The `\b` this used to carry is now `declLead`'s (#11542) — it was the LAST spelling the
  // eight scans decided for themselves, and this was the one scan that decided it correctly.
  // #11630 then widened that one anchor past `\b` to `(?<![\w$.])`, which moves THIS scan as
  // well: a `$route:` or a `cond ? obj.route : x` no longer reaches `unreadableIn` (line
  // 1478) to be billed as a declaration the recognizer could not read. #11542's before/after
  // was priced to leave this scan byte-identical; #11630's is priced INCLUDING it.
  const re = new RegExp(declLead('(route|client)'), 'g');
  let m;
  while ((m = re.exec(code)) !== null) {
    if (skip.some(([a, b]) => m.index >= a && m.index <= b)) continue;
    const at = m.index + m[0].length;
    const ch = code[at];
    const quote = ch === "'" || ch === '"' || ch === '`' ? ch : null;
    // The VALUE as written, off the raw text — `codeOnly` blanked the contents, and a
    // report that names `client: ''` for every row is not a report. Cut at the closing
    // quote in JS rather than matched to it, for `declinedIn`'s reason: an interpolated
    // or unterminated literal must still name itself instead of dropping out.
    const line = text.slice(at).split('\n')[0];
    let value;
    if (quote === null) {
      const cut = line.search(/[,;]/);
      value = (cut === -1 ? line : line.slice(0, cut)).trim().slice(0, 60);
    } else {
      const body = line.slice(1);
      const end = body.indexOf(quote);
      value = `${quote}${end === -1 ? body.slice(0, 60) : body.slice(0, end)}${quote}`;
    }
    out.push({ index: m.index, key: m[1], quote, text: `${m[1]}: ${value}` });
  }
  return out;
}

/**
 * The declarations above that are not a string literal in ANY quote — the #10500
 * population, unchanged byte for byte. Kept as a NAMED filter over the one scan rather
 * than as a scan of its own: the counter below now reads the quoted half of the same
 * list, and two scans that each decide separately what "in code position" means are two
 * scans that can drift into disagreeing while both look right.
 */
function unreadableIn(text) {
  return declarationsIn(text).filter((d) => d.quote === null);
}

/**
 * Every `client:` value a ledger declares in a quote — including the single quote this
 * recognizer reads — that NO row window claimed (#10636).
 *
 * The residue #10500 left. Both terms of the `clientsDeclared` denominator were
 * row-relative, so a correctly single-quoted `client:` belonging to a row whose `route:`
 * could not be read fell out of both: its row never became a row, so `rows` does not
 * carry it, and its own spelling is the one the recognizer reads, so nothing declined it.
 * The value left the denominator without a word while the file plainly declared it, and a
 * denominator that quietly omits a declaration renders a PARTIAL read as more complete
 * than it is. Measured on `ba2d8d4730`: `i18n-route-ledger.ts` with one added
 * `route: I18N_BASE + '/plurals'` row reported `3 of 3` declared `client:` values on a
 * file declaring four.
 *
 * ⛔ NOT a widening of the recognizer either. `rows` is untouched; a value named here is
 * billed to NO row — it is counted as declared and named with its own line, which is the
 * one thing a count comparison cannot say for itself.
 *
 * WHY THIS CAN BE FILE-WIDE NOW, when the comment in `parseLedgerSource` argued it must
 * not be. That argument was right for the scan it had: over raw text, a `client:` written
 * in prose or inside a string payload would be billed to a row that never declared it,
 * and a false red costs the same trust a false green does. #10500 built the two exact
 * discriminators that answer it — `codeOnly` (comments and string CONTENTS blanked) and
 * `typeDeclRegions` (the `client: string;` member of every ledger's own entry interface,
 * and the `client: 'a' | 'b';` literal-union member the quote test alone would swallow) —
 * and this reads the same list through both. The ROW BINDING stays window-relative: what
 * moves file-wide is the denominator, not the question of which row owns a value.
 *
 * @param {string} text
 * @param {Set<number>} claimed  index of every `client:` a row read or an in-window
 *   decline already named — the ones this must not bill a second time.
 */
function unclaimedClientsIn(text, claimed) {
  return declarationsIn(text)
    .filter((d) => d.key === 'client' && d.quote !== null && !claimed.has(d.index))
    // The snippet says WHY it is here. Every other entry in the declined list is a
    // spelling this scan cannot read; this one is spelled exactly the way it reads, and a
    // reader shown `client: 'i18n.getPlurals'` under a "reads single-quoted values only"
    // verdict would reasonably conclude the report was broken.
    .map((d) => ({ ...d, text: `${d.text} (no row read it)` }));
}

/**
 * Every `route:` / `client:` declaration in a ledger whose value opens with a quote the row
 * recognizer below does NOT read. Written once, here, so the recognizer and its complement
 * cannot drift into agreeing while both are wrong; `--self-test` pins the partition
 * (every declaration is read or declined, never neither, never both).
 *
 * The snippet runs to the end of the line and is trimmed back to the closing quote in JS
 * rather than matched to it: an interpolated or unterminated literal must still NAME
 * itself, and a regex that requires the closing quote would drop exactly those out of the
 * report — the same silence one level up.
 *
 * A FUNCTION DECLARATION rather than a `const` arrow, deliberately: `--self-test`
 * short-circuits near the top of this file, before any `const` down here has initialized,
 * and a TDZ error there takes the whole self-test down instead of failing one check.
 *
 * IT NO LONGER DECIDES "IS THIS A TYPE MEMBER?" FOR ITSELF (#10901). It used to run over
 * raw text through NEITHER of #10500's discriminators while the recognizer read through
 * both, so a literal-union `route: "GET /a" | "GET /b"` TYPE member — the identical shape
 * #10793 kept out of `rows`, written in either of the two quotes this scan reads — was
 * billed as a value the parse FAILED to read. That is a verdict, not a number: the entry
 * is NAMED with its line and `bridgeCoverageFrom` raises a PARTIAL read with exit 1, on a
 * ledger that is completely accurate. Measured on the tree this landed on, one file
 * declaring ONE row:
 *
 *     export interface Entry { route: "GET /api/v1/gone" | "GET /api/v1/meta"; client: string }
 *     export const L = [
 *       { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },
 *     ];
 *   ⇒ rows 1 · routesDeclared 2 · declined 1 · brokenScan 1   (backtick: identical)
 *
 * So the region list arrives as a PARAMETER, from the one caller that already computes it,
 * and there is no default: a call site that forgot the discriminator would silently
 * reintroduce exactly the second opinion this closes, and the file argues twice that two
 * scans each deciding "in code position" separately are two scans that can drift into
 * disagreeing while both look right. `offset` is the absolute position of `s` in the file,
 * so the translation between the in-window slice's coordinates and the region list's
 * happens HERE, once, instead of at one of the two call sites — the returned `index` is
 * absolute for both.
 *
 * ⛔ THE OTHER DISCRIMINATOR IS DELIBERATELY NOT APPLIED HERE. This still reads RAW bytes,
 * so a `route: "GET /x"` written in a COMMENT is still billed as a declined row. That is
 * #10794, closed `not planned` on the reasoning that it is the LOUD direction and has no
 * puller — and it is not this card's to reverse. It is also not a free change of lens:
 * `codeOnly` blanks string CONTENTS, and this scan's whole job is to quote the unread
 * spelling back at the reader, so a masked window would name `route: ""` for every entry.
 * `--self-test` pins that boundary in place, and a future card closing #10794 is expected
 * to move that pin rather than to find it missing.
 */
function declinedIn(s, offset, inTypeDecl) {
  const out = [];
  for (const d of s.matchAll(new RegExp(declLead('(route|client)') + /(["`])([^\n]{0,120})/.source, 'g'))) {
    const index = offset + d.index;
    // …and never a TYPE member (#10901), on the SAME region list the recognizer and the
    // denominator read — not a second idea of what a type member is.
    if (inTypeDecl(index)) continue;
    const end = d[3].indexOf(d[2]);
    out.push({ index, key: d[1], text: `${d[1]}: ${d[2]}${end === -1 ? d[3].slice(0, 60) : d[3].slice(0, end)}${d[2]}` });
  }
  return out;
}

/**
 * `{ route, client }` rows out of a route ledger — the declared cross-surface table — and,
 * beside them, the declarations this recognizer DECLINED to read. That second half used to
 * be silent, and silence is the defect: a PARTIAL read renders exactly like a complete one.
 *
 * WHAT WAS MEASURED (a718ee3dd, all seven of today's ledgers are wholly single-quoted —
 * 259 `route:` and 221 `client:` values, delta 0, so none of the verdicts below can fire on
 * today's tree). Rewriting ONE row of `i18n-route-ledger.ts`:
 *
 *   • backtick-quoted `route:` → the client-bound population goes 221 → 220, no verdict,
 *     exit 0. The pre-existing `rowsParsed === 0` guard is the ALL-or-nothing case and
 *     cannot see this by construction.
 *   • single-quoted `route:` beside a backtick-quoted `client:` → 221 → 220 again, while
 *     `rowsParsed` stays 3: the row keeps its seat and loses its binding.
 *   • worst, and the reason the verdict keys on the SPELLING rather than on a shortfall:
 *     the row window is delimited by this same single-quote-only lead, so a declined row
 *     does not close the PREVIOUS row's window. Backtick-quoting `GET /api/v1/meta` in
 *     `rest-route-ledger.ts` moved `meta.getTypes` onto the server-only `GET /api/v1/docs`
 *     — a WRONG binding, with `clientRows` still 221. A count comparison alone is blind
 *     to that one.
 *
 * A template literal is the realistic spelling: the repo's formatter rewrites double quotes
 * back to single, but leaves `` route: `${base}/locales` `` alone, and that is the natural
 * shape the moment anyone interpolates a base path into a row.
 *
 * ⛔ This does NOT widen the recognizer. `rows` comes out of the loop it always did, byte
 * for byte; everything else here is a report about what that loop could not read. Widening
 * would move the measured population, which is a separate decision with a before/after
 * standard attached — see the header of `--bridge-coverage`.
 *
 * THAT BOUNDARY IS NOW CLOSED (#10500). A `route:` whose value is not a string literal at
 * all (`route: ROUTES.health`, `route: BASE + '/x'`) used to be invisible to the recognizer
 * AND to this counter — read by neither half, so the row left the population with no verdict
 * of any kind. `unreadableIn` counts those too, and the `route: string;` member every
 * ledger's own entry interface declares stays out of the count on an EXACT discriminator
 * rather than on the quote heuristic: the member sits inside a type declaration and a table
 * row never does. The denominator below is therefore every declared `route:` value, in any
 * spelling, and the partition `rows + declined === routesDeclared` is pinned in `--self-test`.
 *
 * THE RECOGNIZER NOW READS CODE, NOT PROSE (#10683). It used to scan the RAW text while
 * every other scan here read `codeOnly`, so a `route:` quoted in a comment or inside a
 * string payload became a ROW — silently, because the partial-read verdict is keyed on the
 * gap between `rows` and `routesDeclared` and both terms read raw. The population move that
 * closing it implies was priced on the tree that had no instance of the shape: delta 0 on
 * all seven ledgers. `outsideCode` is what keeps the fix from trading a phantom row for a
 * new silence — it NAMES every lead the mask dropped, and carries no verdict.
 *
 * …AND THROUGH BOTH OF #10500'S DISCRIMINATORS, NOT ONE (#10793). `codeOnly` was only half
 * of the answer: type declarations are CODE, so a literal-union `route: 'GET /a' | 'GET /b'`
 * TYPE member still minted a row — the identical silent shape arriving through the other
 * discriminator, with `rows` and `routesDeclared` moving together again so no verdict fired.
 * The recognizer and the first term of its denominator now skip `typeDeclRegions` the way
 * `declarationsIn` has since #10500, so the two scans answer "is this in code position?" the
 * same way instead of drifting while both look right. Delta 0 on all seven ledgers again:
 * none of them declares a quoted `route:` inside a type declaration.
 *
 * @returns {{rows: Array<{route: string, client: string|null}>, declined: Array<{key: string, line: number, text: string}>, routesDeclared: number, clientsDeclared: number, outsideCode: Array<{key: string, line: number, text: string}>}}
 */
function parseLedgerSource(text) {
  const rows = [];
  const declined = [];
  // Index of every `client:` declaration this parse ACCOUNTED FOR — read as a row's binding,
  // or named as a declined spelling inside a row window. The complement of this set, over the
  // same file, is what #10636 was: declared, unread, and uncounted.
  const claimed = new Set();
  const lineAt = (i) => 1 + (text.slice(0, i).match(/\n/g) || []).length;
  // THE LENS (#10683). Every other scan in this file reads the source through `codeOnly`;
  // this one read RAW TEXT, and that asymmetry WAS the defect. A `route:` followed by a
  // single-quoted literal inside a COMMENT or a string PAYLOAD did not merely mis-count —
  // it became a ROW, and no verdict could fire, because the partial-read guard is keyed on
  // the gap between `rows` and `routesDeclared` and BOTH terms read raw text, so both moved
  // together. A prose line quoting a `client:` too minted a fully client-bound phantom,
  // which then joined the UNREACHABLE population (no registrar tail can match a route
  // nobody mounts). Measured before the mask, on a file declaring ONE row:
  //
  //     // A row we removed used to read route: 'GET /api/v1/gone' before #1234.
  //     export const L = [
  //       { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },
  //     ];
  //   ⇒ rows 2 · routesDeclared 2 · clientsDeclared 1 · declined []
  //
  // Byte offsets survive the mask untouched (`blank` writes spaces and keeps newlines), so
  // every index below indexes BOTH strings: leads are found in `code`, values are read back
  // out of `text` at the same offsets. Moving the recognizer MOVES THE MEASURED POPULATION,
  // which the header of `--bridge-coverage` attaches a standard to — so it was done on the
  // one tree where the move is provably free: no ledger quotes a `route:` in prose today,
  // and `rows`, `routesDeclared`, `clientsDeclared` and the 176 UNREACHABLE rows are
  // byte-identical across the change (all seven ledgers, delta 0).
  // BOTH OF #10500'S DISCRIMINATORS NOW, NOT ONE (#10793). `codeOnly` blanks comments and
  // string CONTENTS; it does not blank TYPE DECLARATIONS, and has no reason to — they are
  // code. So a literal-union `route: 'GET /a' | 'GET /b'` TYPE member was still read as a
  // ROW: the identical silent shape the paragraph above describes, arriving through the
  // other discriminator. It stayed silent for the same two reasons — `rows` and
  // `routesDeclared` moved together, so the partial-read guard saw no gap, and `outsideCode`
  // could not see it either, because the lead genuinely IS in code position. Measured on the
  // tree this landed on, one file declaring ONE row:
  //
  //     export interface Entry { route: 'GET /api/v1/gone' | 'GET /api/v1/meta'; client: string }
  //     export const L = [
  //       { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },
  //     ];
  //   ⇒ rows 2 · routesDeclared 2 · clientsDeclared 1 · declined 0 · outsideCode 0
  //
  // ⛔ A SKIPPED TYPE MEMBER IS SILENT ON PURPOSE, and that is NOT the silence `outsideCode`
  // exists to break. A prose-quoted lead is a would-be row sitting where the mask says code
  // is not, so naming it tells the reader something they can act on. A type member is a
  // correct declaration of a TYPE: the `route: string;` member all seven entry interfaces
  // declare produces nothing today under the same rule, `declarationsIn` has excluded the
  // literal-union spelling since #10500, and `--self-test` pins BOTH directions — deleting
  // the interface changes no count at all. This makes the recognizer agree with the position
  // the rest of the file already held rather than inventing a second one.
  //
  // The population move was priced on the tree where it is provably free: 0 quoted `route:`
  // or `client:` leads inside a type declaration across all seven ledgers, and
  // `259 of 259` / `221 of 221` / 176 UNREACHABLE are byte-identical across the change.
  const code = codeOnly(text);
  // The SECOND discriminator, taken over the already-blanked source — the same call
  // `declarationsIn` makes, reusing the same region list rather than growing a second idea
  // of what a type member is.
  const typeDecls = typeDeclRegions(code);
  const inTypeDecl = (i) => typeDecls.some(([a, b]) => i >= a && i <= b);
  // The value as WRITTEN. `codeOnly` blanks string CONTENTS, so a capture group taken off
  // `code` is a run of spaces of the right length and never the route. Blanking preserves
  // LENGTH, so cutting the raw text by the masked match's offsets is exact for any content
  // — including one carrying an escaped quote, which re-running the regex over the raw text
  // would cut short at the `\'` instead of at the literal's real end.
  const valueAt = (end, len) => text.slice(end - 1 - len, end - 1);
  const routeRe = new RegExp(declLead('route') + /'([^']+)'/.source, 'g');
  const nextRouteRe = new RegExp(declLead('route') + "'");
  const windowClientRe = new RegExp(declLead('client') + /'([^']+)'/.source);
  let m;
  while ((m = routeRe.exec(code)) !== null) {
    // …and never a TYPE member (#10793). A literal-union member opens with the very quote
    // this regex reads, which is exactly why `typeDeclRegions` and not a spelling test.
    if (inTypeDecl(m.index)) continue;
    const rest = code.slice(m.index, routeRe.lastIndex + 1200);
    const nextRoute = rest.slice(1).search(nextRouteRe);
    const window = nextRoute === -1 ? rest : rest.slice(0, nextRoute + 1);
    const client = window.match(windowClientRe);
    rows.push({
      route: valueAt(routeRe.lastIndex, m[1].length),
      client: client ? valueAt(m.index + client.index + client[0].length, client[1].length) : null,
    });
    if (client) claimed.add(m.index + client.index);
    // A `client:` is BOUND inside THIS row's window — the same window the line above reads
    // — and never file-wide: a `client:` written in prose elsewhere would otherwise be
    // billed to a row that never declared it, and a false red costs the same trust a false
    // green does. That is a rule about ATTRIBUTION and it still holds; the denominator's
    // file-wide sweep at the bottom bills its findings to no row at all (#10636).
    // …over the RAW bytes of that same window. `declinedIn`'s whole job is to NAME an
    // unread spelling, and the masked window would name `client: ""` for every one of them.
    // The BYTE RANGE is the code-derived window's, so this is the same span, read for its
    // text — but it now reads that span through the TYPE-DECLARATION discriminator (#10901),
    // on the same `typeDecls` list the loop above and the denominator below read. An entry
    // interface trailing the table lands INSIDE this window (measured: `client: "a" | "b"`
    // on the line after the table's `];` was billed as a declined client, `clientsDeclared`
    // 2 on a file declaring 1, exit 1), and a type member is not a row this parse failed to
    // read — it is a correct declaration of a TYPE.
    //
    // ⛔ Still RAW, and still through no `codeOnly`: a `route: "GET /x"` written in a
    // COMMENT is still billed as a declined row. That is #10794, closed `not planned`
    // (loud direction, no puller), and this card does not reverse it — see `declinedIn`.
    for (const d of declinedIn(text.slice(m.index, m.index + window.length), m.index, inTypeDecl)) {
      if (d.key !== 'client') continue;
      claimed.add(d.index);
      declined.push({ key: 'client', line: lineAt(d.index), text: d.text });
    }
  }
  // `route:` is counted file-wide, because a declined row has no window to be found in —
  // which is precisely why it was invisible. Type members are skipped here on the same list
  // (#10901): a leading entry interface sits in no row window at all, so this is the call
  // site the card's own fixture arrives through.
  for (const d of declinedIn(text, 0, inTypeDecl)) {
    if (d.key === 'route') declined.push({ key: 'route', line: lineAt(d.index), text: d.text });
  }
  // …and the values no quote-keyed scan can see at all (#10500). File-wide for the same
  // reason: a row whose `route:` is not a literal has no window either, which is exactly
  // why it used to leave the population without a verdict of any kind.
  for (const d of unreadableIn(text)) {
    declined.push({ key: d.key, line: lineAt(d.index), text: d.text });
  }
  // …and the `client:` values that ARE spelled the way this recognizer reads but that no row
  // window claimed (#10636) — the residue the line above leaves, because a row whose `route:`
  // was declined or unreadable never became a row, and nothing declined the `client:` sitting
  // on it. Neither term of the denominator below could see those, so the file declared a value
  // that left the count without a word.
  for (const d of unclaimedClientsIn(text, claimed)) {
    declined.push({ key: 'client', line: lineAt(d.index), text: d.text });
  }
  // THE DENOMINATOR. Leads the recognizer's own regex would start on, plus the ones it
  // declined — so `routesDeclared - rows.length` is every declared row value this parse did
  // not turn into a row, whatever the reason: a declined quote, or the `route: ''` that its
  // `[^']+` also drops without a word.
  //
  // BOTH RATIOS ARE NOW THE SAME RATIO, which is the property #10636 was about. Numerator:
  // values this parse READ — rows assembled, and of those the ones that carry a binding.
  // Denominator: values the FILE DECLARES — every `route:` lead in any spelling, and every
  // `client:` a row bound or the sweep above named, which after #10636 is every `client:`
  // declared in code position (type members excluded, prose and string payloads masked).
  // ⛔ The two sides must move together. A denominator widened past what its numerator can
  // ever count trades an undercount for a permanently red ratio — which is why the sweep
  // pushes to `declined` (a value NAMED as unread) instead of only bumping a number.
  //
  // The first term reads `code`, not `text`, for the recognizer's reason (#10683): a
  // denominator that counted prose-quoted leads while the numerator no longer read them
  // would turn this migration into a permanently red ratio on the very files it fixed.
  // Both terms move together, which is the invariant the block above insists on.
  //
  // …and it skips TYPE MEMBERS on the same list the loop above does (#10793). Both terms
  // move together or the partition `rows + declined === routesDeclared` breaks: a member
  // counted here but skipped there would read as a row this parse declined to read, and
  // fire a PARTIAL-read verdict on an accurate ledger.
  const routesDeclared = [...code.matchAll(new RegExp(declLead('route') + "'", 'g'))].filter((d) => !inTypeDecl(d.index)).length
    + declined.filter((d) => d.key === 'route').length;
  const clientsDeclared = rows.filter((r) => r.client).length + declined.filter((d) => d.key === 'client').length;
  declined.sort((a, b) => a.line - b.line || a.key.localeCompare(b.key));
  // THE REPORTING HALF (#10683). The mask closes the phantom-row hole by making a
  // prose-quoted lead produce NOTHING — and "produces nothing" is the silence every other
  // report in this file exists to break. So the DIFFERENCE THE MASK MADE is itself named:
  // a lead spelled exactly the way the recognizer reads, sitting where the mask says code
  // is not. That is the card's own third direction, kept as the cheap half of the second.
  //
  // ⛔ A REPORT, NEVER A VERDICT, and it enters NEITHER ratio — it is not pushed to
  // `declined`, so it moves no denominator and fires no `brokenScan`. A comment explaining
  // a retired row by quoting its old path is legitimate prose, and reddening CI over it
  // would be exactly the false red the #9747 family's ruling declines, the same reason the
  // 45-of-221 reach ratio is reported rather than gated. It is here so the NEXT hole of
  // this shape is loud instead of silent. Measured across all seven live ledgers: 0.
  const codeLeads = new Set([...code.matchAll(new RegExp(declLead('(?:route|client)') + "'", 'g'))].map((d) => d.index));
  const outsideCode = [...text.matchAll(new RegExp(declLead('(route|client)') + "'", 'g'))]
    .filter((d) => !codeLeads.has(d.index))
    .map((d) => {
      // The LEAD and its VALUE are matched in two passes, not one. A single expression that
      // swallowed the value would consume the rest of the line with it, and one prose line
      // mentioning BOTH keys — the exact shape that mints a client-bound phantom — would
      // report as one finding instead of two (measured: it did, until this was split).
      // Trimmed back to the closing quote in JS rather than matched to it, for `declinedIn`'s
      // reason: an unterminated literal must still NAME itself instead of dropping out.
      const body = text.slice(d.index + d[0].length).split('\n')[0];
      const end = body.indexOf("'");
      return { key: d[1], line: lineAt(d.index), text: `${d[1]}: '${end === -1 ? body.slice(0, 60) : body.slice(0, end)}'` };
    });
  return { rows, declined, routesDeclared, clientsDeclared, outsideCode };
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

    // -- the two classes #11857 measured as false-positive registrars ----------
    // Both are REAL repo paths, and both are here as the INSTANCES that exposed a
    // predicate hole. The arms they pin are written over the CONVENTION, so the
    // synthetic cases beneath them carry just as much of the pin.
    ['packages/qa/dogfood/test/fixtures/endpoint-policy-fixture.ts', true, 'a fixture under a non-underscore test/fixtures/'],
    ['packages/spec/src/benchmark.bench.ts', true, 'a .bench.ts benchmark'],
    ['packages/objectql/src/engine-data-events.bench.ts', true, 'the OTHER .bench.ts - the arm is the infix, not the basename'],
    ['packages/cli/test/helpers/serve-process.ts', true, 'a helper nested under test/ carrying no test infix of its own'],
    ['packages/client/tests/helpers/harness.ts', true, 'the tests/ plural spelling of the directory arm'],
    ['packages/qa/dogfood/test/armed.ts', true, 'a bare .ts sitting directly in test/'],

    // The over-widening side. An exclusion that grows silently drops real
    // implementation changes - the failure this self-test's docblock names FIRST -
    // so the classes deliberately left ADMITTED are pinned admitted, not left to
    // drift into the exclusion later. See `isTestFile`'s docblock for why each stays.
    ['packages/spec/src/ui/door-reachability.testkit.ts', false, 'a .testkit.ts is shipped harness code, not a test file'],
    ['packages/lint/src/showcase-shape.fixtures.ts', false, 'a .fixtures.ts infix is NOT the __fixtures__ directory arm'],
    ['packages/objectql/src/datasource-def-credentials-ref.pin.ts', false, 'a .pin.ts is implementation to this predicate'],
    ['packages/foo/src/testkit/harness.ts', false, 'testkit/ is not test/ - the directory arm needs the WHOLE segment'],
    ['packages/foo/src/testing/helper.ts', false, 'testing/ is not test/ either'],
    ['packages/foo/src/bench-utils.ts', false, 'bench without the dotted infix is implementation'],
    ['packages/foo/src/latest.benchmark.ts', false, 'a .benchmark. infix is not .bench.'],
  ];
  for (const [path, want, label] of testFileCases) check('isTestFile', label, path, want, isTestFile(path));

  // ── the ADR-0049 ledger-entry exclusion (#12966) ─────────────────────────
  //
  // ⛔ BOTH SEGMENTS, WHOLE (the failure mode this predicate is one step away from):
  // `migrations/` alone would swallow the migration RUNNERS, which are ordinary
  // implementation and one of which could legitimately be a registrar; `entries/` alone
  // is a common enough segment to be a blunt instrument. The pair is what names the ADR-0049
  // ledger and nothing else.
  const ledgerEntryCases = [
    ['packages/spec/src/migrations/entries/retired-keys/18.kernel__Manifest__contributes.routes.ts', true,
      'a retired-keys entry whose basename ends in the whole token `routes`'],
    ['packages/spec/src/migrations/entries/semantic/18.plugin-manifest-contributes-routes-retired.ts', true,
      'a semantic entry carrying `routes` as an interior whole token'],
    ['packages/spec/src/migrations/entries/retired-defs/9.some-def.ts', true,
      'any other entry in the tree — the cut is the DIRECTORY, not the spelling'],
    ['packages/spec/src/migrations/runner-route.ts', false,
      'a migrations/ file OUTSIDE entries/ is untouched — one segment is not the class'],
    ['packages/spec/src/migrations/entries.ts', false,
      'a FILE named entries.ts is not the entries/ directory — the segment must be whole'],
    ['packages/foo/src/entries/route-table.ts', false,
      'a bare entries/ directory outside migrations/ is not the class either'],
  ];
  for (const [path, want, label] of ledgerEntryCases)
    check('isMigrationLedgerEntry', label, path, want, isMigrationLedgerEntry(path));

  // ── the WALK's admission decision, against a fake tree (#11866) ──────────────
  //
  // The cases above pin the PREDICATE, and the predicate was never wrong: every one of
  // them passes a full path, which is what `isTestFile` is defined over. What was wrong
  // was the CALL SITE — `scanRouteSurface`'s walk handed it `e.name`, a basename, so the
  // three directory arms could not match. A green predicate beside a broken caller is the
  // shape these cases could not see, so this block walks `walkSourceFiles` itself.
  //
  // ⛔ NON-VACUITY IS THE ENTIRE POINT OF THESE FIXTURES, and it is why none of them is a
  // real repo path. The live population is ZERO — measured on `d63b01436`, the three files
  // under a test directory that the old walk admitted match neither `REGISTRAR_FILE_RE`
  // nor `LEDGER_FILE_RE` and declare no `path:`, so `--bridge-coverage` is byte-identical
  // across this fix. A pin built from real paths would therefore have passed just as
  // green with the bug in place and pinned NOTHING. Every fixture below is instead a file
  // the BASENAME test admits and the PATH test excludes: `x-route.ts` carries no `.test.`
  // / `.spec.` infix, so under the old call site it was walked, matched
  // `REGISTRAR_FILE_RE`, and a test double contributed production route tails — the exact
  // failure this is here to keep out. Verified RED against the pre-fix line: 4 registrar
  // files and 6 source files, against the 1 and 2 asserted here.
  const fakeSrcTree = [
    'packages/foo/src/engine.ts',                        // plain implementation
    'packages/foo/src/real-route.ts',                    // a genuine registrar — must survive
    'packages/foo/src/engine.test.ts',                   // already excluded by the file arm
    'packages/foo/src/__tests__/x-route.ts',             // ⭐ registrar-NAMED test double
    'packages/foo/src/__tests__/helper.ts',              // ceiling population only
    'packages/foo/src/__mocks__/fake-server.ts',         // the `-server` alternative
    'packages/foo/src/__fixtures__/stub-route-ledger.ts',// LEDGER_FILE_RE
    'packages/foo/test/fixtures/stub-route.ts',          // #11857 registrar-NAMED, non-underscore test/
    'packages/foo/src/engine.bench.ts',                  // #11857 benchmark
    'packages/foo/node_modules/dep/route.ts',            // pruned directory
    'packages/foo/dist/route.ts',                        // pruned directory
    'packages/foo/README.md',                            // not a .ts file
    // #12966. NON-VACUOUS BY CONSTRUCTION, like every fixture above it: neither entry
    // carries a test infix or lives under a test directory, so BOTH are walked under the
    // previous line and BOTH matched `REGISTRAR_FILE_RE` — an ADR-0049 tombstone
    // recording that `contributes.routes` was DELETED was being counted as a file that
    // registers routes. Reverting the exclusion turns the two equality checks below red.
    'packages/foo/src/migrations/entries/retired-keys/18.kernel__Manifest__contributes.routes.ts',
    'packages/foo/src/migrations/entries/semantic/18.plugin-manifest-contributes-routes-retired.ts',
    'packages/foo/src/migrations/entries/semantic/18.plain-rename.ts',  // ceiling population only
    // ⭐ THE OVER-REACH CONTROL, and the reason the predicate needs both segments: a
    // migrations/ file that is NOT under entries/ is ordinary implementation and must
    // still reach the registrar list. Without it the exclusion could widen to all of
    // `migrations/` and every check here would stay green.
    'packages/foo/src/migrations/runner-route.ts',
  ];
  const fakeRoot = '/repo';
  const fakeDirs = new Map();
  for (const rel of fakeSrcTree) {
    const segs = rel.split('/');
    for (let i = 0; i < segs.length; i++) {
      const dir = join(fakeRoot, ...segs.slice(0, i));
      let kids = fakeDirs.get(dir);
      if (!kids) fakeDirs.set(dir, (kids = new Map()));
      kids.set(segs[i], i === segs.length - 1);
    }
  }
  // Throws on an unknown directory exactly as `readdirSync` does, so the walk's own
  // `try`/`catch` is exercised rather than bypassed by a forgiving fake.
  const fakeReadDir = (dir) => {
    const kids = fakeDirs.get(dir);
    if (!kids) throw new Error(`ENOENT: no such fake directory, ${dir}`);
    return [...kids].map(([name, isFile]) => ({ name, isFile: () => isFile, isDirectory: () => !isFile }));
  };
  const walked = walkSourceFiles(fakeRoot, fakeReadDir);
  const sorted = (a) => [...a].sort().join(' | ');
  check('walkSourceFiles', 'a registrar-NAMED file under __tests__/ is NOT a registrar — the walk tests the path',
    'registrarFiles', 'packages/foo/src/migrations/runner-route.ts | packages/foo/src/real-route.ts', sorted(walked.registrarFiles));
  check('walkSourceFiles', 'and the three test directories contribute nothing to the CEILING population either',
    'sourceFiles', 'packages/foo/src/engine.ts | packages/foo/src/migrations/runner-route.ts | packages/foo/src/real-route.ts', sorted(walked.sourceFiles));
  // Per-fixture, so a regression NAMES the arm that came back rather than only the totals.
  const excludedFixtures = [
    ['packages/foo/src/__tests__/x-route.ts', 'a __tests__/ file matching REGISTRAR_FILE_RE'],
    ['packages/foo/src/__mocks__/fake-server.ts', 'a __mocks__/ file matching the `-server` alternative'],
    ['packages/foo/src/__fixtures__/stub-route-ledger.ts', 'a __fixtures__/ file matching LEDGER_FILE_RE'],
    ['packages/foo/src/__tests__/helper.ts', 'a __tests__/ helper with no registrar name'],
    // #11857. NON-VACUOUS BY CONSTRUCTION, exactly as the four above are: neither
    // carries a .test. / .spec. infix, so under the PREVIOUS predicate both were
    // walked - `stub-route.ts` then matched `REGISTRAR_FILE_RE` and a test fixture
    // contributed production route tails, and `engine.bench.ts` entered the ceiling
    // population. Re-admitting either arm breaks the two equality checks above, and
    // these two rows name WHICH arm came back.
    ['packages/foo/test/fixtures/stub-route.ts', 'a non-underscore test/fixtures/ file matching REGISTRAR_FILE_RE'],
    ['packages/foo/src/engine.bench.ts', 'a .bench.ts benchmark'],
    // #12966, one row per entry so a regression NAMES which one came back.
    ['packages/foo/src/migrations/entries/retired-keys/18.kernel__Manifest__contributes.routes.ts',
      'an ADR-0049 retired-keys tombstone matching REGISTRAR_FILE_RE'],
    ['packages/foo/src/migrations/entries/semantic/18.plugin-manifest-contributes-routes-retired.ts',
      'an ADR-0049 semantic entry matching REGISTRAR_FILE_RE'],
    ['packages/foo/src/migrations/entries/semantic/18.plain-rename.ts',
      'a ledger entry with no registrar name — excluded from the CEILING too'],
  ];
  for (const [rel, label] of excludedFixtures) {
    check('walkSourceFiles', `${label} is walked at all`, rel, false, walked.sourceFiles.includes(rel));
    check('walkSourceFiles', `${label} reaches the registrar list`, rel, false, walked.registrarFiles.includes(rel));
  }
  check('walkSourceFiles', 'a genuine registrar still survives the walk', 'packages/foo/src/real-route.ts',
    true, walked.registrarFiles.includes('packages/foo/src/real-route.ts'));
  check('walkSourceFiles', 'a migrations/ registrar OUTSIDE entries/ survives — the exclusion is the DIRECTORY class, not the word',
    'packages/foo/src/migrations/runner-route.ts', true,
    walked.registrarFiles.includes('packages/foo/src/migrations/runner-route.ts'));
  check('walkSourceFiles', 'a .test.ts file is still excluded by the FILE arm', 'packages/foo/src/engine.test.ts',
    false, walked.sourceFiles.includes('packages/foo/src/engine.test.ts'));
  check('walkSourceFiles', 'node_modules/ and dist/ are still pruned', 'packages/foo/{node_modules,dist}/route.ts',
    0, walked.sourceFiles.filter((f) => /(^|\/)(node_modules|dist)\//.test(f)).length);
  check('walkSourceFiles', 'a non-.ts file is not walked', 'packages/foo/README.md',
    false, walked.sourceFiles.includes('packages/foo/README.md'));

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
  const anchorsAt = (src, lineNo) => symbolAnchorsFromSource(src, [lineNo]).names;
  const bridgeableAt = (src, lineNo) => symbolAnchorsFromSource(src, [lineNo]).bridgeable;
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
  const { rows: ledger, ...ledgerRead } = parseLedgerSource(ledgerSource);
  check('parseLedgerSource', 'every row is read', 'row count', 3, ledger.length);
  check('parseLedgerSource', 'the audit row binds its client method', 'meta.getAudit', 'meta.getAudit', ledger.find((r) => r.route.endsWith('/audit'))?.client);
  check('parseLedgerSource', 'a server-only row claims no client', 'null client', null, ledger.find((r) => r.route.endsWith('/health'))?.client);
  check('parseLedgerSource', 'a row never inherits the NEXT row\'s client', 'references', 'meta.getReferences', ledger[0].client);
  // THE POSITIVE CONTROL for every zero below (#9896). A fixture spelled the way the
  // recognizer reads must report NOTHING declined AND a denominator equal to what it read —
  // a zero from a counter that cannot fire is not evidence, and the partial fixture further
  // down is the other half of the pair that makes this zero mean something.
  check('parseLedgerSource', 'an all-single-quoted ledger declines nothing', 'declined', 0, ledgerRead.declined.length);
  check('parseLedgerSource', 'and its denominator equals what was read', '3 route / 2 client',
    '3 route / 2 client', `${ledgerRead.routesDeclared} route / ${ledgerRead.clientsDeclared} client`);
  // Counted off the fixture SOURCE, not off the parse: a denominator that agrees with the
  // numerator proves nothing on its own — both come from the same reader. This is the one
  // count in the pair that a broken reader cannot move.
  check('parseLedgerSource', 'and it equals every `client:` the source writes', 'partition',
    ledgerSource.match(/client\s*:/g).length, ledgerRead.clientsDeclared);

  // ---- A PARTIAL LEDGER READ MUST SAY SO (#9896) ----------------------------
  // The negative half of the pair above: the same recognizer over a ledger carrying one
  // backtick-quoted `route:`, one double-quoted `route:` and one backtick-quoted `client:`.
  // Every one of those is ordinary TypeScript; the template-literal spellings are the
  // realistic ones, because the repo's formatter rewrites double quotes back to single and
  // leaves a template literal alone.
  const partialSource = [
    'export const REST_ROUTE_LEDGER = [',
    "  { route: 'GET /api/v1/meta/:type/:name/references', family: 'metadata', disposition: 'sdk', client: 'meta.getReferences' },",
    '  { route: `GET /api/v1/i18n/locales`, family: \'i18n\', disposition: \'sdk\', client: \'i18n.getLocales\' },',
    '  { route: "GET /api/v1/health", family: \'ops\', disposition: \'server-only\' },',
    '  { route: \'GET /api/v1/meta/:type/:name/audit\', family: \'metadata\', disposition: \'sdk\', client: `meta.getAudit` },',
    '];',
  ].join('\n');
  const partial = parseLedgerSource(partialSource);
  check('parseLedgerSource', 'the narrow population is UNCHANGED — this reports, it does not widen', 'row count', 2, partial.rows.length);
  check('parseLedgerSource', 'a backtick-quoted `client:` costs the row its binding, not its seat', 'null client',
    null, partial.rows.find((r) => r.route.endsWith('/audit'))?.client);
  check('parseLedgerSource', 'every unread spelling is counted — 2 route, 2 client', 'declined', 4, partial.declined.length);
  check('parseLedgerSource', 'the denominator is what the FILE declared, not what was read', '4 route / 3 client',
    '4 route / 3 client', `${partial.routesDeclared} route / ${partial.clientsDeclared} client`);
  // ⚠️ That `3` read `2` until #10636, and the missing one is this fixture's own line 3: the
  // backtick-routed row declares `client: 'i18n.getLocales'` in the very quote the recognizer
  // reads, on a row that never became a row — so BOTH row-relative terms of the denominator
  // missed it, and the file declared a value that left the count without a word. It is now
  // counted and NAMED, billed to no row, which is the distinction the window rule in
  // `parseLedgerSource` is actually about. The client column therefore answers the same
  // question the route column does: of everything the FILE declares, how much was read.
  check('parseLedgerSource', 'the residue is named on its own line, and says why it is there', 'line 3 unclaimed client',
    true, partial.declined.some((d) => d.key === 'client' && d.line === 3
      && d.text === "client: 'i18n.getLocales' (no row read it)"));
  // The partition for the client column, the same shape the `route:` one below has: every
  // `client:` the fixture writes — in any quote, on a row or not — is either read as a
  // binding or named as unread. Off the SOURCE, so it cannot agree with a broken counter.
  check('parseLedgerSource', 'read + named accounts for every declared `client:`', 'partition',
    partialSource.match(/client\s*:/g).length,
    partial.rows.filter((r) => r.client).length + partial.declined.filter((d) => d.key === 'client').length);
  check('parseLedgerSource', 'each declined entry NAMES itself, with its line', 'line 3 backtick route',
    true, partial.declined.some((d) => d.key === 'route' && d.line === 3 && d.text.includes('GET /api/v1/i18n/locales')));
  check('parseLedgerSource', 'the double-quoted route is named too', 'line 4 double-quoted route',
    true, partial.declined.some((d) => d.key === 'route' && d.line === 4 && d.text.includes('GET /api/v1/health')));
  check('parseLedgerSource', 'and the declined client, on its own line', 'line 5 backtick client',
    true, partial.declined.some((d) => d.key === 'client' && d.line === 5 && d.text.includes('meta.getAudit')));
  // The partition — the reason a shared spelling constant is not needed and would not help.
  // Every declared `route:`, in ANY spelling, is either read as a row or declined; a future
  // edit that lets one fall between the two fails HERE rather than in production silence.
  check('parseLedgerSource', 'read + declined accounts for every declared `route:`', 'partition',
    partial.routesDeclared, partial.rows.length + partial.declined.filter((d) => d.key === 'route').length);

  const partialCov = bridgeCoverageFrom([{ file: 'd-route-ledger.ts', ...partial }], ['/:type/:name/references']);
  check('bridgeCoverageFrom', 'a partial read is a VERDICT, not a smaller number', 'brokenScan',
    true, partialCov.brokenScan.some((v) => v.includes('PARTIAL read')));
  check('bridgeCoverageFrom', 'and the verdict carries the numerator', '2 of 4',
    true, partialCov.brokenScan.some((v) => v.includes('2 of 4 declared `route:`')));
  check('bridgeCoverageFrom', 'and NAMES the entry it could not read', 'i18n/locales',
    true, partialCov.brokenScan.some((v) => v.includes('GET /api/v1/i18n/locales')));
  // ⛔ THE POINT. The pre-existing guard is `rowsParsed === 0` — all-or-nothing — so it is
  // silent on exactly this file. If this ever starts passing, the partial case has been
  // folded into the zero case and the pin above is measuring the wrong thing.
  check('bridgeCoverageFrom', 'the `parsed 0 rows` guard is blind to this by construction', 'not fired',
    false, partialCov.brokenScan.some((v) => v.includes('parsed 0 rows')));

  // ---- why the verdict keys on the SPELLING and not on a shortfall ----------
  // A declined row does not close the PREVIOUS row's window — the window is delimited by
  // the same single-quote-only lead — so a server-only row INHERITS the declined row's
  // client. Characterised, not endorsed: `GET /api/v1/docs` is server-only and must not
  // claim `meta.getTypes`. Measured on the real tree at a718ee3dd, backtick-quoting
  // `GET /api/v1/meta` in `rest-route-ledger.ts` did exactly this, and `clientRows` stayed
  // 221 — a count comparison cannot see it, which is why `declined` is what fires.
  const stealSource = [
    'export const REST_ROUTE_LEDGER = [',
    "  { route: 'GET /api/v1/docs', family: 'ops', disposition: 'server-only' },",
    '  { route: `GET /api/v1/meta`, family: \'metadata\', disposition: \'sdk\', client: \'meta.getTypes\' },',
    "  { route: 'GET /api/v1/health', family: 'ops', disposition: 'server-only' },",
    '];',
  ].join('\n');
  const steal = parseLedgerSource(stealSource);
  const clean = parseLedgerSource(stealSource.replace('`GET /api/v1/meta`', "'GET /api/v1/meta'"));
  check('parseLedgerSource', 'a declined row leaves its client to the row BEFORE it', 'mis-bound',
    'meta.getTypes', steal.rows.find((r) => r.route.endsWith('/docs'))?.client);
  const stealCov = bridgeCoverageFrom([{ file: 'e-route-ledger.ts', ...steal }], ['/api/v1/docs']);
  const cleanCov = bridgeCoverageFrom([{ file: 'e-route-ledger.ts', ...clean }], ['/api/v1/docs']);
  check('bridgeCoverageFrom', 'the client-bound COUNT is identical either way — the number is blind',
    'clientRows', cleanCov.clientRows, stealCov.clientRows);
  check('bridgeCoverageFrom', 'yet the declined spelling still carries the verdict', 'brokenScan',
    true, stealCov.brokenScan.some((v) => v.includes('PARTIAL read')));
  check('bridgeCoverageFrom', 'and the correctly spelled twin carries none', 'brokenScan', 0, cleanCov.brokenScan.length);

  // ---- A NON-LITERAL `route:` IS A VERDICT TOO (#10500) ---------------------
  // #9896 made the QUOTED spellings loud and declared this one out of scope: a value that
  // is not a string literal at all (`route: ROUTES.health`, `route: BASE + '/x'`) was read
  // by neither the recognizer nor the counter, so the row left the population with no
  // verdict — the same silence, one spelling further out. The quote requirement was kept
  // because it was the only EXACT discriminator against the `route: string;` member every
  // ledger's entry interface declares. `unreadableIn` has a second exact one — the member
  // is inside a type declaration and a row never is — so the counter can widen without
  // billing that member as a row. Both directions are pinned here, because counting the
  // interface member is precisely how a fix here goes wrong.
  const nonLiteralSource = [
    'export interface Entry { route: string; client: string }',
    'export const L = [',
    '  { route: ROUTES.health, family: \'ops\', disposition: \'server-only\' },',
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
  ].join('\n');
  const nonLiteral = parseLedgerSource(nonLiteralSource);
  check('parseLedgerSource', 'a non-literal `route:` is COUNTED now — read + unread accounts for every row',
    'declared', '2 route / 1 client / 1 declined',
    `${nonLiteral.routesDeclared} route / ${nonLiteral.clientsDeclared} client / ${nonLiteral.declined.length} declined`);
  check('parseLedgerSource', 'the narrow population is UNCHANGED — this reports, it does not widen', 'row count',
    1, nonLiteral.rows.length);
  check('parseLedgerSource', 'and the unread row NAMES itself, with its line', 'line 3 ROUTES.health',
    'line 3 route: ROUTES.health',
    nonLiteral.declined.map((d) => `line ${d.line} ${d.text}`).join(' | '));

  // THE NEGATIVE CONTROL, asserted positively rather than by the absence of a failure: the
  // `route: string;` / `client: string` members on line 1 are TYPES, not rows. Two ways to
  // say it, because "0 extra declined" alone would also pass if the scan had stopped working.
  check('parseLedgerSource', 'the `route: string;` interface member is NOT billed as an unread row',
    'no member in the declined list', false,
    nonLiteral.declined.some((d) => /\bstring\b/.test(d.text)));
  const noInterface = parseLedgerSource(nonLiteralSource.split('\n').slice(1).join('\n'));
  check('parseLedgerSource', 'and deleting the interface changes NOTHING — it contributed no count',
    'declared', `${noInterface.routesDeclared} route / ${noInterface.declined.length} declined`,
    `${nonLiteral.routesDeclared} route / ${nonLiteral.declined.length} declined`);

  // The verdict actually reaches the surface a reader sees.
  const nonLiteralCov = bridgeCoverageFrom([{ file: 'f-route-ledger.ts', ...nonLiteral }], ['/api/v1/meta']);
  check('bridgeCoverageFrom', 'an unreadable row is a VERDICT, not a smaller number', 'brokenScan',
    true, nonLiteralCov.brokenScan.some((v) => v.includes('PARTIAL read') && v.includes('ROUTES.health')));

  // …and the correctly spelled twin still carries none, so this cannot false-red an
  // accurate ledger — the failure mode a naive "count every `route:`" would have had on
  // all seven of today's ledgers at once.
  const literalTwin = parseLedgerSource(nonLiteralSource.replace('ROUTES.health', "'GET /api/v1/health'"));
  check('parseLedgerSource', 'the single-quoted twin declines nothing', 'declined', 0, literalTwin.declined.length);
  check('bridgeCoverageFrom', 'and carries no verdict', 'brokenScan', 0,
    bridgeCoverageFrom([{ file: 'f-route-ledger.ts', ...literalTwin }], ['/api/v1/meta', '/api/v1/health']).brokenScan.length);

  // A non-literal `client:` is the same defect on the other key: the row keeps its seat and
  // loses its binding, which no count comparison can see.
  const nonLiteralClient = parseLedgerSource([
    'export interface Entry { route: string; client: string }',
    'export const L = [',
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: CLIENTS.getTypes },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a non-literal `client:` costs the row its binding, and is COUNTED',
    '1 route / 1 client / 1 declined', '1 route / 1 client / 1 declined',
    `${nonLiteralClient.routesDeclared} route / ${nonLiteralClient.clientsDeclared} client / ${nonLiteralClient.declined.length} declined`);
  check('parseLedgerSource', 'and the declined entry is the CLIENT one', 'client', 'client',
    nonLiteralClient.declined[0]?.key);

  // ---- A DECLARED `client:` ON A ROW THAT WAS NEVER ASSEMBLED (#10636) ------
  // The residue #10500 left. Both terms of `clientsDeclared` were row-relative, so a
  // CORRECTLY single-quoted `client:` on a row whose `route:` could not be read was in
  // neither: its row never became a row, and its own spelling is the one the recognizer
  // reads, so nothing declined it. Measured on `ba2d8d4730` — this exact shape, appended to
  // `i18n-route-ledger.ts`, reported `3 of 3` declared `client:` values on a file declaring
  // four. The row DOES land in a verdict after #10500 (its `route:` is named as unread), so
  // what was wrong here is a sub-count, not a silence — and a denominator that omits a
  // declaration renders a partial read as more complete than it is.
  const orphanSource = [
    // The reject side lives on line 1, in the spelling that makes it hostile: a
    // literal-union TYPE member opens with the very quote this counter reads, so the quote
    // test alone would swallow it and `typeDeclRegions` is what keeps it out.
    "export interface Entry { route: string; client: 'i18n.getLocales' | 'i18n.getPlurals' }",
    'export const L = [',
    "  { route: 'GET /api/v1/i18n/locales', family: 'i18n', disposition: 'sdk', client: 'i18n.getLocales' },",
    "  { route: I18N_BASE + '/plurals', family: 'i18n', disposition: 'sdk', client: 'i18n.getPlurals' },",
    '];',
  ].join('\n');
  const orphan = parseLedgerSource(orphanSource);
  check('parseLedgerSource', 'a declared `client:` whose row was never assembled is COUNTED',
    'declared', '2 route / 2 client / 2 declined',
    `${orphan.routesDeclared} route / ${orphan.clientsDeclared} client / ${orphan.declined.length} declined`);
  check('parseLedgerSource', 'the narrow population is UNCHANGED — this reports, it does not widen', 'row count',
    1, orphan.rows.length);
  check('parseLedgerSource', 'and the value NAMES itself, with its line and why it is there', 'line 4 i18n.getPlurals',
    "line 4 client: 'i18n.getPlurals' (no row read it)",
    orphan.declined.filter((d) => d.key === 'client').map((d) => `line ${d.line} ${d.text}`).join(' | '));
  // THE REJECT SIDE, asserted positively (#10500's discipline, and the way a fix here goes
  // wrong). Two ways to say it, because "no extra declined" alone would also pass if the
  // sweep had stopped working altogether.
  check('parseLedgerSource', 'a literal-union `client:` TYPE member is not billed as a declaration',
    'no line-1 member in the declined list', false, orphan.declined.some((d) => d.line === 1));
  const orphanNoInterface = parseLedgerSource(orphanSource.split('\n').slice(1).join('\n'));
  check('parseLedgerSource', 'and deleting the interface changes NOTHING — it contributed no count',
    'declared', '2 route / 2 client / 2 declined',
    `${orphanNoInterface.routesDeclared} route / ${orphanNoInterface.clientsDeclared} client / ${orphanNoInterface.declined.length} declined`);
  // Prose and string payloads are not declarations here either — the sweep reads CODE-ONLY
  // source, which is exactly what makes a file-wide `client:` count safe when the row-window
  // comment in `parseLedgerSource` argues it is not.
  const orphanProse = parseLedgerSource([
    "// The row whose client: 'i18n.getPlurals' we discussed is not declared anywhere.",
    "const msg = 'client: i18n.getPlurals';",
    'export const L = [',
    "  { route: 'GET /api/v1/i18n/locales', family: 'i18n', disposition: 'sdk', client: 'i18n.getLocales' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a `client:` in prose or a string payload is not a declaration', 'declined',
    0, orphanProse.declined.length);
  check('parseLedgerSource', 'and never reaches the denominator', '1 route / 1 client',
    '1 route / 1 client', `${orphanProse.routesDeclared} route / ${orphanProse.clientsDeclared} client`);
  // A value a row window DID claim is not billed a second time — including the MIS-BOUND one
  // the steal fixture above characterises. That one is read, wrongly, and the `route:` arm
  // carries its verdict; counting it again here would report it as unread as well.
  check('parseLedgerSource', 'a claimed `client:` is never counted twice', 'claimed once',
    '1 client / 0 unread client',
    `${steal.clientsDeclared} client / ${steal.declined.filter((d) => d.key === 'client').length} unread client`);
  // THE SAME RESIDUE ON THE OTHER QUOTES, closed by the same sweep. A `client:` in a
  // spelling the recognizer declines is only ever looked for INSIDE a row window, so one
  // sitting before the first assembled row — or in the gap a truncated window leaves — was
  // missed for the same reason the single-quoted one was. The sweep keys on "no row claimed
  // it" rather than on the quote, so it does not have to know which of the two it is looking
  // at, and a third spelling arriving tomorrow needs no third rule.
  const orphanTail = parseLedgerSource([
    'export const L = [',
    "  { route: I18N_BASE + '/plurals', family: 'i18n', disposition: 'sdk', client: `i18n.getPlurals` },",
    "  { route: 'GET /api/v1/i18n/locales', family: 'i18n', disposition: 'sdk', client: 'i18n.getLocales' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a DECLINED `client:` outside every row window is counted too', 'declared',
    '2 route / 2 client / 2 declined',
    `${orphanTail.routesDeclared} route / ${orphanTail.clientsDeclared} client / ${orphanTail.declined.length} declined`);
  check('parseLedgerSource', 'and it names itself, on its own line', 'line 2 backtick client', true,
    orphanTail.declined.some((d) => d.key === 'client' && d.line === 2 && d.text.includes('i18n.getPlurals')));
  // The verdict a reader actually sees carries both halves.
  const orphanCov = bridgeCoverageFrom([{ file: 'g-route-ledger.ts', ...orphan }], ['/api/v1/i18n/locales']);
  check('bridgeCoverageFrom', 'the verdict counts the client column over what the FILE declares', '1 of 2',
    true, orphanCov.brokenScan.some((v) => v.includes('1 of 2 declared `client:`')));
  check('bridgeCoverageFrom', 'and NAMES the declared value no row read', 'i18n.getPlurals',
    true, orphanCov.brokenScan.some((v) => v.includes("client: 'i18n.getPlurals' (no row read it)")));
  // …and the correctly spelled twin still carries none: this cannot false-red an accurate
  // ledger, which is the failure mode a naive file-wide `client:` count would have had on
  // all seven of today's ledgers at once.
  const orphanTwin = parseLedgerSource(orphanSource.replace("I18N_BASE + '/plurals'", "'GET /api/v1/i18n/plurals'"));
  check('parseLedgerSource', 'the single-quoted twin declares the same two and declines nothing',
    'declared', '2 route / 2 client / 0 declined',
    `${orphanTwin.routesDeclared} route / ${orphanTwin.clientsDeclared} client / ${orphanTwin.declined.length} declined`);
  check('bridgeCoverageFrom', 'and carries no verdict', 'brokenScan', 0,
    bridgeCoverageFrom([{ file: 'g-route-ledger.ts', ...orphanTwin }], ['/api/v1/i18n/locales', '/api/v1/i18n/plurals']).brokenScan.length);

  // Comments and string payloads are not declarations. `runtime/src/route-ledger.ts` carries
  // the live instance of the first ("It never named a mounted route: the branch"), which is
  // why a raw `/route\s*:/` scan would red on an accurate ledger.
  const prose = parseLedgerSource([
    '// It never named a mounted route: the branch was dead.',
    "const msg = 'route: not a declaration';",
    'export const L = [',
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'prose and string payloads are not unread rows', 'declined', 0, prose.declined.length);
  check('parseLedgerSource', 'and a sentence that never quotes a value names nothing either', 'outsideCode',
    0, prose.outsideCode.length);

  // …AND THEY ARE NOT READ ROWS EITHER (#10683). The check above is one-sided: it pins what
  // the DECLINED report says about prose and says nothing at all about `rows`. The
  // recognizer read RAW text, so a comment one quote further along than the live near-miss
  // in `runtime/src/route-ledger.ts` did not mis-count — it became a ROW, and the
  // partial-read verdict could not see it, because that verdict is keyed on the gap between
  // `rows` and `routesDeclared` and both terms read raw, so both moved together.
  //
  // ⚠️ PINNED IN BOTH DIRECTIONS, deliberately. A mask that reached the comment case by
  // breaking the CODE case — reading the blanked span as the row's value, say — would pass
  // a test that only asserted the phantom is gone, and would trade a phantom row for 259
  // corrupted ones. So every case below asserts what the mask DROPPED and what it KEPT,
  // value included.
  const phantom = parseLedgerSource([
    "// A row we removed used to read route: 'GET /api/v1/gone' before #1234.",
    'export const L = [',
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a `route:` quoted in a COMMENT is not a row', 'row count', 1, phantom.rows.length);
  check('parseLedgerSource', 'and the row in CODE still is — carrying its VALUE, not the mask\'s blanks', 'row',
    'GET /api/v1/meta → meta.getTypes', `${phantom.rows[0]?.route} → ${phantom.rows[0]?.client}`);
  check('parseLedgerSource', 'the denominator drops it too, so no phantom gap opens', 'declared',
    '1 route / 1 client', `${phantom.routesDeclared} route / ${phantom.clientsDeclared} client`);
  check('parseLedgerSource', 'and nothing is billed as declined for it', 'declined', 0, phantom.declined.length);
  check('parseLedgerSource', 'the dropped lead is NAMED, with its line — dropped is not silent', 'outsideCode',
    "1 route: 'GET /api/v1/gone'", phantom.outsideCode.map((d) => `${d.line} ${d.text}`).join('; '));

  // The shape the card called the expensive one: prose that quotes a `client:` as well used
  // to mint a FULLY CLIENT-BOUND phantom, which then joined the UNREACHABLE population — no
  // registrar tail can ever match a route nobody mounts — and inflated it with no verdict.
  const phantomClient = parseLedgerSource([
    "// The retired row read route: 'GET /api/v1/gone' bound to client: 'meta.getGone'.",
    'export const L = [',
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a prose lead quoting a `client:` too mints no client-bound phantom', 'client rows',
    1, phantomClient.rows.filter((r) => r.client).length);
  check('parseLedgerSource', 'and the surviving row keeps its OWN binding, never the comment\'s', 'client',
    'meta.getTypes', phantomClient.rows[0]?.client);
  check('parseLedgerSource', 'both prose leads are named', 'outsideCode', 2, phantomClient.outsideCode.length);

  // A string PAYLOAD is the other half of the mask, and the half an allowlist of comment
  // shapes would miss: the bytes are code position by any line-based test.
  const payload = parseLedgerSource([
    'export const NOTE = "the retired row read route: \'GET /api/v1/gone\'";',
    'export const L = [',
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a `route:` inside a string PAYLOAD is not a row', 'row count', 1, payload.rows.length);
  check('parseLedgerSource', 'and it is named, not silently dropped', 'outsideCode', 1, payload.outsideCode.length);

  // ---- A LITERAL-UNION `route:` TYPE MEMBER IS NOT A ROW (#10793) ---------------
  // The OTHER half of "is this in code position", and the half `codeOnly` cannot answer:
  // type declarations ARE code, so a member spelled `route: 'GET /a' | 'GET /b'` opens with
  // the very quote the recognizer reads and used to become a ROW. Silent in the same two
  // ways as the comment case above — `rows` and `routesDeclared` moved together so the
  // partial-read guard saw no gap, and `outsideCode` saw nothing either because the lead
  // really IS in code position. `orphanSource` above pins this exact spelling on the
  // `client:` key, written there because a literal-union member opens with that quote; this
  // is the `route:` twin, which had nothing at all keeping it out of the row loop.
  //
  // ⚠️ PINNED IN BOTH DIRECTIONS, like the mask cases: a fix that reached the type member by
  // swallowing the table AFTER it — a brace match that ran away — would pass a test asserting
  // only that the phantom is gone, while silently dropping all 259 live rows.
  const typeUnionSource = [
    "export interface Entry { route: 'GET /api/v1/gone' | 'GET /api/v1/meta'; client: string }",
    'export const L = [',
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
  ].join('\n');
  const typeUnion = parseLedgerSource(typeUnionSource);
  check('parseLedgerSource', 'a literal-union `route:` TYPE member is not a row', 'row count',
    1, typeUnion.rows.length);
  check('parseLedgerSource', 'and the row in CODE still is — carrying its VALUE, not the member\'s', 'row',
    'GET /api/v1/meta → meta.getTypes', `${typeUnion.rows[0]?.route} → ${typeUnion.rows[0]?.client}`);
  check('parseLedgerSource', 'the denominator drops it too, so no phantom gap opens', 'declared',
    '1 route / 1 client', `${typeUnion.routesDeclared} route / ${typeUnion.clientsDeclared} client`);
  check('parseLedgerSource', 'and nothing is billed as declined for it', 'declined',
    0, typeUnion.declined.length);
  // THE REJECT SIDE, ASSERTED POSITIVELY — `orphanSource`'s discipline on the other key. A
  // type member must reach NO report: not `declined` (it is not an unread row) and not
  // `outsideCode` (it is not prose). "Produces nothing" is correct here and only here,
  // because it is a declaration of a TYPE and never a table row.
  check('parseLedgerSource', 'a type member reaches no report at all — it is not an unread row', 'line 1 entries',
    false, typeUnion.declined.some((d) => d.line === 1) || typeUnion.outsideCode.some((d) => d.line === 1));
  const typeUnionNoInterface = parseLedgerSource(typeUnionSource.split('\n').slice(1).join('\n'));
  check('parseLedgerSource', 'and deleting the interface changes NOTHING — it contributed no count',
    'declared', '1 row / 1 route / 1 client / 0 declined',
    `${typeUnionNoInterface.rows.length} row / ${typeUnionNoInterface.routesDeclared} route / ${typeUnionNoInterface.clientsDeclared} client / ${typeUnionNoInterface.declined.length} declined`);

  // The expensive shape, as on the comment side: a member that unions a `client:` too used to
  // mint a FULLY CLIENT-BOUND phantom, which then joined the UNREACHABLE population — no
  // registrar tail can match a route nobody mounts — and inflated the 176 with no verdict.
  const typeUnionClient = parseLedgerSource([
    "export interface Entry { route: 'GET /api/v1/gone'; client: 'meta.getGone' }",
    'export const L = [',
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a member unioning a `client:` too mints no client-bound phantom', 'client rows',
    1, typeUnionClient.rows.filter((r) => r.client).length);
  check('parseLedgerSource', 'and the surviving row keeps its OWN binding, never the member\'s', 'client',
    'meta.getTypes', typeUnionClient.rows[0]?.client);

  // `type X = { … }` is the other spelling `typeDeclRegions` recognises, and the recognizer
  // reads the same region list rather than a second idea of what a type member is.
  const typeAlias = parseLedgerSource([
    "export type Entry = { route: 'GET /api/v1/gone' | 'GET /api/v1/meta'; client: string };",
    'export const L = [',
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a `type X = { … }` member is skipped on the same list', 'row count',
    1, typeAlias.rows.length);
  check('parseLedgerSource', 'and its row still reads', 'row', 'GET /api/v1/meta → meta.getTypes',
    `${typeAlias.rows[0]?.route} → ${typeAlias.rows[0]?.client}`);

  // THE RUNAWAY-BRACE DIRECTION, from the other side: the region ends where the declaration's
  // brace does, so a table BEFORE a type declaration is read whole and the member after it is
  // still skipped. The failure this pins is a skip that starts at the member and never ends.
  const typeUnionTrailing = parseLedgerSource([
    'export const L = [',
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
    "  { route: 'GET /api/v1/docs', family: 'metadata', disposition: 'server-only' },",
    '];',
    "export interface Entry { route: 'GET /api/v1/gone' | 'GET /api/v1/meta'; client: string }",
  ].join('\n'));
  check('parseLedgerSource', 'a table BEFORE a type declaration is read whole', 'row count',
    2, typeUnionTrailing.rows.length);
  check('parseLedgerSource', 'with both values and the one binding intact', 'rows',
    'GET /api/v1/meta → meta.getTypes | GET /api/v1/docs → null',
    typeUnionTrailing.rows.map((r) => `${r.route} → ${r.client}`).join(' | '));
  check('parseLedgerSource', 'and the trailing member still contributes no count', 'declared',
    '2 route / 1 client / 0 declined',
    `${typeUnionTrailing.routesDeclared} route / ${typeUnionTrailing.clientsDeclared} client / ${typeUnionTrailing.declined.length} declined`);

  // The verdict a reader actually sees carries none of it — a ledger whose entry interface
  // spells its `route:` as a union is an ACCURATE ledger, and reddening CI over it would be
  // the same false red the type-member exclusion exists to prevent.
  const typeUnionCov = bridgeCoverageFrom([{ file: 'i-route-ledger.ts', ...typeUnion }], ['/api/v1/meta']);
  check('bridgeCoverageFrom', 'a type-member lead carries NO broken-scan verdict', 'brokenScan',
    0, typeUnionCov.brokenScan.length);
  check('bridgeCoverageFrom', 'and the ratios it must not move are whole', 'read',
    '1 of 1 route / 1 of 1 client',
    `${typeUnionCov.rowsParsed} of ${typeUnionCov.routesDeclared} route / ${typeUnionCov.clientRows} of ${typeUnionCov.clientsDeclared} client`);
  check('bridgeCoverageFrom', 'and it is not billed as a prose lead either', 'leadsOutsideCode',
    0, typeUnionCov.leadsOutsideCode);

  // ---- THE SAME TYPE MEMBER, IN THE TWO QUOTES THE RECOGNIZER DECLINES (#10901) ----
  // #10793 (above) taught the ROW RECOGNIZER and the first term of its denominator to read
  // through both of #10500's discriminators. Its complement did not move: `declinedIn` ran
  // over RAW text through NEITHER, so the very same member — a `route:` union written in a
  // double quote or a backtick instead of a single one — was billed as a value the parse
  // FAILED to read. That is the LOUD twin of the bug above: not a phantom row joining the
  // population in silence, but a named entry and a PARTIAL-read verdict with exit 1, on a
  // ledger that is completely accurate. The type-declaration exclusion exists to prevent
  // exactly that false red, and this is the last scan in the file that was not reading it.
  //
  // BOTH SPELLINGS ARE PINNED SEPARATELY. They come out of one regex alternation and one
  // code path, and were measured behaving identically — which is the reason to pin them
  // apart rather than to trust one for both: a later narrowing of that alternation would
  // otherwise take one of them with nothing to say so.
  for (const [spelling, q] of [['double-quoted', '"'], ['backtick-quoted', '`']]) {
    const src = [
      `export interface Entry { route: ${q}GET /api/v1/gone${q} | ${q}GET /api/v1/meta${q}; client: string }`,
      'export const L = [',
      "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
      '];',
    ].join('\n');
    const r = parseLedgerSource(src);
    const cov = bridgeCoverageFrom([{ file: 'j-route-ledger.ts', ...r }], ['/api/v1/meta']);
    check('parseLedgerSource', `a ${spelling} literal-union \`route:\` TYPE member is not an unread row`,
      'declined', 0, r.declined.length);
    check('parseLedgerSource', `and a ${spelling} member moves no denominator either`, 'declared',
      '1 row / 1 route / 1 client',
      `${r.rows.length} row / ${r.routesDeclared} route / ${r.clientsDeclared} client`);
    check('parseLedgerSource', `and the row in CODE still reads, beside a ${spelling} member`, 'row',
      'GET /api/v1/meta → meta.getTypes', `${r.rows[0]?.route} → ${r.rows[0]?.client}`);
    // The verdict is the whole point: the number moving is a symptom, the exit code is the
    // defect. An accurate ledger must carry NO broken-scan verdict in any spelling.
    check('bridgeCoverageFrom', `a ${spelling} type member carries NO broken-scan verdict`, 'brokenScan',
      0, cov.brokenScan.length);
    // ⚠️ PINNED IN BOTH DIRECTIONS, like #10793's fixture: an exclusion that reached the
    // member by swallowing the table after it would pass every assertion above while
    // silently dropping every live row. Deleting the interface must change NOTHING.
    const noInterface = parseLedgerSource(src.split('\n').slice(1).join('\n'));
    check('parseLedgerSource', `and deleting a ${spelling} member's interface changes NOTHING`, 'declared',
      `${r.rows.length} row / ${r.routesDeclared} route / ${r.declined.length} declined`,
      `${noInterface.rows.length} row / ${noInterface.routesDeclared} route / ${noInterface.declined.length} declined`);
  }

  // THE OTHER CALL SITE, and the one no `route:` fixture can reach: declined `client:`
  // values are collected per ROW WINDOW, so a member only arrives there when the entry
  // interface TRAILS the table and lands inside the 1200-byte window. Measured before the
  // fix on exactly this shape: `clientsDeclared` 2 on a file declaring one client, one
  // named declined entry, exit 1. The `route:` twin below trails the table too, which is
  // the file-wide call site reached from the other side.
  for (const [spelling, q] of [['double-quoted', '"'], ['backtick-quoted', '`']]) {
    const trailingClient = parseLedgerSource([
      'export const L = [',
      "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
      '];',
      `export interface Entry { route: string; client: ${q}meta.getTypes${q} | ${q}meta.getAudit${q} }`,
    ].join('\n'));
    check('parseLedgerSource', `a ${spelling} literal-union \`client:\` TYPE member inside the row window is not an unread row`,
      'declined', 0, trailingClient.declined.length);
    check('parseLedgerSource', `and a ${spelling} \`client:\` member moves no denominator`, 'declared',
      '1 route / 1 client', `${trailingClient.routesDeclared} route / ${trailingClient.clientsDeclared} client`);
    const trailingRoute = parseLedgerSource([
      'export const L = [',
      "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
      '];',
      `export interface Entry { route: ${q}GET /api/v1/meta${q} | ${q}GET /api/v1/gone${q}; client: string }`,
    ].join('\n'));
    check('parseLedgerSource', `a TRAILING ${spelling} \`route:\` member is not an unread row either`,
      'declared', '1 route / 0 declined',
      `${trailingRoute.routesDeclared} route / ${trailingRoute.declined.length} declined`);
  }

  // `type X = { … }` is the other spelling `typeDeclRegions` recognises, and this scan now
  // reads the same region list rather than a second idea of what a type member is.
  const declinedTypeAlias = parseLedgerSource([
    'export type Entry = { route: "GET /api/v1/gone" | "GET /api/v1/meta"; client: string };',
    'export const L = [',
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a `type X = { … }` member is skipped in the declined spellings too',
    'declared', '1 row / 1 route / 0 declined',
    `${declinedTypeAlias.rows.length} row / ${declinedTypeAlias.routesDeclared} route / ${declinedTypeAlias.declined.length} declined`);

  // ⚠️ THE LOAD-BEARING DIRECTION, asserted positively. Everything above says a spelling
  // STOPS being reported; an exclusion that swallowed the declined report wholesale would
  // pass every one of those and give back the silence #9896 closed. A real table row whose
  // `route:` is spelled in a quote the recognizer declines is NOT a type member, and must
  // still be named, still move the denominator, and still carry the verdict.
  for (const [spelling, q] of [['double-quoted', '"'], ['backtick-quoted', '`']]) {
    const realRow = parseLedgerSource([
      'export interface Entry { route: string; client: string }',
      'export const L = [',
      `  { route: ${q}GET /api/v1/gone${q}, family: 'metadata', disposition: 'sdk' },`,
      "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
      '];',
    ].join('\n'));
    const realCov = bridgeCoverageFrom([{ file: 'k-route-ledger.ts', ...realRow }], ['/api/v1/meta']);
    check('parseLedgerSource', `a ${spelling} route in a REAL table row is still declined`, 'declined',
      1, realRow.declined.length);
    check('parseLedgerSource', `and the ${spelling} entry still NAMES itself, with its line`, 'line 3',
      `3: route: ${q}GET /api/v1/gone${q}`,
      realRow.declined.map((d) => `${d.line}: ${d.text}`).join(' | '));
    check('parseLedgerSource', `and the partition still holds for the ${spelling} row — read + declined === declared`, 'partition',
      realRow.routesDeclared, realRow.rows.length + realRow.declined.filter((d) => d.key === 'route').length);
    check('bridgeCoverageFrom', `and the PARTIAL-read verdict still fires for a ${spelling} real row`, 'brokenScan',
      true, realCov.brokenScan.some((v) => v.includes('PARTIAL read')));
  }

  // ⛔ THE BOUNDARY THIS CARD DELIBERATELY DID NOT CROSS. `declinedIn` still reads RAW
  // bytes, so a `route:` quoted in a COMMENT in a declined spelling is still billed as an
  // unread row — #10794, closed `not planned` because it is the loud direction with no
  // puller. Pinned so the boundary is a recorded decision rather than an oversight, and so
  // the card that eventually closes #10794 MOVES this pin instead of finding none.
  const proseDeclined = parseLedgerSource([
    '// The retired row read route: "GET /api/v1/gone" before #1234.',
    'export const L = [',
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a declined spelling in PROSE is still billed as unread — #10794, deliberately unmoved',
    'declined', 1, proseDeclined.declined.length);
  check('parseLedgerSource', 'and its denominator still counts it — the type-member fix moved this none',
    'declared', '1 row / 2 route', `${proseDeclined.rows.length} row / ${proseDeclined.routesDeclared} route`);


  // ⛔ THE TWO SCANS NOW AGREE ON THE CHARACTER CLASS AFTER THE COLON (#11494) — the thing
  // `declLead` exists to make structural rather than coincidental. A declaration whose VALUE
  // SITS ON THE NEXT LINE used to be seen by BOTH: `declinedIn` named it correctly, while
  // `declarationsIn` read the `\n` as the character after the colon, classified
  // `quote === null`, and `unreadableIn` billed the SAME declaration a second time. One
  // declaration, two entries, and the denominator counted it twice.
  //
  // ⛔ THE PARTITION KEPT BALANCING WHILE IT HAPPENED — `1 + 2 === 3` on a file declaring
  // TWO `route:` values — which is exactly why no count comparison could see it. What moved
  // was the POPULATION, not the arithmetic, and the reader was shown two entries for one line.
  const wrappedDeclined = parseLedgerSource([
    'export const L = [',
    '  { route:',
    '      "GET /api/v1/gone", family: \'metadata\', disposition: \'sdk\' },',
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a wrapped DECLINED `route:` reaches the denominator ONCE, not once per scan',
    'declared', '1 row / 2 route / 1 declined',
    `${wrappedDeclined.rows.length} row / ${wrappedDeclined.routesDeclared} route / ${wrappedDeclined.declined.length} declined`);
  // The second entry it used to emit read `route: ` — an EMPTY value, naming nothing a reader
  // can act on, which is the silence every other report in this file exists to break.
  check('parseLedgerSource', 'and the one entry NAMES the value, with its line', 'line 2 double-quoted route',
    'line 2: route: "GET /api/v1/gone"',
    wrappedDeclined.declined.map((d) => `line ${d.line}: ${d.text}`).join(', '));
  check('parseLedgerSource', 'read + declined still accounts for every declared `route:`', 'partition', true,
    wrappedDeclined.rows.length + wrappedDeclined.declined.filter((d) => d.key === 'route').length === wrappedDeclined.routesDeclared);

  // …AND THE LOUDER HALF, which is why `\s*` won and not `[ \t]*`: a wrapped SINGLE-quoted
  // value. The row recognizer's own `\s*` already reads it AS A ROW — and the file then
  // billed that same declaration unread, firing a PARTIAL-read verdict with exit 1 on a
  // wholly accurate ledger. That is the FALSE RED direction, which costs the same trust a
  // false green does. Measured before the fix: rows 1 · routesDeclared 2 · declined 1 ·
  // brokenScan 1, the declined entry again empty-valued.
  const wrappedRead = parseLedgerSource([
    'export const L = [',
    '  { route:',
    "      'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a wrapped single-quoted `route:` is READ, and never ALSO billed unread',
    'declared', '1 row / 1 route / 0 declined',
    `${wrappedRead.rows.length} row / ${wrappedRead.routesDeclared} route / ${wrappedRead.declined.length} declined`);
  check('parseLedgerSource', 'and the row carries its value and its binding', 'row',
    'GET /api/v1/meta → meta.getTypes', `${wrappedRead.rows[0]?.route} → ${wrappedRead.rows[0]?.client}`);
  check('bridgeCoverageFrom', 'so a ledger that merely WRAPS a value carries NO verdict', 'brokenScan',
    0, bridgeCoverageFrom([{ file: 'l-route-ledger.ts', ...wrappedRead }], ['/api/v1/meta']).brokenScan.length);

  // The `client:` column, the same shape: it reached `clientsDeclared` twice — once as the
  // row's binding, once as a non-literal — and fired the same verdict on an accurate ledger.
  const wrappedClient = parseLedgerSource([
    'export const L = [',
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client:",
    "      'meta.getTypes' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a wrapped `client:` is counted once too', 'declared',
    '1 row / 1 client / 0 declined',
    `${wrappedClient.rows.length} row / ${wrappedClient.clientsDeclared} client / ${wrappedClient.declined.length} declined`);
  check('bridgeCoverageFrom', 'and carries no verdict either', 'brokenScan',
    0, bridgeCoverageFrom([{ file: 'l-route-ledger.ts', ...wrappedClient }], ['/api/v1/meta']).brokenScan.length);

  // A wrapped NON-LITERAL value was already counted once — but it NAMED nothing, because the
  // snippet was cut at the newline. Widening the class moved the cut to the value itself.
  const wrappedUnreadable = parseLedgerSource([
    'export const L = [',
    '  { route:',
    "      ROUTES.health, family: 'metadata', disposition: 'sdk' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a wrapped non-literal `route:` is counted once', 'declared',
    '0 row / 1 route / 1 declined',
    `${wrappedUnreadable.rows.length} row / ${wrappedUnreadable.routesDeclared} route / ${wrappedUnreadable.declined.length} declined`);
  check('parseLedgerSource', 'and NAMES the value, where it used to report an empty one',
    'line 2 ROUTES.health', 'line 2: route: ROUTES.health',
    wrappedUnreadable.declined.map((d) => `line ${d.line}: ${d.text}`).join(', '));

  // ⛔ AND THE TYPE-MEMBER DISCRIMINATOR STILL OUTRANKS THE WRAP (#10901). A wrapped
  // literal-union member is skipped by BOTH scans on the SAME region list, so widening the
  // class handed `declinedIn` no member to bill — the regression #10901 closed does not
  // reopen one spelling further out.
  const wrappedTypeMember = parseLedgerSource([
    'export interface Entry { route:',
    '    "GET /api/v1/gone" | "GET /api/v1/meta"; client: string }',
    'export const L = [',
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a WRAPPED literal-union `route:` TYPE member still contributes no count',
    'declared', '1 row / 1 route / 0 declined',
    `${wrappedTypeMember.rows.length} row / ${wrappedTypeMember.routesDeclared} route / ${wrappedTypeMember.declined.length} declined`);

  // ⛔ THE KEY IS ANCHORED IN ONE PLACE NOW (#11542) — this is the pin the boundary comment
  // used to hold, MOVED rather than deleted. `declLead` unified the run between the colon and
  // the value (#11494) and left the KEY as each call site's own argument, so `declarationsIn`
  // anchored with `\b` and the other seven did not: `subroute: 'GET /api/v1/gone'` was a
  // declaration to SEVEN of the eight scans and not to the eighth. It was SILENT for the
  // reason #10683 and #10793 were — the partial-read verdict is keyed on the gap between
  // `rows` and `routesDeclared` and BOTH terms read the unanchored spelling, so both moved
  // together and no verdict fired, while `outsideCode` could not see it either because the
  // lead genuinely IS in code position.
  //
  // MEASURED ON THIS EXACT FIXTURE with the key unanchored:
  //   ⇒ rows 2 · routesDeclared 2 · clientsDeclared 1 · declined 0 · outsideCode 0 ·
  //     brokenScan 0   — a file declaring ONE `route:` produced TWO rows, exit 0.
  //
  // This one fixture moves the ROW RECOGNIZER (`routeRe`) and the FIRST TERM of the
  // denominator; the seven scans are pinned one at a time below, because "all eight read the
  // same spelling now" is a claim about seven behaviours and a fix that anchors one more scan
  // and leaves six is this defect with a smaller denominator.
  const unanchoredKey = parseLedgerSource([
    'export const L = [',
    "  { subroute: 'GET /api/v1/gone', family: 'metadata', disposition: 'sdk' },",
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a `subroute:` mints NO row — the ROW RECOGNIZER anchors the key (#11542)',
    'row count', 1, unanchoredKey.rows.length);
  check('parseLedgerSource', 'and the row that survives is the REAL one, carrying its binding',
    'row', 'GET /api/v1/meta → meta.getTypes',
    `${unanchoredKey.rows[0]?.route} → ${unanchoredKey.rows[0]?.client}`);
  check('parseLedgerSource', 'and the DENOMINATOR drops it too, so no phantom gap opens', 'declared',
    '1 route / 1 client / 0 declined',
    `${unanchoredKey.routesDeclared} route / ${unanchoredKey.clientsDeclared} client / ${unanchoredKey.declined.length} declined`);
  check('bridgeCoverageFrom', 'and the anchored read carries no verdict on an accurate ledger',
    'brokenScan', 0,
    bridgeCoverageFrom([{ file: 'm-route-ledger.ts', ...unanchoredKey }], ['/api/v1/meta']).brokenScan.length);

  // (3) THE WINDOW DELIMITER (`nextRouteRe`) — the worst of the seven, and the reason this is
  // not merely a counting error. A `subroute:` written BETWEEN a real `route:` and its
  // `client:` used to CLOSE the real row's window, so the real row lost its binding and the
  // PHANTOM took it: a WRONG binding, on a path nobody mounts, which then joined the
  // UNREACHABLE population. A count comparison is blind to it by construction — the same
  // shape #10636 measured for the quote spellings, arriving through the key.
  const keyWindow = parseLedgerSource([
    'export const L = [',
    "  { route: 'GET /api/v1/meta', family: 'metadata',",
    "    subroute: 'GET /api/v1/gone',",
    "    disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a `subroute:` does not CLOSE the real row window (#11542)', 'rows',
    '1 row · GET /api/v1/meta → meta.getTypes',
    `${keyWindow.rows.length} row · ${keyWindow.rows.map((r) => `${r.route} → ${r.client}`).join(' | ')}`);

  // (4) THE IN-WINDOW `client:` MATCH (`windowClientRe`). `window.match()` takes the FIRST
  // hit, so a `myclient:` written ahead of the real `client:` became the row's binding, and
  // the real one — spelled exactly the way this recognizer reads — fell through to #10636's
  // unclaimed sweep and was NAMED as a value no row read, on a ledger that binds it correctly.
  const keyClient = parseLedgerSource([
    'export const L = [',
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk',",
    "    myclient: 'wrong.binding', client: 'meta.getTypes' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a `myclient:` does not become the row BINDING (#11542)', 'binding',
    'meta.getTypes', keyClient.rows[0]?.client);
  check('parseLedgerSource', 'and the real `client:` is bound, not swept up as unclaimed', 'declared',
    '1 client / 0 declined',
    `${keyClient.clientsDeclared} client / ${keyClient.declined.length} declined`);

  // (5) THE DECLINED SWEEP (`declinedIn`), which is the LOUD direction: a double-quoted
  // `subroute:` was billed as a `route:` value the parse FAILED to read, so it entered the
  // denominator, was NAMED with its line, and fired a PARTIAL-read verdict with exit 1 on a
  // wholly accurate ledger. A false red costs the same trust a false green does.
  const keyDeclined = parseLedgerSource([
    'export const L = [',
    '  { subroute: "GET /api/v1/gone", family: \'metadata\', disposition: \'sdk\' },',
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a double-quoted `subroute:` is not billed as a DECLINED row (#11542)',
    'declared', '1 row / 1 route / 0 declined',
    `${keyDeclined.rows.length} row / ${keyDeclined.routesDeclared} route / ${keyDeclined.declined.length} declined`);
  check('bridgeCoverageFrom', 'so no PARTIAL-read verdict fires on an accurate ledger', 'brokenScan',
    0, bridgeCoverageFrom([{ file: 'n-route-ledger.ts', ...keyDeclined }], ['/api/v1/meta']).brokenScan.length);

  // (6) THE RAW SWEEP behind `outsideCode`. A `subroute:` in a COMMENT was reported to the
  // reader as a lead sitting where the mask says code is not — a finding printed on every
  // `--bridge-coverage` run, naming something that is not a lead at all.
  const keyProse = parseLedgerSource([
    "// The retired row read subroute: 'GET /api/v1/gone' before #1234.",
    'export const L = [',
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a `subroute:` in PROSE is not reported as a prose-quoted lead (#11542)',
    'outsideCode', 0, keyProse.outsideCode.length);
  // (7) …and `codeLeads`, the other half of that pair, which has no behaviour of its own:
  // it is the filter the sweep above is taken against, so the two must anchor TOGETHER. Were
  // only `codeLeads` anchored, a `subroute:` in CODE position would fall OUT of the filter and
  // be reported as prose — the card's own fixture, pinned here explicitly so the pair cannot
  // drift apart while every other fixture stays green.
  check('parseLedgerSource', 'and a `subroute:` in CODE position is not reported as one either',
    'outsideCode', 0, unanchoredKey.outsideCode.length);

  // (8) …AND THE EIGHTH SCAN'S ANSWER IS UNCHANGED, which is the whole point: it is the one
  // that was already right. A `subroute:` whose value is not a string literal at all was never
  // billed as an unreadable declaration — before the anchor moved or after.
  const keyUnreadable = parseLedgerSource([
    'export const L = [',
    "  { subroute: ROUTES.gone, family: 'metadata', disposition: 'sdk' },",
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a non-literal `subroute:` is billed to nothing — the anchored scan always agreed',
    'declared', '1 row / 1 route / 0 declined',
    `${keyUnreadable.rows.length} row / ${keyUnreadable.routesDeclared} route / ${keyUnreadable.declined.length} declined`);

  // ⛔ THE BOUNDARY #11542 LEFT — CROSSED HERE (#11630). The two pins this block used to hold
  // read "`$route:` still mints a phantom row — deliberately unmoved" and "and it is still
  // SILENT"; they are MOVED, not deleted, which is the same treatment #11542 gave the pin
  // #11584 left it. `\b` fails only against a preceding WORD character, so `$route:` — a legal
  // JS identifier — was a declaration to all eight scans. They agreed, and they agreed by
  // being wrong together: exactly the "agreed-and-wrong" end state #11542's card rejected on
  // sight when it was proposed as the OTHER direction for the key.
  //
  // The anchor is now `(?<![\w$.])` — `symbolRe`'s set, NOT `dottedRe`'s. See `declLead`'s
  // docblock for why the set is the load-bearing half and why `-` is deliberately outside it.
  //
  // MEASURED ON THIS EXACT FIXTURE with the anchor back at `\b`:
  //   ⇒ rows 2 · routesDeclared 2 · clientsDeclared 1 · declined 0 · outsideCode 0 ·
  //     brokenScan 0   — a file declaring ONE `route:` produced TWO rows, exit 0.
  //
  // ⛔ AND THIS ONE MOVES `declarationsIn` TOO — the eighth scan, the one #11542's
  // before/after was priced to leave byte-identical. Its own fixture is (D6) below.
  const dollarKey = parseLedgerSource([
    'export const L = [',
    "  { $route: 'GET /api/v1/gone', family: 'metadata', disposition: 'sdk' },",
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a `$route:` mints NO row — the anchor excludes identifier CONTINUATION (#11630)',
    'row count', 1, dollarKey.rows.length);
  check('parseLedgerSource', 'and the row that survives is the REAL one, carrying its binding',
    'row', 'GET /api/v1/meta → meta.getTypes',
    `${dollarKey.rows[0]?.route} → ${dollarKey.rows[0]?.client}`);
  check('parseLedgerSource', 'and the DENOMINATOR drops it too, so no phantom gap opens', 'declared',
    '1 route / 1 client / 0 declined',
    `${dollarKey.routesDeclared} route / ${dollarKey.clientsDeclared} client / ${dollarKey.declined.length} declined`);
  check('bridgeCoverageFrom', 'and the widened read carries no verdict on an accurate ledger',
    'brokenScan', 0,
    bridgeCoverageFrom([{ file: 'p-route-ledger.ts', ...dollarKey }], ['/api/v1/meta']).brokenScan.length);
  // …and in CODE position it is not reported as PROSE either — the `codeLeads`/`outsideCode`
  // pair must anchor TOGETHER, the same way #11542 pinned it for the word-prefixed class.
  check('parseLedgerSource', 'and a `$route:` in CODE position is not reported as a prose-quoted lead',
    'outsideCode', 0, dollarKey.outsideCode.length);

  // (D2) THE WINDOW DELIMITER (`nextRouteRe`) — the worst of the eight for the same reason it
  // was for #11542: a `$route:` between a real `route:` and its `client:` CLOSED the real
  // row's window, handing the binding to the phantom on a path no registrar mounts.
  const dollarWindow = parseLedgerSource([
    'export const L = [',
    "  { route: 'GET /api/v1/meta', family: 'metadata',",
    "    $route: 'GET /api/v1/gone',",
    "    disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a `$route:` does not CLOSE the real row window (#11630)', 'rows',
    '1 row · GET /api/v1/meta → meta.getTypes',
    `${dollarWindow.rows.length} row · ${dollarWindow.rows.map((r) => `${r.route} → ${r.client}`).join(' | ')}`);

  // (D3) THE IN-WINDOW `client:` MATCH (`windowClientRe`). `window.match()` takes the FIRST
  // hit, so a `$client:` ahead of the real `client:` BECAME the binding, and the real one fell
  // through to #10636's unclaimed sweep and was named as a value no row read.
  const dollarClient = parseLedgerSource([
    'export const L = [',
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk',",
    "    $client: 'wrong.binding', client: 'meta.getTypes' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a `$client:` does not become the row BINDING (#11630)', 'binding',
    'meta.getTypes', dollarClient.rows[0]?.client);
  check('parseLedgerSource', 'and the real `client:` is bound, not swept up as unclaimed', 'declared',
    '1 client / 0 declined',
    `${dollarClient.clientsDeclared} client / ${dollarClient.declined.length} declined`);

  // (D4) THE DECLINED SWEEP (`declinedIn`), the LOUD direction: a double-quoted `$route:` was
  // billed as a `route:` value the parse FAILED to read — entering the denominator, named with
  // its line, and firing a PARTIAL-read verdict with exit 1 on a wholly accurate ledger.
  const dollarDeclined = parseLedgerSource([
    'export const L = [',
    '  { $route: "GET /api/v1/gone", family: \'metadata\', disposition: \'sdk\' },',
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a double-quoted `$route:` is not billed as a DECLINED row (#11630)',
    'declared', '1 row / 1 route / 0 declined',
    `${dollarDeclined.rows.length} row / ${dollarDeclined.routesDeclared} route / ${dollarDeclined.declined.length} declined`);
  check('bridgeCoverageFrom', 'so no PARTIAL-read verdict fires on an accurate ledger', 'brokenScan',
    0, bridgeCoverageFrom([{ file: 'q-route-ledger.ts', ...dollarDeclined }], ['/api/v1/meta']).brokenScan.length);

  // (D5) THE RAW SWEEP behind `outsideCode` — a `$route:` in a COMMENT was printed to the
  // reader on every `--bridge-coverage` run as a lead sitting where the mask says code is not.
  const dollarProse = parseLedgerSource([
    "// The retired row read $route: 'GET /api/v1/gone' before #1234.",
    'export const L = [',
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a `$route:` in PROSE is not reported as a prose-quoted lead (#11630)',
    'outsideCode', 0, dollarProse.outsideCode.length);

  // (D6) ⛔ THE EIGHTH SCAN — `declarationsIn`, via `unreadableIn`. THIS is what makes #11630 a
  // SECOND population move rather than a re-run of #11542's: #11542 left this scan
  // byte-identical on purpose and priced its before/after that way. A `$route:` whose value is
  // not a string literal at all was billed here as a declaration the recognizer could not
  // read — `1 row / 2 route / 1 declined` with a PARTIAL-read verdict, on an accurate ledger.
  // Compare `--self-test`'s `subroute:` twin above, which reads `1 row / 1 route / 0 declined`
  // on BOTH trees because the anchored scan always agreed about the word-prefixed class.
  const dollarUnreadable = parseLedgerSource([
    'export const L = [',
    "  { $route: ROUTES.gone, family: 'metadata', disposition: 'sdk' },",
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a non-literal `$route:` is billed to nothing — the EIGHTH scan moved too (#11630)',
    'declared', '1 row / 1 route / 0 declined',
    `${dollarUnreadable.rows.length} row / ${dollarUnreadable.routesDeclared} route / ${dollarUnreadable.declined.length} declined`);
  check('bridgeCoverageFrom', 'and `declarationsIn` moving fires no PARTIAL-read verdict either',
    'brokenScan', 0,
    bridgeCoverageFrom([{ file: 'r-route-ledger.ts', ...dollarUnreadable }], ['/api/v1/meta']).brokenScan.length);

  // (D7) ⛔ THE SECOND CLASS THE CHARACTER CLASS CLOSES, found by MEASUREMENT rather than
  // assumed from the card, which named only `$`. A `.` before the key makes the token a MEMBER
  // ACCESS, and the colon then belongs to a TERNARY and never to a key — `cond ? obj.route :
  // 'GET /api/v1/gone'` minted a phantom row on a path nobody declares. This is why the set is
  // `symbolRe`'s `[\w$.]` and not `dottedRe`'s `[\w$]`: `declLead`'s key is a BARE token.
  const dottedKey = parseLedgerSource([
    'export const L = [',
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
    "const fallback = cond ? defaults.route : 'GET /api/v1/gone';",
  ].join('\n'));
  check('parseLedgerSource', 'a member-access `.route :` in a TERNARY mints NO row (#11630)',
    'row count', 1, dottedKey.rows.length);
  check('parseLedgerSource', 'and the real row keeps its binding across it', 'row',
    'GET /api/v1/meta → meta.getTypes',
    `${dottedKey.rows[0]?.route} → ${dottedKey.rows[0]?.client}`);
  check('parseLedgerSource', 'and it leaves the denominator alone as well', 'declared',
    '1 route / 1 client / 0 declined',
    `${dottedKey.routesDeclared} route / ${dottedKey.clientsDeclared} client / ${dottedKey.declined.length} declined`);

  // ⛔ BOTH OF #11630'S BOUNDARY PINS ARE FLIPPED HERE (#11717), not deleted — the allowlist
  // crosses both, and a green reached by removing an assertion is the one thing this gate
  // cannot afford.
  //
  // (a) `-`. #11630 left it admitted on the reasoning that `a-route` is two tokens, so that
  // `route` IS the whole token and is a non-declaration for a DIFFERENT reason (expression
  // position) — a reason it shares with the bare `cond ? route : x` no lookbehind can reach.
  // The allowlist moves it, and for a reason that reads the same fact the other way round:
  // whole token or not, `-` is not a place an object-literal KEY may begin. What #11630 called
  // the shared class is now pinned directly, in its plainest spelling, at the end of this
  // block — so the class is pinned rather than approximated by one of its spellings.
  const minusKey = parseLedgerSource([
    'export const L = [',
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
    "const n = cond ? a-route : 'GET /api/v1/gone';",
  ].join('\n'));
  check('parseLedgerSource', 'a `-`-prefixed lead mints NO row — the pin #11630 left is FLIPPED by the allowlist (#11717)',
    'row count', 1, minusKey.rows.length);
  // (b) UNICODE, which is #11711's whole card, subsumed. `\w` is ASCII-only, so `éroute:` was
  // admitted by the lookbehind exactly as it was by `\b`. As a BLOCKLIST closing it meant a
  // `\p{L}` class under the `u` flag, which changes escape semantics for every source these
  // leads are COMPOSED with at the eight call sites — the concrete cost that kept it open. An
  // allowlist of ASCII positions needs no flag, so it closes for free. 0 occurrences across
  // the seven live ledgers either way.
  const unicodeKey = parseLedgerSource([
    'export const L = [',
    "  { éroute: 'GET /api/v1/gone', family: 'metadata', disposition: 'sdk' },",
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
  ].join('\n'));
  check('parseLedgerSource', 'a UNICODE-prefixed lead mints NO row — #11711 subsumed, and with NO `u` flag (#11717)',
    'row count', 1, unicodeKey.rows.length);

  // ⛔ (c) THE RESIDUE THIS LEAVES, and it is the END of what any left-anchor can reach — a
  // boundary, not the next link in the chain. A key in EXPRESSION position preceded by
  // WHITESPACE is byte-for-byte what a property key looks like, so the allowlist admits it,
  // correctly by its own rule. This is the class #11630 named as unreachable by any
  // lookbehind and used to justify leaving `-` open; the allowlist closes every spelling of it
  // that WEARS a character and leaves this one. Closing it needs the colon's enclosing
  // EXPRESSION, not its left neighbour — a parser question. Pinned deliberately unmoved so a
  // card that ever takes it MOVES a pin rather than finding none.
  const bareExprKey = parseLedgerSource([
    'export const L = [',
    "  { route: 'GET /api/v1/meta', family: 'metadata', disposition: 'sdk', client: 'meta.getTypes' },",
    '];',
    "const n = cond ? route : 'GET /api/v1/gone';",
  ].join('\n'));
  check('parseLedgerSource', 'a bare `? route :` in EXPRESSION position still mints a phantom — deliberately unmoved',
    'row count', 2, bareExprKey.rows.length);
  check('parseLedgerSource', 'and it is still SILENT — all eight scans agree on it, so both terms move together',
    'declared', '2 route / 1 client / 0 declined',
    `${bareExprKey.routesDeclared} route / ${bareExprKey.clientsDeclared} client / ${bareExprKey.declined.length} declined`);

  // ⛔ REPORTED, NEVER A VERDICT. A comment explaining a retired row by quoting its old path
  // is legitimate prose; reddening CI over it is the false red the #9747 family declines.
  const phantomCov = bridgeCoverageFrom([{ file: 'h-route-ledger.ts', ...phantom }], ['/api/v1/meta']);
  check('bridgeCoverageFrom', 'a prose-quoted lead carries NO broken-scan verdict', 'brokenScan',
    0, phantomCov.brokenScan.length);
  check('bridgeCoverageFrom', 'and the ratios it must not move are whole', 'read',
    '1 of 1 route / 1 of 1 client',
    `${phantomCov.rowsParsed} of ${phantomCov.routesDeclared} route / ${phantomCov.clientRows} of ${phantomCov.clientsDeclared} client`);
  check('bridgeCoverageFrom', 'yet it is counted where a reader will see it', 'leadsOutsideCode',
    1, phantomCov.leadsOutsideCode);
  check('bridgeCoverageFrom', 'and an accurate ledger reports none', 'leadsOutsideCode', 0,
    bridgeCoverageFrom([{ file: 'h-route-ledger.ts', ...prose }], ['/api/v1/meta']).leadsOutsideCode);

  // End to end over those three fixtures: the #9192 recall miss must come back.
  // `auditMetaItem` (changed) → `/:type/:name/audit` (registrar) → `meta.getAudit`
  // (ledger) → the token `api/client-sdk.mdx` actually contains.
  const bridged = registrar.get('/:type/:name/audit');
  const bridgeRow = ledger.find((r) => bridged && r.route.endsWith('/:type/:name/audit'));
  check('bridge', 'a changed protocol method reaches the SDK method the docs name', 'auditMetaItem → getAudit', 'getAudit', bridgeRow?.client?.split('.').pop());

  // ---- the route bridge admits LEAF symbols only (#9294) ---------------------
  // MEASURED FAILURE (9e2e68206): a 27-line edit confined to `RestServer.probeMcpServeable`
  // — 17 of those lines its own doc comment — listed `api/client-sdk.mdx` via
  // `getBookTree (sdk)` / `meta.getBookTree (sdk)` and `releases/v14.mdx` via
  // `/book/:name/tree (route)`. No changed line relates to book trees; the nearest
  // `/book/:name/tree` literal sits ~1350 lines away.
  //
  // THE CHAIN, each link real and each one but the last correct: a doc-comment line has no
  // declaration of its own and its indent walk climbs past every sibling member to the
  // CLASS, so `RestServer` enters the anchor set (a correct row — three release pages name
  // that class) → the route bridge accepts it as a bridge symbol → `parseRegistrarSource`
  // scans handler windows for the BARE IDENTIFIER and two unrelated handlers call
  // `RestServer.` statics → two route anchors → the ledger maps one to `meta.getBookTree`.
  // Two routes is UNDER `MAX_ROUTES_PER_SYMBOL`, so the cross-cutting cap never saw it.
  //
  // ⚠️ PINNED IN BOTH DIRECTIONS. A test that only asserts the wrong rows vanish passes
  // just as happily on an over-correction that also drops `RestServer (symbol)` — which
  // would trade a precision bug for a coverage hole, strictly worse than the bug (this
  // defect over-reports and misses nothing). So the class must stay a symbol anchor, the
  // method must stay bridgeable, and the identifier scan must still SEE the qualifier —
  // that last one is what stops this block going green because the fixture drifted into
  // deriving no route at all.
  const serverSource = [
    'export class RestServer {',
    '    /**',
    '     * [#9120] Resolve the environment through the shared entry point.',
    '     */',
    '    private async probeMcpServeable(req: any): Promise<boolean | null> {',
    '        return this.resolveRequestEnvironmentId(req);',
    '    }',
    '',
    '    private registerBookRoutes() {',
    '        this.routeManager.register({',
    "            method: 'GET',",
    '            path: `${metaPath}/book/:name/tree`,',
    '            handler: async (req, res) => {',
    '                return RestServer.anyPermissionSetAudience(books);',
    '            },',
    '        });',
    '    }',
    '}',
  ].join('\n');
  const bookRegistrar = parseRegistrarSource(serverSource);
  const bookIds = bookRegistrar.get('/book/:name/tree');
  check('parseRegistrarSource', 'the mechanism is real: a static-call QUALIFIER lands in the handler window', 'RestServer', true, !!bookIds?.has('RestServer'));
  check('parseRegistrarSource', 'and so does the handler\'s own implementation symbol', 'anyPermissionSetAudience', true, !!bookIds?.has('anyPermissionSetAudience'));

  const docCommentLine = 3;   // `* [#9120] Resolve the environment …` — inside the JSDoc
  const methodBodyLine = 6;   // `return this.resolveRequestEnvironmentId(req);`
  check('symbolAnchorsFromSource', 'a changed DOC COMMENT above a method still anchors on the enclosing class — the correct row that must survive', `line ${docCommentLine}`, true, anchorsAt(serverSource, docCommentLine).has('RestServer'));
  check('symbolAnchorsFromSource.bridgeable', 'but the CLASS is not a route\'s implementation, so it never enters the bridge', `line ${docCommentLine}`, false, bridgeableAt(serverSource, docCommentLine).has('RestServer'));
  check('symbolAnchorsFromSource.bridgeable', 'the METHOD is a leaf and stays bridgeable — the #9192 recall win is untouched', `line ${methodBodyLine}`, true, bridgeableAt(serverSource, methodBodyLine).has('probeMcpServeable'));
  check('symbolAnchorsFromSource', 'and the method is still the anchor for its own body (most-specific-wins)', `line ${methodBodyLine}`, true, anchorsAt(serverSource, methodBodyLine).has('probeMcpServeable'));

  // End to end over the fixture: the doc-comment edit selects NO route, and the method
  // edit selects no route HERE either (it appears in no handler) — while `auditMetaItem`
  // above still selects its own. Absence proved by the same selection step the bridge
  // runs, not by asserting on a different quantity.
  const tailsSelectedBy = (symbols, registrarMap) => {
    const tails = [];
    for (const [tail, ids] of registrarMap) if ([...symbols].some((sym) => ids.has(sym))) tails.push(tail);
    return tails;
  };
  check('bridge', 'a doc-comment-only edit inside a class selects no route at all', 'tails', JSON.stringify([]), JSON.stringify(tailsSelectedBy(bridgeableAt(serverSource, docCommentLine), bookRegistrar)));
  check('bridge', 'the pre-fix behaviour, held as the counterfactual: the raw anchor set DID select the book route', 'tails', JSON.stringify(['/book/:name/tree']), JSON.stringify(tailsSelectedBy(anchorsAt(serverSource, docCommentLine), bookRegistrar)));
  check('bridge', 'a changed protocol METHOD still selects its own route', 'tails', JSON.stringify(['/:type/:name/audit']), JSON.stringify(tailsSelectedBy(bridgeableAt(protocolSource, 9), registrar)));

  // The container/leaf split on the two fixtures the derivation is already pinned against,
  // so the new flag is read off the same shapes the anchor cases use.
  const bridgeableCases = [
    [protocolSource, 1, 'ObjectStackProtocolImplementation', false, 'a changed CLASS LINE anchors, but a class is a scope, not a route implementation'],
    [protocolSource, 9, 'auditMetaItem', true, 'a changed method body is a leaf'],
    [protocolSource, 16, 'historyMetaItem', true, 'a method reached past an intermediate block is still a leaf'],
    [schemaSource, 1, 'ObjectSchema', false, 'a `const` object that owns its keys is a container'],
    [schemaSource, 2, 'controlled_by_parent', true, 'a schema KEY is a leaf — it names one property, not a scope'],
    [schemaSource, 6, 'buildObject', true, 'a function is a leaf: it holds locals, it does not own surface'],
  ];
  for (const [src, line, name, want, label] of bridgeableCases) {
    check('symbolAnchorsFromSource.bridgeable', label, `${name} @ line ${line}`, want, bridgeableAt(src, line).has(name));
  }

  // ---- the handler-window scan reads CODE, never PROSE (#9432) ---------------
  // #9294 removed CONTAINER names from the bridge, which closed the specimen it measured.
  // The residue is one layer down and is what this block pins: a LEAF symbol named only in
  // an English comment inside a handler window bridged just the same.
  //
  // MEASURED FAILURE (40d5b2d4c, #9405 — a `metadata-protocol` batch-publish change): BOTH
  // route anchors that run produced were prose and nothing else.
  //
  //   promoteDraftForPublish → /:type/:name/publish   rest-server.ts:5324,5376  (comments)
  //   publishPackageDrafts   → /:name/state/:field    rest-server.ts:5694,5722  (comments)
  //
  // The second one carried `content/docs/protocol/objectql/state-machine.mdx` onto the
  // advisory (and `meta.getLegalNextStates` through the ledger) for a diff that went
  // nowhere near a state machine. Neither name is called by the handler that named it;
  // both sentences are ordinary implementation commentary about a neighbouring door.
  //
  // ⚠️ PINNED IN BOTH DIRECTIONS, for the reason #9294's block states: an exclusion-only
  // test passes just as happily on a fix that breaks the bridge outright, which would trade
  // a precision bug for the recall hole the bridge exists to fill. So the comment-named leaf
  // must NOT bridge, the code-named leaf MUST, and the raw scan must still SEE the prose
  // name — that last one is the counterfactual, and it is what stops this block going green
  // because the fixture drifted into carrying no comment at all.
  const commentaryRegistrar = [
    'export class RestServer {',
    '    private registerPublishRoutes() {',
    '        this.routeManager.register({',
    "            method: 'POST',",
    '            path: `${metaPath}/:type/:name/publish`,',
    '            handler: async (req, res) => {',
    '                // Promotion is authoring. `promoteDraftForPublish` flips the',
    "                // `sys_metadata` row state: 'draft' → 'active', and ADR-0027",
    '                // (E)(5) defines sealing a publish as exactly that.',
    "                const base = 'https://acme.test//v1'; // a URL is not a comment opener",
    '                return this.publishMetaItem(base, req.params); // seals the draft',
    '            },',
    '        });',
    '    }',
    '',
    '    /**',
    '     * @example',
    '     * manager.register({',
    "     *   method: 'GET',",
    "     *   path: '/api/users/:id',",
    '     *   handler: getUserHandler,',
    '     * });',
    '     */',
    '    private describeRegistration() {}',
    '}',
  ].join('\n');
  const commentary = parseRegistrarSource(commentaryRegistrar);
  const publishIds = commentary.get('/:type/:name/publish');
  check('parseRegistrarSource', 'a leaf the handler actually CALLS is still seen — the bridge is untouched where its premise holds', 'publishMetaItem', true, !!publishIds?.has('publishMetaItem'));
  check('parseRegistrarSource', 'a leaf named only in an English comment is NOT this route\'s implementation', 'promoteDraftForPublish', false, !!publishIds?.has('promoteDraftForPublish'));
  check('parseRegistrarSource', 'a `//` inside a STRING opens no comment — this scan rides the shared scanner, not a private regex', 'base + publishMetaItem', true, !!publishIds?.has('base') && !!publishIds?.has('publishMetaItem'));
  check('parseRegistrarSource', 'a `path:` inside a JSDoc @example is an illustration, not a registration', 'tails', JSON.stringify(['/:type/:name/publish']), JSON.stringify([...commentary.keys()]));

  // The counterfactual, twice: the PRE-FIX scan, verbatim, over the same fixture. Both
  // halves must still be there to be excluded, or this block proves nothing.
  const rawWindowIds = (src, siteFragment) => {
    const ls = src.split('\n');
    const start = ls.findIndex((l) => l.includes(siteFragment));
    const ids = new Set();
    for (let j = start; j >= 0 && j < Math.min(ls.length, start + REGISTRAR_HANDLER_WINDOW); j++) {
      for (const m of ls[j].matchAll(/[A-Za-z_$][\w$]*/g)) ids.add(m[0]);
    }
    return ids;
  };
  check('parseRegistrarSource', 'counterfactual: the bare-token scan DID read the prose name out of that window', 'promoteDraftForPublish', true, rawWindowIds(commentaryRegistrar, ':type/:name/publish').has('promoteDraftForPublish'));
  check('parseRegistrarSource', 'counterfactual: that @example line DID match the registration-site regex', '/api/users/:id', '/api/users/:id', routeTailOf(commentaryRegistrar.split('\n').find((l) => l.includes('/api/users/:id')).match(/(?:^|[\s{,(])path\s*:\s*([`'"])(.*?)\1/)?.[2] ?? ''));

  // End to end through the same selection step the bridge runs: a diff confined to the
  // commented-about symbol selects no route, and one on the called symbol still selects its
  // own. The commented-about name is a doc anchor either way — it enters `symbolAnchors`
  // from its OWN declaration, which this hop never touched — so nothing is lost but the
  // false bridge.
  check('bridge', 'a diff touching only the symbol the comment MENTIONS selects no route', 'tails', JSON.stringify([]), JSON.stringify(tailsSelectedBy(new Set(['promoteDraftForPublish']), commentary)));
  check('bridge', 'a diff touching the symbol the handler CALLS still selects the publish route', 'tails', JSON.stringify(['/:type/:name/publish']), JSON.stringify(tailsSelectedBy(new Set(['publishMetaItem']), commentary)));

  // ---- a registration BOUNDS the previous window even when its path is a variable (#9503) ----
  // The third layer of the same family, and the only one with no measured wrong row on the
  // tree that filed it — read that as the point of the block, not as a reason to skip it.
  //
  // MECHANISM (verified on e7daea169). `rest-server.ts:5661` registers
  // `/:name/state/:field`; the next LITERAL `path:` is 255 lines later at 5916, so the
  // window runs its full 150 lines to 5810 — straight over `path: publishedPath` at 5747,
  // which registers a different route the scan cannot see. 64 lines of the `published`
  // handler sat inside the `state` route's window.
  //
  // MEASURED HARM ON THAT TREE: ZERO identifiers, and the reason is worth writing down.
  // 55 of those 64 lines are the ADR-0033/#8278 commentary, which #9432 masks to blank,
  // and the remaining 9 are `for`/`register`/`method`/`handler`/`try`/`const` boilerplate
  // whose every token already occurs earlier in the same window. Whole-tree before/after:
  // 42 tails → 42, 3320 identifier slots → 3320, zero gained, zero lost. #9432's mask is
  // what is holding this defect down, and it holds it down by ACCIDENT OF COMMENT LENGTH.
  //
  // WHAT IS UNDERNEATH: the same span measured against the foreign handler's own 150 lines
  // carries 18 identifiers the `state` route does not otherwise see — `getMetaItemLayered`,
  // `getPublished`, `resolveProtocol`, `publishedProtocol`, `overlayError`, `resolveExecCtx`
  // … i.e. the `published` route's implementation, including the exact name
  // `rest-route-ledger.ts` binds `/:type/:name/published` to (`meta.getPublished`). Shorten
  // that comment block by a screenful and a `published`-handler diff starts putting the
  // state-machine page on the advisory with a `via` that names a symbol it does implement —
  // for a route it does not. The window's invariant is "this span is ONE route's handler";
  // that invariant is false today and costs nothing today. Both halves are true.
  //
  // ⚠️ PINNED IN BOTH DIRECTIONS, and a third: the foreign handler's symbol must NOT bridge,
  // the site's own symbol MUST still bridge (a boundary rule that over-truncates trades this
  // precision bug for the recall hole the bridge exists to fill), and a `path:` written in a
  // COMMENT must still bound nothing — that last one is new risk this change introduces and
  // #9432 could not have pinned, because before this change a commented `path:` could only
  // mint a phantom TAIL, and now it could also truncate a real window.
  //
  // NOT FIXED HERE, and deliberately: the variable-path route still gets no window of its
  // own, so nothing bridges TO `/:type/:name/published`. Resolving `publishedPath` needs a
  // one-hop binding lookup, and the recall hole it would dent is a small slice of a much
  // larger one — 176 of the 221 client-bound ledger rows have no registrar tail at all
  // today, most of them `plugin-auth` routes that never take a `path:` property. That is a
  // different card with a different measurement; the tails assertion below states the
  // omission as a fact rather than leaving it to be discovered.
  //
  // ⚠️ THE LIVE HALF OF THAT PARAGRAPH EXPIRED; THE FIXTURE BELOW DID NOT (#12966).
  // `rest-server.ts` has since unrolled the `publishedPath` loop into a literal `path:`,
  // so on `8f10a79f7a` something DOES bridge to `/:type/:name/published` in the live
  // tree, and the shortfall reads 172 of 219 rather than 176 of 221. None of that
  // reaches this block: the fixture is hermetic and models the variable-path SHAPE,
  // which is still the shape the scan cannot see wherever it survives. Kept verbatim
  // for that reason — ⛔ do not "refresh" a hermetic fixture to match today's tree.
  const variablePathRegistrar = [
    'export class RestServer {',
    '    private registerStateRoutes() {',
    "        for (const objectsSegment of ['objects', 'object']) {",
    '            this.routeManager.register({',
    "                method: 'GET',",
    '                path: `${metaPath}/${objectsSegment}/:name/state/:field`,',
    '                handler: async (req, res) => {',
    '                    // Pre-#4432 this door also registered',
    "                    //   path: '/api/v1/meta/legacy/:name/state',",
    '                    // and both spellings reach the same primitive.',
    '                    return this.legalNextStates(req.params);',
    '                },',
    '            });',
    '        }',
    '',
    '        // The foreign registration: a real route whose path is a loop variable.',
    '        for (const publishedPath of [`${metaPath}/:type/:name/published`]) {',
    '            this.routeManager.register({',
    "                method: 'GET',",
    '                path: publishedPath,',
    '                handler: async (req, res) => {',
    '                    return this.getMetaItemLayered(req.params);',
    '                },',
    '            });',
    '        }',
    '    }',
    '}',
  ].join('\n');
  const variablePath = parseRegistrarSource(variablePathRegistrar);
  const stateIds = variablePath.get('/:name/state/:field');
  check('parseRegistrarSource', 'the site\'s OWN implementation symbol still lands in its window', 'legalNextStates', true, !!stateIds?.has('legalNextStates'));
  check('parseRegistrarSource', 'a `path:` written in a COMMENT bounds nothing — the boundary rides the same mask the tail does', 'legalNextStates after a commented `path:`', true, !!stateIds?.has('legalNextStates'));
  check('parseRegistrarSource', 'the NEXT route\'s handler symbol is not this route\'s implementation', 'getMetaItemLayered', false, !!stateIds?.has('getMetaItemLayered'));
  check('parseRegistrarSource', 'a variable `path:` bounds a window without claiming a tail — the recall half is untouched, not silently faked', 'tails', JSON.stringify(['/:name/state/:field']), JSON.stringify([...variablePath.keys()]));

  // The counterfactual: `parseRegistrarSource` verbatim as it stood before this hop —
  // literal `path:` lines are the only sites. Both halves have to be real for the block
  // above to prove anything: the defect must reach the foreign symbol, and it must do so
  // through the boundary and not through the 150-line cap.
  const literalOnlySites = (src) => {
    const ls = maskComments(src).split('\n');
    const sites = [];
    for (let i = 0; i < ls.length; i++) {
      const m = ls[i].match(/(?:^|[\s{,(])path\s*:\s*([`'"])(.*?)\1/);
      if (m) sites.push({ line: i, tail: routeTailOf(m[2]) });
    }
    const byTail = new Map();
    for (let k = 0; k < sites.length; k++) {
      const { line, tail } = sites[k];
      if (!tail) continue;
      const next = k + 1 < sites.length ? sites[k + 1].line : ls.length;
      const end = Math.min(next, line + REGISTRAR_HANDLER_WINDOW, ls.length);
      let ids = byTail.get(tail);
      if (!ids) byTail.set(tail, (ids = new Set()));
      for (let j = line; j < end; j++) for (const id of ls[j].matchAll(/[A-Za-z_$][\w$]*/g)) ids.add(id[0]);
    }
    return byTail;
  };
  const preFix = literalOnlySites(variablePathRegistrar);
  check('parseRegistrarSource', 'counterfactual: the literal-only site scan DID swallow the next route\'s handler whole', 'getMetaItemLayered', true, !!preFix.get('/:name/state/:field')?.has('getMetaItemLayered'));
  check('parseRegistrarSource', 'counterfactual: and the fixture is short enough that the 150-line cap is not what stops it', 'lines under the window', true, variablePathRegistrar.split('\n').length < REGISTRAR_HANDLER_WINDOW);

  // End to end through the same selection step the bridge runs.
  check('bridge', 'a diff touching only the FOREIGN handler\'s symbol selects no route', 'tails', JSON.stringify([]), JSON.stringify(tailsSelectedBy(new Set(['getMetaItemLayered']), variablePath)));
  check('bridge', 'the pre-fix behaviour, held as the counterfactual: it DID select the state route', 'tails', JSON.stringify(['/:name/state/:field']), JSON.stringify(tailsSelectedBy(new Set(['getMetaItemLayered']), preFix)));
  check('bridge', 'a diff touching the site\'s own symbol still selects its own route', 'tails', JSON.stringify(['/:name/state/:field']), JSON.stringify(tailsSelectedBy(new Set(['legalNextStates']), variablePath)));

  // ---- the CLI command anchor kind (#9230) ----------------------------------
  // The recall class: a CLI-surface change derives `MetaResync` / a lowercase `resync`,
  // and neither reaches the page that documents the command. The phrase does. Both halves
  // are pinned — the phrase that must now be derived, AND the bare token that must stay
  // dropped, because buying recall by loosening the shape guard is the one fix this card
  // rules out (19 pages → 49, measured).

  const commandIdCases = [
    // [path under the commands root, expected id, label]
    ['meta/resync.ts', 'meta resync', 'topic + command — the #9230 specimen'],
    ['build.ts', 'build', 'a top-level command'],
    ['migrate/recorded-by.ts', 'migrate recorded-by', 'a hyphen is an ordinary id char'],
    ['migrate/index.ts', 'migrate', 'a topic index IS the topic, not "migrate index"'],
    ['a/b/c.ts', 'a b c', 'deeper nesting is read off the path, not special-cased'],
    ['cloud/whoami.js', 'cloud whoami', 'the compiled extension resolves the same way'],

    ['meta/resync-skip-explanation.test.ts', null, 'a test file leaves a `.test` segment — declined, not guessed'],
    ['__tests__/helper.ts', null, 'an underscore dir is not an oclif id segment'],
    ['meta/fixture.json', null, 'a non-source file under the commands dir'],
    ['index.ts', null, 'a bare index at the commands root would name the binary, not a command'],
    ['meta/Resync.ts', null, 'an uppercase filename is not an oclif id'],
  ];
  for (const [rel, want, label] of commandIdCases) check('commandIdFor', label, rel, want, commandIdFor(rel));

  // Binary names come from what the package DECLARES — `oclif.bin` first (it is the
  // canonical spelling, and the one the phrase token is built from), then every `bin` key.
  const binCases = [
    [{ oclif: { bin: 'os' }, bin: { objectstack: './bin/run.js', os: './bin/run.js' } }, ['os', 'objectstack'], 'the real @objectstack/cli manifest — canonical first'],
    [{ oclif: {}, bin: { os: './bin/run.js' } }, ['os'], 'no oclif.bin: the bin keys still stand'],
    [{ oclif: { bin: 'os' } }, ['os'], 'oclif.bin alone'],
    [{ bin: { os: './bin/run.js' } }, [], 'a package with NO oclif key is not a CLI — never guessed at'],
    [{ oclif: { bin: 'tool' }, bin: './bin/run.js', name: '@scope/tool-cli' }, ['tool', 'tool-cli'], 'the string `bin` shorthand falls back to the unscoped package name'],
    [null, [], 'an unreadable manifest yields nothing'],
  ];
  for (const [pkg, want, label] of binCases) {
    check('oclifBinNamesOf', label, JSON.stringify(pkg), JSON.stringify(want), JSON.stringify(oclifBinNamesOf(pkg)));
  }

  // The path gate: only a package that declares `oclif`, and only under its commands dir.
  const cliPkg = { name: '@objectstack/cli', oclif: { bin: 'os' }, bin: { objectstack: 'x', os: 'x' } };
  const cliTree = new Set(['packages/cli', 'packages/spec']);
  const readFakePkg = (dir) => (dir === 'packages/cli' ? cliPkg : { name: '@objectstack/spec' });
  const anchorFor = (f) => commandAnchorFor(f, readFakePkg, (d) => cliTree.has(d));
  const commandAnchorCases = [
    ['packages/cli/src/commands/meta/resync.ts', 'os meta resync', 'the specimen resolves to its phrase'],
    ['packages/cli/src/commands/build.ts', 'os build', 'a top-level command'],
    ['packages/cli/src/utils/schema-migrate.js', null, 'a CLI file OUTSIDE the commands dir is not a command'],
    ['packages/spec/src/commands/thing.ts', null, 'a commands dir in a package that declares no oclif is ignored'],
    ['packages/cli/package.json', null, 'the manifest itself is not a command'],
  ];
  for (const [path, want, label] of commandAnchorCases) {
    check('commandAnchorFor', label, path, want, anchorFor(path)?.token ?? null);
  }
  check('commandAnchorFor', 'a declined shape under the commands dir is reported, not dropped silently',
    'packages/cli/src/commands/__tests__/helper.ts', true, anchorFor('packages/cli/src/commands/__tests__/helper.ts')?.unmapped === true);
  check('commandAnchorFor', 'a file outside any commands dir is not reported as unmapped either',
    'packages/cli/src/utils/schema-migrate.js', null, anchorFor('packages/cli/src/utils/schema-migrate.js'));

  // The doc-side matcher. `os meta resync` must find the page that writes it and must NOT
  // find prose that merely uses the words.
  const cmdRe = commandPatternFor('meta resync', ['os', 'objectstack']);
  const commandMatchCases = [
    ['`os migrate`, `os meta resync`, a test run.', true, 'the real drivers.mdx line — inside a code span'],
    ['Run `objectstack meta resync --json` to re-sync.', true, 'the alternate declared binary'],
    ['npx objectstack meta resync', true, 'the npx form is the same phrase with a prefix'],
    ['os  meta\tresync', true, 'extra horizontal whitespace between the words'],
    ['resync the metadata cache', false, 'the BARE token never matches — the whole point of the phrase'],
    ['the meta resync step', false, 'the words without a binary name are prose'],
    ['macos meta resync', false, 'a binary name must stand alone, not end another word'],
    ['os meta resyncAll', false, 'a longer identifier is not the command'],
    ['os meta resync-plan', false, 'a sibling command id is not this one'],
    ['os meta\nresync', false, 'a line break is not intra-command whitespace'],
  ];
  for (const [text, want, label] of commandMatchCases) {
    check('commandPatternFor', label, JSON.stringify(text), want, cmdRe.test(text));
  }

  // ⛔ The load-bearing half. The shape guard is EXEMPTED for phrase kinds and otherwise
  // untouched: `resync` on its own is still not code-shaped, so the `symbol`/`literal`/
  // `sdk` kinds still drop it. If this pair ever disagrees, recall was bought by
  // neutralising the guard — the fix #9230 explicitly rules out.
  check('isCodeShaped', 'the BARE command token is still dropped as prose-shaped', 'resync', false, isCodeShaped('resync'));
  const guardKindCases = [
    ['command', true, 'a command phrase is distinctive by construction'],
    ['route', true, 'a wire path is too'],
    ['symbol', false, 'a symbol is still judged by its spelling'],
    ['literal', false, 'so is a string literal'],
    ['sdk', false, 'so is an SDK method'],
  ];
  for (const [kind, want, label] of guardKindCases) {
    check('PHRASE_ANCHOR_KINDS', label, kind, want, PHRASE_ANCHOR_KINDS.has(kind));
  }

  // ---- the rule-block anchor kind (#9282) -----------------------------------
  // The recall class: a module whose DOC COMMENT is the surface. `declared-fields.ts`
  // exports one function no restating page names, so a change to the rule it states
  // derived nothing and the run reported "no opinion" — read by a reader as "nothing to
  // check". Pinned here in three directions: the expressions that must now be derived,
  // the CALLER-LIST names that must stay dropped (they took the specimen from 7 pages to
  // 27), and the honest-failure property that made the defect filable at all.

  // Block detection. The tag is an opt-in, so an untagged block must contribute nothing
  // however well-formed it is.
  const blockSource = [
    '// Copyright',                                    // 0
    '/**',                                             // 1
    ' * An ordinary doc comment with `record.a != null` in it.',  // 2
    ' */',                                             // 3
    'export function untagged() {}',                   // 4
    '/**',                                             // 5
    ' * The rule.',                                    // 6
    ' *',                                              // 7
    ' * `has(record.x) && record.x != null` before any traversal.',  // 8
    ' *',                                              // 9
    ' * @docs-rule',                                   // 10
    ' */',                                             // 11
    'export function tagged() {',                      // 12
    '  return 1;',                                     // 13
    '}',                                               // 14
  ].join('\n');
  const blocks = docCommentBlocks(blockSource.split('\n'));
  check('docCommentBlocks', 'both comment blocks are found', 'count', 2, blocks.length);
  check('docCommentBlocks', 'an UNTAGGED block is not a rule block', 'block 1', false, blocks[0].tagged);
  check('docCommentBlocks', 'a tag anywhere in the block tags it', 'block 2', true, blocks[1].tagged);
  check('docCommentBlocks', 'the tagged range starts at its `/**`', 'start', 5, blocks[1].start);
  check('docCommentBlocks', 'the tagged range ends at its `*/`', 'end', 11, blocks[1].end);
  const oneLiner = docCommentBlocks(['/** @docs-rule `a.b != null` */', 'const x = 1;']);
  check('docCommentBlocks', 'a single-line block opens and closes on one line', 'count', 1, oneLiner.length);
  check('docCommentBlocks', 'a single-line block is not left open', 'end', 0, oneLiner[0]?.end);
  const unterminated = docCommentBlocks(['/**', ' * @docs-rule', ' * truncated']);
  check('docCommentBlocks', 'an UNTERMINATED block runs to EOF rather than vanishing', 'end', 2, unterminated[0]?.end);

  // Whole-block scope, and only for a tagged block. Line-scoping measured the specimen
  // down to ZERO: the changed line's own span was `has()`, which is not an expression.
  const ruleAt = (src, lineNo) => ruleAnchorsFromSource(src, [lineNo]);
  check('ruleAnchorsFromSource', 'a change ANYWHERE in a tagged block yields the whole block\'s expressions',
    'line 7 (a blank comment line)', JSON.stringify(['has(record.x) && record.x != null']),
    JSON.stringify([...ruleAt(blockSource, 7).spans]));
  check('ruleAnchorsFromSource', 'the tag line itself is inside the block', 'line 11', true, ruleAt(blockSource, 11).touched);
  check('ruleAnchorsFromSource', 'a change in an UNTAGGED block yields nothing', 'line 3', false, ruleAt(blockSource, 3).touched);
  check('ruleAnchorsFromSource', 'the untagged block\'s expression is NOT borrowed by the tagged one',
    'line 3', JSON.stringify([]), JSON.stringify([...ruleAt(blockSource, 3).spans]));
  check('ruleAnchorsFromSource', 'a change to the FUNCTION BODY below is not a rule change — it anchors on the symbol as always',
    'line 14', false, ruleAt(blockSource, 14).touched);
  // The honest-failure half: a tagged block that changed and yielded nothing must be
  // DISTINGUISHABLE from a file that carries no tag at all. `touched` is what the caller
  // publishes as `unanchoredRuleBlocks`; collapsing it into the empty span set is how this
  // tool would go back to reading as "nothing to check".
  const emptyRule = ruleAnchorsFromSource(['/**', ' * @docs-rule', ' * Prose only, no spans.', ' */'].join('\n'), [3]);
  check('ruleAnchorsFromSource', 'a tagged block with no expression still reports TOUCHED', 'touched', true, emptyRule.touched);
  check('ruleAnchorsFromSource', 'and reports an empty span set beside it, not instead of it', 'spans', 0, emptyRule.spans.size);

  // The expression predicate — the half that earns the PHRASE_ANCHOR_KINDS exemption.
  // Left column: real spans from the specimen block. Right column: the specimen's own
  // CALLER LIST and table punctuation, whose admission is what measured 27 pages.
  const ruleExprCases = [
    ['has(record.x) && record.x != null', true, 'the canonical guard — the #9282 specimen'],
    ['record.x != null', true, 'the two-term half'],
    ['has(record.v) && has(record.v.a) && record.v.a == true', true, 'the nested form'],
    ['has(record.l) && has(record.l.lat) && record.l.lat > 40.0', true, 'the ordering form'],
    ['record.done == true', true, 'an authored predicate'],
    ['record.b.size() > 0', true, 'a method call plus a comparison'],

    ['visibleWhen', false, 'a CALLER-LIST name is not the rule — it anchors through `symbol`'],
    ['requiredWhen', false, 'ditto'],
    ['readonlyWhen', false, 'ditto — these three took the specimen from 7 pages to 27'],
    ['sys_approval_request', false, 'a snake_case name is still just a name'],
    ['record.x', false, 'a bare reference has no operator'],
    ['has()', false, 'the changed line of the measured edit — NOT an expression on its own'],
    ['record.x.k', false, 'a traversal without an operator'],
    [' is uniformly TRUE (a materialised ', false, 'prose a stray backtick paired across two lines'],
    [' | ', false, 'table punctuation'],
    ['<=', false, 'a bare operator with nothing to compare'],
    ['(a) => a.b', false, 'an arrow is not a comparison — `=>` is excluded from the bare `>` arm'],
  ];
  for (const [span, want, label] of ruleExprCases) check('isRuleExpression', label, JSON.stringify(span), want, isRuleExpression(span));

  // The doc-side matcher. It must find the three pages that RESTATE the rule and must not
  // fire on a page that merely uses the words.
  const ruleRe = rulePatternFor('has(record.x) && record.x != null');
  const ruleMatchCases = [
    ['use `has(record.x) && record.x != null` before any traversal', true, 'the restated rule in a code span'],
    ['has(record.x)  &&  record.x  !=  null', true, 'reformatted horizontal whitespace'],
    ['has(record.x) && record.x != nullable', false, 'a longer word is not the rule'],
    ['has(record.x) && record.x != null\n', true, 'a trailing newline still ends the span'],
    ['has(record.x) &&\nrecord.x != null', false, 'a line break is not intra-expression whitespace'],
    ['has(record.y) && record.y != null', false, 'a different binding is a different expression'],
  ];
  for (const [text, want, label] of ruleMatchCases) {
    check('rulePatternFor', label, JSON.stringify(text), want, ruleRe.test(text));
  }
  check('rulePatternFor', 'a two-term span does not match a longer identifier tail',
    'record.xy != null', false, rulePatternFor('record.x != null').test('record.xy != null'));

  // ⛔ The load-bearing half, exactly as #9230 pinned it for `command`: the exemption is
  // BESIDE the shape guard, never a loosening OF it. A bare name lifted out of a rule
  // block is still dropped by every single-token kind.
  check('isCodeShaped', 'a caller-list name from a rule block is still prose-shaped', 'visibleWhen', true, isCodeShaped('visibleWhen'));
  check('isCodeShaped', 'and a genuinely bare one still is not', 'record', false, isCodeShaped('record'));
  check('PHRASE_ANCHOR_KINDS', 'a rule expression is distinctive by construction', 'rule', true, PHRASE_ANCHOR_KINDS.has('rule'));

  // String literals on a changed line: an identifier-shaped one is surface, English is not.
  const litLines = ["  if (rule === 'controlled_by_parent') return maskFieldValue(v);", "  fs.readFileSync(p, 'utf8');", "  logger.warn('ignore');"];
  const lits = literalAnchorsFromLines(litLines, [1, 2, 3]).literals;
  const literalCases = [
    ['controlled_by_parent', true, 'a snake_case literal IS an authoring surface'],
    ['utf8', false, 'an encoding name is not surface'],
    ['ignore', false, 'an English word is not surface'],
  ];
  for (const [lit, want, label] of literalCases) check('literalAnchorsFromLines', label, lit, want, lits.has(lit));

  // ── `computedOn` (#9519): the record that names WHICH TREE the answer is about ──
  // Pinned on the pure shaper, so these stay hermetic; the probing wrapper reads real
  // git state by construction. Two properties carry the field's whole value: a merge
  // commit's parents must survive as a PAIR — that pair is the only durable handle on
  // an ephemeral `refs/pull/N/merge` tree — and "could not tell" must never be
  // flattened into "checked, clean".
  const mergeParents = '097fe96e1228f7da71f87e8f5ed95ae2739b53f1 047457ca3a8757012043460b8ded6090cbc9b114';
  const computedOnCases = [
    // [label, want, got]
    ['a merge commit keeps BOTH parents, in order',
      JSON.stringify(mergeParents.split(' ')), JSON.stringify(computedOnFrom('m', mergeParents, 'b', '').headParents)],
    ['an ordinary commit has exactly one, trailing newline stripped',
      JSON.stringify(['p1']), JSON.stringify(computedOnFrom('m', 'p1\n', 'b', '').headParents)],
    ['a root commit has none — never a [""] entry',
      JSON.stringify([]), JSON.stringify(computedOnFrom('m', '', 'b', '').headParents)],
    ['a failed parent probe degrades to [] rather than throwing',
      JSON.stringify([]), JSON.stringify(computedOnFrom('m', null, 'b', '').headParents)],
    ['the head sha is trimmed', 'abc', computedOnFrom('abc\n', 'p', 'b', '').head],
    ['a failed head probe is null, never the empty string', null, computedOnFrom(null, 'p', 'b', '').head],
    ['`--all` diffs nothing, so it names no base', null, computedOnFrom('m', 'p', null, '').diffBase],
    ['a clean checkout is dirty=false', false, computedOnFrom('m', 'p', 'b', '').dirty],
    ['a modified page is dirty=true', true, computedOnFrom('m', 'p', 'b', ' M content/docs/x.mdx\n').dirty],
    ['an UNTRACKED page counts too — walk() reads the filesystem, not the index',
      true, computedOnFrom('m', 'p', 'b', '?? content/docs/new.mdx\n').dirty],
    ['a failed status probe is null — "could not tell" is not "checked, clean"',
      null, computedOnFrom('m', 'p', 'b', null).dirty],
    ['the record carries exactly the four declared members',
      'head,headParents,diffBase,dirty', Object.keys(computedOnFrom('m', 'p', 'b', '')).join(',')],
  ];
  for (const [label, want, got] of computedOnCases) check('computedOnFrom', label, 'computedOn', want, got);

  // --- the sdk bridge's REACH over the declared surface (#9572) ---------------
  // What these pin is the honesty of the number, not its value: a reachable row must be
  // counted reachable, an unreachable one must be counted unreachable, and a scan that
  // came back structurally empty must carry a VERDICT rather than a clean-looking zero.
  // A ledger record as `parseLedgerSource` returns one. Spelled through a helper so a
  // fixture cannot quietly omit the declared counts — `bridgeCoverageFrom` reads them with
  // no default on purpose, and a fixture that skipped them would throw rather than pass.
  const covLedger = (file, rows) => ({
    file,
    rows,
    declined: [],
    routesDeclared: rows.length,
    clientsDeclared: rows.filter((r) => r.client).length,
    outsideCode: [],
  });
  const covLedgers = [
    covLedger('a-route-ledger.ts', [
      // selected by the `/:type/:name/audit` tail — the bridge's worked example
      { route: 'GET /api/v1/meta/:type/:name/audit', client: 'meta.getAudit' },
      // a literal whose registrar writes it as `${metaPath}/:type`: the interpolation is
      // stripped, `/:type` is one segment, `routeTailOf` declines it, and no tail selects
      // this row — the single largest cause behind today's 176 (34 rest rows).
      { route: 'GET /api/v1/meta/:type', client: 'meta.getItems' },
      // better-auth mounts this one: no `path:` property exists anywhere to produce a tail
      { route: 'POST /api/v1/auth/sign-in/email', client: 'auth.login' },
      // server-only rows are not part of the population at all
      { route: 'GET /health', client: null },
    ]),
  ];
  const cov = bridgeCoverageFrom(covLedgers, ['/:type/:name/audit', '/:type/:name/history']);
  const covCases = [
    ['only client-bound rows are counted — a server-only row is not a miss', 3, cov.clientRows],
    ['a row a tail selects is reachable', 1, cov.reachable],
    ['a row no tail selects is UNREACHABLE, not clean', 2, cov.unreachable],
    ['reachable + unreachable is the whole population', 3, cov.reachable + cov.unreachable],
    ['a working scan carries no broken-scan verdict', 0, cov.brokenScan.length],
    ['the answer is marked as measured', true, cov.measured],
  ];
  for (const [label, want, got] of covCases) check('bridgeCoverageFrom', label, 'coverage', want, got);

  // ZERO IS NOT A CLEAN REPO, IT IS A BROKEN SCAN. Each arm below currently reports
  // `0 of 0 unreachable` — arithmetically true, and the exact shape #9747 catalogues as
  // a false green. `.some(...)` on the text, so a reworded verdict does not fail the pin
  // while a MISSING verdict does.
  const noLedgers = bridgeCoverageFrom([], ['/:type/:name/audit']);
  check('bridgeCoverageFrom', 'no ledger file at all is a verdict, not `0 of 0`', 'brokenScan',
    true, noLedgers.brokenScan.some((v) => v.includes('no route-ledger file')));
  const noTails = bridgeCoverageFrom(covLedgers, []);
  check('bridgeCoverageFrom', 'a registrar scan with no tail is a verdict, not "everything unreachable"', 'brokenScan',
    true, noTails.brokenScan.some((v) => v.includes('no route tail')));
  check('bridgeCoverageFrom', 'and it still reports the population it could not reach', 'unreachable', 3, noTails.unreachable);
  const unreadable = bridgeCoverageFrom([covLedger('b-route-ledger.ts', [])], ['/x/:y']);
  check('bridgeCoverageFrom', 'a ledger that matched the convention but parsed 0 rows is a verdict', 'brokenScan',
    true, unreadable.brokenScan.some((v) => v.includes('parsed 0 rows')));
  // ⛔ The counter-case, and it is the one that keeps the verdict above honest: two of
  // today's seven ledgers are wholly `server-only`, so ZERO CLIENT-BOUND ROWS is a
  // correct answer and must never be a verdict.
  const serverOnly = bridgeCoverageFrom([covLedger('c-route-ledger.ts', [{ route: 'GET /api/v1/datasources', client: null }])], ['/x/:y']);
  check('bridgeCoverageFrom', 'an all-server-only ledger is accurate, not broken', 'brokenScan', 0, serverOnly.brokenScan.length);

  // --- #11178: WHY a row is unreachable, and the two causes that printed as one --------
  // `56 of 56` (auth) and `46 of 87` (rest) render identically today and are not the same
  // finding: the first surface has NO in-repo registration site, so the discovery widening
  // the second one wants moves it by zero rows — measured, before this split existed.
  const ceilSrc = [
    ['r-registers.ts', "app.get({ path: '/api/v1/storage/upload/presigned' }, handler);"],
    ['r-comments.ts', "// path: '/api/v1/never/registered' — an illustration, not a registration\n"],
    ['r-silent.ts', 'export const answer = 1;\n'],
  ];
  const ceil = maximalTailsFrom(ceilSrc.map(([file, text]) => ({ file, text })));
  check('maximalTailsFrom', 'a real `path:` reaches the ceiling', 'tails',
    true, ceil.has('/api/v1/storage/upload/presigned'));
  check('maximalTailsFrom', 'and NAMES its file, so "discovery could reach this" can point at the witness',
    'witness', 'r-registers.ts', (ceil.get('/api/v1/storage/upload/presigned') || [])[0]);
  // The ceiling reads CODE, exactly like the scan it bounds — a ceiling built off prose
  // would invent remediable rows and empty the structural bucket without moving a byte.
  check('maximalTailsFrom', 'a `path:` in a COMMENT is not a registration', 'tails',
    false, ceil.has('/api/v1/never/registered'));
  check('maximalTailsFrom', 'and a file with no `path` at all contributes nothing', 'tails', 1, ceil.size);

  // The four shapes today's seven ledgers actually take, each derived from the ceiling
  // rather than from a list of ledger names — a hand-kept list is the defect this card
  // family keeps hitting, one level up.
  const causeLedgers = [
    covLedger('structural-route-ledger.ts', [
      { route: 'POST /api/v1/auth/sign-in/email', client: 'auth.login' },
      { route: 'POST /api/v1/auth/sign-out', client: 'auth.logout' },
    ]),
    covLedger('gap-route-ledger.ts', [{ route: 'POST /api/v1/storage/upload/presigned', client: 'storage.presign' }]),
    covLedger('mixed-route-ledger.ts', [
      { route: 'GET /api/v1/data/import/jobs', client: 'data.listImportJobs' },
      { route: 'GET /api/v1/meta/:type', client: 'meta.getItems' },
    ]),
    covLedger('serveronly-route-ledger.ts', [{ route: 'GET /health', client: null }]),
  ];
  const causeCov = bridgeCoverageFrom(causeLedgers, ['/x/:y'],
    ['/api/v1/storage/upload/presigned', '/api/v1/data/import/jobs']);
  const causeOf = (f) => causeCov.ledgers.find((l) => l.file === f).cause;
  const causeCases = [
    // THE ONE THIS CARD IS ABOUT: not one row of the surface is declared anywhere in-repo.
    ['a ledger no in-repo file declares ANY row of is structural', 'no-in-repo-registrar', causeOf('structural-route-ledger.ts')],
    ['a ledger whose every unreachable row has an in-repo witness is a discovery gap', 'discovery-gap', causeOf('gap-route-ledger.ts')],
    // ⛔ NOT defaulted into either bucket — the #9747 rule this whole split is an
    // application of: a recognizer narrower than the repo reports "unrecognised".
    ['a ledger with witnesses for SOME rows is undecided, not quietly structural', 'undecided', causeOf('mixed-route-ledger.ts')],
    ['a wholly server-only ledger has no client surface to reach, which is not a cause', 'no-client-surface', causeOf('serveronly-route-ledger.ts')],
    ['the structural verdict counts only the ledger that earned it', 2, causeCov.causes.structural],
    ['a witnessed row is remediable whichever ledger carries it', 2, causeCov.causes.remediable],
    ['and the undecided rows are neither', 1, causeCov.causes.undecided],
    // A PARTITION, pinned as one: a bucket that starts absorbing another keeps every count
    // above green while this fails.
    ['remediable + structural + undecided IS the unreachable population', causeCov.unreachable,
      causeCov.causes.remediable + causeCov.causes.structural + causeCov.causes.undecided],
    ['a working census carries no broken-scan verdict', 0, causeCov.brokenScan.length],
  ];
  for (const [label, want, got] of causeCases) check('bridgeCoverageFrom', label, 'cause', want, got);

  // ⛔ THE FIGURE THIS MAY NOT MOVE. Other cards cite `45 reachable` (#10534, #9572), and
  // the split explains that number rather than participating in it: same ledgers, same
  // discovery tails, a ceiling bolted on — the reach is identical or this is a widening.
  check('bridgeCoverageFrom', 'supplying a ceiling explains the reach without moving it', 'reachable',
    cov.reachable, bridgeCoverageFrom(covLedgers, ['/:type/:name/audit', '/:type/:name/history'], ['/api/v1/auth/sign-in/email']).reachable);

  // ABSENT IS NOT EMPTY. A caller that measured no ceiling must not read as "no structural
  // rows" — the same rule the declared counts above are read under.
  const noCeiling = bridgeCoverageFrom(covLedgers, ['/:type/:name/audit', '/:type/:name/history']);
  const absentCases = [
    ['a run with no ceiling says so', false, noCeiling.causes.measured],
    ['and says it on every ledger rather than picking a bucket', true, noCeiling.ledgers.every((l) => l.cause === 'unmeasured')],
    ['and the counts are null, not 0 — "nobody looked" is not "none found"', null, noCeiling.causes.structural],
    ['and the reach it could not explain is still reported whole', 2, noCeiling.unreachable],
  ];
  for (const [label, want, got] of absentCases) check('bridgeCoverageFrom', label, 'unmeasured', want, got);

  // THE CEILING CANNOT SIT BELOW THE FLOOR. Built as a superset by construction, so this
  // cannot fire on a census built the way `maximalTailsFrom` builds one — which is exactly
  // what makes it a verdict rather than a number, on the `brokenScan` terms above.
  const sunkCeiling = bridgeCoverageFrom(
    [covLedger('t-route-ledger.ts', [{ route: 'GET /api/v1/meta/:type/:name/audit', client: 'meta.getAudit' }])],
    ['/:type/:name/audit'], []);
  check('bridgeCoverageFrom', 'a ceiling that misses a REACHABLE row is a broken census, not a finding', 'brokenScan',
    true, sunkCeiling.brokenScan.some((v) => v.includes('ceiling')));
  check('bridgeCoverageFrom', 'and a ceiling that contains it carries no verdict', 'brokenScan', 0,
    bridgeCoverageFrom(
      [covLedger('t-route-ledger.ts', [{ route: 'GET /api/v1/meta/:type/:name/audit', client: 'meta.getAudit' }])],
      ['/:type/:name/audit'], ['/:type/:name/audit']).brokenScan.length);

  // The selection rule itself, pinned once — both the count and the row list read it, so a
  // change here moves them together or fails here.
  const selects1 = selectsFrom(['/:type/:name/audit', '/:type/:name/history']);
  const selectCases = [
    ['a tail the row ends with selects it', true, selects1('GET /api/v1/meta/:type/:name/audit')],
    ['the method prefix does not defeat the suffix test', true, selects1('DELETE /api/v1/meta/:type/:name/history')],
    ['a row no tail ends is not selected', false, selects1('POST /api/v1/auth/sign-in/email')],
    ['a PREFIX match is not a selection — the rule is a suffix test', false, selects1('GET /:type/:name/audit/entries')],
    ['no tails at all selects nothing', false, selectsFrom([])('GET /api/v1/meta/:type/:name/audit')],
  ];
  for (const [label, want, got] of selectCases) check('selectsFrom', label, 'route', want, got);

  // PRESENCE, not merely shape. The field is worth nothing unless it reaches the JSON
  // the workflow renders, and a rename or a dropped line there returns the comment to
  // the unnamed-tree state this field exists to end — with every pin above still green.
  // Read from source because the emitter writes to stdout under module-level flags and
  // cannot be called hermetically.
  const ownSource = readFileSync(new URL(import.meta.url), 'utf8');
  check('emit', 'the emitted JSON actually carries `computedOn`', 'affected-docs.mjs',
    true, /\bcomputedOn:\s*computedOnIdentity\(/.test(ownSource));
  // Same reasoning for the reach field, and one hop further: #9433 measured that a new
  // JSON key with no render branch in `docs-drift-check.yml` is HALF-WIRED — it reads as
  // published while no reader ever sees it. So both ends are pinned, from the two files.
  check('emit', 'the emitted JSON actually carries `bridgeCoverage`', 'affected-docs.mjs',
    true, /\bbridgeCoverage:\s*coverage,/.test(ownSource));
  const driftWorkflow = (() => {
    try { return readFileSync(new URL('../../.github/workflows/docs-drift-check.yml', import.meta.url), 'utf8'); } catch { return null; }
  })();
  check('emit', 'the drift comment RENDERS `bridgeCoverage` — an unrendered key is half-wired (#9433)', 'docs-drift-check.yml',
    true, driftWorkflow === null || /data\.bridgeCoverage/.test(driftWorkflow));
  // ── `causes` GETS THE SAME TREATMENT, AT BOTH ENDS (#11867) ─────────────────
  //
  // #9433's rule is about a KEY, not about this one key, so the sub-object that carries
  // the three-way cause split is pinned exactly the way `bridgeCoverage` above is — and
  // this time BOTH halves were separately broken. The advisory path published `causes`
  // for two cards while omitting the ceiling that populates it, so every ledger read
  // `unmeasured` and the three counts were `null`; and the workflow had no render branch
  // at all (measured: zero occurrences of `causes` in that file). Either half alone is
  // the half-wired state — a ceiling nobody renders is cost paid for no reader, and a
  // render branch with no ceiling prints `unmeasured` in a nicer shape.
  check('emit', 'the ADVISORY path measures causes — it passes a ceiling, not just tails', 'affected-docs.mjs',
    true, /bridgeCoverageFrom\(ledgers, registrarByTail\.keys\(\), ceilingTailsFrom\(sourceFiles\)\.keys\(\)\)/.test(ownSource));
  // ⚠️ READ THE CODE, NOT THE COMMENT THAT FORBIDS IT. These three pins are about what
  // the renderer DOES, and the block it lives in names `bridge.ledgers` in prose precisely
  // to forbid deriving from it — so a raw-text negative pin fails on its own rationale
  // (measured: it did, first run). Full-line `//` comments are dropped first; trailing
  // ones are left alone rather than risk eating a `//` inside a string.
  const driftWorkflowCode = driftWorkflow === null ? null
    : driftWorkflow.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  check('emit', 'the drift comment RENDERS `causes` — an unrendered key is half-wired (#9433)', 'docs-drift-check.yml',
    true, driftWorkflowCode === null || /bridge\.causes/.test(driftWorkflowCode));
  // AND THE BREAKDOWN MAY NOT BE ABLE TO DISAGREE WITH THE HEADLINE. The workflow's own
  // rule at that spot — "Same names, one derivation" — is what this pins: the renderer
  // reads the three counts off `bridge.causes` and the total off `bridge.unreachable`,
  // and refuses to print the split unless they partition. A renderer that recomputed the
  // parts from `bridge.ledgers` would satisfy the grep above while reintroducing exactly
  // the drift the partition exists to make visible.
  check('emit', 'the rendered split is GUARDED by the partition it claims to be', 'docs-drift-check.yml',
    true, driftWorkflowCode === null || /parts === bridge\.unreachable/.test(driftWorkflowCode));
  check('emit', 'and the renderer derives no cause count of its own from the ledger list', 'docs-drift-check.yml',
    true, driftWorkflowCode === null || !/bridge\.ledgers/.test(driftWorkflowCode));
  // WRITTEN ONCE, pinned at the source (#11494's rule, applied to the census). Two paths
  // now publish these three buckets; two spellings of the population they are computed
  // over is how two surfaces start disagreeing about one repo. `ceilingTailsFrom` is the
  // single builder, and an inline second copy is what this catches — every behavioural
  // fixture above would stay green while the two arms drifted apart.
  check('emit', 'the ceiling is built in exactly ONE place', 'affected-docs.mjs',
    1, (ownSource.match(/return maximalTailsFrom\(\(function\* \(\) \{/g) || []).length);
  // CALL SITES, which is why the lookbehind: the declaration shares the spelling, and
  // counting it would let one arm drop its call while the total stayed put.
  check('emit', 'and both arms that measure causes build it through that one place', 'affected-docs.mjs',
    2, (ownSource.match(/(?<!function )ceilingTailsFrom\(/g) || []).length);
  // `unreachableRows` is the detail of `unreachable`, and the only way it can contradict
  // that count is by deriving selection a second time. Pinned at the source, because the
  // two agreeing today is what a re-statement costs nothing to break tomorrow.
  check('emit', 'the --json row list selects through `selectsFrom`, not a second copy of the rule', 'affected-docs.mjs',
    true, /const selects = selectsFrom\(registrarByTail\.keys\(\)\);/.test(ownSource));
  check('emit', 'and nothing else restates the suffix test inline', 'affected-docs.mjs',
    1, (ownSource.match(/\.some\(\(t\) => route\.replace\(/g) || []).length);

  // WRITTEN ONCE, pinned at the source (#11494). The defect was not that `declarationsIn`
  // chose the wrong class — it was that eight scans each spelled the class for themselves,
  // so seven agreeing and one differing looked exactly like eight agreeing. A ninth inline
  // copy is the same hole re-opening, and only a source pin can see it: every behavioural
  // fixture above would keep passing while the new scan drifted on its own.
  check('declLead', 'the run between a `route:`/`client:` colon and its value is spelled ONCE', 'affected-docs.mjs',
    1, (ownSource.match(/String\.raw`\(\?<!\[\^\\s\{,\]\)\$\{keys\}\\s\*:\\s\*`/g) || []).length);
  check('declLead', 'and all eight lead scans are built from it, none inline', 'affected-docs.mjs',
    8, (ownSource.match(/new RegExp\(declLead\(/g) || []).length);
  // …AND THE KEY ANCHOR IS SPELLED ONCE TOO (#11542), which is the same pin one field over.
  // It was the LAST part of the lead each call site decided for itself: `declarationsIn`
  // passed `\b(route|client)` and the other seven passed the key bare, so seven agreeing and
  // one differing looked exactly like eight agreeing — and the one that differed was the one
  // that was right. A call site that restates the anchor is that hole re-opening from the
  // other side, and only a source pin can see it: every behavioural fixture above stays green
  // while the argument drifts. #11630 widened the anchor past `\b` to a LOOKBEHIND, so the pin
  // now rejects BOTH spellings — a call site that restated the old `\b` and one that grew a
  // lookbehind of its own are the same defect, and pinning only the form we just moved away
  // from would leave the pin watching a door nobody uses any more.
  check('declLead', 'and the KEY anchor is spelled once too — no call site restates it', 'affected-docs.mjs',
    0, (ownSource.match(/declLead\([^\n]*?(?:\\b|\(\?<!)/g) || []).length);
  // BEHAVIOURAL, not merely textual: every key spelling the eight call sites pass comes back
  // anchored, from the one place that spells the anchor. This is what "all eight read the same
  // anchored spelling" means when checked rather than asserted.
  //
  // The spellings are READ FROM THE SOURCE, never restated here (#11737). A hand-kept list
  // carried three of the FOUR the call sites actually pass — `client`, the one `windowClientRe`
  // passes, was missing — so a pin labelled "every key spelling" checked three quarters of
  // them, and nothing else could see the gap: this pin compares STRINGS, so `(route|client)`
  // never exercises `client`, and the three pins above count call sites and spellings by TEXT
  // without ever calling the function. A corrected list re-rots the same way the moment a
  // ninth call site arrives, which is why it is derived rather than corrected.
  //
  // Measured rather than argued: a `client`-only TIGHTENING of the allowlist — `(?<![^\s{,])`
  // narrowed to `(?<![^\s])` for that one key — leaves all of `--self-test` green against the
  // hand-kept list and fails HERE against the derived one. No fixture defends the `{` and `,`
  // members, and none can: the sweep below measured 0 leads preceded by either across all
  // seven live ledgers, so they are exactly the part of the allowlist that only a string pin
  // can hold. Widening drifts are caught either way (the #11542/#11630 `myclient:`/`$client:`
  // fixtures see those), so tightening is the whole of what this pin adds — and it is the
  // direction a `simplification` takes.
  //
  // ⛔ Only the INPUT population is derived; the EXPECTED stays a literal. Deriving both ends
  // is what would make the comparison vacuous, for the reason the sweep below spells out.
  const passedKeys = [...ownSource.matchAll(/new RegExp\(declLead\((['"])([^'"]*)\1\)/g)].map((m) => m[2]);
  check('declLead', 'and all eight pass their key as a LITERAL — a computed one drops out of the list below unseen', 'affected-docs.mjs',
    8, passedKeys.length);
  check('declLead', 'every key spelling a call site passes comes back ANCHORED', 'declLead',
    String.raw`(?<![^\s{,])(?:route|client)\s*:\s* | (?<![^\s{,])(route|client)\s*:\s* | (?<![^\s{,])client\s*:\s* | (?<![^\s{,])route\s*:\s*`,
    [...new Set(passedKeys)].sort().map((k) => declLead(k)).join(' | '));
  // …and BEHAVIOURALLY the allowlist is a strict TIGHTENING of BOTH anchors it has replaced,
  // which is the invariant the population pricing rests on. Swept rather than argued, and
  // swept against the anchor it ACTUALLY replaces (#11710's lookbehind) as well as against the
  // `\b` two cards back: a sweep that only ever compares with the oldest spelling stops being
  // evidence the moment two cards land in a row.
  {
    const bAnchor = new RegExp(String.raw`\b(route|client)\s*:\s*`);
    // The lookbehind this card replaces, spelled here as a LITERAL rather than taken from
    // `declLead` — it is the BEFORE state, so reading it from the function under test would
    // make the comparison vacuous the moment the function changes.
    const prevAnchor = new RegExp(String.raw`(?<![\w$.])(route|client)\s*:\s*`);
    // Built through a NAMED intermediate on purpose: the pin above counts the eight
    // production lead SCANS by the way each one compiles `declLead` directly, and this probe
    // is a behavioural check rather than a ninth scan. Inflating that count to 9 would blunt
    // the pin that exists to catch a real ninth. Same convention the key-spelling check below
    // already uses (`.map((k) => declLead(k))`). ⛔ That pin reads this file as TEXT, so even
    // naming the compiled spelling in a comment here would count — it is described, not
    // quoted, for the same reason.
    const leadSource = declLead('(route|client)');
    const lead = new RegExp(leadSource);
    let admitsMoreThanB = 0;
    let admitsMoreThanPrev = 0;
    let admitsB = 0;
    let admitsPrev = 0;
    let admitsLead = 0;
    for (let c = 0; c < 0x3000; c++) {
      const s = String.fromCodePoint(c) + "route: 'x'";
      const b = bAnchor.test(s);
      const q = prevAnchor.test(s);
      const l = lead.test(s);
      if (b) admitsB++;
      if (q) admitsPrev++;
      if (l) admitsLead++;
      if (l && !b) admitsMoreThanB++;
      if (l && !q) admitsMoreThanPrev++;
    }
    check('declLead', 'the anchor only ever REMOVES — it admits nothing `\\b` did not', 'code points 0..0x2FFF',
      0, admitsMoreThanB);
    check('declLead', 'and nothing the LOOKBEHIND it replaces did not — the invariant against the real before-state',
      'code points 0..0x2FFF', 0, admitsMoreThanPrev);
    check('declLead', 'and the allowlist is the far smaller set, by the margin the sweep measures',
      'code points 0..0x2FFF', '12225 / 12223 / 25', `${admitsB} / ${admitsPrev} / ${admitsLead}`);
  }


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
// The subset of `symbolAnchors` eligible to enter the route bridge — see §3b. Kept as
// its own set rather than recomputed there, because the container/leaf distinction is
// only knowable at DERIVATION time: by §3b a symbol is just a string.
const bridgeableSymbols = new Set();
const routeAnchors = new Set();
const literalAnchors = new Set();
const commandAnchors = new Map(); // canonical phrase → { id, bins }
const ruleAnchors = new Set();
const unmappedCommandFiles = [];
const unanchoredRuleBlocks = [];
const anchorlessChanges = [];

const readAt = (ref, file) => {
  try { return sh(`git show ${ref}:${file}`); } catch { return null; }
};

for (const f of implementationChanges) {
  // The command anchor is read off the PATH, so it is derived before the diff is opened
  // and survives a file that is added or deleted outright — the id lives in the location,
  // not in the contents.
  const cmd = commandAnchorFor(f);
  if (cmd?.unmapped) unmappedCommandFiles.push(f);
  if (cmd?.token) commandAnchors.set(cmd.token, { id: cmd.id, bins: cmd.bins });
  if (!/\.(?:ts|tsx|js|mjs|cjs)$/.test(f)) { anchorlessChanges.push(f); continue; }
  let diffText = '';
  try { diffText = sh(`git diff -U0 ${baseRef} HEAD -- ${JSON.stringify(f)}`); } catch { /* keep empty */ }
  const { oldLines, newLines } = changedLineNumbers(diffText);
  const before = oldLines.length ? readAt(baseRef, f) : null;
  const after = newLines.length ? (readAt('HEAD', f) ?? (existsSync(join(repoRoot, f)) ? readFileSync(join(repoRoot, f), 'utf8') : null)) : null;
  let found = cmd?.token ? 1 : 0;
  // Both sides again, and for the same reason a REMOVED export still anchors: DELETING a
  // rule block is exactly when the pages restating it need re-reading.
  let ruleBlockTouched = false;
  let ruleSpansHere = 0;
  for (const [text, changed] of [[after, newLines], [before, oldLines]]) {
    if (!text) continue;
    const sym = symbolAnchorsFromSource(text, changed);
    for (const name of sym.names) { symbolAnchors.add(name); found++; }
    for (const name of sym.bridgeable) bridgeableSymbols.add(name);
    const { routes, literals } = literalAnchorsFromLines(text.split('\n'), changed);
    for (const r of routes) { routeAnchors.add(r); found++; }
    for (const l of literals) { literalAnchors.add(l); found++; }
    const rule = ruleAnchorsFromSource(text, changed);
    if (rule.touched) ruleBlockTouched = true;
    for (const s of rule.spans) { ruleAnchors.add(s); ruleSpansHere++; found++; }
  }
  // A tagged block that changed and produced nothing is a DECLARED blind spot, published
  // like `unmappedCommandFiles` rather than left to be inferred from a gap. The file may
  // still have anchored through `symbol`, so this is not the same statement as
  // `anchorlessChanges` and is reported beside it, not instead of it.
  if (ruleBlockTouched && !ruleSpansHere) unanchoredRuleBlocks.push(f);
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
  if (!PHRASE_ANCHOR_KINDS.has(kind) && !isCodeShaped(token)) { weakAnchorsDropped.push(`${token} (${kind})`); return false; }
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
  // TWO KINDS OF SYMBOL ARE DOC ANCHORS BUT NOT BRIDGE SYMBOLS. The bridge's premise is
  // "this name IS some route's implementation, so the handler that implements that route
  // mentions it" — and `parseRegistrarSource` tests that premise by scanning a handler
  // window for the BARE IDENTIFIER (over comment-masked source since #9432, so a name a
  // handler only WRITES ABOUT never satisfies it). Any name a handler mentions for some
  // OTHER reason satisfies the scan without satisfying the premise, and mints a route (and,
  // through the ledger, an sdk) anchor from a diff that never came near that route.
  //
  //  1. A SCREAMING_SNAKE constant is a data table, not a route's implementation: it is
  //     referenced by handlers that merely consult it. `ERROR_CODE_LEDGER` names a real
  //     surface (4 pages on 30b1c636a) and stays a doc anchor, but in the bridge it
  //     dragged `/approvals/requests/:id/remind` into a wire-code registration change.
  //  2. A CONTAINER name — a class, interface, type, enum, namespace, or a `const`
  //     object that owns its keys — is the SCOPE a route's implementation lives in, not
  //     the implementation. Handlers mention it as a static-call qualifier
  //     (`RestServer.metaTypeSingular(…)`), a `new`, or a type annotation. Measured on
  //     9e2e68206 (#9294): a 27-line edit confined to `probeMcpServeable` — 17 of those
  //     lines its doc comment, which attributes to the enclosing class — put `RestServer`
  //     in the anchor set, and two handlers calling `RestServer.` statics ~1350 lines away
  //     bridged it to `/:type/:name/layers` and `/book/:name/tree`, and thence to
  //     `meta.getBookTree` / `getBookTree` on `api/client-sdk.mdx`. Three wrong rows off
  //     one qualifier. The cross-cutting cap could not catch it: two routes, cap three.
  //
  // ⭐ NEITHER is an exclusion from the anchor set. `RestServer (symbol)` is a CORRECT
  // row — the edited method really is in that class — and it survives this untouched;
  // only the bridge hop it was feeding is cut. The container's own members are unaffected:
  // most-specific-wins already anchors a changed method body on the METHOD, and a method
  // is a leaf, so `auditMetaItem` → `/:type/:name/audit` → `meta.getAudit` still bridges.
  // The failure direction if a container ever did belong in the bridge is a RECALL miss on
  // the `route`/`sdk` kinds only; the over-report this replaces was on `client-sdk.mdx`,
  // the page the bridge exists to reach, which is where a wrong row costs the most.
  if (!bridgeableSymbols.has(name)) continue;
  if (!/^[A-Z0-9_$]+$/.test(name)) bridgeSymbols.push(name);
}
for (const name of [...literalAnchors].sort()) admitAnchor('literal', name, symbolRe(name));
// Rule expressions face the CORPUS-SHARE guard like everything else — only the shape guard
// is skipped, and only because an operator-carrying span cannot be a bare lowercase word
// (see `PHRASE_ANCHOR_KINDS`). A rule stated in terms broad enough to name a quarter of the
// corpus is a hub term like any other, and is dropped and published in `overbroadAnchors`.
for (const span of [...ruleAnchors].sort()) admitAnchor('rule', span, rulePatternFor(span));
// Command phrases face the CORPUS-SHARE guard like everything else — only the shape guard
// is skipped, and only because the token cannot be a bare lowercase word (see
// `PHRASE_ANCHOR_KINDS`). A topic-level phrase broad enough to name a quarter of the docs
// is still a hub term, and still gets dropped and published in `overbroadAnchors`.
for (const token of [...commandAnchors.keys()].sort()) {
  const { id, bins } = commandAnchors.get(token);
  admitAnchor('command', token, commandPatternFor(id, bins));
}

// PHASE 2 — carry the surviving symbols across the surface boundary the package graph
// cannot cross. A changed protocol method appears in the HANDLER of the route it serves;
// the route ledgers then bind that route to the client method the SDK docs actually name.
// Both hops are declared data in the repo, not inference — and this is the hop that puts
// `api/client-sdk.mdx` back on the list for a `packages/metadata-protocol` change.
const sdkAnchors = new Set();
const crossCuttingSymbols = [];
// HOW MUCH OF THE DECLARED SURFACE THE BRIDGE COULD REACH (#9572). Reported, never
// implied — see `bridgeCoverageFrom`. `measured: false` is the honest answer for a run
// whose bridge never ran, and it is spelled out rather than rendered as a zero: this
// file draws that distinction everywhere else (`computedOn.dirty`'s null arm is the
// same rule), and a fabricated `0 of 0` here would read as "nothing to reach".
let bridgeCoverage = { measured: false, reason: 'no bridgeable symbol in this change — the sdk route bridge did not run' };
if (bridgeSymbols.length) {
  const { ledgers, ledgerRows, registrarByTail, sourceFiles } = scanRouteSurface();
  // WITH THE CEILING (#11867). Until now this call omitted the third argument, so every
  // ledger's cause came back `unmeasured` and the three counts `null` — honest, but it
  // meant the PR comment, which is the surface a human actually reads, rendered all 177
  // unreachable rows as ONE population when the census says there are three. The ceiling
  // is the ONLY input that turns "unreachable" into WHY, and the reader who needs that
  // distinction most is the one looking at a PR, not the one running a diff-free gate.
  //
  // WHAT IT COSTS, measured on this tree rather than assumed (`f5a7f9c88`, 7 warm runs of
  // each arm): the ceiling reads the 1950 `packages/**` source files this walk already
  // enumerated, of which 1106 pass `maximalTailsFrom`'s `path` prefilter, and yields the
  // same 82 tails `--bridge-coverage` builds. Median advisory run 0.652s → 1.998s, so
  // +1.35s — the same order as the ~1.4s recorded on `589758d22`, against a CI job
  // measured in minutes. It is paid ONLY on a run that already carried a bridgeable symbol.
  //
  // ⚠️ AND IT IS THE INPUT THAT WOULD REVERSE THIS. The cause split is worth ~1.35s on a
  // per-PR advisory run and would not be worth ~15s; whoever finds this number has grown
  // should re-take the decision, not absorb the cost. Re-measure with the two arms above.
  //
  // ⛔ Through `ceilingTailsFrom`, never a second inline census: `--bridge-coverage` and
  // this path now publish the same three buckets, and two spellings of the population they
  // are computed over is how the two surfaces start disagreeing about one repo.
  bridgeCoverage = bridgeCoverageFrom(ledgers, registrarByTail.keys(), ceilingTailsFrom(sourceFiles).keys());

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
  ? `${anchors.length} anchor(s) — ${symbolAnchors.size} symbol, ${routeAnchors.size} route, ${sdkAnchors.size} sdk, ${literalAnchors.size} literal, ${commandAnchors.size} command, ${ruleAnchors.size} rule`
  : 'no anchors derived';
const anchorlessNote = anchorlessChanges.length
  ? `; ⚠️ ${anchorlessChanges.length} changed file(s) yielded no anchor — this run cannot see pages documenting them`
  : '';
const unmappedCommandNote = unmappedCommandFiles.length
  ? `; ⚠️ ${unmappedCommandFiles.length} file(s) under a CLI commands dir yielded no command phrase (${unmappedCommandFiles.join(', ')})`
  : '';
const unanchoredRuleNote = unanchoredRuleBlocks.length
  ? `; ⚠️ ${unanchoredRuleBlocks.length} changed ${DOCS_RULE_TAG} block(s) yielded no expression anchor (${unanchoredRuleBlocks.join(', ')})`
  : '';
const overbroadNote = overbroadAnchors.length
  ? `; ${overbroadAnchors.length} over-broad anchor(s) dropped (${overbroadAnchors.join(', ')})`
  : '';
const crossCuttingNote = crossCuttingSymbols.length
  ? `; ${crossCuttingSymbols.length} cross-cutting symbol(s) contributed no route anchor (${crossCuttingSymbols.join(', ')})`
  : '';
// The bridge's own reach, stated on every run that used it (#9572). Without this line a
// reader cannot tell "no page documents this route's SDK method" from "this route is one
// of the 176 the bridge structurally cannot select", and those are opposite facts.
const bridgeCoverageNote = bridgeCoverage.measured
  ? `; the sdk route bridge reached ${bridgeCoverage.reachable} of ${bridgeCoverage.clientRows} client-bound ledger row(s)`
    + (bridgeCoverage.unreachable ? ` — ⚠️ ${bridgeCoverage.unreachable} unreachable, so pages documenting THEIR client methods are invisible to this run (\`--bridge-coverage\` lists them)` : '')
    + (bridgeCoverage.brokenScan.length ? `; ⛔ ${bridgeCoverage.brokenScan.length} broken-scan verdict(s): ${bridgeCoverage.brokenScan.join('; ')}` : '')
  : '';

emit(
  affected.map((a) => a.doc),
  changedPackages,
  `${affected.length} docs name something this change touched (${anchorSummary}) across ${changedPackages.length} changed package(s) since ${sinceRef}${skipNote}${anchorlessNote}${unmappedCommandNote}${unanchoredRuleNote}${crossCuttingNote}${bridgeCoverageNote}${overbroadNote}`,
  affected,
  { testFilesSkipped, scriptFilesSkipped, devOnlyManifestsSkipped },
  {
    anchors: anchors.map((a) => ({ kind: a.kind, token: a.token })),
    anchorlessChanges,
    unmappedCommandFiles,
    unanchoredRuleBlocks,
    crossCuttingSymbols,
    bridgeCoverage,
    weakAnchorsDropped,
    overbroadAnchors,
    packageMentionDocs,
  },
);

/**
 * Shape the `computedOn` record from raw git answers. PURE — every probe lives in
 * `computedOnIdentity` below — so `--self-test` can pin the shape with no repo state.
 *
 * @param {string|null} head       `git rev-parse HEAD`
 * @param {string|null} parentLine `git log -1 --format=%P HEAD` — space-separated
 * @param {string|null} diffBase   the resolved commit the diff was measured from
 * @param {string|null} porcelain  `git status --porcelain`; null when the probe failed
 */
function computedOnFrom(head, parentLine, diffBase, porcelain) {
  const one = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    head: one(head),
    // A root commit has no parents and a failed probe answered nothing: both are the
    // empty list, never a `['']` entry that reads downstream as a real commit.
    headParents: typeof parentLine === 'string' ? parentLine.trim().split(/\s+/).filter(Boolean) : [],
    diffBase: one(diffBase),
    // "Could not tell" and "checked, clean" are DIFFERENT answers and must not render
    // alike — the same distinction this tool's output draws everywhere else.
    dirty: typeof porcelain === 'string' ? porcelain.trim().length > 0 : null,
  };
}

/**
 * Name the tree this run's answer is a fact ABOUT (#9519).
 *
 * The row set is a function of two commits and, until this field, the JSON named
 * neither by anything stable. The pages are read with `readFileSync` from the WORKING
 * TREE (`docTexts`, §3b) — not from any ref — and the change set is a diff whose base
 * was published only as `sinceRef`, a moving NAME (`origin/main`), never a commit.
 *
 * On a `pull_request` run `actions/checkout` checks out merge(base, head), so the
 * advisory is a fact about a tree that exists on no branch the reader can name and that
 * GitHub drops once the PR closes. `headParents` is the durable handle on it: both
 * parents stay fetchable, and re-merging them rebuilds the same tree.
 *
 * `diffBase` is the merge-base §2 already resolved, not `sinceRef` re-read here, and
 * that distinction is what makes it reproducible: the diff is three-dot, so re-running
 * with `origin/main` a day later measures from the same merge-base while re-running
 * with THIS sha measures from it by construction — even from a clone whose `origin/main`
 * has moved. Naming the commit is what makes the command replayable; naming the branch
 * is what made it a trap.
 *
 * Measured cost of leaving all of it unsaid: a reader re-derived in a worktree cut from
 * an older `main`, one page had gained an anchor token on `main` in between, and a
 * correct row was reported as a false positive. The follow-up then investigated a defect
 * class that does not exist in this tool — the anchor set is derived fresh per run, with
 * no cache, index or snapshot anywhere — and cost a full round.
 *
 * `dirty` is this field's own correctness guard, not decoration: the tool reads the
 * working tree, so with uncommitted changes present the shas do NOT identify what was
 * read. A sha that misidentifies the tree is worse than no sha — the same defect, now
 * wearing a credential.
 *
 * ⛔ Read-only, and deliberately evaluated HERE, at the emit boundary after every
 * derivation has finished, so it cannot participate in deriving anything. Every probe
 * degrades to `null` rather than throwing: this is a courtesy label on an advisory and
 * must never be the reason a scan fails.
 */
function computedOnIdentity() {
  const probe = (cmd) => { try { return sh(cmd); } catch { return null; } };
  return computedOnFrom(
    probe('git rev-parse HEAD'),
    probe('git log -1 --format=%P HEAD'),
    diffBaseRef === null ? null : probe(`git rev-parse --verify --quiet ${JSON.stringify(`${diffBaseRef}^{commit}`)}`),
    probe('git status --porcelain'),
  );
}

function emit(docList, changedPackages, summary, detail, skipped = {}, anchorInfo = {}) {
  const { testFilesSkipped = 0, scriptFilesSkipped = 0, devOnlyManifestsSkipped = 0 } = skipped;
  const {
    anchors: anchorList = [], anchorlessChanges: anchorless = [], crossCuttingSymbols: crossCutting = [],
    weakAnchorsDropped: weak = [], overbroadAnchors: overbroad = [], packageMentionDocs: coarse = [],
    unmappedCommandFiles: unmappedCommands = [], unanchoredRuleBlocks: unanchoredRules = [],
    // `null` for the `--all` arm, which derives no anchors and runs no bridge. Distinct
    // from `{ measured: false }`, which means the bridge was available and stood down.
    bridgeCoverage: coverage = null,
  } = anchorInfo;
  if (asJson) {
    process.stdout.write(
      JSON.stringify(
        {
          summary,
          sinceRef: all ? null : sinceRef,
          // WHICH TREE THIS ANSWER IS A FACT ABOUT (#9519). `sinceRef` above is a NAME
          // and names move; the pages were read from the WORKING TREE, which no field
          // named at all. See `computedOnIdentity` for what each member is for.
          computedOn: computedOnIdentity(),
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
          // Files sitting under a CLI's commands dir whose path did NOT resolve to a
          // command id (#9230). Distinct from `anchorlessChanges` — such a file may still
          // have produced symbol anchors — and published for the same reason: the command
          // derivation declining a shape must be readable, never inferred from a gap.
          unmappedCommandFiles: unmappedCommands,
          // Files whose changed `@docs-rule` block yielded no expression anchor (#9282).
          // The marker fired and the derivation came back empty — published for the same
          // reason as the field above: a tagged block is a CLAIM that pages restate this,
          // so the tool coming back empty on one must be readable, never inferred from a
          // gap. Such a file may still appear in `docs` via its `symbol` anchors.
          unanchoredRuleBlocks: unanchoredRules,
          // The other declared narrowing: symbols wired into so many routes that the
          // route bridge would have answered "every route" instead of "this one".
          crossCuttingSymbols: crossCutting,
          // How much of the DECLARED client-bound route surface the bridge could reach
          // this run (#9572). The two narrowings above are per-run and data-dependent;
          // this one is STRUCTURAL — a ledger row no registrar tail selects is invisible
          // to every run, forever, and until this field existed nothing printed that.
          // Machine-readable on purpose: it is the source a ratchet would read.
          bridgeCoverage: coverage,
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
