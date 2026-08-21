#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-doc-anchors — resolve every `#fragment` an internal docs link writes
// against the heading ids the destination page actually renders.
//
// ## The failure this exists for
//
// framework#7484. `Check Documentation Links` runs lychee, and `lychee.toml`
// sets `include_fragments = "none"` — so lychee resolves the FILE and never
// looks at the `#anchor`. Measured with the pinned binary (0.24.2) under the
// exact CI argv: a link to `/docs/deployment/validating-metadata#this-anchor-
// does-not-exist-at-all` is reported `[200] ✅ OK`.
//
// That makes a cross-file anchor a two-sided invariant with no owner. The
// heading lives in one file, the link in another, and until this script nothing
// in CI related them: a rename that updates the heading and not the inbound
// `#anchor` shipped green. #7465 exists because exactly that pairing had already
// drifted once — `cli.mdx:458` pointed at a heading whose text had been correct
// in 2024 — and PR #7483 could only catch its own rename by hand, with a slug
// computed in a REPL and a repo-wide grep. Neither runs on anyone else's PR.
//
// Four inbound anchors were already dead when this landed (see "The fallout"
// below); all four are fixed in the same change, so this gate lands with an
// empty baseline and no allowlist to grandfather anything.
//
// ## Why a script and not `include_fragments = "anchor-only"`
//
// The card left the direction open and warned that the answer had to be
// measured. Three reasons the flip is the worse trade, in descending order:
//
//   1. **It cannot be scoped to internal links.** `include_fragments` is a
//      global enum in `lychee.toml`; it does not distinguish "an anchor on a
//      page in this repo" from "an anchor on someone else's website". The
//      second class is the noisy one — it needs the page fetched and parsed,
//      which the `--offline` lane deliberately never does — and that asymmetry
//      is almost certainly why the key reads `"none"` today. Turning it on to
//      buy the internal check imports the external noise with it.
//   2. **lychee does not know how Fumadocs slugs a heading.** It reads the
//      rendered document's anchors; our pages are MDX compiled by
//      `fumadocs-mdx`, whose `remarkHeading` assigns ids with `github-slugger`
//      and honours a `[#custom-id]` suffix. A checker that computes ids any
//      other way can disagree with the site — which is the same class of defect
//      as not checking at all, only louder.
//   3. **It is not runnable locally.** `lychee.toml`'s own header asks authors
//      to run lychee before pushing; that costs a from-source Rust build in an
//      agent container. This is `node` + one dependency-free package.
//
// So `lychee.toml` keeps `include_fragments = "none"` and now says WHY, and the
// fragment half of the invariant is owned here.
//
// ## github-slugger is the single slug authority (the point of the exercise)
//
// `github-slugger@2.0.0` is not a lookalike of what the site does — it is
// literally the package `fumadocs-core@16.14.0` imports in
// `dist/mdx-plugins/remark-heading.js`, and the lockfile pins one copy of it
// for the whole workspace. This script constructs one `Slugger` per file and
// feeds it heading text in document order, exactly as `remarkHeading` does, so
// the duplicate-heading `-1` / `-2` suffixes line up too. The gate and the
// renderer cannot disagree about a slug, because they call the same function.
//
// What this script DOES have to reproduce is the text handed to the slugger:
// fumadocs passes `flattenNode(heading)`, the concatenation of every descendant
// mdast node's `value`. That is an inline-Markdown parse, and this file is a
// regex over lines. So the equivalence is MEASURED rather than asserted:
// `flattenHeadingText` was diffed against the real pipeline (`remark-parse` +
// `remark-mdx` + `remark-gfm` + `remark-frontmatter` + fumadocs-core's own
// `remarkHeading`) over the whole corpus — 397 files, 6955 headings, and after
// the two mismatches that sweep found were fixed, **zero** disagreements.
//
// The two it found are pinned in `--self-test`, because both were the same bug
// and it is the bug this shape invites: markup inside an inline code span is
// literal text, not markup. `### 8. \`<ObjectChart>\` axes bound to the wrong
// result column` and `### 3. Settings env overrides: canonical
// \`OS_<NAMESPACE>_<KEY>\` only` each lost their angle-bracketed run to a
// JSX-stripping pass that ran too early. Code spans are therefore masked FIRST
// and restored LAST, and everything else operates on the masked string.
//
// ## The fallout this landed with (measured, then fixed in the same PR)
//
// 200 internal fragment links across `content/**`, of which 4 pointed at
// headings that do not exist:
//
//   content/docs/automation/flows.mdx:240              #notify
//   content/docs/concepts/metadata-lifecycle.mdx:77    #overlay-whitelist
//   content/docs/permissions/authentication.mdx:75     /docs/deployment/cli#os-login--json-is-ndjson--the-one-exception
//   content/docs/protocol/kernel/http-protocol.mdx:764 /docs/api/client-sdk#clientdata--crud-operations
//
// Three of the four are the exact shape the card predicted — an anchor written
// from the heading a reader SEES, one dash off from the heading the slugger
// produces. They are fixed in the PR that adds this file, which is why there is
// no `KNOWN_*` baseline here: a gate that ships with an allowlist teaches that
// the allowlist is where new failures go.
//
// ## Scope, stated so the next reader does not have to infer it
//
//   - **Sources**: every `.mdx`/`.md` under `content/`, plus `README.md` and
//     `ARCHITECTURE.md` — the same corpus the lychee lane globs, so the two
//     gates cover one surface between them rather than two overlapping ones.
//     Those two render on GitHub rather than through Fumadocs, which is not a
//     second slug rule to model: `github-slugger` IS GitHub's algorithm, and
//     that is the package's entire reason to exist. The one thing GitHub does
//     NOT honour is the `[#custom-id]` suffix — neither file uses it, and a
//     `content/**` page that does is unaffected because it renders in Fumadocs.
//   - **Destinations**: internal links only. `http(s):`, `mailto:` and every
//     other scheme are out of scope BY DESIGN, for the reason in (1) above.
//   - **A link with no `#`** is lychee's, not this gate's: file existence is
//     already checked there and duplicating it would mean two gates with two
//     resolvers disagreeing about the same link.
//   - **A link WITH a `#` whose page does not resolve** is reported here, as
//     its own class. Skipping it would silently drop the anchor from coverage,
//     and "checked nothing, reported green" is the disease this card is about.
//   - Fenced code blocks and inline code spans are stripped before extraction,
//     so an illustrative link in an example is not a finding.
//
//   node scripts/check-doc-anchors.mjs
//   node scripts/check-doc-anchors.mjs --self-test   # verify the checker itself

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import Slugger from 'github-slugger';

import { stripCodeSpans, stripFencedBlocks } from './check-adr-links.mjs';
import { isEntrypoint } from './invoked-as.mjs';

/**
 * The page population this gate sweeps, as the repo-relative glob it really
 * reads — every `.md`/`.mdx` under the Fumadocs content root, `content/blog`
 * and `content/docs` alike.
 *
 * ## Why the glob is the constant and the root is derived from it (#9626)
 *
 * `scripts/pm/dispatch-gates.mjs` builds every dispatch's gate list by scanning
 * each gate's own source for the path literals it operates on, and a literal
 * with no path separator is a WORD, not a path — it is refused as too generic,
 * because `packages` and `apps` are path components dozens of gates join with
 * something else. Spelled `'content'`, this gate's population therefore
 * contributed no hint at all: `check:doc-anchors` scored `silent` for every
 * card under `content/**`, while being REQUIRED in lint.yml and the only
 * fragment coverage this repo has (`check-links.yml` sets
 * `include_fragments = "none"` and says so in its own header — a link to a
 * heading that does not exist is reported `[200] OK` there).
 *
 * Declaring the SUBTREE is what makes the declaration readable. The root is one
 * substring of it rather than a second constant, so the two cannot drift apart
 * — the failure that would otherwise replace a silent gate with a lying one.
 *
 * What this constant does NOT reach: `EXTRA_SOURCES` below. A top-level FILE
 * name carries no separator either, and teaching the scanner to accept one
 * would admit every `package.json` basename in the tree — that widening stays
 * refused, and `hintCovers`' docblock carries the measurement. Those two files
 * are declared instead, one line down, in the subtree spelling the extractor
 * already accepts; they no longer depend on a dispatching seat's judgment.
 */
const CONTENT_GLOB = 'content/**';

/** The Fumadocs content root — what `/` means in a site route, and what the
 *  lychee lane passes as `--root-dir`. */
const CONTENT_ROOT = CONTENT_GLOB.slice(0, CONTENT_GLOB.indexOf('/'));

/** Link sources outside `content/`, matching the lychee globs. */
const EXTRA_SOURCES = ['README.md', 'ARCHITECTURE.md'];

/**
 * `EXTRA_SOURCES` above, declared for `scripts/pm/dispatch-gates.mjs` (#9979,
 * applying #9964's pattern).
 *
 * `CONTENT_GLOB` closed the `content/**` half of this gap; these two files were
 * the remainder, and they are the ones it costs most to miss. This gate is
 * REQUIRED in lint.yml and is the repo's ONLY fragment coverage
 * (`check-links.yml` sets `include_fragments = "none"` and says so — a link to
 * a heading that does not exist is reported `[200] OK` there). Until this
 * declaration, a card editing only `README.md` or `ARCHITECTURE.md` derived
 * ZERO gates and met that coverage as red CI instead of as a local command.
 *
 * `<file>/**` is the form that reaches a repo-root file: the extractor requires
 * a separator, and `collapseHint` reduces the hint back to that one path before
 * comparing. Nothing in this tree lives under `README.md/` or
 * `ARCHITECTURE.md/`, so neither claims a directory, and a same-named file
 * inside one (a package's own `README.md`) is not reached — which is correct,
 * because this gate reads the repo-root pair and nothing else.
 *
 * ⚠️ Provenance, NOT a lookup key. `listSources` joins each `EXTRA_SOURCES`
 * entry with the repo root and stats it; the glob spelling appearing there
 * would make every extra source vanish from the sweep — silently, since
 * `existsSync` filters them out, which is the "checked nothing, reported green"
 * disease this file's own header opens with. The self-test pins both halves.
 */
const ROOT_FILE_WATCH_HINTS = ['README.md/**', 'ARCHITECTURE.md/**'];

const PAGE_EXTENSIONS = ['.mdx', '.md'];

/* --------------------------------------------------------------- heading ids */

/** ATX heading, including the optional closing `##` run CommonMark allows. */
const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;

/** Fumadocs' custom-id suffix — `## Heading [#custom-id]`, remark-heading.ts. */
const CUSTOM_ID = /\s*\[#([^\]]+?)]\s*$/;

/** Sentinel for a masked inline code span. Private-use, so no source can contain it. */
const MASK = '\uE000';

/**
 * Replace every inline code span with a sentinel, returning the literals.
 *
 * This runs FIRST and is undone LAST. Everything between the two operates on
 * the masked string, so `` `<ObjectChart>` `` and `` `OS_<NAMESPACE>_<KEY>` ``
 * survive the JSX and emphasis passes intact — the two corpus-wide parity
 * failures this file was born with.
 */
function maskCodeSpans(raw) {
  const codes = [];
  let out = '';
  let i = 0;
  while (i < raw.length) {
    if (raw[i] !== '`') {
      out += raw[i];
      i += 1;
      continue;
    }
    let open = 0;
    while (raw[i + open] === '`') open += 1;
    let j = i + open;
    let close = -1;
    while (j < raw.length) {
      if (raw[j] === '`') {
        let run = 0;
        while (raw[j + run] === '`') run += 1;
        if (run === open) {
          close = j;
          break;
        }
        j += run;
        continue;
      }
      j += 1;
    }
    if (close === -1) {
      out += raw.slice(i, i + open);
      i += open;
      continue;
    }
    let value = raw.slice(i + open, close);
    // CommonMark: one space is stripped from each end when both are present.
    if (value.length > 2 && value.startsWith(' ') && value.endsWith(' ') && value.trim() !== '') {
      value = value.slice(1, -1);
    }
    out += `${MASK}${codes.length}${MASK}`;
    codes.push(value);
    i = close + open;
  }
  return { masked: out, codes };
}

function unmask(text, codes) {
  return text.replace(new RegExp(`${MASK}(\\d+)${MASK}`, 'g'), (_, n) => codes[Number(n)] ?? '');
}

/**
 * Approximate fumadocs' `flattenNode(heading)` — the concatenation of every
 * descendant node's `value` — from one heading's raw Markdown.
 *
 * Verified equal to the real pipeline over the whole corpus; see the header.
 */
export function flattenHeadingText(raw) {
  const { masked, codes } = maskCodeSpans(raw);
  let s = masked;
  s = s.replace(/<\/?[A-Za-z][^>]*\/?>/g, ''); // mdxJsxTextElement carries no `value`
  s = s.replace(/!\[[^\]]*]\([^)]*\)/g, ''); // `image` has neither children nor `value`
  s = s.replace(/\[([^\]]*)]\([^)]*\)/g, '$1'); // inline link -> its text
  s = s.replace(/\[([^\]]*)]\[[^\]]*]/g, '$1'); // reference link -> its text
  // Emphasis/strong/strikethrough delimiters are syntax. An INTRAWORD `_` or
  // `*` is literal text under CommonMark's flanking rules (`snake_case` keeps
  // both underscores, and `github-slugger` keeps them in the slug), so only
  // runs on a word boundary are removed.
  s = s.replace(/(^|[^\p{L}\p{N}])([*_~]+)/gu, '$1');
  s = s.replace(/([*_~]+)($|[^\p{L}\p{N}])/gu, '$2');
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!~<>|])/g, '$1'); // backslash escapes
  return unmask(s, codes).trim();
}

/** Blank out a leading YAML frontmatter block, preserving line count. */
export function stripFrontmatter(text) {
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(text);
  if (!m) return text;
  return m[0].replace(/[^\n]/g, '') + text.slice(m[0].length);
}

/**
 * Every heading id one page renders, in document order.
 *
 * One `Slugger` per file, fed in document order — the duplicate-heading `-1` /
 * `-2` counters are part of the contract, not an accident.
 */
export function headingIds(markdown) {
  const slugger = new Slugger();
  const ids = [];
  for (const line of stripFencedBlocks(stripFrontmatter(markdown)).split('\n')) {
    const m = ATX_HEADING.exec(line);
    if (!m) continue;
    const raw = (m[2] ?? '').replace(/\s+#+\s*$/, '');
    // The custom-id probe runs on the MASKED text so a `[#x]` written inside a
    // code span is not mistaken for one — fumadocs only honours the suffix when
    // the heading's last child is a text node.
    const { masked, codes } = maskCodeSpans(raw);
    const custom = CUSTOM_ID.exec(masked);
    if (custom) {
      ids.push(unmask(custom[1], codes));
      continue;
    }
    ids.push(slugger.slug(flattenHeadingText(raw)));
  }
  return ids;
}

/* --------------------------------------------------------------------- links */

const INLINE_LINK = /!?\[[^\]]*]\(\s*([^)\s]*?)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const REFERENCE_DEFINITION = /^ {0,3}\[[^\]]+]:\s*(\S+)/;

/** A destination that names something in this repository, not a URL. */
function isInternal(dest) {
  if (!dest) return false;
  return !/^[a-z][a-z0-9+.\-]*:/i.test(dest) && !dest.startsWith('//');
}

/**
 * Every internal link destination carrying a `#fragment`, with its line.
 * Fenced blocks and code spans go first — that is the discrimination mechanism,
 * shared with `check-adr-links.mjs` so both gates read a document the same way.
 */
export function extractFragmentLinks(markdown) {
  const prose = stripCodeSpans(stripFencedBlocks(markdown));
  const found = [];
  prose.split('\n').forEach((line, idx) => {
    const dests = [];
    INLINE_LINK.lastIndex = 0;
    let m;
    while ((m = INLINE_LINK.exec(line)) !== null) dests.push(m[1]);
    const ref = REFERENCE_DEFINITION.exec(line);
    if (ref) dests.push(ref[1]);
    for (const dest of dests) {
      if (!isInternal(dest) || !dest.includes('#')) continue;
      const hash = dest.indexOf('#');
      const fragment = dest.slice(hash + 1);
      if (fragment === '') continue; // `foo#` names the page, not an anchor
      found.push({ line: idx + 1, dest, path: dest.slice(0, hash), fragment });
    }
  });
  return found;
}

/* ---------------------------------------------------------------- resolution */

/**
 * Map a site route (`/docs/permissions`) or a relative path onto the file that
 * renders it — the same rule the lychee lane asserts on its invocation
 * (`--root-dir <workspace>/content --fallback-extensions mdx,md`).
 */
export function resolvePage(root, fromFile, linkPath) {
  if (!linkPath) return fromFile; // a bare `#anchor` is same-document
  let p = linkPath.split('?')[0];
  try {
    p = decodeURIComponent(p);
  } catch {
    /* leave as written */
  }
  p = p.replace(/\/+$/, '');
  if (p === '') return fromFile;
  const base = p.startsWith('/') ? join(CONTENT_ROOT, p.slice(1)) : join(dirname(fromFile), p);
  const candidates = [
    base,
    ...PAGE_EXTENSIONS.map((e) => base + e),
    ...PAGE_EXTENSIONS.map((e) => join(base, `index${e}`)),
  ];
  for (const candidate of candidates) {
    const abs = join(root, candidate);
    if (existsSync(abs) && statSync(abs).isFile()) return relative(root, resolve(abs));
  }
  return null;
}

function listPages(root, dir) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && PAGE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)))
    .map((entry) => relative(root, join(entry.parentPath ?? abs, entry.name)))
    .sort();
}

function listSources(root) {
  return [...listPages(root, CONTENT_ROOT), ...EXTRA_SOURCES.filter((f) => existsSync(join(root, f)))];
}

/**
 * Sweep the corpus. Returns `{ checked, broken, unresolved, sources }` —
 * `checked` is the census of fragment links examined, so "clean corpus" can be
 * told apart from "the extractor stopped matching".
 */
export function sweep(root = process.cwd()) {
  const idCache = new Map();
  const idsOf = (file) => {
    if (!idCache.has(file)) idCache.set(file, new Set(headingIds(readFileSync(join(root, file), 'utf8'))));
    return idCache.get(file);
  };

  const broken = [];
  const unresolved = [];
  let checked = 0;
  const sources = listSources(root);

  for (const file of sources) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const link of extractFragmentLinks(text)) {
      const target = resolvePage(root, file, link.path);
      if (target === null) {
        unresolved.push({ file, ...link });
        continue;
      }
      checked += 1;
      if (!idsOf(target).has(link.fragment)) broken.push({ file, ...link, target });
    }
  }
  return { checked, broken, unresolved, sources: sources.length };
}

/* ---------------------------------------------------------------- reporting */

function describe(finding) {
  return (
    `  ${finding.file}:${finding.line}  ${finding.dest}\n` +
    `      ${finding.target} renders no heading with id "${finding.fragment}"`
  );
}

function runCheck() {
  const { checked, broken, unresolved, sources } = sweep();
  const problems = [];

  if (checked === 0) {
    problems.push(
      'No internal fragment links found in the docs corpus at all.\n' +
        '  A green run over nothing is not a green run: either the corpus moved or the\n' +
        '  extractor stopped matching. Fix the sweep, do not delete this guard.',
    );
  }

  if (broken.length > 0) {
    problems.push(
      `${broken.length} link(s) point at a heading that does not exist:\n` +
        broken.map(describe).join('\n') +
        '\n\n  The heading id is computed with `github-slugger`, the same package\n' +
        '  fumadocs-core uses to render the page, so what this gate says the anchor is\n' +
        '  is what the site says it is. Print a page\'s real ids with:\n' +
        "      node -e \"import('./scripts/check-doc-anchors.mjs').then(m=>console.log(m.headingIds(require('node:fs').readFileSync('<file>','utf8')).join('\\n')))\"\n" +
        '  Fix the link, or fix the heading. Do not add an exemption — an anchor that\n' +
        '  nobody may check is the defect this gate exists to remove (#7484).',
    );
  }

  if (unresolved.length > 0) {
    problems.push(
      `${unresolved.length} link(s) carry a #fragment but name a page that does not resolve:\n` +
        unresolved.map((u) => `  ${u.file}:${u.line}  ${u.dest}`).join('\n') +
        '\n\n  These are not skipped on purpose: an unresolvable page means the anchor was\n' +
        '  never checked, and silently uncovered is how this gap started.',
    );
  }

  if (problems.length > 0) {
    console.error(`❌ check-doc-anchors\n\n${problems.join('\n\n')}\n`);
    process.exit(1);
  }
  console.log(`✅ check-doc-anchors: ${checked} internal #fragment link(s) across ${sources} source file(s) all resolve to a real heading`);
}

/* ---------------------------------------------------------------- self-test */

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ check-doc-anchors --self-test: ${message}`);
    process.exit(1);
  }
}

/**
 * The two corpus-wide parity failures this file was born with. Both are the
 * same bug — markup inside an inline code span read as markup — and both are
 * live headings, so a regression fails here rather than on someone's PR.
 */
const PARITY_PINS = [
  ['### 8. `<ObjectChart>` axes bound to the wrong result column', '8-objectchart-axes-bound-to-the-wrong-result-column'],
  ['### 3. Settings env overrides: canonical `OS_<NAMESPACE>_<KEY>` only', '3-settings-env-overrides-canonical-os_namespace_key-only'],
];

function idOf(headingLine) {
  return headingIds(headingLine)[0];
}

function selfTest() {
  // 1. Slug parity with the renderer, on the two shapes that actually broke.
  for (const [heading, expected] of PARITY_PINS) {
    assert(idOf(heading) === expected, `parity pin failed: ${heading}\n   expected ${expected}\n   got      ${idOf(heading)}`);
  }

  // 2. The inline shapes the flattener has to get right.
  assert(idOf('## `os login --json` is NDJSON — the one exception') === 'os-login---json-is-ndjson--the-one-exception', 'code span + em dash');
  assert(idOf('## `client.data` — CRUD & Batch') === 'clientdata--crud--batch', 'code span + ampersand');
  assert(idOf('## **Bold** and *emphasis*') === 'bold-and-emphasis', 'emphasis delimiters are syntax');
  assert(idOf('## The `snake_case` rule') === 'the-snake_case-rule', 'intraword underscore is literal text');
  assert(idOf('## See [the CLI](/docs/deployment/cli) first') === 'see-the-cli-first', 'a link contributes its text, not its href');
  assert(idOf('## Closing hashes ##') === 'closing-hashes', 'ATX closing sequence');
  assert(idOf('## Dynamic approvers (#3447) [#dynamic-approvers-3447]') === 'dynamic-approvers-3447', 'fumadocs custom id');
  assert(idOf('## A `[#not-an-id]` code span') === 'a-not-an-id-code-span', 'a custom id inside a code span is not a custom id');

  // 3. Duplicate headings get the renderer's counter suffixes.
  const dupes = headingIds('## Overview\n## Overview\n## Overview\n');
  assert(
    dupes.join(',') === 'overview,overview-1,overview-2',
    `duplicate-heading counters drifted: ${dupes.join(',')}`,
  );

  // 4. Headings that are not headings.
  assert(headingIds('```md\n## Not a heading\n```\n').length === 0, 'a heading inside a fence is not a heading');
  assert(headingIds('---\ntitle: Frontmatter\n---\n\n## Real\n').join(',') === 'real', 'frontmatter is not a heading');

  // 5. Extraction discriminates prose from examples.
  const extracted = extractFragmentLinks(
    'See [a](/docs/x#good) and `[b](/docs/x#in-a-code-span)`.\n' +
      '```md\n[c](/docs/x#in-a-fence)\n```\n' +
      'External [d](https://example.com/y#skipped), page-only [e](/docs/x#).\n',
  );
  assert(
    extracted.map((l) => l.fragment).join(',') === 'good',
    `extractor picked up the wrong links: ${extracted.map((l) => l.dest).join(', ')}`,
  );

  // 6. End to end, on a synthetic corpus: a good anchor is silent, a dead one
  //    is found, and an unresolvable page is its own class. A discrimination
  //    rule that only ever says "nothing found" looks exactly like a broken
  //    extractor, so both directions are provoked.
  const tmp = mkdtempSync(join(tmpdir(), 'check-doc-anchors-'));
  try {
    const write = (rel, body) => {
      mkdirSync(dirname(join(tmp, rel)), { recursive: true });
      writeFileSync(join(tmp, rel), body);
    };
    write('content/docs/target.mdx', '---\ntitle: T\n---\n\n## Overlay whitelist (shared-DB tenancy invariant)\n');
    write(
      'content/docs/source.mdx',
      '---\ntitle: S\n---\n\n' +
        '[ok](/docs/target#overlay-whitelist-shared-db-tenancy-invariant)\n' +
        '[relative ok](./target#overlay-whitelist-shared-db-tenancy-invariant)\n' +
        '[dead](/docs/target#overlay-whitelist)\n' +
        '[no page](/docs/gone#anywhere)\n',
    );
    const result = sweep(tmp);
    assert(result.checked === 3, `expected 3 checked fragment links, got ${result.checked}`);
    assert(result.broken.length === 1 && result.broken[0].fragment === 'overlay-whitelist', 'the dead anchor was not reported');
    assert(result.unresolved.length === 1 && result.unresolved[0].path === '/docs/gone', 'the unresolvable page was not reported');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // 7. The census guard is load-bearing: it is the only thing that tells a
  //    clean corpus apart from an extractor that matches nothing.
  const live = sweep();
  assert(live.checked > 0, 'the real corpus yielded zero fragment links — the extractor is over-stripping');

  // 8. The dispatch-gates declaration (#9979). Enforcement cannot hold any of
  //    these: the declaration is read by another tool entirely, so a wrong or
  //    missing entry runs perfectly green here and shows up only as a dev
  //    dispatched on a README.md / ARCHITECTURE.md card who is not told that
  //    this REQUIRED gate — the repo's only fragment coverage — reads it.
  assert(
    EXTRA_SOURCES.every((f) => ROOT_FILE_WATCH_HINTS.includes(`${f}/**`)),
    `every extra source declares a root-file watch hint: ${EXTRA_SOURCES.join(', ')} vs ${ROOT_FILE_WATCH_HINTS.join(', ')}`,
  );
  assert(
    ROOT_FILE_WATCH_HINTS.every((h) => EXTRA_SOURCES.includes(h.replace(/\/\*+$/, ''))),
    `the declaration names no file this gate does not read: ${ROOT_FILE_WATCH_HINTS.join(', ')}`,
  );
  // Provenance, never a lookup key: `listSources` joins each EXTRA_SOURCES
  // entry with the repo root, so the glob form there would drop both from the
  // sweep — and `existsSync` would drop them SILENTLY.
  assert(
    !EXTRA_SOURCES.some((f) => ROOT_FILE_WATCH_HINTS.includes(f)),
    'the declared form is NOT an EXTRA_SOURCES entry — it would silently empty the extra-source half of the sweep',
  );
  // The population the declaration claims is the one the gate really reads.
  assert(
    ROOT_FILE_WATCH_HINTS.every((h) => listSources(process.cwd()).includes(h.replace(/\/\*+$/, ''))),
    'the declared root files are in the live source population this gate sweeps',
  );

  console.log(
    `✅ check-doc-anchors --self-test: slug parity, custom ids, duplicate counters, extraction discrimination and both finding classes verified (${live.checked} live fragment links)`,
  );
}

/* Run only when invoked as a program — the extractor and the slug helpers are
 * exported so a caller chasing a false positive can import them without the
 * import itself sweeping the repo. */
if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) selfTest();
  else runCheck();
}
