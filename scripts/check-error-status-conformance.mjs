#!/usr/bin/env node
// check-error-status-conformance — reconcile the HTTP status the DOCS publish for
// an error code against the status the RUNTIME can actually emit for it.
//
//   node scripts/check-error-status-conformance.mjs
//   node scripts/check-error-status-conformance.mjs --self-test
//   node scripts/check-error-status-conformance.mjs --report   # print the whole derivation
//   node scripts/check-error-status-conformance.mjs --update   # ⛔ MAINTAINER-ONLY
//
// ## Why this exists
//
// `content/docs/api/error-catalog.mdx` and
// `content/docs/protocol/kernel/error-handling.mdx` both publish an HTTP status
// per error code. The statuses are DECIDED at the doors (`packages/rest`,
// `packages/types`, the error classes each package throws). Nothing reconciled
// the two, so they were free to disagree indefinitely — and did:
// `MISSING_REQUIRED_FIELD` was documented 400 in both pages while five
// `controlled_by_parent` refusal paths answered 422, on a public error contract,
// with CI fully green. It was found by a human reading a PR.
//
// ## The two shapes this had to get right
//
// **(a) The runtime side is DERIVED, never listed.** A hand-written code→status
// table here would be a second copy of the very thing that drifted, needing its
// own drift tripwire; the repo already carries one such list, reconciled against
// nothing, as the standing example of what not to build. Every runtime status
// below is read out of source: the error classes' own `readonly status` /
// `readonly statusCode`, the two `sendError` doors' literal arguments, the REST
// mapper's terminal envelopes, and the door's own `HttpStatusErrorCodeMap`.
// Where an identifier cannot be resolved the declaration is REPORTED as
// unresolved, never silently dropped — a deriver that goes quietly blind is the
// same failure one layer down.
//
// **(b) One code may legitimately have MORE THAN ONE status.**
// `MISSING_REQUIRED_FIELD` is documented as 400 with one documented 422
// exception. A gate asserting a single status per code would demand the docs
// lie. So the assertion is a SET comparison in both directions:
//
//   A. every status the runtime can emit for a code is documented for it, and
//   B. every status the docs CLAIM for a code is one the runtime can emit
//      (asserted only for codes the deriver actually found a producer for —
//      see the unpinned census below).
//
// ## The doc side: two grades of statement, deliberately
//
//   claimed  A per-code assertion, used for BOTH directions:
//              • an entry heading + `**HTTP Status:** …` on EITHER page (every
//                4xx/5xx integer on that line — this is what carries a
//                documented exception: "400 — with one documented exception,
//                which answers **422**" claims {400, 422}). One designated
//                spelling for "this code's published status", honoured wherever
//                it appears, so a page that publishes a status per entry rather
//                than per category has a shape to write it in.
//              • `error-catalog.mdx`   the HTTP Status Quick Reference rows
//   covered  A weaker CATEGORY statement, used for direction A only:
//              • `error-catalog.mdx`   `## … Errors (NNN)` section headings
//
// The section headings are graded down on purpose. `## Validation Errors (400)`
// mirrors `ErrorCategory.validation → 400` (`ErrorHttpStatusMap`): it states the
// CATEGORY's status, not each member's. Reading it as a per-code assertion makes
// the gate manufacture findings out of a heading that never claimed them —
// `## Request Errors (405/428)` groups two codes over two statuses, and
// `## Server Errors (5xx)` names no parseable status at all (its members'
// statuses come from the quick-reference rows instead). A heading can still
// ABSOLVE an emitted status (a 405 under `## Request Errors (405/428)` is
// documented), which is all direction A needs from it.
//
// ## Entry headings are a WHITELIST of spellings, so an unread one is a finding
//
// The doc side finds its per-code entries by scanning heading text, and a text
// scan sees only the spellings it knows — an unrecognised one yields no
// statement, SILENTLY. So the recognised shapes are published in
// `ENTRY_HEADING_SHAPES` rather than buried in a regex, and a heading that names
// a code in any OTHER shape lands in the doc-side unreadable census and FAILS
// the gate. That census is the doc-side twin of the runtime side's `unresolved`
// list, and it exists because the gate had one on the runtime side only: the
// entry `### \`INVALID_REQUEST\` — unrecognised type spelling` carries a
// descriptive suffix, the bare-heading pattern missed it, and the 400 that page
// publishes for that code was read by nothing and reconciled in neither
// direction — while the run printed a bound claiming no page published it.
// Reaching for a shape that is not listed? Extend `ENTRY_HEADING_SHAPES` **and
// add a `--self-test` case in the same edit** — never route around it.
//
// ## Bounds — DERIVED here and printed on every run, so a partial gate can never
// ## read as a complete one
//
//   • Reconciled vocabulary: every `StandardErrorCode` member, PLUS every other
//     code a scanned page actually publishes a status for. The second half is
//     computed from the parsed pages (`reconciledVocabulary`), never asserted:
//     registered ledger codes (`ERROR_CODE_LEDGER`) reach the docs one at a
//     time, and a bound that merely CLAIMED "no page publishes their status"
//     went false the day one of them was documented, silently and with the
//     claim still printing. The residual — ledger codes derived with no
//     doc-published status — is what is reported as not reconciled, and it is a
//     subtraction, not a promise.
//   • `HttpStatusErrorCodeMap`'s EXPLICIT entries only, never
//     `standardErrorCodeForHttpStatus`'s bucket fallback — the same bound
//     `standardSynonymOf` draws in `error-code-ledger.zod.ts`, and for the same
//     reason: the fallback would make `VALIDATION_ERROR` "emittable" at every
//     unnamed 4xx and `INTERNAL_ERROR` at every unnamed 5xx.
//   • Direction B is asserted only for codes with ≥1 derived producer. A code
//     with none is not silently passed: it lands in the unpinned census below.
//
// ## The unpinned census — "no in-package declaration" as a finding, not a pass
//
// #8880 recorded the honest complication: `ValidationError` declares no status
// at all, so nothing pinned the doc's claim on either side of that branch. This
// gate states that class of finding rather than passing it. Every documented
// standard code with ZERO derived producer is listed in
// `scripts/error-status-unpinned-baseline.json`; a NEW one fails the gate, and a
// row that becomes pinned fails it too (ratchet down with `--update`).
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const SCAN_ROOT = 'packages';
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', 'coverage', 'build', 'fixtures']);
const ERRORS_ZOD = 'packages/spec/src/api/errors.zod.ts';
const DOC_HANDLING = 'content/docs/protocol/kernel/error-handling.mdx';
const DOC_CATALOG = 'content/docs/api/error-catalog.mdx';
const BASELINE_PATH = 'scripts/error-status-unpinned-baseline.json';

/**
 * Kept identical to the token `check-role-word` / `check-engine-double-contract`
 * / `check-type-check-coverage` print, so the #8435 convention stays greppable:
 * a remedy that WEAKENS a ratchet must say whose path it is.
 */
const RATCHET_AUTHORITY_MARKER = '⛔ MAINTAINER-ONLY';

/**
 * The baseline-EXPANDING offer, as a detector rather than a string compare, so
 * the self-test proves it still reaches its subject — a reworded offer that
 * stopped matching would make the convention check pass vacuously.
 */
const RATCHET_EXPANSION_OFFER = /admit it into\s+scripts\/error-status-unpinned-baseline\.json/;

// ───────────────────────────────────────────────────────────────────────────
// Constant resolution
// ───────────────────────────────────────────────────────────────────────────

/**
 * Index every `const NAME = <literal>` and `const OBJ = { key: <literal> }` in
 * the scanned sources, so a declaration written as `readonly code = SOME_CODE`
 * still resolves.
 *
 * A name bound to two different literals in two files is recorded as AMBIGUOUS
 * and refused at resolution time. Guessing there would let the gate assert a
 * status nobody declared, which is worse than reporting the declaration
 * unresolved.
 *
 * @param {Map<string, string>} sources path → source text
 */
export function buildConstantIndex(sources) {
  const values = new Map();
  const ambiguous = new Set();
  const put = (name, value) => {
    if (values.has(name)) {
      if (values.get(name) !== value) ambiguous.add(name);
      return;
    }
    values.set(name, value);
  };
  const TAIL = '\\s*(?:as const\\s*)?(?:satisfies\\s+[^;]+)?;';
  const SCALAR = new RegExp(
    `^\\s*(?:export\\s+)?const\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=\\n]+)?=\\s*(?:'([^'\\n]*)'|"([^"\\n]*)"|(\\d{3}))${TAIL}`,
    'gm',
  );
  const OBJECT = new RegExp(
    `^\\s*(?:export\\s+)?const\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=\\n]+)?=\\s*\\{([^{}]*)\\}${TAIL}`,
    'gm',
  );
  const LITERAL_ENTRY = /(?:^|[\s,])(?:'([^'\n]+)'|([A-Za-z_$][\w$]*)|(\d+))\s*:\s*(?:'([^'\n]*)'|"([^"\n]*)"|(\d{3}))/g;
  // `[EXTERNAL_ERROR_CODES.schemaMismatch]: 503` — a COMPUTED key, resolved in a
  // second pass once the scalar/object entries it names are indexed. The pattern
  // is how this repo writes a status table beside the code table it keys on
  // (`external-errors.ts`), so not reading it left the deriver blind to a whole
  // error family and reporting three declarations it could have resolved.
  const COMPUTED_ENTRY = /\[\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\]\s*:\s*(?:'([^'\n]*)'|"([^"\n]*)"|(\d{3}))/g;

  const clean = [...sources.values()].map(stripComments);
  const objectBodies = [];
  for (const src of clean) {
    for (const m of src.matchAll(SCALAR)) put(m[1], m[2] ?? m[3] ?? Number(m[4]));
    for (const m of src.matchAll(OBJECT)) {
      objectBodies.push([m[1], m[2]]);
      for (const kv of m[2].matchAll(LITERAL_ENTRY)) {
        put(`${m[1]}.${kv[1] ?? kv[2] ?? kv[3]}`, kv[4] ?? kv[5] ?? Number(kv[6]));
      }
    }
  }
  const index = { values, ambiguous };
  for (const [name, body] of objectBodies) {
    for (const kv of body.matchAll(COMPUTED_ENTRY)) {
      const key = lookup(kv[1], index);
      if (key === undefined) continue;
      put(`${name}.${key}`, kv[2] ?? kv[3] ?? Number(kv[4]));
    }
  }
  return index;
}

/** @returns {string|undefined} */
export function resolveString(expr, index) {
  const e = String(expr).trim().replace(/\s+as const$/, '');
  const lit = /^'([^']*)'$/.exec(e) ?? /^"([^"]*)"$/.exec(e);
  if (lit) return lit[1];
  const v = lookup(e, index);
  return typeof v === 'string' ? v : undefined;
}

/** @returns {number|undefined} an HTTP status in the 400–599 band */
export function resolveStatus(expr, index) {
  const e = String(expr).trim().replace(/\s+as const$/, '');
  const v = /^\d{3}$/.test(e) ? Number(e) : lookup(e, index);
  return typeof v === 'number' && v >= 400 && v < 600 ? v : undefined;
}

function lookup(e, index) {
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?$/.test(e)) {
    return index.ambiguous.has(e) ? undefined : index.values.get(e);
  }
  // MAP[OBJ.key] / MAP[NAME] — resolve the subscript, then the member.
  const m = /^([A-Za-z_$][\w$]*)\[([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\]$/.exec(e);
  if (!m) return undefined;
  const key = lookup(m[2], index);
  if (key === undefined || index.ambiguous.has(m[1])) return undefined;
  return index.values.get(`${m[1]}.${key}`);
}

// ───────────────────────────────────────────────────────────────────────────
// Runtime side — derived
// ───────────────────────────────────────────────────────────────────────────

/**
 * Blank out comments (keeping byte offsets, so reported line numbers stay
 * true), because this repo DOCUMENTS envelopes in prose.
 *
 * Not a tidiness measure — it is load-bearing. Two of this gate's first findings
 * on `main` were docblocks: `quickjs-runner.ts` narrates the bug it fixed
 * ("the action surface answered `{ code: 'RECORD_NOT_FOUND', httpStatus: 400 }`")
 * and `protocol.ts` names a shape it exists to PREVENT ("would mint incoherent
 * rows — `{ code: 'INTERNAL_ERROR', httpStatus: 409 }`"). Read as producers,
 * both manufacture a status disagreement out of a sentence saying the opposite.
 * A deriver that mines prose is not a deriver.
 *
 * Strings and template literals are tracked only so a `//` or `/*` inside one
 * cannot open a phantom comment; their contents are left intact.
 */
export function stripComments(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out[i] = ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] !== '\n') out[i] = ' '; i++; }
      if (i < n) { out[i] = ' '; out[i + 1] = ' '; i += 2; }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      // A `'` or `"` never spans a line in JS, so a quote character mis-read
      // out of a regex character class (`/["'`]/`) recovers at end of line
      // instead of swallowing the rest of the file.
      const bounded = quote !== '`';
      i++;
      while (i < n && src[i] !== quote && !(bounded && src[i] === '\n')) {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    i++;
  }
  return out.join('');
}

/** Brace-matched class bodies, so a property read never escapes its class. */
function classBodies(src) {
  const out = [];
  const re = /(?:^|\n)(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)[^{;]*\{/g;
  let m;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let i = open;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) { i++; break; }
    }
    out.push({ name: m[1], body: src.slice(open, i) });
    re.lastIndex = i;
  }
  return out;
}

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

/**
 * Every (code, status) pair the scanned sources prove reachable, with the
 * evidence that proves it.
 *
 * @param {Map<string, string>} sources path → source text
 * @returns {{ emitted: Map<string, Map<number, string[]>>, unresolved: string[], sites: number }}
 */
export function deriveRuntimeStatuses(sources, index) {
  const emitted = new Map();
  const unresolved = [];
  let sites = 0;
  const record = (code, status, where) => {
    sites++;
    if (!emitted.has(code)) emitted.set(code, new Map());
    const perStatus = emitted.get(code);
    if (!perStatus.has(status)) perStatus.set(status, []);
    const list = perStatus.get(status);
    if (list.length < 4 && !list.includes(where)) list.push(where);
  };
  const refuse = (where, code, status) =>
    unresolved.push(`${where}: code=${String(code).trim()} status=${String(status).trim()}`);

  for (const [path, raw] of sources) {
    const src = stripComments(raw);
    // R1 — error classes declaring their own code + status/statusCode.
    for (const { name, body } of classBodies(src)) {
      const codeM = /^[ \t]*(?:public\s+|protected\s+|private\s+)?readonly\s+code\s*(?::[^=\n]+)?=\s*([^;\n]+);/m.exec(body);
      if (!codeM) continue;
      const statusM =
        /^[ \t]*(?:public\s+|protected\s+|private\s+)?readonly\s+status\s*(?::[^=\n]+)?=\s*([^;\n]+);/m.exec(body)
        ?? /^[ \t]*(?:public\s+|protected\s+|private\s+)?readonly\s+statusCode\s*(?::[^=\n]+)?=\s*([^;\n]+);/m.exec(body);
      if (!statusM) continue;
      const code = resolveString(codeM[1], index);
      const status = resolveStatus(statusM[1], index);
      if (code === undefined || status === undefined) { refuse(`${path} class ${name}`, codeM[1], statusM[1]); continue; }
      record(code, status, `${path}: class ${name}`);
    }
    // R2 — the `@objectstack/types` envelope door: sendError(res, status, code, message).
    for (const m of src.matchAll(/\bsendError\(\s*[\w$.]+\s*,\s*('[^']*'|"[^"]*"|[\w$.]+)\s*,\s*('[^']*'|"[^"]*"|[\w$.]+)\s*[,)]/g)) {
      const status = resolveStatus(m[1], index);
      const code = resolveString(m[2], index);
      if (status === undefined || code === undefined) {
        // Only a shape that LOOKS like the 4-arg door is a refusal; the 2-arg
        // `packages/rest` door (sendError(res, error)) is a different function.
        if (/^\d{3}$/.test(m[1].trim()) || /^[A-Z_]+$/.test(m[1].trim().replace(/^.*\./, ''))) refuse(`${path}:${lineOf(src, m.index)} sendError`, m[2], m[1]);
        continue;
      }
      record(code, status, `${path}:${lineOf(src, m.index)}: sendError`);
    }
    // R3/R4/R5 — object literals that carry both a code and a status: the
    // `packages/rest` sendError door, `Object.assign(new Error(…), …)` throws,
    // and the REST mapper's `{ status, body: { code } }` terminals.
    for (const m of src.matchAll(/\{[^{}]*\bcode\s*:[^{}]*\}|\{[^{}]*\bstatus\s*:[^{}]*\}/g)) {
      const inner = m[0];
      const c = /\bcode\s*:\s*('[^']*'|"[^"]*"|[\w$.]+)/.exec(inner);
      // `status` / `statusCode` ONLY, the two spellings `declaredHttpStatus`
      // (`packages/rest/src/error-response.ts`) actually reads. `httpStatus` is
      // a RESPONSE BODY field, not a thrown error's declaration of its status,
      // and mining it read narrated envelopes as producers.
      const s = /\b(?:status|statusCode)\s*:\s*('[^']*'|"[^"]*"|[\w$.]+)/.exec(inner);
      if (!c || !s) continue;
      const code = resolveString(c[1], index);
      const status = resolveStatus(s[1], index);
      if (code === undefined || status === undefined) continue; // an unrelated `{ code, status }` pair
      if (!/^[A-Z][A-Z0-9_]*$/.test(code)) continue;
      record(code, status, `${path}:${lineOf(src, m.index)}: { code, status }`);
    }
    // R5b — `{ status: N, body: { …, code: 'X' } }`, the mapper's two sanitised
    // 5xx terminals, where the pair straddles a nested brace.
    for (const m of src.matchAll(/\bstatus\s*:\s*(\d{3})\s*,\s*body\s*:\s*\{([^{}]*)\}/g)) {
      const c = /\bcode\s*:\s*'([A-Z][A-Z0-9_]*)'/.exec(m[2]);
      const status = resolveStatus(m[1], index);
      if (!c || status === undefined) continue;
      record(c[1], status, `${path}:${lineOf(src, m.index)}: { status, body }`);
    }
  }
  return { emitted, unresolved, sites };
}

/**
 * The door's own status→code map. EXPLICIT entries only — see the bounds note
 * in this file's header for why the bucket fallback is excluded.
 */
export function deriveDoorMap(errorsZodSource) {
  const out = [];
  const block = /export const HttpStatusErrorCodeMap[^=]*=\s*\{([\s\S]*?)\n\};/.exec(errorsZodSource);
  if (!block) return out;
  for (const kv of block[1].matchAll(/(\d{3})\s*:\s*'([A-Z][A-Z0-9_]*)'/g)) {
    out.push({ code: kv[2], status: Number(kv[1]) });
  }
  return out;
}

/** The reconciled vocabulary: `StandardErrorCode`'s members. */
export function parseStandardErrorCodes(errorsZodSource) {
  const block = /export const StandardErrorCode = z\.enum\(\[([\s\S]*?)\]\);/.exec(errorsZodSource);
  if (!block) throw new Error(`${ERRORS_ZOD}: StandardErrorCode enum not found — the deriver's anchor moved.`);
  return [...block[1].matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1]);
}

// ───────────────────────────────────────────────────────────────────────────
// Doc side — parsed
// ───────────────────────────────────────────────────────────────────────────

const STATUS_IN_PROSE = /\b([45]\d\d)\b/g;

/** A heading — at either entry level — that names an error code. */
const CODE_TOKEN_HEADING = /^(#{3,4})\s+`([A-Z][A-Z0-9_]*)`(.*)$/;

/**
 * The ENTRY-HEADING spellings the doc side recognises, published rather than
 * left implicit inside a regex — the `check:cross-package-test-inputs`
 * convention, adopted for the same reason: a text scan sees only the spellings
 * it knows, and an unrecognised one produces no statement *silently*.
 *
 * `suffix` matches whatever follows the code token on the heading line.
 * Anything not matched here is REPORTED (see `unreadableHeadingMessage`), never
 * dropped — the file header explains which real published status the silent
 * drop hid.
 */
export const ENTRY_HEADING_SHAPES = [
  { name: 'bare code', example: '### `RECORD_NOT_FOUND`', suffix: /^\s*$/ },
  {
    name: 'code + descriptive suffix',
    example: '### `INVALID_REQUEST` — unrecognised type spelling',
    suffix: /^\s+[—–-]\s+\S/,
  },
];

/**
 * @param {string} line
 * @param {number} level heading depth this page writes its code entries at
 * @returns {{ code: string, readable: boolean, shape?: string, why?: string } | null}
 */
export function readEntryHeading(line, level) {
  const m = CODE_TOKEN_HEADING.exec(line);
  if (!m) return null;
  if (m[1].length !== level) {
    return {
      code: m[2],
      readable: false,
      why: `it is a level-\`${m[1]}\` heading, and this page writes its error-code entries at level \`${'#'.repeat(level)}\``,
    };
  }
  const shape = ENTRY_HEADING_SHAPES.find((s) => s.suffix.test(m[3]));
  if (shape) return { code: m[2], readable: true, shape: shape.name };
  return { code: m[2], readable: false, why: `the text after the code token, ${JSON.stringify(m[3])}, matches no recognised shape` };
}

/**
 * @param {{ handling: string, catalog: string }} docs
 * @returns {{ claimed: Map<string, Map<number, string[]>>, covered: Map<string, Map<number, string[]>>,
 *             documented: Set<string>, unreadableHeadings: object[] }}
 */
export function parseDocumentedStatuses(docs) {
  const claimed = new Map();
  const covered = new Map();
  const documented = new Set();
  const unreadableHeadings = [];
  const add = (map, code, status, where) => {
    documented.add(code);
    if (!map.has(code)) map.set(code, new Map());
    const perStatus = map.get(code);
    if (!perStatus.has(status)) perStatus.set(status, []);
    if (!perStatus.get(status).includes(where)) perStatus.get(status).push(where);
  };

  /**
   * The designated per-entry status claim, honoured on BOTH pages: the first
   * `**HTTP Status:**` line inside the entry's opening window. A page that
   * publishes a status per ENTRY rather than per category — the `/meta` section
   * of the catalog says in prose that it does exactly that — needs a shape to
   * say so in that this parser reads.
   */
  const claimEntryStatusLine = (lines, i, code, path) => {
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const line = /^\*\*HTTP Status:\*\*(.*)$/.exec(lines[j]);
      if (!line) continue;
      for (const s of line[1].matchAll(STATUS_IN_PROSE)) {
        add(claimed, code, Number(s[1]), `${path}:${j + 1}`);
      }
      return;
    }
  };
  const unreadable = (path, i, line, head) =>
    unreadableHeadings.push({ path, line: i + 1, code: head.code, why: head.why, text: line.trim() });
  const entries = [];

  // error-handling.mdx — `#### \`CODE\`` then `**HTTP Status:** …`
  const h = docs.handling.split('\n');
  for (let i = 0; i < h.length; i++) {
    const head = readEntryHeading(h[i], 4);
    if (!head) continue;
    if (!head.readable) { unreadable(DOC_HANDLING, i, h[i], head); continue; }
    documented.add(head.code);
    entries.push({ code: head.code, where: `${DOC_HANDLING}:${i + 1}` });
    claimEntryStatusLine(h, i, head.code, DOC_HANDLING);
  }

  // error-catalog.mdx — section headings (covered), the per-entry
  // `**HTTP Status:**` line (claimed) and the quick-reference rows (claimed)
  const c = docs.catalog.split('\n');
  let section = null;
  for (let i = 0; i < c.length; i++) {
    const sec = /^## (.+?)\s*$/.exec(c[i]);
    if (sec) {
      section = { title: sec[1], statuses: [...sec[1].matchAll(STATUS_IN_PROSE)].map((m) => Number(m[1])) };
      continue;
    }
    const entry = readEntryHeading(c[i], 3);
    if (entry) {
      if (!entry.readable) { unreadable(DOC_CATALOG, i, c[i], entry); continue; }
      documented.add(entry.code);
      entries.push({ code: entry.code, where: `${DOC_CATALOG}:${i + 1}` });
      claimEntryStatusLine(c, i, entry.code, DOC_CATALOG);
      for (const st of section?.statuses ?? []) {
        add(covered, entry.code, st, `${DOC_CATALOG}:${i + 1} (§ ${section.title})`);
      }
      continue;
    }
    const row = /^\|\s*(\d{3})\s*\|[^|]*\|(.*)\|\s*$/.exec(c[i]);
    if (row) {
      for (const cm of row[2].matchAll(/`([A-Z][A-Z0-9_]*)`/g)) {
        add(claimed, cm[1], Number(row[1]), `${DOC_CATALOG}:${i + 1} (quick reference)`);
      }
    }
  }
  return { claimed, covered, documented, unreadableHeadings, entries };
}

/**
 * Entries whose heading the parser READ but for which no scanned page publishes
 * a status in any graded shape — no `**HTTP Status:**` line, no quick-reference
 * row, and a section heading naming no status (`## Batch Operation Errors`,
 * `## Server Errors (5xx)`).
 *
 * REPORTED, deliberately not failed. This is the residue of the same blind spot
 * the vocabulary derivation closes, one grade weaker: such a page may still
 * publish the status in prose or in a JSON example — `/meta`'s `400` was
 * published exactly that way — and prose is not a shape a deriver may mine
 * (the runtime side refuses to for the same reason). Failing here would demand
 * a status for codes whose producer this gate cannot find either, i.e. demand
 * that someone INVENT a published contract to satisfy a gate. So the honest
 * move is the one the unresolved/unpinned censuses already make: say it on
 * every run, so a partial gate cannot read as a complete one.
 */
export function ungradedEntries({ entries, claimed, covered }) {
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    if (seen.has(e.code)) continue;
    seen.add(e.code);
    if ((claimed.get(e.code)?.size ?? 0) + (covered.get(e.code)?.size ?? 0) === 0) out.push(e);
  }
  return out;
}

/**
 * The reconciled vocabulary, DERIVED rather than asserted: every
 * `StandardErrorCode` member, plus every OTHER code a scanned page actually
 * publishes a status for.
 *
 * The second half is the whole point. Ledger codes (`ERROR_CODE_LEDGER`) reach
 * the docs one at a time, and while the vocabulary was a fixed list the run
 * printed "neither page publishes their status" as a claim — which went false
 * the day one of them was documented, with no gate in either direction and the
 * claim still printing. Derived from the parsed pages, that sentence cannot go
 * false: a code the docs publish a status for is reconciled BECAUSE they publish
 * it, and the residual is a subtraction. Count-independent by construction —
 * registering a new ledger code moves no literal here.
 *
 * @param {{ members: string[], claimed: Map<string, unknown>, covered: Map<string, unknown> }} input
 */
export function reconciledVocabulary({ members, claimed, covered }) {
  const published = new Set([...claimed.keys(), ...covered.keys()]);
  const extra = [...published].filter((code) => !members.includes(code)).sort();
  return { vocabulary: [...members, ...extra], docPublishedBeyondStandard: extra };
}

// ───────────────────────────────────────────────────────────────────────────
// Reconciliation
// ───────────────────────────────────────────────────────────────────────────

const statuses = (map, code) => new Set(map.get(code)?.keys() ?? []);
const evidence = (map, code, status) => (map.get(code)?.get(status) ?? []).join(', ');

/**
 * The set comparison, in both directions, over the reconciled vocabulary.
 *
 * @returns {{ emittedNotDocumented: object[], documentedNotReachable: object[],
 *             unpinned: string[], reconciledCodes: number, reconciledPairs: number }}
 */
export function reconcile({ vocabulary, emitted, claimed, covered, documented }) {
  const emittedNotDocumented = [];
  const documentedNotReachable = [];
  const unpinned = [];
  let reconciledCodes = 0;
  let reconciledPairs = 0;

  for (const code of vocabulary) {
    const runtime = statuses(emitted, code);
    const docClaimed = statuses(claimed, code);
    const docCovered = statuses(covered, code);
    const docAll = new Set([...docClaimed, ...docCovered]);

    // Direction A — every status the runtime can emit is documented.
    for (const status of [...runtime].sort()) {
      if (docAll.has(status)) { reconciledPairs++; continue; }
      emittedNotDocumented.push({
        code,
        status,
        documented: [...docAll].sort(),
        where: evidence(emitted, code, status),
      });
    }
    // Direction B — every status the docs CLAIM is one the runtime can emit.
    // Bounded to codes with a derived producer: see the unpinned census.
    if (runtime.size > 0) {
      reconciledCodes++;
      for (const status of [...docClaimed].sort()) {
        if (runtime.has(status)) continue;
        documentedNotReachable.push({
          code,
          status,
          emits: [...runtime].sort(),
          where: evidence(claimed, code, status),
        });
      }
    } else if (documented.has(code)) {
      unpinned.push(code);
    }
  }
  return { emittedNotDocumented, documentedNotReachable, unpinned: unpinned.sort(), reconciledCodes, reconciledPairs };
}

// ───────────────────────────────────────────────────────────────────────────
// Messages — named and pure, so the self-test can assert the exact text
// ───────────────────────────────────────────────────────────────────────────

export function emittedNotDocumentedMessage(f) {
  return (
    `${f.code}: the runtime can emit HTTP ${f.status}, and no doc publishes that status for it `
    + `(documented: ${f.documented.length ? f.documented.join(', ') : 'nothing'}). `
    + `Emitted at ${f.where}. Document the status where it belongs — a code may carry more than `
    + `one, so an exception is documented, not flattened away.`
  );
}

export function documentedNotReachableMessage(f) {
  return (
    `${f.code}: the docs publish HTTP ${f.status} (${f.where}), and no producer this gate can read `
    + `emits that code at that status (derived: ${f.emits.join(', ')}). Either the doc claim is stale, `
    + `or a producer exists in a shape the deriver cannot read — teach the deriver rather than `
    + `deleting the claim, and add a --self-test case for the shape.`
  );
}

export function newUnpinnedMessage(code) {
  return (
    `${code}: documented with an HTTP status, but no producer declares one — nothing pins the doc's `
    + `claim on either side, so it can drift with no test to update. Wire a producer that declares `
    + `\`status\`/\`statusCode\` (or a \`sendError\` door with a literal status). Only if the code is `
    + `genuinely unemitted today, admit it into scripts/error-status-unpinned-baseline.json — that `
    + `path WEAKENS this ratchet and is ${RATCHET_AUTHORITY_MARKER}, not a co-equal remedy.`
  );
}

export function unreadableHeadingMessage(u) {
  return (
    `${u.path}:${u.line}: this heading names error code \`${u.code}\` in a shape the doc-side parser does not `
    + `recognise — ${u.why}. Every status the page publishes under that heading is therefore read by NOTHING, `
    + `in either direction, while the run keeps printing a scope that no longer describes the pages. Write the `
    + `heading in a recognised shape (${ENTRY_HEADING_SHAPES.map((s) => s.example).join('  ·  ')}), or teach `
    + `ENTRY_HEADING_SHAPES the new shape AND add a --self-test case for it in the same edit. Heading read: `
    + `${JSON.stringify(u.text)}`
  );
}

export function nowPinnedMessage(code) {
  return `${code}: baselined as unpinned, but a producer now declares its status — ratchet the baseline down with --update.`;
}

// ───────────────────────────────────────────────────────────────────────────
// Self-test
// ───────────────────────────────────────────────────────────────────────────

/**
 * The pre-#8963 doc text, byte-copied out of `90197e15e` (PR #8963's merge
 * parent) — the real state of the pages when `MISSING_REQUIRED_FIELD` was
 * documented 400 while five paths answered 422. Kept verbatim rather than
 * hand-authored: a synthetic "wrong" fixture proves the gate can fail, not that
 * it catches THIS defect.
 */
const PRE_8963_HANDLING = [
  '#### `MISSING_REQUIRED_FIELD`',
  '**HTTP Status:** 400  ',
  '**Meaning:** Required field is missing',
].join('\n');

const PRE_8963_CATALOG = [
  '## Validation Errors (400)',
  '',
  '### `MISSING_REQUIRED_FIELD`',
  '**Cause:** A required field was not provided in the request body.  ',
  '',
  '## HTTP Status Quick Reference',
  '',
  '| Status | Category | Common Codes |',
  '|:---:|:---|:---|',
  '| 400 | `validation` | `VALIDATION_ERROR`, `INVALID_FIELD`, `MISSING_REQUIRED_FIELD`, `INVALID_QUERY` |',
].join('\n');

/** The post-#8963 lines, byte-copied out of the landed pages. */
const POST_8963_HANDLING = [
  '#### `MISSING_REQUIRED_FIELD`',
  '**HTTP Status:** 400 — with one documented exception, which answers **422** (see below)  ',
  '**Meaning:** Required field is missing',
].join('\n');

const POST_8963_CATALOG = [
  PRE_8963_CATALOG,
  '| 422 | `validation` | `MISSING_REQUIRED_FIELD` on an absent `controlled_by_parent` master reference (see [above](#missing_required_field)) — this row is an exception to the 400 row, not a second home for the code |',
].join('\n');

/** The real refusal class, reduced to the two declarations the deriver reads. */
const CBP_ERROR_CLASS = `
export class MasterReferenceMissingError extends Error {
  readonly code = 'MISSING_REQUIRED_FIELD';
  readonly status = 422;
  readonly statusCode = 422;
}
`;

const CBP_400_DOOR = `
export function registerPackageRoutes() {
  sendError(res, 400, 'MISSING_REQUIRED_FIELD', 'Missing required fields: manifest, metadata');
}
`;

function runFixture({ files, handling, catalog, members }) {
  const sources = new Map(Object.entries(files));
  const index = buildConstantIndex(sources);
  const derived = deriveRuntimeStatuses(sources, index);
  const doc = parseDocumentedStatuses({ handling, catalog });
  const { vocabulary, docPublishedBeyondStandard } = reconciledVocabulary({ members, ...doc });
  const result = reconcile({ vocabulary, emitted: derived.emitted, ...doc });
  return {
    ...result,
    vocabulary,
    docPublishedBeyondStandard,
    unreadableHeadings: doc.unreadableHeadings,
    ungraded: ungradedEntries(doc),
    unresolved: derived.unresolved,
    emitted: derived.emitted,
  };
}

function selfTest() {
  const failures = [];
  const check = (name, ok, detail) => { if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`); };
  const members = ['MISSING_REQUIRED_FIELD', 'VALIDATION_ERROR', 'TIMEOUT'];

  // 1 — THE regression pin: the real pre-#8963 pages go RED, naming 422.
  const pre = runFixture({
    files: { 'a/errors.ts': CBP_ERROR_CLASS, 'a/routes.ts': CBP_400_DOOR },
    handling: PRE_8963_HANDLING, catalog: PRE_8963_CATALOG, members,
  });
  check('1 pre-#8963 fixture is red', pre.emittedNotDocumented.length === 1,
    `got ${pre.emittedNotDocumented.length}`);
  check('1b pre-#8963 finding names MISSING_REQUIRED_FIELD @422',
    pre.emittedNotDocumented[0]?.code === 'MISSING_REQUIRED_FIELD' && pre.emittedNotDocumented[0]?.status === 422,
    JSON.stringify(pre.emittedNotDocumented[0]));

  // 2 — POSITIVE CONTROL for the zero-hit case: the instrument must be SEEING a
  //     status it accepts, not merely finding nothing. Same fixture, post-#8963
  //     text: zero findings AND a non-zero count of reconciled (code, status)
  //     pairs, so "0 findings" can never be reported by a blind run.
  const post = runFixture({
    files: { 'a/errors.ts': CBP_ERROR_CLASS, 'a/routes.ts': CBP_400_DOOR },
    handling: POST_8963_HANDLING, catalog: POST_8963_CATALOG, members,
  });
  check('2 post-#8963 fixture is green', post.emittedNotDocumented.length === 0 && post.documentedNotReachable.length === 0,
    JSON.stringify([post.emittedNotDocumented, post.documentedNotReachable]));
  check('2b positive control: the accepted statuses were actually seen', post.reconciledPairs === 2,
    `reconciledPairs=${post.reconciledPairs}`);
  check('2c the multi-status code carries BOTH statuses',
    [...(post.emitted.get('MISSING_REQUIRED_FIELD')?.keys() ?? [])].sort().join(',') === '400,422');

  // 3 — a green run over a fixture with NO producer must NOT report reconciled
  //     pairs (the blind-run inverse of case 2).
  const blind = runFixture({ files: { 'a/x.ts': 'export const nothing = 1;' }, handling: '', catalog: PRE_8963_CATALOG, members });
  check('3 no producers ⇒ no reconciled pairs', blind.reconciledPairs === 0 && blind.reconciledCodes === 0);
  check('3b documented-but-unproduced lands in the census, not in a failure',
    blind.unpinned.includes('MISSING_REQUIRED_FIELD') && blind.emittedNotDocumented.length === 0);

  // 4 — direction B: a doc claim no producer can reach.
  const dirB = runFixture({
    files: { 'a/e.ts': 'export class E extends Error {\n  readonly code = \'TIMEOUT\';\n  readonly status = 504;\n}' },
    handling: '#### `TIMEOUT`\n**HTTP Status:** 500  \n', catalog: '', members,
  });
  check('4 direction B fires on an unreachable documented status',
    dirB.documentedNotReachable.length === 1 && dirB.documentedNotReachable[0].status === 500,
    JSON.stringify(dirB.documentedNotReachable));
  check('4b direction A fires on the same pair from the other side',
    dirB.emittedNotDocumented.length === 1 && dirB.emittedNotDocumented[0].status === 504);

  // 5 — section headings are `covered`: they absolve direction A, and never
  //     drive direction B.
  const sec = runFixture({
    files: { 'a/e.ts': 'export class E extends Error {\n  readonly code = \'VALIDATION_ERROR\';\n  readonly statusCode = 428;\n}' },
    handling: '', catalog: '## Request Errors (405/428)\n\n### `VALIDATION_ERROR`\n', members,
  });
  check('5 a multi-status section heading absolves an emitted status', sec.emittedNotDocumented.length === 0);
  check('5b a section heading never demands reachability', sec.documentedNotReachable.length === 0);

  // 6 — constant resolution: a class that names its code and status.
  const consts = runFixture({
    files: {
      'a/c.ts': `export const REFUSAL_CODE = 'VALIDATION_ERROR';\nexport const REFUSAL_STATUS = 400;`,
      'a/e.ts': 'export class E extends Error {\n  readonly code = REFUSAL_CODE;\n  readonly status = REFUSAL_STATUS;\n}',
    },
    handling: '', catalog: '| 400 | `validation` | `VALIDATION_ERROR` |', members,
  });
  check('6 identifiers resolve through the constant index',
    consts.reconciledPairs === 1 && consts.emittedNotDocumented.length === 0, JSON.stringify(consts.emittedNotDocumented));

  // 6b — object-member and MAP[OBJ.key] resolution.
  const mapped = runFixture({
    files: {
      'a/c.ts': `export const CODES = { timeout: 'TIMEOUT' };\nexport const STATUS = { TIMEOUT: 504 };`,
      'a/e.ts': 'export class E extends Error {\n  readonly code = CODES.timeout;\n  readonly status = STATUS[CODES.timeout];\n}',
    },
    handling: '#### `TIMEOUT`\n**HTTP Status:** 504  \n', catalog: '', members,
  });
  check('6b MAP[OBJ.key] resolves', mapped.reconciledPairs === 1 && mapped.unresolved.length === 0, JSON.stringify(mapped.unresolved));

  // 7 — an UNRESOLVABLE declaration is reported, never silently dropped.
  const opaque = runFixture({
    files: { 'a/e.ts': 'export class E extends Error {\n  readonly code = lookupCode(x);\n  readonly status = lookupStatus(x);\n}' },
    handling: '', catalog: '', members,
  });
  check('7 an unresolved declaration is reported', opaque.unresolved.length === 1, JSON.stringify(opaque.unresolved));

  // 8 — an ambiguous identifier is refused, not guessed.
  const amb = buildConstantIndex(new Map([['a.ts', `const S = 400;`], ['b.ts', `const S = 500;`]]));
  check('8 an ambiguous constant refuses to resolve', resolveStatus('S', amb) === undefined);

  // 9 — the two `sendError` doors, and the mapper's `{ status, body }` terminal.
  const doors = runFixture({
    files: {
      'a/a.ts': `sendError(res, 503, 'SERVICE_UNAVAILABLE', 'down');`,
      'a/b.ts': `sendError(res, { code: 'VALIDATION_ERROR', message: 'x', status: 400 });`,
      'a/c.ts': `const T = () => ({ status: 500, body: { error: 'Internal data error', code: 'TIMEOUT' } });`,
    },
    handling: '', catalog: '', members: ['SERVICE_UNAVAILABLE', 'VALIDATION_ERROR', 'TIMEOUT'],
  });
  check('9 all three door shapes are derived',
    doors.emitted.get('SERVICE_UNAVAILABLE')?.has(503)
    && doors.emitted.get('VALIDATION_ERROR')?.has(400)
    && doors.emitted.get('TIMEOUT')?.has(500),
    [...doors.emitted.keys()].join(','));

  // 10 — the door map contributes explicit entries only, never the bucket fallback.
  const door = deriveDoorMap(`export const HttpStatusErrorCodeMap: Record<number, StandardErrorCode> = {\n  400: 'VALIDATION_ERROR',\n  504: 'TIMEOUT',\n};\n`);
  check('10 the door map is parsed', door.length === 2 && door.some((d) => d.code === 'TIMEOUT' && d.status === 504));
  check('10b the bucket fallback contributes nothing', !door.some((d) => d.status === 415 || d.status === 507));

  // 11 — the ratchet-authority convention holds on the weakening remedy only.
  check('11 the baseline-expanding remedy is marked maintainer-only',
    RATCHET_EXPANSION_OFFER.test(newUnpinnedMessage('X')) && newUnpinnedMessage('X').includes(RATCHET_AUTHORITY_MARKER));
  check('11b the ratchet-DOWN remedy stays the author\'s own',
    !nowPinnedMessage('X').includes(RATCHET_AUTHORITY_MARKER));

  // 12 — the vocabulary bound: a ledger code is derived but not reconciled.
  const ledger = runFixture({
    files: { 'a/e.ts': 'export class E extends Error {\n  readonly code = \'SETTINGS_LOCKED\';\n  readonly statusCode = 409;\n}' },
    handling: '', catalog: '', members: ['VALIDATION_ERROR'],
  });
  check('12 a non-standard code is derived but not reconciled',
    ledger.emitted.has('SETTINGS_LOCKED') && ledger.emittedNotDocumented.length === 0 && ledger.reconciledCodes === 0);

  // 13 — comments are NOT producers. Both halves matter: a docblock narrating a
  //      fixed bug must not mint a finding, and the real declaration two lines
  //      down must still be read. Both sentences below are the real ones this
  //      gate first tripped over on `main`.
  const prose = runFixture({
    files: {
      'a/n.ts':
        '/**\n'
        + " * the action surface answered `{ code: 'RECORD_NOT_FOUND', httpStatus: 400 }`\n"
        + " * would mint incoherent rows — `{ code: 'INTERNAL_ERROR', status: 409 }`\n"
        + ' */\n'
        + "sendError(res, 404, 'RECORD_NOT_FOUND', 'gone'); // sendError(res, 400, 'RECORD_NOT_FOUND', 'x')\n",
    },
    handling: '#### `RECORD_NOT_FOUND`\n**HTTP Status:** 404  \n', catalog: '',
    members: ['RECORD_NOT_FOUND', 'INTERNAL_ERROR'],
  });
  check('13 narrated envelopes in comments are not producers',
    prose.emittedNotDocumented.length === 0 && !prose.emitted.has('INTERNAL_ERROR'),
    JSON.stringify(prose.emittedNotDocumented));
  check('13b the real declaration beside them is still read',
    prose.emitted.get('RECORD_NOT_FOUND')?.has(404) && prose.emitted.get('RECORD_NOT_FOUND')?.size === 1);

  // 14 — a computed-key status table beside the code table it keys on, the
  //      `external-errors.ts` shape.
  const computed = runFixture({
    files: {
      'a/c.ts':
        "export const CODES = {\n  writeForbidden: 'PERMISSION_DENIED',\n} as const;\n"
        + 'export const STATUS = {\n  [CODES.writeForbidden]: 403,\n} as const satisfies Record<string, number>;\n',
      'a/e.ts': 'export class E extends Error {\n  readonly code = CODES.writeForbidden;\n  readonly status = STATUS[CODES.writeForbidden];\n}',
    },
    handling: '#### `PERMISSION_DENIED`\n**HTTP Status:** 403  \n', catalog: '', members: ['PERMISSION_DENIED'],
  });
  check('14 a computed-key status table resolves', computed.reconciledPairs === 1 && computed.unresolved.length === 0,
    JSON.stringify(computed.unresolved));

  // ── The doc-published ledger half. Fixture text is byte-copied out of the
  //    landed `error-catalog.mdx` `/meta` section, whose entry heading carries a
  //    descriptive suffix and whose section heading names no status at all —
  //    the exact combination that made a published 400 invisible.
  const META_CATALOG = [
    '## Metadata API Errors (`/meta`)',
    '',
    '### `INVALID_REQUEST` — unrecognised type spelling',
    '**HTTP Status:** 400  ',
    '',
    '**Cause:** The type segment of a `/meta` path is not a spelling ObjectStack recognises,',
  ].join('\n');
  const META_PRODUCER = "sendError(res, 400, 'INVALID_REQUEST', 'not a recognised spelling');";

  // 15 — a LEDGER code the docs publish a status for is reconciled, in both
  //      directions, without appearing in `StandardErrorCode`.
  const ledgerDoc = runFixture({
    files: { 'a/meta.ts': META_PRODUCER },
    handling: '', catalog: META_CATALOG, members: ['VALIDATION_ERROR'],
  });
  check('15 a doc-published ledger code enters the reconciled vocabulary',
    ledgerDoc.vocabulary.includes('INVALID_REQUEST')
    && ledgerDoc.docPublishedBeyondStandard.join(',') === 'INVALID_REQUEST',
    JSON.stringify(ledgerDoc.docPublishedBeyondStandard));
  check('15b it reconciles GREEN against its producer, with the pair actually seen',
    ledgerDoc.emittedNotDocumented.length === 0 && ledgerDoc.documentedNotReachable.length === 0
    && ledgerDoc.reconciledPairs === 1,
    JSON.stringify([ledgerDoc.emittedNotDocumented, ledgerDoc.documentedNotReachable, ledgerDoc.reconciledPairs]));

  // 16 — the extension is load-bearing, not decorative: the SAME ledger code
  //      goes red when the published status is not one the runtime can emit.
  //      This is the defect the ledger half was previously blind to.
  const ledgerDrift = runFixture({
    files: { 'a/meta.ts': "sendError(res, 409, 'INVALID_REQUEST', 'drifted');" },
    handling: '', catalog: META_CATALOG, members: ['VALIDATION_ERROR'],
  });
  check('16 a doc-published ledger code with a drifted status fires BOTH directions',
    ledgerDrift.documentedNotReachable.length === 1 && ledgerDrift.documentedNotReachable[0].status === 400
    && ledgerDrift.emittedNotDocumented.length === 1 && ledgerDrift.emittedNotDocumented[0].status === 409,
    JSON.stringify([ledgerDrift.documentedNotReachable, ledgerDrift.emittedNotDocumented]));

  // 17 — the surviving bound: a ledger code NO page publishes a status for stays
  //      OUT of the vocabulary (derived, counted, not reconciled). The residual
  //      is a subtraction, so this must not drift into a per-code assertion.
  const ledgerSilent = runFixture({
    files: { 'a/e.ts': "export class E extends Error {\n  readonly code = 'SETTINGS_LOCKED';\n  readonly statusCode = 409;\n}" },
    handling: '', catalog: META_CATALOG, members: ['VALIDATION_ERROR'],
  });
  check('17 an undocumented ledger code stays outside the vocabulary',
    !ledgerSilent.vocabulary.includes('SETTINGS_LOCKED') && ledgerSilent.emitted.has('SETTINGS_LOCKED')
    && ledgerSilent.emittedNotDocumented.length === 0,
    JSON.stringify(ledgerSilent.vocabulary));

  // 18 — the unreadable census: a heading that names a code in an unrecognised
  //      shape is REPORTED, never silently dropped. Both refusal reasons.
  const oddShape = runFixture({
    files: {}, handling: '', catalog: '## Errors (400)\n\n### `INVALID_REQUEST`: unrecognised type spelling\n',
    members: ['VALIDATION_ERROR'],
  });
  check('18 an unrecognised heading shape lands in the census',
    oddShape.unreadableHeadings.length === 1 && oddShape.unreadableHeadings[0].code === 'INVALID_REQUEST'
    && !oddShape.vocabulary.includes('INVALID_REQUEST'),
    JSON.stringify(oddShape.unreadableHeadings));
  const wrongLevel = runFixture({
    files: {}, handling: '#### `TIMEOUT`\n**HTTP Status:** 504  \n',
    catalog: '## Errors (400)\n\n#### `VALIDATION_ERROR`\n', members: ['VALIDATION_ERROR', 'TIMEOUT'],
  });
  check('18b a code entry at the wrong heading level is reported, and the right level still reads',
    wrongLevel.unreadableHeadings.length === 1 && wrongLevel.unreadableHeadings[0].code === 'VALIDATION_ERROR'
    && /level/.test(wrongLevel.unreadableHeadings[0].why),
    JSON.stringify(wrongLevel.unreadableHeadings));
  check('18c the census message names the recognised shapes and demands a self-test case',
    ENTRY_HEADING_SHAPES.every((s) => unreadableHeadingMessage(oddShape.unreadableHeadings[0]).includes(s.example))
    && /--self-test case/.test(unreadableHeadingMessage(oddShape.unreadableHeadings[0])));

  // 19 — `**HTTP Status:**` is honoured on the CATALOG too (it was read on the
  //      handling page only), and a section heading still only ever COVERS.
  const catalogClaim = runFixture({
    files: { 'a/e.ts': "export class E extends Error {\n  readonly code = 'TIMEOUT';\n  readonly status = 504;\n}" },
    handling: '', catalog: '## Server Errors (5xx)\n\n### `TIMEOUT`\n**HTTP Status:** 500  \n', members: ['TIMEOUT'],
  });
  check('19 a per-entry HTTP Status line on the catalog is a CLAIM, so direction B fires',
    catalogClaim.documentedNotReachable.length === 1 && catalogClaim.documentedNotReachable[0].status === 500,
    JSON.stringify(catalogClaim.documentedNotReachable));
  check('19b a status-less section heading (`5xx`) covers nothing',
    catalogClaim.emittedNotDocumented.length === 1 && catalogClaim.emittedNotDocumented[0].status === 504);

  // 20 — the ungraded census: an entry the parser READ but for which no page
  //      publishes a status in a graded shape is reported, and does NOT fail.
  //      This is the `## Batch Operation Errors` shape on the live catalog.
  const ungradedFx = runFixture({
    files: {}, handling: '',
    catalog: '## Batch Operation Errors\n\n### `TRANSACTION_FAILED`\n**Cause:** the transaction rolled back.\n',
    members: ['TRANSACTION_FAILED'],
  });
  check('20 an entry with no graded status is reported in the ungraded census',
    ungradedFx.ungraded.length === 1 && ungradedFx.ungraded[0].code === 'TRANSACTION_FAILED',
    JSON.stringify(ungradedFx.ungraded));
  check('20b the ungraded census does not manufacture a finding',
    ungradedFx.emittedNotDocumented.length === 0 && ungradedFx.documentedNotReachable.length === 0
    && ungradedFx.unreadableHeadings.length === 0);
  check('20c an entry that DOES publish a graded status is not in the census',
    ungradedEntries({ entries: [{ code: 'TIMEOUT', where: 'x:1' }], claimed: new Map([['TIMEOUT', new Map([[504, []]])]]), covered: new Map() }).length === 0);

  const CASES = 36;
  if (failures.length) {
    for (const f of failures) console.error(`  x self-test: ${f}`);
    console.error(`\n✗ check-error-status-conformance --self-test: ${failures.length}/${CASES} case(s) failed.\n`);
    process.exit(1);
  }
  console.log(
    `✓ check-error-status-conformance --self-test: ${CASES} cases pass — the real pre-#8963 doc text goes RED naming `
    + 'MISSING_REQUIRED_FIELD @422, the landed text goes green WITH the accepted statuses actually seen '
    + '(positive control), both directions fire independently, section headings absolve but never demand, '
    + 'narrated envelopes in comments are not producers, unresolvable declarations are reported, a LEDGER code '
    + 'the docs publish a status for is reconciled in both directions while one no page publishes stays out of '
    + 'the vocabulary, an entry heading in an unrecognised shape is reported instead of silently dropped, and '
    + 'the baseline-expanding remedy stays maintainer-only.',
  );
  process.exit(0);
}

if (process.argv.includes('--self-test')) selfTest();

// ───────────────────────────────────────────────────────────────────────────
// The real check
// ───────────────────────────────────────────────────────────────────────────

function walk(dir, out) {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e) && !/\.(test|spec|d)\.tsx?$/.test(e)) out.push(p);
  }
}

const update = process.argv.includes('--update');

const files = [];
walk(SCAN_ROOT, files);
const sources = new Map();
for (const f of files.sort()) sources.set(relative('.', f).replace(/\\/g, '/'), readFileSync(f, 'utf8'));

const errorsZod = readFileSync(ERRORS_ZOD, 'utf8');
const members = parseStandardErrorCodes(errorsZod);
const index = buildConstantIndex(sources);
const derived = deriveRuntimeStatuses(sources, index);
for (const { code, status } of deriveDoorMap(errorsZod)) {
  if (!derived.emitted.has(code)) derived.emitted.set(code, new Map());
  const perStatus = derived.emitted.get(code);
  if (!perStatus.has(status)) perStatus.set(status, []);
  if (!perStatus.get(status).includes(`${ERRORS_ZOD}: HttpStatusErrorCodeMap`)) {
    perStatus.get(status).push(`${ERRORS_ZOD}: HttpStatusErrorCodeMap`);
  }
}

const doc = parseDocumentedStatuses({
  handling: readFileSync(DOC_HANDLING, 'utf8'),
  catalog: readFileSync(DOC_CATALOG, 'utf8'),
});
const { vocabulary, docPublishedBeyondStandard } = reconciledVocabulary({ members, ...doc });
const result = reconcile({ vocabulary, emitted: derived.emitted, ...doc });

const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  : { unpinned: [] };
const baselined = new Set(baseline.unpinned ?? []);
const newlyUnpinned = result.unpinned.filter((c) => !baselined.has(c));
const nowPinned = [...baselined].filter((c) => !result.unpinned.includes(c) && vocabulary.includes(c)).sort();

if (update) {
  writeFileSync(
    BASELINE_PATH,
    `${JSON.stringify({
      note:
        'StandardErrorCode members documented with an HTTP status that NO producer this gate can read '
        + 'declares a status for — nothing pins the doc claim on either side. Shrink-only: a new entry is a '
        + 'gate failure, and a row that becomes pinned must be removed. Regenerate with '
        + '`node scripts/check-error-status-conformance.mjs --update`.',
      unpinned: result.unpinned,
    }, null, 2)}\n`,
  );
  console.log(`Baseline rewritten: ${result.unpinned.length} unpinned code(s).`);
  process.exit(0);
}

// The residual, as a SUBTRACTION from what the pages publish rather than a
// claim about it: codes the deriver found that are neither a `StandardErrorCode`
// member nor published with a status by a scanned page. Nothing here is a
// literal, so registering a ledger code moves no number that has to be edited.
const unreconciledLedger = [...derived.emitted.keys()].filter((c) => !vocabulary.includes(c)).sort();

// `--report` prints the whole derivation rather than only the disagreements.
// A finding is only as trustworthy as the evidence behind it, and "which
// producers did you actually see for this code?" is the first question anyone
// reading a failure asks.
if (process.argv.includes('--report')) {
  for (const code of vocabulary) {
    const runtime = derived.emitted.get(code);
    if (!runtime) continue;
    console.log(`${code}`);
    for (const [status, where] of [...runtime].sort((a, b) => a[0] - b[0])) {
      console.log(`    ${status}  ${where.join('\n          ')}`);
    }
  }
  console.log(`\nderived but NOT reconciled — no scanned page publishes a status for these ${unreconciledLedger.length}:`);
  for (const c of unreconciledLedger) console.log(`    ${c}`);
}

console.log('check:error-status-conformance — documented HTTP status ⇄ runtime-emitted status');
console.log(
  `  scope: ${vocabulary.length} code(s) reconciled = ${members.length} StandardErrorCode member(s) `
  + `+ ${docPublishedBeyondStandard.length} ledger code(s) a doc page publishes a status for`
  + `${docPublishedBeyondStandard.length ? ` (${docPublishedBeyondStandard.join(', ')})` : ''}; `
  + `${sources.size} source files scanned; ${derived.sites} producer site(s) derived; `
  + `${unreconciledLedger.length} further ledger code(s) derived but NOT reconciled — no scanned page publishes `
  + 'a status for them, so there is nothing to reconcile them against.',
);
console.log(
  `  reconciled: ${result.reconciledCodes} code(s) with a derived producer, `
  + `${result.reconciledPairs} (code, status) pair(s) matched against the docs.`,
);
console.log(`  unpinned: ${result.unpinned.length} documented code(s) with no derivable producer (baselined: ${baselined.size}).`);
const ungraded = ungradedEntries(doc);
if (ungraded.length) {
  console.log(
    `  ungraded: ${ungraded.length} doc entr(y|ies) whose heading was read but for which no page publishes a `
    + 'status in a graded shape (reported, not failed — see `ungradedEntries`) —',
  );
  for (const e of ungraded) console.log(`      ${e.code}  ${e.where}`);
}
if (doc.unreadableHeadings.length) {
  console.log(`  unreadable: ${doc.unreadableHeadings.length} doc heading(s) naming a code in an unrecognised shape —`);
  for (const u of doc.unreadableHeadings) console.log(`      ${u.path}:${u.line} ${JSON.stringify(u.text)}`);
}
if (derived.unresolved.length) {
  console.log(`  unresolved: ${derived.unresolved.length} declaration(s) the deriver could not read —`);
  for (const u of derived.unresolved) console.log(`      ${u}`);
}

if (result.reconciledPairs === 0) {
  console.error(
    '\n✗ the deriver matched ZERO (code, status) pairs. A green run with nothing reconciled is a blind run, '
    + 'not a clean one — the source anchors this gate reads have moved.\n',
  );
  process.exit(1);
}

const failures = [];
for (const f of result.emittedNotDocumented) failures.push(emittedNotDocumentedMessage(f));
for (const f of result.documentedNotReachable) failures.push(documentedNotReachableMessage(f));
for (const u of doc.unreadableHeadings) failures.push(unreadableHeadingMessage(u));
for (const c of newlyUnpinned) failures.push(newUnpinnedMessage(c));
for (const c of nowPinned) failures.push(nowPinnedMessage(c));

if (failures.length) {
  console.error('');
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`\n✗ check:error-status-conformance — ${failures.length} finding(s).\n`);
  process.exit(1);
}

console.log('\n✓ every derivable runtime status is documented, and every documented status is reachable.');
