#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * symbol-anchors -- the SHARED core behind every "this document points at that
 * code" gate in this repo.
 *
 *   node scripts/symbol-anchors.mjs --self-test
 *
 * This module holds the grammar, the extractor and the resolution rule. It
 * sweeps nothing on its own and knows about no corpus: a corpus is a
 * `defineCorpus({...})` registration handed to `sweepCorpus`. That split is the
 * whole point of the file and it is a RULING, not a preference -- see "Why one
 * resolver" below.
 *
 * ## The failure this exists for (#13556)
 *
 * `docs/adr/**` cited positions inside source files by LINE NUMBER. A census on
 * that card enumerated every one of them -- 343 distinct anchors across 35 of
 * the 134 ADRs, plus 52 continuation anchors, a 395-anchor surface -- and
 * resolved each against `main`. Excluding 4 HISTORICAL and 2 EXTERNAL anchors,
 * **243 of 337 were broken: 72.1%**, and that figure is a ONE-WAY LOWER BOUND
 * (the census's mechanical RESOLVES test was permissive, so true rot is higher,
 * never lower).
 *
 * A rotted line anchor is worse than a missing one. It does not fail -- it
 * silently points a reader at unrelated code, inside the document whose entire
 * purpose is to be the durable record of a decision. The census's sharpest
 * reading is that rot tracks TARGET-FILE CHURN, not ADR age: anchors into files
 * of 3,000+ lines were 86.4% broken against 62.1% for smaller targets, and the
 * four hottest targets were 100% broken across 50 anchors. A line number into a
 * 16,000-line file has an expected lifetime measured in days.
 *
 * ⭐ And the rot can hide a SEMANTIC INVERSION. ADR-0113 cited
 * `sql-driver.ts:4901` for `if (field.required) col.notNullable()`; the
 * mechanism moved and now keys off `storage.notNull` -- the opposite predicate.
 * With the anchor rotted, the ADR's pre-decision Context row reads to a fresh
 * reader as a description of today. That is carded separately as #14193 and is
 * ⛔ NOT repaired by re-anchoring; re-anchoring only stops the pointer lying
 * about WHERE the mechanism is.
 *
 * ## The ruling this implements (maintainer 2026-09-01, 总监批 #27, on #13556)
 *
 * Option **A**, verbatim: 「ADR 行号锚整体迁为**符号锚 + resolver 门禁**(缺符号
 * 变红)—— 与 #13788 已裁方向同构,**共享同一个 resolver**,⛔ 不造第二套」and
 * 「**C 不作过渡**(不考虑渐进):243 个已证烂行号在 A 的一次迁移中同笔消失」.
 *
 * Two consequences that are load-bearing here:
 *
 *   1. **No transition period.** There is no "line anchors are deprecated"
 *      phase. A surviving `path:NNN` in a governed corpus is a FINDING, not a
 *      warning -- otherwise the 243 proven-rotted numbers outlive the
 *      migration that was supposed to delete them.
 *   2. **One resolver.** #13788 (1,647 platform-checklist source citations) was
 *      ruled the same shape and is serial behind #13556. It reuses THIS module
 *      by registering a corpus. ⛔ Do not fork this file for a second corpus;
 *      if a corpus needs behaviour this core lacks, widen the core.
 *
 * ## Why one resolver, mechanically
 *
 * The expensive, subtle part of an anchor gate is not the sweep -- it is the
 * RESOLUTION RULE (below), which decides what counts as a symbol really being
 * in a file. Two copies of that rule drift, and they drift SILENTLY: each gate
 * stays green on its own corpus while meaning something different by
 * "resolves". A second corpus is therefore a registration, and the resolution
 * rule has exactly one implementation and one self-test.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ## THE ANCHOR GRAMMAR (authoritative -- `ANCHOR_GRAMMAR` below is this text)
 *
 * An anchor is written inside a markdown code span. Three forms, and no others:
 *
 *     `path/to/file.ts#symbolName`     SYMBOL anchor    -- the default
 *     `path/to/file.ts`                FILE-LEVEL anchor
 *     `repo:path/to/file.ts#symbol`    CROSS-REPO anchor (e.g. `objectui:...`)
 *
 * plus a continuation form, so a sentence naming several symbols in one file
 * does not repeat the path -- it inherits the path from the anchor before it on
 * the SAME line:
 *
 *     (`packages/objectql/src/engine.ts#registerApp`, `#installPackage`)
 *
 * Rules the forms exist to satisfy:
 *
 *   (a) MECHANICALLY VERIFIABLE. `#symbol` is checked against the target file's
 *       declaration sites, so an absent symbol is a loud red.
 *   (b) SURVIVES LINE CHURN. Nothing in an anchor encodes a position, so an
 *       unrelated edit above the target cannot rot it. This is the property the
 *       343-anchor census showed line numbers do not have.
 *   (c) READS NATURALLY. `#symbol` is the fragment syntax a reader already
 *       knows from URLs, and it survives copy-paste into a GitHub link.
 *
 * ⛔ A LINE NUMBER IS NOT AN ANCHOR FORM. `file.ts:4901`, `file.ts:341-400`,
 * `file.ts:459–463` (en dash) and a bare continuation `:2933` are all findings.
 *
 * ### The one escape hatch, and who may use it
 *
 * An anchor that no in-repo resolver could ever check carries an inline marker
 * immediately after it:
 *
 *     `turso-driver.ts:764-776` <!-- anchor-exempt: HISTORICAL -->
 *
 * Two classes only:
 *
 *   HISTORICAL -- a DATED RECORD, not a live claim: the document is quoting a
 *                 position as it stood, often to annotate it as deleted or to
 *                 refute it. Re-anchoring it would falsify the record.
 *   EXTERNAL   -- the target is in a third-party repository that is not and
 *                 will not be in this tree (e.g. the Builder.io SDK).
 *
 * ⛔ MAINTAINER-ONLY. Adding an exemption is how this gate goes quiet, and it is
 * the same move as editing a shrink-only ledger: it removes a check rather than
 * satisfying it. An author whose anchor will not resolve fixes the ANCHOR --
 * name the real symbol, or drop to a file-level anchor, both of which stay
 * checked. The exemption list is for the two classes above and nothing else,
 * and growing it is a maintainer's call, never an author's route to green.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ## THE RESOLUTION RULE -- what "the symbol is in that file" means
 *
 * The census's caveat is binding and is the reason this is not `includes()`:
 * **a symbol appearing in unrelated prose is NOT resolution.** The census's own
 * permissive test is what makes 72.1% a lower bound; this gate does not repeat
 * that mistake. Comments are stripped from the target before anything is
 * matched, so a symbol named only in a comment does not resolve.
 *
 * A symbol resolves in exactly two ways, and the class is REPORTED, never
 * silently merged -- callers that want the stricter rule can demand it:
 *
 *   `declaration`  A declaration site in the target's own language. For TS/JS:
 *                  `function`/`class`/`interface`/`type`/`enum`/`namespace`
 *                  declarations, `const`/`let`/`var` bindings, a member or
 *                  object-literal key written at the start of a line (`name:`,
 *                  `'name':`, `name(`, `get name(`, `name =`), and a named
 *                  re-export (`export { name }`). For markdown, a heading whose
 *                  text or GitHub slug matches. For JSON/YAML, a key.
 *
 *   `literal`      The symbol appears as a COMPLETE quoted string token
 *                  (`'sys_metadata'`). This class exists because a large part
 *                  of this platform's vocabulary is DATA identifiers -- object
 *                  and field API names like `sys_metadata`, `crm_account`,
 *                  `state_machine` -- which are declared as strings and have no
 *                  binding site to point at. It is a whole-token match against
 *                  a string literal, never a substring of running text.
 *
 * ⚠️ `literal` is deliberately WEAKER than `declaration` and the migration
 * prefers `declaration` wherever one exists. What both classes share is the
 * property the line numbers lacked: they are checked, and they do not move.
 *
 * ### What this gate does NOT claim
 *
 * It verifies that the anchor POINTS AT SOMETHING REAL. It cannot verify that
 * the sentence around the anchor is TRUE about that code -- no static check
 * can. A sentence that is semantically wrong about today's code is a separate
 * finding and takes its own card (#14193 is the worked example).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { isEntrypoint } from './invoked-as.mjs';

/* The grammar, as a string, so a gate can print it in its own failure text
 * instead of restating it and drifting from this file. */
/* dispatch-gates: no-path-population -- this module is the shared resolution
 * core and reads NO population of its own: a corpus supplies its own roots
 * through `defineCorpus`, and each corpus gate declares them (see
 * ROOT_DIR_WATCH_HINTS in check-adr-symbol-anchors.mjs). The placeholders in
 * the grammar below are deliberately NOT path-shaped, so the derivation cannot
 * read an example as a declaration and then report it as dead. */
export const ANCHOR_GRAMMAR = [
  '`<dir>/<file>.ts#<symbol>`    symbol anchor  — `<symbol>` must have a declaration site in that file',
  '`<dir>/<file>.ts`             file-level anchor — the file must exist',
  '`objectui:<dir>/<file>.ts`    cross-repo anchor — verified only when a checkout is available',
  '`…#first`, `#second`          continuation — inherits the path from the anchor before it on the same line',
  '⛔ `<dir>/<file>.ts:4901`     A LINE NUMBER IS NOT AN ANCHOR FORM.',
].join('\n  ');

/* Extensions an anchor may name. Deliberately the same list the #13556 census
 * extracted with, so a token that census counted is a token this gate sees. */
export const ANCHORABLE_EXTENSIONS = [
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs',
  'sh', 'yaml', 'yml', 'json', 'jsonc', 'md', 'mdx',
  'sql', 'css', 'scss', 'py', 'rs', 'go', 'toml', 'prisma',
];

const EXT_ALT = ANCHORABLE_EXTENSIONS.join('|');
const PATHISH = `[A-Za-z0-9_@.\\-]+(?:/[A-Za-z0-9_@.\\-]+)*\\.(?:${EXT_ALT})`;
const SYMBOL = `[A-Za-z_$][A-Za-z0-9_$]*`;

/* A code span carrying an anchor. `repo:` prefix is optional and only ever a
 * bare word, so a Windows-style drive letter or a URL scheme cannot be read as
 * one by accident. */
const ANCHOR_SPAN = new RegExp(
  '`(?:(?<repo>[a-z][a-z0-9-]*):)?(?<path>' + PATHISH + ')(?:#(?<symbol>' + SYMBOL + '))?`',
  'g',
);
/* A continuation: a code span that is ONLY a fragment. */
const CONTINUATION_SPAN = new RegExp('`#(?<symbol>' + SYMBOL + ')`', 'g');

/* ⛔ The forms the migration deleted. Matched on the SAME text the anchor
 * extractor sees, so a line number cannot hide behind a spelling the extractor
 * normalises away. Both the full form and the bare continuation. */
/* ⭐ A LINE SPEC is not just `:123`, and assuming it was is how a gate
 * false-greens. The #13556 corpus spells one position NINE ways, and the
 * census's own extractor missed the comma forms exactly as a naive rule here
 * would:
 *
 *     :4901        :341-400      :459–463 (en dash)     :2214+
 *     :610,1028    :13,346-389   :29-39,147-152         :2956/2991
 *
 * A trailing `+` ("from here on"), a comma list and a slash list are all line
 * numbers wearing a hat; they rot identically.
 *
 * ⛔ And the scan runs over the WHOLE line, with NO code-span logic. An earlier
 * version matched only a span that was EXACTLY an anchor, and it called a
 * corpus still carrying rot clean — three ways at once: a bare anchor in
 * running prose, an anchor sharing a span with other text
 * (`` `Builder.io SDK: packages/sdks/src/types/builder-block.ts:42` ``), and
 * that slash list. A line number is rot wherever it is written; the only thing
 * excluded is a FENCED block, which is quoted material, not an anchor. */
const LINE_SPEC = '\\d+(?:\\s*[-–—]\\s*\\d+)?(?:\\s*[,/]\\s*\\d+(?:\\s*[-–—]\\s*\\d+)?)*\\+?';
const LINE_ANCHOR = new RegExp('(?<![\\w/.-])(' + PATHISH + '):(' + LINE_SPEC + ')(?![\\w-])', 'g');
const LINE_CONTINUATION = new RegExp('`\\s*[:,]\\s*(' + LINE_SPEC + ')`', 'g');

/* `// packages/foo/bar.ts:378` — a comment that is nothing but a path. */
const FENCED_HEADER = new RegExp('^\\s*(?://|#|\\*|/\\*)\\s*' + PATHISH + ':\\d');

/* ⭐ A ninth spelling, and the census counted none of them: a bare backticked
 * number, tilde-prefixed — `` ~`326` `` for "about line 326". It carries no
 * path, so it cannot be resolved to anything; ADR-0056 alone held 13.
 *
 * ⚠️ Only the TILDE form is judged. A bare `` `403` `` or `` `4096` `` is an
 * HTTP status or a byte count far more often than a line, and a gate that
 * cannot tell them apart would red on prose that is perfectly correct. The
 * tilde is what makes the reading unambiguous. Residual gap, stated rather
 * than papered over: an untilded bare number is migrated by hand but NOT
 * gated. */
const TILDE_LINE = /~\s*`(\d{2,5})`/g;

const EXEMPT_MARKER = /<!--\s*anchor-exempt:\s*(HISTORICAL|EXTERNAL)\b[^>]*-->/;
export const EXEMPT_CLASSES = ['HISTORICAL', 'EXTERNAL'];

/* ───────────────────────── target-side: declaration sites ──────────────── */

/* Comments are stripped before ANY match, so "we used to call this `foo`" in a
 * doc comment never resolves an anchor. Strings are preserved -- the `literal`
 * class needs them, and a `//` inside a string must not eat the rest of a real
 * line, so the stripper tracks string state rather than regexing blindly. */
export function stripCommentsPreservingStrings(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  let quote = null;
  while (i < n) {
    const c = source[i];
    const d = source[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += d ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; i += 1; continue; }
    if (c === '/' && d === '/') { while (i < n && source[i] !== '\n') i += 1; continue; }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) { if (source[i] === '\n') out += '\n'; i += 1; }
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* GitHub's heading slug, matching the rule `check-doc-anchors` already uses on
 * `content/docs`: lowercase, strip anything but word chars/space/hyphen, spaces
 * to hyphens. Kept local rather than pulling in the slugger, because the only
 * job here is a comparison and a dependency would make this core heavier for
 * every corpus that anchors no markdown at all. */
function slug(text) {
  return text.trim().toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');
}

function markdownSymbolClass(source, symbol) {
  const want = symbol.toLowerCase();
  const wantSlug = slug(symbol);
  for (const line of source.split('\n')) {
    const m = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = m[1].replace(/`/g, '');
    if (text.toLowerCase() === want || slug(text) === wantSlug) return 'declaration';
  }
  return null;
}

function keyedSymbolClass(source, symbol) {
  const n = escapeRe(symbol);
  /* A key may open a line (YAML, pretty JSON) or follow `{` / `,` / `[` on one
   * (minified or single-line JSON), so both positions are admitted -- and
   * nothing else is, which is what keeps a VALUE of the same spelling out. */
  const key = new RegExp(`(?:^|[{,\\[])\\s*(?:-\\s*)?["']?${n}["']?\\s*:`, 'm');
  return key.test(source) ? 'declaration' : null;
}

function scriptSymbolClass(source, symbol) {
  const code = stripCommentsPreservingStrings(source);
  const n = escapeRe(symbol);
  const declarations = [
    // function / class / interface / type / enum / namespace / module
    new RegExp(`\\b(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:function\\s*\\*?|class|interface|type|enum|namespace|module)\\s+${n}\\b`),
    // value binding
    new RegExp(`\\b(?:export\\s+)?(?:declare\\s+)?(?:const|let|var)\\s+${n}\\b`),
    // a member or object-literal key written at the start of a line
    new RegExp(`^[ \\t]*(?:readonly |static |public |private |protected |abstract |declare |async |\\* )*(?:get |set )?(?:${n}|'${n}'|"${n}"|\\[${n}\\]|\\['${n}'\\]|\\["${n}"\\])\\s*[?!]?\\s*[:(<=]`, 'm'),
    // named re-export
    new RegExp(`\\bexport\\s*\\{[^}]*\\b${n}\\b[^}]*\\}`),
    // destructured binding
    new RegExp(`\\b(?:const|let|var)\\s*\\{[^}]*\\b${n}\\b[^}]*\\}\\s*=`),
  ];
  if (declarations.some((re) => re.test(code))) return 'declaration';
  // whole-token quoted string -- the DATA-identifier class
  if (new RegExp(`(['"\`])${n}\\1`).test(code)) return 'literal';
  return null;
}

/**
 * How (and whether) `symbol` resolves inside `source`.
 * Returns 'declaration' | 'literal' | null. The class is never merged away:
 * `literal` is weaker and the caller is told so.
 */
export function symbolResolutionClass(source, filePath, symbol) {
  const ext = (filePath.split('.').pop() || '').toLowerCase();
  if (ext === 'md' || ext === 'mdx') return markdownSymbolClass(source, symbol);
  if (ext === 'json' || ext === 'jsonc' || ext === 'yml' || ext === 'yaml' || ext === 'toml') {
    return keyedSymbolClass(source, symbol);
  }
  return scriptSymbolClass(source, symbol);
}

/* ───────────────────────── document-side: extraction ───────────────────── */

/**
 * Every anchor and every surviving line anchor in one document.
 * `line` is 1-based, so a finding can be clicked.
 */
export function extractAnchors(markdown) {
  const anchors = [];
  const lineAnchors = [];
  const lines = markdown.split('\n');
  let inFence = false;
  lines.forEach((text, idx) => {
    if (/^\s*(```|~~~)/.test(text)) { inFence = !inFence; return; }
    const lineNo = idx + 1;
    /* Inside a fence, only a COMMENT HEADER naming a repo path is an anchor.
     * The corpus introduces a quoted snippet with `// packages/…/x.ts:378`,
     * and the census counted those among its 343 — so skipping fences wholesale
     * would leave five rotted anchors behind. Everything else in a fence is
     * quoted material (sample code, CI output) and is NOT judged: an example
     * that happens to contain `foo.ts:12` is not an anchor. */
    if (inFence) {
      if (!FENCED_HEADER.test(text)) return;
      for (const m of text.matchAll(LINE_ANCHOR)) {
        lineAnchors.push({ line: lineNo, index: m.index, raw: m[0], path: m[1], cited: parseInt(m[2], 10), exempt: null, fencedHeader: true });
      }
      return;
    }
    const exemptAt = [];
    for (const m of text.matchAll(/<!--\s*anchor-exempt:[^>]*-->/g)) {
      const cls = EXEMPT_MARKER.exec(m[0]);
      exemptAt.push({ index: m.index, class: cls ? cls[1] : null, raw: m[0] });
    }
    /* An exemption governs the anchor it FOLLOWS -- the nearest one to its
     * left on the same line. That keeps the marker adjacent to what it excuses
     * and stops one marker from quietly covering a whole paragraph. */
    /* Takes the END of the anchor match. Between the anchor and its marker
     * there may be the closing backtick of the span the anchor sits in, and
     * nothing more: one backtick is the span this anchor is inside, a second
     * means another code span intervenes and the marker belongs to THAT one.
     * This is what "immediately after" means, and it is why a marker cannot
     * reach across a neighbouring anchor to excuse it too. */
    const exemptionFor = (endIndex) => {
      let best = null;
      for (const e of exemptAt) {
        if (e.index >= endIndex && (best === null || e.index < best.index)) {
          const between = text.slice(endIndex, e.index);
          if ((between.match(/`/g) ?? []).length <= 1) best = e;
        }
      }
      return best;
    };
    let lastPath = null;
    for (const m of text.matchAll(ANCHOR_SPAN)) {
      const { repo, path, symbol } = m.groups;
      lastPath = path;
      anchors.push({ line: lineNo, index: m.index, raw: m[0], repo: repo ?? null, path, symbol: symbol ?? null, continuation: false });
    }
    for (const m of text.matchAll(CONTINUATION_SPAN)) {
      const before = text.slice(0, m.index);
      const prior = [...before.matchAll(ANCHOR_SPAN)].pop();
      if (!prior) continue;
      anchors.push({
        line: lineNo, index: m.index, raw: m[0],
        repo: prior.groups.repo ?? null, path: prior.groups.path,
        symbol: m.groups.symbol, continuation: true,
      });
    }
    for (const m of text.matchAll(LINE_ANCHOR)) {
      const ex = exemptionFor(m.index + m[0].length);
      lineAnchors.push({ line: lineNo, index: m.index, raw: m[0], path: m[1], cited: parseInt(m[2], 10), exempt: ex?.class ?? null, exemptRaw: ex?.raw ?? null });
    }
    for (const m of text.matchAll(TILDE_LINE)) {
      const ex = exemptionFor(m.index + m[0].length);
      lineAnchors.push({ line: lineNo, index: m.index, raw: m[0], path: lastPath, cited: parseInt(m[1], 10), exempt: ex?.class ?? null, exemptRaw: ex?.raw ?? null, tilde: true });
    }
    for (const m of text.matchAll(LINE_CONTINUATION)) {
      const ex = exemptionFor(m.index + m[0].length);
      lineAnchors.push({ line: lineNo, index: m.index, raw: m[0], path: lastPath, cited: parseInt(m[1], 10), exempt: ex?.class ?? null, exemptRaw: ex?.raw ?? null, continuation: true });
    }
  });
  return { anchors, lineAnchors };
}

/* ───────────────────────── corpus registration ─────────────────────────── */

/**
 * Register a corpus. THIS is how a second body of documents joins the gate --
 * #13788's platform-checklist citations are a `defineCorpus` call and no new
 * resolver. Everything corpus-specific is data here; everything mechanical
 * lives above and is shared.
 */
export function defineCorpus(spec) {
  const { id, label, docRoots, docPattern = /\.mdx?$/, crossRepos = {}, checkBarePaths = false } = spec;
  if (!id || !label) throw new Error('defineCorpus: `id` and `label` are required');
  if (!Array.isArray(docRoots) || docRoots.length === 0) throw new Error('defineCorpus: `docRoots` must be a non-empty array');
  return { id, label, docRoots, docPattern, crossRepos, checkBarePaths };
}

function walk(dir, pattern, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, pattern, out);
    else if (pattern.test(entry)) out.push(full);
  }
  return out;
}

/* ⚠️ KEYED BY ROOT. An earlier version cached one global set, and the effect
 * was not a slow gate but a WRONG one: a self-test that sweeps a synthetic
 * fixture first poisoned the cache, so the following sweep of the real repo saw
 * the fixture's four files and reported the entire live corpus unresolvable.
 * Any caller sweeping two roots in one process hits the same thing. */
const trackedCache = new Map();
function trackedFiles(root) {
  const key = resolve(root);
  if (!trackedCache.has(key)) {
    const out = execFileSync('git', ['ls-files'], { cwd: key, encoding: 'utf8', maxBuffer: 1 << 28 });
    trackedCache.set(key, new Set(out.split('\n').filter(Boolean)));
  }
  return trackedCache.get(key);
}

/**
 * Sweep one corpus. Returns findings and the counts a report needs.
 *
 * Finding kinds:
 *   line-anchor        a `path:NNN` survived the migration                (RED)
 *   unresolved-path    an anchor names a file that is not in the tree     (RED)
 *   unresolved-symbol  the file is there, the symbol is not               (RED)
 *   bad-exemption      an exemption marker names no valid class           (RED)
 *   cross-repo-skipped no checkout for that repo -- reported, never red
 */
export function sweepCorpus(corpus, root = process.cwd()) {
  const tracked = trackedFiles(root);
  const findings = [];
  const counts = { docs: 0, anchors: 0, symbol: 0, fileLevel: 0, declaration: 0, literal: 0, crossRepo: 0, exempt: 0, continuation: 0 };
  const sourceCache = new Map();
  const readTarget = (p) => {
    if (!sourceCache.has(p)) sourceCache.set(p, readFileSync(join(root, p), 'utf8'));
    return sourceCache.get(p);
  };

  const docs = corpus.docRoots.flatMap((r) => walk(join(root, r), corpus.docPattern)).sort();
  for (const abs of docs) {
    const rel = relative(root, abs);
    counts.docs += 1;
    const { anchors, lineAnchors } = extractAnchors(readFileSync(abs, 'utf8'));

    for (const la of lineAnchors) {
      if (la.exempt && EXEMPT_CLASSES.includes(la.exempt)) { counts.exempt += 1; continue; }
      /* A marker whose CLASS is unrecognised is its own finding, never a
       * silent pass and never an ordinary line anchor: a typo in the class
       * must not be a quiet way to switch this gate off, and it must not be
       * mistaken for someone who simply never excused the anchor. */
      findings.push({
        kind: la.exemptRaw ? 'bad-exemption' : 'line-anchor',
        doc: rel, line: la.line, raw: la.raw,
        detail: la.exemptRaw
          ? `\`${la.exemptRaw}\` names no valid exemption class — expected one of ${EXEMPT_CLASSES.join(' / ')}`
          : `a line number is not an anchor form — cite the symbol (\`${la.path ?? 'path'}#symbol\`) or drop to a file-level anchor`,
      });
    }

    for (const a of anchors) {
      counts.anchors += 1;
      if (a.continuation) counts.continuation += 1;
      if (a.repo) {
        counts.crossRepo += 1;
        const checkout = corpus.crossRepos[a.repo];
        const base = checkout && process.env[checkout.checkoutEnv];
        if (!base || !existsSync(join(base, a.path))) {
          findings.push({
            kind: 'cross-repo-skipped', doc: rel, line: a.line, raw: a.raw, soft: true,
            detail: `cross-repo target in \`${a.repo}\` — no checkout available (set $${checkout?.checkoutEnv ?? 'CHECKOUT'}), so it is reported, not judged`,
          });
          continue;
        }
        const src = readFileSync(join(base, a.path), 'utf8');
        if (a.symbol && !symbolResolutionClass(src, a.path, a.symbol)) {
          findings.push({ kind: 'unresolved-symbol', doc: rel, line: a.line, raw: a.raw, detail: `\`${a.symbol}\` has no declaration site in ${a.repo}:${a.path}` });
        }
        continue;
      }
      if (!a.symbol) {
        /* A BARE path code span. In a prose corpus this is indistinguishable
         * from an ordinary mention of a file, so whether it is judged is the
         * corpus's call, not this core's.
         *
         * ⚠️ `docs/adr/**` sets this OFF, and the reason is measured rather
         * than assumed: judging every bare path there produces 1,056 findings
         * across all 134 records — 616 distinct paths — of which only a
         * handful are anchors. They are abbreviated spellings
         * (`objectql/src/protocol.ts`), sibling-repo paths, and files that
         * moved years ago: a real defect class, but NOT the line-anchor rot
         * #13556 measured, and folding it in would bury this gate's signal
         * under a corpus-wide cleanup nobody ruled on. It is recorded as a
         * follow-up finding instead. A corpus whose citations are uniform
         * (#13788's checklist rows) can switch this on and get the check. */
        counts.fileLevel += 1;
        if (corpus.checkBarePaths && !tracked.has(a.path)) {
          findings.push({ kind: 'unresolved-path', doc: rel, line: a.line, raw: a.raw, detail: `no tracked file at \`${a.path}\`` });
        }
        continue;
      }
      if (!tracked.has(a.path)) {
        findings.push({ kind: 'unresolved-path', doc: rel, line: a.line, raw: a.raw, detail: `no tracked file at \`${a.path}\` (named by anchor \`#${a.symbol}\`)` });
        continue;
      }
      counts.symbol += 1;
      const cls = symbolResolutionClass(readTarget(a.path), a.path, a.symbol);
      if (!cls) {
        findings.push({
          kind: 'unresolved-symbol', doc: rel, line: a.line, raw: a.raw,
          detail: `\`${a.symbol}\` has no declaration site or string-literal token in \`${a.path}\``,
        });
        continue;
      }
      counts[cls] += 1;
    }
  }
  return { findings, counts };
}

export function formatFindings(findings) {
  return findings.map((f) => `  [${f.kind}] ${f.doc}:${f.line}  ${f.raw}\n      ${f.detail}`).join('\n');
}

/* ───────────────────────────────── self-test ───────────────────────────── */

function assert(cond, msg) { if (!cond) { console.error(`❌ symbol-anchors --self-test: ${msg}`); process.exit(1); } }

export function selfTest() {
  // 1. Declaration sites, one per supported spelling. Each is provoked in BOTH
  //    directions -- a rule that only ever says "found" is not a rule.
  const ts = [
    'export function registerApp(m) {}',
    'export class SqlDriver {}',
    'interface Shape { width: number }',
    'export type Verdict = "a" | "b";',
    'enum Posture { Open }',
    'const RESERVED_NAMESPACES = new Set();',
    'export { helperName };',
    'const { destructured } = thing;',
    'const schema = {',
    '  stateMachines: z.array(x),',
    "  'quoted_key': 1,",
    '  methodShorthand(a) { return a; },',
    '  get accessorName() { return 1; },',
    '};',
    'const names = ["sys_metadata"];',
  ].join('\n');
  for (const name of ['registerApp', 'SqlDriver', 'Shape', 'Verdict', 'Posture', 'RESERVED_NAMESPACES',
    'helperName', 'destructured', 'stateMachines', 'quoted_key', 'methodShorthand', 'accessorName']) {
    assert(symbolResolutionClass(ts, 'x.ts', name) === 'declaration', `"${name}" should resolve as a declaration`);
  }
  assert(symbolResolutionClass(ts, 'x.ts', 'sys_metadata') === 'literal', 'a quoted data identifier resolves as `literal`, not `declaration`');
  assert(symbolResolutionClass(ts, 'x.ts', 'notPresentAnywhere') === null, 'an absent symbol must NOT resolve');

  // 2. ⭐ The census caveat, enforced: prose is not resolution. A symbol named
  //    only in a comment is exactly the false green that made 72.1% a LOWER
  //    bound, so it is provoked directly.
  const commented = '// registerApp is described here but not defined\nconst other = 1;\n';
  assert(symbolResolutionClass(commented, 'x.ts', 'registerApp') === null, 'a symbol named only in a comment must NOT resolve');
  const blockCommented = '/* interface Shape { } */\nconst other = 1;\n';
  assert(symbolResolutionClass(blockCommented, 'x.ts', 'Shape') === null, 'a declaration inside a block comment must NOT resolve');
  // ...and the stripper must not be fooled by a `//` living inside a string.
  const slashInString = 'const url = "https://example.com";\nexport function afterTheString() {}\n';
  assert(symbolResolutionClass(slashInString, 'x.ts', 'afterTheString') === 'declaration', '`//` inside a string must not eat the rest of the file');

  // 3. Substring is not resolution -- the other half of the same caveat.
  assert(symbolResolutionClass('const registerApplication = 1;', 'x.ts', 'registerApp') === null, 'a symbol must not resolve as a substring of a longer identifier');
  assert(symbolResolutionClass('const names = ["sys_metadata_extra"];', 'x.ts', 'sys_metadata') === null, 'the `literal` class is a WHOLE-token match');

  // 4. Markdown headings and keyed formats.
  assert(symbolResolutionClass('## Overlay whitelist\n', 'a.md', 'Overlay whitelist') === 'declaration', 'a markdown heading resolves by text');
  assert(symbolResolutionClass('## Overlay whitelist\n', 'a.md', 'overlay-whitelist') === 'declaration', 'a markdown heading resolves by slug');
  assert(symbolResolutionClass('## Something else\n', 'a.md', 'overlay-whitelist') === null, 'an absent heading must NOT resolve');
  assert(symbolResolutionClass('{ "compilerOptions": { } }', 'a.json', 'compilerOptions') === 'declaration', 'a JSON key resolves');
  assert(symbolResolutionClass('{ "other": 1 }', 'a.json', 'compilerOptions') === null, 'an absent JSON key must NOT resolve');

  // 5. Extraction: every grammar form, and every ⛔ line-number spelling the
  //    census found in the corpus (plain, hyphen range, EN DASH range, and a
  //    bare continuation).
  const doc = [
    'Prose with `packages/objectql/src/engine.ts#registerApp` and `#installPackage`.',
    'A file-level anchor `packages/spec/src/data/object.zod.ts` stands alone.',
    'Cross-repo `objectui:packages/types/src/layout.ts#BaseSchema`.',
    'Rotted `packages/drivers/driver-sql/src/sql-driver.ts:4901` here.',
    'Range `packages/spec/src/kernel/manifest.zod.ts:28-76` and `docs/adr/0048-x.md:459–463`.',
    'Continuation `packages/objectql/src/engine.ts:2920`, `:2933`.',
    'Comma list `packages/objectql/src/registry.ts:13,346-389` and `packages/spec/src/api/errors.zod.ts:29-39,147-152`.',
    'Open-ended `packages/drivers/driver-sql/src/sql-driver.ts:2214+` and its continuation `:595+`.',
    'Bare in prose packages/plugins/plugin-audit/src/audit-plugin.ts:40 with no backticks at all.',
    'Slash list `packages/objectql/src/engine.ts:2956/2991` and a shared span `Builder.io SDK: packages/sdks/src/types/builder-block.ts:42`.',
    'Tilde form `packages/plugins/plugin-security/src/security-plugin.ts` ~`326` names a line with no path of its own.',
    'Exempt `packages/drivers/driver-turso/src/turso-driver.ts:764-776` <!-- anchor-exempt: HISTORICAL -->.',
    '```ts',
    '// packages/objectql/src/validation/rule-validator.ts:378',
    'a fenced `file.ts:12` must be invisible',
    '```',
  ].join('\n');
  const { anchors, lineAnchors } = extractAnchors(doc);
  const sym = anchors.filter((a) => a.symbol);
  assert(sym.length === 3, `expected 3 symbol anchors, got ${sym.length}`);
  assert(anchors.some((a) => a.continuation && a.symbol === 'installPackage' && a.path.endsWith('engine.ts')), 'a continuation must inherit the preceding path');
  assert(anchors.some((a) => a.repo === 'objectui' && a.symbol === 'BaseSchema'), 'a cross-repo anchor keeps its repo');
  assert(anchors.some((a) => !a.symbol && a.path.endsWith('object.zod.ts')), 'a file-level anchor is an anchor');
  const live = lineAnchors.filter((l) => !l.exempt);
  /* ⭐ EVERY spelling in the corpus, by name. The comma and `+` forms are here
   * because the #13556 census's own extractor missed them, and a gate that
   * inherits that blind spot reports a rotted corpus as clean. */
  const rawOf = (needle) => live.filter((l) => l.raw.includes(needle));
  assert(rawOf(':4901').length === 1, 'a plain line anchor must be found');
  assert(rawOf(':28-76').length === 1, 'a hyphen range must be found');
  assert(rawOf('459–463').length === 1, 'an EN DASH range must be found');
  assert(rawOf(':2920').length === 1, 'a continuation parent must be found');
  assert(rawOf(':2933').length === 1, 'a bare continuation must be found');
  assert(rawOf(':13,346-389').length === 1, 'a COMMA list must be found');
  assert(rawOf(':29-39,147-152').length === 1, 'a comma list of RANGES must be found');
  assert(rawOf(':2214+').length === 1, 'an open-ended `+` anchor must be found');
  assert(rawOf(':595+').length === 1, 'an open-ended `+` continuation must be found');
  assert(rawOf('audit-plugin.ts:40').length === 1, 'a BARE, un-spanned line anchor in prose must be found');
  assert(rawOf(':2956/2991').length === 1, 'a SLASH list must be found');
  assert(rawOf('builder-block.ts:42').length === 1, 'an anchor SHARING a code span with other text must be found');
  assert(rawOf('~`326`').length === 1, 'the TILDE bare-number form must be found');
  assert(extractAnchors('a status `403` and a size `4096` on a `packages/x/y.ts#sym` line').lineAnchors.length === 0,
    'an UNTILDED bare number must NOT be read as a line anchor — it is an HTTP status or a byte count far more often than a line');
  assert(live.length === 14, `expected 14 live line anchors across every spelling, got ${live.length}: ${live.map((l) => l.raw).join(' ')}`);
  assert(lineAnchors.some((l) => l.exempt === 'HISTORICAL'), 'the exemption marker must be read');
  assert(!lineAnchors.some((l) => l.raw.includes('file.ts:12')), 'ordinary fenced content must stay invisible to the extractor');
  assert(rawOf('rule-validator.ts:378').length === 1, 'a fenced COMMENT HEADER naming a path IS an anchor and must be found');

  // 6. An exemption governs the anchor it FOLLOWS and does not spill leftwards
  //    onto an earlier, unexcused one.
  const spill = 'First `a/b.ts:10` then `c/d.ts:20` <!-- anchor-exempt: HISTORICAL -->';
  const spilled = extractAnchors(spill).lineAnchors;
  assert(spilled.find((l) => l.raw.includes('a/b.ts'))?.exempt === null, 'an exemption must not cover an earlier anchor');
  assert(spilled.find((l) => l.raw.includes('c/d.ts'))?.exempt === 'HISTORICAL', 'an exemption must cover the anchor it follows');

  // 7. An invalid exemption class is a finding, not a silent pass -- otherwise
  //    a typo is a way to switch the gate off.
  const bogus = extractAnchors('`a/b.ts:10` <!-- anchor-exempt: BECAUSE-I-SAID-SO -->').lineAnchors;
  assert(bogus[0].exempt === null, 'an unrecognised exemption class must not be honoured');
  assert(bogus[0].exemptRaw !== null, 'an unrecognised exemption must still be CARRIED, so it reports as a bad exemption rather than as a plain line anchor');

  // 8. defineCorpus refuses a corpus that would sweep nothing.
  let threw = false;
  try { defineCorpus({ id: 'x', label: 'x', docRoots: [] }); } catch { threw = true; }
  assert(threw, 'defineCorpus must refuse an empty docRoots');

  console.log('✅ symbol-anchors --self-test: grammar, both resolution classes, comment/substring rejection, every ⛔ line-number spelling, exemption scoping and corpus registration verified');
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  else {
    console.log('symbol-anchors is a library. Anchor grammar:\n  ' + ANCHOR_GRAMMAR);
    console.log('\nRun a corpus gate (e.g. `node scripts/check-adr-symbol-anchors.mjs`) or `--self-test`.');
  }
}
