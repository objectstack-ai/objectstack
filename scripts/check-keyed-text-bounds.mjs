#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-keyed-text-bounds (#12147) -- a text-family column that a DECLARED
 * INDEX keys on must declare a `maxLength`.
 *
 *   node scripts/check-keyed-text-bounds.mjs              # judge the tree
 *   node scripts/check-keyed-text-bounds.mjs --list       # the full sweep, per object
 *   node scripts/check-keyed-text-bounds.mjs --self-test  # prove the detector can go red
 *
 * ## The defect class, and why it is not a per-package pin's to hold
 *
 * `driver-sql` emits a keyed text-family column as `varchar(maxLength)` when
 * the field declares a bound the dialect can key on, and leaves it `TEXT`
 * otherwise. MySQL refuses a TEXT/BLOB column in a key without a prefix length
 * (`ER_BLOB_KEY_WITHOUT_LENGTH`), so an unbounded keyed text column means:
 * `CREATE TABLE` succeeds, `ALTER TABLE ... ADD [UNIQUE] INDEX` fails, and the
 * object lands REGISTERED-BUT-BROKEN with its declared index silently absent.
 * Measured live on MySQL 8.0.46 (#12058): 12 of 44 platform objects failed
 * schema-sync this way, `sys_session` and `sys_account` among them -- a MySQL
 * stack could not sign anyone in. The driver deliberately does not substitute a
 * prefix index (a prefix-UNIQUE index is stricter-and-different: measured
 * `ER_DUP_ENTRY` on a second, genuinely distinct token sharing 191 characters),
 * so the bound has to live in the field declaration. That is route A, the
 * maintainer's 2026-08-24 ruling on #11374.
 *
 * Enforcement then widened three times and stopped at a boundary each time:
 * `identity/` -> all of `platform-objects` (#12058) -> per-plugin pins in
 * `plugin-audit` / `plugin-security` (#12143). Every widening was triggered by
 * a column that ESCAPED the previous scope -- `sys_import_job.created_by` out
 * of `identity/`, then `sys_activity.record_id` and `sys_audit_log.record_id`
 * out of `platform-objects` when ADR-0029 K2 moved their objects into plugins.
 * A pin scoped to a package polices a package, not the defect class, and
 * objects keep moving across package boundaries.
 *
 * ## Why a SOURCE SCAN rather than one central importing pin
 *
 * Measured on PR #12143, not argued: a central pin cannot import the plugins'
 * objects. Each plugin's `package.json` declares only the `.` export and the
 * root barrel does not re-export `./objects`; making it importable would invert
 * the dependency graph, because `platform-objects` depends only on
 * `metadata-core` + `spec` while both plugins depend on `platform-objects`. A
 * pin there importing the plugins is a cycle. Two alternatives were measured
 * and disrecommended on that PR: exporting `./objects` from every plugin widens
 * published surfaces to serve a test, and a leaf conformance package grows a
 * dependency edge per plugin forever.
 *
 * So this is the idiom the repo already blesses for dependency-free detection
 * -- "a detector with no dependencies cannot itself fail to resolve in CI",
 * per `check:cross-package-test-inputs`. Node builtins plus the shared comment
 * mask, nothing else: it runs against an empty `node_modules`, so a reviewer
 * can run it in place and CI cannot fail it for the wrong reason.
 *
 * ## The price of a source scan, and the two things that pay it
 *
 * A source scan sees only the spellings it knows, and an unrecognised one
 * produces no finding -- SILENTLY. That is the same failure the pins it
 * replaces were written against, one layer down. Two mechanisms pay for it,
 * and both fail LOUD rather than empty:
 *
 *  1. **Refusal, not omission.** Every shape this file cannot classify is an
 *     `exit 2` refusal naming the file, the line and the shape -- an unknown
 *     `Field.<builder>`, a field whose `type` is not a string literal, a
 *     `maxLength` that is not a literal, an index entry that is not an object
 *     literal, an index keying a column the object does not declare. The
 *     refusals are only raised for columns a declared index actually KEYS, so
 *     an unrelated authoring style elsewhere in the object costs nothing.
 *     `--list` prints every unclassified-but-unkeyed field, so the population
 *     that is being tolerated is visible rather than assumed.
 *
 *  2. **Vacuity floors.** A sweep that finds nothing because it swept nothing
 *     reports exactly what a clean tree reports. Four counts have floors --
 *     object files walked, object declarations parsed, index entries read,
 *     text-family fields seen -- and the fifth, the KEYED text columns that are
 *     the judged population, has the strictest one. Below any floor the gate
 *     refuses (`exit 2`) instead of passing.
 *
 * ## The provenance of a floor, and how to reproduce it
 *
 * `MEASURED` is a claim about ONE named commit -- `MEASURED.ref` -- and never
 * about `main`. It is the census the floors under it were derived from, not a
 * statement about the tree you are running on.
 *
 * ⚠️ `MEASURED.ref` is this gate's PR BASE, and this gate DOES NOT EXIST in
 * that tree: the census was taken on the PR branch, and the base is the sha the
 * branch had to record. So the obvious recipe -- check the ref out and run the
 * gate there -- fails with `MODULE_NOT_FOUND` (measured 2026-08-29), and the
 * reader who tries it learns nothing about the record. Reproduce it by running
 * TODAY's instrument AGAINST that tree instead. `sweep` is exported and takes a
 * root for exactly this:
 *
 *   git worktree add --detach ../os-keyed-provenance "$REF"   # $REF = MEASURED.ref
 *   node --input-type=module -e "import('./scripts/check-keyed-text-bounds.mjs')
 *     .then((m) => console.log(m.sweep('../os-keyed-provenance').counts))"
 *
 * All five counts are source-only, so where the tree is available the
 * re-derivation is cheap: no install and no build. Re-derived at `MEASURED.ref`
 * on 2026-08-29: 113/118/255/594/151 -- exactly the record, which is the
 * measurement that rules out "the original count was written wrong".
 *
 * ⚠️ A SHALLOW clone cannot do this at all -- `MEASURED.ref` predates the
 * default checkout window, so the commit is simply absent. That is why the
 * reconciliation below is a PRINTED comparison and not a computed assertion:
 * the ref's tree is not reliably on disk. And note what a computed assertion
 * would be worth even where it works -- a commit's tree is IMMUTABLE, so
 * re-deriving the record at its ref can never go red. The only thing that moves
 * is today's tree, and comparing today's tree to the record is the equality
 * ruled out below.
 *
 * ## Why no equality against the tree, and why no band either
 *
 * An equality reds on every legitimate move. This population shrinks for good
 * reasons as readily as it grows: retiring an object, folding two objects into
 * one, or dropping an index each decrement it with nothing wrong. A band around
 * the record is the next thing to reach for, and it fails a derivation rather
 * than a taste test. Two reasons, either one sufficient:
 *
 *   1. The band already exists and is called the FLOOR. `MIN_FILES` IS
 *      `MEASURED.files` minus the headroom this gate declared. A second,
 *      narrower band would be a second tolerance for one fact, and its width
 *      would be invented rather than measured.
 *   2. No width measures anything. Measured 2026-08-29, the three gates in
 *      `scripts/` carrying a record of this shape had drifted -5, -1 and +28
 *      from theirs, in both directions, within days of landing. A band narrow
 *      enough to notice this file's -1 reds on the +28 next door; one wide
 *      enough to survive the +28 cannot see a -1.
 *
 * So the repair is not enforcement. What was missing is that a GREEN run never
 * showed the reader the two censuses side by side, so the record could stop
 * describing the tree with nothing, anywhere, saying so. `provenanceLine`
 * prints both on every pass: the drift is a fact in the log, not a discovery.
 *
 * ## "text-family" is READ OFF THE EMITTER, not retyped here
 *
 * The three pins this gate supersedes each hard-coded
 * `TEXT_FAMILY = {text, textarea, html, markdown}`. That set has been WRONG
 * since #11794 and #11875: `driver-sql`'s own `varcharColumnChars` routes
 * `richtext`, `code`, `signature` and `qrcode` through `keyableTextLength` too,
 * so those four types have the identical MySQL failure and no pin in the tree
 * could see them. Retyping the set here would reproduce that drift a fourth
 * time, so it is EXTRACTED from `packages/drivers/driver-sql/src/sql-driver.ts`
 * -- the `case` labels that fall into the `keyed ? this.keyableTextLength(...)`
 * arm, with comments masked. `EXPECTED_TEXT_FAMILY` below is a witness, not the
 * source: when the two disagree the gate REFUSES and names both sets, so a type
 * joining or leaving the family is a decision someone makes here rather than a
 * silent widening of what goes unpoliced.
 *
 * ## Scope: `maxLength` presence, deliberately -- not the >768 ceiling
 *
 * Route A's rule is "a keyed text-family column declares a bound". Whether a
 * declared bound is small enough for MySQL's utf8mb4 key-part ceiling (768
 * characters) is a DIFFERENT class with a different disposition -- #11627 for
 * the UNIQUE half (carried on a hash-shadow column) and #11701 for the
 * non-unique half (no shadow is possible; the column must be keyable or the
 * index must go). Those two are not folded in here, and the `platform-objects`
 * pin's `#11701` describe stays exactly where it is for that reason.
 *
 * ## What a red means
 *
 * A keyed text-family field arrived without a `maxLength`. Do not silence it:
 * derive a bound from the value's PRODUCER and declare it, naming the producer
 * in the declaration so it is vetoable in review. If the value genuinely cannot
 * be bounded, add an `ALLOWLIST` row naming why -- and read #11701 first, since
 * an unboundable column may only be keyed by a UNIQUE index.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { blank, scanSource } from './js-comment-mask.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

// ---------------------------------------------------------------------------
// Declared vocabulary -- published here because a source scan that meets an
// unpublished spelling produces no finding, silently.

/**
 * `Field.<builder>` -> the `type` string the builder emits, read off
 * `packages/spec/src/data/field.zod.ts`. Every entry is `name === type` except
 * `masterDetail`, which emits `master_detail`.
 *
 * A builder NOT in this map, used on a column a declared index keys, is a
 * refusal -- never a pass. Extend it (and add a `--self-test` case) rather than
 * routing around it.
 */
const FIELD_BUILDER_TYPES = {
  address: 'address',
  autonumber: 'autonumber',
  avatar: 'avatar',
  boolean: 'boolean',
  code: 'code',
  color: 'color',
  currency: 'currency',
  date: 'date',
  datetime: 'datetime',
  email: 'email',
  file: 'file',
  formula: 'formula',
  html: 'html',
  image: 'image',
  json: 'json',
  location: 'location',
  lookup: 'lookup',
  markdown: 'markdown',
  masterDetail: 'master_detail',
  number: 'number',
  password: 'password',
  percent: 'percent',
  phone: 'phone',
  qrcode: 'qrcode',
  rating: 'rating',
  richtext: 'richtext',
  secret: 'secret',
  select: 'select',
  signature: 'signature',
  slider: 'slider',
  summary: 'summary',
  text: 'text',
  textarea: 'textarea',
  time: 'time',
  url: 'url',
  user: 'user',
  vector: 'vector',
};

/**
 * The text family, as a WITNESS. The authority is `driver-sql`'s own switch
 * (see `readTextFamilyFromEmitter`); this is what the extraction must agree
 * with, so a change on either side is reported rather than absorbed.
 */
const EXPECTED_TEXT_FAMILY = [
  'code', 'html', 'markdown', 'qrcode', 'richtext', 'signature', 'text', 'textarea',
];

/** Where the emitter's answer is read from. */
const EMITTER_FILE = join('packages', 'drivers', 'driver-sql', 'src', 'sql-driver.ts');

/**
 * The anchor the extraction walks backwards from -- the arm of
 * `varcharColumnChars`'s switch that a KEYED text-family column reaches.
 */
const EMITTER_ANCHOR = 'keyed ? this.keyableTextLength(field) : null';

/**
 * Columns `driver-sql` creates itself, so an index may key them although the
 * object never declares them. None is text-family: `id` is a
 * `varchar(255)` primary key and the two timestamps are DATETIME columns
 * (`createTable`'s built-ins, the same three `initObjects` skips when iterating
 * `obj.fields`). An index naming anything else the object does not declare is a
 * refusal, not a silent skip.
 */
const BUILTIN_COLUMNS = new Set(['id', 'created_at', 'updated_at']);

/**
 * The per-package allowlist: keyed text-family columns this gate does not fail
 * on, each with its package, its disposition and its reason.
 *
 * Two dispositions, and they are NOT interchangeable:
 *
 *   `unboundable` -- no bound can be defended. The row must say what the value
 *       source is and why nothing admits it. ⚠️ Read #11701 first: an
 *       unboundable column may only be keyed by a UNIQUE index, because a
 *       UNIQUE index is the only kind #11627's hash shadow can carry.
 *   `pending` -- the column IS boundable and is not bounded yet. The row must
 *       cite the issue that will bound it. This is debt with a name on it, not
 *       an exemption.
 *
 * It is a ledger, not a wildcard, and it cannot rot in any direction. A row
 * whose column stopped being a keyed text column FAILS; a row whose column has
 * since been bounded FAILS; a row whose `pkg` does not match where the column
 * actually lives FAILS; a `pending` row with no issue FAILS. And a column that
 * is not enumerated here fails the gate outright -- so a NEW offender is caught
 * whatever the ledger holds, which is the property that makes it safe to land
 * with rows in it.
 *
 * The ledger is EMPTY today, and empty is a RESULT: every keyed text column in
 * the tree declares a bound (#12978 retired the 15 `pending` rows the sweep
 * landed with).
 *
 * @type {ReadonlyArray<{ pkg: string, column: string, kind: 'unboundable' | 'pending', why: string, issue?: string }>}
 */
const ALLOWLIST = [
];

const ALLOWLIST_KINDS = new Set(['unboundable', 'pending']);

// ---------------------------------------------------------------------------
// Vacuity floors, and the provenance of the census they were derived from --
// the header is the authority on how to reproduce it and on why it is recorded
// rather than enforced. Each floor sits just under its measured value, so a
// walk or a matcher that collapses REFUSES instead of reporting the empty
// finding set that success also looks like. The ref lives INSIDE the record, so
// a count and the tree it came from cannot be edited apart, and every site that
// quotes either interpolates from here instead of restating it. Re-measuring UP
// is free; LOWERING a floor to make a run pass is the move this block exists to
// make visible in a diff.

const MEASURED = Object.freeze({
  // The commit this census describes. ⚠️ It is this gate's PR BASE, not a tree
  // the gate ever ran in -- see the header for the recipe that actually
  // reproduces it, and for why that distinction is not a detail. Immutable, so
  // the record stays reproducible forever even as `main` moves away from it.
  // ⛔ Never repoint it without re-running all five counts against the new ref.
  ref: 'fa5d137ab0',
  files: 113,
  objects: 118,
  indexEntries: 255,
  textFields: 594,
  keyedTextColumns: 151,
});
const MIN_FILES = 105;
const MIN_OBJECTS = 110;
const MIN_INDEX_ENTRIES = 235;
const MIN_TEXT_FIELDS = 550;
const MIN_KEYED_TEXT_COLUMNS = 140;

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage', '.turbo', '.next', '.cache', '.changeset',
]);

/** Where shipped object declarations are discovered. */
const OBJECT_FILE_SUFFIX = '.object.ts';

/**
 * The subtrees this gate's population lives in, declared so a dispatch brief
 * can NAME it. Without this the gate is reachable only by its own script path,
 * so a card editing an object file -- the population it judges -- would never
 * be told to run it: the invisible-population species
 * `scripts/pm/bare-root-worklist.mjs` exists to count. `hintCovers` refuses a
 * separator-less literal as too generic, so the glob form is the reachable one.
 *
 * ⚠️ These are a DECLARATION, not the walk. The walk is the whole repository
 * minus `SKIP_DIRS`, deliberately: a boundary-scoped sweep is the defect this
 * gate exists to close, so narrowing the WALK to these roots would rebuild that
 * hole one level up. `hintProblem` holds the two together from the other side
 * -- an object file discovered OUTSIDE every hint is a refusal naming this
 * constant -- so the declaration can never silently under-name the population
 * while the sweep quietly keeps covering it.
 */
const ROOT_DIR_WATCH_HINTS = ['packages/**', 'apps/**', 'examples/**'];

/** Object files the sweep found outside every declared watch hint. */
function unhintedFiles(relPaths) {
  const roots = ROOT_DIR_WATCH_HINTS.map((h) => h.replace(/\/\*+$/, ''));
  return relPaths.filter((p) => !roots.some((r) => p === r || p.startsWith(`${r}/`)));
}

// ---------------------------------------------------------------------------
// Source structure -- comments masked, string CONTENT blanked for structure

/**
 * Two projections of one source, both offset-preserving.
 *
 * `masked` has comment spans blanked and literals intact: it is what values are
 * READ from. `struct` additionally has literal CONTENT blanked, delimiters
 * kept: it is what brackets are COUNTED on, so a `{` inside a string cannot
 * move the parse.
 */
function project(source) {
  const { comment, literal } = scanSource(source);
  const masked = blank(source, comment);
  return { masked, struct: blank(masked, literal) };
}

const OPEN_TO_CLOSE = { '(': ')', '{': '}', '[': ']' };

/** Index of the bracket matching the one at `openIdx`, or -1. */
function matchBracket(struct, openIdx) {
  const open = struct[openIdx];
  const close = OPEN_TO_CLOSE[open];
  if (close === undefined) return -1;
  let depth = 0;
  for (let i = openIdx; i < struct.length; i += 1) {
    if (struct[i] === open) depth += 1;
    else if (struct[i] === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Index of the quote closing the one at `i`, or -1. Content is blanked in `struct`. */
function closingQuote(struct, i) {
  const q = struct[i];
  for (let k = i + 1; k < struct.length; k += 1) if (struct[k] === q) return k;
  return -1;
}

/** Index of the depth-0 comma at or after `from`, else `end`. */
function scanToComma(struct, from, end) {
  let depth = 0;
  for (let i = from; i < end; i += 1) {
    const c = struct[i];
    if (c === '{' || c === '[' || c === '(') depth += 1;
    else if (c === '}' || c === ']' || c === ')') depth -= 1;
    else if (c === ',' && depth === 0) return i;
  }
  return end;
}

/**
 * Top-level entries of the object literal whose braces are `open`/`close`.
 * An entry with no readable `key: value` shape (a spread, a shorthand, a
 * computed key, a method) comes back with `key: null` so the caller decides.
 */
function objectEntries(struct, masked, open, close) {
  const entries = [];
  let i = open + 1;
  while (i < close) {
    const ch = struct[i];
    if (ch === ',' || /\s/.test(ch)) { i += 1; continue; }

    let key = null;
    let after = i;
    if (ch === "'" || ch === '"') {
      const end = closingQuote(struct, i);
      if (end < 0 || end >= close) return entries;
      key = masked.slice(i + 1, end);
      after = end + 1;
    } else if (/[A-Za-z_$]/.test(ch)) {
      let k = i;
      while (k < close && /[\w$]/.test(struct[k])) k += 1;
      key = struct.slice(i, k);
      after = k;
    }

    let colon = after;
    while (colon < close && /\s/.test(struct[colon])) colon += 1;
    if (key === null || struct[colon] !== ':') {
      const stop = scanToComma(struct, i, close);
      entries.push({ key: null, start: i, end: stop });
      i = stop + 1;
      continue;
    }

    let v = colon + 1;
    while (v < close && /\s/.test(struct[v])) v += 1;
    const stop = scanToComma(struct, v, close);
    entries.push({ key, start: v, end: stop, keyAt: i });
    i = stop + 1;
  }
  return entries;
}

/** Top-level element spans of the array literal whose brackets are `open`/`close`. */
function arrayElements(struct, open, close) {
  const out = [];
  let i = open + 1;
  while (i < close) {
    const ch = struct[i];
    if (ch === ',' || /\s/.test(ch)) { i += 1; continue; }
    const stop = scanToComma(struct, i, close);
    out.push([i, stop]);
    i = stop + 1;
  }
  return out;
}

/** Trim whitespace off a `[start, end)` span, returning the tightened span. */
function trimSpan(struct, start, end) {
  let a = start;
  let b = end;
  while (a < b && /\s/.test(struct[a])) a += 1;
  while (b > a && /\s/.test(struct[b - 1])) b -= 1;
  return [a, b];
}

/** The value of a single string literal filling the span, else `null`. */
function stringValue(struct, masked, start, end) {
  const [a, b] = trimSpan(struct, start, end);
  if (b - a < 2) return null;
  const q = struct[a];
  if (q !== "'" && q !== '"') return null;
  if (closingQuote(struct, a) !== b - 1) return null;
  return masked.slice(a + 1, b - 1);
}

const INTEGER_LITERAL = /^[0-9][0-9_]*$/;
/** A literal whose value is decidable without evaluating anything. */
const SIMPLE_LITERAL = /^(?:-?[0-9][0-9_]*(?:\.[0-9]+)?|'\s*'|"\s*"|true|false|null|undefined)$/;

/**
 * How a declared `maxLength` reads.
 *   { kind: 'integer', value }  a positive integer literal -- a bound
 *   { kind: 'literal', text }   a literal that is NOT a positive integer
 *   { kind: 'opaque',  text }   an expression this file will not evaluate
 */
function readBound(struct, start, end) {
  const [a, b] = trimSpan(struct, start, end);
  const text = struct.slice(a, b);
  if (INTEGER_LITERAL.test(text)) {
    const value = Number(text.replace(/_/g, ''));
    return value > 0 ? { kind: 'integer', value } : { kind: 'literal', text };
  }
  if (SIMPLE_LITERAL.test(text)) return { kind: 'literal', text };
  return { kind: 'opaque', text };
}

function lineStarts(source) {
  const starts = [0];
  for (let i = 0; i < source.length; i += 1) if (source[i] === '\n') starts.push(i + 1);
  return starts;
}

function lineAt(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

// ---------------------------------------------------------------------------
// The emitter's own text family

/**
 * The `case` labels that reach `varcharColumnChars`' keyed-text arm, read off
 * the driver with comments masked. Returns `{ family }` or `{ error }` -- an
 * extraction that cannot find its anchor is a refusal, never an empty set.
 */
export function readTextFamilyFromEmitter(root) {
  let source;
  try {
    source = readFileSync(join(root, EMITTER_FILE), 'utf8');
  } catch {
    return { error: `cannot read ${EMITTER_FILE} -- the emitter this gate reads its text family from.` };
  }
  const { struct, masked } = project(source);
  const anchor = struct.indexOf(EMITTER_ANCHOR);
  if (anchor < 0) {
    return {
      error: `could not find the keyed-text arm (\`${EMITTER_ANCHOR}\`) in ${EMITTER_FILE}.\n`
        + 'The emitter decides which types go TEXT unless keyed AND bounded; without it this\n'
        + 'gate would be judging a hand-retyped set, which is the drift it exists to prevent.',
    };
  }
  // Walk backwards over the consecutive `case '<t>':` labels that share the arm.
  const head = masked.slice(0, anchor);
  const labels = [];
  const re = /case\s*'([a-z_]+)'\s*:/g;
  let m;
  const spans = [];
  while ((m = re.exec(head)) !== null) spans.push({ type: m[1], start: m.index, end: re.lastIndex });
  for (let i = spans.length - 1; i >= 0; i -= 1) {
    const between = head.slice(spans[i].end, i + 1 < spans.length ? spans[i + 1].start : head.length);
    // The LAST label is separated from the anchor by the arm's own `return`;
    // between two labels of the SAME arm only whitespace may stand (comments
    // are masked to spaces, and the real switch carries several). Anything else
    // -- another `return`, a `break` -- means the previous arm already ended.
    const ok = i + 1 < spans.length ? between.trim() === '' : /^\s*return\s*$/.test(between);
    if (!ok) break;
    labels.push(spans[i].type);
  }
  if (labels.length === 0) return { error: `no \`case\` labels precede the keyed-text arm in ${EMITTER_FILE}.` };
  return { family: labels.sort() };
}

// ---------------------------------------------------------------------------
// The sweep

function walkObjectFiles(root) {
  const found = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(join(dir, e.name));
      } else if (e.isFile() && e.name.endsWith(OBJECT_FILE_SUFFIX)) {
        found.push(join(dir, e.name));
      }
    }
  }
  return found.sort();
}

const CREATE_CALL = /ObjectSchema\s*\.\s*create\s*\(/g;

/**
 * Parse every object declaration in one file.
 *
 * @returns {{ objects: Array, refusals: Array }}
 */
function parseObjectFile(absPath, relPath, source, textFamily) {
  const { masked, struct } = project(source);
  const starts = lineStarts(source);
  const refusals = [];
  const objects = [];
  const refuse = (offset, message) => refusals.push({ file: relPath, line: lineAt(starts, offset), message });

  CREATE_CALL.lastIndex = 0;
  let call;
  while ((call = CREATE_CALL.exec(struct)) !== null) {
    const parenOpen = CREATE_CALL.lastIndex - 1;
    const parenClose = matchBracket(struct, parenOpen);
    if (parenClose < 0) { refuse(parenOpen, 'unbalanced `ObjectSchema.create(` argument list'); continue; }

    let braceOpen = parenOpen + 1;
    while (braceOpen < parenClose && /\s/.test(struct[braceOpen])) braceOpen += 1;
    if (struct[braceOpen] !== '{') {
      refuse(parenOpen, 'the `ObjectSchema.create(...)` argument is not an object literal, so its fields and indexes cannot be read');
      continue;
    }
    const braceClose = matchBracket(struct, braceOpen);
    if (braceClose < 0 || braceClose > parenClose) { refuse(braceOpen, 'unbalanced object literal in `ObjectSchema.create(...)`'); continue; }

    const decl = objectEntries(struct, masked, braceOpen, braceClose);
    const nameEntry = decl.find((e) => e.key === 'name');
    const fieldsEntry = decl.find((e) => e.key === 'fields');
    const indexesEntry = decl.find((e) => e.key === 'indexes');

    const name = nameEntry === undefined ? null : stringValue(struct, masked, nameEntry.start, nameEntry.end);
    if (name === null) {
      refuse(braceOpen, 'object declaration has no `name:` string literal, so nothing it declares can be attributed');
      continue;
    }

    // ── indexes ────────────────────────────────────────────────────────────
    /** @type {Array<{ columns: string[], unique: string, at: number }>} */
    const indexes = [];
    if (indexesEntry !== undefined) {
      const [ia, ib] = trimSpan(struct, indexesEntry.start, indexesEntry.end);
      if (struct[ia] !== '[') {
        refuse(ia, `\`${name}.indexes\` is not an array literal, so its keyed columns cannot be read`);
        continue;
      }
      const bracketClose = matchBracket(struct, ia);
      if (bracketClose < 0 || bracketClose >= ib) { refuse(ia, `unbalanced \`${name}.indexes\` array`); continue; }
      let broken = false;
      for (const [ea, eb] of arrayElements(struct, ia, bracketClose)) {
        const [ta, tb] = trimSpan(struct, ea, eb);
        if (struct[ta] !== '{') {
          refuse(ta, `an entry of \`${name}.indexes\` is not an object literal (${struct.slice(ta, Math.min(tb, ta + 40)).trim()})`);
          broken = true;
          break;
        }
        const entryClose = matchBracket(struct, ta);
        const props = objectEntries(struct, masked, ta, entryClose);
        const fieldsProp = props.find((p) => p.key === 'fields');
        if (fieldsProp === undefined) continue; // an index over nothing keys nothing
        const [fa] = trimSpan(struct, fieldsProp.start, fieldsProp.end);
        if (struct[fa] !== '[') {
          refuse(fa, `\`${name}.indexes[].fields\` is not an array literal, so its keyed columns cannot be read`);
          broken = true;
          break;
        }
        const fClose = matchBracket(struct, fa);
        const columns = [];
        for (const [ca, cb] of arrayElements(struct, fa, fClose)) {
          const col = stringValue(struct, masked, ca, cb);
          if (col === null) {
            refuse(ca, `\`${name}.indexes[].fields\` holds a non-literal column name (${struct.slice(ca, Math.min(cb, ca + 40)).trim()})`);
            broken = true;
            break;
          }
          columns.push(col);
        }
        if (broken) break;
        const uniqueProp = props.find((p) => p.key === 'unique');
        const unique = uniqueProp === undefined
          ? 'absent'
          : struct.slice(...trimSpan(struct, uniqueProp.start, uniqueProp.end)).trim();
        indexes.push({ columns, unique, at: ta });
      }
      if (broken) continue;
    }

    const keyed = new Map();
    for (const ix of indexes) for (const c of ix.columns) if (!keyed.has(c)) keyed.set(c, ix.at);

    // ── fields ─────────────────────────────────────────────────────────────
    if (fieldsEntry === undefined) {
      if (keyed.size > 0) {
        refuse(braceOpen, `\`${name}\` declares indexes but no readable \`fields:\`, so the keyed columns cannot be typed`);
      }
      objects.push({ name, file: relPath, fields: [], indexes, keyedTextColumns: [], unclassifiedUnkeyed: [] });
      continue;
    }
    const [fa2] = trimSpan(struct, fieldsEntry.start, fieldsEntry.end);
    if (struct[fa2] !== '{') {
      refuse(fa2, `\`${name}.fields\` is not an object literal, so its column types cannot be read`);
      continue;
    }
    const fieldsClose = matchBracket(struct, fa2);
    const fieldEntries = objectEntries(struct, masked, fa2, fieldsClose);

    const fields = [];
    const unclassifiedUnkeyed = [];
    let broken = false;
    for (const fe of fieldEntries) {
      if (fe.key === null) {
        // A spread or shorthand inside `fields:` hides columns entirely -- it is
        // not attributable to one column, so it is always a refusal.
        refuse(fe.start, `\`${name}.fields\` holds an entry this scan cannot attribute to a column (${struct.slice(fe.start, Math.min(fe.end, fe.start + 40)).trim()})`);
        broken = true;
        break;
      }
      const classified = classifyField(struct, masked, fe.start, fe.end);
      const isKeyed = keyed.has(fe.key);
      if (classified.error !== undefined) {
        if (isKeyed) {
          refuse(fe.keyAt, `\`${name}.${fe.key}\` is keyed by a declared index and ${classified.error}`);
          broken = true;
          break;
        }
        unclassifiedUnkeyed.push({ column: `${name}.${fe.key}`, why: classified.error });
        continue;
      }
      fields.push({ column: fe.key, type: classified.type, bound: classified.bound, at: fe.keyAt });
    }
    if (broken) continue;

    const byName = new Map(fields.map((f) => [f.column, f]));
    for (const [col, at] of keyed) {
      if (byName.has(col) || BUILTIN_COLUMNS.has(col)) continue;
      const excused = unclassifiedUnkeyed.some((u) => u.column === `${name}.${col}`);
      refuse(at, excused
        ? `\`${name}\` keys an index on \`${col}\`, whose declaration this scan cannot classify`
        : `\`${name}\` keys an index on \`${col}\`, which the object does not declare and which is not a driver built-in (${[...BUILTIN_COLUMNS].join(', ')})`);
      broken = true;
      break;
    }
    if (broken) continue;

    const keyedTextColumns = fields
      .filter((f) => keyed.has(f.column) && textFamily.has(f.type))
      .map((f) => ({
        column: `${name}.${f.column}`,
        type: f.type,
        bound: f.bound,
        line: lineAt(starts, f.at),
      }));

    objects.push({ name, file: relPath, fields, indexes, keyedTextColumns, unclassifiedUnkeyed });
  }

  if (objects.length === 0 && refusals.length === 0) {
    refusals.push({
      file: relPath,
      line: 1,
      message: `no object declaration recognised in a \`${OBJECT_FILE_SUFFIX}\` file.\n`
        + '    Either the declaration uses a spelling this scan does not know (extend it, with a\n'
        + '    --self-test case), or the file should not carry that suffix. A silently empty parse\n'
        + '    is the failure this gate exists to prevent.',
    });
  }
  return { objects, refusals };
}

/**
 * The `type` and declared `maxLength` of one field declaration.
 * @returns {{ type: string, bound: object } | { error: string }}
 */
function classifyField(struct, masked, start, end) {
  const [a, b] = trimSpan(struct, start, end);
  const head = struct.slice(a, Math.min(b, a + 64));

  const builder = /^Field\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(head);
  if (builder !== null) {
    const name = builder[1];
    const type = FIELD_BUILDER_TYPES[name];
    if (type === undefined) {
      return { error: `uses \`Field.${name}(...)\`, a builder this gate does not know (extend FIELD_BUILDER_TYPES)` };
    }
    const parenOpen = a + builder[0].length - 1;
    const parenClose = matchBracket(struct, parenOpen);
    if (parenClose < 0 || parenClose > b) return { error: `has an unbalanced \`Field.${name}(\` argument list` };
    // `maxLength` lives in whichever argument is the config object literal --
    // `Field.code(language, config)` and `Field.select(options, config)` put it
    // second, everything else first.
    const bounds = [];
    for (const [ea, eb] of arrayElements(struct, parenOpen, parenClose)) {
      const [ta] = trimSpan(struct, ea, eb);
      if (struct[ta] !== '{') continue;
      const close = matchBracket(struct, ta);
      if (close < 0) continue;
      for (const p of objectEntries(struct, masked, ta, close)) {
        if (p.key === 'maxLength') bounds.push(readBound(struct, p.start, p.end));
      }
    }
    if (bounds.length > 1) return { error: 'declares `maxLength` more than once' };
    const bound = bounds[0] ?? { kind: 'absent' };
    if (bound.kind === 'opaque') return { error: `declares \`maxLength: ${bound.text}\`, which is not a literal this gate can read` };
    return { type, bound };
  }

  if (struct[a] === '{') {
    const close = matchBracket(struct, a);
    if (close < 0 || close > b) return { error: 'has an unbalanced object literal' };
    const props = objectEntries(struct, masked, a, close);
    const typeProp = props.find((p) => p.key === 'type');
    if (typeProp === undefined) return { error: 'is an object literal with no `type:` key' };
    const type = stringValue(struct, masked, typeProp.start, typeProp.end);
    if (type === null) return { error: 'declares a `type:` that is not a string literal' };
    const maxProp = props.find((p) => p.key === 'maxLength');
    const bound = maxProp === undefined ? { kind: 'absent' } : readBound(struct, maxProp.start, maxProp.end);
    if (bound.kind === 'opaque') return { error: `declares \`maxLength: ${bound.text}\`, which is not a literal this gate can read` };
    return { type, bound };
  }

  return { error: `is declared as \`${struct.slice(a, Math.min(b, a + 40)).trim()}\`, a shape this gate cannot classify` };
}

/**
 * Walk `root`, parse every object file, and return the whole reading.
 * Pure: no printing, no exits -- so `--self-test` can drive it over fixtures.
 */
export function sweep(root) {
  const emitter = readTextFamilyFromEmitter(root);
  if (emitter.error !== undefined) return { fatal: emitter.error };
  const textFamily = new Set(emitter.family);

  const files = walkObjectFiles(root);
  const objects = [];
  const refusals = [];
  const relFiles = [];
  for (const abs of files) {
    const rel = relative(root, abs).split(sep).join('/');
    relFiles.push(rel);
    const parsed = parseObjectFile(abs, rel, readFileSync(abs, 'utf8'), textFamily);
    objects.push(...parsed.objects);
    refusals.push(...parsed.refusals);
  }
  const unhinted = unhintedFiles(relFiles);

  const counts = {
    files: files.length,
    objects: objects.length,
    indexEntries: objects.reduce((n, o) => n + o.indexes.length, 0),
    textFields: objects.reduce((n, o) => n + o.fields.filter((f) => textFamily.has(f.type)).length, 0),
    keyedTextColumns: objects.reduce((n, o) => n + o.keyedTextColumns.length, 0),
  };

  return { family: emitter.family, files, relFiles, unhinted, objects, refusals, counts };
}

/**
 * The rule, as a pure function of (objects, allowlist) -- extracted rather than
 * inlined because `ALLOWLIST` is empty, so the excusing branch is never taken
 * against the real tree and would sit unexecuted and free to rot. The synthetic
 * control in `--self-test` drives both of its outcomes.
 */
export function unboundedKeyedColumns(objects, allowlist) {
  const excused = new Set(allowlist.map((r) => r.column));
  const offenders = [];
  for (const o of objects) {
    for (const c of o.keyedTextColumns) {
      if (excused.has(c.column)) continue;
      if (c.bound.kind === 'integer') continue;
      const declared = c.bound.kind === 'absent' ? 'no maxLength' : `maxLength: ${c.bound.text}`;
      offenders.push({ column: c.column, type: c.type, file: o.file, line: c.line, declared });
    }
  }
  return offenders;
}

/**
 * Allowlist rows that no longer describe a real, still-unbounded keyed column,
 * or whose own shape has rotted. Checked in every direction a row can go wrong:
 * the column disappeared, the column got bounded, the column moved package, the
 * disposition is unspelled, a `pending` row lost the issue that owns it, or the
 * reason is blank.
 */
export function staleAllowlistRows(objects, allowlist) {
  const real = new Map();
  for (const o of objects) for (const c of o.keyedTextColumns) real.set(c.column, { bound: c.bound, pkg: packageOf(o.file) });
  const stale = [];
  for (const row of allowlist) {
    const hit = real.get(row.column);
    if (hit === undefined) {
      stale.push({ row, why: 'is not a keyed text-family column any more -- remove the row' });
    } else if (hit.bound.kind === 'integer') {
      stale.push({ row, why: `now declares maxLength ${hit.bound.value} -- remove the row` });
    } else if (row.pkg !== hit.pkg) {
      stale.push({ row, why: `now lives in ${hit.pkg}, not ${row.pkg} -- a per-package row must name where the column is` });
    } else if (!ALLOWLIST_KINDS.has(row.kind)) {
      stale.push({ row, why: `declares kind '${row.kind}' -- must be one of ${[...ALLOWLIST_KINDS].join(', ')}` });
    } else if (row.kind === 'pending' && !/^#\d+$/.test(row.issue ?? '')) {
      stale.push({ row, why: "is 'pending' but cites no issue -- debt with no name on it is an exemption" });
    } else if (!row.why || row.why.trim() === '') {
      stale.push({ row, why: 'carries no stated reason' });
    }
  }
  return stale;
}

// ---------------------------------------------------------------------------
// Reporting

function refuse(message) {
  console.error(`check:keyed-text-bounds: ${message}`);
  return 2;
}

const FLOORS = [
  ['files', MIN_FILES, `*${OBJECT_FILE_SUFFIX} file(s)`,
    'The walk broke. A sweep over an empty population reports exactly what a clean tree reports.'],
  ['objects', MIN_OBJECTS, 'object declaration(s)',
    'The `ObjectSchema.create` matcher broke. Refusing to report clean over declarations nobody read.'],
  ['indexEntries', MIN_INDEX_ENTRIES, 'declared index entr(ies)',
    'The index reader broke. With no indexes read, NOTHING is keyed and every column passes.'],
  ['textFields', MIN_TEXT_FIELDS, 'text-family field(s)',
    'The field classifier or the emitter-derived family broke. With no text fields seen, nothing is judged.'],
  ['keyedTextColumns', MIN_KEYED_TEXT_COLUMNS, 'keyed text-family column(s)',
    'This is the JUDGED population -- the intersection of declared indexes with text-family fields.\n'
    + 'A dead intersection produces an empty finding set, and the empty set is what success looks like.'],
];

function floorProblem(counts) {
  for (const [key, min, what, why] of FLOORS) {
    const got = counts?.[key] ?? 0;
    if (got >= min) continue;
    return `discovered only ${got} ${what}, below the floor of ${min} (measured ${MEASURED[key]} on ${MEASURED.ref}).\n${why}`;
  }
  return null;
}

/**
 * The provenance footer for a PASSING run: the census this run read, the floors
 * it cleared, the census those floors were derived from, and the ref that
 * census belongs to -- side by side.
 *
 * This is the whole repair. The floors are inequalities on purpose, so no run
 * can ever contradict the record; without this line the record could stop
 * describing the tree and every green log would look identical either way. The
 * delta is reported as INFORMATION and never as a verdict: this population
 * moves in both directions for good reasons (see the header), and only the
 * floors decide anything.
 *
 * Pure, so `--self-test` drives it with no tree.
 *
 * @param {{files?: number, objects?: number, indexEntries?: number, textFields?: number, keyedTextColumns?: number}} counts
 * @returns {string}
 */
export function provenanceLine(counts) {
  const got = FLOORS.map(([key]) => counts?.[key] ?? 0);
  const rec = FLOORS.map(([key]) => MEASURED[key]);
  const floors = FLOORS.map(([, min]) => min);
  const delta = got.map((g, i) => (g === rec[i] ? '=' : `${g > rec[i] ? '+' : ''}${g - rec[i]}`));
  const names = FLOORS.map(([key]) => key).join('/');
  return `  provenance — ${names}: this run ${got.join('/')}`
    + ` · floors ${floors.join('/')} · derived from ${rec.join('/')} measured on ${MEASURED.ref}`
    + ` (${delta.join('/')} vs the record).\n`
    + '  ⚠ The delta is information, not a verdict — this population grows AND shrinks for good'
    + ' reasons, and only the floors decide. Reproduce the record: see this file\'s header.';
}

function familyProblem(family) {
  const got = [...family].sort().join(', ');
  const want = [...EXPECTED_TEXT_FAMILY].sort().join(', ');
  if (got === want) return null;
  return `the text family read off ${EMITTER_FILE} no longer matches this gate's witness.\n`
    + `  emitter: ${got}\n`
    + `  witness: ${want}\n`
    + 'A type joining or leaving the keyed-text arm changes which columns need a declared bound.\n'
    + 'Update EXPECTED_TEXT_FAMILY here, in the same PR that moved it, so the widening is a decision\n'
    + 'rather than a silent change in what goes unpoliced.';
}

function main() {
  const result = sweep(REPO_ROOT);
  if (result.fatal !== undefined) return refuse(result.fatal);

  const family = familyProblem(result.family);
  if (family !== null) return refuse(family);

  if (result.unhinted.length > 0) {
    return refuse(
      `${result.unhinted.length} object file(s) sit outside every declared watch hint `
      + `(${ROOT_DIR_WATCH_HINTS.join(', ')}):\n  ${result.unhinted.join('\n  ')}\n`
      + 'The SWEEP covers them -- it walks the whole repository -- but no dispatch brief can NAME\n'
      + 'this gate for a card that edits them, so the card is told to run everything except the one\n'
      + 'gate that judges its diff. Add the subtree to ROOT_DIR_WATCH_HINTS in the same PR.',
    );
  }

  if (result.refusals.length > 0) {
    console.error(`check:keyed-text-bounds: ${result.refusals.length} declaration(s) this scan cannot classify\n`);
    for (const r of result.refusals) console.error(`  ${r.file}:${r.line}\n    ${r.message}`);
    console.error(
      '\nA source scan sees only the spellings it knows, and an unrecognised one produces no finding,\n'
      + 'silently -- which is the failure this gate exists to prevent. So an unclassifiable shape on a\n'
      + 'KEYED column is a refusal, not a pass. Teach the scan the spelling (FIELD_BUILDER_TYPES, or the\n'
      + 'parser) and add a --self-test case, or write the declaration in a shape it reads.',
    );
    return 2;
  }

  const floor = floorProblem(result.counts);
  if (floor !== null) return refuse(floor);

  const offenders = unboundedKeyedColumns(result.objects, ALLOWLIST);
  const stale = staleAllowlistRows(result.objects, ALLOWLIST);

  if (stale.length > 0) {
    console.error(`✗ check:keyed-text-bounds: ${stale.length} stale ALLOWLIST row(s)\n`);
    for (const s of stale) console.error(`  • ${s.row.column} (${s.row.pkg}) ${s.why}`);
    console.error('');
  }

  if (offenders.length > 0) {
    console.error(`✗ check:keyed-text-bounds: ${offenders.length} unbounded keyed text-family column(s)\n`);
    for (const o of offenders) {
      console.error(`  • ${o.column}  [${o.type}]  ${o.declared}`);
      console.error(`      ${o.file}:${o.line}`);
    }
    console.error(
      '\nA text-family column a declared index keys on must declare a `maxLength` (route A, #11374).\n'
      + 'Without one `driver-sql` emits it TEXT; MySQL then refuses `ALTER TABLE ... ADD INDEX` with\n'
      + 'ER_BLOB_KEY_WITHOUT_LENGTH, and the object lands REGISTERED-BUT-BROKEN with its declared index\n'
      + 'silently absent (measured live on MySQL 8.0.46, #12058).\n\n'
      + 'Fix it one of three ways, per column:\n'
      + '  1. declare a bound derived from the value PRODUCER, and name the producer in the declaration;\n'
      + '  2. if nothing reads the column as a predicate, remove the index and say so;\n'
      + '  3. if the column is boundable but sourcing the bound is its own piece of work, add a\n'
      + "     `pending` ALLOWLIST row citing the issue that owns it -- debt with a name on it;\n"
      + '  4. if the value genuinely cannot be bounded, add an `unboundable` ALLOWLIST row with its\n'
      + '     reason -- and read #11701 first: an unboundable column may only be keyed by a UNIQUE index.',
    );
  }

  if (offenders.length > 0 || stale.length > 0) return 1;

  const unclassified = result.objects.reduce((n, o) => n + o.unclassifiedUnkeyed.length, 0);
  const pending = ALLOWLIST.filter((r) => r.kind === 'pending').length;
  const unboundable = ALLOWLIST.length - pending;
  console.log(
    `✓ check:keyed-text-bounds: ${result.counts.files} *${OBJECT_FILE_SUFFIX} files under `
    + `${ROOT_DIR_WATCH_HINTS.join(' + ')} (walk is repo-wide; 0 outside), `
    + `${result.counts.objects} object declarations, ${result.counts.indexEntries} declared index entries, `
    + `${result.counts.textFields} text-family fields; ${result.counts.keyedTextColumns} keyed text-family `
    + `columns judged, ${result.counts.keyedTextColumns - ALLOWLIST.length} bounded. `
    + `Family read off the emitter: ${result.family.join(', ')}. `
    + `Allowlist: ${pending} pending, ${unboundable} unboundable, all rows still real. `
    + `${unclassified} unclassified field(s), none of them keyed.`,
  );
  console.log(provenanceLine(result.counts));
  return 0;
}

function list() {
  const result = sweep(REPO_ROOT);
  if (result.fatal !== undefined) return refuse(result.fatal);
  console.log(`text family (read off ${EMITTER_FILE}): ${result.family.join(', ')}`);
  console.log(`files: ${result.counts.files}  objects: ${result.counts.objects}  index entries: ${result.counts.indexEntries}  `
    + `text-family fields: ${result.counts.textFields}  keyed text columns: ${result.counts.keyedTextColumns}\n`);

  const byPackage = new Map();
  for (const o of result.objects) {
    const pkg = packageOf(o.file);
    if (!byPackage.has(pkg)) byPackage.set(pkg, []);
    byPackage.get(pkg).push(o);
  }
  for (const pkg of [...byPackage.keys()].sort()) {
    const objects = byPackage.get(pkg);
    const columns = objects.flatMap((o) => o.keyedTextColumns);
    console.log(`${pkg}  (${objects.length} object(s), ${columns.length} keyed text column(s))`);
    for (const o of objects) {
      for (const c of o.keyedTextColumns) {
        const bound = c.bound.kind === 'integer' ? `maxLength: ${c.bound.value}`
          : c.bound.kind === 'absent' ? 'NO maxLength' : `maxLength: ${c.bound.text}`;
        console.log(`    ${c.column}  [${c.type}]  ${bound}   ${o.file}:${c.line}`);
      }
    }
  }
  const unclassified = result.objects.flatMap((o) => o.unclassifiedUnkeyed.map((u) => ({ ...u, file: o.file })));
  console.log(`\nunclassified fields (none keyed, or the run would have refused): ${unclassified.length}`);
  for (const u of unclassified) console.log(`    ${u.column}  ${u.why}   ${u.file}`);
  if (result.refusals.length > 0) {
    console.log(`\nrefusals: ${result.refusals.length}`);
    for (const r of result.refusals) console.log(`    ${r.file}:${r.line}  ${r.message}`);
  }
  return 0;
}

/** The workspace package (or example) a repo-relative path belongs to. */
export function packageOf(relPath) {
  const parts = relPath.split('/');
  if (parts[0] === 'packages' && parts[1] === 'plugins') return parts.slice(0, 3).join('/');
  if (parts[0] === 'packages' && (parts[1] === 'services' || parts[1] === 'drivers' || parts[1] === 'qa')) {
    return parts.slice(0, 3).join('/');
  }
  return parts.slice(0, 2).join('/');
}

// ---------------------------------------------------------------------------
// Self-test
//
// The production run over a fixed tree is green by construction, so it cannot
// tell a working matcher from a dead one: weakening the rule can only SHRINK
// the finding set, and the empty set is what success looks like. Every case
// below supplies the adversarial input a clean tree does not contain, in BOTH
// directions -- the detector firing, and the detector staying silent on the
// shapes that are legitimately not findings.

const EMITTER_STUB = `
  protected varcharColumnChars(field: any, keyed?: { unique: boolean }): number | null {
    switch (type) {
      case 'string':
      case 'email':
        return this.declaredVarcharLength(field);
      case 'text':
      case 'textarea':
      case 'html':
      case 'markdown':
      case 'richtext':
      case 'code':
      case 'signature':
      case 'qrcode':
        return ${JSON.stringify(EMITTER_ANCHOR).slice(1, -1)};
      default:
        return 255;
    }
  }
`;

function fixture(root, rel, text) {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text);
}

function makeTree(root, files, { emitter = EMITTER_STUB } = {}) {
  fixture(root, EMITTER_FILE, emitter);
  for (const [rel, text] of Object.entries(files)) fixture(root, rel, text);
}

/** An object file with the given body, in a package path. */
function objectFile(body) {
  return `import { ObjectSchema, Field } from '@objectstack/spec/data';\n\nexport const X = ObjectSchema.create(${body});\n`;
}

export function selfTest() {
  let failures = 0;
  const t = (name, ok, detail) => {
    if (ok) { console.log(`  ok    ${name}`); return; }
    failures += 1;
    console.error(`  FAIL  ${name}${detail === undefined ? '' : ` -- ${detail}`}`);
  };

  const tmp = mkdtempSync(join(tmpdir(), 'keyed-text-bounds-'));
  const run = (files, opts) => {
    const root = mkdtempSync(join(tmp, 'case-'));
    makeTree(root, files, opts);
    return sweep(root);
  };
  const oneObject = (body, opts) => run({ 'packages/p/src/a.object.ts': objectFile(body) }, opts);
  // Judged against an EMPTY allowlist: these fixtures are about the detector,
  // and the real ledger's rows are exercised against the real tree instead.
  const offendersOf = (r) => unboundedKeyedColumns(r.objects ?? [], []);

  try {
    // ── the emitter-derived family ────────────────────────────────────────
    const fam = oneObject(`{ name: 'o', fields: {}, indexes: [] }`);
    t('the text family is read off the emitter, and matches this gate\'s witness',
      familyProblem(fam.family) === null, JSON.stringify(fam.family));

    const noAnchor = oneObject(`{ name: 'o', fields: {}, indexes: [] }`, { emitter: 'class X {}' });
    t('an emitter with no keyed-text arm REFUSES rather than judging a retyped family',
      noAnchor.fatal !== undefined && /keyed-text arm/.test(noAnchor.fatal));

    const movedFamily = oneObject(`{ name: 'o', fields: {}, indexes: [] }`, {
      emitter: EMITTER_STUB.replace(`      case 'qrcode':\n`, ''),
    });
    t('a type LEAVING the emitter\'s keyed-text arm is reported, not absorbed',
      movedFamily.fatal === undefined && familyProblem(movedFamily.family) !== null,
      JSON.stringify(movedFamily.family));

    // ── the detector FIRES ────────────────────────────────────────────────
    for (const type of EXPECTED_TEXT_FAMILY) {
      const r = oneObject(`{ name: 'o', fields: { c: { type: '${type}' } }, indexes: [{ fields: ['c'] }] }`);
      const found = offendersOf(r);
      t(`an unbounded keyed \`${type}\` column is a finding`,
        r.refusals.length === 0 && found.length === 1 && found[0].column === 'o.c', JSON.stringify({ found, refusals: r.refusals }));
    }

    const viaBuilder = oneObject(`{ name: 'o', fields: { c: Field.text({ label: 'C' }) }, indexes: [{ fields: ['c'] }] }`);
    t('the builder spelling is read too -- `Field.text(...)` with no maxLength is a finding',
      offendersOf(viaBuilder).length === 1, JSON.stringify(viaBuilder.refusals));

    const unique = oneObject(`{ name: 'o', fields: { c: Field.text({}) }, indexes: [{ fields: ['c'], unique: true }] }`);
    t('a UNIQUE index keys just as an ordinary one does', offendersOf(unique).length === 1);

    const scoped = oneObject(`{ name: 'o', fields: { c: Field.text({}) }, indexes: [{ fields: ['c'], unique: 'organization' }] }`);
    t("an ADR-0120 scoped unique index keys too (`unique: 'organization'`)", offendersOf(scoped).length === 1);

    const composite = oneObject(`{ name: 'o', fields: { a: Field.text({ maxLength: 10 }), b: Field.text({}) }, indexes: [{ fields: ['a', 'b'] }] }`);
    const compositeFound = offendersOf(composite);
    t('every column of a COMPOSITE index is keyed -- the unbounded one is named, the bounded one is not',
      compositeFound.length === 1 && compositeFound[0].column === 'o.b', JSON.stringify(compositeFound));

    const secondIndex = oneObject(`{ name: 'o', fields: { c: Field.text({}) }, indexes: [{ fields: ['other'] }, { fields: ['c'] }], }`);
    t('a column keyed by the SECOND index is found (the reader does not stop at the first)',
      secondIndex.refusals.length === 1 && /does not declare/.test(secondIndex.refusals[0].message), JSON.stringify(secondIndex.refusals));

    const zero = oneObject(`{ name: 'o', fields: { c: Field.text({ maxLength: 0 }) }, indexes: [{ fields: ['c'] }] }`);
    t('`maxLength: 0` is a DECLARATION but not a bound -- the driver returns null for it',
      offendersOf(zero).length === 1);

    const codeSecondArg = oneObject(`{ name: 'o', fields: { c: Field.code('sql') }, indexes: [{ fields: ['c'] }] }`);
    t('`Field.code(language)` -- config is the SECOND argument, and its absence is a finding',
      offendersOf(codeSecondArg).length === 1, JSON.stringify(codeSecondArg.refusals));

    // ── the detector STAYS SILENT ─────────────────────────────────────────
    const bounded = oneObject(`{ name: 'o', fields: { c: Field.text({ maxLength: 255 }) }, indexes: [{ fields: ['c'] }] }`);
    t('a bounded keyed text column is NOT a finding', offendersOf(bounded).length === 0);

    const boundedRaw = oneObject(`{ name: 'o', fields: { c: { type: 'text', maxLength: 2_000 } }, indexes: [{ fields: ['c'] }] }`);
    t('a numeric separator in the bound is still an integer bound', offendersOf(boundedRaw).length === 0);

    const unkeyed = oneObject(`{ name: 'o', fields: { c: Field.text({}) }, indexes: [{ fields: ['other'] }] , }`);
    t('an UNBOUNDED but UNKEYED text column is not a finding -- the control that must stay green',
      offendersOf(unkeyed).length === 0);

    const noIndexes = oneObject(`{ name: 'o', fields: { c: Field.text({}) } }`);
    t('an object with no `indexes:` at all keys nothing', offendersOf(noIndexes).length === 0 && noIndexes.refusals.length === 0);

    const nonText = oneObject(`{ name: 'o', fields: { c: Field.select(['a', 'b'], { label: 'C' }), d: Field.datetime({}), e: Field.lookup('sys_user', {}) }, indexes: [{ fields: ['c', 'd', 'e'] }] }`);
    t('keyed NON-text columns (select, datetime, lookup) are not findings',
      offendersOf(nonText).length === 0 && nonText.refusals.length === 0, JSON.stringify(nonText.refusals));

    const builtin = oneObject(`{ name: 'o', fields: { c: Field.text({ maxLength: 5 }) }, indexes: [{ fields: ['id', 'created_at'] }] }`);
    t('an index over the driver built-ins does not refuse', builtin.refusals.length === 0 && offendersOf(builtin).length === 0);

    const commented = oneObject(`{ name: 'o', fields: { /* c: Field.text({}) is commented out */ d: Field.text({ maxLength: 5 }) }, indexes: [{ fields: ['d'] }] }`);
    t('a commented-out field is prose, not a column -- the mask is load-bearing',
      commented.refusals.length === 0 && offendersOf(commented).length === 0, JSON.stringify(commented.refusals));

    const braceInString = oneObject(`{ name: 'o', fields: { c: Field.text({ maxLength: 5, description: 'a } brace and a /* opener in a string' }) }, indexes: [{ fields: ['c'] }] }`);
    t('a brace or comment opener inside a STRING does not move the parse',
      braceInString.refusals.length === 0 && offendersOf(braceInString).length === 0, JSON.stringify(braceInString.refusals));

    // ── refusals: the shapes it will not guess at ─────────────────────────
    const unknownBuilder = oneObject(`{ name: 'o', fields: { c: Field.mystery({}) }, indexes: [{ fields: ['c'] }] }`);
    t('an UNKNOWN `Field.<builder>` on a keyed column REFUSES rather than passing',
      unknownBuilder.refusals.length === 1 && /does not know/.test(unknownBuilder.refusals[0].message),
      JSON.stringify(unknownBuilder.refusals));

    const unknownBuilderUnkeyed = oneObject(`{ name: 'o', fields: { c: Field.mystery({}), d: Field.text({ maxLength: 5 }) }, indexes: [{ fields: ['d'] }] }`);
    t('...but the same unknown builder on an UNKEYED column costs nothing, and is counted',
      unknownBuilderUnkeyed.refusals.length === 0
      && unknownBuilderUnkeyed.objects[0].unclassifiedUnkeyed.length === 1,
      JSON.stringify(unknownBuilderUnkeyed.refusals));

    const opaqueBound = oneObject(`{ name: 'o', fields: { c: Field.text({ maxLength: MAX_ID }) }, indexes: [{ fields: ['c'] }] }`);
    t('a `maxLength` that is not a literal REFUSES -- it is not read as bounded, and not as unbounded',
      opaqueBound.refusals.length === 1 && /not a literal/.test(opaqueBound.refusals[0].message),
      JSON.stringify(opaqueBound.refusals));

    const opaqueType = oneObject(`{ name: 'o', fields: { c: { type: TEXT_TYPE } }, indexes: [{ fields: ['c'] }] }`);
    t('a `type` that is not a string literal REFUSES on a keyed column',
      opaqueType.refusals.length === 1 && /not a string literal/.test(opaqueType.refusals[0].message));

    const sharedField = oneObject(`{ name: 'o', fields: { c: SHARED_TEXT_FIELD }, indexes: [{ fields: ['c'] }] }`);
    t('a field declared by reference REFUSES on a keyed column', sharedField.refusals.length === 1);

    const spreadFields = oneObject(`{ name: 'o', fields: { ...COMMON, c: Field.text({ maxLength: 5 }) }, indexes: [{ fields: ['c'] }] }`);
    t('a SPREAD inside `fields:` always refuses -- it hides columns from the walk entirely',
      spreadFields.refusals.length === 1 && /cannot attribute/.test(spreadFields.refusals[0].message),
      JSON.stringify(spreadFields.refusals));

    const spreadIndexes = oneObject(`{ name: 'o', fields: { c: Field.text({ maxLength: 5 }) }, indexes: [...COMMON_INDEXES] }`);
    t('a SPREAD inside `indexes:` refuses -- an unread index keys nothing, and nothing is what green looks like',
      spreadIndexes.refusals.length === 1 && /not an object literal/.test(spreadIndexes.refusals[0].message),
      JSON.stringify(spreadIndexes.refusals));

    const computedIndexColumn = oneObject(`{ name: 'o', fields: { c: Field.text({}) }, indexes: [{ fields: [COL] }] }`);
    t('a non-literal column name inside `indexes[].fields` refuses', computedIndexColumn.refusals.length === 1);

    const noName = oneObject(`{ name: NAME, fields: { c: Field.text({}) }, indexes: [{ fields: ['c'] }] }`);
    t('an object with no literal `name:` refuses -- nothing it declares can be attributed',
      noName.refusals.length === 1 && /no \`name:\`/.test(noName.refusals[0].message));

    const emptyObjectFile = run({ 'packages/p/src/a.object.ts': 'export const NOT_AN_OBJECT = 1;\n' });
    t('a `.object.ts` file with NO recognised declaration refuses -- a silently empty parse is the defect',
      emptyObjectFile.refusals.length === 1 && /no object declaration recognised/.test(emptyObjectFile.refusals[0].message));

    const undeclaredKeyedColumn = oneObject(`{ name: 'o', fields: { c: Field.text({ maxLength: 5 }) }, indexes: [{ fields: ['ghost'] }] }`);
    t('an index keying a column the object does not declare refuses',
      undeclaredKeyedColumn.refusals.length === 1 && /does not declare/.test(undeclaredKeyedColumn.refusals[0].message));

    // ── the allowlist mechanism, driven on synthetic objects ──────────────
    // ALLOWLIST is empty against the real tree, so the excusing branch is never
    // taken there and would rot unexecuted. Both outcomes are driven here.
    const syntheticObjects = [{
      name: 'o',
      file: 'packages/p/src/a.object.ts',
      fields: [],
      indexes: [],
      keyedTextColumns: [{ column: 'o.blob', type: 'text', bound: { kind: 'absent' }, line: 3 }],
      unclassifiedUnkeyed: [],
    }];
    const goodRow = { pkg: 'packages/p', column: 'o.blob', kind: 'unboundable', why: 'because' };
    const pendingRow = { pkg: 'packages/p', column: 'o.blob', kind: 'pending', issue: '#1', why: 'because' };
    t('the allowlist ACCUSES when the column is not named',
      unboundedKeyedColumns(syntheticObjects, []).length === 1);
    t('the allowlist EXCUSES when the column is named (`unboundable`)',
      unboundedKeyedColumns(syntheticObjects, [goodRow]).length === 0);
    t('the allowlist EXCUSES a `pending` row too -- named debt, not an exemption',
      unboundedKeyedColumns(syntheticObjects, [pendingRow]).length === 0);
    t('a well-formed row is not stale', staleAllowlistRows(syntheticObjects, [goodRow]).length === 0
      && staleAllowlistRows(syntheticObjects, [pendingRow]).length === 0);
    t('a row for a column that is not keyed text any more is STALE',
      staleAllowlistRows(syntheticObjects, [{ ...goodRow, column: 'o.gone' }]).length === 1);
    t('a row for a column that has SINCE been bounded is STALE',
      staleAllowlistRows(
        [{ ...syntheticObjects[0], keyedTextColumns: [{ column: 'o.blob', type: 'text', bound: { kind: 'integer', value: 5 }, line: 3 }] }],
        [goodRow],
      ).length === 1);
    t('a row naming the WRONG package is STALE -- the allowlist is per package',
      staleAllowlistRows(syntheticObjects, [{ ...goodRow, pkg: 'packages/elsewhere' }]).length === 1);
    t('a row with an unspelled disposition is STALE',
      staleAllowlistRows(syntheticObjects, [{ ...goodRow, kind: 'whatever' }]).length === 1);
    t('a `pending` row citing no issue is STALE -- debt with no name on it is an exemption',
      staleAllowlistRows(syntheticObjects, [{ ...pendingRow, issue: undefined }]).length === 1);
    t('a row with no stated reason is STALE',
      staleAllowlistRows(syntheticObjects, [{ ...goodRow, why: '  ' }]).length === 1);

    // ── the vacuity floors ────────────────────────────────────────────────
    const empty = run({});
    t('an EMPTY tree trips a floor rather than reporting clean',
      floorProblem(empty.counts) !== null, JSON.stringify(empty.counts));
    t('a tree with objects but NO indexes read trips the index floor',
      floorProblem({ files: 999, objects: 999, indexEntries: 0, textFields: 999, keyedTextColumns: 999 }) !== null);
    t('a tree whose keyed-text INTERSECTION collapses trips its own floor',
      floorProblem({ files: 999, objects: 999, indexEntries: 999, textFields: 999, keyedTextColumns: 0 }) !== null);
    t('the floors pass at the values in the record', floorProblem(MEASURED) === null);
    t('every floor sits at or below the value it was measured from -- a floor ABOVE its own '
      + 'measurement reds every real run, the opposite failure and just as invisible in review',
      FLOORS.every(([key, min]) => min <= MEASURED[key]),
      JSON.stringify(FLOORS.map(([key, min]) => `${key}: ${min} vs ${MEASURED[key]}`)));

    // ── provenance: the record must stay reproducible, and visibly so ──────
    //
    // ⛔ None of these can red on a tree that legitimately moved -- that is the
    // point, and an equality here is the thing the header rules out. They red
    // when the RECORD stops being a self-contained, reproducible claim: a ref
    // that is not a ref, a quotation that restated the ref instead of reading
    // it, or a pass line that stopped showing the reader both censuses.
    t('PROVENANCE — the record carries the ref it was measured on, inside the frozen record',
      typeof MEASURED.ref === 'string' && /^[0-9a-f]{7,40}$/.test(MEASURED.ref) && Object.isFrozen(MEASURED),
      JSON.stringify(MEASURED.ref));
    t('PROVENANCE — the refusal reads the ref from the record rather than restating it',
      (floorProblem({ ...MEASURED, files: 0 }) ?? '').includes(MEASURED.ref),
      JSON.stringify(floorProblem({ ...MEASURED, files: 0 })));
    const provDrifted = provenanceLine({
      files: 112, objects: 117, indexEntries: 251, textFields: 589, keyedTextColumns: 148,
    });
    t('PROVENANCE — a passing run shows the census it read AND the census the floors came from',
      provDrifted.includes('112/117/251/589/148')
      && provDrifted.includes(FLOORS.map(([key]) => MEASURED[key]).join('/'))
      && provDrifted.includes(FLOORS.map(([, min]) => min).join('/'))
      && provDrifted.includes(MEASURED.ref), provDrifted);
    t('PROVENANCE — drift is reported in BOTH directions, and equality says so',
      provDrifted.includes('-1/-1/-4/-5/-3')
      && provenanceLine(MEASURED).includes('=/=/=/=/=')
      && provenanceLine({ ...MEASURED, files: MEASURED.files + 28 }).includes('+28/'),
      provDrifted);
    t('PROVENANCE — the delta is marked as information, never as a verdict',
      /not a verdict/i.test(provDrifted) && !/✗|REFUS/.test(provDrifted), provDrifted);
    t('PROVENANCE — the PASS path actually prints it (a line nothing calls is the defect above)',
      readFileSync(fileURLToPath(import.meta.url), 'utf8').includes(`console.log(${'provenanceLine'}(result.counts))`),
      'the pass path in main() no longer calls provenanceLine — the record would stop being reconciled in the log');

    // ── the watch-hint declaration vs the repo-wide walk ─────────────────
    const outsideHints = run({ 'tools/stray.object.ts': objectFile(`{ name: 'o', fields: { c: Field.text({ maxLength: 5 }) }, indexes: [{ fields: ['c'] }] }`) });
    t('an object file OUTSIDE every watch hint is still SWEPT -- the walk is repo-wide',
      outsideHints.relFiles.includes('tools/stray.object.ts') && outsideHints.objects.length === 1,
      JSON.stringify(outsideHints.relFiles));
    t('...and is REPORTED as unhinted, so the declaration cannot silently under-name the population',
      outsideHints.unhinted.length === 1 && outsideHints.unhinted[0] === 'tools/stray.object.ts');
    const insideHints = run({ 'packages/p/src/a.object.ts': objectFile(`{ name: 'o', fields: {}, indexes: [] }`) });
    t('an object file inside a declared hint is not reported as unhinted', insideHints.unhinted.length === 0);
    t('every declared watch hint is a reachable glob, never a separator-less bare word',
      ROOT_DIR_WATCH_HINTS.every((h) => h.includes('/')));

    // ── package attribution, which the per-package allowlist rests on ─────
    t('packageOf attributes a plugin path to the plugin',
      packageOf('packages/plugins/plugin-audit/src/objects/x.object.ts') === 'packages/plugins/plugin-audit');
    t('packageOf attributes a service path to the service',
      packageOf('packages/services/service-messaging/src/objects/x.object.ts') === 'packages/services/service-messaging');
    t('packageOf attributes a plain package path to the package',
      packageOf('packages/platform-objects/src/identity/x.object.ts') === 'packages/platform-objects');
    t('packageOf attributes an example path to the example',
      packageOf('examples/app-crm/src/objects/x.object.ts') === 'examples/app-crm');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}  check-keyed-text-bounds --self-test (${failures} failure(s))`);
  return failures === 0 ? 0 : 1;
}

if (isEntrypoint(import.meta.url)) {
  const argv = process.argv.slice(2);
  process.exit(argv.includes('--self-test') ? selfTest() : argv.includes('--list') ? list() : main());
}
