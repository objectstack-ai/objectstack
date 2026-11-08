#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-skill-links — every relative link in the published skills catalog
 * resolves: the file it names exists, and a `#fragment` on a markdown target
 * names a heading (or an HTML `id`/`name`) that file really carries.
 *
 *   node scripts/check-skill-links.mjs              # the gate
 *   node scripts/check-skill-links.mjs --self-test  # verify the checker itself, offline
 *
 * ## The contract it guards
 *
 * `skills/**` ships to customer agents verbatim (`@objectstack/skills`, and
 * `npx skills add` from `main`). A link is how one page hands the reader to the
 * rule it depends on, so a dead one is an instruction that ends mid-sentence:
 * the agent follows it, lands on the top of the wrong page (a missing fragment
 * scrolls nowhere) or on nothing, and carries on without the rule.
 *
 * ## The expected catch
 *
 * "Moved verbatim" refactors. A section moves from SKILL.md into a references/
 * or rules/ file (or back), the inbound links keep the old `../SKILL.md#slug`,
 * and every other skill gate stays green, because none of them reads links. The
 * 2026-11-02 review found three such links by hand, all of this one shape:
 * `objectstack-data/references/data-hooks.md` -> `../SKILL.md#lifecycle-hooks`,
 * `objectstack-platform/rules/plugin-lifecycle.md` ->
 * `../SKILL.md#complete-plugin-example`, and
 * `objectstack-platform/rules/service-registry.md` ->
 * `../SKILL.md#well-known-plugin-names--services`. The self-test reproduces that
 * shape and must red on it.
 *
 * ## The slug rule is the whole gate
 *
 * An ad-hoc walk flagged 71 links, 68 of them false: it slugged em-dash headings
 * wrong. A link checker with a wrong slug rule is noise, and noise gets
 * ignored, so the rule is GitHub's own (github-slugger), stated here and pinned
 * case by case in the self-test:
 *
 *   1. the heading's RENDERED text: code spans keep their content and lose the
 *      backticks; `[text](url)` keeps `text`; emphasis markers (`*`, `_` at a
 *      word edge, `~~`) and inline HTML tags drop; a backslash escape keeps the
 *      escaped character.
 *   2. lower-cased.
 *   3. every character that is not a letter, a mark, a number, a connector
 *      (`_`), a space or a hyphen is DELETED — so `—`, `:`, `&`, `/`, `(`, an
 *      emoji, all vanish without a trace.
 *   4. each space becomes ONE hyphen, with no collapsing: `A — B` reads
 *      `a  b` after step 3 and so slugs `a--b`. Double hyphens are legal and
 *      common in this catalog; a checker that collapses them reds every one.
 *   5. a repeated slug in one file gets `-1`, `-2`, … in document order.
 *
 * ## What is judged, and what is deliberately not
 *
 *   judged      every `[text](href)`, `![alt](src)` and `[id]: href` reference
 *               definition, in every `*.md` under a published skill, whose
 *               href is relative (no scheme, not `//host`, not `/root`).
 *   not judged  fenced code (an illustrative link such as `./crm_index.md`
 *               inside an example is not a link, it is the example); inline
 *               code spans; HTML comments; absolute URLs, `mailto:` and other
 *               schemes (reachability of the web is not this gate's question,
 *               and an offline gate cannot answer it); a fragment on a
 *               non-markdown target (`#L12` on a `.ts` file is GitHub's line
 *               anchor, not a heading).
 *
 * Whether a link that leaves `skills/` reaches a file that also SHIPS is a
 * different question (the published tarball carries `skills/` only); this gate
 * answers existence in the checkout, and says so rather than implying more.
 *
 * ## Exit codes
 *
 *   0  every judged link resolves
 *   1  at least one dead link — each named by file:line, href and what failed
 *   2  prerequisite not met — no skills root, no markdown found, or the lit
 *      control failed (the extractor stopped seeing the links it must see).
 *      Never 0: a gate that cannot find its input must say so.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = 'skills';
const EXIT_CLEAN = 0;
const EXIT_DEAD = 1;
const EXIT_PREREQUISITE = 2;

/**
 * The lit control: on the live tree the walk must see at least this many
 * judged links, and this many of them carrying a fragment. Measured on
 * 3a0aa915 (2026-11-08): 248 judged links, 120 with a fragment, 71 files. The
 * floors sit well below so ordinary pruning never reds; an extractor that
 * stops matching (a regex edit, a fence bug that swallows a file) falls far
 * under them and must say so instead of reporting a clean run over nothing.
 */
const LIT_CONTROL = Object.freeze({ links: 150, fragments: 60 });

/**
 * The half of this gate's population `scripts/pm/dispatch-gates.mjs` cannot
 * see, in the spelling it compares in: a bare `skills` carries no separator,
 * so without this a skills-only card would never be told this gate reads its
 * files. Provenance only — nothing below reads it.
 */
const ROOT_DIR_WATCH_HINTS = ['skills/**'];

// ── Corpus ──────────────────────────────────────────────────────────────────

/** Every `*.md` under `root/skills`, repo-relative POSIX paths, sorted. */
export function discoverMarkdown(root = REPO_ROOT) {
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const child = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(child);
      else if (e.isFile() && e.name.endsWith('.md')) out.push(child);
    }
  };
  walk(SKILLS_DIR);
  return out.sort();
}

/**
 * The lines of a markdown file with everything that is not rendered prose
 * blanked out, so line numbers survive: YAML frontmatter, fenced blocks (a
 * fence closes only on the same character, at least as long), and HTML
 * comments. Returned with a per-line flag the anchor pass reads.
 *
 * @returns {string[]}
 */
export function proseLines(text) {
  const lines = text.split('\n');
  const out = [];
  let fence = null;
  let comment = false;
  let front = lines[0] === '---';
  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];
    if (front) {
      out.push('');
      if (i > 0 && line === '---') front = false;
      continue;
    }
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = null;
      out.push('');
      continue;
    }
    if (f) { fence = f[1]; out.push(''); continue; }
    let kept = '';
    let rest = line;
    while (rest.length) {
      if (comment) {
        const end = rest.indexOf('-->');
        if (end < 0) { rest = ''; break; }
        comment = false;
        rest = rest.slice(end + 3);
        continue;
      }
      const start = rest.indexOf('<!--');
      if (start < 0) { kept += rest; break; }
      kept += rest.slice(0, start);
      comment = true;
      rest = rest.slice(start + 4);
    }
    out.push(kept);
  }
  return out;
}

/** A line with its inline code spans removed (a backticked link is not a link). */
function withoutCodeSpans(line) {
  return line.replace(/(`+)(?:(?!\1)[\s\S])*?\1/g, '');
}

// ── The slug rule (see the header) ──────────────────────────────────────────

/** The rendered text of a heading's inline markdown, before slugging. */
export function renderedHeadingText(raw) {
  const parts = raw.split(/(`+[^`]*`+)/);
  return parts.map((p, i) => {
    if (i % 2 === 1) return p.replace(/^`+|`+$/g, '');
    return p
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/\\(.)/g, '$1')
      .replace(/~~/g, '')
      .replace(/\*+/g, '')
      .replace(/(^|[^\p{L}\p{N}])_+|_+(?=[^\p{L}\p{N}]|$)/gu, '$1');
  }).join('');
}

/** GitHub's slug of one heading's text (no de-duplication; see `anchorsOf`). */
export function githubSlug(raw) {
  return renderedHeadingText(raw).trim().toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

/** Every fragment a markdown file answers: de-duplicated heading slugs plus HTML ids. */
export function anchorsOf(text) {
  const anchors = new Set();
  const seen = new Map();
  for (const line of proseLines(text)) {
    const h = /^\s{0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/.exec(line);
    if (h) {
      const base = githubSlug(h[1]);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      anchors.add(n === 0 ? base : `${base}-${n}`);
    }
    for (const a of line.matchAll(/<[a-z][^>]*?\s(?:id|name)=["']([^"']+)["']/gi)) anchors.add(a[1]);
  }
  return anchors;
}

// ── Links ───────────────────────────────────────────────────────────────────

/** True for an href this gate does not judge (a scheme, `//host`, or `/root`). */
export function isUnjudged(href) {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('/');
}

/**
 * Every judged link in one file.
 *
 * @returns {Array<{line: number, href: string}>}
 */
export function extractLinks(text) {
  const out = [];
  proseLines(text).forEach((raw, i) => {
    const line = withoutCodeSpans(raw);
    for (const m of line.matchAll(/\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g)) {
      const href = m[1].replace(/^<|>$/g, '');
      if (href && !isUnjudged(href)) out.push({ line: i + 1, href });
    }
    const def = /^\s{0,3}\[[^\]]+\]:\s*(<[^>]*>|\S+)/.exec(line);
    if (def) {
      const href = def[1].replace(/^<|>$/g, '');
      if (!isUnjudged(href)) out.push({ line: i + 1, href });
    }
  });
  return out;
}

const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };

/**
 * Judge every link in `files` against the tree `read`/`exists`/`isDir` describe.
 *
 * @param {string[]} files repo-relative POSIX paths
 * @returns {{dead: string[], links: number, fragments: number}}
 */
export function judge(files, { read, exists, isDir }) {
  const dead = [];
  const anchorCache = new Map();
  const anchorsFor = (rel) => {
    if (!anchorCache.has(rel)) anchorCache.set(rel, anchorsOf(read(rel)));
    return anchorCache.get(rel);
  };
  let links = 0;
  let fragments = 0;
  for (const file of files) {
    for (const { line, href } of extractLinks(read(file))) {
      links += 1;
      const hash = href.indexOf('#');
      const pathPart = decode((hash < 0 ? href : href.slice(0, hash)).split('?')[0]);
      const fragment = hash < 0 ? null : decode(href.slice(hash + 1));
      const target = pathPart === '' ? file
        : posix.normalize(posix.join(posix.dirname(file), pathPart)).replace(/(.)\/+$/, '$1');
      const where = `${file}:${line}`;
      if (target.startsWith('../') || target === '..') {
        dead.push(`[dead-file] ${where} links \`${href}\`, which climbs above the repository root. REMEDY: point it at the file it means.`);
        continue;
      }
      if (!exists(target)) {
        dead.push(`[dead-file] ${where} links \`${href}\` and \`${target}\` does not exist. REMEDY: point it at the page the rule now lives on, or delete the link.`);
        continue;
      }
      if (fragment === null || fragment === '') continue;
      if (isDir(target) || !target.endsWith('.md')) continue;
      fragments += 1;
      if (!anchorsFor(target).has(fragment)) {
        dead.push(`[dead-anchor] ${where} links \`${href}\` and \`${target}\` has no heading whose GitHub slug is \`${fragment}\`. `
          + 'This is the "moved verbatim" shape: the section moved, the link did not. REMEDY: re-point the link at the '
          + 'heading as it reads now (the slug rule is in this script\'s header), or at the file the section moved to.');
      }
    }
  }
  return { dead, links, fragments };
}

function liveTree(root) {
  return {
    read: (rel) => readFileSync(join(root, rel), 'utf8'),
    exists: (rel) => existsSync(join(root, rel)),
    isDir: (rel) => statSync(join(root, rel)).isDirectory(),
  };
}

/** The whole run over one checkout. @returns {{exit: number, lines: string[]}} */
export function runOver(root, { litControl = LIT_CONTROL } = {}) {
  if (!existsSync(join(root, SKILLS_DIR))) {
    return { exit: EXIT_PREREQUISITE, lines: [`PREREQUISITE NOT MET: ${SKILLS_DIR}/ does not exist under ${root}. A gate that cannot find its input must fail, never skip.`] };
  }
  const files = discoverMarkdown(root);
  if (files.length === 0) {
    return { exit: EXIT_PREREQUISITE, lines: [`PREREQUISITE NOT MET: no *.md under ${SKILLS_DIR}/ — the catalog moved, or the walk broke. Refusing to report a clean run over nothing.`] };
  }
  const result = judge(files, liveTree(root));
  if (result.links < litControl.links || result.fragments < litControl.fragments) {
    return { exit: EXIT_PREREQUISITE, lines: [`PREREQUISITE NOT MET: lit control failed — ${result.links} judged link(s), ${result.fragments} with a markdown fragment, over ${files.length} file(s) (floors ${litControl.links} / ${litControl.fragments}). The extractor no longer sees the links it must; fix it before trusting a green run.`] };
  }
  if (result.dead.length) {
    return { exit: EXIT_DEAD, lines: [...result.dead, `\n✗ check-skill-links: ${result.dead.length} dead link(s) in the published catalog.`] };
  }
  return { exit: EXIT_CLEAN, lines: [`✓ check-skill-links: ${result.links} relative link(s) in ${files.length} published skill file(s) resolve; ${result.fragments} fragment(s) name a real heading under GitHub's slug rule.`] };
}

// ── Self-test: batteries, floor, handshake ──────────────────────────────────
//
// Table-driven, copied from `check-skill-top-level-keys.mjs`: the ROW is the
// battery, its label is registered as the loop body's first statement, the
// roster below is a LITERAL the table is checked against (so a deleted row
// names itself), the roster's own size is pinned, and the verdict flag is set
// only after the success line prints.
let selfTestReachedVerdict = false;
const SELF_TEST_BATTERIES = Object.freeze({
  'slug: an em-dash heading keeps its double hyphen': 1,
  'slug: a code span keeps its text and loses its colon': 1,
  'slug: emphasis, links, HTML and escapes render to their text': 1,
  'slug: an intra-word underscore stays, an emphasis underscore goes': 1,
  'slug: an emoji leaves its space behind, so the slug opens with a hyphen': 1,
  'slug: a repeated heading takes -1, -2 in document order': 1,
  'anchors: a heading inside a fence or the frontmatter is no anchor': 1,
  'anchors: an HTML id is a target': 1,
  'the reproduction — the three moved-verbatim links red, each by file:line': 1,
  'a clean corpus with every link shape → exit 0': 1,
  'a missing file → [dead-file]': 1,
  'a same-file fragment is judged against the same file': 1,
  'a reference definition is judged': 1,
  'a percent-encoded fragment is decoded before matching': 1,
  'a link inside a fence, a code span or an HTML comment is not judged': 1,
  'absolute URLs, mailto and root paths are not judged': 1,
  'a fragment on a non-markdown target is not judged': 1,
  'a link climbing above the repository root → [dead-file]': 1,
  'no skills root → exit 2': 1,
  'a skills root with no markdown → exit 2': 1,
  'lit control — a corpus under the floors → exit 2, never 0': 1,
  'live tree — the real catalog clears the lit control': 1,
});
const SELF_TEST_BATTERY_FLOOR = 22;

function selfTest() {
  const tree = (files) => {
    const map = new Map(Object.entries(files));
    const dirs = new Set();
    for (const p of map.keys()) for (let d = posix.dirname(p); d !== '.'; d = posix.dirname(d)) dirs.add(d);
    return {
      files: [...map.keys()].filter((p) => p.endsWith('.md')).sort(),
      io: { read: (p) => map.get(p), exists: (p) => map.has(p) || dirs.has(p), isDir: (p) => dirs.has(p) },
    };
  };
  const judgeTree = (files) => { const t = tree(files); return judge(t.files, t.io); };
  const withRoot = (files, fn) => {
    const root = mkdtempSync(join(tmpdir(), 'skill-links-'));
    try {
      for (const [rel, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, rel)), { recursive: true });
        writeFileSync(join(root, rel), text);
      }
      return fn(root);
    } finally { rmSync(root, { recursive: true, force: true }); }
  };
  const has = (text, anchor) => anchorsOf(text).has(anchor);

  // The SKILL.md each reproduction link pointed at, after the section moved out.
  const MOVED_SKILL = '# Skill\n\n## Hooks\n\nSee [data hooks](./references/data-hooks.md#lifecycle-hooks).\n\n## Plugins\n';
  const MOVED_HOOKS = '# Data hooks\n\n## Lifecycle hooks\n\nBack to [the skill](../SKILL.md#lifecycle-hooks).\n';
  const MOVED_PLATFORM = '# Platform\n\n## Plugin system\n';
  const MOVED_LIFECYCLE = '# Plugin lifecycle\n\nSee [the example](../SKILL.md#complete-plugin-example).\n';
  const MOVED_REGISTRY = '# Service registry\n\nSee [the names](../SKILL.md#well-known-plugin-names--services).\n';

  const CLEAN = {
    'skills/a/SKILL.md': [
      '---', 'name: a', 'description: "# not a heading"', '---', '',
      '# A', '',
      '## Pages — Lightning-style page layouts', '',
      '### `requires:` — which service plugins boot', '',
      '## Data & Filters', '',
      'Same file: [pages](#pages--lightning-style-page-layouts), [requires](#requires--which-service-plugins-boot).',
      'Other file: [b](./rules/b.md#one-to-many-master_detail "a title"), [dir](./rules/), [img](./rules/pic.png).',
      'Reference: [ref][r].', '', '[r]: ./rules/b.md#the-b-rule', '',
    ].join('\n'),
    'skills/a/rules/b.md': '# The B rule\n\n### One-to-Many: master_detail\n\nBack: [a](../SKILL.md#data--filters).\n',
    'skills/a/rules/pic.png': 'x',
  };

  const cases = [
    { label: 'slug: an em-dash heading keeps its double hyphen', run: () => githubSlug('Pages — Lightning-style page layouts') === 'pages--lightning-style-page-layouts' },
    { label: 'slug: a code span keeps its text and loses its colon', run: () => githubSlug('`requires:` — which service plugins boot') === 'requires--which-service-plugins-boot' },
    { label: 'slug: emphasis, links, HTML and escapes render to their text', run: () => githubSlug('**Bold** [link](./x.md) <sup>2</sup> \\*star ~~gone~~') === 'bold-link-2-star-gone' },
    { label: 'slug: an intra-word underscore stays, an emphasis underscore goes', run: () => githubSlug('One-to-Many: master_detail and _emphasis_') === 'one-to-many-master_detail-and-emphasis' },
    { label: 'slug: an emoji leaves its space behind, so the slug opens with a hyphen', run: () => githubSlug('❌ Incorrect — Using lookup') === '-incorrect--using-lookup' },
    { label: 'slug: a repeated heading takes -1, -2 in document order', run: () => { const t = '## Example\n## Example\n## Example\n'; return has(t, 'example') && has(t, 'example-1') && has(t, 'example-2') && !has(t, 'example-3'); } },
    { label: 'anchors: a heading inside a fence or the frontmatter is no anchor', run: () => { const t = '---\ntitle: x\n# fm\n---\n```bash\n# comment\n```\n## Real\n'; return has(t, 'real') && !has(t, 'comment') && !has(t, 'fm'); } },
    { label: 'anchors: an HTML id is a target', run: () => has('Text <a id="custom-anchor"></a> more\n', 'custom-anchor') },
    { label: 'the reproduction — the three moved-verbatim links red, each by file:line', run: () => {
      const r = judgeTree({
        'skills/objectstack-data/SKILL.md': MOVED_SKILL,
        'skills/objectstack-data/references/data-hooks.md': MOVED_HOOKS,
        'skills/objectstack-platform/SKILL.md': MOVED_PLATFORM,
        'skills/objectstack-platform/rules/plugin-lifecycle.md': MOVED_LIFECYCLE,
        'skills/objectstack-platform/rules/service-registry.md': MOVED_REGISTRY,
      });
      const at = r.dead.map((d) => /\] (\S+) /.exec(d)[1]).sort().join(' ');
      return r.dead.length === 3 && r.dead.every((d) => d.startsWith('[dead-anchor]'))
        && at === 'skills/objectstack-data/references/data-hooks.md:5 skills/objectstack-platform/rules/plugin-lifecycle.md:3 skills/objectstack-platform/rules/service-registry.md:3';
    } },
    { label: 'a clean corpus with every link shape → exit 0', run: () => { const r = judgeTree(CLEAN); return r.dead.length === 0 && r.links === 7 && r.fragments === 5; } },
    { label: 'a missing file → [dead-file]', run: () => { const r = judgeTree({ 'skills/a/SKILL.md': 'See [x](./rules/gone.md).\n' }); return r.dead.length === 1 && r.dead[0].startsWith('[dead-file] skills/a/SKILL.md:1') && r.dead[0].includes('skills/a/rules/gone.md'); } },
    { label: 'a same-file fragment is judged against the same file', run: () => { const r = judgeTree({ 'skills/a/SKILL.md': '## Here\n\n[ok](#here) [bad](#there)\n' }); return r.dead.length === 1 && r.dead[0].includes('`#there`'); } },
    { label: 'a reference definition is judged', run: () => { const r = judgeTree({ 'skills/a/SKILL.md': '# A\n\n[r]: ./b.md\n' }); return r.dead.length === 1 && r.dead[0].startsWith('[dead-file] skills/a/SKILL.md:3'); } },
    { label: 'a percent-encoded fragment is decoded before matching', run: () => judgeTree({ 'skills/a/SKILL.md': '## Café menu\n\n[x](#caf%C3%A9-menu)\n' }).dead.length === 0 },
    { label: 'a link inside a fence, a code span or an HTML comment is not judged', run: () => { const r = judgeTree({ 'skills/a/SKILL.md': '```md\n[x](./crm_index.md)\n```\n\n`[y](./gone.md)`\n\n<!-- [z](./gone.md) -->\n' }); return r.dead.length === 0 && r.links === 0; } },
    { label: 'absolute URLs, mailto and root paths are not judged', run: () => { const r = judgeTree({ 'skills/a/SKILL.md': '[a](https://objectstack.ai/x#y) [b](mailto:a@b.c) [c](//cdn.example/x) [d](/docs/x)\n' }); return r.dead.length === 0 && r.links === 0; } },
    { label: 'a fragment on a non-markdown target is not judged', run: () => { const r = judgeTree({ 'skills/a/SKILL.md': '[src](./x.ts#L12)\n', 'skills/a/x.ts': '' }); return r.dead.length === 0 && r.links === 1 && r.fragments === 0; } },
    { label: 'a link climbing above the repository root → [dead-file]', run: () => { const r = judgeTree({ 'skills/a/SKILL.md': '[x](../../../outside.md)\n' }); return r.dead.length === 1 && r.dead[0].includes('climbs above the repository root'); } },
    { label: 'no skills root → exit 2', run: () => withRoot({ 'other/x.md': '# x\n' }, (root) => runOver(root).exit === EXIT_PREREQUISITE) },
    { label: 'a skills root with no markdown → exit 2', run: () => withRoot({ 'skills/a/x.json': '{}' }, (root) => { const r = runOver(root); return r.exit === EXIT_PREREQUISITE && r.lines[0].includes('no *.md'); }) },
    { label: 'lit control — a corpus under the floors → exit 2, never 0', run: () => withRoot(CLEAN, (root) => { const r = runOver(root); return r.exit === EXIT_PREREQUISITE && r.lines[0].includes('lit control failed') && runOver(root, { litControl: { links: 1, fragments: 1 } }).exit === EXIT_CLEAN; }) },
    { label: 'live tree — the real catalog clears the lit control', run: () => { const files = discoverMarkdown(); const r = judge(files, liveTree(REPO_ROOT)); return files.length > 0 && r.links >= LIT_CONTROL.links && r.fragments >= LIT_CONTROL.fragments; } },
  ];

  const seen = new Map();
  let failed = 0;
  for (const c of cases) {
    seen.set(c.label, (seen.get(c.label) ?? 0) + 1);
    let ok = false;
    try { ok = c.run(); } catch (e) { console.error(`  ✗ ${c.label} — threw ${e.message}`); failed += 1; continue; }
    if (ok) console.log(`  ✓ ${c.label}`); else { console.error(`  ✗ ${c.label}`); failed += 1; }
  }
  const declared = Object.keys(SELF_TEST_BATTERIES);
  const floor = (msg) => { console.error(`✗ self-test floor: ${msg}`); failed += 1; };
  if (declared.length < SELF_TEST_BATTERY_FLOOR) floor(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}.`);
  for (const [name] of seen) if (!declared.includes(name)) floor(`case "${name}" is attributed to no declared battery.`);
  for (const name of declared) if ((seen.get(name) ?? 0) < SELF_TEST_BATTERIES[name]) floor(`battery "${name}" DID NOT RUN (${seen.get(name) ?? 0} of ${SELF_TEST_BATTERIES[name]} pinned).`);
  if (failed > 0) { console.error(`\n✗ check-skill-links self-test: ${failed} failure(s) (cases and floor).`); process.exit(1); }
  console.log(`\n✓ check-skill-links self-test: ${cases.length} cases pass.`);
  selfTestReachedVerdict = true;
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) { console.error('\n✗ check-skill-links self-test: selfTest() returned without reaching its verdict.'); process.exit(1); }
    return;
  }
  const verdict = runOver(REPO_ROOT);
  for (const l of verdict.lines) (verdict.exit === EXIT_CLEAN ? console.log : console.error)(l);
  process.exit(verdict.exit);
}

if (isEntrypoint(import.meta.url)) main();
