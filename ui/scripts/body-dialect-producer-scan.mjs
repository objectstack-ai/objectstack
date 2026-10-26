#!/usr/bin/env node
/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `body` dialect PRODUCER scan (objectui#9871).
 *
 * ## The question this answers, and the one it refuses
 *
 * ⛔ NOT "how many producers are left". That question is what this file exists
 * to end. objectui#7181 named six producers, objectui#9847 found a seventh the
 * table never listed, and objectui#9871's retriage found two more — while
 * `pnpm census:body-dialect` read CLEAN (`app-metadata` 1 → 0) across all of
 * it. The two latest sites share something sharper than "they were missed":
 * ⭐ NO instrument in the tree could have found them.
 *
 * ⇒ the question is **WHAT MAKES THE TABLE COMPLETE**, and the answer has to be
 * a CRITERION a future site can be held against — ⛔ not a list a future site
 * has to be remembered onto.
 *
 * ## ⭐ THE CRITERION — what counts as a producer of the `body` child-list dialect
 *
 * A site is a PRODUCER iff C1 and C2 both hold. C3 is not a qualifier; it is
 * the axis the answer is FILED under, and it is recorded rather than assumed.
 *
 *   C1 — EMISSION. The site causes the literal key `body` to appear in metadata
 *        that a party OUTSIDE this tree then owns. Three channels are measured
 *        (`EMISSION_CHANNELS`): `default-props` (a registration's declared
 *        default, materialised into the author's page when the component is
 *        dropped), `scaffold` (written into files a tool creates), and
 *        `snippet` (inserted into the author's already-open document).
 *
 *   C2 — RESOLUTION. Some reader in this tree resolves a `body` off that
 *        carrier INTO A CHILD LIST. This is what separates the dialect from
 *        every unrelated `body`: an HTTP payload, `bodyExtra`, the `body`
 *        typography variant. ⭐ The reader set is DERIVED from source on every
 *        run (`deriveReaders`) — ⛔ never enumerated here, because an
 *        enumeration is the defect this file replaces.
 *
 *   C3 — CARRIER. Which object the key is spelled ON, because that decides
 *        WHICH PUBLISHED CONTRACT the site is judged against:
 *          `node`   — the object is a `BaseSchema` node. `body` is a DECLARED
 *                     twin of `children` there (`packages/types/src/base.ts`).
 *                     This is objectui#6771's ruled family.
 *          `item`   — the object is a member of a registration's declared item
 *                     array (`TabItem`, `ListItem`). ⚠️ Its canonical child-list
 *                     key is `content`, and `body` is declared on NEITHER
 *                     published face. ⇒ ⛔ NOT a dialect: a producer violating
 *                     the item's own published schema. RULED — see "The ruled
 *                     disposition of an `item`-carried `body`".
 *          `string` — the spelling is carried by a string the tool writes into
 *                     the author's document. The carrier is whatever node the
 *                     author accepts it onto, which this instrument does not
 *                     see. Reported as such, ⛔ never guessed.
 *
 * ## ⛔ What the criterion deliberately EXCLUDES, so a zero is readable
 *
 * `NOT_A_PRODUCER` below is the machine-readable form and every run emits it.
 * The four exclusions, and why each is not appetite:
 *
 *   - a DECLARATION (`inputs: [{ name: 'body' }]`, a published type member)
 *     TEACHES the spelling and writes nothing. It is a real surface and a real
 *     problem — it is simply a different one, and folding it in would make the
 *     producer count unreadable.
 *   - a READER (`renderChildren(schema.body)`) consumes; it does not emit. The
 *     readers are C2's instrument, so scoring them as producers would make this
 *     scan report its own denominator.
 *   - a `body` that no reader resolves as a child list fails C2 outright.
 *   - authored CORPUS, teaching snippets and fixtures are the dialect's
 *     VICTIMS, not its producers. They are bucketed and reported apart.
 *
 * ## ⭐ The two blindnesses this closes, and they are STRUCTURAL not incidental
 *
 * `scripts/body-dialect-census.mjs` scores a child list only on an object that
 * ALSO carries a string-literal `type`, and never reads inside a string or
 * template literal. Both limits are DECLARED there — ⛔ this is not a bug
 * report against the census. They are the two directions a classifier keyed on
 * "object with a `type`" is PERMANENTLY blind in, and each has a live site:
 *
 *   B1 — no sibling `type` is required here. A frame is scored on the `body`
 *        key ITSELF, so a non-node item (`{ label, value, body: [...] }`) is
 *        visible. `walkFrames` records `type` as a CARRIER fact, ⛔ never as an
 *        admission test — and it accepts a `type` of ANY value, where the
 *        census requires a string literal.
 *   B2 — literals are READ, not skipped. `scanSource` (the shared masker,
 *        `scripts/js-comment-mask.mjs`) is projected TWICE over one scan:
 *        comments-and-literals blanked for the structural walk, comments-only
 *        blanked for the key sweep. The `literal` flag is then what TELLS THE
 *        TWO APART — a key token at a literal-flagged offset is a spelling
 *        inside a string, which is exactly B2's population.
 *
 * ⚠️ Both projections come from ONE `scanSource` pass, ⛔ never a private
 * comment stripper: a regex has no idea what a string literal is, and this file
 * would be the last place that could afford to get literals wrong.
 *
 * ## ⭐ The RULED disposition of an `item`-carried `body` — ⛔ it is NOT a dialect
 *
 * This section used to ask "is an `item`-carried `body` inside objectui#6771's
 * ruled family?" and refuse to answer. ⭐ It is RULED: director seat, summon
 * #25 class-1 item 2, LETTER C, on objectui#9871 (2026-09-20).
 *
 * A `body` child list on a non-node ITEM (a tab item, a list item) is ⛔ not
 * inside objectui#6771's ruled family and ⛔ not a second family. It is a
 * PRODUCER VIOLATING THE ITEM'S OWN PUBLISHED SCHEMA — the item face declares
 * `content` (required on `TabItem`, optional on `ListItem`) and declares no
 * `body` on either the TS or the Zod face, and both item reads reached the key
 * only through an `any` cast. So it is fixed AT THE PRODUCER (done:
 * objectui#9941, which respelled the shipped `tabs` `defaultProps` to
 * `content`), ⛔ never by retiring a dialect: the family's remedy is "`children`
 * is the one spelling", and on the item face that names a key that does not
 * exist.
 *
 * ⇒ two consequences, and the second is ⛔ not a string:
 *
 *   - `dispositionOf('item')` is `ruled:not-a-dialect/item-schema-violation`.
 *     An `item` hit is off every pending list — it awaits no seat, and ⛔ no
 *     reader needs to re-litigate it.
 *   - `item` hits are STILL never folded into the ruled total, and that refusal
 *     ⛔ must not be weakened. What changed is the REASON (they are not that
 *     family at all, rather than not-yet-judged); the arithmetic did not.
 *     ⇒ objectui#6771 step 4's landability is judged ON THE NODE FACE ONLY.
 *
 * ⚠️ Both answers now begin `ruled:`, so a PREFIX match would fold the item
 * carrier straight into the ruled total. The discriminator is the CARRIER and
 * never the prefix; the pins hold the two buckets apart on exactly that.
 *
 * Usage:
 *   node scripts/body-dialect-producer-scan.mjs
 *   node scripts/body-dialect-producer-scan.mjs --root . --json
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname, sep } from 'node:path';

import { scanSource, blank } from './js-comment-mask.mjs';
import { isEntrypoint } from './invoked-as.mjs';

/** ⭐ The criterion, machine-readable. Emitted by every run, both modes. */
export const CRITERION = [
  {
    id: 'C1-emission',
    what:
      'The site causes the literal key `body` to appear in metadata a party OUTSIDE this tree then '
      + 'owns. Channels measured: ' + '`default-props`, `scaffold`, `snippet`.',
  },
  {
    id: 'C2-resolution',
    what:
      'Some reader in this tree resolves a `body` off that carrier INTO A CHILD LIST. The reader set '
      + 'is DERIVED per run, never enumerated — an enumeration is the defect this scan replaces.',
  },
  {
    id: 'C3-carrier',
    what:
      'Which object the key is spelled ON — `node` (a `BaseSchema` node, objectui#6771\'s ruled '
      + 'family), `item` (a member of a declared item array, whose canonical key is `content`; ⛔ '
      + 'NOT a dialect — a producer violating that item schema, ruled on objectui#9871), or '
      + '`string` (carried into the author\'s document, carrier not visible here). '
      + 'Recorded, never assumed; it decides which published contract judges the site.',
  },
];

/** ⛔ What the criterion excludes. A zero is only readable beside this. */
export const NOT_A_PRODUCER = [
  {
    id: 'declaration',
    what:
      'An `inputs: [{ name: \'body\' }]` entry or a published type member TEACHES the spelling and '
      + 'writes nothing. A real surface, a DIFFERENT one — folding it in makes the count unreadable.',
  },
  {
    id: 'reader',
    what:
      'A `renderChildren(x.body)` read CONSUMES the key. Readers are C2\'s instrument, so scoring '
      + 'them here would make this scan report its own denominator.',
  },
  {
    id: 'unresolved-body',
    what:
      'A `body` no derived reader resolves as a child list fails C2: an HTTP payload, `bodyExtra`, '
      + 'the `body` typography variant.',
  },
  {
    id: 'authored-corpus',
    what:
      'Fixtures, tests, docs and example apps AUTHOR the dialect — they are its victims, not its '
      + 'producers. Bucketed and reported apart, never summed into the producer table.',
  },
];

/** Every way a zero here is NOT "no producer ships the dialect". */
export const KNOWN_LIMITS = [
  {
    id: 'channel-key-path',
    what:
      'An emission channel is recognised by the KEY PATH the frame sits under (`EMISSION_CHANNELS`). '
      + 'A producer that emits from a path none of those patterns name is scored `channel: null` and '
      + 'reported under `unclassified` — visible, but NOT in the producer table.',
  },
  {
    id: 'string-carrier',
    what:
      'A `string`-carried hit has no carrier object in this tree: the author\'s acceptance decides '
      + 'it. So it is a producer with NO family disposition, and asking this scan for one is asking '
      + 'the wrong instrument.',
  },
  {
    id: 'item-array-derivation',
    what:
      'The item-array key set is derived from `schema.<key>.map(` / `Array.isArray(schema.<key>)` in '
      + 'the files that read a non-`schema` receiver. An item array reached any other way leaves its '
      + 'members scored `unknown` rather than `item`.',
  },
  {
    id: 'skipped-directory',
    what:
      '`SKIP_DIRS` are never walked, and only `SCANNED_EXT` are read. Absence under either is an '
      + 'exclusion, not a reading.',
  },
  {
    id: 'item-carrier-not-in-ruled-total',
    what:
      '`item` hits are NOT folded into the ruled total, so a ruled-total zero says nothing about '
      + 'them. ⛔ They are NOT a dialect: an item-carried `body` is a producer violating the '
      + 'item\'s OWN published schema (`TabItemSchema` declares `content` and declares no `body`), '
      + 'fixed at the producer — director seat, summon #25 class-1 item 2, letter C, on '
      + 'objectui#9871 (2026-09-20); producer fix objectui#9941. objectui#6771 step 4\'s '
      + 'landability is judged on the node face only.',
  },
];

const SCANNED_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
// In step with `body-dialect-census.mjs`'s list, which says why each entry is
// there. `.objectstack-pin` (objectui#13210) is the pinned `@objectstack/*`
// build: git-ignored, another repository's packed output, present only after
// `pnpm run setup`. Its files fell in the `other` bucket here, so they never
// reached C2 or the producer table — walking them only cost time.
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.turbo', 'out',
  '.pnpm-store', 'playwright-report', 'test-results', '.objectui-tmp',
  '.objectstack-pin',
]);

/**
 * How a key path is recognised as an EMISSION channel (C1).
 *
 * Matched against the chain of keys that OPENED the enclosing frames, so
 * `defaultProps.items` and `templates.simple.body` both resolve without anyone
 * naming a file. ⭐ A file allow-list would be the enumeration this scan exists
 * to replace, one level up.
 */
export const EMISSION_CHANNELS = [
  { id: 'default-props', kind: 'key-path', segment: /^defaultProps$/ },
  {
    // ⭐ Recognised by an EMISSION VERB, ⛔ never by a file name. A file
    // allow-list would be the enumeration this scan exists to replace, one
    // level up: the next scaffold would have to be remembered onto it.
    id: 'scaffold',
    kind: 'emission-verb',
    verb: /\b(?:writeFileSync|writeFile|outputFileSync|outputFile|createFile)\s*\(/,
  },
  {
    id: 'snippet',
    kind: 'emission-verb',
    verb: /\b(?:insertText|SnippetString|TextEdit|WorkspaceEdit|applyEdit)\b/,
  },
];

/**
 * Key paths that mark a DECLARATION rather than an emission (⛔ not a producer).
 *
 * ⚠️ `properties` is deliberately ABSENT. The VS Code completion provider holds
 * its offerings under exactly that key and then WRITES them into the author's
 * document, so excluding the name would have hidden the sharpest producer in
 * the tree behind a word. Declaration is decided by `inputs` — the registration
 * input list — and by the absence of an emission verb, ⛔ never by a key name
 * that merely sounds descriptive.
 */
export const DECLARATION_SEGMENTS = [/^inputs$/];

/**
 * ⭐ The cheap NECESSARY CONDITION for a file to hold a hit at all.
 *
 * ⛔ This is NOT a narrowing of the corpus, and the difference matters: every
 * file is still walked and still read. What it skips is the EXPENSIVE
 * per-character analysis, and only for a file in which no hit shape could
 * match — so the hit set is unchanged BY CONSTRUCTION.
 *
 * The superset argument, one line per shape this scanner can find, because a
 * pre-filter that is not a superset is a silent narrowing and that is the
 * defect this whole card exists to end:
 *
 *   - `code-key` / `literal-key-syntax` match `("body"|'body'|body)` followed
 *     by optional space and `:`  ⇒  the raw text holds `body`, an optional
 *     closing quote, optional space, `:`  ⇒  the first alternative below.
 *   - `key-name-datum` matches `name|key|prop|property` `:` then `"body"` or
 *     `'body'`  ⇒  the raw text holds a QUOTED `body`  ⇒  the second.
 *
 * ⚠️ Both alternatives are load-bearing: a `{ name: 'body', desc: … }` datum
 * has a COMMA after the quote, not a colon, so the first alternative alone
 * would drop the sharpest producer in the tree. Measured, ⛔ not reasoned
 * about — the tests pin one case per shape plus a negative control, and the
 * whole-tree hit-set equality is recorded on objectui#9871's PR.
 *
 * Measured on this tree: 1852 files contain the substring `body`, 500 satisfy
 * this predicate — 61% of the bytes never reach `scanSource`, and the hit-set
 * digest is identical either way.
 */
export const CANDIDATE_FILE = /body\s*["']?\s*:|["']body["']/;

// ── C2: derive the reader set ──────────────────────────────────────────────

/**
 * A read that resolves `body` INTO A CHILD LIST, in the two shapes this tree
 * writes. Both are anchored on a child-list construct, ⛔ never on the bare key:
 * `x.body` alone is not evidence of anything.
 */
const READ_SHAPES = [
  {
    id: 'render-children',
    // renderChildren( <recv>.body )  — including `(recv as any).body` and `recv?.body`
    re: /renderChildren\s*\(\s*\(?\s*([A-Za-z_$][\w$]*)(?:\s+as\s+\w+)?\s*\)?\s*\??\.body\b/g,
  },
  {
    id: 'alternation',
    // <recv>.children|content  ||/??  <recv>.body   (either order)
    re: /([A-Za-z_$][\w$]*)\s*\??\.(?:children|content)\s*(?:\|\||\?\?)\s*(?:renderChildren\s*\(\s*)?\(?\s*\1(?:\s+as\s+\w+)?\s*\)?\s*\??\.body\b/g,
  },
  {
    id: 'alternation',
    re: /([A-Za-z_$][\w$]*)\s*\??\.body\s*(?:\|\||\?\?)\s*\(?\s*\1(?:\s+as\s+\w+)?\s*\)?\s*\??\.(?:children|content)\b/g,
  },
];

/** `schema.<key>.map(` / `Array.isArray(schema.<key>)` — where an item receiver comes from. */
const ITEM_ARRAY_SHAPES = [
  /schema\s*\??\.([A-Za-z_$][\w$]*)\s*\??\.map\s*\(/g,
  /Array\.isArray\s*\(\s*schema\s*\??\.([A-Za-z_$][\w$]*)\s*\)/g,
];

/**
 * Derive C2's reader set from source.
 *
 * Returns the read sites, the receiver identifiers they read from, and the item
 * array keys those non-`schema` receivers are drawn from. ⛔ Nothing here is
 * hard-coded: a registration that starts resolving `body` joins the set on the
 * next run, and one that stops leaves it.
 */
export function deriveReaders(root, files = null) {
  const reads = [];
  const receivers = new Set();
  const itemArrayKeys = new Set();
  let filesScanned = 0;
  for (const file of files ?? walk(root)) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    filesScanned++;
    if (!text.includes('.body')) continue;
    const rel = relative(root, file);
    // ⭐ C2 asks what the PLATFORM resolves, so the reader set is taken over
    // shipped source only: a read inside a test or a fixture is that test's
    // subject, not a reason the dialect renders for an author.
    if (bucketOf(rel) !== 'shipped-source') continue;
    const { comment, literal } = scanSource(text);
    const code = blank(text, comment);
    const lineAt = lineCounter(text);
    let sawNonSchema = false;
    for (const shape of READ_SHAPES) {
      shape.re.lastIndex = 0;
      let m;
      while ((m = shape.re.exec(code)) !== null) {
        // ⚠️ A read is CODE. The same sentence inside a `.describe(...)` string
        // or a docblock quote is prose about a read — scoring it would let this
        // tree's own documentation manufacture C2 evidence for itself.
        if (literal[m.index]) continue;
        const receiver = m[1];
        reads.push({ file: rel, line: lineAt(m.index), receiver, shape: shape.id });
        receivers.add(receiver);
        if (receiver !== 'schema') sawNonSchema = true;
      }
    }
    if (sawNonSchema) {
      for (const re of ITEM_ARRAY_SHAPES) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(code)) !== null) if (!literal[m.index]) itemArrayKeys.add(m[1]);
      }
    }
  }
  return { reads, receivers: [...receivers].sort(), itemArrayKeys: [...itemArrayKeys].sort(), filesScanned };
}

// ── The scanner: one `scanSource` pass, two projections ────────────────────

/** A key token in key position: `body:`, `"body":`, `'body':`. */
const KEY_TOKEN = /^(?:"([A-Za-z_$][\w$-]*)"|'([A-Za-z_$][\w$-]*)'|([A-Za-z_$][\w$]*))\s*:/;

/** `name: 'body'` — the key spelled as a DATUM that names a key (B2, second shape). */
const KEY_NAME_DATUM = /\b(?:name|key|prop|property)\s*:\s*(?:"body"|'body')/g;

/**
 * Walk object/array frames, recording every `body` key with the frame that owns
 * it, that frame's complete sibling key set, and the key path above it.
 *
 * ⭐ B1 lives here: the frame is scored on the `body` key ITSELF. `type` is
 * recorded as a carrier FACT and is ⛔ never an admission test, so an object
 * with no `type` — a tab item — is seen. `type` of ANY value counts, where the
 * census requires a string literal.
 *
 * ⭐ ONE projection, not two. The brace stack needs the source with literals
 * blanked and the key tokens need it with literals INTACT — but those two
 * strings differ ONLY at literal-flagged offsets, which is precisely what
 * `literal` already marks. So the structural character is read as a space
 * wherever the flag is set, and the second `blank()` pass over every candidate
 * file (~0.85s of pure `split('')`/`join('')` across this tree) goes away.
 * Byte-identical by construction; the hit-set digest is pinned equal on
 * objectui#9871's PR across the change.
 *
 * @param {string} keyText comments blanked, literals INTACT
 * @param {Uint8Array} literal the flag that both blanks the brace stack and
 *   tells a code key from a spelling inside a string
 */
export function walkFrames(keyText, literal) {
  const hits = [];
  const frames = [];
  const stack = [];
  const n = keyText.length;
  let i = 0;
  let prevSignificant = '';
  let prevWord = '';

  const finish = (frame) => {
    frame.end = i;
    frames.push(frame);
    for (const pending of frame.pending) {
      hits.push({
        ...pending,
        siblingKeys: [...frame.keys],
        hasType: frame.keys.has('type'),
        nodeType: frame.typeValue ?? null,
      });
    }
  };

  while (i < n) {
    // A brace inside a string literal is not structure — the flag blanks it,
    // exactly as a second masked projection used to.
    const c = literal[i] ? ' ' : keyText[i];
    const top = stack[stack.length - 1];

    if (top && top.isObject && /[A-Za-z_$"']/.test(keyText[i]) && !literal[i]) {
      const m = KEY_TOKEN.exec(keyText.slice(i, i + 160));
      if (m) {
        const key = m[1] ?? m[2] ?? m[3];
        top.keys.add(key);
        top.lastKey = key;
        if (key === 'type') {
          const v = /^\s*(?:"([^"\\]*)"|'([^'\\]*)')/.exec(keyText.slice(i + m[0].length, i + m[0].length + 160));
          if (v) top.typeValue = v[1] ?? v[2];
        }
        if (key === 'body') {
          top.pending.push({
            offset: i,
            carrierPath: stack.map((f) => f.openerKey).filter(Boolean),
            source: 'code-key',
            valueKind: valueKindAt(keyText, i + m[0].length),
          });
        }
        i += m[0].length;
        prevSignificant = ':';
        prevWord = '';
        continue;
      }
    }

    if (c === '{' || c === '[') {
      // ⭐ A `{` is an object literal OR a FUNCTION BODY, and the difference is
      // load-bearing twice over: a block holds statements rather than keys, and
      // it is the scope an emission verb has to be found in. A block opener
      // follows `)` (a parameter list), `=>`, or one of the statement keywords.
      const isBlock =
        c === '{' &&
        (prevSignificant === ')' ||
          prevSignificant === '>' ||
          BLOCK_KEYWORDS.has(prevWord));
      const openerKey = top ? (top.isObject ? top.lastKey : top.openerKey) : null;
      stack.push({
        isObject: c === '{' && !isBlock,
        isBlock,
        start: i,
        end: n,
        keys: new Set(),
        pending: [],
        openerKey: isBlock ? null : openerKey,
        lastKey: null,
        typeValue: null,
      });
      i++;
      prevSignificant = c;
      prevWord = '';
      continue;
    }
    if (c === '}' || c === ']') {
      const frame = stack.pop();
      if (frame) finish(frame);
      i++;
      prevSignificant = c;
      prevWord = '';
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      prevWord += c;
      prevSignificant = c;
    } else if (!/\s/.test(c)) {
      prevWord = '';
      prevSignificant = c;
    }
    i++;
  }
  // An unbalanced tail still yields its hits — dropping them would turn a
  // scanner limitation into a silent zero, which is this card's whole subject.
  while (stack.length) finish(stack.pop());
  return { hits, frames };
}

/**
 * What KIND of thing the `body` key is bound to — ⭐ C1's sharpest edge.
 *
 * A producer emits DATA: an array, an object, a string, a template. A
 * DECLARATION binds an expression: `body: z.union(...)`, `body:
 * aliasKeyRefusal(...)`, `body: c.body ?? ''`, `body: _body`, `body: unknown`.
 * ⛔ Not a taste call — a validator, a destructured rename and a TS annotation
 * put no `body` into anybody's metadata, so they cannot satisfy C1 however the
 * key is spelled.
 */
export function valueKindAt(text, offset) {
  let i = offset;
  while (i < text.length && /\s/.test(text[i])) i++;
  const c = text[i];
  if (c === '[') return 'array';
  if (c === '{') return 'object';
  if (c === '"' || c === "'") return 'string';
  if (c === '`') return 'template';
  return 'expression';
}

/** The value kinds that can carry emitted metadata. Anything else fails C1. */
export const DATA_VALUE_KINDS = new Set(['array', 'object', 'string', 'template']);

/** Statement keywords after which a `{` opens a BLOCK, not an object literal. */
const BLOCK_KEYWORDS = new Set([
  'else', 'try', 'finally', 'do', 'catch', 'return',
]);

/**
 * The frames enclosing `offset`, innermost first, stopping AT the nearest
 * function body.
 *
 * ⭐ The stop is the point. An emission verb is evidence about the scope that
 * emits, so searching past the enclosing function would let any verb anywhere
 * in a file vouch for every `body` in it — which is a file allow-list wearing a
 * different hat.
 */
export function enclosingScope(frames, offset) {
  const containing = frames
    .filter((f) => f.start <= offset && offset <= f.end)
    .sort((a, b) => b.start - a.start);
  const out = [];
  for (const frame of containing) {
    out.push(frame);
    if (frame.isBlock) break;
  }
  return out;
}

/** Bucket a file by WHAT KIND of artifact it is, so victims never sum with producers. */
export function bucketOf(relPath) {
  const p = relPath.split(sep).join('/');
  if (/(^|\/)__tests__\//.test(p) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(p)) return 'test';
  if (/(^|\/)(__fixtures__|fixtures|__mocks__)\//.test(p)) return 'fixture';
  if (/(^|\/)e2e\//.test(p)) return 'e2e';
  if (/(^|\/)examples\//.test(p)) return 'example-app';
  if (/(^|\/)scripts\//.test(p)) return 'tooling';
  if (/(^|\/)(apps|packages)\//.test(p)) return 'shipped-source';
  return 'other';
}

function channelOf(carrierPath, scopeText) {
  for (const channel of EMISSION_CHANNELS) {
    if (channel.kind === 'key-path') {
      for (const segment of carrierPath) if (channel.segment.test(segment)) return channel.id;
    } else if (channel.kind === 'emission-verb') {
      if (channel.verb.test(scopeText)) return channel.id;
    }
  }
  return null;
}

function isDeclaration(carrierPath) {
  return carrierPath.some((segment) => DECLARATION_SEGMENTS.some((re) => re.test(segment)));
}

/**
 * C3 — which object the key is spelled ON.
 *
 * ⭐ `type` is a CARRIER FACT here and ⛔ never an admission test, which is the
 * whole of B1: the census requires a sibling string-literal `type` before it
 * will score a child list, and that requirement is what makes a tab item
 * permanently invisible to it. A `type` of ANY value counts.
 */
function carrierOf(hit, itemArrayKeys) {
  if (hit.source !== 'code-key') return 'string';
  if (hit.hasType) return 'node';
  const owner = hit.carrierPath[hit.carrierPath.length - 1];
  if (owner && itemArrayKeys.includes(owner)) return 'item';
  // ⭐ A `body` directly under `defaultProps` IS node-carried: the node is the
  // registration, and its `type` is the registered key — which sits in
  // `ComponentRegistry.register('<key>', …)` rather than as a sibling of the
  // `body`. Requiring a SIBLING `type` here is B1 all over again one frame up,
  // and it is the shape objectui#7181's three `defaultProps` producers had.
  if (hit.carrierPath.includes('defaultProps')) return 'node';
  return 'unknown';
}

/** `ComponentRegistry.register('<key>'` — where a `defaultProps` node's `type` really lives. */
const REGISTRATION = /ComponentRegistry\s*\.\s*register\s*\(\s*['"]([^'"]+)['"]/g;

/** The key of the registration a hit sits inside, or null. */
export function registrationAt(text, offset) {
  REGISTRATION.lastIndex = 0;
  let key = null;
  let m;
  while ((m = REGISTRATION.exec(text)) !== null) {
    if (m.index > offset) break;
    key = m[1];
  }
  return key;
}

/**
 * ⭐ The disposition axis — and one of the two places a reader MEETS the answer,
 * so the ruling is cited HERE rather than only in the file header: a citation
 * read only by someone already reading the file is not read by who needs it.
 *
 * `item` is RULED and what it is ruled to be is ⛔ NOT a dialect — director
 * seat, summon #25 class-1 item 2, LETTER C, on objectui#9871 (2026-09-20). An
 * item-carried `body` is a producer violating the item's own published schema
 * (`TabItemSchema` declares `content` and declares no `body`; `ListItem`
 * likewise), fixed at the producer (objectui#9941). It awaits no seat.
 *
 * ⚠️ `ruled:` prefixes BOTH answers, and a prefix match is ⛔ not the
 * discriminator: the CARRIER is. `item` is still never folded into
 * objectui#6771's ruled total, whose step 4 is judged on the node face only.
 */
export function dispositionOf(carrier) {
  if (carrier === 'node') return 'ruled:6771';
  if (carrier === 'item') return 'ruled:not-a-dialect/item-schema-violation';
  if (carrier === 'string') return 'carrier-undetermined';
  return 'unknown';
}

/**
 * Scan one tree for producers under the criterion.
 *
 * @param {string} root
 * @param {{ readers?: ReturnType<typeof deriveReaders> }} [options]
 */
export function scan(root, options = {}) {
  // ONE directory traversal, shared by both phases. The reader derivation and
  // the producer pass ask different questions of the same tree; walking it
  // twice bought nothing but five thousand redundant `statSync` calls.
  const files = [...walk(root)];
  const readers = options.readers ?? deriveReaders(root, files);
  const hits = [];
  let filesScanned = 0;

  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    filesScanned++;
    // ⭐ The cheap necessary condition — see `CANDIDATE_FILE`. Every file is
    // still walked and read; only the per-character analysis is skipped, and
    // only where no hit shape could match.
    if (!CANDIDATE_FILE.test(text)) continue;
    const rel = relative(root, file);
    const bucket = bucketOf(rel);

    const { comment, literal } = scanSource(text);
    const keyText = blank(text, comment);

    const { hits: frameHits, frames } = walkFrames(keyText, literal);
    const lineAt = lineCounter(text);

    const pathAt = (offset) =>
      enclosingScope(frames, offset)
        .map((f) => f.openerKey)
        .filter(Boolean)
        .reverse();

    const record = (hit) => {
      const scope = enclosingScope(frames, hit.offset);
      // ⭐ The scope an emission verb must be found in is the enclosing
      // FUNCTION — and when there is none, it is the MODULE. A module-level
      // template constant is written out by a function further down the file,
      // and scoping its verb to the object literal it sits in would have made
      // every scaffold of that shape invisible. That shape is not hypothetical:
      // it is how `objectui init` held its templates.
      const outermost = scope[scope.length - 1];
      const scopeText = outermost && outermost.isBlock
        ? text.slice(outermost.start, outermost.end)
        : text;
      const carrierPath = hit.carrierPath ?? pathAt(hit.offset);
      const carrier = carrierOf({ ...hit, carrierPath }, readers.itemArrayKeys);
      const declaration = isDeclaration(carrierPath);
      hits.push({
        file: rel,
        line: lineAt(hit.offset),
        bucket,
        source: hit.source,
        carrierPath,
        siblingKeys: hit.siblingKeys ?? [],
        carrier,
        nodeType:
          hit.nodeType
          ?? (carrier === 'node' && carrierPath.includes('defaultProps')
            ? registrationAt(text, hit.offset)
            : null),
        valueKind: hit.valueKind ?? 'string',
        disposition: dispositionOf(carrier),
        declaration,
        channel:
          declaration || !DATA_VALUE_KINDS.has(hit.valueKind ?? 'string')
            ? null
            : channelOf(carrierPath, scopeText),
      });
    };

    for (const hit of frameHits) record(hit);

    // ⭐ B2: the same key, spelled INSIDE a literal. The `literal` flag is the
    // whole discriminator — a key token at a flagged offset is a spelling the
    // tool may write into somebody's document, not a key in this tree's own
    // code. Whether it IS written is C1, and C1 is the emission verb above:
    // a hover card that merely SHOWS the spelling has no verb and no channel.
    const inLiteralKey = /(?:"body"|'body'|\bbody)\s*:/g;
    let m;
    while ((m = inLiteralKey.exec(keyText)) !== null) {
      if (!literal[m.index]) continue;
      record({ offset: m.index, source: 'literal-key-syntax' });
    }
    KEY_NAME_DATUM.lastIndex = 0;
    while ((m = KEY_NAME_DATUM.exec(keyText)) !== null) {
      record({ offset: m.index, source: 'key-name-datum' });
    }
  }

  return { readers, filesScanned, hits };
}

/**
 * ⭐ C2, APPLIED — ⛔ not merely derived.
 *
 * A `body` passes C2 when the derived reader set actually reads from a carrier
 * of its class. The receivers those readers name are what decides it, so this
 * is the criterion doing work rather than a sentence in a header:
 *
 *   `node`    — a `schema.body` reader exists ⇒ passes.
 *   `item`    — an `item.body` reader exists, drawn from a declared item array
 *               ⇒ passes.
 *   `string`  — the spelling is written into somebody's document as a key; the
 *               carrier it lands on is theirs ⇒ passes, with no disposition.
 *   `unknown` — neither a node nor a declared item member. NO derived reader
 *               resolves such an object's `body` into a child list, so it fails
 *               C2. ⭐ This is the entire HTTP-payload / `bodyExtra` population,
 *               and dropping it is the criterion working, not a blind spot —
 *               the count is REPORTED so the drop is never silent.
 */
export function passesC2(hit, readers) {
  if (hit.carrier === 'node') return readers.receivers.includes('schema');
  if (hit.carrier === 'item') return readers.receivers.some((r) => r !== 'schema');
  if (hit.carrier === 'string') return readers.reads.length > 0;
  return false;
}

/** The producer table: C1 ∧ C2, with victims and declarations held out. */
export function producersOf(hits, readers) {
  return hits.filter(
    (hit) =>
      hit.bucket === 'shipped-source' &&
      !hit.declaration &&
      passesC2(hit, readers) &&
      hit.channel !== null,
  );
}

/**
 * Shipped-source spellings that pass C2 but that no `EMISSION_CHANNELS` pattern
 * claims. ⭐ This is where a NEW emission channel shows up as a row instead of
 * as a silence — the failure this whole card is about.
 */
export function unchannelledOf(hits, readers) {
  return hits.filter(
    (hit) =>
      hit.bucket === 'shipped-source' &&
      !hit.declaration &&
      DATA_VALUE_KINDS.has(hit.valueKind) &&
      passesC2(hit, readers) &&
      hit.channel === null,
  );
}

// ── Walk / util ────────────────────────────────────────────────────────────

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
 * Line numbers for one text from ONE pass over it (objectui#13210) — the same
 * helper as `body-dialect-census.mjs`'s, which says why it replaced a per-hit
 * newline count from the top of the file.
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
 * Exit code for a run that REFUSES to report a number, kept distinct from 1 so
 * "the instrument refused" and "the instrument crashed" are not one reading.
 */
export const EXIT_UNREADABLE = 2;

/**
 * Whether a run may report a table at all.
 *
 * ⭐ A zero PRODUCER count is a legitimate reading and is NOT refused —
 * refusing it would delete the one answer this scan exists to be able to give.
 * ⚠️ It is NOT, as first written here, "the day objectui#6771 step 4 becomes
 * landable": step 4 landed with this table non-empty, because every row left in
 * it was `ruled:not-a-dialect/item-schema-violation` — ⭐ and step 4's
 * landability is judged ON THE NODE FACE ONLY (summon #25 letter C, on
 * objectui#9871) — while the tier refuses `body` only on a node whose
 * `type` resolves to a registration — a `tabs` item is the value of a declared
 * `items` input and is never walked as one. A zero here is objectui#9590's
 * finish line instead. What IS refused is a run
 * that could not have found anything: a blind walk, or a C2 instrument that
 * derived no readers, in which case every `body` fails C2 for a reason that has
 * nothing to do with the corpus.
 */
export function finalVerdict({ filesScanned, readers }) {
  if (filesScanned === 0) {
    return {
      exit: EXIT_UNREADABLE,
      refusal: [
        '✗ Zero files scanned. A scan that reads nothing because it is blind is',
        '  indistinguishable from a tree that ships no producer. Check `--root`.',
      ],
    };
  }
  if (readers.reads.length === 0) {
    return {
      exit: EXIT_UNREADABLE,
      refusal: [
        '✗ Zero readers derived. C2 asks whether a reader resolves `body` into a',
        '  child list; with no reader, every site fails C2 for a reason that has',
        '  nothing to do with the corpus, and the producer table would read 0.',
      ],
    };
  }
  return { exit: 0, refusal: null };
}

function printList(title, entries) {
  console.log(`\n#### ${title}\n`);
  for (const entry of entries) console.log(`- \`${entry.id}\` — ${entry.what}`);
}

function main(argv = process.argv.slice(2)) {
  const arg = (name, dflt) => {
    const idx = argv.indexOf(name);
    return idx >= 0 && argv[idx + 1] ? argv[idx + 1] : dflt;
  };
  const root = arg('--root', '.');
  const asJson = argv.includes('--json');

  const { readers, filesScanned, hits } = scan(root);
  const verdict = finalVerdict({ filesScanned, readers });
  if (verdict.refusal) {
    for (const line of verdict.refusal) console.error(line);
    return verdict.exit;
  }

  const producers = producersOf(hits, readers);
  const unclassified = unchannelledOf(hits, readers);
  const failedC2 = hits.filter(
    (hit) => hit.bucket === 'shipped-source' && !hit.declaration && !passesC2(hit, readers),
  );

  if (asJson) {
    // ⭐ The criterion travels WITH the reading. There is no spelling of this
    // payload that reports a table without reporting what made it a table.
    console.log(
      JSON.stringify(
        {
          root,
          criterion: CRITERION,
          notAProducer: NOT_A_PRODUCER,
          knownLimits: KNOWN_LIMITS,
          readers,
          filesScanned,
          producers,
          unclassified,
          failedC2,
          hits,
        },
        null,
        2,
      ),
    );
    return verdict.exit;
  }

  console.log(`## \`body\` dialect PRODUCER scan (objectui#9871) — root: ${root}`);
  console.log(`\nFiles scanned: ${filesScanned}. Candidate \`body\` spellings: ${hits.length}.`);

  printList('⭐ The criterion — what makes a site a producer', CRITERION);
  printList('⛔ Excluded by the criterion — so a zero is readable', NOT_A_PRODUCER);
  printList('Known limits — every other way a 0 here is not "nothing ships it"', KNOWN_LIMITS);

  console.log('\n### C2 — the reader set, DERIVED this run (never enumerated)\n');
  console.log(`Receivers: ${readers.receivers.map((r) => `\`${r}\``).join(' ')}`);
  console.log(`Item-array keys: ${readers.itemArrayKeys.map((k) => `\`${k}\``).join(' ') || '_none_'}`);
  console.log(`\n| file:line | receiver | shape |`);
  console.log('|:--|:--|:--|');
  for (const read of readers.reads) {
    console.log(`| \`${read.file}:${read.line}\` | \`${read.receiver}\` | ${read.shape} |`);
  }

  console.log(`\n### ⭐ The PRODUCER table — derived, ${producers.length} site(s)\n`);
  if (producers.length === 0) {
    console.log('_None._ ⇒ under this criterion no shipped source emits the dialect.');
  } else {
    console.log('| file:line | carrier | `type` | channel | disposition | source |');
    console.log('|:--|:--|:--|:--|:--|:--|');
    for (const hit of producers.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
      console.log(
        `| \`${hit.file}:${hit.line}\` | ${hit.carrier} | ${hit.nodeType ? `\`${hit.nodeType}\`` : '—'}`
          + ` | ${hit.channel} | ${hit.disposition} | ${hit.source} |`,
      );
    }
  }

  const byDisposition = new Map();
  for (const hit of producers) byDisposition.set(hit.disposition, (byDisposition.get(hit.disposition) ?? 0) + 1);
  console.log('\n| disposition | producers |');
  console.log('|:--|--:|');
  for (const [d, c] of [...byDisposition].sort()) console.log(`| ${d} | ${c} |`);
  console.log(
    '\n⚠️ `ruled:not-a-dialect/item-schema-violation` is ⛔ NOT folded into the ruled total — and'
      + ' it ⛔ awaits no ruling. An item-carried `body` is ⛔ NOT a dialect: it is a producer'
      + '\nviolating the item\'s OWN published schema (`TabItemSchema` declares `content` and'
      + ' declares no `body`), fixed at the producer — director seat, summon #25 class-1 item 2,'
      + '\nletter C, on objectui#9871 (2026-09-20); producer fix objectui#9941. objectui#6771 step'
      + " 4's landability is judged on the NODE FACE ONLY.",
  );

  console.log(
    `\n### C2 held ${failedC2.length} shipped-source \`body\` spelling(s) OUT of the table`
      + ' — ⛔ not silently\n',
  );
  console.log(
    'Their carrier is neither a node nor a member of a declared item array, so NO derived reader'
      + '\nresolves them into a child list: an HTTP payload, a `bodyExtra`, a `body` typography'
      + '\nvariant. ⭐ The count is printed because a criterion that drops a population silently is'
      + '\nthe defect this scan replaces. `--json` carries every row under `failedC2`.',
  );

  if (unclassified.length > 0) {
    console.log(`\n### ⚠️ Passes C2, but NO recognised emission channel (${unclassified.length})\n`);
    console.log('These carry the dialect on a real carrier and no `EMISSION_CHANNELS` pattern claims');
    console.log('them, so they are visible and ⛔ NOT in the table above. ⭐ A producer emitting by a');
    console.log('route nobody has named yet appears HERE — that is what makes this list load-bearing.\n');
    console.log('| file:line | carrier | path |');
    console.log('|:--|:--|:--|');
    for (const hit of unclassified.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
      console.log(`| \`${hit.file}:${hit.line}\` | ${hit.carrier} | ${hit.carrierPath.join('.') || '_root_'} |`);
    }
  }

  return verdict.exit;
}

// The ONE entry-guard predicate, never a hand-typed `process.argv[1]` compare.
if (isEntrypoint(import.meta.url)) process.exit(main());
