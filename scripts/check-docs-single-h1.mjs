#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-docs-single-h1 (#12236) — no page under `content/docs/**` may contain a
// body-level `# ` heading, because the site already renders one `<h1>` per page
// from the frontmatter `title` and a second one is not authorable, it is a bug.
//
//   node scripts/check-docs-single-h1.mjs
//   node scripts/check-docs-single-h1.mjs --list       # every page and its verdict
//   node scripts/check-docs-single-h1.mjs --self-test  # prove the battery can go red
//
// ## The invariant, and where the other `<h1>` comes from
//
// `apps/docs/app/[lang]/docs/[[...slug]]/page.tsx` renders every doc page as
//
//     <DocsTitle>{page.data.title}</DocsTitle>
//     ...
//     <DocsBody><MDX /></DocsBody>
//
// `DocsTitle` is an `<h1>`. So the frontmatter `title` IS the page's heading-one,
// unconditionally, on all 403 pages — and any `# ` the author writes in the body
// compiles to a SECOND `<h1>` inside `DocsBody`. Measured on the dev server at
// `/docs/data-modeling/objects` before this gate landed: two `<h1>` elements,
// both reading `Object Metadata`, because the page's frontmatter said
// `title: Object Metadata` and its body opened with `# Object Metadata`.
//
// That was true of 195 of the 403 pages, and on 138 of those the two `<h1>` were
// the same rendered string. Two `<h1>` split the strongest on-page signal a
// document has and a screen reader announces the title twice.
//
// The remedy has two shapes and this gate names which one applies (see
// `remedyFor`): when the body heading renders the same text as the title, DELETE
// it — the page loses nothing. When it says something different, DEMOTE it to
// `## `, which keeps the wording and keeps the slug, so no inbound `#anchor`
// breaks. Levels below one are never a finding: this gate has exactly one
// opinion and `check:doc-anchors` owns the rest of the heading surface.
//
// ## Why fenced code is stripped FIRST, and why that is the whole gate
//
// This is the measurement that decides whether this file is a gate or a hazard.
// A naive `^# ` scan over `content/docs/**` reports 205 files. The real number is
// 195. The ten-file gap is entirely shell and YAML comments inside fenced code
// blocks — they open a line with `# ` and render as CODE, not as a heading:
//
//     content/docs/getting-started/index.mdx      # Install pnpm globally
//     content/docs/protocol/objectql/index.mdx    # customer.object.yml
//     content/docs/upgrading.mdx                  # docker-compose.yml, or your ...
//     ...and seven more
//
// A fence-blind gate does not merely over-report by ten. It instructs an author
// — or a script-driven sweep, which is how a 195-file change gets made — to
// delete or demote a line inside a working example, silently corrupting ten
// copy-pasteable snippets to satisfy a check about HTML that those lines never
// produced. The false positive here is more expensive than the defect.
//
// So `stripFencedBlocks` runs before anything looks for a heading, and the
// self-test carries a control for both fence spellings (``` and ~~~).
//
// ## Why nothing here re-models Markdown
//
// Three things had to be decided — where the frontmatter ends, where a fenced
// block ends, and what text a heading renders as — and this repo already owns an
// answer to each. `stripFrontmatter` and `flattenHeadingText` are imported from
// `check-doc-anchors.mjs` and `stripFencedBlocks` from `check-adr-links.mjs`;
// none of the three is retyped here.
//
// That is not tidiness, it is the correctness argument. `flattenHeadingText` was
// diffed against the real fumadocs pipeline over the whole corpus (397 files,
// 6955 headings, zero disagreements — see that file's header) and it is what
// makes the delete-vs-demote call right on nine pages where the two headings
// differ ONLY by inline markup:
//
//     content/docs/kernel/runtime-services/audit-service.mdx
//       title: services.audit          h1: `services.audit`
//
// Byte-compared, those two strings differ and the remedy reads "demote" — which
// would leave a `## services.audit` sitting directly under an `<h1>services.audit`,
// preserving the duplicate this gate exists to remove, one level down. Compared
// as RENDERED TEXT they are equal and the remedy is "delete", which is correct.
// A second, private heading-text model in this file would have gotten those nine
// wrong, and a gate disagreeing with the renderer about what a page says is the
// same class of defect as no gate at all.
//
// ## Scope: no tree is excluded, and the exclusions are self-retiring
//
// `EXCLUSIONS` carves out SUBTREES — never individual files. A file allowlist
// is where new failures go to be forgotten; a subtree with a named owner is a
// statement about who fixes that tree.
//
// **It is EMPTY, and empty is the goal state.** Both entries it has ever
// carried were retired by the same limb:
//
// **An exclusion whose tree is CLEAN is a failure, not a pass.** The gate goes
// red with `DEAD-EXCLUSION` and asks for its own carve-out to be deleted.
// Without that limb an exclusion would outlive its reason and quietly shrink
// the gate's scope forever — the vacuous-green shape (#4690) that this repo
// treats as worse than no check.
//
//   - `content/docs/references/**` — 38 generated pages whose `# ` came from a
//     JSDoc file header that `packages/spec/scripts/build-docs.ts` copied
//     verbatim, so a hand-edit did not merely get reverted at the next
//     generator run — `check:docs` regenerates the tree and fails on any
//     difference, so it shipped CI-red immediately. #12249 fixed it where it
//     was fixable, in the generator, which now renumbers a file header's
//     headings to start at the page's section level; this gate went
//     `DEAD-EXCLUSION` on the regenerated tree and the entry came out in that
//     same change.
//
//   - `content/docs/releases/**` — `CLAUDE.md` puts a hard stop on this
//     directory, and three of its four violations were not mechanical: the `# `
//     headings in `v15`/`v16`/`v17.mdx` were real top-level dividers with `##`
//     children, so demoting one alone would have made it a sibling of its own
//     subsections. #12250 cascaded those three instead — from each page's first
//     body `# ` to EOF, every heading moved down one level, so an "in detail"
//     section still owns its subsections — and deleted the one heading that
//     merely repeated its frontmatter title. It shipped as a dedicated
//     docs-only PR, which is that `CLAUDE.md` rule's own escape hatch. This
//     gate went `DEAD-EXCLUSION` on the cleaned tree and the entry came out in
//     that same change.
//
// So the limb has been paid out TWICE, which is the whole of the evidence that
// it works — and with the list empty, the live corpus exercises none of the
// machinery it belongs to. That is why `scanTree` takes its exclusions as a
// PARAMETER and the self-test drives them through a SYNTHETIC carve-out: an
// `exclusionFor`, an `excluded` tally and a `DEAD-EXCLUSION` limb that only
// ever ran against entries which no longer exist would be untested code by the
// time a third carve-out needs them.
//
// The same reasoning gives the corpus-level limb: a run that reads ZERO pages
// exits 1. "Nothing differs" must never be reachable by checking nothing.
//
// ## Why this cannot be a `check:doc-authoring` rule
//
// `check-doc-authoring.mjs` judges CODE BLOCKS in docs; this judges the prose
// around them, and its central operation — strip the code blocks first — is that
// gate's population inverted. Sharing a file would mean one scanner holding both
// a "look only inside fences" and a "look only outside fences" mode, which is
// two gates in a trench coat.
//
// ## Cost
//
// One filesystem read of 403 files and a line scan. Sub-second, no build, no
// network. It reads `yaml` only to name the remedy — see `remedyFor` — and the
// finding itself does not depend on the frontmatter parsing at all.

import { readFileSync, readdirSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireDependency } from './import-prerequisite.mjs';
const { parse } = await requireDependency('yaml', () => import('yaml'), import.meta.url, {
  measures: 'any page under content/docs/** contains a body-level `# ` heading',
});

import { stripFencedBlocks } from './check-adr-links.mjs';
import { flattenHeadingText, stripFrontmatter } from './check-doc-anchors.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const REPO_ROOT = resolve(HERE, '..');

/**
 * The population this gate sweeps, as the repo-relative subtree it really reads.
 *
 * Spelled as a subtree WITH a separator on purpose: `scripts/pm/dispatch-gates.mjs`
 * derives a dispatch's gate list by scanning each gate for the path literals it
 * operates on, and refuses a literal with no separator as a WORD rather than a
 * path. Spelled `'content'` this gate would contribute no hint at all and would
 * score `silent` for every card editing a doc page — the same gap #9626 closed
 * for `check:doc-anchors`.
 */
const PAGE_GLOB = 'content/docs/**';

/** The tree `PAGE_GLOB` names, derived from it so the two cannot drift apart. */
const PAGE_ROOT = PAGE_GLOB.slice(0, PAGE_GLOB.lastIndexOf('/'));

/** `.mdx` only: `defineDocs` compiles these, and `content/docs` holds nothing else. */
const PAGE_EXTENSION = '.mdx';

/**
 * Subtrees this gate does not judge, each with the issue that will make it
 * empty. Read the header's "Scope" section before adding one: an entry whose
 * tree is clean FAILS, so every line here has a finite life — and both entries
 * this list has ever carried died that way (#12249, then #12250).
 *
 * Empty is the goal state, and it is where the list now is. The machinery it
 * feeds stays: it is how the next carve-out gets a named owner and a death
 * date. `selfTest` keeps that machinery honest with a synthetic entry, because
 * an empty live list exercises none of it.
 */
const EXCLUSIONS = [];

/** ATX heading: CommonMark allows up to three leading spaces. */
const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;

/** Fumadocs' custom-id suffix — `## Heading [#custom-id]`, remark-heading.ts. */
const CUSTOM_ID = /\s*\[#([^\]]+?)]\s*$/;

/* ------------------------------------------------------------------ scanning */

/** Every `.mdx` under `dir`, recursively, in a stable order. */
export function listPages(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listPages(full, out);
    else if (entry.name.endsWith(PAGE_EXTENSION)) out.push(full);
  }
  return out;
}

/**
 * Every body-level `# ` heading one page contains, as `{ line, raw, text }`.
 *
 * Frontmatter and fenced code are blanked first, both line-count preserving, so
 * a reported line number indexes the real file. See the header for why the fence
 * pass is the load-bearing half.
 */
export function bodyH1s(markdown) {
  const lines = stripFencedBlocks(stripFrontmatter(markdown)).split('\n');
  const found = [];
  lines.forEach((line, i) => {
    const m = ATX_HEADING.exec(line);
    if (!m || m[1].length !== 1) return;
    const raw = (m[2] ?? '').replace(/\s+#+\s*$/, '');
    found.push({ line: i + 1, raw: line, text: flattenHeadingText(raw.replace(CUSTOM_ID, '')) });
  });
  return found;
}

/** The frontmatter `title`, or `null` when there is none this gate can read. */
export function frontmatterTitle(markdown) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(markdown);
  if (!m) return null;
  try {
    const doc = parse(m[1]);
    return doc && typeof doc.title === 'string' ? doc.title : null;
  } catch {
    // A page whose frontmatter does not parse is `check:doc-frontmatter`'s
    // finding, not this gate's. The heading is still reported; only the remedy
    // hint degrades.
    return null;
  }
}

/**
 * Which of the two fixes this heading wants.
 *
 * A HINT attached to a finding, never part of the verdict: the finding is "this
 * page contains a body `# ` heading", which is true whatever the frontmatter
 * says. Comparison is on RENDERED text, trimmed and case-folded — see the
 * header for the nine pages that turn on exactly this.
 */
export function remedyFor(headingText, title) {
  const norm = (s) => (s ?? '').trim().toLowerCase();
  if (title !== null && norm(headingText) === norm(title)) {
    return { kind: 'delete', detail: 'renders the same text as the frontmatter title — delete the line' };
  }
  return { kind: 'demote', detail: 'says something the title does not — demote it to `## ` (keeps the wording and the slug)' };
}

/** The exclusion covering `relPath`, or `null`. */
function exclusionFor(relPath, exclusions = EXCLUSIONS) {
  return exclusions.find((e) => relPath.startsWith(e.prefix)) ?? null;
}

/**
 * Judge one tree. Returns `{ findings, excluded, scanned }` — `excluded` is
 * keyed by exclusion prefix so the caller can enforce the dead-exclusion rule.
 *
 * `exclusions` is a parameter rather than a read of the module constant so the
 * self-test can drive the carve-out machinery with a synthetic entry. The live
 * list is empty (see its docstring); without this seam every exclusion case
 * would pass by having nothing to check.
 */
export function scanTree(root, repoRoot = REPO_ROOT, exclusions = EXCLUSIONS) {
  const findings = [];
  const excluded = new Map(exclusions.map((e) => [e.prefix, []]));
  let scanned = 0;

  for (const abs of listPages(root)) {
    const rel = relative(repoRoot, abs).split('\\').join('/');
    const src = readFileSync(abs, 'utf8');
    const headings = bodyH1s(src);
    const exclusion = exclusionFor(rel, exclusions);
    if (exclusion) {
      if (headings.length) excluded.get(exclusion.prefix).push({ rel, headings });
      continue;
    }
    scanned += 1;
    if (!headings.length) continue;
    const title = frontmatterTitle(src);
    for (const h of headings) {
      findings.push({ rel, line: h.line, raw: h.raw.trim(), ...remedyFor(h.text, title) });
    }
  }
  return { findings, excluded, scanned };
}

/* ---------------------------------------------------------------------- main */

function main(argv) {
  const root = join(REPO_ROOT, PAGE_ROOT);
  const { findings, excluded, scanned } = scanTree(root);

  if (argv.includes('--list')) {
    for (const abs of listPages(root)) {
      const rel = relative(REPO_ROOT, abs).split('\\').join('/');
      const ex = exclusionFor(rel);
      const n = bodyH1s(readFileSync(abs, 'utf8')).length;
      console.log(`${ex ? 'EXCLUDED' : n ? 'FINDING ' : 'ok      '}  ${rel}${n ? `  (${n} body h1)` : ''}`);
    }
    return 0;
  }

  // Anti-vacuity: reading nothing must never read as success.
  if (scanned === 0) {
    console.error(
      `✗ check-docs-single-h1 read ZERO judgeable pages under ${PAGE_ROOT}/.\n` +
        `  Nothing was measured, so this exit code says nothing about the corpus.\n` +
        `  Either the tree moved, or every page fell into an EXCLUSIONS subtree.`,
    );
    return 1;
  }

  let failed = false;

  if (findings.length) {
    failed = true;
    console.error(`✗ ${findings.length} body-level \`# \` heading(s) in ${PAGE_ROOT}/ — each renders a SECOND <h1>:\n`);
    for (const f of findings) {
      console.error(`  ${f.rel}:${f.line}`);
      console.error(`    ${f.raw}`);
      console.error(`    → ${f.kind.toUpperCase()}: ${f.detail}\n`);
    }
    console.error(
      `  \`DocsTitle\` already renders the frontmatter \`title\` as this page's <h1>\n` +
        `  (apps/docs/app/[lang]/docs/[[...slug]]/page.tsx). A body \`# \` is a second one.\n`,
    );
  }

  // A carve-out that no longer carves anything out must be deleted, in the same
  // change that made it empty. See the header's "Scope" section.
  for (const e of EXCLUSIONS) {
    const hits = excluded.get(e.prefix);
    if (hits.length) {
      console.error(`ℹ EXCLUDED ${e.prefix}** — ${hits.length} page(s) still carry a body \`# \` heading, owned by ${e.owner}`);
      continue;
    }
    failed = true;
    console.error(
      `✗ DEAD-EXCLUSION: ${e.prefix}** is clean, so its EXCLUSIONS entry checks nothing.\n` +
        `  ${e.owner} appears to have landed. Delete that entry from scripts/check-docs-single-h1.mjs\n` +
        `  in the same change, so the gate's scope grows back with the fix.\n`,
    );
  }

  if (failed) return 1;
  console.log(
    `✓ check-docs-single-h1: ${scanned} page(s) under ${PAGE_ROOT}/ carry no body-level \`# \` heading ` +
      `(${EXCLUSIONS.length} subtree(s) excluded, see --list).`,
  );
  return 0;
}

/* ----------------------------------------------------------------- self-test */

/**
 * Positive AND negative controls over a real temp tree, running the real
 * `scanTree`. A live corpus that is green cannot tell a working gate from a
 * blind one, and this gate lands with its corpus green by construction.
 */
export function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => cases.push({ name, ok: Boolean(ok), detail });

  const dir = mkdtempSync(join(tmpdir(), 'docs-single-h1-'));
  try {
    const write = (rel, body) => {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    };
    const fm = (title) => `---\ntitle: ${title}\n---\n\n`;

    write('content/docs/clean.mdx', `${fm('Clean Page')}Prose with no heading-one.\n\n## A section\n`);
    write('content/docs/dup.mdx', `${fm('Object Metadata')}# Object Metadata\n\nProse.\n`);
    write('content/docs/differs.mdx', `${fm('Command Line Interface')}# @objectstack/cli\n\nProse.\n`);
    // THE control: the ten real pages whose only `# ` line is a shell comment.
    write('content/docs/fenced.mdx', `${fm('Fenced')}Prose.\n\n\`\`\`bash\n# Install pnpm globally\nnpm i -g pnpm\n\`\`\`\n`);
    write('content/docs/fenced-tilde.mdx', `${fm('Tilde')}Prose.\n\n~~~yaml\n# customer.object.yml\nname: customer\n~~~\n`);
    // Inline-markup-only difference: renders identically, so DELETE, not demote.
    write('content/docs/inline-code.mdx', `${fm('services.audit')}# \`services.audit\`\n\nProse.\n`);
    // Not headings: no space after the hash, and a level-two heading.
    write('content/docs/not-a-heading.mdx', `${fm('Nope')}#NotAHeading\n\n## A real section\n`);
    // CommonMark allows up to three leading spaces.
    write('content/docs/indented.mdx', `${fm('Indented')}   # Indented Heading\n\nProse.\n`);
    // A `# ` in the frontmatter block itself is not body content.
    write('content/docs/fm-hash.mdx', `---\ntitle: Hashy\ndescription: "# not a heading"\n---\n\nProse.\n`);
    // NOT excluded any more (#12250): the release pages are judged like every
    // other page now. Kept as a fixture — with the carve-out gone this is the
    // control proving the tree is back in scope rather than silently unread,
    // and `# 9.0.0 in detail` is the exact shape that carve-out existed for.
    write('content/docs/releases/v9.mdx', `${fm('v9.0.0')}# 9.0.0 in detail\n\nProse.\n`);
    // NOT excluded any more (#12249): the generated tree is judged like every
    // other page now. Kept as a fixture — with the carve-out gone this is the
    // control proving the tree is back in scope rather than silently unread.
    write('content/docs/references/gen.mdx', `${fm('Gen')}# Why this lives in \`spec\`\n\nProse.\n`);

    const root = join(dir, 'content/docs');
    const { findings, excluded, scanned } = scanTree(root, dir);
    const at = (rel) => findings.filter((f) => f.rel === rel);

    t('a page with no body h1 is not a finding', at('content/docs/clean.mdx').length === 0);
    t('a body h1 repeating the title is a DELETE finding', at('content/docs/dup.mdx')[0]?.kind === 'delete', JSON.stringify(at('content/docs/dup.mdx')));
    t('a body h1 differing from the title is a DEMOTE finding', at('content/docs/differs.mdx')[0]?.kind === 'demote', JSON.stringify(at('content/docs/differs.mdx')));
    t('a `# ` inside a ``` fence is NOT a finding', at('content/docs/fenced.mdx').length === 0, JSON.stringify(at('content/docs/fenced.mdx')));
    t('a `# ` inside a ~~~ fence is NOT a finding', at('content/docs/fenced-tilde.mdx').length === 0, JSON.stringify(at('content/docs/fenced-tilde.mdx')));
    t(
      'a heading differing from the title ONLY by inline code is a DELETE finding',
      at('content/docs/inline-code.mdx')[0]?.kind === 'delete',
      JSON.stringify(at('content/docs/inline-code.mdx')),
    );
    t('`#NoSpace` is not a heading', at('content/docs/not-a-heading.mdx').length === 0);
    t('a `## ` heading is never a finding', findings.every((f) => f.raw.startsWith('#') && !f.raw.startsWith('##')));
    t('an h1 indented up to three spaces IS a finding', at('content/docs/indented.mdx').length === 1, JSON.stringify(at('content/docs/indented.mdx')));
    t('a `# ` inside the frontmatter block is not body content', at('content/docs/fm-hash.mdx').length === 0);
    t('the reported line number indexes the real file', at('content/docs/dup.mdx')[0]?.line === 5, JSON.stringify(at('content/docs/dup.mdx')));
    t(
      'the generated references tree is judged, not excluded (#12249)',
      at('content/docs/references/gen.mdx').length === 1,
      JSON.stringify(at('content/docs/references/gen.mdx')),
    );
    t(
      'the releases tree is judged, not excluded (#12250)',
      at('content/docs/releases/v9.mdx').length === 1,
      JSON.stringify(at('content/docs/releases/v9.mdx')),
    );
    t(
      'the live EXCLUSIONS list carves nothing out of the corpus',
      excluded.size === 0,
      `excluded keys=${JSON.stringify([...excluded.keys()])}`,
    );
    t('every page is judgeable, so every page is scanned', scanned === 11, `scanned=${scanned}`);

    // ── The carve-out machinery, driven by a SYNTHETIC exclusion ────────────
    //
    // `EXCLUSIONS` is empty, so nothing below would be exercised by the live
    // list. These cases keep the mechanism itself under test against a carve-out
    // that exists only here — the properties a real entry depends on: an
    // excluded page yields no finding, is NOT counted as scanned, and is still
    // READ and TALLIED, which is the fact the dead-exclusion limb is built on.
    const SYNTHETIC = [
      { prefix: 'content/docs/sandbox/', owner: '#12250 (self-test only)', why: 'exercises the carve-out machinery' },
    ];
    write('content/docs/sandbox/dirty.mdx', `${fm('Sandbox')}# Sandbox in detail\n\nProse.\n`);

    const carved = scanTree(root, dir, SYNTHETIC);
    t('an excluded subtree yields no findings', carved.findings.every((f) => !exclusionFor(f.rel, SYNTHETIC)));
    t(
      '...but its violations are still counted',
      carved.excluded.get('content/docs/sandbox/').length === 1,
      JSON.stringify([...carved.excluded]),
    );
    t('an excluded page is not counted as scanned', carved.scanned === 11, `scanned=${carved.scanned}`);

    // The dead-exclusion limb: a clean excluded tree must be reported empty so
    // `main` can fail on it. This is the limb that retired BOTH carve-outs this
    // gate has ever had — references in #12249, releases in #12250 — so it is
    // the one that must keep working, including now that no live entry uses it.
    rmSync(join(dir, 'content/docs/sandbox/dirty.mdx'));
    const after = scanTree(root, dir, SYNTHETIC);
    t('a CLEAN excluded subtree reports zero — the dead-exclusion trigger', after.excluded.get('content/docs/sandbox/').length === 0);

    // Anti-vacuity: a tree of nothing but excluded pages scans zero pages.
    const empty = mkdtempSync(join(tmpdir(), 'docs-single-h1-empty-'));
    try {
      mkdirSync(join(empty, 'content/docs/sandbox'), { recursive: true });
      writeFileSync(join(empty, 'content/docs/sandbox/only.mdx'), `${fm('Only')}# 1.0.0 in detail\n`);
      t('a corpus of only excluded pages scans ZERO', scanTree(join(empty, 'content/docs'), empty, SYNTHETIC).scanned === 0);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`✗ check-docs-single-h1 self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ check-docs-single-h1 self-test: ${cases.length} cases pass (both fence spellings, inline-code equality, `
      + `indentation, a synthetic carve-out, and both anti-vacuity limbs).`,
  );
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  process.exit(process.argv.includes('--self-test') ? selfTest() : main(process.argv.slice(2)));
}
