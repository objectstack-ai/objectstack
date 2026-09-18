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
 * `packages/drivers/driver-sql/src/sql-driver.ts` (line 4901 as the ADR wrote
 * it -- a dated reading, ⛔ not a pointer) for `if (field.required)
 * col.notNullable()`; the
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
 *     `<dir>/<file>.ts#<symbol>`       SYMBOL anchor    -- the default
 *     `<dir>/<file>.ts`                FILE-LEVEL anchor
 *     `<repo>:<dir>/<file>.ts#<sym>`   CROSS-REPO anchor (e.g. `objectui:...`)
 *
 * ⚠️ Those placeholders are deliberately NOT path-shaped, and that is the same
 * discipline the `dispatch-gates: no-path-population` note further down states
 * for `ANCHOR_GRAMMAR`: an illustration written as a real-looking path is read
 * by a resolver as an anchor, and then reported as pointing at a file this tree
 * does not have. A gate header that teaches the grammar must not fail it.
 *
 * plus a continuation form, so a sentence naming several symbols in one file
 * does not repeat the path -- it inherits the path from the anchor before it on
 * the SAME line. This module's own exports, so the example is itself checked:
 *
 *     (`scripts/symbol-anchors.mjs#extractAnchors`, `#defineCorpus`)
 *
 * ### Three corpus-declared variations on the SAME three forms (#18107, #18592)
 *
 * None changes what an anchor means; all three are DELIMITER and POPULATION
 * declarations a corpus makes about its own documents, defaulted OFF so a
 * corpus that says nothing reads exactly the text it read before.
 *
 *   `unspannedAnchors: true`  The anchor is written WITHOUT a code span. A code
 *       span is a markdown device, and a corpus whose documents are DATA cannot
 *       write one -- inside a JSON string value a backtick is payload. The
 *       platform checklist is the measured case: 634 anchors under its own
 *       forked detector against 8 under the spanned grammar. Unspanned, the
 *       path must carry a DIRECTORY and the left boundary refuses an
 *       identifier character, `@`, `-` or `/`, which is what keeps an issue
 *       reference, a JSON-pointer fragment and a scoped package specifier out.
 *
 *   `excludeDirs: ['runs']`   A directory NAME the walker does not descend into,
 *       at any depth. A corpus is a body of AUTHORED documents; the checklist's
 *       `runs/` holds OUTPUTS, and holding a past run record to today's
 *       authoring rules would make the rule unfixable. `docPattern` is a regex
 *       on the BASENAME and cannot see a directory, so this shape had no
 *       spelling before -- which is precisely why that corpus stayed forked.
 *
 *   `pathlessLineCitations: true`  The two LINE CITATIONS that carry no path of
 *       their own are judged: a bare colon continuation written without a code
 *       span (`id :140 and version :202`) and an `L` pin (`~L7246-7331`), both
 *       continuing a filename named earlier in the same sentence. This is the
 *       LAST half of the checklist's fork (#18592); the symbol half left at
 *       #18107. ⛔ Default OFF is a measurement: in PROSE a colon before digits
 *       is punctuation, and turning these on corpus-wide would fire 245 times
 *       across the prose corpora, essentially all false positives.
 *
 * ⭐ A dotted `#Outer.member` is also part of the grammar, and `sweepCorpus`
 * requires EVERY segment to resolve. Admitting it was additive: a dotted symbol
 * could not be written inside a code span at all before, so nothing that
 * resolved can stop resolving.
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
 * ⛔ A LINE NUMBER IS NOT AN ANCHOR FORM. `<file>.ts:4901`, `<file>.ts:341-400`,
 * `<file>.ts:459–463` (en dash), `<file>.tsx:~605-615` (the approximation
 * tilde) and a bare continuation -- a backticked `:` followed by a line spec,
 * `2933` -- are all findings, and so are the two PATH-LESS spellings a corpus
 * declaring `pathlessLineCitations` admits. ⚠️ The angle brackets are
 * deliberate: this file is itself inside the `scripts/**` corpus, so an
 * illustration written path-shaped would be a citation of its own.
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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { gitFreeEnv } from './git-env.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import { blank, scanSource } from './js-comment-mask.mjs';

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
 * extracted with, so a token that census counted is a token this gate sees.
 *
 * ⭐ `html` joined it when the platform checklist's forked LINE-CITATION
 * grammar was folded in (#18592). That fork's own vocabulary was not a subset
 * of this one: it carried `html` where this list did not, so a citation into a
 * template or a fixture page was a citation ONE of the two graders could read.
 * Widening here is the exit the checklist gate's own header already prescribed
 * -- widen the shared vocabulary, ⛔ never re-fork a private extension set --
 * and it was measured additive before it landed: across all five registered
 * corpora, ZERO `.html` tokens are read as an anchor or as a line citation
 * today, so nothing that passed can start failing on this row alone.
 *
 * ⚠️ One hazard stated rather than discovered: `.html` is the extension that
 * appears in an ordinary external URL more than any other, and a corpus
 * declaring `unspannedAnchors` reads a path-shaped token out of running text.
 * That class is not new -- a `<host>/<path>.md#<frag>` URL has always been
 * readable as an anchor by the same rule -- and this row extends it rather
 * than opening it. */
export const ANCHORABLE_EXTENSIONS = [
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs',
  'sh', 'yaml', 'yml', 'json', 'jsonc', 'md', 'mdx',
  'sql', 'css', 'scss', 'py', 'rs', 'go', 'toml', 'prisma', 'html',
];

const EXT_ALT = ANCHORABLE_EXTENSIONS.join('|');
const PATHISH = `[A-Za-z0-9_@.\\-]+(?:/[A-Za-z0-9_@.\\-]+)*\\.(?:${EXT_ALT})`;
/* A path that CARRIES A SLASH. Only the unspanned form needs it: inside a code
 * span the backticks are the boundary, but unspanned a bare `<file>.ts#<symbol>`
 * in running text is indistinguishable from prose, so the directory half is
 * what makes the token an anchor. ⚠️ That placeholder spelling is the same
 * `dispatch-gates: no-path-population` discipline the grammar block above
 * states: this file is inside the `scripts/**` corpus, so an illustration
 * written path-shaped is a citation of its own and reds this module's own
 * gate. */
/* ⚠️ And its FIRST character may not be `@`. `PATHISH` admits one because a
 * spanned anchor's backticks already bound the token; unspanned, an `@`-opened
 * first segment is a scoped PACKAGE SPECIFIER — an npm import, never a path in
 * this tree — and reading one as an anchor reports a module as a missing file.
 * The left-boundary lookbehind cannot do this half: at the very start of a line
 * there is no preceding character for it to refuse. */
const DIR_PATHISH = `[A-Za-z0-9_.\\-][A-Za-z0-9_@.\\-]*(?:/[A-Za-z0-9_@.\\-]+)+\\.(?:${EXT_ALT})`;
/* ⭐ DOTTED SEGMENTS are part of the symbol, and every segment is resolved
 * (`sweepCorpus` splits on the dot and requires each). `Foo.bar` naming a
 * member that was dropped is the same rot as `Foo` being dropped, and passing
 * the anchor because its head survived is fail-open one level down.
 *
 * ⚠️ Widening this was ADDITIVE and was measured as such before it landed: a
 * dotted symbol could not be written inside a code span at all before (the span
 * has to close right after the symbol, and the dot ended the match), so nothing
 * that resolved before can stop resolving. Measured on the tree this landed
 * against: 0 new anchors across all three corpora registered at the time
 * (`docs/adr/**` 139 files, `scripts/**` 261 files through `commentProse`, and
 * the system-context page). The corpus that needs it is the platform checklist,
 * whose own forked grammar carried dotted symbols before it was registered. */
const SYMBOL = `[A-Za-z_$][A-Za-z0-9_$]*(?:\\.[A-Za-z_$][A-Za-z0-9_$]*)*`;

/* A code span carrying an anchor. `repo:` prefix is optional and only ever a
 * bare word, so a Windows-style drive letter or a URL scheme cannot be read as
 * one by accident. */
const ANCHOR_SPAN = new RegExp(
  '`(?:(?<repo>[a-z][a-z0-9-]*):)?(?<path>' + PATHISH + ')(?:#(?<symbol>' + SYMBOL + '))?`',
  'g',
);
/* A continuation: a code span that is ONLY a fragment. */
const CONTINUATION_SPAN = new RegExp('`#(?<symbol>' + SYMBOL + ')`', 'g');

/* ⭐ THE UNSPANNED ANCHOR, and it is OPT-IN per corpus (`unspannedAnchors`).
 *
 * A code span is a MARKDOWN device. A corpus whose documents are DATA — the
 * platform checklist's `areas/*.json`, where every citation lives inside a JSON
 * string value — cannot write one: a backtick there is a literal character in
 * the payload, not a span. Measured on that corpus before it was registered:
 * its own forked detector found 634 anchors where the spanned grammar found 8,
 * and that 626-anchor gap is the whole reason the corpus stayed forked.
 *
 * ⛔ So this is NOT a loosening of what an anchor MEANS — the path, the `#` and
 * the symbol are the same three parts, resolved by the same rule. It is the
 * DELIMITER being made a corpus's declaration instead of a hard assumption, and
 * a corpus that does not declare it is byte-for-byte unaffected.
 *
 * ⚠️ Unspanned, the left boundary is the whole safety margin, and it is the one
 * the checklist's forked detector had already proved out against a ledger dense
 * with `#`-shaped text that is not an anchor: an issue reference (`#13788`,
 * `objectui#2563`), a JSON-pointer fragment (`schema.json#/$defs/x`), a
 * scoped package specifier (an `@`-prefixed `<scope>/<dir>/<file>.ts#<symbol>`)
 * and a hyphenated word carrying a tail (`release-15.1#B2`) — every one of them
 * pinned by name in the registered corpus's own self-test. The path half
 * therefore requires a DIRECTORY, and the lookbehind refuses a preceding
 * identifier character, `@`, `-` or `/`.
 *
 * The `repo:` prefix is carried here too, because it is one of the three forms
 * the grammar declares and leaving it out would not make a cross-repo citation
 * invisible — it would make it read as a LOCAL path, which is the fabrication
 * direction: a target in another repository reported as a missing file in this
 * one. A URL scheme cannot be mistaken for it, since a path may not open with a
 * slash. */
const UNSPANNED_ANCHOR = new RegExp(
  '(?<![A-Za-z0-9_$@\\-/])(?:(?<repo>[a-z][a-z0-9-]*):)?(?<path>' + DIR_PATHISH + ')#(?<symbol>' + SYMBOL + ')',
  'g',
);

/* ⛔ The forms the migration deleted. Matched on the SAME text the anchor
 * extractor sees, so a line number cannot hide behind a spelling the extractor
 * normalises away. Both the full form and the bare continuation. */
/* ⭐ A LINE SPEC is not just a colon and one run of digits, and assuming it was
 * is how a gate false-greens. The #13556 corpus spells one position NINE ways,
 * and the census's own extractor missed the comma forms exactly as a naive rule
 * here would:
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
 * (`` `Builder.io SDK: <dir>/<file>.ts:42` ``), and
 * that slash list. A line number is rot wherever it is written; the only thing
 * excluded is a FENCED block, which is quoted material, not an anchor. */
const LINE_SPEC = '\\d+(?:\\s*[-–—]\\s*\\d+)?(?:\\s*[,/]\\s*\\d+(?:\\s*[-–—]\\s*\\d+)?)*\\+?';
/* ⭐ A TENTH spelling, folded in from the checklist's private grammar (#18592):
 * the approximation tilde written INSIDE the colon form, `<file>.tsx:~605-615`
 * for "about line 605". It is the same rot wearing the same hat as the
 * open-ended `<file>.ts:NNN+` form -- an author hedging a number does not make
 * the number survive an edit -- and
 * the two graders disagreed about it, which is the drift the fold closes.
 *
 * ⛔ The tilde is the ONLY thing admitted here, and ⛔ no whitespace with it: a
 * `:` followed by a SPACE and then digits is ordinary prose punctuation
 * (`**Date**: 2026-04-19`, `exit contract: 1`), and admitting it was measured
 * to fire 26 times across `docs/adr/**` alone, every one a false positive. */
const LINE_ANCHOR = new RegExp('(?<![\\w/.-])(' + PATHISH + '):~?(' + LINE_SPEC + ')(?![\\w-])', 'g');
const LINE_CONTINUATION = new RegExp('`\\s*[:,]\\s*(' + LINE_SPEC + ')`', 'g');

/* `// <dir>/<file>.ts:378` — a comment that is nothing but a path. */
const FENCED_HEADER = new RegExp('^\\s*(?://|#|\\*|/\\*)\\s*' + PATHISH + ':\\d');

/* ⭐ A ninth spelling, and the census counted none of them: a bare backticked
 * number, tilde-prefixed — a `~` then a backticked line number, `` ~`NNN` ``,
 * written for "about line 326". It carries no
 * path, so it cannot be resolved to anything; ADR-0056 alone held 13.
 *
 * ⚠️ Only the TILDE form is judged. A bare `` `403` `` or `` `4096` `` is an
 * HTTP status or a byte count far more often than a line, and a gate that
 * cannot tell them apart would red on prose that is perfectly correct. The
 * tilde is what makes the reading unambiguous. Residual gap, stated rather
 * than papered over: an untilded bare number is migrated by hand but NOT
 * gated. */
const TILDE_LINE = /~\s*`(\d{2,5})`/g;

/* ⭐ THE PATH-LESS LINE CITATION, and it is OPT-IN per corpus
 * (`pathlessLineCitations`). Folded in from the platform checklist's private
 * grammar (#18592), which is the LAST half of that fork -- the symbol-anchor
 * half became a registration at #18107 and this one stayed behind.
 *
 * Two spellings, and neither carries a path of its own:
 *
 *     `ManifestSchema id :140 and version :202`   bare colon continuation
 *     `registerRecordShareEndpoints ~L7246-7331`  the `L` line pin
 *
 * Both continue a filename named EARLIER in the same sentence, which is how a
 * data ledger writes a second pointer into a file it has already named. The
 * bare half is the worse half of the class the #13556 migration deleted: it
 * carries no path at all, only a number, so nothing can even report WHICH file
 * rotted out from under it.
 *
 * ⛔ DEFAULT OFF, and that is a MEASUREMENT, not caution. Turned on for every
 * corpus, these two would fire 222 and 23 times respectively across
 * `docs/adr/**`, `scripts/**` and `packages/spec/src/**` -- a dev-server port
 * written as a parenthesised colon-port, a two-character scenario label, a
 * docblock pointing back at a line of its own -- essentially all of them false
 * positives, because in PROSE a
 * colon before digits is punctuation. In this checklist's DATA, where every
 * citation lives inside a JSON string value beside the filename it continues,
 * it is a line pin. Which of the two a corpus is, is the corpus's declaration
 * to make -- exactly as `unspannedAnchors` is.
 *
 * ⚠️ The numeric shape here is deliberately TIGHTER than `LINE_SPEC`: a plain
 * run of digits with one optional hyphen range, no comma list, no slash list,
 * no trailing `+` and ⛔ no internal whitespace. With a path in front of it a
 * line spec is unambiguous and can afford the long form; with nothing in front
 * of it the left boundary is the entire safety margin, and the forked grammar
 * had already proved this exact shape out against a ledger dense with the
 * neighbours it must refuse -- an HTTP status (`status:409`), a config literal
 * (`{maxRetries:3}`), a URL port (`localhost:3000`), a clock time (`08:00`)
 * and JSON quoted in prose (`{"scannedTypes":1}`) -- every one of them pinned
 * by name in the self-test below.
 *
 * ⚠️ The `L` form needs a left boundary of its own so an identifier ending in
 * a capital L before digits (`SQL2019`, `TTL3600`) is not read as a line pin,
 * and a TWO-DIGIT floor so a lane label (`L1`) and an i18n token (`L10n`) are
 * not either. */
const PATHLESS_LINE_SPEC = '\\d+(?:-\\d+)?';
const PATHLESS_COLON_CITATION = new RegExp('(?<![A-Za-z0-9_"]):~?(' + PATHLESS_LINE_SPEC + ')', 'g');
const PATHLESS_L_CITATION = new RegExp('(?<![A-Za-z0-9_])~?L(\\d{2,}(?:-\\d+)?)(?![A-Za-z0-9_])', 'g');

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
    /* A member or object-literal key written at the start of a line.
     *
     * ⚠️ The modifier alternation below is HAND-ENUMERATED, and it has been
     * demonstrated INCOMPLETE once (#16821): `override` was absent, so a
     * symbol anchor naming any `override` member -- a dated reading: 276 of
     * them under packages/ when this was measured, 207 of those the
     * `static override` metadata on CLI command classes -- returned
     * `unresolved-symbol` for a declaration that was really there. The gate's
     * own remedy text ("name the real symbol, or drop to a file-level
     * anchor") then left an author only the WEAKER anchor, because the real
     * symbol was already named correctly.
     *
     * ⭐ And the shape being refused was the one the anchor rule exists for:
     * an `override` member is where a subclass restates a base contract, so
     * it is exactly where a citation most needs to be checkable. The failure
     * was loud per author and silent in aggregate -- the corpus censuses read
     * like coverage while being structurally unable to contain an `override`
     * member.
     *
     * ⇒ Widening this list is ADDITIVE: it makes a real declaration resolve
     * and refuses nothing that resolved before. But this list is the SHARED
     * one -- every registered corpus resolves through it -- so a widening
     * moves every census in the same stroke, and a PR that widens it re-takes
     * them all and says what moved.
     *
     * ⛔ Whether this set should be DERIVED rather than enumerated is a live
     * question about this resolver and is NOT settled here. It is a
     * maintainer's call, because the ruling this module implements is that a
     * corpus joins by REGISTRATION and there is to be no second
     * implementation -- so a rewrite of the rule is a change to every corpus
     * at once, not a local cleanup.
     *
     * ⛔ The alternation stays a free-order `*` group on purpose. TS fixes the
     * written order (accessibility, `static`, `override`, `readonly`,
     * `abstract`), but pinning that order here would refuse a spelling for
     * being unidiomatic rather than for being ABSENT, and judging style is not
     * this rule's job. */
    new RegExp(`^[ \\t]*(?:readonly |static |public |private |protected |override |abstract |declare |async |\\* )*(?:get |set )?(?:${n}|'${n}'|"${n}"|\\[${n}\\]|\\['${n}'\\]|\\["${n}"\\])\\s*[?!]?\\s*[:(<=]`, 'm'),
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

/**
 * Which DOT-SEPARATED SEGMENTS of an anchor's symbol do not resolve.
 *
 * ⛔ THIS IS NOT A SECOND RULE. Every segment is put to
 * `symbolResolutionClass` above and nothing here decides what "present" means;
 * the split is the GRAMMAR's (a dotted symbol is a sequence of names), which is
 * why it lives beside the grammar instead of in a corpus gate.
 *
 * Every segment must be present: `Foo.bar` naming a member that was dropped is
 * the same rot as `Foo` being dropped, and reporting the anchor as present
 * because its head survived is the fail-open one level down.
 *
 * @param {string} source raw target text
 * @param {string} filePath repo-relative path of the cited file
 * @param {string} symbol the anchor's symbol, dots allowed
 * @returns {{absent: string[], class: 'declaration'|'literal'|null}} `class` is
 *   the WEAKEST class across the segments, so a dotted anchor resting on one
 *   `literal` segment is not reported as a `declaration`.
 */
export function symbolSegmentResolution(source, filePath, symbol) {
  const absent = [];
  let weakest = 'declaration';
  for (const seg of symbol.split('.')) {
    const cls = symbolResolutionClass(source, filePath, seg);
    if (!cls) absent.push(seg);
    else if (cls === 'literal') weakest = 'literal';
  }
  return { absent, class: absent.length ? null : weakest };
}

/* ───────────────────────── document-side: extraction ───────────────────── */

/**
 * Every anchor and every surviving line anchor in one document.
 * `line` is 1-based, so a finding can be clicked.
 *
 * @param {string} markdown the document text (already projected, if the corpus
 *   declares a `docProjection`)
 * @param {{unspannedAnchors?: boolean, pathlessLineCitations?: boolean}} [options]
 *   `unspannedAnchors` admits the UNSPANNED form beside the spanned one, for a
 *   corpus whose documents are data rather than markdown.
 *   `pathlessLineCitations` admits the two line citations that carry no path of
 *   their own -- the bare `:NNN` continuation and the `L` pin -- for a corpus
 *   that writes a second pointer into a file it has already named.
 *   ⛔ Both default OFF: a prose corpus that never opted in reads exactly the
 *   text it read before.
 */
export function extractAnchors(markdown, options = {}) {
  const { unspannedAnchors = false, pathlessLineCitations = false } = options;
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
     * that happens to contain `<file>.ts:12` is not an anchor. */
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
    const spannedRanges = [];
    for (const m of text.matchAll(ANCHOR_SPAN)) {
      const { repo, path, symbol } = m.groups;
      lastPath = path;
      spannedRanges.push([m.index, m.index + m[0].length]);
      anchors.push({ line: lineNo, index: m.index, raw: m[0], repo: repo ?? null, path, symbol: symbol ?? null, continuation: false, unspanned: false });
    }
    /* The unspanned pass runs over the SAME text, so an anchor that is already
     * inside a code span would be found twice — once with its backticks and
     * once without. It is ONE citation either way, and counting it twice would
     * inflate a corpus's floor by however many of its anchors happen to be
     * spanned. Overlap with a span already recorded is therefore dropped, which
     * also keeps the spanned reading (the one that carries `repo`) as the
     * authoritative record of that occurrence. */
    if (unspannedAnchors) {
      for (const m of text.matchAll(UNSPANNED_ANCHOR)) {
        const start = m.index;
        const end = start + m[0].length;
        if (spannedRanges.some(([s, e]) => start < e && end > s)) continue;
        const { repo, path, symbol } = m.groups;
        lastPath = path;
        anchors.push({ line: lineNo, index: start, raw: m[0], repo: repo ?? null, path, symbol, continuation: false, unspanned: true });
      }
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
    /* The spans every line citation recorded on this line occupies. The
     * path-less pass below runs over the SAME text and its two spellings are
     * SUFFIXES of forms already recorded here -- a backticked continuation
     * ENDS in the bare colon form the pass below looks for -- so without this
     * it would report ONE citation twice, and
     * a corpus counting citations would read the duplicate as a second defect.
     * Same reasoning, and same remedy, as the unspanned anchor pass above. */
    const lineAnchorRanges = [];
    const pushLineAnchor = (entry, length) => {
      lineAnchorRanges.push([entry.index, entry.index + length]);
      lineAnchors.push(entry);
    };
    for (const m of text.matchAll(LINE_ANCHOR)) {
      const ex = exemptionFor(m.index + m[0].length);
      pushLineAnchor({ line: lineNo, index: m.index, raw: m[0], path: m[1], cited: parseInt(m[2], 10), exempt: ex?.class ?? null, exemptRaw: ex?.raw ?? null }, m[0].length);
    }
    for (const m of text.matchAll(TILDE_LINE)) {
      const ex = exemptionFor(m.index + m[0].length);
      pushLineAnchor({ line: lineNo, index: m.index, raw: m[0], path: lastPath, cited: parseInt(m[1], 10), exempt: ex?.class ?? null, exemptRaw: ex?.raw ?? null, tilde: true }, m[0].length);
    }
    for (const m of text.matchAll(LINE_CONTINUATION)) {
      const ex = exemptionFor(m.index + m[0].length);
      pushLineAnchor({ line: lineNo, index: m.index, raw: m[0], path: lastPath, cited: parseInt(m[1], 10), exempt: ex?.class ?? null, exemptRaw: ex?.raw ?? null, continuation: true }, m[0].length);
    }
    if (pathlessLineCitations) {
      const alreadyRecorded = (start, end) => lineAnchorRanges.some(([s, e]) => start < e && end > s);
      /* The bare colon form IS a continuation -- it continues the filename
       * named before it -- so it is REPORTED as one, and `declinedShape` names
       * it by how it was written rather than by the path it borrowed. */
      for (const m of text.matchAll(PATHLESS_COLON_CITATION)) {
        if (alreadyRecorded(m.index, m.index + m[0].length)) continue;
        const ex = exemptionFor(m.index + m[0].length);
        pushLineAnchor({ line: lineNo, index: m.index, raw: m[0], path: lastPath, cited: parseInt(m[1], 10), exempt: ex?.class ?? null, exemptRaw: ex?.raw ?? null, continuation: true, pathless: true }, m[0].length);
      }
      for (const m of text.matchAll(PATHLESS_L_CITATION)) {
        if (alreadyRecorded(m.index, m.index + m[0].length)) continue;
        const ex = exemptionFor(m.index + m[0].length);
        pushLineAnchor({ line: lineNo, index: m.index, raw: m[0], path: lastPath, cited: parseInt(m[1], 10), exempt: ex?.class ?? null, exemptRaw: ex?.raw ?? null, pathless: true }, m[0].length);
      }
    }
  });
  return { anchors, lineAnchors };
}

/* ──────────────────── document-side: the doc PROJECTION ────────────────── */

/**
 * The COMMENT PROSE of a JavaScript-shaped source, with every other character
 * blanked to a space and every newline kept -- so a finding's LINE NUMBER is
 * still the line number in the real file.
 *
 * ## Why a corpus needs this at all (#15765, measured)
 *
 * `extractAnchors` is line-based and knows nothing about syntax: hand it a
 * `.mjs` file and it reads comment prose EXACTLY as it reads a paragraph of an
 * ADR -- that half needed no change and the self-test pins it per comment form.
 * What it also reads is the CODE, and that is the half that made a raw `.mjs`
 * corpus unusable. Measured over the 216 tracked `scripts/**` `.mjs` files on
 * `5315098df`: 251 live line citations raw against 128 through this projection.
 * The 123 that vanish are not rot -- they are a gate's own self-test FIXTURES,
 * string literals like `'<file>.ts:2'` and `'<dir>/<file>.mdx:1'` written to
 * provoke that gate's own line-reporting. Judging those would red a gate for
 * testing itself, which is the fabrication direction
 * `scripts/js-comment-mask.mjs` exists to close.
 *
 * So the separator is the shared one, never a private stripper: this asks
 * `scripts/js-comment-mask.mjs#scanSource` the same question every other
 * source-scanning gate asks it, and projects the answer the other way round
 * from `scripts/js-comment-mask.mjs#maskComments` -- that one keeps the code
 * and blanks the prose; a doc corpus wants the prose and blanks the code.
 *
 * ⚠️ BLANK, NEVER DELETE, and it is `scripts/js-comment-mask.mjs#blank` that
 * guarantees it: a projection that dropped the code lines would report every
 * finding against a line number that does not exist in the file the author
 * opens.
 */
export function commentProse(source) {
  const { comment } = scanSource(source);
  const code = new Uint8Array(comment.length);
  for (let i = 0; i < comment.length; i += 1) code[i] = comment[i] ? 0 : 1;
  return blank(source, code);
}

/* ───────────────────────── corpus registration ─────────────────────────── */

/**
 * Register a corpus. THIS is how a second body of documents joins the gate --
 * #13788's platform-checklist citations are a `defineCorpus` call and no new
 * resolver. Everything corpus-specific is data here; everything mechanical
 * lives above and is shared.
 */
export function defineCorpus(spec) {
  const {
    id, label, docRoots, docPattern = /\.mdx?$/, crossRepos = {}, checkBarePaths = false,
    docProjection = null, judgeUntrackedLineAnchors = true, excludeDirs = [],
    unspannedAnchors = false, pathlessLineCitations = false,
  } = spec;
  if (!id || !label) throw new Error('defineCorpus: `id` and `label` are required');
  if (!Array.isArray(docRoots) || docRoots.length === 0) throw new Error('defineCorpus: `docRoots` must be a non-empty array');
  /* A projection that is present but not callable would be silently skipped by
   * an `if (corpus.docProjection)` guard, and the corpus would sweep raw source
   * while its registration reads as though it did not. Refused loudly instead. */
  if (docProjection !== null && typeof docProjection !== 'function') {
    throw new Error('defineCorpus: `docProjection` must be a function or null');
  }
  /* ⛔ The same refusal, for the same reason: an `excludeDirs` that is not an
   * array of names is an exclusion that silently does not happen, and a corpus
   * would then sweep a subtree its registration says it does not. A directory
   * name carrying a separator is refused too — this matches a NAME at any
   * depth, and a caller who writes `runs/2026` would otherwise get an
   * exclusion that matches nothing and reads as though it matched. */
  if (!Array.isArray(excludeDirs) || excludeDirs.some((d) => typeof d !== 'string' || d === '' || d.includes('/'))) {
    throw new Error('defineCorpus: `excludeDirs` must be an array of plain directory NAMES (no separators)');
  }
  return {
    id, label, docRoots, docPattern, crossRepos, checkBarePaths, docProjection,
    judgeUntrackedLineAnchors, excludeDirs, unspannedAnchors, pathlessLineCitations,
  };
}

/**
 * The corpus walker.
 *
 * ## Why an exclusion belongs here (#18107)
 *
 * A corpus is a body of AUTHORED documents, and a directory tree does not
 * always hold only those. The platform checklist is the measured case: its
 * family is `docs/qa/platform-checklist/**` MINUS `runs/`, because a run record
 * is an OUTPUT — written by a runner against whatever the ledger said at the
 * time — and holding a past record to today's authoring rules would make the
 * rule unfixable. That shape could not be said through `docRoots` or
 * `docPattern` (a regex on the basename, which cannot see the directory), and
 * the corpus therefore stayed forked with a private walker of its own.
 *
 * ⭐ The ruling this module implements names that exit directly: 「if a corpus
 * needs behaviour this core lacks, **widen the core**」. Excluding is a
 * DECLARATION of population, never a softening of the grammar — everything the
 * walker does reach is judged by exactly the same rule as before.
 *
 * Matching is on the directory NAME at any depth, which is what the corpus's
 * own walker did before it was registered; `defineCorpus` refuses a name
 * carrying a separator rather than let a path-shaped entry match nothing.
 */
function walk(dir, pattern, out = [], excludeDirs = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (excludeDirs.includes(entry)) continue;
      walk(full, pattern, out, excludeDirs);
    } else if (pattern.test(entry)) out.push(full);
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
    /* ⛔ THE ENVIRONMENT IS EXPLICIT, and passing none is what made this a
     * measured incident rather than a hypothetical (#16624). Git exports
     * `GIT_DIR` / `GIT_WORK_TREE` / `GIT_INDEX_FILE` into every child it runs,
     * and those OUTRANK `cwd`: a caller sweeping a SYNTHETIC root from inside a
     * hook -- which is where `pre-commit` runs the gates built on this resolver
     * -- would have this line answer with THE REAL REPOSITORY's file list while
     * `key` names a temp directory. Silently: the sweep resolves against the
     * wrong tree and reports findings, or none, about a corpus nobody swept.
     *
     * The sibling half of the same incident was a WRITE: an inheriting
     * `git add -A` staged 8,190 paths as deleted in the real index and an
     * inheriting `git init` wrote `core.bare = true` into the SHARED
     * `.git/config`, breaking every worktree on the machine. This resolver only
     * ever reads, so its exposure is the wrong answer rather than the damage --
     * but the fix is one rule for both, and it lives in `scripts/git-env.mjs`.
     *
     * ⚠️ `gitFreeEnv()` is correct HERE because `ls-files` needs nothing from
     * the ambient environment but the repository `cwd` names. ⛔ It must not be
     * copied onto a git child that fetches or pushes -- see that module. */
    const out = execFileSync('git', ['ls-files'], { cwd: key, encoding: 'utf8', maxBuffer: 1 << 28, env: gitFreeEnv() });
    trackedCache.set(key, new Set(out.split('\n').filter(Boolean)));
  }
  return trackedCache.get(key);
}

/**
 * The SHAPE of a declined citation -- why no resolver could bind it. Kept here
 * rather than in a corpus so every corpus that waives citations reports the
 * same four words, and a residual list can be grouped without re-deriving the
 * classification from the raw text.
 *
 * Order is load-bearing: a continuation, a tilde form and a path-less citation
 * ALL inherit whatever path preceded them on the line, so they must be named by
 * how they were written, never by the path they borrowed.
 */
export function declinedShape(la) {
  if (la.tilde) return 'tilde';
  if (la.continuation) return 'continuation';
  if (la.pathless) return 'pathless';
  if (la.path?.includes('/')) return 'directory-qualified';
  return 'bare-filename';
}

/**
 * Sweep one corpus. Returns findings, the counts a report needs, the citations
 * a corpus declined to judge (`declined`, empty unless the corpus sets
 * `judgeUntrackedLineAnchors: false`) and `byDoc` — the same count object per
 * swept document, which is what a corpus holding a PER-FILE floor ratchets.
 *
 * Finding kinds:
 *   line-anchor        a `path:NNN` survived the migration                (RED)
 *   unresolved-path    an anchor names a file that is not in the tree     (RED)
 *   unresolved-symbol  the file is there, the symbol is not               (RED)
 *   bad-exemption      an exemption marker names no valid class           (RED)
 *   cross-repo-skipped no checkout for that repo -- reported, never red
 *
 * An `unresolved-symbol` and an `unresolved-path` also carry `path`, `symbol`
 * and (for the former) the `absent` segments, so a corpus can key a ledger of
 * its own on the anchor rather than re-parsing the rendered `raw` text.
 */
export function sweepCorpus(corpus, root = process.cwd()) {
  const tracked = trackedFiles(root);
  const findings = [];
  const declined = [];
  const counts = { docs: 0, anchors: 0, symbol: 0, fileLevel: 0, declaration: 0, literal: 0, crossRepo: 0, exempt: 0, continuation: 0, unresolvableLineCitation: 0 };
  /* ── PER-DOCUMENT counts, beside the corpus-wide ones ─────────────────────
   * A corpus that ratchets its anchor population cannot do it on a total: a
   * total stays put while one file is emptied and another grows, which is
   * exactly the dodge a shrink-never floor exists to close. `byDoc` is the same
   * count object per document, and the corpus-wide `counts` is their sum — so
   * the two can never disagree about what was swept. */
  const byDoc = new Map();
  const sourceCache = new Map();
  const readTarget = (p) => {
    if (!sourceCache.has(p)) sourceCache.set(p, readFileSync(join(root, p), 'utf8'));
    return sourceCache.get(p);
  };

  const docs = corpus.docRoots
    .flatMap((r) => walk(join(root, r), corpus.docPattern, [], corpus.excludeDirs ?? []))
    .sort();
  for (const abs of docs) {
    const rel = relative(root, abs);
    counts.docs += 1;
    const docCounts = { anchors: 0, symbol: 0, fileLevel: 0, declaration: 0, literal: 0, crossRepo: 0, exempt: 0, continuation: 0, unresolvableLineCitation: 0 };
    byDoc.set(rel, docCounts);
    /* ⛔ ONE call site per counter, so a count can never move on the total
     * while standing still per document. Every `counts.x += 1` below became a
     * `bump('x')`; a new counter that forgets this is a counter the floor
     * cannot see. */
    const bump = (key) => { counts[key] += 1; docCounts[key] += 1; };
    const rawDoc = readFileSync(abs, 'utf8');
    const { anchors, lineAnchors } = extractAnchors(
      corpus.docProjection ? corpus.docProjection(rawDoc) : rawDoc,
      {
        unspannedAnchors: corpus.unspannedAnchors ?? false,
        pathlessLineCitations: corpus.pathlessLineCitations ?? false,
      },
    );

    for (const la of lineAnchors) {
      if (la.exempt && EXEMPT_CLASSES.includes(la.exempt)) { bump('exempt'); continue; }
      /* A corpus may decline to judge a citation that names NO FILE IN THIS
       * TREE, and `docs/adr/**` leaves this ON while a `scripts/**` gate-header
       * corpus turns it OFF. That is the same call `checkBarePaths` makes one
       * paragraph down, on the same evidence shape, and it is a SCOPE
       * declaration, never a softening of the grammar: a citation this gate
       * cannot resolve either way is one it cannot tell an author how to fix,
       * and a gate whose only remedy is "stop writing that" is the
       * permanently-red gate this repo retired.
       *
       * Measured on `scripts/symbol-anchors.mjs` over `scripts/**` `.mjs`
       * comment prose, on the date recorded in `check-scripts-symbol-anchors`'s
       * own census constant: 128 live citations in all, of which 32 named a
       * tracked file and 96 did not -- bare filenames (an abbreviation inside a
       * census table that no resolver can bind to one of this tree's several
       * files of that name), continuations inheriting no path of their own,
       * directory-qualified paths that are illustrations or sibling-repo files,
       * and one tilde form. That population is a real defect class and was
       * recorded as a follow-up (#15809), exactly as the 1,056 bare paths under
       * `checkBarePaths` were -- but it is not the cross-file rot #15765
       * measured, and folding it in would bury this gate's signal under a
       * cleanup nobody ruled on.
       *
       * ⭐ Declining to JUDGE is not declining to SEE. Every declined citation
       * is counted AND recorded in `declined`, so a corpus can enumerate what
       * it waived (`--list-unresolvable`) and the residual stays a list rather
       * than a number nobody can act on. */
      if (!corpus.judgeUntrackedLineAnchors && !tracked.has(la.path ?? '')) {
        bump('unresolvableLineCitation');
        declined.push({ doc: rel, line: la.line, raw: la.raw, path: la.path ?? null, shape: declinedShape(la) });
        continue;
      }
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
      bump('anchors');
      if (a.continuation) bump('continuation');
      if (a.repo) {
        bump('crossRepo');
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
        if (a.symbol) {
          const { absent } = symbolSegmentResolution(src, a.path, a.symbol);
          if (absent.length) {
            findings.push({
              kind: 'unresolved-symbol', doc: rel, line: a.line, raw: a.raw,
              path: a.path, symbol: a.symbol, repo: a.repo, absent,
              detail: `${absent.map((s) => `\`${s}\``).join(' and ')} ${absent.length > 1 ? 'have' : 'has'} no declaration site in ${a.repo}:${a.path}`,
            });
          }
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
        bump('fileLevel');
        if (corpus.checkBarePaths && !tracked.has(a.path)) {
          findings.push({ kind: 'unresolved-path', doc: rel, line: a.line, raw: a.raw, detail: `no tracked file at \`${a.path}\`` });
        }
        continue;
      }
      if (!tracked.has(a.path)) {
        findings.push({
          kind: 'unresolved-path', doc: rel, line: a.line, raw: a.raw,
          path: a.path, symbol: a.symbol,
          detail: `no tracked file at \`${a.path}\` (named by anchor \`#${a.symbol}\`)`,
        });
        continue;
      }
      bump('symbol');
      const { absent, class: cls } = symbolSegmentResolution(readTarget(a.path), a.path, a.symbol);
      if (!cls) {
        findings.push({
          kind: 'unresolved-symbol', doc: rel, line: a.line, raw: a.raw,
          path: a.path, symbol: a.symbol, absent,
          detail: `${absent.map((s) => `\`${s}\``).join(' and ')} ${absent.length > 1 ? 'have' : 'has'} no declaration site or string-literal token in \`${a.path}\``,
        });
        continue;
      }
      bump(cls);
    }
  }
  /* Corpus-wide only, and deliberately NOT in `byDoc`: it counts DISTINCT
   * cited target files, and a distinct count does not sum across documents. */
  counts.citedSources = sourceCache.size;
  return { findings, counts, declined, byDoc };
}

export function formatFindings(findings) {
  return findings.map((f) => `  [${f.kind}] ${f.doc}:${f.line}  ${f.raw}\n      ${f.detail}`).join('\n');
}

/* ───────────────────────────────── self-test ───────────────────────────── */

function assert(cond, msg) { if (!cond) { console.error(`❌ symbol-anchors --self-test: ${msg}`); process.exit(1); } }

// ── The self-test's own battery roster and floor (#13489) ──────────────────
//
// A module-level `assert()` that exits on the first failure used to be this
// self-test's ONLY success condition, so "every case held" and "the cases
// never ran" printed the same line. Closed the way PR #13487 validated on
// check-doc-authoring: what is pinned is the registered NAMES, not a
// number. The floor requires the OPENED set to equal the DECLARED set with
// each battery at or above its own count.
//
// This file declares ONE battery, opened at the top of the self-test body. It
// carries fewer than the two named section banners the sectioning criterion
// needs, and ⛔ a comment is NOT promoted to a section head — that is a
// judgement per comment this transplant does not make. The hoisted single
// battery is the shape PR #14896, PR #15003 and PR #15217 landed for exactly
// this case.
//
// ⛔ A pinned TOTAL is not the repair: a battery dropping from 9 cases to 3
// keeps a total "right" the moment a sibling grows.
//
// The count is a FLOOR, not an equality — adding cases is ordinary work and must
// not red. A battery BELOW its floor means cases stopped running; the remedy is
// to find what stopped registering.
// 63 → 67 when `declinedShape` gained a case per arm (#15809).
// 67 → 69 when the sweep's git child gained an explicit environment (#16624).
// 69 → 93 when the member-modifier spellings gained a case EACH, every one of
//         them paired with its own negative control, after `override` was found
//         missing from the hand-enumerated accept set (#16821).
// 93 → 122 when the core was widened so the platform checklist could join by
//          REGISTRATION instead of staying forked (#18107): the unspanned
//          anchor form and every `#`-shaped neighbour it must refuse, the
//          dotted symbol segments, and `excludeDirs` driven in both directions
//          on one fixture. Each option carries its DEFAULT-OFF control, which
//          is the case that says an already-registered corpus did not move.
// 122 → 149 when the LAST half of that same fork was folded in (#18592): the
//           path-less line citation as a third corpus declaration, the
//           approximation tilde inside the colon form and `html` in the shared
//           vocabulary. The 19 cases that pinned the checklist's private
//           line-citation grammar moved here — every spelling it caught and
//           every colon-then-digit neighbour it refused — and the de-duplication
//           pair, the inheritance pair and the default-off control joined them.
const SELF_TEST_BATTERIES = Object.freeze({
  'symbol-anchors self-test': 149,
});

// DELETING an entry silences that battery's floor exactly as effectively as
// zeroing it, so the roster's own size is pinned too.
const SELF_TEST_BATTERY_FLOOR = 1;

// The key an assertion is filed under when no battery is open. It is not a
// declared battery, so it reds by the same set difference rather than silently
// inflating whichever battery happened to run last.
const UNATTRIBUTED_BATTERY = '(no battery open)';

// Returned by `selfTest()` only after its verdict is printed. The dispatch
// refuses anything else: a `return` that leaves the function above that line
// prints nothing and still exits 0 — a self-test that never finished, reported
// as one that passed (#13798).
const SELF_TEST_VERDICT = 'symbol-anchors self-test reached its verdict';

export function selfTest() {
  // The battery ledger this self-test's floor is evaluated against (#13489).
  // `battery()` opens a battery; every assertion below is attributed to the one
  // most recently opened, so a section that stops running stops registering and
  // names ITSELF at the floor rather than going quiet.
  const batterySeen = new Map();
  let openBattery = null;
  const battery = (name) => {
    openBattery = name;
  };
  const registerCase = () => {
    const b = openBattery ?? UNATTRIBUTED_BATTERY;
    batterySeen.set(b, (batterySeen.get(b) ?? 0) + 1);
  };
  battery('symbol-anchors self-test');
  // A thin in-body wrapper over the module-level `assert`: it attributes the
  // case to the open battery and then defers to the existing assertion, whose
  // semantics (print and exit 1 on the first failure) are unchanged.
  const check = (cond, message) => {
    registerCase();
    assert(cond, message);
  };
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
    check(symbolResolutionClass(ts, 'x.ts', name) === 'declaration', `"${name}" should resolve as a declaration`);
  }
  check(symbolResolutionClass(ts, 'x.ts', 'sys_metadata') === 'literal', 'a quoted data identifier resolves as `literal`, not `declaration`');
  check(symbolResolutionClass(ts, 'x.ts', 'notPresentAnywhere') === null, 'an absent symbol must NOT resolve');

  // 1b. ⭐ MEMBER MODIFIERS, one case per spelling, each with its own control.
  //     The modifier alternation in `scriptSymbolClass` is hand-enumerated and
  //     has been demonstrated incomplete once (#16821: `override` was missing,
  //     so no `override` member in the tree could carry a symbol anchor and the
  //     only remedy on offer was a weaker anchor). ⛔ One token per finding is
  //     NOT the repair -- an enumeration is worth exactly what it is provoked
  //     with, so every spelling is driven by name here rather than trusted to
  //     the one that happened to be reported.
  //     ⭐ The negative control rides the SAME source as each positive row: a
  //     matcher that answered `declaration` to everything would satisfy every
  //     row above and this battery would never be able to fail.
  const memberSpellings = [
    ['plain', 'initObjects(o) {}'],
    ['async', 'async initObjects(o) {}'],
    ['public async', 'public async initObjects(o) {}'],
    ['protected async', 'protected async initObjects(o) {}'],
    ['private', 'private initObjects(o) {}'],
    ['override', 'override initObjects(o) {}'],
    ['override async', 'override async initObjects(o) {}'],
    ['protected override async', 'protected override async initObjects(o) {}'],
    ['public override', 'public override initObjects(o) {}'],
    ['static override', 'static override initObjects(o) {}'],
    ['override get', 'override get initObjects() { return 1; }'],
    ['override readonly property', 'override readonly initObjects: number = 1;'],
  ];
  for (const [spelling, member] of memberSpellings) {
    const cls = `class Subclass extends Base {\n  ${member}\n}\n`;
    check(symbolResolutionClass(cls, 'x.ts', 'initObjects') === 'declaration',
      `a member declared \`${spelling}\` must resolve as a declaration`);
    check(symbolResolutionClass(cls, 'x.ts', 'notPresentAnywhere') === null,
      `CONTROL: an absent name must NOT resolve against a \`${spelling}\` member`);
  }

  // 2. ⭐ The census caveat, enforced: prose is not resolution. A symbol named
  //    only in a comment is exactly the false green that made 72.1% a LOWER
  //    bound, so it is provoked directly.
  const commented = '// registerApp is described here but not defined\nconst other = 1;\n';
  check(symbolResolutionClass(commented, 'x.ts', 'registerApp') === null, 'a symbol named only in a comment must NOT resolve');
  const blockCommented = '/* interface Shape { } */\nconst other = 1;\n';
  check(symbolResolutionClass(blockCommented, 'x.ts', 'Shape') === null, 'a declaration inside a block comment must NOT resolve');
  // ...and the stripper must not be fooled by a `//` living inside a string.
  const slashInString = 'const url = "https://example.com";\nexport function afterTheString() {}\n';
  check(symbolResolutionClass(slashInString, 'x.ts', 'afterTheString') === 'declaration', '`//` inside a string must not eat the rest of the file');

  // 3. Substring is not resolution -- the other half of the same caveat.
  check(symbolResolutionClass('const registerApplication = 1;', 'x.ts', 'registerApp') === null, 'a symbol must not resolve as a substring of a longer identifier');
  check(symbolResolutionClass('const names = ["sys_metadata_extra"];', 'x.ts', 'sys_metadata') === null, 'the `literal` class is a WHOLE-token match');

  // 4. Markdown headings and keyed formats.
  check(symbolResolutionClass('## Overlay whitelist\n', 'a.md', 'Overlay whitelist') === 'declaration', 'a markdown heading resolves by text');
  check(symbolResolutionClass('## Overlay whitelist\n', 'a.md', 'overlay-whitelist') === 'declaration', 'a markdown heading resolves by slug');
  check(symbolResolutionClass('## Something else\n', 'a.md', 'overlay-whitelist') === null, 'an absent heading must NOT resolve');
  check(symbolResolutionClass('{ "compilerOptions": { } }', 'a.json', 'compilerOptions') === 'declaration', 'a JSON key resolves');
  check(symbolResolutionClass('{ "other": 1 }', 'a.json', 'compilerOptions') === null, 'an absent JSON key must NOT resolve');

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
  check(sym.length === 3, `expected 3 symbol anchors, got ${sym.length}`);
  check(anchors.some((a) => a.continuation && a.symbol === 'installPackage' && a.path.endsWith('engine.ts')), 'a continuation must inherit the preceding path');
  check(anchors.some((a) => a.repo === 'objectui' && a.symbol === 'BaseSchema'), 'a cross-repo anchor keeps its repo');
  check(anchors.some((a) => !a.symbol && a.path.endsWith('object.zod.ts')), 'a file-level anchor is an anchor');
  const live = lineAnchors.filter((l) => !l.exempt);
  /* ⭐ EVERY spelling in the corpus, by name. The comma and `+` forms are here
   * because the #13556 census's own extractor missed them, and a gate that
   * inherits that blind spot reports a rotted corpus as clean. */
  const rawOf = (needle) => live.filter((l) => l.raw.includes(needle));
  check(rawOf(':4901').length === 1, 'a plain line anchor must be found');
  check(rawOf(':28-76').length === 1, 'a hyphen range must be found');
  check(rawOf('459–463').length === 1, 'an EN DASH range must be found');
  check(rawOf(':2920').length === 1, 'a continuation parent must be found');
  check(rawOf(':2933').length === 1, 'a bare continuation must be found');
  check(rawOf(':13,346-389').length === 1, 'a COMMA list must be found');
  check(rawOf(':29-39,147-152').length === 1, 'a comma list of RANGES must be found');
  check(rawOf(':2214+').length === 1, 'an open-ended `+` anchor must be found');
  check(rawOf(':595+').length === 1, 'an open-ended `+` continuation must be found');
  check(rawOf('audit-plugin.ts:40').length === 1, 'a BARE, un-spanned line anchor in prose must be found');
  check(rawOf(':2956/2991').length === 1, 'a SLASH list must be found');
  check(rawOf('builder-block.ts:42').length === 1, 'an anchor SHARING a code span with other text must be found');
  check(rawOf('~`326`').length === 1, 'the TILDE bare-number form must be found');
  check(extractAnchors('a status `403` and a size `4096` on a `packages/x/y.ts#sym` line').lineAnchors.length === 0,
    'an UNTILDED bare number must NOT be read as a line anchor — it is an HTTP status or a byte count far more often than a line');
  check(live.length === 14, `expected 14 live line anchors across every spelling, got ${live.length}: ${live.map((l) => l.raw).join(' ')}`);
  check(lineAnchors.some((l) => l.exempt === 'HISTORICAL'), 'the exemption marker must be read');
  check(!lineAnchors.some((l) => l.raw.includes('file.ts:12')), 'ordinary fenced content must stay invisible to the extractor');
  check(rawOf('rule-validator.ts:378').length === 1, 'a fenced COMMENT HEADER naming a path IS an anchor and must be found');

  // 6. An exemption governs the anchor it FOLLOWS and does not spill leftwards
  //    onto an earlier, unexcused one.
  const spill = 'First `a/b.ts:10` then `c/d.ts:20` <!-- anchor-exempt: HISTORICAL -->';
  const spilled = extractAnchors(spill).lineAnchors;
  check(spilled.find((l) => l.raw.includes('a/b.ts'))?.exempt === null, 'an exemption must not cover an earlier anchor');
  check(spilled.find((l) => l.raw.includes('c/d.ts'))?.exempt === 'HISTORICAL', 'an exemption must cover the anchor it follows');

  // 7. An invalid exemption class is a finding, not a silent pass -- otherwise
  //    a typo is a way to switch the gate off.
  const bogus = extractAnchors('`a/b.ts:10` <!-- anchor-exempt: BECAUSE-I-SAID-SO -->').lineAnchors;
  check(bogus[0].exempt === null, 'an unrecognised exemption class must not be honoured');
  check(bogus[0].exemptRaw !== null, 'an unrecognised exemption must still be CARRIED, so it reports as a bad exemption rather than as a plain line anchor');

  // 8. defineCorpus refuses a corpus that would sweep nothing.
  let threw = false;
  try { defineCorpus({ id: 'x', label: 'x', docRoots: [] }); } catch { threw = true; }
  check(threw, 'defineCorpus must refuse an empty docRoots');

  // 9. ⭐ The doc PROJECTION (#15765). A `.mjs` corpus hands `extractAnchors`
  //    comment prose and nothing else, so each comment FORM is provoked by
  //    name, and the negative -- a citation living in a STRING LITERAL, which
  //    is a gate's own test fixture and not a doc citation -- is provoked
  //    beside them. A projection that kept the code would red a gate for
  //    testing itself; one that dropped the code lines would report every
  //    finding against a line number the author cannot open.
  const mjs = [
    'import { x } from "y";',                                   // 1  code
    '// A line comment cites packages/a/line.ts:11 here.',      // 2  `//`
    '/* A block comment cites packages/a/block.ts:22 here. */', // 3  `/* */`
    '/**',                                                      // 4  docblock
    ' * A docblock cites packages/a/doc.ts:33 and anchors',     // 5
    ' * `packages/a/doc.ts#realThing` properly.',               // 6
    ' */',                                                      // 7
    "const fixture = 'packages/a/string.ts:44';",               // 8  ⛔ negative
    'const tpl = `packages/a/template.ts:55`;',                 // 9  ⛔ negative
  ].join('\n');
  const projected = commentProse(mjs);
  const pj = extractAnchors(projected);
  const pjRaw = pj.lineAnchors.map((l) => l.raw).join(' ');
  check(pj.lineAnchors.some((l) => l.raw === 'packages/a/line.ts:11'), `a citation in a \`//\` comment must be read, got: ${pjRaw}`);
  check(pj.lineAnchors.some((l) => l.raw === 'packages/a/block.ts:22'), `a citation in a \`/* */\` block comment must be read, got: ${pjRaw}`);
  check(pj.lineAnchors.some((l) => l.raw === 'packages/a/doc.ts:33'), `a citation in a docblock must be read, got: ${pjRaw}`);
  check(pj.anchors.some((a) => a.symbol === 'realThing' && a.path === 'packages/a/doc.ts'), 'a SYMBOL anchor written in a comment must be extracted, not only the rot');
  // ⛔ The negatives, one per literal form. A gate's fixtures are code.
  check(!pj.lineAnchors.some((l) => l.raw.includes('string.ts')), `a citation inside a STRING LITERAL is not a doc citation, got: ${pjRaw}`);
  check(!pj.lineAnchors.some((l) => l.raw.includes('template.ts')), `a citation inside a TEMPLATE literal is not a doc citation, got: ${pjRaw}`);
  // ...and the raw source proves the projection is what makes the difference:
  // without it the extractor reads the fixtures too, which is the whole reason
  // a `.mjs` corpus needs one.
  const unprojected = extractAnchors(mjs).lineAnchors.map((l) => l.raw);
  check(unprojected.some((r) => r.includes('string.ts')) && unprojected.some((r) => r.includes('template.ts')),
    'without the projection the extractor DOES read string fixtures — the control that makes the two negatives above mean something');
  // LINE NUMBERS SURVIVE. Blanking, not deleting: the docblock citation is on
  // source line 5 and must be reported there.
  check(pj.lineAnchors.find((l) => l.raw === 'packages/a/doc.ts:33')?.line === 5,
    'the projection must preserve line numbers — a finding is reported against the line the author opens');
  check(projected.split('\n').length === mjs.split('\n').length, 'the projection must preserve the line COUNT');

  // 10. The corpus knobs the projection comes with.
  check(defineCorpus({ id: 'x', label: 'x', docRoots: ['a'] }).judgeUntrackedLineAnchors === true,
    'judging every line citation is the DEFAULT — an existing corpus must not be narrowed by adding this option');
  check(defineCorpus({ id: 'x', label: 'x', docRoots: ['a'] }).docProjection === null, 'no projection is the default');
  let projThrew = false;
  try { defineCorpus({ id: 'x', label: 'x', docRoots: ['a'], docProjection: 'commentProse' }); } catch { projThrew = true; }
  check(projThrew, 'defineCorpus must refuse a docProjection that is not callable — a skipped projection sweeps raw source while reading as though it did not');

  // 11. ⭐ The declined SHAPE, whose ordering is the whole rule (#15809): a
  //     continuation and a tilde form inherit whatever path preceded them on
  //     the line, so classifying by the path first would file them under the
  //     borrowed path and a residual list would name a file the author never
  //     wrote. All four arms, in one case each.
  check(declinedShape({ tilde: true, path: 'a/b.ts' }) === 'tilde',
    'a tilde form is a TILDE even when a path preceded it on the line — it borrowed that path, it did not cite it');
  check(declinedShape({ continuation: true, path: 'a/b.ts' }) === 'continuation',
    'a continuation is a CONTINUATION even when a path preceded it on the line');
  check(declinedShape({ path: 'a/b.ts' }) === 'directory-qualified', 'a path with a slash is directory-qualified');
  check(declinedShape({ path: 'b.ts' }) === 'bare-filename', 'a path with no slash is a bare filename — the shape no resolver can bind');

  // 11b. ⭐ THE UNSPANNED ANCHOR (#18107). Every row is driven in BOTH
  //      directions against the SAME text, because the whole risk of dropping
  //      the code span is over-firing: unspanned, the only thing separating an
  //      anchor from ordinary prose is the left boundary and the required
  //      directory. The DEFAULT-OFF control is the first case, and it is the
  //      one that says an existing prose corpus reads what it always read.
  const unspannedDoc = 'the refusal lives at packages/core/src/x.ts#parseEmails today';
  check(extractAnchors(unspannedDoc).anchors.length === 0,
    'DEFAULT: an unspanned anchor is NOT read — a corpus that never declared `unspannedAnchors` reads exactly the text it read before');
  const un = (s) => extractAnchors(s, { unspannedAnchors: true }).anchors;
  const unspanned = un(unspannedDoc);
  check(unspanned.length === 1 && unspanned[0].path === 'packages/core/src/x.ts'
    && unspanned[0].symbol === 'parseEmails' && unspanned[0].unspanned === true,
  `OPT-IN: an unspanned anchor is read, split into path and symbol, and marked unspanned — got ${JSON.stringify(unspanned)}`);
  check(un('(packages/rest/src/rest-server.ts#buildRouter).')[0]?.symbol === 'buildRouter',
    'trailing punctuation is not part of an unspanned symbol');
  check(un('a/b/x.ts#alpha + a/b/y.tsx#beta').length === 2, 'two unspanned anchors on one line are both found');
  check(un('p/q/f.mjs#sym').length === 1 && un('p/q/f.json#sym').length === 1,
    'the unspanned form reads the SHARED extension vocabulary, not a set of its own');
  // ⛔ The negatives — every `#`-shaped neighbour a data ledger is full of.
  check(un('the objectui#2563 regression').length === 0, 'a cross-repo ISSUE reference is not an unspanned anchor');
  check(un('closed by #13786 and #13482').length === 0, 'a bare issue reference is not an unspanned anchor');
  check(un('https://example.com/schema.json#/$defs/Item').length === 0, 'a JSON-pointer URL fragment is not an unspanned anchor');
  check(un('ADR-0025 §3.3, ADR-0090 D4').length === 0, 'an ADR section reference is not an unspanned anchor');
  check(un('release-15.1#B2').length === 0, 'an anchor-shaped tail on a hyphenated word with no slash is not an unspanned anchor');
  check(un('@objectstack/spec/src/x.ts#Y').length === 0, 'a scoped package specifier is not an unspanned anchor — the `@` is refused by the left boundary');
  check(un('a bare filename x.ts#sym carries no directory').length === 0,
    'an unspanned anchor REQUIRES a directory — a bare filename unspanned is prose');
  check(un('packages/objectql/src/search-filter.ts (each latin term ORs)').length === 0,
    'a BARE citation with no `#` is not an anchor');
  // The repo prefix survives unspanned, so a sibling-repo target is not
  // reported as a missing file in THIS tree.
  const unRepo = un('see objectui:packages/types/src/layout.ts#BaseSchema for the shape');
  check(unRepo.length === 1 && unRepo[0].repo === 'objectui' && unRepo[0].path === 'packages/types/src/layout.ts',
    `an unspanned CROSS-REPO anchor keeps its repo — got ${JSON.stringify(unRepo)}`);
  // ⭐ DE-DUPLICATION. With the option on, a SPANNED anchor must still be ONE
  // occurrence: counting it twice would inflate by however many of a corpus's
  // anchors happen to be spanned, and a per-file floor reads that as growth.
  const mixed = un('spanned `packages/a/b.ts#one` and unspanned packages/a/c.ts#two');
  check(mixed.length === 2 && mixed.filter((a) => a.unspanned).length === 1,
    `a spanned anchor must not be counted a second time by the unspanned pass — got ${JSON.stringify(mixed.map((a) => [a.path, a.unspanned]))}`);

  // 11c. ⭐ DOTTED SYMBOL SEGMENTS, and the additive control beside them.
  const dotted = un('packages/spec/src/data/object.zod.ts#ObjectSchema.shape');
  check(dotted.length === 1 && dotted[0].symbol === 'ObjectSchema.shape',
    `a dotted anchor keeps BOTH segments — got ${JSON.stringify(dotted.map((a) => a.symbol))}`);
  const dottedSpan = extractAnchors('a span `packages/a/b.ts#Outer.member` here').anchors;
  check(dottedSpan.length === 1 && dottedSpan[0].symbol === 'Outer.member',
    `a dotted symbol inside a code span is read too — got ${JSON.stringify(dottedSpan.map((a) => a.symbol))}`);
  const segSrc = ['export const PolicyShape = {', "  mode: 'strict',", '};'].join('\n');
  check(symbolSegmentResolution(segSrc, 'x.ts', 'PolicyShape.mode').absent.length === 0,
    'both segments of a live dotted anchor resolve');
  check(symbolSegmentResolution(segSrc, 'x.ts', 'PolicyShape.strictness').absent.join(',') === 'strictness',
    'a dotted anchor whose SECOND segment is gone names that segment — ⛔ it is not passed on the first');
  check(symbolSegmentResolution(segSrc, 'x.ts', 'Missing.mode').absent.join(',') === 'Missing',
    'a dotted anchor whose FIRST segment is gone names that segment');
  check(symbolSegmentResolution(segSrc, 'x.ts', 'PolicyShape').class === 'declaration',
    'an undotted symbol still reports its class');
  check(symbolSegmentResolution("const names = ['sys_metadata'];", 'x.ts', 'sys_metadata').class === 'literal',
    'the WEAKEST class is what a segmented anchor reports — a `literal` is never promoted to `declaration`');

  // 11d. ⭐ `excludeDirs`, BOTH DIRECTIONS on ONE fixture (#18107). A sweeper
  //      that reached neither subtree would satisfy the exclusion half alone,
  //      so the included subtree is swept in the same call and must still
  //      resolve — that control is what makes the exclusion a reading.
  const exclDir = mkdtempSync(join(tmpdir(), 'symbol-anchors-excl-'));
  let exclKept = null;
  let exclAll = null;
  let exclThrew = false;
  try {
    mkdirSync(join(exclDir, 'docs/areas'), { recursive: true });
    mkdirSync(join(exclDir, 'docs/runs'), { recursive: true });
    mkdirSync(join(exclDir, 'pkg'), { recursive: true });
    writeFileSync(join(exclDir, 'pkg', 'a.ts'), 'export function handler() { return 1; }\n');
    /* ⭐ THE SAME ANCHOR TEXT in both subtrees, so the only variable is WHERE
     * it lives. The symbol is deliberately one that does NOT resolve, because
     * an excluded file must produce no finding while an included one must. */
    const judged = 'the read lives at `pkg/a.ts#goneFromThisFile`.\n';
    writeFileSync(join(exclDir, 'docs/areas', 'kept.md'), judged);
    writeFileSync(join(exclDir, 'docs/runs', 'record.md'), judged);
    execFileSync('git', ['init', '-q'], { cwd: exclDir, env: gitFreeEnv() });
    execFileSync('git', ['add', '-A'], { cwd: exclDir, env: gitFreeEnv() });
    exclKept = sweepCorpus(defineCorpus({ id: 'excl', label: 'excl', docRoots: ['docs'], excludeDirs: ['runs'] }), exclDir);
    exclAll = sweepCorpus(defineCorpus({ id: 'all', label: 'all', docRoots: ['docs'] }), exclDir);
  } finally {
    rmSync(exclDir, { recursive: true, force: true });
  }
  check(exclKept?.counts.docs === 1 && [...exclKept.byDoc.keys()].join(',') === join('docs', 'areas', 'kept.md'),
    `\`excludeDirs\` must keep the walker out of that subtree — swept ${JSON.stringify([...(exclKept?.byDoc.keys() ?? [])])}`);
  check(exclKept?.findings.filter((f) => f.doc.includes('runs')).length === 0,
    'an excluded document must produce NO finding — its anchors are not judged at all');
  check(exclKept?.findings.filter((f) => f.kind === 'unresolved-symbol').length === 1,
    `CONTROL: the INCLUDED subtree is still swept by the same call — got ${JSON.stringify(exclKept?.findings.map((f) => f.kind))}`);
  check(exclAll?.counts.docs === 2 && exclAll.findings.filter((f) => f.kind === 'unresolved-symbol').length === 2,
    `CONTROL: with no \`excludeDirs\` the SAME sweeper reaches both — got ${exclAll?.counts.docs} doc(s), ${exclAll?.findings.length} finding(s)`);
  check(exclKept?.byDoc instanceof Map && exclKept.byDoc.get(join('docs', 'areas', 'kept.md'))?.anchors === 1,
    'the per-document counts are returned beside the corpus-wide ones');
  try { defineCorpus({ id: 'x', label: 'x', docRoots: ['a'], excludeDirs: ['runs/2026'] }); } catch { exclThrew = true; }
  check(exclThrew, 'defineCorpus must refuse an `excludeDirs` entry carrying a separator — it would match nothing while reading as though it matched');
  check(defineCorpus({ id: 'x', label: 'x', docRoots: ['a'] }).excludeDirs.length === 0
    && defineCorpus({ id: 'x', label: 'x', docRoots: ['a'] }).unspannedAnchors === false
    && defineCorpus({ id: 'x', label: 'x', docRoots: ['a'] }).pathlessLineCitations === false,
  'excluding nothing, requiring a code span and requiring a path are the DEFAULTS — an existing corpus must not be moved by adding any of the three options');

  // 11e. ⭐ THE PATH-LESS LINE CITATION (#18592), and the whole battery that
  //      used to pin the platform checklist's forked grammar, transplanted.
  //      ⛔ A case is not deleted by moving; it is deleted by stopping. Every
  //      row below fired in that fork and must fire here, and every silent
  //      neighbour it refused must stay silent here — that pair is what makes
  //      the fold a fold rather than a rewrite.
  //
  //      Driven in BOTH directions against the SAME text, because the whole
  //      risk of dropping the path is over-firing: with nothing in front of the
  //      number, the left boundary is the entire safety margin.
  const plDoc = 'ManifestSchema id :140 and version :202';
  check(extractAnchors(plDoc).lineAnchors.length === 0,
    'DEFAULT: a path-less citation is NOT read — a corpus that never declared `pathlessLineCitations` reads exactly the text it read before');
  const pl = (s) => extractAnchors(s, { pathlessLineCitations: true }).lineAnchors;
  const plRaw = (s) => pl(s).map((l) => l.raw);
  // ⭐ FIRES — every spelling the forked grammar caught and this core did not.
  check(pl(plDoc).length === 2, `OPT-IN: a bare continuation citation is caught, once per number — got ${JSON.stringify(plRaw(plDoc))}`);
  check(plRaw('Ada Auditor holds ONLY auditor (:395)').join() === ':395', 'a PARENTHESISED bare citation is caught');
  check(plRaw('computeAuthGate ~:5084-5160').join() === ':5084-5160', 'an approximate `~:` bare citation is caught — the tilde sits OUTSIDE the token, exactly as the fork read it');
  check(plRaw('computeAuthGate :~5084-5160').join() === ':~5084-5160', 'and the other tilde placement, INSIDE the colon form, is caught too');
  check(plRaw('registerRecordShareEndpoints ~L7246-7331').join() === '~L7246-7331', 'a `~L` line pin is caught');
  check(plRaw('the evaluate leg L7477-7493').join() === 'L7477-7493', 'a bare `L` line pin is caught, tilde or no tilde');
  check(pl('a run at :241-243 and :255 and :267').length === 3, 'each bare citation in a chained run is its own hit');
  // ⭐ The citation INHERITS the filename named before it — that is the whole
  //   reason the shape exists, and reporting it with no path at all would make
  //   the finding unactionable.
  const plInherit = pl('`packages/a/b.ts#one` then id :140');
  check(plInherit.length === 1 && plInherit[0].path === 'packages/a/b.ts' && plInherit[0].pathless === true,
    `a path-less citation inherits the path named before it and is marked path-less — got ${JSON.stringify(plInherit)}`);
  check(declinedShape({ pathless: true, path: 'packages/a/b.ts' }) === 'pathless',
    'a path-less citation is named by how it was WRITTEN, never by the path it borrowed');
  check(declinedShape({ continuation: true, pathless: true, path: 'packages/a/b.ts' }) === 'continuation',
    'the bare COLON form is a continuation and reports as one — it continues the filename before it');
  // ⭐ DE-DUPLICATION, both ways. A path-anchored citation and a backticked
  //   continuation both END in a `:NNN`, so the path-less pass must not report
  //   either of them a second time: a corpus counting citations would read the
  //   duplicate as a second defect in a file that has one.
  check(plRaw('packages/a/b.ts:4901').join() === 'packages/a/b.ts:4901',
    `a PATH-ANCHORED citation stays ONE hit with the option on — got ${JSON.stringify(plRaw('packages/a/b.ts:4901'))}`);
  check(plRaw('`packages/a/b.ts#s` and `:2933` after').join() === '`:2933`',
    `a BACKTICKED continuation stays ONE hit with the option on — got ${JSON.stringify(plRaw('`packages/a/b.ts#s` and `:2933` after'))}`);
  check(plRaw('about ~`326` there').join() === '~`326`', 'the tilde bare-number form is untouched by the option');
  // ⛔ STAYS SILENT — the colon-then-digit neighbours a real ledger is full of.
  //   Each of these was pinned by name in the fork and is pinned by name here.
  check(pl("thrown {code:'DELETE_RESTRICTED', status:409}").length === 0, 'an HTTP status in prose is not a citation');
  check(pl('retry {maxRetries:3, backoffMs:1000}').length === 0, 'a config literal is not a citation');
  check(pl('probe http://localhost:3000/_console/').length === 0, 'a URL port is not a citation');
  check(pl('daily 08:00 UTC; today() == 2026-08-31T00:00:00Z').length === 0, 'a clock time is not a citation');
  check(pl('a 200 {"scannedTypes":1,"stats":{}}').length === 0, 'JSON quoted in prose is not a citation');
  check(pl('ADR-0025 §3.3 and #13479').length === 0, 'an ADR section reference is not a citation');
  check(pl('never pin a bare colon-NNN').length === 0, 'prose that DESCRIBES the ban is not itself a citation');
  check(pl('SQL2019 and a TTL3600 budget').length === 0, 'a capital L ending an identifier before digits is not a line pin');
  check(pl('the L10n bundle').length === 0, 'an i18n-style token is not a line pin');
  check(pl('lane L1 of the queue').length === 0, 'a one-digit `L` reference is not a line pin — the floor is two digits');
  check(pl('**Date**: 2026-04-19 and exit contract: 1').length === 0,
    '⛔ a colon followed by a SPACE is prose punctuation, not a citation — admitting it fires 26 times in `docs/adr/**` alone');
  // ⭐ And the spelling the fold added to the PATH-ANCHORED form, which is NOT
  //   behind the option: every corpus catches it.
  const tildeInColon = extractAnchors('a pin at packages/a/AiChatPage.tsx:~605-615 here').lineAnchors;
  check(tildeInColon.length === 1 && tildeInColon[0].cited === 605,
    `the approximation tilde INSIDE the colon form is a line anchor for EVERY corpus — got ${JSON.stringify(tildeInColon.map((l) => l.raw))}`);
  check(extractAnchors('a template at packages/a/page.html:42 here').lineAnchors.length === 1,
    '`html` is in the shared anchorable vocabulary — a citation into a template page is read like any other');

  // 12. ⛔ THE ENVIRONMENT ISOLATION PIN (#16624), and it is the one case here
  //     that spawns `git`. `sweepCorpus` resolves through `git ls-files`, and
  //     for its whole life it passed NO ENVIRONMENT OF ITS OWN. From a plain
  //     shell that is invisible; from inside a hook, git's exported `GIT_DIR`
  //     outranks the `cwd` this resolver hands the child, and a sweep of a
  //     SYNTHETIC root silently answers with the real repository's file list.
  //
  //     The provocation is the failure itself: a bogus `GIT_DIR` is injected,
  //     a real two-file corpus is swept under it, and the sweep must come back
  //     having resolved ITS OWN tree. Before the fix this threw -- `git
  //     ls-files` cannot open a `GIT_DIR` that does not exist -- so the case
  //     could not pass by accident.
  //
  //     ⚠️ Every `git` this case runs is itself spawned with a stripped
  //     environment. A pin for this defect that reproduced the defect while
  //     writing the real index would be the incident a second time.
  const envPinDir = mkdtempSync(join(tmpdir(), 'symbol-anchors-envpin-'));
  const priorGitDir = process.env.GIT_DIR;
  let envPinSweep = null;
  let envPinError = null;
  try {
    mkdirSync(join(envPinDir, 'docs'), { recursive: true });
    mkdirSync(join(envPinDir, 'pkg'), { recursive: true });
    writeFileSync(join(envPinDir, 'pkg', 'a.ts'), 'export function handler() { return 1; }\n');
    writeFileSync(
      join(envPinDir, 'docs', 'note.md'),
      ['# note', '', 'the read lives at `pkg/a.ts#handler`.', ''].join('\n'),
    );
    execFileSync('git', ['init', '-q'], { cwd: envPinDir, env: gitFreeEnv() });
    execFileSync('git', ['add', '-A'], { cwd: envPinDir, env: gitFreeEnv() });
    process.env.GIT_DIR = join(tmpdir(), 'a-git-dir-that-does-not-exist');
    try {
      envPinSweep = sweepCorpus(defineCorpus({ id: 'envpin', label: 'env pin', docRoots: ['docs'] }), envPinDir);
    } catch (err) {
      envPinError = err;
    }
  } finally {
    if (priorGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = priorGitDir;
    rmSync(envPinDir, { recursive: true, force: true });
  }
  check(
    envPinError === null,
    '⛔ ENV LEAK: `sweepCorpus` must not inherit a hook\'s GIT_DIR — with one injected it threw: '
      + String(envPinError && envPinError.message).slice(0, 200),
  );
  check(
    envPinSweep !== null && envPinSweep.counts.symbol === 1 && envPinSweep.findings.filter((f) => !f.soft).length === 0,
    '⛔ ENV LEAK: the sweep must resolve against ITS OWN tracked tree under an injected GIT_DIR — got '
      + JSON.stringify(envPinSweep && { counts: envPinSweep.counts.symbol, findings: envPinSweep.findings.length }),
  );

  // ── The floor: every declared battery RAN, and ran its cases (#13489) ────
  //
  // Evaluated after every battery has had its chance and BEFORE the verdict, so
  // the success line below can only be printed by a run in which the set of
  // batteries that registered assertions EQUALS the set declared. A set
  // difference names WHICH battery stopped; a count says only that something did.
  // The floor's refusal joins the SAME sink the cases use — the module-level
  // `assert`, which prints and exits 1 — so a breached floor cannot be printed
  // over by the verdict below.
  const floorMessages = [];
  const floorFailure = (message) => { floorMessages.push(message); };
  const declaredBatteries = Object.keys(SELF_TEST_BATTERIES);
  let floorBreached = false;
  if (declaredBatteries.length < SELF_TEST_BATTERY_FLOOR) {
    floorBreached = true;
    floorFailure(
      `SELF_TEST_BATTERIES declares ${declaredBatteries.length} batteries, below the pinned `
        + `${SELF_TEST_BATTERY_FLOOR} — a battery deleted from the roster takes its own floor with it.`,
    );
  }
  for (const [name, count] of batterySeen) {
    if (declaredBatteries.includes(name)) continue;
    floorBreached = true;
    floorFailure(
      `self-test battery "${name}" registered ${count} case(s) but is not declared in `
        + 'SELF_TEST_BATTERIES — an assertion attributed to no declared battery is one nothing floors.',
    );
  }
  for (const name of declaredBatteries) {
    const count = batterySeen.get(name) ?? 0;
    if (count >= SELF_TEST_BATTERIES[name]) continue;
    floorBreached = true;
    floorFailure(
      count === 0
        ? `self-test battery "${name}" DID NOT RUN — 0 cases registered, ${SELF_TEST_BATTERIES[name]} pinned. `
          + 'The verdict below would have claimed those cases hold.'
        : `self-test battery "${name}" registered ${count} case(s), below its pinned floor of `
          + `${SELF_TEST_BATTERIES[name]} — cases that used to run no longer do.`,
    );
  }
  if (floorBreached) {
    floorFailure(
      'A battery at or below its floor means cases STOPPED RUNNING — the battery is the bug, not the '
        + 'number. Find what stopped registering (an early return, a deleted block, a guard that now '
        + 'skips) and restore it.',
    );
  }
  assert(!floorBreached, floorMessages.join('\n     '));

  console.log('✅ symbol-anchors --self-test: grammar, both resolution classes, comment/substring rejection, every ⛔ line-number spelling, exemption scoping and corpus registration verified');

  return SELF_TEST_VERDICT;
}

if (isEntrypoint(import.meta.url)) {
  // The `if` body is BRACED so the trailing `else` cannot re-bind to the inner
  // refusal, per the landed `scripts/pm/check-label-desc-cap.mjs` precedent.
  if (process.argv.includes('--self-test')) {
    if (selfTest() !== SELF_TEST_VERDICT) {
      console.error(
        '\n✗ symbol-anchors self-test: selfTest() returned without reaching its verdict,\n'
          + 'so no success line was printed. Exiting 0 here would report a self-test\n'
          + 'that never finished as a self-test that passed.\n',
      );
      process.exit(1);
    }
  } else {
    console.log('symbol-anchors is a library. Anchor grammar:\n  ' + ANCHOR_GRAMMAR);
    console.log('\nRun a corpus gate (e.g. `node scripts/check-adr-symbol-anchors.mjs`) or `--self-test`.');
  }
}
