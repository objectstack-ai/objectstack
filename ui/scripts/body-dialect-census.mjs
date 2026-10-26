#!/usr/bin/env node
/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `body` dialect liveness census (objectui#6771, ruling step 1).
 *
 * ## What this answers
 *
 * The 2026-09-01 ruling on objectui#6771 adopted option B — retire the `body`
 * child-list dialect so `children` is the one spelling — and made a liveness
 * reading a HARD GATE on everything after it:
 *
 * > Evidence of heavy `body` usage in *published* authored metadata returns to
 * > this card before any narrowing ships.
 *
 * So the question is not "does the string `body` appear" — it is **how many
 * authored NODES spell their child list `body`, per registration key**, with
 * the `children` count on the same keys as the denominator.
 *
 * ## Why a parser and not a grep
 *
 * `body` is a sibling key of `type` inside one object literal. A line-oriented
 * grep cannot see that relationship: it scores `body:` in an email payload, a
 * `bodyExtra` prop and a real authored node identically. This walks object
 * literals with a string/comment/regex-aware scanner and reports, per node,
 * which child-list keys that node actually carries.
 *
 * It reads `.json` and JS/TS object literals and Markdown alike, because
 * authored metadata in these repos lives in all three (JSON app metadata,
 * `definePage`-style TS literals, and the teaching snippets that ruling step 5
 * migrates in the same commit).
 *
 * ## Populations are reported SEPARATELY and never summed
 *
 * `--label` names the population so two runs cannot be added together by
 * accident: this repo's corpus is partly fixtures, hotcrm is a real
 * application, and they are differently authoritative.
 *
 * ## Known limits (stated so a zero is readable)
 *
 * ⭐ The limits are `KNOWN_LIMITS` below, and they are EMITTED, not merely
 * written here. Every run prints them, `--json` carries them under
 * `population.notScanned`, and the KEY SET the counts were taken over is
 * printed beside the counts. The promise in this heading is that a reader of a
 * zero can see what the zero was taken over — so the limits travel WITH the
 * reading instead of living only in a header nobody has open.
 *
 * ⚠️ This heading was a prose list, and it omitted the one limit that
 * silently changes the answer: the KEY POPULATION. The scan filtered every node
 * against a hard-coded name set and then threw that set away before printing,
 * so asking about any name OUTSIDE it returned `hits: 0` — a confident zero
 * indistinguishable from a real one, with nothing in the output naming the
 * population that produced it.
 *
 * It was hit for real (objectui#9545). A breaking-change census over six
 * narrowed names read zero from this tool; the reading was a population
 * artifact, and the only way to take the real one was to PATCH the name list in
 * a scratchpad copy of this file. That is the defect: not that the list was
 * wrong, but that it was neither askable nor visible.
 *
 * ⇒ the population is now an INPUT (`--keys`) and an OUTPUT (always, both
 * modes, no flag to suppress it). "Outside the population" is no longer a state
 * a caller can reach by accident: whatever `--keys` names IS the population,
 * and whatever the population is, the reading says so.
 *
 * Usage:
 *   node scripts/body-dialect-census.mjs --root . --label objectui
 *   node scripts/body-dialect-census.mjs --root ../hotcrm --label hotcrm --json
 *   node scripts/body-dialect-census.mjs --keys text,image,icon --json
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname, sep } from 'node:path';

import { isEntrypoint } from './invoked-as.mjs';

// ── The measured population ────────────────────────────────────────────────
//
// ⚠️ THIS BLOCK IS IN THE PAST TENSE ON PURPOSE. It records the population as
// it was when step 1 of objectui#6771 built this instrument; step 2 then
// converged every registration below onto `children`. The keys are what the
// census LOOKS AT, not what it expects to find — its job now is to report that
// the reading has gone to zero, so a present-tense sentence here would be a
// claim the instrument's own output contradicts. For what is true TODAY read
// `__tests__/body-dialect-census.test.ts`, which pins the converged state.
//
// BODY_ONLY: registrations whose renderer read `renderChildren(schema.body)`
// and never `schema.children`. For those, `body` was the ONLY door — retiring
// it removed the sole child-list key, which is why they are the population.
//
// ⚠️ Derived from the renderer sources, NOT from objectui#6771's card body
// (which lists 10) and NOT verbatim from the ratchet pin's `bodyReaders` array.
// That array — `['badge','alert',...sidebar*]` = 13 — lived in
// `container-declaration-ratchet.test.tsx` until objectui#6771 removed it along
// with the reads it named, so do not go looking for it. It was a convenience
// construction for a containment assertion: correct that all 13 were
// non-containers, but two of its members were not `body` readers at all:
//
//   - `sidebar-trigger` (navigation/sidebar.tsx) renders a `SidebarTrigger` and
//     takes no `schema` at all — it read NEITHER `body` NOR `children`.
//   - `tooltip` (overlay/tooltip.tsx) DID read `schema.body` and never
//     `schema.children`, and was the one registration in the tree that DECLARED
//     `body` as an input (`type: 'slot'`, label "Rich Content") — yet it was
//     absent from the ruled 13. objectui#6771 moved both halves: it renders
//     `renderChildren(schema.children)` and declares `{ name: 'children' }`.
//
// ⚠️ That last title is NOT vacant, and leaving this note in the present tense
// is what let two files in one tree answer the same question differently. The
// one registration declaring an input named `body` is now `record:alert`
// (`plugin-detail/src/index.tsx`), whose `body` is a declared translation map
// and never a child list. `packages/sdui-parser/src/body-dialect.ts` carries
// that reading and the carve-outs that depend on it; it is the file to keep in
// step, not this one.
//
// So the body-reading population WAS 12 of the ruled 13, plus `tooltip` = 13
// readers, the same NUMBER by coincidence and a different SET.
// Both facts are pinned in `__tests__/body-dialect-census.test.ts`.
export const BODY_ONLY = [
  'alert',
  'badge',
  'sidebar',
  'sidebar-content',
  'sidebar-footer',
  'sidebar-group',
  'sidebar-header',
  'sidebar-inset',
  'sidebar-menu',
  'sidebar-menu-button',
  'sidebar-menu-item',
  'sidebar-provider',
];

/** Ruled by objectui#6771 but read no child list at all — retiring `body` cost it nothing. */
export const RULED_BUT_NOT_A_READER = ['sidebar-trigger'];

/**
 * Read `schema.body` only, and was NOT in the ruled 13. Past tense: objectui#6771
 * converged it, and `__tests__/body-dialect-census.test.ts` pins that. See the
 * note above for why the name stays in the population regardless.
 */
export const BODY_ONLY_UNRULED = ['tooltip'];

// FALLBACK_READERS: `schema.children || schema.body` (or `body || children`).
// Authored `body` here is a silent second dialect, not the only door — these
// authors have a working alternative, so the retirement cost is a rewrite, not
// a capability loss.
const SEMANTIC_TAGS = ['aside', 'main', 'header', 'nav', 'footer', 'section', 'article'];
const HTML_ELEMENT_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'a', 'blockquote', 'pre', 'code',
  'strong', 'em', 'b', 'i', 'u', 'small', 'mark', 'sub', 'sup', 'del', 'ins', 'abbr',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'figure', 'figcaption', 'time', 'address', 'cite', 'q',
  // `img`, `hr`, `br` are VOID_TAGS — the factory skips `renderChildren` for
  // them, so they read neither key and are deliberately absent.
];
export const FALLBACK_READERS = [
  ...SEMANTIC_TAGS,
  ...HTML_ELEMENT_TAGS,
  'div',
  'aspect-ratio',
  'card',
  'page',
  'button',
];

/**
 * The DEFAULT population: every key above, i.e. every registration this file
 * has renderer evidence for. It is a default, not a boundary — `--keys`
 * replaces it, and a key it does not contain is reported as such rather than
 * refused. Refusing would delete the one use this tool was measured to have:
 * objectui#9545's worked example asked it about six names that are deliberately
 * NOT reader keys, which is a legitimate question and the reason `--keys`
 * exists.
 */
export const ALL_KEYS = new Set([
  ...BODY_ONLY,
  ...RULED_BUT_NOT_A_READER,
  ...BODY_ONLY_UNRULED,
  ...FALLBACK_READERS,
]);

/**
 * Every way this instrument can return a zero that is NOT "the corpus is
 * clean". One declaration, emitted by both output modes — ⛔ never a prose
 * list beside a machine-maintained one, which is the objectui#8659 family and
 * how the key-population limit came to be missing from the header in the first
 * place.
 *
 * Each `id` is stable and machine-checkable; `what` is the sentence a reader of
 * a zero needs. A new blind spot in the scanner belongs here in the SAME commit
 * that introduces it.
 */
export const KNOWN_LIMITS = [
  {
    id: 'key-population',
    what:
      'Only nodes whose `type` is in `population.keys` are counted. A name outside that set '
      + 'reads 0 because it was never asked about — pass `--keys` to change the set.',
  },
  {
    id: 'unscanned-extension',
    what:
      'Only `population.scannedExtensions` are read. Anything else — YAML above all, which is '
      + 'where a corpus may really author metadata — is NOT SCANNED, which is not the same as zero.',
  },
  {
    id: 'skipped-directory',
    what:
      '`population.skippedDirectories` are never walked. Absence of a hit under one of them is '
      + 'an exclusion, not a reading.',
  },
  {
    id: 'template-literal',
    what:
      'Template literals are opaque. A node built inside a `${...}` interpolation is not counted.',
  },
  {
    id: 'non-literal-type',
    what:
      'A node whose `type` value is not a string LITERAL (a variable, a union, a TS annotation) '
      + 'leaves the frame unscored, so it is invisible to every key in the population.',
  },
  {
    id: 'candidates-not-attribution',
    what:
      'The rows are CANDIDATES. Attribution (fixture vs doc vs real authored page) is each hit\'s '
      + '`bucket`, and the per-bucket counts are what a reader should quote, not the raw total.',
  },
];

const SCANNED_EXT = new Set([
  '.json', '.jsonc', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.md', '.mdx',
]);
// `.objectui-tmp` is the CLI test's live scratch directory (a generated app is
// mkdtemp'd under it and removed in a `finally`), so it is the same class as
// `test-results` and `playwright-report` already in this list: written by
// tooling, holds no source, and MEASURED to be reachable from here — this walk
// starts at `--root` (default the repo root) and descends dot-directories,
// so before this entry a planted file under `.objectui-tmp/` was reported as a
// census hit. See objectui#9201 for the sibling sweep where the same omission
// made a gate crash rather than merely over-report.
//
// `.objectstack-pin` is the same class one level up (objectui#13210): the
// pinned `@objectstack/*` build that `scripts/objectstack-pin.mjs build` links
// beside the committed manifests (objectui#12957, objectui#13008). It is
// git-ignored, it is ANOTHER repository's packed output (the spec packs its
// TypeScript `src/`, its JSON Schema and its CHANGELOG), and it exists only
// after `pnpm run setup` — so walking it made this census answer differently on
// the same commit depending on whether a build had run, and summed objectstack's
// population into objectui's, which "Populations are reported SEPARATELY and
// never summed" above forbids. It also made the walk's cost grow with
// objectstack's tree rather than objectui's, and the in-tree pin of this
// census then hit its 60s budget under coverage — the measurement is on
// objectui#13210's pull request. ESLint ignores it for the same reason
// (`eslint.config.js`, objectui#13008). The two instruments keep this list in
// step (`body-dialect-producer-scan.mjs`).
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.turbo', 'out',
  '.pnpm-store', 'playwright-report', 'test-results', '.objectui-tmp',
  '.objectstack-pin',
]);

// ── Scanner ────────────────────────────────────────────────────────────────

/**
 * Blank out Markdown prose, keeping only fenced code blocks (offsets and line
 * breaks preserved, so reported line numbers stay true).
 *
 * ⚠️ Required, not cosmetic. Markdown spells inline code with backticks, and
 * the scanner treats a backtick as a template-literal delimiter. A ```` ```json ````
 * fence is THREE backticks: the first two pair off, and the third opens a
 * "string" that runs to the closing fence — swallowing the entire snippet. The
 * first draft of this script therefore read EVERY doc example as zero nodes,
 * silently and with exit 0. That population is not incidental: ruling step 5
 * migrates the teaching corpus in the same commit, so a zero there would have
 * under-reported exactly the surface the ruling asks about.
 *
 * Prose is blanked rather than scanned because prose is not a call site — a
 * sentence mentioning `type: "badge"` is documentation about a key, not a node
 * authoring it.
 */
export function keepFencedCodeOnly(text) {
  const out = new Array(text.length).fill(' ');
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') out[i] = '\n';

  const fence = /^([ \t]*)(`{3,}|~{3,})([^\n]*)\n/gm;
  let m;
  while ((m = fence.exec(text)) !== null) {
    const marker = m[2][0].repeat(m[2].length);
    const bodyStart = m.index + m[0].length;
    // Find the closing fence: same marker character, at least as long.
    const closeRe = new RegExp(`^[ \\t]*${m[2][0] === '`' ? '`' : '~'}{${m[2].length},}[ \\t]*$`, 'm');
    closeRe.lastIndex = 0;
    const rest = text.slice(bodyStart);
    const closeMatch = closeRe.exec(rest);
    const bodyEnd = closeMatch ? bodyStart + closeMatch.index : text.length;
    for (let i = bodyStart; i < bodyEnd; i++) out[i] = text[i];
    fence.lastIndex = closeMatch ? bodyStart + closeMatch.index + closeMatch[0].length : text.length;
    void marker;
  }
  return out.join('');
}

/**
 * Walk object literals in `text`, returning one record per object that carries
 * a string-valued `type` key.
 *
 * String-, comment- and regex-aware, so `body:` inside a string, a comment or a
 * regular expression is never scored as a key. Keys are attributed to the
 * IMMEDIATELY enclosing object frame only — a `body` two levels down belongs to
 * the inner node, not the outer one.
 */
export function scanNodes(text) {
  const nodes = [];
  /** @type {Array<{ isObject: boolean, keys: Set<string>, type: string | null, start: number }>} */
  const stack = [];
  const n = text.length;
  let i = 0;
  // Tracks the last significant character, to tell division from a regex literal.
  let prevSignificant = '';

  const pushFrame = (isObject) => {
    stack.push({ isObject, keys: new Set(), type: null, start: i });
  };
  const popFrame = () => {
    const frame = stack.pop();
    if (frame && frame.isObject && frame.type !== null) {
      nodes.push({ type: frame.type, keys: frame.keys, offset: frame.start });
    }
  };

  while (i < n) {
    const c = text[i];

    // Comments
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    // Regex literal: a `/` in value position. Without this, a pattern such as
    // /^ {3}\S.*\(type "/ unbalances the brace stack (its `{` opens a phantom
    // object) AND its lone `"` opens a runaway string, blinding the scanner for
    // the rest of the file. Measured: that exact pattern in
    // `packages/cli/src/__tests__/check-schema-marker.test.ts` cost the file all
    // of its nodes until `>` was added below — an arrow function's `=>` is the
    // single commonest thing a regex literal follows in this codebase.
    if (
      c === '/' &&
      (/[(,=:[!&|?{};+\-*%~^<>]/.test(prevSignificant) ||
        /\b(return|typeof|case|in|of|do|else|yield|await|delete|void|instanceof)$/.test(
          text.slice(Math.max(0, i - 12), i).trimEnd(),
        ))
    ) {
      i++;
      let closed = false;
      while (i < n) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === '\n') break;
        if (text[i] === '[') { // character class: `/` inside it is literal
          i++;
          while (i < n && text[i] !== ']' && text[i] !== '\n') {
            if (text[i] === '\\') i++;
            i++;
          }
          i++;
          continue;
        }
        if (text[i] === '/') { i++; closed = true; break; }
        i++;
      }
      if (closed) { prevSignificant = '/'; continue; }
      // Not a regex after all — fall through as an ordinary character.
      continue;
    }

    // Key position: an identifier or quoted string directly inside an object
    // frame, followed by `:`.
    //
    // ⚠️ ORDER IS LOAD-BEARING — this MUST run before the string branch below.
    // JSON spells every key quoted (`"type": "badge"`), so if the string branch
    // consumes the opening quote first, no JSON key is ever tested and the whole
    // `.json` corpus scores a silent, exit-0 ZERO. That is not hypothetical: it
    // is what the first draft of this script did, and the differential control
    // in the test file is what caught it (14-16 nodes per authored sidebar
    // fixture, all read as 0).
    const top = stack[stack.length - 1];
    if (top && top.isObject && (/[A-Za-z_$]/.test(c) || c === '"' || c === "'")) {
      const m = /^(?:"([^"\\]*)"|'([^'\\]*)'|([A-Za-z_$][\w$]*))\s*:/.exec(text.slice(i, i + 200));
      if (m) {
        const key = m[1] ?? m[2] ?? m[3];
        top.keys.add(key);
        i += m[0].length;
        prevSignificant = ':';
        if (key === 'type') {
          // Capture a string-literal value; anything else (a TS annotation, an
          // identifier, a union type) leaves `type` null and the frame unscored.
          const v = /^\s*(?:"([^"\\]*)"|'([^'\\]*)')/.exec(text.slice(i, i + 200));
          if (v) top.type = v[1] ?? v[2];
        }
        continue;
      }
    }

    // Strings (values, and any quoted text that was NOT in key position).
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < n) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === quote) { i++; break; }
        i++;
      }
      prevSignificant = quote;
      continue;
    }

    if (c === '{') { pushFrame(true); i++; prevSignificant = '{'; continue; }
    if (c === '[') { pushFrame(false); i++; prevSignificant = '['; continue; }
    if (c === '}' || c === ']') { popFrame(); i++; prevSignificant = c; continue; }

    if (!/\s/.test(c)) prevSignificant = c;
    i++;
  }

  // Unterminated frames (a Markdown file whose fenced snippet is a fragment,
  // a `.tsx` whose apostrophe-in-prose desynced the stack) still yield their
  // nodes — dropping them would turn a scanner limitation into a silent zero.
  while (stack.length) popFrame();

  return nodes;
}

// ── Attribution ────────────────────────────────────────────────────────────

/**
 * Bucket a file by what KIND of artifact it is. A `body` string in a test
 * fixture, a doc snippet and a real authored page are three different things
 * and only some of them are the population the ruling asks about.
 */
export function bucketOf(relPath) {
  const p = relPath.split(sep).join('/');
  if (/(^|\/)__tests__\//.test(p) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(p)) return 'test';
  if (/(^|\/)(__fixtures__|fixtures|__mocks__)\//.test(p)) return 'fixture';
  if (/(^|\/)e2e\//.test(p)) return 'e2e';
  if (/\.mdx?$/.test(p)) return 'docs-teaching';
  if (/(^|\/)skills\//.test(p)) return 'skills-teaching';
  if (/(^|\/)examples\//.test(p)) return 'example-app';
  if (/(^|\/)(apps|src)\//.test(p)) return 'app-metadata';
  if (/(^|\/)scripts\//.test(p)) return 'tooling';
  return 'other';
}

// ── Walk ───────────────────────────────────────────────────────────────────

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walk(full);
    else if (st.isFile() && SCANNED_EXT.has(extname(entry))) yield full;
  }
}

/**
 * Line numbers for one text from ONE pass over it (objectui#13210).
 *
 * The `lineOf(text, offset)` this replaces counted newlines from the top of the
 * file for every hit, so a file cost hits × size. This indexes the newlines
 * once — lazily, so a file that yields no hit never pays — and answers each
 * offset by binary search. Same answer for every offset: the number of
 * newlines strictly before it, plus one.
 *
 * @param {string} text
 * @returns {(offset: number) => number}
 */
function lineCounter(text) {
  /** @type {number[] | null} */
  let newlines = null;
  return (offset) => {
    if (newlines === null) {
      newlines = [];
      for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) newlines.push(i);
    }
    let lo = 0;
    let hi = newlines.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (newlines[mid] < offset) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
}

/**
 * Resolve the key population for a run.
 *
 * Returns the set the counts will be taken over PLUS the facts a reader needs
 * to interpret a zero taken over it. Exported because the population is now
 * part of every reading, so anything that reports a count has to be able to
 * report what the count was taken over.
 *
 * `unknownKeys` is the honest half of "refuse an unknown key": a name with no
 * renderer evidence behind it is NAMED in the output rather than answered with
 * a bare 0 — and ⛔ not refused, because asking about such a name is the
 * measurement objectui#9545 was filed over.
 */
export function resolvePopulation(keys) {
  const resolved = keys === undefined || keys === null ? [...ALL_KEYS] : [...new Set(keys)];
  resolved.sort();
  return {
    keys: resolved,
    keySource: keys === undefined || keys === null ? 'default' : '--keys',
    unknownKeys: resolved.filter((k) => !ALL_KEYS.has(k)),
    scannedExtensions: [...SCANNED_EXT].sort(),
    skippedDirectories: [...SKIP_DIRS].sort(),
    notScanned: KNOWN_LIMITS,
  };
}

/**
 * ⭐ The cheap NECESSARY CONDITION for a file to yield a hit (objectui#13210).
 *
 * ⛔ Not a narrowing of the corpus: every file is still walked, read and
 * counted in `filesScanned`. What it skips is `scanNodes`, the per-character
 * walk, and only for a text in which no counted node could exist — so the hit
 * set is unchanged BY CONSTRUCTION. Same shape as the producer scan's
 * `CANDIDATE_FILE`.
 *
 * The superset argument, read off `scanNodes`. A node is a hit only when its
 * `type` is in the population, and `scanNodes` sets `type` in one place: at a
 * key token `"type"`, `'type'` or `type`, followed by optional space and `:`,
 * whose value then matches optional space and a quoted string. That string IS
 * the type, so the text holds `type`, an optional closing quote, space, `:`,
 * space, a quote, a population key, a quote — the pattern below, which is
 * laxer on every point (either quote on either side, no word boundary, no
 * 200-character window).
 *
 * ⚠️ It is tested on the text `scanNodes` reads, never on the raw file: for
 * Markdown that is `keepFencedCodeOnly`'s output, where blanked prose between
 * two fences becomes plain space that `\s*` can cross. A raw-text test would
 * miss a `type:` closing one fence whose value opens the next.
 *
 * @param {string[]} keys the resolved population
 * @returns {RegExp}
 */
export function mayHoldWantedNode(keys) {
  if (keys.length === 0) return /(?!)/;
  const escaped = [...keys]
    .sort((a, b) => b.length - a.length)
    .map((key) => key.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&'));
  return new RegExp(`type["']?\\s*:\\s*["'](?:${escaped.join('|')})["']`);
}

/**
 * @param {string} root
 * @param {{ keys?: string[] }} [options] population to count over; omitted =
 *   `ALL_KEYS`. The resolved population is returned with the hits and ⛔ never
 *   discarded — discarding it is the whole defect of objectui#9545.
 */
export function census(root, options = {}) {
  const population = resolvePopulation(options.keys);
  const wanted = new Set(population.keys);
  const mayHold = mayHoldWantedNode(population.keys);
  /** @type {Array<{file:string,line:number,type:string,body:boolean,children:boolean,bucket:string}>} */
  const hits = [];
  let filesScanned = 0;
  for (const file of walk(root)) {
    filesScanned++;
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    // Cheap pre-filter: a file with none of the key names cannot hold a node.
    if (!/\btype\b/.test(text)) continue;
    const isMarkdown = /\.mdx?$/.test(file);
    const scanText = isMarkdown ? keepFencedCodeOnly(text) : text;
    // The necessary condition for a HIT — see `mayHoldWantedNode`. Tested on
    // the text `scanNodes` reads, so the hit set is unchanged by construction.
    if (!mayHold.test(scanText)) continue;
    let nodes;
    try {
      nodes = scanNodes(scanText);
    } catch {
      continue;
    }
    const lineAt = lineCounter(text);
    for (const node of nodes) {
      if (!wanted.has(node.type)) continue;
      const rel = relative(root, file);
      hits.push({
        file: rel,
        line: lineAt(node.offset),
        type: node.type,
        body: node.keys.has('body'),
        children: node.keys.has('children'),
        bucket: bucketOf(rel),
      });
    }
  }
  return { population, filesScanned, hits };
}

// ── Report ─────────────────────────────────────────────────────────────────

function group(keys, hits) {
  const rows = [];
  for (const key of keys) {
    const forKey = hits.filter((h) => h.type === key);
    if (forKey.length === 0) {
      rows.push({ key, nodes: 0, body: 0, children: 0, neither: 0, files: 0 });
      continue;
    }
    rows.push({
      key,
      nodes: forKey.length,
      body: forKey.filter((h) => h.body).length,
      children: forKey.filter((h) => h.children).length,
      neither: forKey.filter((h) => !h.body && !h.children).length,
      files: new Set(forKey.map((h) => h.file)).size,
    });
  }
  return rows;
}

function printTable(title, rows) {
  console.log(`\n### ${title}`);
  console.log('| key | nodes | `body` | `children` | neither | files |');
  console.log('|:--|--:|--:|--:|--:|--:|');
  for (const r of rows) {
    console.log(`| \`${r.key}\` | ${r.nodes} | ${r.body} | ${r.children} | ${r.neither} | ${r.files} |`);
  }
  const sum = (f) => rows.reduce((a, r) => a + r[f], 0);
  console.log(
    `| **total** | **${sum('nodes')}** | **${sum('body')}** | **${sum('children')}** | **${sum('neither')}** | |`,
  );
}

/**
 * Exit code for a run that REFUSES to report a number, kept distinct from 1 so
 * "the instrument refused" and "the instrument crashed" are not the same
 * reading. An uncaught throw here exits 1; a refusal exits 2 and says which
 * refusal on stderr.
 */
export const EXIT_UNREADABLE = 2;

/**
 * Parse `--keys`. Comma-separated, repeatable: `--keys text,image --keys icon`.
 *
 * Returns `undefined` when the flag is absent (⇒ the default population) and an
 * ARRAY when it is present, including the empty array. That distinction is
 * load-bearing: `--keys` with a missing or malformed value must NOT quietly
 * fall back to the default population, because that would answer a question
 * about one key set with a count taken over a different one — the exact
 * defect this flag exists to close, reintroduced one level up.
 */
export function parseKeys(argv) {
  const named = [];
  let seen = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--keys') continue;
    seen = true;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) continue;
    for (const raw of value.split(',')) {
      const key = raw.trim();
      if (key) named.push(key);
    }
  }
  return seen ? named : undefined;
}

/**
 * Whether a run may report a number at all.
 *
 * Emitting the population makes an honest zero READABLE; it cannot make an
 * unreadable one readable. Two states stay unreadable however they are printed,
 * and both exit non-zero rather than printing a confident 0:
 *
 *   - an EMPTY key population — nothing was asked about, so every count is 0
 *     for a reason that has nothing to do with the corpus;
 *   - a walk that scanned ZERO files — a blind instrument, indistinguishable
 *     from a clean tree, which is the failure this file's own test block is
 *     built against.
 *
 * ⛔ A real zero over a real population on a real corpus is NOT refused. That is
 * a legitimate reading, and it is readable now because the population is
 * printed beside it. Refusing it — or refusing a key with no renderer
 * evidence behind it — would delete the measurement objectui#9545 was filed
 * over, where six deliberately non-reader names were the subject.
 */
export function finalVerdict({ population, filesScanned }) {
  if (population.keys.length === 0) {
    return {
      exit: EXIT_UNREADABLE,
      refusal: [
        '✗ Empty key population. Nothing was asked about, so every count would be 0',
        '  for a reason that has nothing to do with the corpus. Pass `--keys a,b,c`',
        '  with at least one name, or drop `--keys` to use the default population.',
      ],
    };
  }
  if (filesScanned === 0) {
    return {
      exit: EXIT_UNREADABLE,
      refusal: [
        '✗ Zero files scanned. A census that reads nothing because it is blind is',
        '  indistinguishable from a clean corpus, so this exits non-zero rather than',
        '  printing a silent zero. Check `--root` and the scanned-extension list.',
      ],
    };
  }
  return { exit: 0, refusal: null };
}

/** The population block, printed in the TEXT mode that `--json` carries verbatim. */
function printPopulation(population) {
  const { keys, keySource, unknownKeys, scannedExtensions, skippedDirectories, notScanned } = population;
  console.log('\n### Key population — what every count below was taken over');
  console.log(
    `\nSource: \`${keySource}\`. Keys (${keys.length}): ${keys.map((k) => `\`${k}\``).join(' ')}`,
  );
  console.log(
    '\n⚠️ A zero on any key NOT in that list is not a reading — that key was never asked'
      + ' about. Pass `--keys` to ask.',
  );
  if (unknownKeys.length > 0) {
    console.log(
      `\n⚠️ ${unknownKeys.length} of ${unknownKeys.length === 1 ? 'them is' : 'them are'} in none of`
        + ` this file's reader lists, so there is no renderer evidence behind`
        + ` ${unknownKeys.length === 1 ? 'it' : 'them'}: ${unknownKeys.map((k) => `\`${k}\``).join(' ')}.`
        + ' Those counts are still real — they are counts of authored nodes — but a "0" there'
        + ' means "nothing authors this type", not "this type does not read a child list".',
    );
  }
  console.log(`\nScanned extensions: ${scannedExtensions.join(' ')}`);
  console.log(`Skipped directories: ${skippedDirectories.join(' ')}`);
  console.log('\n#### Known limits — every other way a 0 here is not "the corpus is clean"\n');
  for (const limit of notScanned) console.log(`- \`${limit.id}\` — ${limit.what}`);
}

function main(argv = process.argv.slice(2)) {
  const arg = (name, dflt) => {
    const idx = argv.indexOf(name);
    return idx >= 0 && argv[idx + 1] ? argv[idx + 1] : dflt;
  };
  const root = arg('--root', '.');
  const label = arg('--label', root);
  const asJson = argv.includes('--json');

  const { population, filesScanned, hits } = census(root, { keys: parseKeys(argv) });
  const verdict = finalVerdict({ population, filesScanned });

  if (verdict.refusal) {
    for (const line of verdict.refusal) console.error(line);
    return verdict.exit;
  }

  if (asJson) {
    // ⭐ `population` is emitted unconditionally and has no suppressing flag.
    // The correct form is the only form: there is no spelling of this payload
    // that reports `hits` without reporting what `hits` was counted over.
    console.log(JSON.stringify({ label, root, population, filesScanned, hits }, null, 2));
    return verdict.exit;
  }

  console.log(`## \`body\` dialect census — corpus: **${label}** (root: ${root})`);
  console.log(`\nFiles scanned: ${filesScanned}. Candidate nodes: ${hits.length}.`);
  printPopulation(population);

  const inPopulation = (list) => list.filter((key) => population.keys.includes(key));
  const tables = [
    ['Group 1 — former `body`-only registrations (`body` was their ONLY child-list key)', inPopulation(BODY_ONLY)],
    ['Group 1b — ruled by #6771 but read NO child list (retirement cost it nothing)', inPopulation(RULED_BUT_NOT_A_READER)],
    ['Group 1c — former `body`-only reader outside the ruled 13 (it also DECLARED `body`; that title now belongs to `record:alert`)', inPopulation(BODY_ONLY_UNRULED)],
  ];
  for (const [title, keys] of tables) {
    if (keys.length > 0) printTable(title, group(keys, hits));
  }
  const fallback = inPopulation(FALLBACK_READERS);
  if (fallback.length > 0) {
    printTable(
      'Group 2 — `children || body` fallback readers (`body` is a second dialect, not the only door)',
      group(fallback, hits).filter((r) => r.nodes > 0),
    );
  }
  if (population.unknownKeys.length > 0) {
    printTable(
      'Group 3 — asked for by `--keys` and in none of the reader lists above (no renderer evidence)',
      group(population.unknownKeys, hits),
    );
  }

  const bodyHits = hits.filter((h) => h.body);
  console.log(`\n### Attribution of every node carrying \`body\` (${bodyHits.length})`);
  if (bodyHits.length === 0) {
    console.log('\n_None._');
  } else {
    const byBucket = new Map();
    for (const h of bodyHits) byBucket.set(h.bucket, (byBucket.get(h.bucket) ?? 0) + 1);
    console.log('\n| bucket | nodes |');
    console.log('|:--|--:|');
    for (const [b, c] of [...byBucket].sort((a, b2) => b2[1] - a[1])) console.log(`| ${b} | ${c} |`);
    console.log('\n| file:line | key | also has `children` |');
    console.log('|:--|:--|:--|');
    for (const h of bodyHits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
      console.log(`| \`${h.file}:${h.line}\` | \`${h.type}\` | ${h.children ? 'yes' : 'no'} |`);
    }
  }

  return verdict.exit;
}

// The ONE entry-guard predicate (`scripts/invoked-as.mjs`), never a hand-typed
// `process.argv[1]` comparison. This file shipped the percent-encoding spelling
// its header names: ``import.meta.url === `file://${process.argv[1]}` `` builds
// a URL WITHOUT the encoding `pathToFileURL` applies, so a checkout path
// containing a character that needs encoding — a `#` in any parent directory is
// enough, no symlink required — makes the two sides disagree, the guard answer
// false, and the census print nothing and exit 0.
//
// ⇒ That is a FOURTH silent zero on this card, in the harness around the
// scanner rather than in the scanner itself, and the same shape as the three
// the differential control caught inside it: a clean read and a tool that never
// ran are indistinguishable from the exit code alone.
if (isEntrypoint(import.meta.url)) process.exit(main());
