#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-docs-nav-label -- the docs site's short sidebar label (`navTitle`)
 * reaches the PAGE TREE and nothing else.
 *
 *   node scripts/check-docs-nav-label.mjs              # judge the checked-in tree
 *   node scripts/check-docs-nav-label.mjs --list       # what it reads, per leg
 *   node scripts/check-docs-nav-label.mjs --self-test  # prove the battery can go red
 *
 * ## What the mechanism is
 *
 * A doc page's frontmatter `title` used to be the only string the site had, so
 * it was simultaneously the SERP `title`, the on-page `h1`, the JSON-LD, the
 * `llms.txt` entry, the Open Graph card and the sidebar label. Those consumers
 * have different length budgets: a 50-60 character title carrying search intent
 * is right for the first five and unreadable in the sixth. `navTitle` is the
 * sixth one's own string, falling back to `title` when a page does not declare
 * it -- which is all 405 pages today.
 *
 * `apps/docs/lib/nav-title.ts` is the mechanism's documentation and its single
 * resolution point. This gate is the half that keeps it single.
 *
 * ## The defect this pins, and why nothing else can see it
 *
 * The whole value of the split is that the SHORT string stays out of the
 * surfaces a crawler and an agent read. Every way of losing it is silent:
 *
 *   - a consumer reads `page.data.navTitle` "because it is nicer", and the SERP
 *     title quietly shortens on the pages that have one;
 *   - a second `?? page.data.title` appears at a read site, and the fallback now
 *     lives in two places that will drift (AGENTS.md Prime Directive #12);
 *   - the resolver stops falling back, and every page WITHOUT a `navTitle`
 *     loses its sidebar label -- 405 of 405 of them;
 *   - the plugin stops being wired into `loader()`, and the key becomes inert:
 *     declared, documented, read by nothing.
 *
 * None of those breaks a type, a link, a build or a test. The site renders, the
 * pages resolve, `next build` is green. The only symptom is a string in the
 * wrong place, on pages nobody re-reads -- and the whole point of #12243 is the
 * strings crawlers read.
 *
 * ## The invariant, stated conditionally so it reasons rather than pattern-matches
 *
 *   IF the docs page schema declares a nav-label key
 *   THEN
 *     (A) `navTitle` appears in the CODE of exactly two files under
 *         `apps/docs/**` -- the schema that declares it and the module that
 *         resolves it. Prose may name it anywhere; code may not.
 *     (B) the resolver, EXECUTED, returns `title` whenever the key is absent,
 *         blank, null or not a string, and the declared label otherwise.
 *     (C) the resolver is wired into the docs `loader()`. A resolution point
 *         nobody calls is the dormant-gate shape one level down.
 *     (D) the JSON-LD `BreadcrumbList` does not take its leaf crumb from the
 *         page tree (`includePage` is off). The tree is where the short label
 *         lands, and that structured data is read by exactly the crawler the
 *         epic is about.
 *     (E) every `title` consumer still reads `page.data.title`.
 *     (F) `fumadocs-core` still ships no nav-label key of its own.
 *
 * (F) is the leg that expires on purpose. `fumadocs-core@16.14.4` has none --
 * its `pageSchema` is `{ title, description, icon, full, _openapi }`, its
 * `metaSchema` has no per-page label field, and its page-tree builder reads
 * `{ title, description, icon }` off a page. That is WHY this repo declares its
 * own key. The day an upgrade ships a first-class equivalent, a bespoke key is
 * the wrong answer and this gate says so instead of letting ours quietly become
 * the thing nobody migrated.
 *
 * ## What it deliberately does NOT claim
 *
 * (A) stops a consumer reading the frontmatter KEY. It cannot stop a consumer
 * reading the page TREE, which carries the resolved label -- (D) covers the one
 * consumer that does today, by name, and a new one would be a new leg. The
 * honest statement of this gate's reach is: the key is single-sited, the
 * fallback is executed, and the one tree-reading consumer is pinned.
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { maskComments } from './js-comment-mask.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const REPO_ROOT = resolve(HERE, '..');

/** The frontmatter key this gate is about. Named once. */
export const KEY = 'navTitle';

/** Where the key may appear in CODE, relative to the repo root. */
export const KEY_SITES = ['apps/docs/source.config.ts', 'apps/docs/lib/nav-title.ts'];

/** The module that owns the resolution. */
export const RESOLVER = 'apps/docs/lib/nav-title.ts';

/** Where the loader is built, and the call that must appear in its `plugins`. */
export const LOADER = 'apps/docs/lib/source.ts';
export const PLUGIN_CALL = 'navTitlePlugin()';

/** The JSON-LD page, and the option that keeps its leaf crumb off the tree. */
export const JSONLD = 'apps/docs/app/[lang]/docs/[[...slug]]/page.tsx';

/**
 * Every surface that must still read `page.data.title`.
 *
 * This is a POSITIVE control, not a completeness claim: it catches a consumer
 * rewired away from `title`, which is the direction the short label leaks.
 */
export const TITLE_CONSUMERS = [
  { file: JSONLD, what: 'SERP title, OG/twitter metadata, the h1 and the JSON-LD headline' },
  { file: 'apps/docs/app/llms.txt/route.ts', what: 'the llms.txt index' },
  { file: 'apps/docs/lib/source.ts', what: 'getLLMText -- llms-full.txt and the .mdx endpoints' },
  { file: 'apps/docs/app/og/docs/[...slug]/route.tsx', what: 'the Open Graph card image' },
];

/** Names a nav-label key would plausibly carry if fumadocs ever ships one. */
export const FIRST_CLASS_NAMES = ['navTitle', 'sidebarTitle', 'navLabel', 'sidebarLabel', 'shortTitle', 'sidebar_label'];

/** Directories under `apps/docs` that hold generated or installed output. */
const SKIP_DIRS = new Set(['node_modules', '.next', '.source', '.turbo', 'dist', 'public']);

/** Source extensions the code scan reads. */
const CODE_EXT = /\.(?:[cm]?[jt]sx?)$/;

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Every code file under `dir`, as `relative-to-REPO_ROOT -> text`. */
export function readCodeFiles(dir, root = REPO_ROOT) {
  const out = new Map();
  const walk = (abs) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(abs, entry.name));
        continue;
      }
      if (!entry.isFile() || !CODE_EXT.test(entry.name)) continue;
      const p = join(abs, entry.name);
      out.set(relative(root, p), readFileSync(p, 'utf8'));
    }
  };
  walk(dir);
  return out;
}

// ---------------------------------------------------------------------------
// Leg A/C/D/E -- the source legs, over a file map so the self-test can feed one
// ---------------------------------------------------------------------------

/**
 * Judge a `relPath -> source` map.
 *
 * Comments are masked through `js-comment-mask.mjs` -- the one answer in this
 * tree to "code or prose" -- because the header of every file in this mechanism
 * NAMES the key, and a scan that could not tell prose from code would either
 * flag its own documentation or be silenced into uselessness.
 */
export function judgeSources(files) {
  const violations = [];
  const seen = [];

  // ── (A) the key appears in CODE only where it is declared and resolved ──
  const wordRe = new RegExp(`\\b${KEY}\\b`);
  for (const [rel, text] of files) {
    const code = maskComments(text);
    if (!wordRe.test(code)) continue;
    seen.push(rel);
    if (KEY_SITES.includes(rel)) continue;
    violations.push({
      leg: 'A',
      file: rel,
      what: `reads \`${KEY}\` in code`,
      detail:
        `\`${KEY}\` is the sidebar's string. Only ${KEY_SITES.join(' and ')} may name it in code -- the first ` +
        `declares it, the second resolves it. A consumer that reads it directly puts the SHORT label on a ` +
        `surface a crawler or an agent reads, and adds a second site for the \`title\` fallback that ` +
        `${RESOLVER} states once (AGENTS.md Prime Directive #12).`,
    });
  }
  for (const site of KEY_SITES) {
    if (seen.includes(site)) continue;
    violations.push({
      leg: 'A',
      file: site,
      what: `does not name \`${KEY}\` in code`,
      detail:
        files.has(site)
          ? `this file is one of the mechanism's two code sites; if the key moved, move ${'KEY_SITES'} with it.`
          : 'the file is missing from the scanned tree entirely.',
    });
  }

  // ── (C) the resolver is wired into the docs loader ──────────────────────
  const loader = files.get(LOADER);
  if (loader === undefined) {
    violations.push({ leg: 'C', file: LOADER, what: 'missing', detail: 'the docs loader is where the plugin is wired.' });
  } else if (!new RegExp(`plugins:\\s*\\[[^\\]]*${PLUGIN_CALL.replace(/[()]/g, '\\$&')}`).test(maskComments(loader))) {
    violations.push({
      leg: 'C',
      file: LOADER,
      what: `does not pass \`${PLUGIN_CALL}\` to the loader's \`plugins\``,
      detail:
        `an unwired resolver is inert: the key stays declared and documented, every page keeps its \`title\` ` +
        `in the sidebar, and nothing anywhere reports that the mechanism stopped existing.`,
    });
  }

  // ── (D) the JSON-LD breadcrumb leaf does not come from the page tree ────
  const jsonld = files.get(JSONLD);
  if (jsonld === undefined) {
    violations.push({ leg: 'D', file: JSONLD, what: 'missing', detail: 'the JSON-LD breadcrumb is built here.' });
  } else {
    const code = maskComments(jsonld);
    if (/includePage:\s*true/.test(code) || !/includePage:\s*false/.test(code)) {
      violations.push({
        leg: 'D',
        file: JSONLD,
        what: '`getBreadcrumbItems` is not called with `includePage: false`',
        detail:
          'with `includePage` on, the leaf crumb is the PAGE TREE node -- the one place the short label lands -- ' +
          'so a page with a `navTitle` would publish it in `BreadcrumbList` structured data. The leaf is pushed ' +
          'from `page.data.title` instead, which is the pair the canonical link and the SERP title are built from.',
      });
    }
  }

  // ── (E) every title consumer still reads `page.data.title` ──────────────
  for (const consumer of TITLE_CONSUMERS) {
    const text = files.get(consumer.file);
    if (text === undefined) {
      violations.push({ leg: 'E', file: consumer.file, what: 'missing', detail: `it serves ${consumer.what}.` });
      continue;
    }
    if (!/page\.data\.title/.test(maskComments(text))) {
      violations.push({
        leg: 'E',
        file: consumer.file,
        what: 'no longer reads `page.data.title` in code',
        detail:
          `${consumer.what} must keep reading the page's own \`title\`. A consumer moved onto the page tree ` +
          'takes the short sidebar label with it, which is the leak the split exists to prevent.',
      });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Leg B -- the resolver, EXECUTED
// ---------------------------------------------------------------------------

/**
 * The fallback cases, as `[frontmatter, expected label, why]`.
 *
 * `null` is the shape YAML gives a bare `navTitle:` and the blank strings are
 * the authoring slips; all of them must land on `title`, because a page tree
 * entry with no visible text is worse than a long one.
 */
export const RESOLVER_CASES = [
  [{ title: 'Declarative REST Endpoints' }, 'Declarative REST Endpoints', 'absent -> title'],
  [{ title: 'Declarative REST Endpoints', navTitle: 'REST Endpoints' }, 'REST Endpoints', 'declared -> the short label'],
  [{ title: 'T', navTitle: '' }, 'T', 'empty string -> title'],
  [{ title: 'T', navTitle: '   ' }, 'T', 'blank string -> title'],
  [{ title: 'T', navTitle: null }, 'T', 'YAML `navTitle:` with no value -> title'],
  [{ title: 'T', navTitle: 42 }, 'T', 'a non-string -> title'],
  [{ title: 'T', navTitle: '  Padded  ' }, 'Padded', 'a declared label is trimmed'],
];

/**
 * Judge a loaded resolver module: the pure function AND the plugin around it.
 *
 * The plugin leg runs the real transformer against a synthetic builder context,
 * because "the fallback is right" and "the fallback is reached" are two claims
 * and only the second one is what the page tree actually depends on.
 */
export function judgeResolver(mod) {
  const violations = [];
  const add = (what, detail) => violations.push({ leg: 'B', file: RESOLVER, what, detail });

  if (typeof mod.navLabel !== 'function') {
    add('exports no `navLabel` function', 'the single resolution point is not callable, so nothing here was measured.');
    return violations;
  }
  for (const [data, expected, why] of RESOLVER_CASES) {
    let got;
    try {
      got = mod.navLabel(data);
    } catch (err) {
      add(`\`navLabel(${JSON.stringify(data)})\` threw`, `${err.name}: ${err.message} (${why})`);
      continue;
    }
    if (got !== expected) {
      add(
        `\`navLabel(${JSON.stringify(data)})\` returned ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`,
        `${why}. \`title\` is the DECLARED fallback: all 405 pages depend on it, so a resolver that stops ` +
          'falling back empties the sidebar rather than degrading it.',
      );
    }
  }

  if (typeof mod.navTitlePlugin !== 'function') {
    add('exports no `navTitlePlugin` function', 'the loader has nothing to wire, so the resolution never runs.');
    return violations;
  }
  const transform = mod.navTitlePlugin()?.transformPageTree?.file;
  if (typeof transform !== 'function') {
    add('the plugin declares no `transformPageTree.file`', 'that hook is what fumadocs calls per page-tree node.');
    return violations;
  }
  /** A builder context holding one page, the shape fumadocs calls the hook with. */
  const ctxFor = (data) => ({ storage: { read: () => (data === null ? undefined : { format: 'page', data }) } });
  /**
   * Call the hook and let a THROW be a finding rather than a crash.
   *
   * A transformer that throws on an input the builder really produces takes the
   * whole page tree down at build time, so it is the loudest version of this
   * leg's failure -- it must be reported by the gate, not by a stack trace out
   * of the gate.
   */
  const call = (ctx, node, path) => {
    try {
      return transform.call(ctx, node, path);
    } catch (err) {
      add(`the plugin threw on \`file(${JSON.stringify(node.name)}, ${JSON.stringify(path)})\``, `${err.name}: ${err.message}`);
      return node;
    }
  };
  const run = (data, node, path = 'docs/x.mdx') => call(ctxFor(data), node, path);

  const declared = run({ title: 'Long Title For Search', navTitle: 'Short' }, { type: 'page', name: 'Long Title For Search', url: '/docs/x' });
  if (declared?.name !== 'Short') {
    add('the plugin does not apply a declared `navTitle` to the tree node', `node.name came back as ${JSON.stringify(declared?.name)}.`);
  }
  const bare = run({ title: 'Only A Title' }, { type: 'page', name: 'Only A Title', url: '/docs/x' });
  if (bare?.name !== 'Only A Title') {
    add('the plugin does not leave a page without `navTitle` alone', `node.name came back as ${JSON.stringify(bare?.name)}.`);
  }
  const linkNode = { type: 'page', name: 'Hand-written link', url: 'https://example.com' };
  const link = call(ctxFor(null), linkNode, undefined);
  if (link?.name !== 'Hand-written link') {
    add(
      'the plugin does not leave a `meta.json` link node alone',
      "fumadocs calls `file` with NO path for `[Name](url)` entries; there is no page behind them to read.",
    );
  }
  const untitled = run({ description: 'no title at all' }, { type: 'page', name: 'X Y', url: '/docs/x' });
  if (untitled?.name !== 'X Y') {
    add(
      'the plugin overwrites the builder\'s path-derived name when a page has no `title`',
      `node.name came back as ${JSON.stringify(untitled?.name)}; erasing a working label is worse than a long one.`,
    );
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Leg F -- fumadocs still ships nothing first-class
// ---------------------------------------------------------------------------

/** Judge the two stock schemas' key sets. */
export function judgeFumadocs(pageKeys, metaKeys) {
  const violations = [];
  for (const [name, keys] of [['pageSchema', pageKeys], ['metaSchema', metaKeys]]) {
    const hit = keys.filter((k) => FIRST_CLASS_NAMES.includes(k));
    if (hit.length === 0) continue;
    violations.push({
      leg: 'F',
      file: 'fumadocs-core/source/schema',
      what: `\`${name}\` now declares ${hit.map((h) => `\`${h}\``).join(', ')}`,
      detail:
        `fumadocs ships a first-class nav label now, so this repo's own \`${KEY}\` is the wrong answer: migrate ` +
        `${RESOLVER} and ${KEY_SITES[0]} onto theirs and delete this gate's key legs. A bespoke key kept beside ` +
        'an upstream one is the thing nobody migrates.',
    });
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Loading the two things that live outside this script
// ---------------------------------------------------------------------------

/**
 * Import a `.ts` module with Node's own type stripping.
 *
 * The resolver is deliberately free of runtime imports so this works: it is
 * type-only at the top, which strips to nothing. The MODULE_TYPELESS warning is
 * suppressed because `apps/docs` is a Next app with no `"type"` field and that
 * is not this gate's business to report.
 */
export async function loadResolver(path) {
  const prior = process.listeners('warning');
  process.removeAllListeners('warning');
  process.on('warning', (w) => {
    if (w.name === 'MODULE_TYPELESS_PACKAGE_JSON' || w.code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
    if (w.name === 'ExperimentalWarning' && /[Tt]ype [Ss]tripping/.test(w.message)) return;
    console.warn(w);
  });
  try {
    return await import(pathToFileURL(path).href);
  } finally {
    process.removeAllListeners('warning');
    for (const l of prior) process.on('warning', l);
  }
}

/** `pageSchema` / `metaSchema` key sets, resolved from `apps/docs` itself. */
export async function loadFumadocsSchemaKeys(root = REPO_ROOT) {
  const req = createRequire(join(root, 'apps/docs/package.json'));
  const mod = await import(pathToFileURL(req.resolve('fumadocs-core/source/schema')).href);
  const keys = (s) => Object.keys(s?.shape ?? s?._def?.shape?.() ?? {});
  return { pageKeys: keys(mod.pageSchema), metaKeys: keys(mod.metaSchema), version: req('fumadocs-core/package.json').version };
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

function report(violations) {
  console.error(`✗ check-docs-nav-label — ${violations.length} violation(s)\n`);
  for (const v of violations) {
    console.error(`  ${v.file}`);
    console.error(`    [leg ${v.leg}] ${v.what}`);
    console.error(`    ${v.detail}\n`);
  }
}

export async function main(argv = []) {
  const docsDir = join(REPO_ROOT, 'apps/docs');
  if (!existsSync(docsDir) || !statSync(docsDir).isDirectory()) {
    console.error(`✗ check-docs-nav-label REFUSES: ${relative(REPO_ROOT, docsDir)} is not a directory — nothing was read.`);
    return 1;
  }

  const files = readCodeFiles(docsDir);
  if (files.size === 0) {
    console.error('✗ check-docs-nav-label REFUSES: no source files under apps/docs — a clean zero here would be a gate reading nothing.');
    return 1;
  }

  let fuma = null;
  try {
    fuma = await loadFumadocsSchemaKeys();
  } catch (err) {
    console.error(
      `✗ check-docs-nav-label REFUSES: cannot resolve \`fumadocs-core/source/schema\` from apps/docs (${err.code ?? err.message}). ` +
        'Leg F is the one that expires when fumadocs ships its own nav label; a skipped leg would hide exactly that. Run `pnpm install`.',
    );
    return 1;
  }

  let mod = null;
  try {
    mod = await loadResolver(join(REPO_ROOT, RESOLVER));
  } catch (err) {
    console.error(
      `✗ check-docs-nav-label REFUSES: cannot load ${RESOLVER} (${err.code ?? err.message}). ` +
        `Node ${process.version} must be able to strip TypeScript types (>= 22.18); the repo pins Node 22 in .nvmrc. ` +
        'The fallback every one of 405 pages depends on is measured by EXECUTING this module, so a skipped leg is not an option.',
    );
    return 1;
  }

  const violations = [...judgeSources(files), ...judgeResolver(mod), ...judgeFumadocs(fuma.pageKeys, fuma.metaKeys)];

  if (argv.includes('--list')) {
    console.log(`apps/docs source files scanned: ${files.size}`);
    console.log(`code sites allowed to name \`${KEY}\`: ${KEY_SITES.join(', ')}`);
    console.log(`resolver cases executed: ${RESOLVER_CASES.length}`);
    console.log(`title consumers pinned: ${TITLE_CONSUMERS.map((c) => c.file).join(', ')}`);
    console.log(`fumadocs-core@${fuma.version} pageSchema keys: ${fuma.pageKeys.join(', ')}`);
    console.log(`fumadocs-core@${fuma.version} metaSchema keys: ${fuma.metaKeys.join(', ')}`);
  }

  if (violations.length > 0) {
    report(violations);
    return 1;
  }

  console.log(
    `✓ check-docs-nav-label: \`${KEY}\` is named in code by ${KEY_SITES.length} file(s) only, out of ${files.size} ` +
      `scanned under apps/docs; the resolver was EXECUTED over ${RESOLVER_CASES.length} fallback cases plus four ` +
      `page-tree node cases; ${PLUGIN_CALL} is wired into the docs loader; the JSON-LD breadcrumb takes its leaf from ` +
      `\`page.data.title\` rather than the tree; ${TITLE_CONSUMERS.length} title consumer(s) still read ` +
      `\`page.data.title\`; and fumadocs-core@${fuma.version} still ships no nav-label key (pageSchema: ` +
      `${fuma.pageKeys.join(', ')}).`,
  );
  return 0;
}

// ---------------------------------------------------------------------------
// Self-test -- every leg observed BOTH green and red
// ---------------------------------------------------------------------------

/**
 * Prove the battery can go red.
 *
 * The source legs are driven over synthetic file maps, so each one is watched
 * failing on the exact edit it exists to catch. Leg B is driven over a REAL
 * module written to a temp directory and imported the same way the real one is
 * -- a resolver that has stopped falling back is the failure that costs all 405
 * pages their sidebar label, and asserting it against a hand-written stub would
 * be asserting against this file's own idea of the module.
 */
export async function selfTest() {
  const failures = [];
  let checked = 0;
  const assert = (ok, what) => {
    checked++;
    if (!ok) failures.push(what);
  };
  const legs = (violations) => [...new Set(violations.map((v) => v.leg))].sort();

  // A file map that PASSES every source leg, as the control the mutations move.
  const GOOD = () =>
    new Map([
      ['apps/docs/source.config.ts', 'const docsSchema = pageSchema.extend({\n  navTitle: z.string().optional(),\n});\n'],
      ['apps/docs/lib/nav-title.ts', 'export function navLabel(d) { return d.navTitle ?? d.title; }\n'],
      [
        'apps/docs/lib/source.ts',
        "export const source = loader({ plugins: [lucideIconsPlugin(), navTitlePlugin()] });\n" +
          'export const getLLMText = (page) => `# ${page.data.title}`;\n',
      ],
      [JSONLD, 'getBreadcrumbItems(page.url, tree, { includePage: false });\nconst t = page.data.title;\n'],
      ['apps/docs/app/llms.txt/route.ts', 'lines.push(page.data.title);\n'],
      ['apps/docs/app/og/docs/[...slug]/route.tsx', 'title={page.data.title}\n'],
      ['apps/docs/app/[lang]/page.tsx', 'export default function Home() { return null; }\n'],
    ]);

  assert(judgeSources(GOOD()).length === 0, `the control file map passes every source leg — got ${JSON.stringify(judgeSources(GOOD()))}`);

  // ── leg A ────────────────────────────────────────────────────────────────
  const leaked = GOOD();
  leaked.set('apps/docs/app/og/docs/[...slug]/route.tsx', 'title={page.data.navTitle ?? page.data.title}\n');
  assert(legs(judgeSources(leaked)).includes('A'), 'leg A fires when a consumer reads the key in code');

  const prose = GOOD();
  prose.set('apps/docs/app/[lang]/page.tsx', '// navTitle is the sidebar label; see lib/nav-title.ts\nexport default function Home() { return null; }\n');
  assert(judgeSources(prose).length === 0, 'leg A does NOT fire on the key named in PROSE — that is what the comment mask is for');

  const strung = GOOD();
  strung.set('apps/docs/app/[lang]/page.tsx', "const k = 'navTitle';\n");
  assert(legs(judgeSources(strung)).includes('A'), 'leg A fires on the key in a STRING literal — the mask keeps literals, deliberately');

  const prefixOnly = GOOD();
  prefixOnly.set('apps/docs/app/[lang]/page.tsx', 'import { navTitlePlugin } from "@/lib/nav-title";\nexport default navTitlePlugin;\n');
  assert(judgeSources(prefixOnly).length === 0, '`navTitlePlugin` is not a read of `navTitle` — the word boundary is load-bearing');

  const undeclared = GOOD();
  undeclared.set('apps/docs/source.config.ts', 'const docsSchema = pageSchema;\n');
  assert(legs(judgeSources(undeclared)).includes('A'), 'leg A fires when the schema stops declaring the key');

  // ── leg C ────────────────────────────────────────────────────────────────
  const unwired = GOOD();
  unwired.set('apps/docs/lib/source.ts', 'export const source = loader({ plugins: [lucideIconsPlugin()] });\nexport const getLLMText = (page) => `# ${page.data.title}`;\n');
  assert(legs(judgeSources(unwired)).includes('C'), 'leg C fires when the plugin is dropped from the loader');

  const commentedOut = GOOD();
  commentedOut.set('apps/docs/lib/source.ts', 'export const source = loader({ plugins: [/* navTitlePlugin() */] });\nexport const getLLMText = (page) => `# ${page.data.title}`;\n');
  assert(legs(judgeSources(commentedOut)).includes('C'), 'leg C is not satisfied by the call COMMENTED OUT');

  // ── leg D ────────────────────────────────────────────────────────────────
  const treeLeaf = GOOD();
  treeLeaf.set(JSONLD, 'getBreadcrumbItems(page.url, tree, { includePage: true });\nconst t = page.data.title;\n');
  assert(legs(judgeSources(treeLeaf)).includes('D'), 'leg D fires when the breadcrumb leaf is taken from the page tree again');

  const noOption = GOOD();
  noOption.set(JSONLD, 'getBreadcrumbItems(page.url, tree);\nconst t = page.data.title;\n');
  assert(legs(judgeSources(noOption)).includes('D'), 'leg D fires when the option is absent — fumadocs defaults it to false, but silence is not a decision on the record');

  // ── leg E ────────────────────────────────────────────────────────────────
  const rewired = GOOD();
  rewired.set('apps/docs/app/llms.txt/route.ts', 'lines.push(treeNode.name);\n');
  assert(legs(judgeSources(rewired)).includes('E'), 'leg E fires when a title consumer stops reading `page.data.title`');

  const missing = GOOD();
  missing.delete('apps/docs/app/og/docs/[...slug]/route.tsx');
  assert(legs(judgeSources(missing)).includes('E'), 'leg E fires when a pinned consumer is gone rather than reporting a clean zero');

  // ── leg B, over REAL modules ─────────────────────────────────────────────
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const tmp = mkdtempSync(join(tmpdir(), 'docs-nav-label-'));
  const write = (name, src) => {
    const p = join(tmp, name);
    writeFileSync(p, src, 'utf8');
    return p;
  };
  try {
    const real = await loadResolver(join(REPO_ROOT, RESOLVER));
    assert(judgeResolver(real).length === 0, `the checked-in resolver passes leg B — got ${JSON.stringify(judgeResolver(real))}`);

    // A resolver that has stopped falling back: every page WITHOUT a navTitle
    // loses its label. This is the mutation the leg exists for.
    const noFallback = await loadResolver(
      write(
        'no-fallback.ts',
        'export function navLabel(d: { title: string; navTitle?: unknown }): string {\n' +
          '  return typeof d.navTitle === "string" ? d.navTitle : "";\n}\n' +
          'export function navTitlePlugin() {\n' +
          '  return { transformPageTree: { file(node: any) { return node; } } };\n}\n',
      ),
    );
    assert(judgeResolver(noFallback).some((v) => v.leg === 'B'), 'leg B fires on a resolver that stopped falling back to `title`');

    // A plugin that never applies the label: the key is declared, documented,
    // wired -- and inert.
    const inert = await loadResolver(
      write(
        'inert.ts',
        'export function navLabel(d: { title: string; navTitle?: unknown }): string {\n' +
          '  const n = typeof d.navTitle === "string" ? d.navTitle.trim() : "";\n' +
          '  return n.length > 0 ? n : d.title;\n}\n' +
          'export function navTitlePlugin() {\n' +
          '  return { transformPageTree: { file(node: any) { return node; } } };\n}\n',
      ),
    );
    assert(judgeResolver(inert).some((v) => v.leg === 'B'), 'leg B fires on a plugin that never applies a declared label');

    // A plugin that clobbers the builder's path-derived name on a page with no
    // title -- the guard that is invisible to every other check.
    const clobbers = await loadResolver(
      write(
        'clobbers.ts',
        'export function navLabel(d: { title: string; navTitle?: unknown }): string {\n' +
          '  const n = typeof d.navTitle === "string" ? d.navTitle.trim() : "";\n' +
          '  return n.length > 0 ? n : d.title;\n}\n' +
          'export function navTitlePlugin() {\n' +
          '  return { transformPageTree: { file(this: any, node: any, p?: string) {\n' +
          '    const f = this.storage.read(p);\n' +
          '    node.name = navLabel(f.data);\n' +
          '    return node;\n' +
          '  } } };\n}\n',
      ),
    );
    assert(judgeResolver(clobbers).some((v) => v.leg === 'B'), 'leg B fires on a plugin that overwrites a titleless page\'s path-derived name');

    const empty = await loadResolver(write('empty.ts', 'export const nothing = 1;\n'));
    assert(judgeResolver(empty).some((v) => v.leg === 'B'), 'leg B refuses a module exporting no `navLabel` rather than reporting zero violations');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // ── leg F ────────────────────────────────────────────────────────────────
  assert(judgeFumadocs(['title', 'description', 'icon', 'full', '_openapi'], ['title', 'pages']).length === 0, 'leg F is green on fumadocs 16.14.4\'s real key sets');
  assert(judgeFumadocs(['title', 'sidebarTitle'], ['title']).some((v) => v.leg === 'F'), 'leg F fires when fumadocs ships a first-class nav label');
  assert(judgeFumadocs(['title'], ['title', 'navLabel']).some((v) => v.leg === 'F'), 'leg F watches `metaSchema` too — a per-page label override would land there');

  // ── the real tree, and the population positive control ───────────────────
  const real = readCodeFiles(join(REPO_ROOT, 'apps/docs'));
  assert(real.size > 0, 'the real apps/docs scan reads a non-empty population — a clean zero over nothing is the failure this control exists for');
  assert(real.has(RESOLVER) && real.has(LOADER) && real.has(JSONLD), 'the real scan reaches all three mechanism files');
  assert(!real.has('apps/docs/node_modules/x.ts'), 'the walk skips installed and generated directories');

  // ── wiring: this gate really runs in CI ──────────────────────────────────
  const SELF = 'scripts/check-docs-nav-label.mjs';
  let lint = null;
  try {
    lint = readFileSync(join(REPO_ROOT, '.github/workflows/lint.yml'), 'utf8');
  } catch (err) {
    failures.push(`cannot read .github/workflows/lint.yml to verify wiring: ${err.code ?? err.message}`);
  }
  if (lint !== null) {
    assert(lint.includes(`node ${SELF}\n`), `wiring: lint.yml invokes ${SELF} directly (lint.yml's GATE INVOCATION IDIOM note)`);
    assert(lint.includes(`node ${SELF} --self-test`), 'wiring: lint.yml runs the --self-test leg too');
  }

  if (failures.length > 0) {
    console.error(`✗ check-docs-nav-label --self-test — ${failures.length} of ${checked} assertion(s) failed\n`);
    for (const f of failures) console.error(`  • ${f}`);
    return 1;
  }
  console.log(
    `✓ check-docs-nav-label --self-test: ${checked} assertions — leg A observed firing on a consumer reading the ` +
      'key and on the schema dropping it while staying silent on the key in PROSE and on the `navTitlePlugin` ' +
      'prefix, leg C on an unwired and on a commented-out plugin, leg D on the breadcrumb leaf returning to the ' +
      'page tree and on the option going absent, leg E on a rewired and on a deleted consumer, leg B driven over ' +
      'FOUR real type-stripped modules (the checked-in one green; a resolver that stopped falling back, an inert ' +
      'plugin, one that clobbers a titleless page and one exporting nothing all red), leg F on both stock schemas, ' +
      'the real apps/docs population asserted non-empty and node_modules-free, and the CI wiring read out of ' +
      'lint.yml.',
  );
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) process.exit(await selfTest());
  process.exit(await main(process.argv.slice(2)));
}
