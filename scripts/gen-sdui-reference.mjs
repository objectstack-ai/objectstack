#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * gen-sdui-reference -- the docs site's component reference, generated from
 * the repo-root `sdui.manifest.json`.
 *
 *   node scripts/gen-sdui-reference.mjs              # write content/docs/ui/components/
 *   node scripts/gen-sdui-reference.mjs --check      # exit 1 when the committed pages drift
 *   node scripts/gen-sdui-reference.mjs --self-test  # prove the battery can go red
 *
 * ## What it produces, and why from the manifest
 *
 * `sdui.manifest.json` is the public-tier component manifest (ADR-0080): the
 * components a metadata author may place, each with its inputs, their coarse
 * types, enums and descriptions. CI regenerates it from the registry under
 * `ui/` and fails when the committed copy differs, so it is the one list that
 * cannot disagree with the renderer. A hand-written page per component can,
 * and the hand pages that existed covered 17 of the manifest's components.
 * This generator covers every one of them, and `--check` keeps the pages equal
 * to the manifest they were generated from.
 *
 * ## Layout: one page per namespace, two grouping rules
 *
 * At 100+ components a page per component is mostly one-row pages (48 of them
 * are HTML elements whose only inputs are `className` and `children`), so the
 * reference is one page per namespace with a heading per component:
 *
 *   - a component whose `tier` is `html` goes to the HTML elements page,
 *     whatever its namespace;
 *   - every `plugin-*` namespace shares the plugin blocks page, because each
 *     holds one to three components;
 *   - every other namespace has its own page, and a namespace with no row in
 *     NAMESPACE_PAGES is REFUSED with the remedy -- a new namespace needs its
 *     page's title and introduction written once, by a person, never guessed.
 *
 * Each component heading carries an explicit id (`[#action-button]` for
 * `action:button`), so its anchor does not depend on a slugger's punctuation
 * rules, and two components whose ids collide are refused.
 *
 * ## The directory is wholly generated
 *
 * Every file under `content/docs/ui/components/` is written by this script:
 * the pages, the index and `meta.json`. A write removes any other file there,
 * and `--check` fails on one, so a page cannot linger after its namespace
 * leaves the manifest. Edit this script, never a page.
 *
 * ## Absence is loud
 *
 * An unknown component key, input key or tier value is refused rather than
 * skipped: the manifest gaining a field means the reference is about to omit
 * something it carries, and the remedy is to render it here. An empty manifest,
 * a component whose key is not its `type`, and a type that would not appear on
 * exactly one page are refused too.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from './invoked-as.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_PATH = 'sdui.manifest.json';
const OUT_DIR = 'content/docs/ui/components';

/**
 * The repo-root file this generator reads, declared for `scripts/pm/dispatch-gates.mjs`.
 *
 * The derivation reads SOURCE TEXT, and `MANIFEST_PATH` above is a literal with
 * no separator, which `hintCovers` refuses as too generic. `OUT_DIR` was always
 * visible and the manifest was not, so a diff that changed only the manifest
 * never derived `pnpm check:sdui-reference` -- the one diff this gate exists to
 * catch, since a regenerated manifest beside a stale reference reds it in CI.
 *
 * The `/**` suffix is the repo-root-file spelling of the idiom (the same one
 * `scripts/check-sdui-manifest.mjs` declares for this file): a bare
 * single-segment literal builds no hint, and the collapse reduces this one back
 * to the single file it names and to nothing else. The self-test holds it equal
 * to `MANIFEST_PATH`, so a moved read reds there instead of leaving the
 * declaration describing the old file.
 */
const ROOT_FILE_WATCH_HINTS = ['sdui.manifest.json/**'];
const URL_BASE = '/docs/ui/components';
const COMMAND = 'node scripts/gen-sdui-reference.mjs';

const COMPONENT_KEYS = new Set(['type', 'namespace', 'inputs', 'tier', 'isContainer']);
const INPUT_KEYS = new Set(['name', 'type', 'description', 'enum', 'of', 'required', 'binding']);
const TIERS = new Set(['html']);

const HTML_PAGE = {
  slug: 'html',
  title: 'HTML elements — component reference',
  navTitle: 'HTML Elements',
  description: 'The native HTML elements an html page source may use, and the props each accepts.',
  intro:
    'These are the safe native HTML elements of the public tier. Each renders as the element ' +
    'of the same name and takes few props beyond `className` and its children.',
};

const PLUGINS_PAGE = {
  slug: 'plugins',
  title: 'Plugin blocks — component reference',
  navTitle: 'Plugin Blocks',
  description: 'The object-bound data blocks: grids, lists, forms, boards, calendars, charts, maps and more.',
  intro:
    'These blocks come from the view plugins. Most are bound to an object, through their own ' +
    '`objectName` input or the node\'s `dataSource` binding, and draw its records.',
};

// One row per namespace that has a page of its own. A namespace the manifest
// gains is refused until it has a row here.
const NAMESPACE_PAGES = Object.freeze({
  ui: {
    slug: 'ui',
    title: 'Layout and basic components — component reference',
    navTitle: 'Layout & Basic',
    description: 'The layout primitives and basic display components: flex, grid, stack, card, tabs, text, button and more.',
    intro:
      'These are the layout primitives and basic display components. The containers among ' +
      'them take child components; the rest draw text, images, icons, badges and buttons.',
  },
  page: {
    slug: 'page',
    title: 'Page structure components — component reference',
    navTitle: 'Page Structure',
    description: 'The page:* components that give a page its structure: header, footer, sidebar, sections, cards, tabs and accordions.',
    intro:
      'The `page:*` components give a page its structure. All of them except the header are ' +
      'containers for other components.',
  },
  record: {
    slug: 'record',
    title: 'Record components — component reference',
    navTitle: 'Record',
    description: 'The record:* components that draw the record a record page opens: details, highlights, related lists, activity and more.',
    intro:
      'The `record:*` components render from the record context a record page mounts, so they ' +
      'belong on a `type: \'record\'` page.',
  },
  element: {
    slug: 'element',
    title: 'Element components — component reference',
    navTitle: 'Elements',
    description: 'The element:* components: text, numbers, buttons, dividers, definition lists and repeaters.',
    intro: 'The `element:*` components are small, self-contained page elements.',
  },
  action: {
    slug: 'action',
    title: 'Action components — component reference',
    navTitle: 'Actions',
    description: 'The action:* components that put an action on a page: a button, an icon, a group or a menu.',
    intro:
      'The `action:*` components put an action on a page as a button, an icon button, a ' +
      'group of buttons or a menu.',
  },
});

// The order pages take in the sidebar.
const PAGE_ORDER = ['ui', 'page', 'record', 'element', 'action', 'plugins', 'html'];

const GENERATED_COMMENT =
  `{/* ⚠️  AUTO-GENERATED — DO NOT EDIT. Generated from ${MANIFEST_PATH} by ${COMMAND}; ` +
  'change the manifest or the generator, never this page. */}';

const GENERATED_CALLOUT = [
  '<Callout type="info">',
  `This page is generated from the repo-root \`${MANIFEST_PATH}\`, the component manifest CI`,
  'regenerates from the renderer registry. Regenerate it with',
  `\`${COMMAND}\`; \`${COMMAND} --check\` fails when it is stale.`,
  '</Callout>',
].join('\n');

class ReferenceRenderError extends Error {}

const fail = (message) => {
  throw new ReferenceRenderError(message);
};

// ── Manifest shape ─────────────────────────────────────────────────────────

function validateManifest(manifest) {
  const components = manifest?.components;
  if (!components || typeof components !== 'object' || Array.isArray(components)) {
    fail(`${MANIFEST_PATH} has no \`components\` object.`);
  }
  const entries = Object.entries(components);
  if (entries.length === 0) {
    fail(`${MANIFEST_PATH} lists no components, so there is nothing to document. Refusing to write an empty reference.`);
  }
  for (const [key, comp] of entries) {
    for (const k of Object.keys(comp)) {
      if (!COMPONENT_KEYS.has(k)) {
        fail(`component \`${key}\` carries \`${k}\`, a key this generator does not render. Render it in ${COMMAND} (COMPONENT_KEYS) rather than letting the reference omit it.`);
      }
    }
    if (comp.type !== key) fail(`component key \`${key}\` names type \`${comp.type}\`; the manifest keys each component by its type.`);
    if (typeof comp.namespace !== 'string' || comp.namespace === '') fail(`component \`${key}\` has no namespace.`);
    if (!Array.isArray(comp.inputs)) fail(`component \`${key}\` has no \`inputs\` array.`);
    if (comp.tier !== undefined && !TIERS.has(comp.tier)) {
      fail(`component \`${key}\` has tier \`${comp.tier}\`, which this generator does not know. Decide its page in ${COMMAND} (TIERS, pageFor).`);
    }
    for (const input of comp.inputs) {
      for (const k of Object.keys(input)) {
        if (!INPUT_KEYS.has(k)) {
          fail(`input \`${input.name}\` of \`${key}\` carries \`${k}\`, a key this generator does not render. Render it in ${COMMAND} (INPUT_KEYS) rather than letting the reference omit it.`);
        }
      }
      if (typeof input.name !== 'string' || input.name === '') fail(`component \`${key}\` has an input with no name.`);
    }
  }
  return entries.map(([, comp]) => comp);
}

function pageFor(comp) {
  if (comp.tier === 'html') return HTML_PAGE;
  if (comp.namespace.startsWith('plugin-')) return PLUGINS_PAGE;
  const page = NAMESPACE_PAGES[comp.namespace];
  if (!page) {
    fail(`component \`${comp.type}\` is in namespace \`${comp.namespace}\`, which has no page. Add a NAMESPACE_PAGES row (slug, title, navTitle, description, intro) and its slug to PAGE_ORDER in ${COMMAND}.`);
  }
  return page;
}

// ── Markdown rendering ─────────────────────────────────────────────────────

// Text for an MDX table cell. Outside code spans, `{` `}` would open a JSX
// expression, `<` a JSX tag and `|` a new cell, so they are escaped; inside a
// code span only `|` is, because the table splits cells before code spans are
// read. A backtick run with no closing run of the same length is literal text.
function cellText(text) {
  const s = String(text).replace(/\s*\n\s*/g, ' ').trim();
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '`') {
      let j = i;
      while (s[j] === '`') j += 1;
      const fence = s.slice(i, j);
      const close = s.indexOf(fence, j);
      if (close !== -1 && s[close + fence.length] !== '`') {
        out += fence + s.slice(j, close).replace(/\|/g, '\\|') + fence;
        i = close + fence.length;
        continue;
      }
      out += '\\`'.repeat(fence.length);
      i = j;
      continue;
    }
    const ch = s[i];
    out += ch === '{' || ch === '}' || ch === '<' || ch === '|' ? `\\${ch}` : ch;
    i += 1;
  }
  return out;
}

const code = (value) => `\`${String(value).replace(/\|/g, '\\|')}\``;

function typeCell(input) {
  const types = Array.isArray(input.type) ? input.type : [input.type];
  let cell = types.map((t) => (t === 'array' && input.of ? `${code('array')} of ${code(input.of)}` : code(t))).join(' \\| ');
  if (Array.isArray(input.enum) && input.enum.length > 0) {
    cell += `: ${input.enum.map((v) => code(v)).join(', ')}`;
  }
  if (input.binding) cell += ` (${code(input.binding)} data binding)`;
  return cell;
}

const anchorId = (type) => type.replace(/[^A-Za-z0-9_-]+/g, '-');

function renderComponent(comp) {
  const facts = [`Namespace ${code(comp.namespace)}`];
  if (comp.tier) facts.push(`tier ${code(comp.tier)}`);
  if (comp.isContainer) facts.push('a container: it takes child components');
  const lines = [`## ${code(comp.type)} [#${anchorId(comp.type)}]`, '', `${facts.join(' · ')}.`, ''];
  if (comp.inputs.length === 0) {
    lines.push('It takes no inputs.');
  } else {
    lines.push('| Input | Type | Required | Description |', '| :--- | :--- | :--- | :--- |');
    for (const input of comp.inputs) {
      const description = input.description ? cellText(input.description) : '—';
      lines.push(`| ${code(input.name)} | ${typeCell(input)} | ${input.required ? 'yes' : ''} | ${description} |`);
    }
  }
  return lines.join('\n');
}

function frontmatter(page) {
  return [
    '---',
    `title: ${JSON.stringify(page.title)}`,
    `navTitle: ${JSON.stringify(page.navTitle)}`,
    `description: ${JSON.stringify(page.description)}`,
    '---',
  ].join('\n');
}

function renderPage(page, comps) {
  return [
    frontmatter(page),
    '',
    GENERATED_COMMENT,
    '',
    page.intro,
    '',
    GENERATED_CALLOUT,
    '',
    comps.map(renderComponent).join('\n\n'),
    '',
  ].join('\n');
}

function renderIndex(rows, pages) {
  const index = {
    title: 'Component reference — every component a page can place',
    navTitle: 'Component Reference',
    description: `Every component in the public SDUI component manifest — ${rows.length} components with their inputs, generated from ${MANIFEST_PATH}.`,
  };
  const table = [
    '| Component | Namespace | Inputs | Page |',
    '| :--- | :--- | ---: | :--- |',
    ...rows.map(({ comp, page }) =>
      `| [${code(comp.type)}](${URL_BASE}/${page.slug}#${anchorId(comp.type)}) | ${code(comp.namespace)} | ${comp.inputs.length} | [${page.navTitle}](${URL_BASE}/${page.slug}) |`),
  ];
  const pageList = pages.map(({ page, comps }) => `- [${page.navTitle}](${URL_BASE}/${page.slug}): ${comps.length} components.`);
  return [
    frontmatter(index),
    '',
    GENERATED_COMMENT,
    '',
    `These are the ${rows.length} components of the public tier: the components an \`html\` page's`,
    '`source` may use, and the types a page places in its regions. Each component lists its',
    'inputs, the props it accepts, with the coarse type, the allowed values of an enum and',
    'whether it is required. An `html` page source is checked against this same list when it is',
    'validated and saved, so an unknown component or a missing required input is reported',
    'there rather than drawn. See [Pages](/docs/ui/pages) for how a page is authored.',
    '',
    GENERATED_CALLOUT,
    '',
    '## Pages',
    '',
    ...pageList,
    '',
    '## Every component',
    '',
    ...table,
    '',
  ].join('\n');
}

/** The whole generated directory, as `{ relativeFileName: content }`. */
export function renderReference(manifest) {
  const comps = validateManifest(manifest);
  const byPage = new Map();
  const ids = new Map();
  for (const comp of comps) {
    const page = pageFor(comp);
    const id = anchorId(comp.type);
    if (ids.has(id)) fail(`components \`${ids.get(id)}\` and \`${comp.type}\` share the heading id \`${id}\`; change anchorId() in ${COMMAND} so each keeps its own.`);
    ids.set(id, comp.type);
    if (!byPage.has(page.slug)) byPage.set(page.slug, { page, comps: [] });
    byPage.get(page.slug).comps.push(comp);
  }
  const bySlug = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const pages = PAGE_ORDER.filter((slug) => byPage.has(slug)).map((slug) => byPage.get(slug));
  for (const slug of byPage.keys()) {
    if (!PAGE_ORDER.includes(slug)) fail(`page \`${slug}\` is missing from PAGE_ORDER in ${COMMAND}.`);
  }
  const files = {};
  const rows = [];
  for (const entry of pages) {
    entry.comps.sort((a, b) => bySlug(a.namespace, b.namespace) || bySlug(a.type, b.type));
    files[`${entry.page.slug}.mdx`] = renderPage(entry.page, entry.comps);
    for (const comp of entry.comps) rows.push({ comp, page: entry.page });
  }
  rows.sort((a, b) => bySlug(a.comp.type, b.comp.type));
  files['index.mdx'] = renderIndex(rows, pages);
  files['meta.json'] = `${JSON.stringify({ title: 'Component Reference', pages: pages.map((p) => p.page.slug) }, null, 2)}\n`;

  // Every manifest type is a heading on exactly one page.
  for (const comp of comps) {
    const heading = `## ${code(comp.type)} [#${anchorId(comp.type)}]\n`;
    const hits = Object.values(files).reduce((n, text) => n + text.split(heading).length - 1, 0);
    if (hits !== 1) fail(`component \`${comp.type}\` is a heading on ${hits} pages, not exactly one.`);
  }
  return { files, componentCount: comps.length, pageCount: pages.length };
}

// ── Disk ───────────────────────────────────────────────────────────────────

/** Differences between the rendered files and the directory, as messages. */
export function diffReference(files, dir) {
  const problems = [];
  const present = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : [];
  if (!existsSync(dir)) problems.push(`${dir}/ does not exist.`);
  for (const [name, expected] of Object.entries(files)) {
    const path = join(dir, name);
    if (!existsSync(path)) {
      problems.push(`${name} is missing.`);
      continue;
    }
    const actual = readFileSync(path, 'utf8');
    if (actual === expected) continue;
    const a = actual.split('\n');
    const e = expected.split('\n');
    let line = 0;
    while (line < a.length && line < e.length && a[line] === e[line]) line += 1;
    problems.push(`${name} differs from the manifest's rendering, first at line ${line + 1}:\n      committed: ${JSON.stringify(a[line] ?? '<end of file>')}\n      generated: ${JSON.stringify(e[line] ?? '<end of file>')}`);
  }
  for (const entry of present) {
    if (!(entry.name in files)) problems.push(`${entry.name} is not a generated file; everything under this directory is generated.`);
  }
  return problems;
}

function writeReference(files, dir) {
  mkdirSync(dir, { recursive: true });
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!(entry.name in files)) rmSync(join(dir, entry.name), { recursive: true, force: true });
  }
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
}

function readManifest() {
  const path = join(REPO_ROOT, MANIFEST_PATH);
  if (!existsSync(path)) fail(`${MANIFEST_PATH} is missing at the repo root.`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ── Self-test ──────────────────────────────────────────────────────────────

// Set as the self-test's last statement, after its success line prints, and
// read at the dispatch: a `return` above the verdict must not exit 0.
let selfTestReachedVerdict = false;

// The self-test is table-driven: each row's label is a declared battery with a
// floor of 1, registered as the loop body's first statement. The roster is a
// literal, so a deleted or renamed row names itself.
const SELF_TEST_BATTERIES = Object.freeze({
  'a component of each kind lands on its page, and the index links every one': 1,
  'components are sorted by type and inputs keep manifest order': 1,
  'rendering twice is byte-identical': 1,
  'braces, angle brackets and pipes are escaped outside code spans': 1,
  'a pipe inside a code span is escaped and the braces in it are not': 1,
  'an unclosed backtick is literal text': 1,
  'enum values, array element types and data bindings reach the type cell': 1,
  'a missing description renders a dash and required renders yes': 1,
  'an empty manifest is refused': 1,
  'an unknown component key is refused': 1,
  'an unknown input key is refused': 1,
  'an unknown tier is refused': 1,
  'a namespace with no page is refused': 1,
  'a component keyed by something other than its type is refused': 1,
  'two components sharing a heading id are refused': 1,
  'check: the rendering of a directory just written is clean': 1,
  'check: one hand-edited line is drift, naming the file and line': 1,
  'check: a missing file and a stray file are drift': 1,
  'write: a stale file in the directory is removed': 1,
  'the real manifest renders every component on exactly one page': 1,
});
const SELF_TEST_BATTERY_FLOOR = 20;

function selfTest() {
  const comp = (type, namespace, inputs = [], extra = {}) => ({ type, namespace, inputs, ...extra });
  const manifestOf = (...comps) => ({ components: Object.fromEntries(comps.map((c) => [c.type, c])) });
  const sample = () =>
    manifestOf(
      comp('stack', 'ui', [{ name: 'gap', type: 'number' }], { isContainer: true }),
      comp('button', 'ui', [{ name: 'label', type: 'string', required: true }, { name: 'variant', type: 'enum', enum: ['default', 'ghost'] }]),
      comp('h1', 'ui', [{ name: 'children', type: 'slot' }], { tier: 'html' }),
      comp('page:card', 'page', [], { isContainer: true }),
      comp('record:path', 'record', [{ name: 'stages', type: 'array', of: 'object' }]),
      comp('element:text', 'element', [{ name: 'content', type: ['string', 'object'] }]),
      comp('action:button', 'action', [{ name: 'label', type: 'string' }]),
      comp('object-grid', 'plugin-grid', [{ name: 'dataSource', type: 'object', binding: 'object', description: 'Binding: { object, view }.' }]),
    );
  const refuses = (manifest, pattern) => () => {
    try {
      renderReference(manifest);
    } catch (err) {
      if (err instanceof ReferenceRenderError && pattern.test(err.message)) return null;
      return `threw the wrong refusal: ${err.message}`;
    }
    return 'rendered instead of refusing';
  };
  const withTmp = (fn) => {
    const root = mkdtempSync(join(tmpdir(), 'gen-sdui-reference-'));
    try {
      return fn(join(root, 'components'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  const cases = [
    {
      label: 'a component of each kind lands on its page, and the index links every one',
      run() {
        const { files } = renderReference(sample());
        const want = {
          'ui.mdx': ['`stack`', '`button`'],
          'html.mdx': ['`h1`'],
          'page.mdx': ['`page:card`'],
          'record.mdx': ['`record:path`'],
          'element.mdx': ['`element:text`'],
          'action.mdx': ['`action:button`'],
          'plugins.mdx': ['`object-grid`'],
        };
        for (const [file, types] of Object.entries(want)) {
          if (!files[file]) return `${file} was not rendered`;
          for (const t of types) if (!files[file].includes(`## ${t}`)) return `${t} is not a heading on ${file}`;
        }
        if (files['ui.mdx'].includes('## `h1`')) return 'an html-tier component also landed on the ui page';
        const meta = JSON.parse(files['meta.json']);
        if (meta.pages.join() !== 'ui,page,record,element,action,plugins,html') return `meta.json pages are ${meta.pages.join()}`;
        if (!files['index.mdx'].includes(`(${URL_BASE}/action#action-button)`)) return 'the index does not link action:button to its anchor';
        if (!files['index.mdx'].includes(`(${URL_BASE}/plugins#object-grid)`)) return 'the index does not link object-grid to its anchor';
        if (!files['action.mdx'].includes('## `action:button` [#action-button]')) return 'action:button has no explicit heading id';
        for (const [file, text] of Object.entries(files)) {
          if (file.endsWith('.mdx') && !(text.includes('AUTO-GENERATED') && text.includes(COMMAND))) return `${file} does not say it is generated and how`;
        }
        return null;
      },
    },
    {
      label: 'components are sorted by type and inputs keep manifest order',
      run() {
        const ui = renderReference(sample()).files['ui.mdx'];
        if (ui.indexOf('## `button`') > ui.indexOf('## `stack`')) return 'button is not before stack';
        const m = manifestOf(comp('box', 'ui', [{ name: 'zeta', type: 'string' }, { name: 'alpha', type: 'string' }]));
        const box = renderReference(m).files['ui.mdx'];
        if (box.indexOf('`zeta`') > box.indexOf('`alpha`')) return 'inputs were reordered';
        return null;
      },
    },
    {
      label: 'rendering twice is byte-identical',
      run() {
        const a = renderReference(sample()).files;
        const b = renderReference(sample()).files;
        return JSON.stringify(a) === JSON.stringify(b) ? null : 'two renderings differ';
      },
    },
    {
      label: 'braces, angle brackets and pipes are escaped outside code spans',
      run() {
        const got = cellText('a { b } <C> d | e');
        return got === 'a \\{ b \\} \\<C> d \\| e' ? null : `got ${JSON.stringify(got)}`;
      },
    },
    {
      label: 'a pipe inside a code span is escaped and the braces in it are not',
      run() {
        const got = cellText('use `{ a: "x" | "y" }` here');
        return got === 'use `{ a: "x" \\| "y" }` here' ? null : `got ${JSON.stringify(got)}`;
      },
    },
    {
      label: 'an unclosed backtick is literal text',
      run() {
        const got = cellText('a ` b {c}');
        return got === 'a \\` b \\{c\\}' ? null : `got ${JSON.stringify(got)}`;
      },
    },
    {
      label: 'enum values, array element types and data bindings reach the type cell',
      run() {
        const { files } = renderReference(sample());
        if (!files['ui.mdx'].includes('| `variant` | `enum`: `default`, `ghost` |')) return 'enum values missing';
        if (!files['record.mdx'].includes('| `stages` | `array` of `object` |')) return 'array element type missing';
        if (!files['element.mdx'].includes('| `content` | `string` \\| `object` |')) return 'type union missing';
        if (!files['plugins.mdx'].includes('`object` (`object` data binding)')) return 'binding missing';
        if (!files['plugins.mdx'].includes('Binding: \\{ object, view \\}.')) return 'description braces not escaped';
        return null;
      },
    },
    {
      label: 'a missing description renders a dash and required renders yes',
      run() {
        const ui = renderReference(sample()).files['ui.mdx'];
        if (!ui.includes('| `label` | `string` | yes | — |')) return 'required/dash row wrong';
        if (!renderReference(sample()).files['page.mdx'].includes('It takes no inputs.')) return 'empty inputs not stated';
        return null;
      },
    },
    { label: 'an empty manifest is refused', run: refuses({ components: {} }, /lists no components/) },
    { label: 'an unknown component key is refused', run: refuses(manifestOf(comp('box', 'ui', [], { slots: [] })), /carries `slots`/) },
    { label: 'an unknown input key is refused', run: refuses(manifestOf(comp('box', 'ui', [{ name: 'x', type: 'string', defaultValue: 1 }])), /carries `defaultValue`/) },
    { label: 'an unknown tier is refused', run: refuses(manifestOf(comp('box', 'ui', [], { tier: 'internal' })), /tier `internal`/) },
    { label: 'a namespace with no page is refused', run: refuses(manifestOf(comp('ai:suggestion', 'ai')), /namespace `ai`, which has no page/) },
    {
      label: 'a component keyed by something other than its type is refused',
      run: refuses({ components: { box: comp('stack', 'ui') } }, /key `box` names type `stack`/),
    },
    {
      label: 'two components sharing a heading id are refused',
      run: refuses(manifestOf(comp('page:card', 'page'), comp('page-card', 'page')), /share the heading id `page-card`/),
    },
    {
      label: 'check: the rendering of a directory just written is clean',
      run: () => withTmp((dir) => {
        const { files } = renderReference(sample());
        writeReference(files, dir);
        const problems = diffReference(files, dir);
        return problems.length === 0 ? null : problems.join('; ');
      }),
    },
    {
      label: 'check: one hand-edited line is drift, naming the file and line',
      run: () => withTmp((dir) => {
        const { files } = renderReference(sample());
        writeReference(files, dir);
        const path = join(dir, 'ui.mdx');
        writeFileSync(path, readFileSync(path, 'utf8').replace('| `gap` | `number` |', '| `gap` | `string` |'));
        const problems = diffReference(files, dir);
        return problems.length === 1 && /^ui\.mdx differs .* line \d+/.test(problems[0]) ? null : `got ${JSON.stringify(problems)}`;
      }),
    },
    {
      label: 'check: a missing file and a stray file are drift',
      run: () => withTmp((dir) => {
        const { files } = renderReference(sample());
        writeReference(files, dir);
        rmSync(join(dir, 'html.mdx'));
        writeFileSync(join(dir, 'button.mdx'), '# hand page\n');
        const problems = diffReference(files, dir);
        const ok = problems.some((p) => p.startsWith('html.mdx is missing')) && problems.some((p) => p.startsWith('button.mdx is not a generated file'));
        return ok && problems.length === 2 ? null : `got ${JSON.stringify(problems)}`;
      }),
    },
    {
      label: 'write: a stale file in the directory is removed',
      run: () => withTmp((dir) => {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'gone.mdx'), 'stale\n');
        writeReference(renderReference(sample()).files, dir);
        return existsSync(join(dir, 'gone.mdx')) ? 'gone.mdx survived a write' : null;
      }),
    },
    {
      label: 'the real manifest renders every component on exactly one page',
      run() {
        const manifest = readManifest();
        const { files, componentCount } = renderReference(manifest);
        const all = Object.values(files).join('\n');
        const n = Object.keys(manifest.components).length;
        if (componentCount !== n) return `rendered ${componentCount} of ${n}`;
        for (const type of Object.keys(manifest.components)) {
          if (!all.includes(`## ${code(type)} [#${anchorId(type)}]`)) return `${type} has no heading`;
        }
        return null;
      },
    },
  ];

  const batterySeen = new Map();
  const registerCase = (name) => {
    batterySeen.set(name, (batterySeen.get(name) ?? 0) + 1);
  };

  let failed = 0;
  for (const c of cases) {
    registerCase(c.label);
    let problem;
    try {
      problem = c.run();
    } catch (err) {
      problem = `threw: ${err.message}`;
    }
    if (problem) {
      failed += 1;
      console.error(`  ✗ ${c.label}\n      ${problem}`);
    } else {
      console.log(`  ✓ ${c.label}`);
    }
  }

  // ── The dispatch-gates population declaration ──────────────────────────
  // Outside the cases table on purpose: each row there is a declared battery
  // about the rendering, and this asserts what the derivation can see.
  const declFail = (message) => {
    console.error(`✗ self-test: ${message}`);
    failed += 1;
  };
  const declaredReads = ROOT_FILE_WATCH_HINTS.map((h) => h.replace(/\/\*+$/, ''));
  if (declaredReads.length !== 1 || declaredReads[0] !== MANIFEST_PATH) {
    declFail(`ROOT_FILE_WATCH_HINTS declares ${JSON.stringify(declaredReads)}, not the manifest this script reads `
      + `(${MANIFEST_PATH}) — an undeclared read is how a manifest-only diff stopped deriving this gate.`);
  }
  if (!ROOT_FILE_WATCH_HINTS.filter((h) => !h.replace(/\/\*+$/, '').includes('/')).every((h) => h.endsWith('/**'))) {
    declFail('a repo-ROOT file is declared without the subtree suffix — a bare single-segment literal is '
      + 'refused by hintCovers as too generic, so it would contribute no hint at all.');
  }

  const floorFailure = (message) => {
    console.error(`✗ self-test floor: ${message}`);
    failed += 1;
  };
  const declared = Object.keys(SELF_TEST_BATTERIES);
  if (declared.length < SELF_TEST_BATTERY_FLOOR) {
    floorFailure(`SELF_TEST_BATTERIES declares ${declared.length} batteries, below the pinned ${SELF_TEST_BATTERY_FLOOR}.`);
  }
  const labels = cases.map((c) => c.label);
  const duplicated = [...new Set(labels.filter((name, i) => labels.indexOf(name) !== i))];
  if (duplicated.length > 0) floorFailure(`row labels used twice: ${duplicated.map((n) => JSON.stringify(n)).join(', ')}.`);
  for (const [name, count] of batterySeen) {
    if (!declared.includes(name)) floorFailure(`battery "${name}" registered ${count} case(s) but is not declared in SELF_TEST_BATTERIES.`);
  }
  for (const name of declared) {
    const count = batterySeen.get(name) ?? 0;
    if (count < SELF_TEST_BATTERIES[name]) {
      floorFailure(`battery "${name}" DID NOT RUN — ${count} case(s) registered, ${SELF_TEST_BATTERIES[name]} pinned.`);
    }
  }

  if (failed > 0) {
    console.error(`\n✗ gen-sdui-reference self-test: ${failed} failure(s) (cases and floor).`);
    process.exit(1);
  }
  console.log(`\n✓ gen-sdui-reference self-test: ${cases.length} cases pass.`);
  selfTestReachedVerdict = true;
}

// ── Dispatch ───────────────────────────────────────────────────────────────

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    if (!selfTestReachedVerdict) {
      console.error('\n✗ gen-sdui-reference self-test: selfTest() returned without reaching its verdict, so no success line was printed.');
      process.exit(1);
    }
    return;
  }
  const dir = join(REPO_ROOT, OUT_DIR);
  let rendered;
  try {
    rendered = renderReference(readManifest());
  } catch (err) {
    if (!(err instanceof ReferenceRenderError)) throw err;
    console.error(`✗ gen-sdui-reference: ${err.message}`);
    process.exit(1);
  }
  const { files, componentCount, pageCount } = rendered;
  if (process.argv.includes('--check')) {
    const problems = diffReference(files, dir);
    if (problems.length > 0) {
      console.error(`✗ gen-sdui-reference --check: ${OUT_DIR}/ is not what ${MANIFEST_PATH} generates:\n`);
      for (const p of problems) console.error(`  - ${p}`);
      console.error(`\nRun \`${COMMAND}\` and commit what it writes. Never edit a page under ${OUT_DIR}/ by hand.`);
      process.exit(1);
    }
    console.log(`✓ gen-sdui-reference --check: ${OUT_DIR}/ matches ${MANIFEST_PATH} (${componentCount} components on ${pageCount} pages).`);
    return;
  }
  writeReference(files, dir);
  console.log(`✓ gen-sdui-reference: wrote ${componentCount} components on ${pageCount} pages, plus index.mdx and meta.json, to ${OUT_DIR}/.`);
}

if (isEntrypoint(import.meta.url)) {
  main();
}
