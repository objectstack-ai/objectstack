#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * dispatch-gates (#7341 item 4) — map a card's file surface to the `check:*`
 * gate families that watch it, and to the model tier its paths MANDATE, both
 * derived from the tree AT RUNTIME.
 *
 *   node scripts/pm/dispatch-gates.mjs <path> [<path> ...]   # e.g. packages/spec/src/data/filter.zod.ts
 *   node scripts/pm/dispatch-gates.mjs --residue <path> ...  # + name every family the derivation did not place
 *   node scripts/pm/dispatch-gates.mjs --tier <path> ...     # the tier verdict alone, for the claim comment
 *   node scripts/pm/dispatch-gates.mjs --self-test
 *
 * The tier half is a FLOOR from paths only, and it says so on every run: see
 * MANDATORY_TIER_GLOBS for what it encodes (clause ①, a file-surface
 * predicate) and what no path derivation can reach (clause ②, judged from the
 * card's content).
 *
 * ## Why derived, never listed
 *
 * The step-5 dispatch template's "Local gates for this card" line is filled by
 * the PM, and the gate inventory is a thing that expires SAME-DAY: it grew
 * twice in one 2026-08-08/09 shift (#6672 added `check:kernel-hook-pairs`,
 * #6661 added `check:app-nav-i18n`), and even "the farm lives in lint.yml" is
 * a memory-shaped claim — measured on #7341's own dispatch-time survey, checks
 * also live in ci.yml / spec-liveness-check.yml / validate-deps.yml /
 * release.yml / showcase-smoke.yml. #6492 is the canonical incident for a
 * second copy of a list rotting inside prose (three mutually-contradicting
 * counts, drifting within one hour), and #6865 for relaying remembered
 * workflow facts into a dispatch prompt (four of six required-context names
 * lived in a different file than claimed). So this script embeds NO list of
 * checks and NO map from paths to checks: every run re-reads
 * `.github/workflows/*.yml`, resolves each `check:*` script through
 * package.json, and scans the check scripts' own sources for the path
 * literals they operate on. When the farm grows, the next run sees it.
 *
 * ## What the output means (and what it cannot promise)
 *
 * For each input path, checks are matched by the path literals discoverable in
 * their sources ("watch hints"). That derivation is honest but heuristic:
 *
 *   - a MATCHED check is one whose own source names a directory/file that
 *     covers the input path — high-signal, paste it into the dispatch prompt.
 *     It is printed as the RUNNABLE invocation (`pnpm --filter <pkg> run
 *     check:x` for a package-scoped gate, `pnpm check:x` for a root-scoped
 *     one), not as the bare script name: the bare name sends a dev to the root
 *     `package.json`, where a package-scoped gate is absent and therefore reads
 *     as nonexistent (#7440);
 *   - a check with NO discoverable path hints is counted in the "undetermined"
 *     bucket. It is NOT known to be irrelevant — many gates read the whole tree
 *     or a convention rather than a path. The PM's judgment call stays a
 *     judgment call; what this script removes is the memory-shaped half (which
 *     named checks exist and where they live);
 *   - a check whose sources DO name paths, none of which cover the input, is
 *     counted as "silent". That is the derivation's weakest claim and it used to
 *     be invisible: a gate that computes its population and names only its own
 *     baseline artifact scores silent for every card in the tree. All three
 *     buckets are now accounted for in the closing summary, and `--residue`
 *     names the two unmatched ones runnably — see residueLines;
 *   - a CONVENTION-TRIGGERED check is one the path derivation can never reach,
 *     because it counts a population it computes for itself and so names no
 *     path literal to match. Those are derived from the change's KIND instead
 *     and printed under their own heading — see CHANGE_KIND_GATES.
 *
 * The output is print-only and exits 0 on a completed derivation; a run that
 * cannot read the workflows or package.json exits non-zero (#4690: unreadable
 * input must never look like an empty answer).
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import process from 'node:process';

const ROOT = new URL('../..', import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Extraction — pure functions over file contents, self-testable offline.
// ---------------------------------------------------------------------------

/**
 * A `run:` value that is a YAML block-scalar HEADER (`|`, `>`, with any
 * chomping/indentation indicator) carries no command of its own: the commands
 * are the lines indented beneath the key.
 */
const BLOCK_SCALAR_HEADER = /^[|>][+-]?\d*$/;

/**
 * The command text of every `run:` step in a workflow, one string per step,
 * with whole-line `#` comments removed.
 *
 * ## Why the body of a block scalar has to be read
 *
 * The obvious spelling — one regex for `run:` and take the rest of the line —
 * reads only the steps whose command fits on the `run:` line itself. A step
 * written as a block scalar puts `|` there and its commands on the FOLLOWING
 * lines, so that spelling collected the string "|" and never saw the commands.
 * Measured on this tree at the time of writing: six gate families were invoked
 * exclusively from block-scalar bodies (`check-adr-0087-registration`,
 * `check-empty-changeset`, `check-shard-attestation`, `check-osv-exemptions`,
 * `check-test-completeness`, `check-cross-package-test-inputs`) and were
 * therefore absent from the derivation ENTIRELY — not matched, and not in the
 * "undetermined" bucket either, because a family that is never discovered has
 * no entry to fall into it. That is the one output shape this script's contract
 * forbids (a gate the derivation cannot mention at all), and it cost PR #8399 a
 * CI round: its declared-breaking changeset derived `check-changeset-no-major`
 * (a one-line `run:`, so visible) but not `check-adr-0087-registration` (a
 * block-scalar body, so invisible), which is the gate that actually reddened.
 *
 * Nothing downstream needed changing: `check-adr-0087-registration.mjs` names
 * `.changeset` in its own source, so the ordinary watch-hint match fires as
 * soon as the family is discovered at all. The bug was never in the matching.
 *
 * ## Why comments are stripped, and why only whole-line ones
 *
 * Reading a block body means reading the shell comments inside it, and this
 * tree's workflow bodies discuss gates by name at length (ci.yml's shard job
 * spells `check-shard-attestation.mjs` in a comment explaining that gate's own
 * classifier). "Mentions a gate" is not "runs a gate", and a family discovered
 * from prose would be a fabricated lead — the same failure the "22 leads is the
 * same as none" note below rejects for a wider heuristic. Only whole-line
 * comments are dropped: a trailing `# note` after a real command sits on a line
 * whose command still has to be read, and stripping from the first `#` anywhere
 * would corrupt commands that legitimately contain one inside a quoted string.
 *
 * Measured both ways on this tree: stripping changes no family's discovery
 * today (every gate named in a body comment is also really invoked somewhere).
 * It is here so that stops being luck.
 */
export function runCommandTexts(workflowText) {
  const lines = workflowText.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^([ \t]*)run:[ \t]*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const [, indent, inline] = m;
    if (!BLOCK_SCALAR_HEADER.test(inline.trim())) {
      out.push(inline.trim());
      continue;
    }
    // Block scalar: the body is every following line indented deeper than the
    // key (blank lines belong to it too). Advancing `i` past the body is what
    // keeps a `run:` MENTIONED inside a body from being parsed as a new key.
    const body = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (lines[j].trim() === '') {
        body.push('');
        continue;
      }
      if (/^[ \t]*/.exec(lines[j])[0].length <= indent.length) break;
      body.push(lines[j]);
    }
    out.push(body.filter((l) => !/^[ \t]*#/.test(l)).join('\n'));
    i = j - 1;
  }
  return out;
}

/**
 * Pull every `check:*` invocation out of a workflow file's `run:` steps,
 * with the pnpm --filter package (if any) and the workflow's file name.
 */
export function extractCheckInvocations(workflowText, workflowFile) {
  const out = [];
  for (const cmd of runCommandTexts(workflowText)) {
    for (const m of cmd.matchAll(/pnpm\s+(?:--filter\s+(\S+)\s+)?(?:run\s+)?(check:[\w:-]+)/g)) {
      out.push({ check: m[2], filter: m[1] ?? null, workflow: workflowFile });
    }
    for (const m of cmd.matchAll(/node\s+(scripts\/[\w./-]*check-[\w.-]+\.mjs)/g)) {
      out.push({ check: m[1], filter: null, workflow: workflowFile, direct: true });
    }
  }
  return out;
}

/** Resolve a `check:x` script name to the script files it runs, via a package.json `scripts` map. */
export function resolveCheckToFiles(checkName, scriptsMap) {
  const cmd = scriptsMap[checkName];
  if (!cmd) return [];
  // The conventional script shape names its file twice (`--self-test && run`) — dedupe.
  return [...new Set([...cmd.matchAll(/(scripts\/[\w./-]+\.(?:mjs|cjs|js|sh))/g)].map((m) => m[1]))];
}

/**
 * Identifier characters, for the regex-vs-division decision in `scanSource`.
 */
const IDENT_CHAR = /[\w$]/;

/**
 * The keywords after which a `/` opens a REGEX rather than dividing. Every
 * other case is decided by the preceding character: a `/` that follows a value
 * (identifier, number, `)`, `]`, or a closed literal) divides; anything else
 * opens a regex.
 */
const REGEX_AFTER_KEYWORD = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'case', 'delete', 'void',
  'yield', 'await', 'new', 'do', 'else', 'throw',
]);

/**
 * One left-to-right pass over a JS source, flagging every character as COMMENT
 * content and/or LITERAL content (inside a string, template or regex). Both
 * come back as same-length byte arrays, so a caller can blank a span without
 * moving any other offset.
 *
 * ## Why a scan, and why it has to know about regex literals
 *
 * The two questions the callers below ask — "is this `//` a comment or the
 * middle of a URL?" and "is this `}` the end of a function or a character in a
 * fixture?" — are precisely the ones a regex over raw text cannot answer.
 * Measured on this tree, both traps are real: `release-github-releases.mjs`
 * carries `'https://github.com'` in its module body (a `//` a line-comment rule
 * would swallow the rest of the line for), and its own markdown regex
 * `/^(#{1,6})\s(.*)$|^(`{3,})/gm` contains a BACKTICK — a scanner that skipped
 * regex literals would open a template literal there and treat everything to
 * the next backtick, hundreds of lines later, as string content. This file's
 * hint regex below puts all three quote characters inside a regex literal for
 * the same reason. Regex literals also carry unbalanced `{`/`}` (`{1,6}`), so
 * the brace counting in `maskSelfTests` needs them flagged too.
 *
 * The literal flag covers a literal's CONTENT, not its delimiters, so a caller
 * blanking comments still sees every string intact. Template interiors are
 * treated as literal through `${…}` as well: an interpolation's braces are
 * balanced by construction, so ignoring them is right for depth counting, and
 * the hint scan reads the raw characters either way.
 *
 * A shape this scan gets wrong fails toward masking MORE than it should, which
 * costs recall (a real hint dropped) and cannot fabricate a lead — the
 * direction this whole file's "22 leads is the same as none" note asks for.
 */
function scanSource(source) {
  const n = source.length;
  const comment = new Uint8Array(n);
  const literal = new Uint8Array(n);
  let i = 0;
  let prev = ''; // last significant CODE character
  let word = ''; // …and the identifier it is the tail of, if any

  // A shebang is a comment to node; it is also the one line whose slashes are
  // neither division nor a regex.
  if (source.startsWith('#!')) {
    while (i < n && source[i] !== '\n') comment[i++] = 1;
  }

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') comment[i++] = 1;
      continue;
    }
    if (c === '/' && next === '*') {
      comment[i++] = 1;
      comment[i++] = 1;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) comment[i++] = 1;
      if (i < n) comment[i++] = 1;
      if (i < n) comment[i++] = 1;
      continue;
    }
    if (c === "'" || c === '"') {
      i++; // the opening quote is code, so the hint scan can still pair it
      while (i < n && source[i] !== c && source[i] !== '\n') {
        literal[i] = 1;
        if (source[i] === '\\' && i + 1 < n) literal[++i] = 1;
        i++;
      }
      if (i < n && source[i] === c) i++;
      prev = 'x'; // a value just ended
      word = '';
      continue;
    }
    if (c === '`') {
      i++;
      while (i < n && source[i] !== '`') {
        literal[i] = 1;
        if (source[i] === '\\' && i + 1 < n) literal[++i] = 1;
        i++;
      }
      if (i < n) i++;
      prev = 'x';
      word = '';
      continue;
    }
    if (c === '/' && !(IDENT_CHAR.test(prev) || prev === ')' || prev === ']')) {
      i++; // regex literal: `/` after anything that is not a value
      let inClass = false;
      while (i < n && source[i] !== '\n') {
        const ch = source[i];
        if (ch === '\\' && i + 1 < n) {
          literal[i] = 1;
          literal[++i] = 1;
          i++;
          continue;
        }
        if (ch === '[') inClass = true;
        else if (ch === ']') inClass = false;
        else if (ch === '/' && !inClass) break;
        literal[i] = 1;
        i++;
      }
      if (i < n && source[i] === '/') i++;
      prev = 'x';
      word = '';
      continue;
    }
    if (c === '/' && REGEX_AFTER_KEYWORD.has(word)) {
      // `return /x/` — a value character precedes, but it is a keyword.
      prev = '';
      word = '';
      continue; // re-read this `/` with prev cleared, as a regex
    }
    if (!/\s/.test(c)) {
      prev = c;
      word = IDENT_CHAR.test(c) ? word + c : '';
    }
    i++;
  }
  return { comment, literal };
}

/** Replace every flagged character with a space, keeping newlines and offsets. */
function blank(source, flags) {
  const out = source.split('');
  for (let k = 0; k < out.length; k++) if (flags[k] && out[k] !== '\n') out[k] = ' ';
  return out.join('');
}

/**
 * The source with its COMMENT spans blanked — line, block and shebang.
 *
 * ## Why comments must not contribute hints
 *
 * A gate's header discusses the tree at length, and the hint scan accepts
 * backticks, so every backticked path in a header used to be read as a path the
 * gate operates on. Measured, and self-inflicted: the first draft of
 * `scripts/pm/check-dispatch-gates.mjs` explained this very pollution with each
 * path in backticks, and that header alone produced ten hints — reproducing,
 * from the file documenting the problem, the exact false MATCHED leads it was
 * written to avoid. It ships today with its paths deliberately unquoted, a
 * workaround this function retires: naming a path is not reading it.
 */
export function maskComments(source) {
  return blank(source, scanSource(source).comment);
}

/**
 * A top-level self-test function DECLARATION. The anchor is structural, not a
 * comment convention: `function selfTest() {` at column 0, optionally `export`
 * and/or `async`, with any name that spells self-test (`selfTest`,
 * `fixtureSelfTest`, `selfTestReadSeams`, `prePushIsArmedSelfTest`,
 * `decisionTableSelfTest` — the five spellings this tree actually uses).
 *
 * Measured across the 61 scripts under `scripts/` that carry one: 53 write
 * `function selfTest() {`, 7 write `async function selfTest() {`, and the four
 * remaining names are the compound ones above — 61 of 61 at column 0, none of
 * them an arrow-function const. If a script ever spells one as
 * `const selfTest = () => {`, widen this pattern rather than reaching for a
 * comment marker; a declaration is a thing the language guarantees, a marker
 * comment is a thing an author has to remember.
 */
const SELF_TEST_DECL =
  /^(?:export[ \t]+)?(?:async[ \t]+)?function[ \t]+[A-Za-z0-9_$]*[Ss]elf[_]?[Tt]est[A-Za-z0-9_$]*[ \t]*\(/gm;

/**
 * The source with the BODY of every top-level self-test function blanked.
 *
 * ## Why the self-test is not part of what a gate reads
 *
 * A check script's self-test is made of fixture paths — it has to be, since the
 * thing under test is a judgment about paths. The hint scan could not tell a
 * fixture from a literal the gate really opens, so a gate was printed in the
 * MATCHED column for most of the tree. The three worst specimens, measured on
 * this branch's base: `scripts/pm/dispatch-gates.mjs` (46 coverage-capable
 * hints, 2 real), `scripts/check-empty-changeset.mjs` (36), and
 * `scripts/check-adr-0087-registration.mjs` (34) — the last two also reached
 * through `check:changeset-gate-self-tests`, which resolves to all three
 * changeset gates at once and inherits the union of their fixtures.
 *
 * The end of the body is found by counting braces over code positions only, so
 * a `}` inside a fixture string or a `{1,6}` inside a regex cannot close it
 * early. A declaration whose braces never balance masks to end of file: recall
 * loss on a malformed script, never a fabricated lead.
 *
 * Compose comment masking FIRST — otherwise a `function selfTest() {` written
 * at column 0 inside a block comment (a docblock example, exactly the kind this
 * file is full of) would anchor a mask over real code.
 */
export function maskSelfTests(source) {
  const { comment, literal } = scanSource(source);
  const flags = new Uint8Array(source.length);
  for (const m of source.matchAll(SELF_TEST_DECL)) {
    const start = m.index;
    if (comment[start] || literal[start]) continue;
    let depth = 0;
    let opened = false;
    let end = start;
    for (; end < source.length; end++) {
      if (comment[end] || literal[end]) continue;
      if (source[end] === '{') {
        depth++;
        opened = true;
      } else if (source[end] === '}') {
        depth--;
        if (opened && depth === 0) {
          end++;
          break;
        }
      }
    }
    for (let k = start; k < end; k++) flags[k] = 1;
  }
  return blank(source, flags);
}

/**
 * Scan a check script's MODULE BODY for the path-ish string literals it
 * operates on. A hint is a quoted string that contains a `/` (or names a
 * top-level dotted dir) and looks like a repo path rather than a URL or a
 * regex — read from the source with its comments and its self-test blanked, so
 * a path the script merely NAMES is not read as a path it watches.
 *
 * ## Why the narrowing, and why it is the precision half of the product
 *
 * The MATCHED column is what a dispatch prompt pastes, and its error is
 * one-directional in the expensive direction: a missing lead costs one card one
 * CI round, while a fabricated lead is pasted into EVERY dispatch prompt whose
 * file surface brushes a fixture path, and the dev who runs it cannot tell it
 * from a real one. The "repo-wide / undetermined" bucket already exists for
 * gates this derivation cannot place, and it is the honest home for a gate
 * whose only claim on your path was a string in its own test.
 *
 * What this does NOT remove: a fixture constant defined at module scope and
 * used only by the self-test still reads as a hint. That residue is bounded
 * (measured below) and it is the same shape the scan has always had — a literal
 * in the module body — rather than a boundary this function is pretending to
 * draw.
 *
 * ## Why leading `../` is stripped
 *
 * Dropping the comments turned one gate's only surviving literal into a hint
 * that could no longer match anything: `check:pm-skill-ratchet` reads
 * `new URL('../../.claude/skills/pm-dispatch/SKILL.md', import.meta.url)`, and
 * before this narrowing it matched a SKILL.md card through the copy of that
 * path written in its own header — a real input reached by way of prose, which
 * is the accident this function exists to stop relying on. The leading `../`
 * segments are the SCRIPT's depth, not part of the watched path: a
 * module-relative URL is how these scripts spell a repo path, and `hintCovers`
 * compares against repo-relative inputs. So they are stripped, and a literal
 * that is nothing but dots (`'../..'`, this file's own ROOT) names no file and
 * is dropped outright.
 *
 * ## Why a TRAILING dot is stripped too, and why it stopped being cosmetic
 *
 * A path literal written as the last word of a sentence keeps the sentence's
 * period: `scripts/check-skill-compatibility-version.mjs` is spelled in a
 * backticked span at line 295 of its own module body — an array element, so
 * comment masking cannot reach it — and it was extracted as the hint
 * `scripts/check-skill-compatibility-version.mjs.`, with the period. No repo
 * path ends in a dot, so a hint that does names nothing.
 *
 * That was harmless while `hintCovers` compared raw string prefixes, because
 * the hint still reached the real file through `plain.startsWith(inputPath)`.
 * The segment-boundary rule below removes exactly that branch, so the two
 * changes are COUPLED and had to land together — measured on this tree, the
 * boundary rule alone takes this one live hint from covering its own file to
 * covering nothing at all:
 *
 *   raw prefix (before)         -> true
 *   segment rule, not stripped  -> false      <- the coupling
 *   segment rule, stripped      -> true
 *
 * A trailing run of dots and slashes is therefore trimmed here, at extraction,
 * where the hint is built — not at comparison time, where every caller would
 * have to remember to do it.
 */
export function extractWatchHints(scriptSource) {
  const moduleBody = maskSelfTests(maskComments(scriptSource));
  const hints = new Set();
  for (const m of moduleBody.matchAll(/['"`]([^'"`\n]{2,120})['"`]/g)) {
    const raw = m[1];
    if (/^(https?:|[A-Z_]+=|-{1,2}\w)/.test(raw)) continue;
    if (!/^[\w.@][\w.@/*-]*$/.test(raw)) continue;
    const s = raw.replace(/^(?:\.\.?(?:\/|$))+/, '');
    if (!s) continue;
    const looksPathy = s.includes('/') || /^\.(claude|changeset|github|gitattributes)\b/.test(s);
    if (!looksPathy) continue;
    const trimmed = s.replace(/[./]+$/, '');
    if (!trimmed) continue;
    hints.add(trimmed);
  }
  return [...hints];
}

/**
 * Render an invocation a dev can paste and run, from the same parse the
 * workflow line produced. The script NAME alone is not runnable for a
 * package-scoped check: `check:doc-formula-expressions` lives in
 * `@objectstack/lint`, not in the root `package.json`, so a dev who searched
 * the obvious place found nothing and concluded the gate did not exist — twice,
 * in independent sessions, within one hour (#7440, PR #7416 / #7417). The
 * `--filter` package is the one piece of provenance this tool parsed and then
 * dropped, and it is the piece needed to run the thing.
 */
export function runnableInvocation({ check, filter, direct }) {
  if (direct) return `node ${check}`; // already a script path, never a pnpm script
  if (filter) return `pnpm --filter ${filter} run ${check}`;
  return `pnpm ${check}`;
}

/**
 * Does a watch hint cover an input path? Containment either way, compared on
 * PATH SEGMENT boundaries, with globs collapsed. A hint that collapses to a
 * bare top-level directory name (`packages`, `scripts` — no slash, not a dotted
 * dir) is rejected as too generic: it would match every file under the tree's
 * biggest directories and drown the signal the matched-via column exists to
 * carry.
 *
 * ## Why a segment boundary and not a raw string prefix (#8534)
 *
 * A path prefix is not a string prefix. Compared raw, a hint naming one entry
 * claims every SIBLING whose name merely starts with the same characters, and
 * the MATCHED column is what a dispatch prompt pastes — a fabricated lead there
 * is indistinguishable from a real one to the dev who runs it.
 *
 * This was filed as dormant, on a census of 324 hints against 73 PACKAGE
 * directories that found no live false coverage. Re-measured here against every
 * tracked file rather than package directories only — 354 live hints × 5940
 * tracked files — it is not dormant, and one answer changes:
 *
 *   hint 'content/docs' vs 'content/docs.site.json'  raw=true  segment=false
 *       <- check:role-word, check:docs-audit-scope
 *
 * `content/docs.site.json` is a real file sitting beside the `content/docs`
 * directory, and neither gate reads it. So both were printed as MATCHED for any
 * card touching that file. The sibling class was always live; the earlier census
 * probed directories, and this specimen is a file.
 *
 * The neighbouring predicate already draws this boundary and has a pinned case
 * for it (`isInI18nBundlePackage`: `path === dir || path.startsWith(dir + '/')`).
 * This is the one place in the file that did not.
 *
 * ## The collapsed-glob reach trade — DECIDED, not assumed
 *
 * Globs are collapsed by deletion, so `packages/client*` becomes
 * `packages/client`. As a glob it would legitimately match a sibling package
 * `packages/client-react`; under the segment rule it no longer reaches it. That
 * trade was decided to REFUSE the reach, on three grounds:
 *
 *   - measured need: exactly two live hints carry a partial-segment glob, and
 *     both are npm package specifiers rather than repo paths (`@objectstack/
 *     spec@*` from check:release-page-status, `@fx/spec*` from
 *     check:type-source-resolution). No repo path begins with `@`, so both are
 *     inert either way. The capability this trade would protect has zero live
 *     instances — a `packages/client*` hint is hypothetical, not a thing the
 *     tree has;
 *   - one rule, not two: preserving glob reach means re-deriving, at comparison
 *     time, information the collapse deliberately destroys — a second matching
 *     mode keyed on syntax that is already gone by the time this function runs;
 *   - the error directions are not symmetric, and this file's contract picks a
 *     side everywhere else: refusing costs a MISSING lead (one card, one CI
 *     round), preserving costs a FABRICATED lead (pasted into every prompt whose
 *     surface brushes it). Refusal errs in the direction the header calls the
 *     safe one.
 *
 * Both directions of the trade are pinned in the self-test, so a future reader
 * finds the decision as an assertion rather than as this paragraph. If a real
 * `packages/client*`-shaped hint ever appears and the reach is genuinely wanted,
 * the answer is to spell the hint as the two paths it means, not to widen this
 * comparison back into a string prefix.
 */
export function hintCovers(hint, inputPath) {
  const plain = hint.replace(/\*\*?/g, '').replace(/\/+$/, '').replace(/\/$/, '');
  if (plain.length < 2) return false;
  if (!plain.includes('/') && !plain.startsWith('.')) return false;
  return (
    inputPath === plain ||
    inputPath.startsWith(`${plain}/`) ||
    plain.startsWith(`${inputPath}/`)
  );
}

/**
 * The key that makes one check family relevant to one input path, or null —
 * the family's OWN script files first, then the path literals scanned out of
 * those files.
 *
 * ## Why a gate's own script files are match keys (#8509)
 *
 * `derive` resolves every family to the script FILES that implement it and
 * stores them on `entry.files`, then used to compare only `entry.hints` — the
 * literals scanned from those files' CONTENTS. So the most direct relationship
 * the tool has was the one it never used: *this gate IS this file*. A card
 * editing `scripts/check-empty-changeset.mjs` derived nothing at all, because
 * the gate that runs that script names it in **package.json**, not in the
 * script's own source.
 *
 * Measured on this tree the day this landed: of the 70 gate scripts the
 * workflows resolve to, 8 derived any family when edited — and those eight only
 * because they happen to quote their own filename in their module body, which
 * was never a feature. The blind spot is self-shaped: it is exactly the class of
 * card that edits gate tooling, which is the work most likely to break a gate.
 *
 * Nothing is listed to close it. `entry.files` is resolved at runtime from
 * package.json, so the identity key follows the same derived-never-listed
 * contract as the rest of this script: a gate script added tomorrow is matched
 * by the next run with nothing to update here.
 *
 * ## Why identity is consulted FIRST, and why the two cannot fight
 *
 * Both key sets are compared with the same `hintCovers` and only one answer is
 * taken per path, so a family can never print twice. Ordering therefore decides
 * one thing only: which provenance the `matched via` column shows when both
 * fire. Identity is the more specific of the two claims — the input IS this
 * file, not a literal that happens to cover it — so it goes first
 * (`check:nul-bytes` against `scripts/check-nul-bytes.mjs` is the live
 * specimen: the same single line, now attributed to the file itself).
 *
 * Where only one fires, order changes nothing, and this tool's own gate is the
 * specimen for that: `scripts/pm/check-dispatch-gates.mjs` is a thin file whose
 * one module-body constant is the tool it runs, so a card editing the TOOL
 * still matches through that constant while a card editing the GATE FILE
 * matches through identity. They answer different inputs.
 */
export function coveringHint(entry, inputPath) {
  const identity = (entry.files ?? []).find((f) => hintCovers(f, inputPath));
  if (identity) return identity;
  return (entry.hints ?? []).find((h) => hintCovers(h, inputPath)) ?? null;
}

/**
 * Place one check family against a card's whole file surface: `matched` (with
 * the hits to print), `undetermined` (the honest "this derivation cannot place
 * the gate" bucket), or `silent`.
 *
 * ## Why the undetermined bucket still counts SCANNED hints only
 *
 * The one-line spelling of the identity match — push `entry.files` into
 * `entry.hints` — also quietly empties this bucket, because a family whose
 * source names no path whatsoever still resolves to a script file, so
 * `hints.length === 0` would stop being true for it. Measured on this tree: 35
 * families have no discoverable path literals and 16 of them resolve to a
 * script file, so that spelling would move 16 gates out of the output's honest
 * half and into silence — a gate the derivation cannot mention at all, the one
 * output shape this script's contract forbids.
 *
 * The two questions are simply different. Matching asks "is this family
 * relevant to these paths?", which identity answers directly. The bucket asks
 * "does this family's source name any path at all?", which identity does not
 * answer for anybody's card but the one editing that very script. So identity
 * decides matching, and the bucket keeps reading `entry.hints`.
 */
export function classifyEntry(entry, paths) {
  const hits = [];
  for (const p of paths) {
    const hint = coveringHint(entry, p);
    if (hint) hits.push({ path: p, hint });
  }
  if (hits.length) return { verdict: 'matched', hits };
  return { verdict: (entry.hints ?? []).length === 0 ? 'undetermined' : 'silent', hits };
}

// ---------------------------------------------------------------------------
// Change-kind derivation — the gates a path match can never reach
// ---------------------------------------------------------------------------

/**
 * Is this path a test file, judged the way the gates below judge it?
 *
 * Both gates classify by the FILENAME infix (`*.test.*` / `*.spec.*`), not by
 * directory: a helper at `__tests__/fixtures.ts` is test-adjacent but neither
 * gate counts it — it falls in their NON-test population, where the ordinary
 * blocking lint rule applies instead. Matching directories here would name two
 * gates that cannot move, which is the failure mode this whole script exists to
 * avoid. The extension set is the UNION of the two gates' own (one counts
 * `.ts`/`.tsx`, the other also `.mts`/`.cts`); these are leads to run locally,
 * not verdicts, so the wider side is the safe one.
 */
export function isTestFilePath(path) {
  return /\.(test|spec)\.(ts|tsx|mts|cts)$/.test(path);
}

/**
 * Does this path name an i18n extract config, judged the way `check:i18n`
 * judges it? `scripts/check-i18n-bundles.mjs` (`findConfigs`, ~line 107) tests
 * the FILENAME and additionally requires the file to sit under a `scripts/`
 * directory: `e.name === 'i18n-extract.config.ts' && p.includes('/scripts/')`.
 * Mirrored exactly rather than approximated — a copy that widened the test
 * would name a gate that cannot move, the failure mode this whole script
 * exists to avoid.
 */
export function isExtractConfigPath(path) {
  return basename(path) === 'i18n-extract.config.ts' && path.includes('/scripts/');
}

/**
 * The package directory that OWNS an extract config: everything above the
 * `scripts/` segment `isExtractConfigPath` required. Returns null when the
 * owner would collapse to a bare top-level directory (a config sitting at
 * `packages/scripts/…`) — such an owner covers the entire tree below it, which
 * is the same over-broad match `hintCovers` rejects for watch hints.
 */
export function owningPackageOfExtractConfig(configPath) {
  const i = configPath.indexOf('/scripts/');
  if (i < 0) return null;
  const owner = configPath.slice(0, i);
  return owner.includes('/') ? owner : null;
}

/**
 * Is this input path inside a package that owns an extract config?
 *
 * The WHOLE owning package counts, the config file included. Narrowing to the
 * object definitions would under-cover: the extraction reads whatever each
 * package's config enumerates, and the config itself is part of the trigger
 * surface — edit it and the emitted bundles change.
 *
 * One-directional on purpose: the input must sit inside an owner, never the
 * reverse. Letting a shorter input "cover" owners below it would make a
 * directory argument like `packages/services` drag in every bundle package
 * under it, and `packages` drag in all nine.
 */
export function isInI18nBundlePackage(path, ownerDirs) {
  return ownerDirs.some((dir) => path === dir || path.startsWith(`${dir}/`));
}

/**
 * Walk `packages/` for extract configs exactly the way the gate walks it —
 * same skip set (`node_modules`, `dist`, dotted entries), same file test — and
 * return the repo-relative package directories that own one, deduped.
 *
 * Runtime discovery, like `extractCheckInvocations` re-reading the workflows:
 * when a tenth package grows a bundle, the next run matches it with nothing to
 * update here. `absDir` is the directory to read; `rel` is the repo-relative
 * path it corresponds to, so the answers are comparable to the input paths a
 * card is dispatched with.
 */
export function findI18nBundlePackages(absDir, rel = 'packages', out = []) {
  for (const e of readdirSync(absDir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) findI18nBundlePackages(join(absDir, e.name), child, out);
    else if (isExtractConfigPath(child)) {
      const owner = owningPackageOfExtractConfig(child);
      if (owner && !out.includes(owner)) out.push(owner);
    }
  }
  return out;
}

/**
 * The walk, memoised per process — one answer serves every input path. An
 * unreadable `packages/` throws rather than degrading to "no owners": under
 * this script's contract unreadable input must never look like an empty
 * answer, and the entrypoint turns the throw into a non-zero exit.
 */
let i18nOwnerDirs = null;
export function i18nBundlePackageDirs() {
  i18nOwnerDirs ??= findI18nBundlePackages(join(ROOT, 'packages'));
  return i18nOwnerDirs;
}

/**
 * Gates that fire on what a change IS, keyed by a mechanically-detectable
 * convention. Everything else in this script is derived at runtime and lists
 * nothing; this table is the one exception, and it is bounded on purpose.
 *
 * ## Why these cannot be derived like the rest
 *
 * The path derivation matches a gate when the gate's own source names a
 * directory that covers your file. Every gate here computes its population
 * instead of naming it, so no source carries a literal to match:
 *
 *   - the two type-check gates — one lints a glob set that lives in the shared
 *     ESLint config, the other walks the workspace members — sit permanently
 *     in the "undetermined" bucket;
 *   - the three test-file RATCHETS (`check:query-options-erasure`,
 *     `check:engine-double-contract`, `check:where-matcher`) each walk the tree
 *     for `*.test.*` files and reconcile the count against a baseline JSON. What
 *     their sources name is that baseline and, for two of them, the git ref they
 *     diff against — never the population. Measured on this tree, their entire
 *     hint sets are:
 *
 *       check:query-options-erasure   scripts/query-options-erasure-baseline.json, origin/main
 *       check:where-matcher           scripts/where-matcher-conformance.baseline.json, origin/main
 *       check:engine-double-contract  scripts/engine-double-contract.baseline.json,
 *                                     @objectstack/{core,objectql,metadata-core}
 *
 *     Not one of those can cover a card's path, so all three score `silent` —
 *     they HAVE hints, so the "undetermined" bucket never sees them either, and
 *     before this entry named them they were printed in NEITHER half of the
 *     output for every card in the tree;
 *   - `check:i18n` walks `packages/` at runtime for files NAMED
 *     `i18n-extract.config.ts` and re-extracts each owning package's bundles.
 *     Its source is worse than silent: the path-ish literals it does carry are
 *     its CLI prerequisite and stale-dist checks (`packages/cli/dist/commands/
 *     i18n/extract.js`, `packages/spec/dist`, measured — eleven hints, none of
 *     them the population). So it matches nothing AND, having hints, never
 *     reaches the "undetermined" bucket either: before this entry existed, an
 *     edit to `packages/services/service-messaging/src/objects/` — which
 *     regenerates that package's four bundles — printed the gate in NEITHER
 *     half of the output. A gate the derivation cannot mention at all is the
 *     one shape this script must not produce; it cost a PR a CI round.
 *
 * No per-card gate list derived from paths can ever name these, however the
 * derivation improves.
 *
 * ## Why a named table and not a wider heuristic
 *
 * The tempting generalisation — scan every discovered check script for
 * `*.test.ts`-shaped literals and call those the test-sensitive gates — was
 * measured against this tree and names 22 families, because a script's source
 * mentions test paths in its fixtures, its self-test and its comments.
 * "Mentions a test file" is not "counts test files", and 22 leads is the same
 * as none. So the pair is written down, and the cost of writing it down is paid
 * back by the two properties below.
 *
 * ## Why the two ratchets below joined this entry (#8632)
 *
 * `check:engine-double-contract` and `check:where-matcher` were handed to the
 * PM's judgment in this file's closing prose instead of being derived. Three
 * measured instances, all of them CI rounds, say that boundary was in the wrong
 * place — and the deciding evidence is not the incidents but a structural
 * identity with an entry that was already here.
 *
 * All three ratchets discover their population the same way: a walk collecting
 * `*.test.*` files (`scripts/check-engine-double-contract.mjs`, `walk` at ~line
 * 342, `/\.(test|spec)\.(ts|tsx|mts)$/`; `scripts/check-where-matcher-
 * conformance.mjs`, corpus walk at ~line 562, `/\.test\.ts$/`), reconciled
 * against a shrink-only baseline. `check:query-options-erasure` has sat in this
 * entry for exactly that reason. Naming one of three and calling the other two a
 * judgment call was an inconsistency in this table, not a considered line.
 *
 * The noise objection recorded on the card — a path-level trigger fires on test
 * files that contain no fake engine at all — is real and is answered by what
 * these gates cost to run rather than by narrowing the trigger. Each is a
 * whole-tree shrink-only ratchet: one invocation answers for the entire tree,
 * needs no build, and prints the offending file and line when it fails. A seat
 * that runs one needlessly loses seconds; a seat that is never prompted loses a
 * CI round, which is what all three instances did. The trigger deliberately does
 * NOT read the file's contents to confirm a double is present: a card is
 * dispatched BEFORE its code exists, so the double the gate will object to is
 * usually not on disk at derivation time — the second instance added one to a
 * file that already had one, the first added the file itself.
 *
 * This is the shape the "22 leads" note rejects a heuristic for, and it survives
 * that objection because the trigger is the gates' own population test, mirrored
 * (`isTestFilePath`), not a guess at which scripts look test-flavoured.
 *
 * ## What the i18n entry still refuses to list
 *
 * Its `matches` does not enumerate the packages that own a bundle today — it
 * repeats the gate's own walk (`findI18nBundlePackages` mirrors `findConfigs`
 * in `scripts/check-i18n-bundles.mjs`: same skip set, same filename-plus-
 * `/scripts/` test). What is written down here is the KIND, not its
 * population, so a tenth package growing a bundle is matched by the next run
 * with nothing to update — the same runtime-discovery contract the workflow
 * and package.json reads already keep.
 *
 * ## How these entries stay honest
 *
 * - Every `name` here is resolved against the families actually discovered in
 *   the workflows at runtime. A gate that is renamed, retired or dropped from
 *   CI does not silently stop being suggested — the run prints it as STALE and
 *   says to fix this table. A hand-written list that reports its own rot is a
 *   different object from one that quietly ages.
 * - Every `name` here is an INVOCATION, not a script. One check script can be
 *   wired into CI under two package scripts that answer different questions, and
 *   a rationale that names the script instead of the invocation sends a seat to
 *   a command which cannot reproduce the failure it describes.
 *   `check:type-check-coverage` and `check:type-check-debt` are one file
 *   (`scripts/check-type-check-coverage.mjs`); only the second passes
 *   `--re-measure`, which is the half a new test file's type errors move. This
 *   entry named the first while explaining the second, so a dev seat ran it in
 *   good faith, reported the union green, and CI found four new type errors.
 *   Swept over this tree when that was fixed: the workflows discover 96
 *   families resolving to 73 distinct script files, and 8 of those files are
 *   reached by more than one family — 7 of the 8 in the other shape, a `check:`
 *   script beside a direct `node scripts/check-x.mjs` step in a second
 *   workflow, which `derive` discovers as its own family and prints with its
 *   own runnable invocation. The pair below is the only one where two ROOT
 *   SCRIPTS differ by a flag, so this is a one-off today and what generalises
 *   is the rule, not the fix.
 * - Prose in a `why` is a MODULE-BODY string, so it is scanned for watch hints
 *   like any other literal — comment masking cannot reach it. The ratchet
 *   entry's remedy command therefore spells its `--filter` values unquoted (and
 *   says to quote them for the shell): measured, the shell-quoted spelling adds
 *   both of its glob filter values to THIS file's own hint set as hints, inert
 *   only because `hintCovers` rejects one that collapses to a bare top-level
 *   directory. A gate list that fabricates hints out of its own explanations is
 *   the failure this whole script is written against.
 * - Every `name` here is checked against the LIVE workflows by the self-test,
 *   not only by the run that happens to print it. The STALE branch reports rot
 *   to whoever is looking at the output; the self-test case makes the same rot
 *   fail CI, because this table's names are the one enumerable list in the file
 *   and an enumerable list is one a guard can hold.
 * - Each entry is deletable, with a stated criterion:
 *   - test-file entry: when a gate on it grows a discoverable path literal,
 *     the ordinary derivation names it and its line becomes redundant. For the
 *     three ratchets that means a literal naming their POPULATION — the baseline
 *     path each already carries is their own output, and a card editing a
 *     baseline matches through it today without making the gate derivable for
 *     anybody else.
 *   - i18n entry: when `check-i18n-bundles.mjs` stops discovering its targets
 *     at runtime and names its POPULATION in its own source — a literal each
 *     owning package path starts with — the path half matches and this entry
 *     is redundant. Growing more prerequisite paths does not qualify; that is
 *     what it already has.
 *
 *   Delete an entry the day its criterion is met, not before.
 */
export const CHANGE_KIND_GATES = [
  {
    kind: 'adds or edits a test file',
    matches: isTestFilePath,
    gates: [
      {
        name: 'check:query-options-erasure',
        why: 'its test-surface ceiling counts sites in *.test/*.spec files, so new test code moves it',
      },
      {
        name: 'check:type-check-coverage',
        why: "the STRUCTURAL half: a package whose test files sit outside every tsc program accounting for it must carry a TEST_DEBT entry, so a new test file no tsconfig reaches moves this one. It re-measures no count — the ratchet is the invocation below",
      },
      {
        name: 'check:type-check-debt',
        why: "the RATCHET half, and the invocation CI runs for it: `--re-measure` re-runs tsc per ledger entry and fails when a count drifts up, so a new test file that does not typecheck cleanly moves it. Needs the workspace closure BUILT — on an unbuilt worktree it refuses outright, and that throw means NOT MEASURED, never `not applicable to me`. Build first, exactly as lint.yml does: pnpm exec turbo run build --filter=./packages/* --filter=./packages/*/* (quote the filter values for your shell)",
      },
      {
        name: 'check:engine-double-contract',
        why: 'it walks every *.test.* file for fake engine doubles and fails when one declares delete()/update() without routing through assertEngineDeleteDispatch/assertEngineUpdateDispatch, against a shrink-only per-file baseline. A new double, or a new test file carrying one, moves it — and so does a delegating pass-through seam wrapping a real engine, which is the reading that missed it twice. Repair by fixing the double, never by raising the baseline. Cheap and whole-tree: one run answers for the whole repo and names the file and line',
      },
      {
        name: 'check:where-matcher',
        why: 'it walks every *.test.ts file for hand-written WHERE matchers and fails on a NEW silently-wrong one (a combinator read as a field name), against a shrink-only baseline. It rides the same test code as the double gate — one new fake engine tripped both, one round apart, because these steps run sequentially inside the ESLint job and the first failure aborts the rest. Conforming by REFUSING the unsupported shape is the convention most of the discovered matchers already follow; the suite cannot notice this class, which is why the gate exists',
      },
    ],
  },
  {
    kind: 'edits a file in a package that owns an i18n-extract.config.ts',
    matches: (path) => isInI18nBundlePackage(path, i18nBundlePackageDirs()),
    gates: [
      {
        name: 'check:i18n',
        why: "it re-extracts every owning package's translation bundles and fails on drift, so any edit that changes what the extractor emits (an object definition, a label, the config itself) moves it — regenerate with `node scripts/check-i18n-bundles.mjs --write`",
      },
    ],
  },
];

/**
 * Render the convention-triggered section. Pure over its inputs so the
 * self-test can drive both the hit and the STALE branch offline;
 * `resolveInvocation` returns a runnable command for a gate the live run
 * discovered, or null for one it did not.
 */
export function changeKindLines(paths, resolveInvocation, kinds = CHANGE_KIND_GATES) {
  const lines = [];
  for (const { kind, matches, gates } of kinds) {
    const hits = paths.filter((p) => matches(p));
    if (hits.length === 0) continue;
    lines.push(`  ${kind}: ${hits.join(', ')}`);
    for (const { name, why } of gates) {
      const invocation = resolveInvocation(name);
      lines.push(
        invocation
          ? `    - ${invocation}   — ${why}`
          : `    - ⚠ ${name}: STALE — no workflow runs a gate under this name. It was renamed or retired; fix CHANGE_KIND_GATES in this script.`,
      );
    }
  }
  return lines;
}

/**
 * The closing accounting: every discovered family placed, with runtime counts
 * and NOT ONE GATE NAMED.
 *
 * ## What this replaced, and why naming any gate here is the bug (#8632)
 *
 * This paragraph used to end with a hand-written list — "the rest stay the PM
 * judgment call — new fake engine => check:engine-double-contract, new error
 * code => check:error-code-casing, any edit => check:nul-bytes". Three problems,
 * all measured:
 *
 *   - it was a SECOND COPY of a list that lives in `.claude/agents/os-dev.md`,
 *     which names four gates where this named three (it also carries
 *     `.claude/agents/**` => check:agent-model-declared). The two copies had
 *     already drifted apart. A second copy of a list rotting inside prose is the
 *     canonical incident this file's own header cites as the reason it embeds no
 *     list of checks — reproduced in the file's last sentence;
 *   - it was not a census of its own residue and nothing said so.
 *     `check:where-matcher` is the same class of gate and appears nowhere in
 *     this file — grep count 0 — so a dev following the output to the letter,
 *     closing paragraph included, had no path to it at all. That cost a CI
 *     round;
 *   - the residue it claimed to summarise is not three families. Measured at the
 *     time of writing: 98 discovered, 8 matched for a two-path card, 35
 *     undetermined and 55 silent. An enumeration of 90 families in prose is not
 *     a thing anyone can keep in sync, so keeping the sentence and guarding it
 *     was never available — the honest move is to stop enumerating and state the
 *     partition, which is derived and cannot drift.
 *
 * So this function names no gate, and a self-test case holds it to that. The
 * families themselves are listed on demand by `--residue`, from the live
 * derivation, where they cannot be stale.
 *
 * ## Why `silent` is now printed at all
 *
 * It was the undeclared fourth bucket: `classifyEntry` has always produced it
 * and no output ever mentioned it, so the majority of the farm (55 of 98) was
 * excluded by a verdict the reader could not see, let alone weigh. And it is the
 * derivation's WEAKEST claim — a gate that computes its population and names
 * only its own baseline artifact scores `silent` for every card in the tree,
 * which is exactly how the three test-file ratchets went missing. Counting it
 * out loud is what makes "no family names your paths" an answer a reader can
 * judge instead of an absence they never see.
 *
 * Throws when the three verdicts do not account for every discovered family:
 * under this script's contract a derivation that cannot complete exits non-zero
 * rather than printing a wrong answer, and a fourth bucket added without wiring
 * it in here would otherwise silently shrink the residue.
 */
export function residueLines({ discovered, matched, undetermined, silent }, kinds = CHANGE_KIND_GATES) {
  const placed = matched + undetermined + silent;
  if (placed !== discovered) {
    throw new Error(
      `residue accounting is short: ${placed} famil(ies) placed of ${discovered} discovered ` +
        '(matched + undetermined + silent must cover every discovered family)',
    );
  }
  const unplaced = undetermined + silent;
  return [
    `Residue — all ${discovered} discovered famil(ies) placed, derived at runtime:`,
    `  ${matched} matched above · ${undetermined} undetermined (their sources name no path at all — NOT known irrelevant)` +
      ` · ${silent} silent (their sources name paths, none of which cover yours).`,
    '  A `silent` verdict is this derivation\'s weakest claim, not a clearance: a gate that computes its own population and' +
      ' names only its baseline artifact scores silent for every card in the tree.',
    `  Convention-triggered gates cut ACROSS all three and are printed above when a kind hits (${kinds.map((k) => k.kind).join('; ')}).`,
    `  This script names no gate from memory. To list the ${unplaced} famil(ies) the path derivation did not place, runnably:` +
      ' node scripts/pm/dispatch-gates.mjs --residue <paths>',
  ];
}

// ---------------------------------------------------------------------------
// Model-tier derivation — the half of the tier decision that IS a path question
// ---------------------------------------------------------------------------

/**
 * The globs that MANDATE a model tier for any card whose file surface touches
 * them, as DATA. This is the one list in this file besides CHANGE_KIND_GATES,
 * and it is here for the same reason: it is enumerable, so a guard can hold it.
 *
 * ## Why a tier is derived here at all (#8640)
 *
 * Gate families used to be hand-recalled per card; this script exists because
 * recall expires. The model tier had the same shape and had not been fixed: the
 * PM recalled the mandatory roots and wrote free prose into the claim comment's
 * `Container & model` line. Measured incident: a card whose surface included
 * `.claude/skills/pm-dispatch/references/review-checklist.md` was claimed as
 * "not under the fable-mandatory roots" and dispatched at opus. One
 * misclassification sentence flowed unchecked from claim to dispatch to model
 * choice, and only a downstream seat's skepticism caught it — at PR time, after
 * the work was done, when the compensation available was a re-review rather
 * than a re-dispatch. Nothing mechanical had compared the recorded surface
 * against the mandatory globs, because nothing mechanical could: the globs
 * lived only in prose.
 *
 * So the invariant this section installs is narrow and total: a mandatory path
 * anywhere in the surface ⇒ the output cannot say otherwise. `deriveTier`
 * refuses to return a result whose parts contradict each other and `tierLines`
 * refuses to render one, in the same shape as the residue partition guard —
 * a derivation that cannot complete exits non-zero rather than printing a wrong
 * answer.
 *
 * ## What this derivation CANNOT promise, stated where it cannot be missed
 *
 * The mandatory-tier policy has two clauses and only the first is a question
 * about paths:
 *
 *   - clause ①, encoded below: a card editing the PM dispatch skill is
 *     `claude-fable-5`, references included. That is a file-surface predicate
 *     and it is exactly what this script already takes as argv;
 *   - clause ②, NOT encoded and deliberately not: a card that changes contract
 *     accept/reject behaviour or widens the public surface is also
 *     `claude-fable-5`. That is judged from the card's CONTENT — what the change
 *     does to the contract — and a path cannot answer it. An ordinary-looking
 *     surface (one package's source file) is the NORMAL shape of a clause-②
 *     card.
 *
 * A path derivation that pretended to cover clause ② would produce the failure
 * this whole file is written against, one level up: a "no mandate" line read as
 * a clearance. So the no-mandate output says which clause it checked and which
 * it cannot reach, every time, rather than leaving the reader to remember there
 * were two. The output is a FLOOR, never a ceiling.
 *
 * The quota exemption (fable measured unavailable ⇒ opus, never lower) is a
 * claim-time note about a model's availability, not a property of the file
 * surface. This tool states the mandate; the seat records the exemption and its
 * reason in the claim comment.
 *
 * ## Why the globs are matched with `hintCovers`, asymmetry included
 *
 * Same matcher as the gate half, so there is one path-comparison rule in this
 * file rather than two — and so a glob gets the segment-boundary semantics for
 * free: `.claude/skills/pm-dispatchers/x.md` is not under
 * `.claude/skills/pm-dispatch/**`, which a string prefix would have mandated.
 *
 * `hintCovers` also matches in the other direction — an input that is an
 * ANCESTOR of the glob (a surface declared as `.claude/skills`) counts as a
 * hit. For gate matching that direction is a fabricated lead; here it is the
 * correct one, because the error costs are not the same in the two halves. An
 * over-matched gate pastes a wrong command into a prompt; an under-mandated
 * tier crosses a maintainer guardrail and is only visible afterwards. A surface
 * declared as a directory that CONTAINS a mandatory root may well touch it, so
 * the derivation errs toward the mandate. Both directions are pinned in the
 * self-test.
 *
 * ## Keeping this list from rotting
 *
 * Two guards, both live. Every declared glob must name a path that EXISTS in
 * this tree — a renamed skill root would otherwise leave dead data that
 * mandates nothing while reading as protection, which is the incident class
 * itself. And two globs that cover one path with DIFFERENT tiers is a
 * derivation this file cannot complete honestly (nothing here orders tiers), so
 * it throws rather than picking one.
 *
 * ## One measured side effect of putting a path in a MODULE BODY
 *
 * Comment masking cannot reach a module-body string, so this glob is now a
 * watch hint of this file's own source: measured, `extractWatchHints` yields 5
 * hints here against 4 on the base, the new one being the glob itself. It is
 * inert today because no check family resolves to THIS file — the gate that
 * covers it is `check:pm-dispatch-gates`, which resolves to
 * `check-dispatch-gates.mjs` and matches this file through that file's one
 * constant. If the tool is ever wired as its own gate (a shape
 * `check-dispatch-gates.mjs`'s header measures and refuses), this hint would
 * start printing that gate as MATCHED for every card editing the PM skill —
 * a fabricated lead. The refusal already recorded there is what keeps it inert;
 * this note is so the next reader knows the cost is known, not unnoticed.
 *
 * The authority for the policy is the maintainer ruling quoted in the PM
 * dispatch skill (2026-08-10 three-tier ruling, clause ① of its 强制条款).
 * This table is a machine-readable copy of ONE predicate from it, not a second
 * statement of the policy: when they disagree, the skill wins and this table is
 * the thing to fix.
 */
export const MANDATORY_TIER_GLOBS = [
  {
    glob: '.claude/skills/pm-dispatch/**',
    tier: 'claude-fable-5',
    why: 'clause ① of the model-tiering ruling: a card editing the PM dispatch skill is fable-mandatory, references included — the skill is the lane\'s own operating protocol and a wrong edit propagates to every later dispatch',
  },
];

/** The tier floor for a card with no mandate — the ruling's 最低下限. */
export const TIER_FLOOR = 'sonnet';

/** The default judgment tier for a card with no mandate — the ruling's 默认判断档. */
export const TIER_DEFAULT = 'opus';

/**
 * Place a card's file surface against the mandatory globs. Pure over its
 * inputs, so the self-test can drive every branch offline.
 *
 * Throws when two globs covering the same surface mandate DIFFERENT tiers:
 * this file encodes no ordering over tiers, so choosing between them would be a
 * guess printed as a derivation.
 */
export function deriveTier(paths, globs = MANDATORY_TIER_GLOBS) {
  const hits = [];
  for (const p of paths) {
    for (const g of globs) {
      if (hintCovers(g.glob, p)) hits.push({ path: p, glob: g.glob, tier: g.tier, why: g.why });
    }
  }
  const tiers = [...new Set(hits.map((h) => h.tier))];
  if (tiers.length > 1) {
    throw new Error(
      `mandatory tier is ambiguous for this surface: ${tiers.join(' vs ')} — ` +
        'two globs cover it with different tiers and this script orders no tiers',
    );
  }
  return { mandatory: hits.length > 0, tier: tiers[0] ?? null, hits, declared: globs.length };
}

/**
 * Render the tier verdict. Throws on a result whose parts contradict each other
 * — a hit with no tier, or a tier with no hit to justify it — because the one
 * thing this section owes the reader is that a mandatory surface cannot print
 * as anything else.
 */
export function tierLines(result) {
  const { mandatory, tier, hits, declared } = result;
  if (mandatory !== hits.length > 0 || mandatory !== Boolean(tier)) {
    throw new Error(
      `tier verdict is self-contradictory: mandatory=${mandatory}, tier=${tier ?? 'none'}, ` +
        `${hits.length} hit(s) — a mandatory surface must print its mandate`,
    );
  }
  const clause2 =
    '  Clause ② is NOT reachable from paths: a card that changes contract accept/reject behaviour or widens the public' +
    ' surface is fable-mandatory too, judged from the card CONTENT. This line is a FLOOR, never a clearance.';
  if (!mandatory) {
    return [
      `Model tier — no path-derived mandate: the surface hits none of the ${declared} declared glob(s), derived here, not recalled.`,
      `  The tier stays the PM's per-card judgment call (floor ${TIER_FLOOR} · default ${TIER_DEFAULT} · ceiling fable).`,
      clause2,
    ];
  }
  return [
    `Model tier — MANDATORY: ${tier} (derived from the file surface, not recalled).`,
    ...hits.map((h) => `  - ${h.path} ⇢ '${h.glob}' — ${h.why}`),
    '  The only exit is the measured quota exemption (fable unavailable ⇒ opus, never lower), recorded with its reason' +
      " in the claim comment's `Container & model` line.",
    clause2,
  ];
}

// ---------------------------------------------------------------------------
// Live derivation
// ---------------------------------------------------------------------------

function derive(paths, { showResidue = false } = {}) {
  const wfDir = join(ROOT, '.github/workflows');
  const workflows = readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f));
  if (workflows.length === 0) throw new Error('no workflow files found under .github/workflows');
  const rootScripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts ?? {};

  const invocations = [];
  for (const wf of workflows) {
    invocations.push(...extractCheckInvocations(readFileSync(join(wfDir, wf), 'utf8'), wf));
  }
  if (invocations.length === 0) throw new Error('no check:* invocations found in any workflow');

  // Dedupe by (check, workflow); resolve each to script files + watch hints.
  const byCheck = new Map();
  for (const inv of invocations) {
    const key = inv.check;
    if (!byCheck.has(key)) byCheck.set(key, { ...inv, workflows: new Set(), files: [], hints: [] });
    byCheck.get(key).workflows.add(inv.workflow);
  }
  for (const entry of byCheck.values()) {
    let files = entry.direct ? [entry.check] : resolveCheckToFiles(entry.check, rootScripts);
    if (entry.filter) {
      // package-scoped check: resolve through that package's manifest when findable
      const pkgDirGuess = entry.filter.replace(/^@objectstack\//, '');
      for (const base of ['packages', 'packages/plugins', 'packages/drivers', 'packages/services']) {
        const p = join(ROOT, base, pkgDirGuess, 'package.json');
        if (existsSync(p)) {
          const pkgScripts = JSON.parse(readFileSync(p, 'utf8')).scripts ?? {};
          files = files.concat(
            resolveCheckToFiles(entry.check, pkgScripts).map((f) => join(base, pkgDirGuess, f)),
          );
        }
      }
    }
    entry.files = files;
    for (const f of files) {
      const abs = join(ROOT, f);
      if (existsSync(abs)) entry.hints.push(...extractWatchHints(readFileSync(abs, 'utf8')));
    }
  }

  const matched = new Map();
  const undetermined = [];
  const silent = [];
  for (const [check, entry] of byCheck) {
    const { verdict, hits } = classifyEntry(entry, paths);
    if (verdict === 'matched') matched.set(check, { entry, hits });
    else if (verdict === 'undetermined') undetermined.push([check, entry]);
    else silent.push([check, entry]);
  }

  console.log(`dispatch-gates: ${byCheck.size} check famil(ies) discovered across ${workflows.length} workflow file(s) — derived at runtime, nothing listed in this script.\n`);
  // The tier verdict prints on EVERY run, hit or not. Printing it only on a hit
  // would make its absence mean two things at once — "no mandate" and "this
  // build has no tier derivation" — and the claim comment is written from
  // whatever the run said.
  for (const line of tierLines(deriveTier(paths))) console.log(line);
  console.log('');
  if (matched.size) {
    console.log('Local gates for this card (paste into the dispatch prompt):');
    for (const [check, { entry, hits }] of [...matched].sort()) {
      const via = hits.map((h) => `${h.path} ⇢ '${h.hint}'`).join('; ');
      console.log(`  - ${runnableInvocation(entry)}   [${[...entry.workflows].join(', ')}]   matched via ${via}`);
    }
  } else {
    console.log('No check family names the given paths in its own source.');
  }
  const kindLines = changeKindLines(paths, (name) => {
    const entry = byCheck.get(name);
    return entry ? runnableInvocation(entry) : null;
  });
  if (kindLines.length) {
    console.log('\nConvention-triggered gates (this change KIND moves them; no path derivation can name them):');
    for (const line of kindLines) console.log(line);
  }

  if (showResidue) {
    const listing = (title, entries, withHints) => {
      console.log(`\n${title}: ${entries.length} famil(ies).`);
      for (const [check, entry] of [...entries].sort()) {
        const names = withHints && entry.hints.length
          ? `   names: ${[...new Set(entry.hints)].slice(0, 3).join(', ')}${entry.hints.length > 3 ? ', …' : ''}`
          : '';
        console.log(`  - ${runnableInvocation(entry)}   [${[...entry.workflows].join(', ')}]${names}`);
      }
    };
    listing('Undetermined (source names no path at all — NOT known irrelevant)', undetermined, false);
    listing('Silent (source names paths, none of which cover yours — the weakest verdict)', silent, true);
  }

  console.log('');
  for (const line of residueLines({
    discovered: byCheck.size,
    matched: matched.size,
    undetermined: undetermined.length,
    silent: silent.length,
  })) {
    console.log(line);
  }
}

// ---------------------------------------------------------------------------
// Self-test — extraction + matching over fixtures.
//
// The extraction and hint cases run over inline fixtures and touch no
// filesystem. The i18n change-kind cases deliberately do: that entry's whole
// content IS a walk of the real `packages/` tree, and a fixture-only test
// passes just as happily when the walk is rooted at the wrong directory or
// skips the wrong entries. So the pure judgments (filename test, owner
// derivation, containment) are pinned offline, and the walk is pinned against
// the tree, in both directions.
// ---------------------------------------------------------------------------

function selfTest() {
  const cases = [];
  const t = (name, cond) => cases.push([name, cond]);

  const wf = [
    'jobs:',
    '  lint:',
    '    steps:',
    '      - name: A',
    '        run: pnpm check:engine-double-contract',
    '      - name: B',
    '        run: pnpm --filter @objectstack/spec check:authorable-surface',
    '      - name: C',
    '        run: node scripts/check-nul-bytes.mjs',
    '      - name: not-a-check',
    '        run: pnpm build',
  ].join('\n');
  const invs = extractCheckInvocations(wf, 'lint.yml');
  t('extracts plain pnpm check', invs.some((i) => i.check === 'check:engine-double-contract' && i.filter === null));
  t('extracts filtered check with its package', invs.some((i) => i.check === 'check:authorable-surface' && i.filter === '@objectstack/spec'));
  t('extracts direct node scripts/check-*.mjs', invs.some((i) => i.check === 'scripts/check-nul-bytes.mjs' && i.direct));
  t('ignores non-check runs', !invs.some((i) => String(i.check).includes('build')));

  // Block-scalar bodies (#8410). A step written `run: |` keeps its commands on
  // the following lines; reading only the `run:` line collected "|" and missed
  // every gate invoked this way. Both scalar styles and both invocation shapes
  // are pinned, plus the two directions in which the body must END.
  const blockWf = [
    'jobs:',
    '  changeset-check:',
    '    steps:',
    '      - name: Literal block, two commands',
    '        env:',
    '          MERGE_BASE: abc',
    '        run: |',
    '          node scripts/check-adr-0087-registration.mjs --self-test',
    '          node scripts/check-adr-0087-registration.mjs --base "$MERGE_BASE"',
    '',
    '      # A YAML comment BETWEEN steps naming `pnpm check:invented-by-prose`.',
    '      - name: Folded block with a pnpm check',
    '        run: >-',
    '          pnpm --filter @objectstack/spec check:folded-surface',
    '      - name: Body carrying a shell comment',
    '        run: |',
    '          # first run node scripts/check-mentioned-only.mjs, they said',
    '          pnpm check:really-invoked',
    '      - name: Back to a one-liner',
    '        run: node scripts/check-nul-bytes.mjs',
  ].join('\n');
  const blockInvs = extractCheckInvocations(blockWf, 'pr-automation.yml');
  const blockNames = blockInvs.map((i) => i.check);
  t('extracts a direct script from a literal block body', blockNames.includes('scripts/check-adr-0087-registration.mjs'));
  t('extracts a pnpm check from a folded block body, with its filter', blockInvs.some((i) => i.check === 'check:folded-surface' && i.filter === '@objectstack/spec'));
  t('a dedented step ends the block body (the one-liner after it still parses)', blockNames.includes('scripts/check-nul-bytes.mjs'));
  t('a blank line does NOT end the block body', blockNames.includes('check:folded-surface'));
  // The over-match guard: discovery must report what a step RUNS, never what a
  // comment mentions. Measured on this tree — four families (check:adr-links,
  // check:empty-changeset, check:platform-checklist, check:skill-frame-freshness)
  // appear in workflow prose only, and a naive any-token scan invents all four.
  t('a gate named only in a YAML comment between steps is not discovered', !blockNames.includes('check:invented-by-prose'));
  t('a gate named only in a shell comment inside a body is not discovered', !blockNames.includes('scripts/check-mentioned-only.mjs'));
  t('a real command in the same body as a comment is still discovered', blockNames.includes('check:really-invoked'));

  // `runCommandTexts` on its own: one entry per step, in file order.
  const texts = runCommandTexts(blockWf);
  t('one command text per run step', texts.length === 4);
  t('a block body keeps its lines joined', texts[0].split('\n').filter((l) => l.trim()).length === 2);
  t('a one-line run yields its command verbatim', texts[3] === 'node scripts/check-nul-bytes.mjs');

  // #7440: the printed line must be runnable as-is. The three shapes come from
  // the same three fixtures above, so the sample workflow and the print site
  // cannot drift apart.
  const inv = (name) => invs.find((i) => i.check === name);
  t('prints a package-scoped check as its full --filter invocation', runnableInvocation(inv('check:authorable-surface')) === 'pnpm --filter @objectstack/spec run check:authorable-surface');
  t('prints a root-scoped check unchanged', runnableInvocation(inv('check:engine-double-contract')) === 'pnpm check:engine-double-contract');
  t('prints a direct script as a node invocation', runnableInvocation(inv('scripts/check-nul-bytes.mjs')) === 'node scripts/check-nul-bytes.mjs');

  const scripts = { 'check:foo': 'node scripts/check-foo.mjs --self-test && node scripts/check-foo.mjs' };
  t('resolves script file from package.json', resolveCheckToFiles('check:foo', scripts).join() === 'scripts/check-foo.mjs');
  t('unknown check resolves to nothing', resolveCheckToFiles('check:bar', scripts).length === 0);

  const src = [
    "const DIR = '.claude/agents';",
    "const GLOB = 'packages/spec/src/**/*.zod.ts';",
    "const URL2 = 'https://example.com/x';",
    "const FLAG = '--self-test';",
    "const WORD = 'hello';",
  ].join('\n');
  const hints = extractWatchHints(src);
  t('finds dotted-dir hint', hints.includes('.claude/agents'));
  t('finds glob hint', hints.some((h) => h.startsWith('packages/spec/src')));
  t('skips urls', !hints.some((h) => h.includes('example.com')));
  t('skips flags and bare words', !hints.includes('--self-test') && !hints.includes('hello'));

  // ── What a gate READS vs what its source MENTIONS (#8478) ─────────────────
  //
  // Both halves are pinned in both directions, because both directions are the
  // product: a path in prose or in a fixture must NOT be a hint, and a path the
  // module body really opens must still be one. The fabricated half is the
  // expensive one — a false lead is pasted into every dispatch prompt whose
  // surface brushes it — but a narrowing that also drops the real inputs would
  // just move the dishonesty.
  // Every path a comment case names is QUOTED inside that comment, because the
  // scan only ever reads quoted spans: an unquoted path in prose is invisible
  // to it with or without masking, so a fixture spelling one bare would assert
  // nothing and pass forever. Measured — the first draft of the two cases below
  // did exactly that, and only the reverse-verification run that removed the
  // comment mask showed them staying green through it.
  const commented = [
    '/**',
    ' * Reads `packages/spec/src` and `.changeset/x.md` — prose, not inputs.',
    ' */',
    "const REAL = 'packages/rest/src';   // twin of 'packages/core/src', says the comment",
    "const U = 'https://example.com/a/b'; const AFTER_URL = 'packages/metadata/src';",
    "const RE = /['\"`]/;",
    "const AFTER_REGEX = 'packages/client/src';",
  ].join('\n');
  const commentHints = extractWatchHints(commented);
  t('a backticked path in a block comment is not a hint', !commentHints.includes('packages/spec/src'));
  t('a dotted path in a block comment is not a hint', !commentHints.some((h) => h.startsWith('.changeset')));
  t('a path in a trailing line comment is not a hint', !commentHints.includes('packages/core/src'));
  t('the module-body literal on that same line still is', commentHints.includes('packages/rest/src'));
  // The two traps that make this a scan and not a regex: `//` inside a URL is
  // not a comment, and a quote character inside a regex literal does not open a
  // string. Either mistake blanks real code — silently, and only downstream.
  t('a `//` inside a string does not start a comment', commentHints.includes('packages/metadata/src'));
  t('a quote inside a regex literal does not open a string', commentHints.includes('packages/client/src'));
  t('masking preserves every offset', maskComments(commented).length === commented.length);

  // The self-test boundary. The fixture puts a column-0 `}` inside a template
  // literal on purpose: that is the shape this tree really has (a check script
  // whose self-test embeds TS sources as fixtures), and a boundary that stopped
  // at the first column-0 `}` would end the mask there and leak every fixture
  // after it — measured on `scripts/check-engine-double-contract.mjs`, whose
  // self-test carries 24 such braces and whose last fixture path sits 400 lines
  // past the first one.
  const withSelfTest = [
    "const REAL = 'packages/runtime/src';",
    'function selfTest() {',
    "  const FIXTURE = 'packages/spec/src/data/filter.zod.ts';",
    '  const embedded = `',
    '}',
    "  const AFTER_BRACE = 'packages/objectql/src';",
    '  `;',
    '}',
    "const TAIL = 'docs/adr';",
  ].join('\n');
  const bodyHints = extractWatchHints(withSelfTest);
  t('a fixture path inside the self-test is not a hint', !bodyHints.includes('packages/spec/src/data/filter.zod.ts'));
  t('a column-0 brace inside a fixture does not end the self-test', !bodyHints.includes('packages/objectql/src'));
  t('the module body before the self-test still hints', bodyHints.includes('packages/runtime/src'));
  t('the module body after the self-test still hints', bodyHints.includes('docs/adr'));
  const otherSpellings = [
    'async function selfTest() {',
    "  const A = 'packages/aaa/src';",
    '}',
    'function fixtureSelfTest() {',
    "  const B = 'packages/bbb/src';",
    '}',
    'const box = {',
    '  run() {',
    "    const NESTED = 'packages/ccc/src';",
    '  },',
    '};',
  ].join('\n');
  const spellingHints = extractWatchHints(otherSpellings);
  t('an async self-test is masked too', !spellingHints.includes('packages/aaa/src'));
  t('a compound self-test name is masked too', !spellingHints.includes('packages/bbb/src'));
  t('an ordinary nested function is NOT masked', spellingHints.includes('packages/ccc/src'));
  // Composition order: comments are masked first, so a self-test declaration
  // QUOTED in a docblock (this file is full of them) cannot anchor a mask over
  // real code below it.
  const declInComment = [
    '/*',
    'function selfTest() {',
    '*/',
    "const REAL = 'packages/ddd/src';",
  ].join('\n');
  t('a self-test declaration inside a comment anchors nothing', extractWatchHints(declInComment).includes('packages/ddd/src'));
  // Module-relative spellings: `new URL('../../x', import.meta.url)` is how
  // these scripts name a repo path, and the leading segments are the script's
  // own depth, not part of what it watches.
  const relative = ["const P = new URL('../../.claude/agents/os-dev.md', import.meta.url);", "const R = '../..';"].join('\n');
  const relHints = extractWatchHints(relative);
  t('a module-relative path is normalised to repo-relative', relHints.includes('.claude/agents/os-dev.md'));
  t('a literal that is nothing but dots names no file', !relHints.some((h) => h.startsWith('..')));

  t('hint covers deeper path', hintCovers('.claude/agents', '.claude/agents/os-dev.md'));
  t('collapsed glob prefix covers', hintCovers('packages/spec/src/**', 'packages/spec/src/data/filter.zod.ts'));
  t('input dir covers hint below it', hintCovers('packages/spec/scripts/check-x.mjs', 'packages/spec'));
  t('unrelated path does not match', !hintCovers('.claude/agents', 'packages/rest/src/server.ts'));

  // ── Segment boundaries, not string prefixes (#8534) ───────────────────────
  //
  // Every case above is one the raw-prefix rule also passed; they stay to prove
  // the narrowing kept them. The cases below are the ones it failed.
  t('a hint equal to the input path covers it', hintCovers('docs/adr', 'docs/adr'));
  t('a sibling sharing a name prefix is NOT covered', !hintCovers('packages/client', 'packages/client-react/src/index.ts'));
  t('nor in the other direction', !hintCovers('packages/spec-extra/x.ts', 'packages/spec'));
  // The live specimen this was measured on: a real FILE sitting beside a real
  // directory of the same name stem, claimed by two gates that never read it.
  // The filed census called the rule dormant after probing package DIRECTORIES;
  // it was live all along, one directory level up and on a file. If
  // content/docs.site.json is ever removed, re-point this case at whatever
  // sibling pair the tree then has rather than deleting it.
  t('the live sibling FILE is no longer claimed by the directory hint', !hintCovers('content/docs', 'content/docs.site.json'));
  t('while the directory it names is still covered', hintCovers('content/docs', 'content/docs/adr/0112-x.mdx'));
  // The collapsed-glob reach trade, pinned in BOTH directions so the decision
  // reads as an assertion. Refusing the sibling reach is the DECIDED loss (see
  // hintCovers' docblock): measured, no repo-path hint of this shape exists —
  // the only two live partial-segment globs are npm specifiers.
  t('a collapsed partial-segment glob does NOT reach the sibling it would match as a glob', !hintCovers('packages/client*', 'packages/client-react/src/index.ts'));
  t('the same glob still covers the package it names', hintCovers('packages/client*', 'packages/client/src/index.ts'));
  t('a segment-boundary glob is untouched by the trade', hintCovers('packages/client/**', 'packages/client/src/index.ts'));

  // ── A trailing sentence period is not part of the path (#8534, half two) ──
  //
  // Coupled to the rule above: the raw-prefix comparison reached the real file
  // THROUGH the stray period, so the boundary rule alone would have taken this
  // hint from covering its own file to covering nothing. Both directions pinned.
  const dotted = extractWatchHints("const CITED = ['scripts/check-x.mjs.'];");
  t('a hint ending in a sentence period is trimmed to the path it names', dotted.includes('scripts/check-x.mjs'));
  t('no extracted hint ends in a dot', !dotted.some((h) => h.endsWith('.')));
  t('and the trimmed hint still reaches its file under the segment rule', dotted.some((h) => hintCovers(h, 'scripts/check-x.mjs')));
  t('trimming does not eat a leading dotted directory', extractWatchHints("const D = '.claude/agents';").includes('.claude/agents'));
  t('trimming does not eat a trailing glob', extractWatchHints("const G = 'packages/spec/src/**';").some((h) => h.includes('**')));

  // Change-kind derivation. The predicate is pinned in BOTH directions against
  // what the two gates themselves count: filename infix, never directory — a
  // helper inside `__tests__/` is in their non-test population.
  t('test file by .test infix', isTestFilePath('packages/objectql/src/engine.test.ts'));
  t('test file by .spec infix', isTestFilePath('packages/rest/src/server.spec.tsx'));
  t('test file with an mts extension', isTestFilePath('packages/spec/src/x.test.mts'));
  t('a __tests__ helper is NOT a test file to these gates', !isTestFilePath('packages/core/src/__tests__/fixtures.ts'));
  t('a plain source file is not a test file', !isTestFilePath('packages/objectql/src/engine.ts'));
  t('a non-TS file named test is not a test file', !isTestFilePath('docs/how.test.md'));

  const resolved = (name) => `pnpm ${name}`;
  const kindHit = changeKindLines(['packages/objectql/src/engine.test.ts'], resolved);
  t('a test path emits the convention section', kindHit.length === 6 && kindHit[0].includes('adds or edits a test file'));
  // All three halves anchor on the rendered DELIMITERS (`- pnpm x   —`), for the
  // reason the i18n entry's pins below state at length: a bare `includes` is
  // satisfied by every name that merely STARTS WITH the expected one, so a
  // prefix-preserving rename is invisible to it — the single rot class the STALE
  // branch exists to report. Measured on this entry rather than inherited from
  // that one: renaming these gates to `check:query-options-erasure-v2` and
  // `check:type-check-coverage-v2` in CHANGE_KIND_GATES left the substring form
  // green at 61/61 while the live run printed both as STALE; anchored, the same
  // rename fails this case. The two conventions in this file now agree.
  //
  // The coverage/debt PAIR is pinned as a pair on purpose (#8545): they are two
  // invocations of one script, and the anchored form is what tells them apart —
  // `includes('pnpm check:type-check-coverage')` is satisfied by the debt line's
  // absence AND by a `-v2` rename, which is how a rationale describing the
  // ratchet went on naming the invocation that never runs it.
  t('the section names all five convention gates, runnably', kindHit.some((l) => l.includes('- pnpm check:query-options-erasure   —')) && kindHit.some((l) => l.includes('- pnpm check:type-check-coverage   —')) && kindHit.some((l) => l.includes('- pnpm check:type-check-debt   —')) && kindHit.some((l) => l.includes('- pnpm check:engine-double-contract   —')) && kindHit.some((l) => l.includes('- pnpm check:where-matcher   —')));
  // The two ratchets this entry gained (#8632), pinned apart from the pair
  // above because they arrived for a different reason: they were handed to the
  // PM's judgment in this file's closing prose while a structurally identical
  // ratchet sat in this table. Their `why` must carry the repair direction —
  // fix the double / refuse the unsupported shape — because both baselines are
  // shrink-only and a seat that raises one turns a caught defect into a pinned
  // one.
  const doubleLine = kindHit.find((l) => l.includes('- pnpm check:engine-double-contract   —')) ?? '';
  const whereLine = kindHit.find((l) => l.includes('- pnpm check:where-matcher   —')) ?? '';
  t('the engine-double line states the guard it wants and refuses the baseline raise', /assertEngineDeleteDispatch/.test(doubleLine) && /shrink-only/.test(doubleLine));
  t('the where-matcher line states that refusing is the conforming repair', /refus/i.test(whereLine) && /shrink-only/.test(whereLine));
  // The ratchet line's prerequisite is part of the product, not decoration: a
  // seat that runs `--re-measure` on an unbuilt worktree gets a throw, and an
  // unexplained throw reads as "not applicable to me" — which is a green report
  // over a gate that never ran. So the printed line must carry both the
  // condition and a command that satisfies it.
  const debtLine = kindHit.find((l) => l.includes('- pnpm check:type-check-debt   —')) ?? '';
  t('the ratchet line states its built-closure prerequisite', /closure BUILT|BUILT closure/.test(debtLine) && debtLine.includes('turbo run build'));
  t('a non-test path emits nothing', changeKindLines(['scripts/pm/dispatch-gates.mjs'], resolved).length === 0);

  // i18n change-kind derivation — the pure judgments first, each mirroring one
  // line of the gate's own `findConfigs`.
  t('an extract config under scripts/ is one', isExtractConfigPath('packages/services/service-messaging/scripts/i18n-extract.config.ts'));
  t('the same filename OUTSIDE scripts/ is not', !isExtractConfigPath('packages/services/service-messaging/src/i18n-extract.config.ts'));
  t('another config under scripts/ is not', !isExtractConfigPath('packages/platform-objects/scripts/build-docs.config.ts'));
  t('owner is the package above scripts/', owningPackageOfExtractConfig('packages/plugins/plugin-audit/scripts/i18n-extract.config.ts') === 'packages/plugins/plugin-audit');
  t('an owner collapsing to a bare top-level dir is refused', owningPackageOfExtractConfig('packages/scripts/i18n-extract.config.ts') === null);

  const owners = ['packages/platform-objects', 'packages/services/service-messaging'];
  t('a deep path inside an owning package qualifies', isInI18nBundlePackage('packages/services/service-messaging/src/objects/http-delivery.object.ts', owners));
  t('the config file itself qualifies (whole package, not just objects)', isInI18nBundlePackage('packages/services/service-messaging/scripts/i18n-extract.config.ts', owners));
  t('the package directory itself qualifies', isInI18nBundlePackage('packages/platform-objects', owners));
  t('a path in a package WITHOUT a config does not', !isInI18nBundlePackage('packages/objectql/src/engine.ts', owners));
  t('a sibling sharing a name prefix does not', !isInI18nBundlePackage('packages/services/service-messaging-extra/src/x.ts', owners));
  t('a parent directory does not drag in owners below it', !isInI18nBundlePackage('packages/services', owners));

  // The walk itself, against the real tree — the half no fixture can prove.
  const liveOwners = i18nBundlePackageDirs();
  t('the live walk discovers owning packages', liveOwners.length > 0 && liveOwners.every((d) => d.startsWith('packages/')));
  t('the live walk finds no duplicate owners', new Set(liveOwners).size === liveOwners.length);
  t('the live walk excludes a package that owns no config', !liveOwners.includes('packages/objectql'));
  // Regression pin for the measured miss (PR #8348): this exact path derived no
  // check:i18n. If service-messaging ever stops owning a bundle, this case fails
  // and the answer is to re-point it at a package that does, not to delete it.
  t('the measured incident path now derives the kind', isInI18nBundlePackage('packages/services/service-messaging/src/objects/http-delivery.object.ts', liveOwners));

  // The name assertions below anchor on the rendered DELIMITERS (`- pnpm x   —`,
  // `⚠ x: STALE`), not on a bare substring. Measured while reverse-verifying this
  // entry: renaming the gate to `check:i18n-renamed-probe` made the live run
  // print STALE exactly as designed, and a `includes('pnpm check:i18n')` pin
  // stayed green through it — every prefix-preserving rename is invisible to a
  // substring, which is the one class of rot the STALE branch exists to catch.
  const i18nHit = changeKindLines(['packages/services/service-messaging/src/objects/http-delivery.object.ts'], resolved);
  t('an owning-package path emits the i18n convention section', i18nHit.length === 2 && i18nHit[0].includes('owns an i18n-extract.config.ts'));
  t('the i18n section names check:i18n exactly, runnably', i18nHit.some((l) => l.includes('- pnpm check:i18n   —')));
  t('a path outside every owning package emits no i18n section', !changeKindLines(['packages/objectql/src/engine.ts'], resolved).some((l) => l.includes('check:i18n')));

  // The measured incident (#8410 / PR #8399), pinned against the REAL workflow
  // rather than a fixture: a fixture proves the parser, only the live file
  // proves that THIS repo's changeset gate is reachable. `Check Changeset`
  // invokes check-adr-0087-registration.mjs from a block-scalar body, and that
  // is the gate PR #8399's declared-breaking changeset went red on after a
  // fully green local loop. If the step is ever rewritten as a one-liner this
  // case still passes (it asserts discovery, not the YAML style); if the gate
  // moves out of pr-automation.yml, re-point the case at its new home rather
  // than deleting it.
  const liveWf = readFileSync(join(ROOT, '.github/workflows/pr-automation.yml'), 'utf8');
  const liveInvs = extractCheckInvocations(liveWf, 'pr-automation.yml').map((i) => i.check);
  t('the live Check Changeset job discovers its ADR-0087 gate', liveInvs.includes('scripts/check-adr-0087-registration.mjs'));
  t('the live Check Changeset job discovers its empty-changeset gate', liveInvs.includes('scripts/check-empty-changeset.mjs'));
  t('the live one-line gate in that file still discovers', liveInvs.includes('scripts/check-changeset-no-major.mjs'));
  // The end-to-end direction: a `.changeset/` path must now REACH the ADR-0087
  // gate through the ordinary watch-hint match. That gate names `.changeset` in
  // its own source, so this asserts the whole chain (discover -> resolve ->
  // hint -> cover) rather than the parser alone.
  const adrHints = extractWatchHints(readFileSync(join(ROOT, 'scripts/check-adr-0087-registration.mjs'), 'utf8'));
  t('a .changeset path is covered by the ADR-0087 gate own hints', adrHints.some((h) => hintCovers(h, '.changeset/some-breaking-change.md')));

  // ── The measured population (#8478), against the REAL scripts ─────────────
  //
  // A fixture proves the boundary; only these files prove that THIS tree's
  // gates land on the right side of it. Each pin names a path the card measured
  // before the narrowing, so a regression reads as the specific claim it broke
  // rather than as a count. If a gate is renamed or moves, re-point the case at
  // its new home — deleting one deletes the evidence, not the problem.
  //
  // Measured on this branch's base (commit 3208222) and after, coverage-capable
  // hints per script: dispatch-gates 46 -> 5, check-empty-changeset 36 -> 3,
  // check-adr-0087-registration 34 -> 6, check-skill-id-lint 2 -> 2 (already
  // clean, the control). Across all 66 discoverable gate scripts: 1144 hints ->
  // 473, with no hint gained that any repo path can reach.
  const readHints = (rel) => extractWatchHints(readFileSync(join(ROOT, rel), 'utf8'));
  const covers = (hs, p) => hs.some((h) => hintCovers(h, p));

  t(
    'the ADR-0087 gate no longer claims a runtime path through its own fixtures',
    !covers(adrHints, 'packages/runtime/src/index.ts'),
  );
  const emptyHints = readHints('scripts/check-empty-changeset.mjs');
  t('the empty-changeset gate still reaches a .changeset path', covers(emptyHints, '.changeset/anything.md'));
  t(
    'the empty-changeset gate no longer claims a skills path through its own fixtures',
    !covers(emptyHints, 'skills/demo/SKILL.md'),
  );
  // The load-bearing survivor: this gate's real literals are the per-file
  // ceiling keys (repo-relative paths in its CEILINGS map) — before the
  // narrowing it reached SKILL.md only through a path copy in its own header,
  // a real input carried by prose.
  const ratchetHints = readHints('scripts/pm/check-skill-line-ratchet.mjs');
  t('the skill ratchet still reaches the SKILL.md it counts', covers(ratchetHints, '.claude/skills/pm-dispatch/SKILL.md'));
  t('the skill ratchet reaches the references files it now counts', covers(ratchetHints, '.claude/skills/pm-dispatch/references/dispatch-runbook.md'));
  t(
    'the skill ratchet claims only its covered files, not all of references/',
    !covers(ratchetHints, '.claude/skills/pm-dispatch/references/facts.md'),
  );
  // The control the card called "what a clean one looks like": two hints, both
  // real, unchanged by the narrowing.
  const idLintHints = readHints('scripts/pm/check-skill-id-lint.mjs');
  t('the skill-id lint keeps both of its real inputs', covers(idLintHints, '.claude/skills/pm-dispatch/SKILL.md') && covers(idLintHints, '.claude/agents/os-dev.md'));
  // This tool's own gate: its thin gate file's one literal is the tool, so a
  // card editing the tool must still derive it.
  t('the dispatch-gates gate still reaches the tool it runs', covers(readHints('scripts/pm/check-dispatch-gates.mjs'), 'scripts/pm/dispatch-gates.mjs'));
  // And this file, the worst specimen in the card's table: the directory it
  // really reads survives, the fixtures naming other packages do not.
  const ownHints = readHints('scripts/pm/dispatch-gates.mjs');
  t('this tool still hints the workflow directory it reads', covers(ownHints, '.github/workflows/lint.yml'));
  t('this tool no longer hints the spec paths its own fixtures name', !covers(ownHints, 'packages/spec/src/data/filter.zod.ts'));
  // The LIVE trailing-dot specimen (#8534): this gate spells its own filename as
  // the last word of a sentence, in a module-body array element that comment
  // masking cannot reach, so the hint carried the period. Pinned live because
  // the fixture above proves the trimming and only this file proves the tree
  // still contains the shape. If that sentence is ever rewritten, re-point the
  // case at whatever file then carries a trailing-dot literal — or, if none
  // does, delete it together with the trim, never ahead of it.
  const compatHints = readHints('scripts/check-skill-compatibility-version.mjs');
  t('the live trailing-dot hint is trimmed to the file it names', compatHints.includes('scripts/check-skill-compatibility-version.mjs'));
  t('so it still reaches that file under the segment rule', covers(compatHints, 'scripts/check-skill-compatibility-version.mjs'));

  // ── The one DECLARED coupling (#8551) ─────────────────────────────────────
  //
  // The narrowing above is about gates that MENTION a path without reading it.
  // This is its mirror image: a gate that really does move with a path it never
  // opens. The type-check ledgers ratchet a count for the workspace root, whose
  // program is the scripts tree, and one script accounts for 29 of that entry's
  // 80 errors — so editing it moves a number this farm holds. The coupling was
  // written down all along, inside the ledger note's prose, where whole-literal
  // extraction discards it: the family then scored `silent` — neither matched
  // nor undetermined, printed nowhere — and a card editing that script was told
  // no family names its paths.
  //
  // The remedy is per-coupling and manual (a bare, whole-literal constant in
  // the gate's own module body), which is exactly the kind of declaration that
  // rots quietly. So it is pinned LIVE, against both real files: delete the
  // constant and this gate reddens instead of the silence coming back. If the
  // ledger's coupling genuinely ends, delete the constant AND these cases in
  // the same change — the evidence goes with the claim, never ahead of it.
  //
  // This does NOT retire the test-file entry in CHANGE_KIND_GATES, whose
  // deletion criterion is a discoverable literal for that KIND: the constant
  // names one script carrying no `.test.` infix, while that entry answers for
  // every test file in the tree.
  const coverageHints = readHints('scripts/check-type-check-coverage.mjs');
  t(
    'the type-check ledger gate declares the root-program script whose errors it ratchets',
    covers(coverageHints, 'scripts/check-test-typecheck.mts'),
  );
  const coupledVerdict = classifyEntry(
    { files: ['scripts/check-type-check-coverage.mjs'], hints: coverageHints },
    ['scripts/check-test-typecheck.mts'],
  );
  t(
    'so a card editing that script is MATCHED through that constant, not dropped as silent',
    coupledVerdict.verdict === 'matched' && coupledVerdict.hits[0]?.hint === 'scripts/check-test-typecheck.mts',
  );

  // ── A family's OWN script files as match keys (#8509) ─────────────────────
  //
  // Both directions are the product, and both are pinned: a card editing a
  // gate's script must derive that gate, and a card that touches nothing of the
  // gate's must gain nothing from the new key. The over-match direction is the
  // expensive one here — this key is added to EVERY discovered family at once,
  // so a key that covered too much would fabricate leads across the whole farm
  // rather than in one gate.
  const identityEntry = { files: ['scripts/check-empty-changeset.mjs'], hints: [] };
  t(
    'a gate script derives its own family, with the file path itself as provenance',
    coveringHint(identityEntry, 'scripts/check-empty-changeset.mjs') === 'scripts/check-empty-changeset.mjs',
  );
  t('an unrelated path gains nothing from the identity key', coveringHint(identityEntry, 'packages/rest/src/server.ts') === null);
  t('another gate script does not match through this one identity', coveringHint(identityEntry, 'scripts/check-adr-0087-registration.mjs') === null);
  t('a family that resolves to no file at all matches nothing by identity', coveringHint({ files: [], hints: [] }, 'scripts/check-empty-changeset.mjs') === null);
  // Precedence, in both of its directions. One answer per path either way — the
  // question is only which provenance a reader is shown when both keys fire.
  const bothKeys = { files: ['scripts/pm/check-x.mjs'], hints: ['scripts/pm'] };
  t('identity outranks a scanned hint that also covers', coveringHint(bothKeys, 'scripts/pm/check-x.mjs') === 'scripts/pm/check-x.mjs');
  t('a scanned hint still answers a path identity does not cover', coveringHint(bothKeys, 'scripts/pm/other.mjs') === 'scripts/pm');
  // The live thin-gate-file specimen, both directions. This tool's own gate is
  // one file whose single module-body constant is the tool it runs, so the two
  // keys answer DIFFERENT inputs and neither displaces the other. If that gate
  // is renamed or its file moves, re-point these cases rather than deleting
  // them — they are the evidence that the two keys compose.
  const gateEntry = { files: ['scripts/pm/check-dispatch-gates.mjs'], hints: readHints('scripts/pm/check-dispatch-gates.mjs') };
  t('the gate FILE now derives its own family', coveringHint(gateEntry, 'scripts/pm/check-dispatch-gates.mjs') === 'scripts/pm/check-dispatch-gates.mjs');
  t('the TOOL it runs still derives it through the module-body constant', coveringHint(gateEntry, 'scripts/pm/dispatch-gates.mjs') === 'scripts/pm/dispatch-gates.mjs');
  // The card's own specimen, resolved through the REAL root package.json: the
  // gate whose entire job is running that script's self-test names the script
  // there and nowhere in the script's source, which is why the identity key is
  // the only thing that can reach it.
  const liveRootScripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts ?? {};
  const selfTestGateFiles = resolveCheckToFiles('check:changeset-gate-self-tests', liveRootScripts);
  t('the changeset self-test gate really resolves to the script the card named', selfTestGateFiles.includes('scripts/check-empty-changeset.mjs'));
  t(
    'so a card editing that script now derives that gate end to end',
    coveringHint({ files: selfTestGateFiles, hints: [] }, 'scripts/check-empty-changeset.mjs') === 'scripts/check-empty-changeset.mjs',
  );

  // The bucket the one-line spelling would empty. A family whose source names
  // no path still resolves to a script file, so identity must decide matching
  // WITHOUT being allowed to answer "does this gate's source name a path?".
  const noLiterals = { files: ['scripts/check-silent.mjs'], hints: [] };
  t('a family with no scanned hints stays undetermined for an unrelated card', classifyEntry(noLiterals, ['packages/rest/src/server.ts']).verdict === 'undetermined');
  t('the same family is MATCHED, not undetermined, for a card editing its script', classifyEntry(noLiterals, ['scripts/check-silent.mjs']).verdict === 'matched');
  t('a family whose scanned hints all miss is neither matched nor undetermined', classifyEntry({ files: [], hints: ['packages/spec/src'] }, ['docs/adr/0112-x.md']).verdict === 'silent');
  const identityHits = classifyEntry(noLiterals, ['scripts/check-silent.mjs', 'packages/rest/src/server.ts']).hits;
  t('an identity hit carries the path and the key that covered it, once', identityHits.length === 1 && identityHits[0].path === 'scripts/check-silent.mjs' && identityHits[0].hint === 'scripts/check-silent.mjs');

  // The table's own rot detector: a name no live run discovers must say so,
  // never disappear quietly.
  const stale = changeKindLines(['a.test.ts'], () => null);
  t('an undiscoverable gate renders as STALE', stale.filter((l) => l.includes('STALE')).length === 5);
  // Per NAME, anchored on both sides of the rendered name (`⚠ x: STALE`), so the
  // pair that shares one script is reported apart: a count alone stays green if
  // one of the two is dropped from the table and something else is added, and a
  // leading substring stays green through a `-v2` rename — the two ways this
  // table has actually rotted.
  t('the coverage half renders STALE under its own name', stale.some((l) => l.includes('⚠ check:type-check-coverage: STALE')));
  t('the ratchet half renders STALE under its own name', stale.some((l) => l.includes('⚠ check:type-check-debt: STALE')));
  t('the engine-double ratchet renders STALE under its own name', stale.some((l) => l.includes('⚠ check:engine-double-contract: STALE')));
  t('the where-matcher ratchet renders STALE under its own name', stale.some((l) => l.includes('⚠ check:where-matcher: STALE')));
  const i18nStale = changeKindLines(['packages/services/service-messaging/scripts/i18n-extract.config.ts'], () => null);
  t('an undiscoverable check:i18n renders as STALE', i18nStale.filter((l) => l.includes('⚠ check:i18n: STALE')).length === 1);
  t('every declared convention gate carries a reason', CHANGE_KIND_GATES.every((k) => k.gates.every((g) => g.name && g.why)));

  // ── The census guard (#8632) ──────────────────────────────────────────────
  //
  // CHANGE_KIND_GATES is the one enumerable list in this file, so it is the one
  // list a guard can hold. The STALE branch reports a rotted name to whoever
  // reads the output; this case makes the same rot fail CI, against the REAL
  // workflow tree rather than a fixture. Discovery is repeated here rather than
  // borrowed from `derive`, which prints instead of returning — the assertion is
  // "every name in the table is a family the workflows really run", and it needs
  // the live population to mean anything.
  const liveFamilies = new Set();
  for (const wf of readdirSync(join(ROOT, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f))) {
    for (const i of extractCheckInvocations(readFileSync(join(ROOT, '.github/workflows', wf), 'utf8'), wf)) {
      liveFamilies.add(i.check);
    }
  }
  t('the live workflows discover a farm at all (the guard is not vacuous)', liveFamilies.size > 20);
  const declared = CHANGE_KIND_GATES.flatMap((k) => k.gates.map((g) => g.name));
  const missing = declared.filter((n) => !liveFamilies.has(n));
  t(`every convention gate named in the table is a live family (missing: ${missing.join(', ') || 'none'})`, missing.length === 0);
  // The two gates this card moved out of the closing prose, pinned individually
  // — a count alone stays green if one is dropped and another added.
  t('check:engine-double-contract is a live family, so naming it in the table is not a guess', liveFamilies.has('check:engine-double-contract'));
  t('check:where-matcher is a live family too — the gate the prose never named', liveFamilies.has('check:where-matcher'));

  // ── The residue accounting (#8632) ────────────────────────────────────────
  //
  // Two properties, both of which the deleted prose lacked: it accounts for
  // every discovered family, and it names no gate. The second is the one that
  // rots — a hand-written list of gate names in this paragraph is exactly what
  // was wrong with it — so it is asserted directly rather than by inspection.
  const residue = residueLines({ discovered: 98, matched: 8, undetermined: 35, silent: 55 });
  t('the residue summary states the discovered total', residue.some((l) => l.includes('98')));
  t('the residue summary states each bucket', residue.some((l) => l.includes('35 undetermined')) && residue.some((l) => l.includes('55 silent')));
  t('the residue summary points at the flag that lists the unplaced families', residue.some((l) => l.includes('--residue') && l.includes('90')));
  t('the residue summary names NO gate — the property the deleted prose lacked', !/check:[\w:-]+/.test(residue.join('\n')));
  t('the residue summary still names the convention KINDS it derives', residue.some((l) => l.includes('adds or edits a test file')));
  // The partition must be a partition. A fourth bucket added to classifyEntry
  // and not wired into the summary would otherwise shrink the residue silently,
  // which is the failure class this whole card is about.
  let refused = false;
  try {
    residueLines({ discovered: 98, matched: 8, undetermined: 35, silent: 54 });
  } catch {
    refused = true;
  }
  t('a partition that does not account for every discovered family is REFUSED', refused);

  // ── The model-tier derivation (#8640) ─────────────────────────────────────
  //
  // The incident these pin: a surface containing a pm-dispatch REFERENCES file
  // was claimed as "not under the fable-mandatory roots" and dispatched at
  // opus. Every direction of that judgment is asserted here — the root, the
  // references half that was actually missed, a mixed surface where the
  // ordinary paths must not dilute the mandate, and the ordinary surface that
  // must NOT be mandated (a tool that mandates everything is ignored, which
  // loses the guardrail by the other road).
  const fableOf = (paths) => deriveTier(paths);
  t('a pm-dispatch ROOT path is fable-mandatory', fableOf(['.claude/skills/pm-dispatch/SKILL.md']).tier === 'claude-fable-5');
  t('a pm-dispatch REFERENCES path is fable-mandatory too — the half the incident missed', fableOf(['.claude/skills/pm-dispatch/references/review-checklist.md']).tier === 'claude-fable-5');
  const mixed = fableOf(['packages/spec/src/data/filter.zod.ts', '.claude/skills/pm-dispatch/references/review-checklist.md']);
  t('a MIXED surface is mandatory — one mandatory path decides, ordinary paths do not dilute it', mixed.mandatory && mixed.tier === 'claude-fable-5');
  t('the mixed verdict reports the offending path, not just the verdict', mixed.hits.length === 1 && mixed.hits[0].path.endsWith('references/review-checklist.md'));
  t('an ordinary surface carries no path-derived mandate', fableOf(['packages/spec/src/data/filter.zod.ts']).mandatory === false);
  t("this tool's own file is not mandatory — the card that added this section reads itself correctly", fableOf(['scripts/pm/dispatch-gates.mjs']).mandatory === false);
  // Segment boundaries, both directions of the shared matcher's asymmetry.
  t('a sibling directory sharing a name PREFIX is not mandated', fableOf(['.claude/skills/pm-dispatchers/notes.md']).mandatory === false);
  t('a surface declared as an ANCESTOR of a mandatory root IS mandated — the safe direction here', fableOf(['.claude/skills']).mandatory === true);
  t('another skill under the same parent is not mandated', fableOf(['.claude/skills/verify/SKILL.md']).mandatory === false);
  // The rendering is where the invariant is actually delivered: the claim
  // comment quotes THESE lines.
  const mandLines = tierLines(mixed).join('\n');
  t('the mandatory rendering names the tier', mandLines.includes('claude-fable-5'));
  t('the mandatory rendering says MANDATORY in a word a reader cannot skim past', mandLines.includes('MANDATORY'));
  t('the mandatory rendering shows its provenance — the path and the glob that covered it', mandLines.includes('.claude/skills/pm-dispatch/references/review-checklist.md') && mandLines.includes(".claude/skills/pm-dispatch/**'"));
  t('the mandatory rendering names the ONE exit, so a downgrade needs a stated reason', mandLines.includes('quota exemption') && mandLines.includes('opus, never lower'));
  const plainLines = tierLines(fableOf(['packages/spec/src/data/filter.zod.ts'])).join('\n');
  t('the no-mandate rendering claims no mandate', !plainLines.includes('MANDATORY'));
  t('the no-mandate rendering names the floor and the default, so the judgment call has its band', plainLines.includes(TIER_FLOOR) && plainLines.includes(TIER_DEFAULT));
  t('BOTH renderings state that clause ② is out of reach of paths — a no-mandate line is not a clearance', plainLines.includes('Clause ②') && mandLines.includes('Clause ②'));
  t('the no-mandate rendering says how many globs it checked, so an empty table cannot read as a clearance', plainLines.includes(`${MANDATORY_TIER_GLOBS.length} declared glob`));
  // Refusals: a contradiction is not printed, and an ambiguity is not guessed.
  let tierRefused = false;
  try {
    tierLines({ mandatory: false, tier: null, hits: [{ path: 'x', glob: 'y', why: 'z' }], declared: 1 });
  } catch {
    tierRefused = true;
  }
  t('a verdict with a hit but no mandate is REFUSED, never rendered', tierRefused);
  let ambiguityRefused = false;
  try {
    deriveTier(['.claude/skills/pm-dispatch/SKILL.md'], [
      { glob: '.claude/skills/pm-dispatch/**', tier: 'claude-fable-5', why: 'a' },
      { glob: '.claude/skills/**', tier: 'opus', why: 'b' },
    ]);
  } catch {
    ambiguityRefused = true;
  }
  t('two globs mandating DIFFERENT tiers for one surface are REFUSED, not guessed between', ambiguityRefused);
  // Live guards. A glob naming a path this tree does not have is dead data that
  // mandates nothing while reading as protection — the incident class itself.
  t('the mandatory table is not empty (the guard below is not vacuous)', MANDATORY_TIER_GLOBS.length > 0);
  const deadGlobs = MANDATORY_TIER_GLOBS.filter(
    (g) => !existsSync(join(ROOT, g.glob.replace(/\*\*?/g, '').replace(/\/+$/, ''))),
  );
  t(`every declared mandatory glob names a path this tree really has (dead: ${deadGlobs.map((g) => g.glob).join(', ') || 'none'})`, deadGlobs.length === 0);
  t('every declared glob carries the tier it mandates and a reason', MANDATORY_TIER_GLOBS.every((g) => g.glob && g.tier && g.why));
  t('the incident file is a real file, so the references case is a live claim and not a fixture', existsSync(join(ROOT, '.claude/skills/pm-dispatch/references/review-checklist.md')));

  let failed = 0;
  for (const [name, cond] of cases) {
    if (!cond) failed++;
    console.log(`  ${cond ? '✓' : '✗'} ${name}`);
  }
  if (failed) {
    console.error(`✗ dispatch-gates self-test: ${failed} of ${cases.length} case(s) failed.`);
    process.exit(1);
  }
  console.log(`✓ dispatch-gates self-test: ${cases.length} cases pass.`);
}

const argvPaths = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (process.argv.includes('--self-test')) {
  selfTest();
} else if (argvPaths.length === 0) {
  console.error('usage: node scripts/pm/dispatch-gates.mjs [--residue] [--tier] <path> [<path> ...] | --self-test');
  process.exit(2);
} else {
  const paths = argvPaths.map((p) => p.replace(/^\.\//, ''));
  try {
    // `--tier` answers the claim-time question alone: it reads no workflow and
    // no check script, so it still answers on a tree where the gate derivation
    // cannot run — and a claim comment is written before any of that matters.
    if (process.argv.includes('--tier')) {
      for (const line of tierLines(deriveTier(paths))) console.log(line);
    } else {
      derive(paths, { showResidue: process.argv.includes('--residue') });
    }
  } catch (err) {
    console.error(`dispatch-gates: derivation failed — ${err.message}`);
    process.exit(2);
  }
}
