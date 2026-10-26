/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Every taught `page` node DRAWS THE HEADING IT SHOWS (objectui#11436).
 *
 * ## The defect
 *
 * `PageRenderer` reads `pageType`, which defaults to `'record'`, to decide who
 * draws the page's `h1`. A record page leaves the heading to a `page:header`
 * block and never draws `description`. Every other page type draws `title` as
 * the `h1` and `description` under it. objectui#11423 corrected the layout
 * guide. The same shape, a `page` node with a `title` or `description` and no
 * `pageType`, was still taught by the five catalog demos of
 * `content/docs/components/layout/page.mdx`, by `examples/hello-world`, and by
 * fences in seven more documentation pages. Rendered through the real
 * `SchemaRenderer`, each was a record page that drew no heading.
 *
 * ## The population is computed, not listed
 *
 * The reader below walks every fence of every `.md` / `.mdx` page under
 * `content/docs`, in ANY language, and every non-test source under `examples`.
 * Each is parsed with the TypeScript parser, so a `json`, `jsonc`, `ts`, `tsx`
 * or `plaintext` fence is read the same way, and every object literal whose
 * `type` is `'page'` is a page node. Its literal value is evaluated, and a
 * value the parser cannot evaluate (an identifier, a spread, a `[...]`
 * placeholder) is left out. A page node joins the population when it authors a
 * heading or a description: a `title`, a `description`, or a titled `page:header`
 * block in its `children` or regions. A navigation entry that targets a page
 * (`type: "page"` with a `pageName` and a `label`) authors neither and stays out.
 *
 * objectui#11450 adds the producers under `packages/`: every fence of every
 * `README.md` anywhere under `packages/`, read by the same fence reader, and the
 * page `objectui generate page` writes. The generator is RUN, into a throwaway
 * directory, and its file is read back -- the bytes a user receives, not a
 * transcription of them.
 *
 * Boundaries of the reader, stated so nobody reads them as coverage:
 *   - A `ts` / `tsx` fence is parsed as a module, so a fence whose whole body is
 *     a bare `{ ... }` reads as a block, not an object. That is the shape of the
 *     layout guide's Schema API excerpt, which is not a node.
 *   - The README walk is a filesystem walk, like the docs and examples walks. It
 *     skips installs and build output by directory name, and it does not consult
 *     `.gitignore`, so a README someone writes into an ignored directory of a
 *     local checkout is read too. A fresh checkout, which is what CI reads, holds
 *     only tracked READMEs.
 *   - Runtime sources under `packages/` are outside the population, apart from
 *     the generator's output. A runtime page literal is not a taught node.
 *
 * ## What this file asserts
 *
 *   1. STATIC: a page node that writes `title` or `description` names a
 *      `pageType` that draws them, which is every member of the spec's
 *      `PageTypeSchema` except `record`. A `pageType` that is not a member at all
 *      (`detail`, `dashboard`) fails too, because validation refuses it.
 *   2. RENDER: every page node that authors a heading renders through the real
 *      `SchemaRenderer` and draws exactly ONE `h1` with that text, inside the
 *      `page:header` block when that block owns it and outside any header when
 *      the page draws it. A node with a `description` draws that too.
 *   3. LIVE CONTROLS: each node whose heading the page draws, with its
 *      `pageType` removed, draws no `h1` and no description. A record page whose
 *      heading is a `page:header` block, with that heading moved back onto the
 *      page node, draws no `h1`. Without these, "one `h1` with this text" would
 *      also pass on a renderer that drew `title` on every page type.
 *   4. FLOOR: every producer this card and objectui#11423 corrected is still in
 *      the population, named by file and heading, so the population cannot
 *      shrink to a list that passes because it is empty.
 *   5. DECLARED SHAPE: a TypeScript interface in a fence that declares a
 *      `type: 'page'` node with a `title` also declares `pageType`.
 *
 * The `markdown` child the generator writes is not rendered as markdown here:
 * plugin-markdown is a plugin this package does not register, so that node draws
 * the unknown-type alert, which holds no heading. Whether the child would draw a
 * second `h1` under plugin-markdown is asserted on its text in the cli package's
 * `generate-page-dialect-9847.test.ts`.
 *
 * This file subsumes objectui#11423's pin, which read the layout guide's `json`
 * fences alone and was retired when this one landed. Its four named passages
 * are in the floor below, and its two live controls are the general ones in (3).
 *
 * ## Placement
 *
 * `content/docs/**` is excluded from `ci.yml`'s full-run decision on
 * `pull_request`. `scripts/markdown-test-inputs.mjs` records this file as a
 * reader of that tree, which is what puts a docs-only edit back in that run.
 * The file sits in the package `PageRenderer` lives in. The renderers are
 * imported at module scope, not in `beforeAll`, per AGENTS.md's flaky-test
 * discipline.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { PageTypeSchema } from '@objectstack/spec/ui';
import '../renderers';
import { SchemaRenderer } from '@object-ui/react';
// The generator's source, not `@object-ui/cli`: that package publishes its
// commands only as a bin, and the test needs `generate` itself (objectui#11450).
import { generate } from '../../../cli/src/commands/generate';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');

type Doc = Record<string, unknown>;

/** The spec's page kinds. `PageTypeSchema` is lazy; `.options` is the member list. */
const MEMBERS: readonly string[] = (PageTypeSchema as unknown as { options: readonly string[] }).options;
/** The kinds that draw the page's own `title` and `description`. */
const DRAWING = MEMBERS.filter((t) => t !== 'record');

// ---------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', 'test', '__tests__']);

/**
 * What the README walk never enters: installs and build output. It does enter
 * test directories, because a README there is still a tracked package README.
 */
const README_SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage']);

function walk(
  dir: string,
  keep: (name: string) => boolean,
  skip: ReadonlySet<string> = SKIP_DIRS,
  out: string[] = [],
): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skip.has(entry.name)) walk(full, keep, skip, out);
    } else if (keep(entry.name)) {
      out.push(full);
    }
  }
  return out.sort();
}

/** One parseable unit: a fence of a docs page, or a whole example source. */
interface Unit {
  file: string;
  /** The heading the fence sits under; empty for an example source. */
  where: string;
  lang: string;
  text: string;
  /** Parse the text as one expression (JSON and JSON-like prose fences). */
  asExpression: boolean;
}

const JSON_LIKE = new Set(['json', 'jsonc', 'json5']);
const PROSE_LIKE = new Set(['', 'plaintext', 'text']);
const OPEN = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/;

function fencesOf(file: string): Unit[] {
  const lines = readFileSync(file, 'utf8').split('\n');
  const out: Unit[] = [];
  let where = '';
  for (let i = 0; i < lines.length; i++) {
    const heading = /^#{1,6}\s+(.+?)\s*$/.exec(lines[i]);
    if (heading) {
      where = heading[1];
      continue;
    }
    const open = OPEN.exec(lines[i]);
    if (!open) continue;
    const close = new RegExp(`^\\s*\\${open[1][0]}{${open[1].length},}\\s*$`);
    let end = i + 1;
    while (end < lines.length && !close.test(lines[end])) end++;
    const text = lines.slice(i + 1, end).join('\n');
    const lang = open[2].toLowerCase();
    out.push({
      file: path.relative(repoRoot, file),
      where,
      lang: lang || '(none)',
      text,
      asExpression: JSON_LIKE.has(lang) || (PROSE_LIKE.has(lang) && /^\s*[[{]/.test(text)),
    });
    i = end;
  }
  return out;
}

const NOT_LITERAL = Symbol('not a literal');

/** The literal value of an expression, leaving out every part that is not one. */
function evaluate(node: ts.Expression): unknown {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    return evaluate(node.expression);
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(node.operand)
  ) {
    return -Number(node.operand.text);
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((e) => (ts.isSpreadElement(e) ? NOT_LITERAL : evaluate(e))).filter((v) => v !== NOT_LITERAL);
  }
  if (ts.isObjectLiteralExpression(node)) {
    const out: Doc = {};
    for (const p of node.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      if (!ts.isIdentifier(p.name) && !ts.isStringLiteral(p.name)) continue;
      const value = evaluate(p.initializer);
      if (value !== NOT_LITERAL) out[p.name.text] = value;
    }
    return out;
  }
  return NOT_LITERAL;
}

const sourceOf = (unit: Unit) =>
  ts.createSourceFile(
    'unit.tsx',
    unit.asExpression ? `(${unit.text}\n)` : unit.text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

const isPageLiteral = (n: ts.ObjectLiteralExpression) =>
  n.properties.some(
    (p) =>
      ts.isPropertyAssignment(p) &&
      (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
      p.name.text === 'type' &&
      (ts.isStringLiteral(p.initializer) || ts.isNoSubstitutionTemplateLiteral(p.initializer)) &&
      p.initializer.text === 'page',
  );

/** A page node one of the units teaches. */
interface PageNode {
  file: string;
  where: string;
  lang: string;
  doc: Doc;
}

/** A TypeScript interface (or type literal) that declares a `type: 'page'` member. */
interface PageDeclaration {
  file: string;
  where: string;
  members: string[];
}

function read(units: Unit[]) {
  const nodes: PageNode[] = [];
  const declarations: PageDeclaration[] = [];
  for (const unit of units) {
    if (!/\bpage\b/.test(unit.text)) continue;
    const visit = (n: ts.Node) => {
      if (ts.isObjectLiteralExpression(n) && isPageLiteral(n)) {
        nodes.push({ file: unit.file, where: unit.where, lang: unit.lang, doc: evaluate(n) as Doc });
      }
      if (ts.isInterfaceDeclaration(n) || ts.isTypeLiteralNode(n)) {
        const names = n.members.flatMap((m) => (m.name && ts.isIdentifier(m.name) ? [m.name.text] : []));
        const declaresPage = n.members.some(
          (m) =>
            ts.isPropertySignature(m) &&
            m.name.getText() === 'type' &&
            !!m.type &&
            ts.isLiteralTypeNode(m.type) &&
            ts.isStringLiteral(m.type.literal) &&
            m.type.literal.text === 'page',
        );
        if (declaresPage) declarations.push({ file: unit.file, where: unit.where, members: names });
      }
      ts.forEachChild(n, visit);
    };
    visit(sourceOf(unit));
  }
  return { nodes, declarations };
}

const DOC_FILES = walk(path.join(repoRoot, 'content/docs'), (name) => /\.mdx?$/.test(name));
const DOC_UNITS = DOC_FILES.flatMap(fencesOf);
const EXAMPLE_UNITS: Unit[] = walk(
  path.join(repoRoot, 'examples'),
  (name) => /\.(json|[cm]?[jt]sx?)$/.test(name) && !/\.test\./.test(name),
).map((file) => ({
  file: path.relative(repoRoot, file),
  where: '',
  lang: path.extname(file).slice(1),
  text: readFileSync(file, 'utf8'),
  asExpression: file.endsWith('.json'),
}));
const README_FILES = walk(path.join(repoRoot, 'packages'), (name) => name === 'README.md', README_SKIP_DIRS);
const README_UNITS = README_FILES.flatMap(fencesOf);

/** The producer `objectui generate page NAME` is, as this file labels it. */
const GENERATOR = 'packages/cli/src/commands/generate.ts';
const GENERATOR_WHERE = 'objectui generate page';

/**
 * The page `objectui generate page` writes, as one JSON unit (objectui#11450).
 * `generate` takes its target directory from `process.cwd()`, so the cwd is
 * stubbed for the one call and restored, the lever the cli package's
 * `generate-page-dialect-9847.test.ts` uses. A generator that writes no file
 * fails this module's load, loudly.
 */
async function generatorUnits(): Promise<Unit[]> {
  const dir = mkdtempSync(path.join(tmpdir(), 'objectui-generate-11450-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(dir);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    await generate('page', 'Reports');
    const text = readFileSync(path.join(dir, 'pages', 'reports.json'), 'utf8');
    return [{ file: GENERATOR, where: GENERATOR_WHERE, lang: 'json', text, asExpression: true }];
  } finally {
    cwd.mockRestore();
    log.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
}
const GENERATED_UNITS = await generatorUnits();

const { nodes: PAGES, declarations: DECLARATIONS } = read([
  ...DOC_UNITS,
  ...EXAMPLE_UNITS,
  ...README_UNITS,
  ...GENERATED_UNITS,
]);

// ---------------------------------------------------------------------------
// What a page node shows, and what it draws
// ---------------------------------------------------------------------------

const literalText = (value: unknown) =>
  typeof value === 'string' ? value.replace(/\{[a-zA-Z0-9_.]+\}/g, '').trim() : '';

/** The title of the first titled `page:header` among nodes, walked the way `PageRenderer` walks them. */
function headerTitle(nodes: unknown, depth = 0): string | null {
  if (depth > 6) return null;
  const list = Array.isArray(nodes) ? nodes : nodes ? [nodes] : [];
  for (const n of list) {
    if (!n || typeof n !== 'object') continue;
    const node = n as Doc;
    if (node.type === 'page:header') {
      const title = literalText(node.title ?? (node.properties as Doc | undefined)?.title);
      if (title) return title;
    }
    const nested = headerTitle(node.components, depth + 1) ?? headerTitle(node.children, depth + 1);
    if (nested) return nested;
  }
  return null;
}

/** The heading a page node SHOWS a reader, and which element is meant to draw it. */
function authoredHeading(doc: Doc): { text: string; by: 'page' | 'page:header' } | null {
  const regionNodes = Array.isArray(doc.regions)
    ? (doc.regions as Doc[]).flatMap((r) => (Array.isArray(r?.components) ? r.components : []))
    : [];
  const fromHeader = headerTitle(regionNodes) ?? headerTitle(doc.children);
  if (fromHeader) return { text: fromHeader, by: 'page:header' };
  return typeof doc.title === 'string' && doc.title !== '' ? { text: doc.title, by: 'page' } : null;
}

const effectivePageType = (doc: Doc) => (doc.pageType as string | undefined) || 'record';
const label = (p: PageNode) => (p.where ? `${p.file} › ${p.where}` : p.file);

/** What the real renderers put on screen for this document. */
function drawn(doc: unknown) {
  const { container } = render(<SchemaRenderer schema={doc as never} />);
  const h1s = Array.from(container.querySelectorAll('h1')).map((h) => ({
    text: h.textContent?.trim() ?? '',
    inHeaderBlock: !!h.closest('header'),
  }));
  const paragraphs = Array.from(container.querySelectorAll('p')).map((p) => p.textContent?.trim() ?? '');
  const pageType = container.querySelector('[data-page-type]')?.getAttribute('data-page-type') ?? null;
  cleanup();
  return { h1s, paragraphs, pageType };
}

/** The population: page nodes that author a heading or a description. */
const SHOWING = PAGES.filter(
  (p) => authoredHeading(p.doc) !== null || typeof p.doc.description === 'string',
);
const HEADED = SHOWING.flatMap((p) => {
  const heading = authoredHeading(p.doc);
  return heading ? [{ ...p, heading }] : [];
});
const DESCRIBED = SHOWING.filter((p) => typeof p.doc.description === 'string');

/**
 * The producers objectui#11423 and this card corrected, by file and heading.
 * Derived population, PINNED floor: a producer that loses its page node, or its
 * heading, would otherwise drop out of every assertion below without a sound.
 */
const CORRECTED: ReadonlyArray<readonly [file: string, where: string]> = [
  // objectui#11423 — the layout guide.
  ['content/docs/guide/layout.md', 'Basic Usage'],
  ['content/docs/guide/layout.md', 'With Action Buttons'],
  ['content/docs/guide/layout.md', 'Detail Page with Actions'],
  ['content/docs/guide/layout.md', '3. Action Buttons at the Top of the Body'],
  // objectui#11436 — the catalog demos of the Page reference, and the example app.
  ['examples/schema-catalog/src/schemas/components-layout-page/simple-page.json', ''],
  ['examples/schema-catalog/src/schemas/components-layout-page/page-with-header.json', ''],
  ['examples/schema-catalog/src/schemas/components-layout-page/full-dashboard.json', ''],
  ['examples/schema-catalog/src/schemas/components-layout-page/settings-layout.json', ''],
  ['examples/schema-catalog/src/schemas/components-layout-page/documentation-page.json', ''],
  ['examples/hello-world/schema.json', ''],
  // objectui#11436 — docs fences: json, jsonc, tsx and plaintext alike.
  ['content/docs/api/schema-reference.md', 'PageNodeSchema'],
  ['content/docs/api/schema-reference.md', 'Schema Composition'],
  ['content/docs/utilities/runner.mdx', '1. Plugin Development'],
  ['content/docs/utilities/runner.mdx', 'Add Custom Schemas'],
  ['content/docs/guide/schema-playground.md', 'Composing Schemas'],
  ['content/docs/guide/schema-rendering.md', 'The SchemaRenderer Component'],
  ['content/docs/guide/schema-rendering.md', 'Nested Schemas'],
  ['content/docs/guide/schema-rendering.md', 'TypeScript Support'],
  ['content/docs/core/schema-renderer.mdx', 'Simple Rendering'],
  ['content/docs/components/feedback/toaster.mdx', 'In App Layout'],
  // objectui#11450 — the producers under `packages/`: two published READMEs,
  // and the page the CLI generator writes.
  ['packages/core/README.md', 'Type Definitions'],
  ['packages/runner/README.md', 'Example Schema'],
  [GENERATOR, GENERATOR_WHERE],
];

describe('objectui#11436 — every taught page node draws the heading it shows', () => {
  it('LIT CONTROL — the reader walks the docs, examples and package READMEs and parses their fences', () => {
    // A broken walker or fence reader would hand every assertion below an
    // empty list. The floors are loose on purpose: they catch a reader that
    // found nothing, not a page that was deleted.
    expect(DOC_FILES.length).toBeGreaterThan(100);
    expect(DOC_UNITS.length).toBeGreaterThan(500);
    expect(EXAMPLE_UNITS.length).toBeGreaterThan(100);
    expect(README_FILES.length).toBeGreaterThan(20);
    expect(README_UNITS.length).toBeGreaterThan(100);
    // The walk reached past the package roots: a README in a nested directory
    // is a package README too.
    expect(README_FILES.some((f) => path.relative(repoRoot, f).split(path.sep).length > 3)).toBe(true);
    // The population spans fence languages the old `json`-only reader could
    // not see. A parser that stopped reading one of them would drop it here.
    for (const lang of ['json', 'jsonc', 'tsx', 'plaintext']) {
      expect({ lang, read: SHOWING.some((p) => p.lang === lang) }).toEqual({ lang, read: true });
    }
  });

  it('every corrected producer is still in the population', () => {
    for (const [file, where] of CORRECTED) {
      const found = HEADED.some((p) => p.file === file && p.where === where);
      expect({ file, where, found }).toEqual({ file, where, found: true });
    }
  });

  it('a page node names a `pageType` the spec declares, or none', () => {
    const offenders = SHOWING.filter(
      (p) => p.doc.pageType !== undefined && !MEMBERS.includes(p.doc.pageType as string),
    ).map((p) => `${label(p)} (pageType: ${JSON.stringify(p.doc.pageType)})`);
    expect(
      offenders,
      `\`pageType\` takes the spec's PageTypeSchema members (${MEMBERS.join(', ')}); validation refuses any other value.`,
    ).toEqual([]);
  });

  it('no page node writes `title` or `description` on a record page, where neither draws', () => {
    const offenders = SHOWING.filter(
      (p) => effectivePageType(p.doc) === 'record' && ('title' in p.doc || 'description' in p.doc),
    ).map(label);
    expect(
      offenders,
      'A page with no `pageType` is a record page: it draws neither `title` nor `description`. ' +
        `Name the page type that draws them (${DRAWING.join(', ')}), or put the heading in a \`page:header\` block.`,
    ).toEqual([]);
  });

  it.each(HEADED.map((p) => [label(p), p.heading.text, p.heading.by, p.doc] as const))(
    'draws exactly one h1 with its heading: %s ("%s", drawn by %s)',
    (_label, text, by, doc) => {
      const { h1s } = drawn(doc);
      expect(h1s.map((h) => h.text)).toEqual([text]);
      // Who draws it is the mechanism this card is about: a `page:header`
      // block draws its own `h1`; a page with a drawing type draws `title`
      // itself, outside any header block.
      expect(h1s[0].inHeaderBlock).toBe(by === 'page:header');
    },
  );

  it.each(DESCRIBED.map((p) => [label(p), p.doc] as const))('draws its description: %s', (_label, doc) => {
    const { paragraphs } = drawn(doc);
    expect(paragraphs).toContain(doc.description);
  });

  it('the described population carries the producers that show a description', () => {
    const described = new Set(DESCRIBED.map(label));
    for (const id of [
      'content/docs/guide/layout.md › Basic Usage',
      'content/docs/api/schema-reference.md › PageNodeSchema',
      'examples/schema-catalog/src/schemas/components-layout-page/page-with-header.json',
    ]) {
      expect({ id, described: described.has(id) }).toEqual({ id, described: true });
    }
  });

  const PAGE_DRAWN = HEADED.filter((p) => p.heading.by === 'page');
  it.each(PAGE_DRAWN.map((p) => [label(p), p.doc] as const))(
    'LIVE CONTROL — without its `pageType` the page draws no heading and no description: %s',
    (_label, doc) => {
      // The reading this card was filed on: the same document as a record page.
      // If this ever draws the title, a record page started drawing `title` and
      // the render assertions above stopped telling the page types apart.
      const { pageType, ...asRecordPage } = doc;
      expect(DRAWING).toContain(pageType);
      const { h1s, paragraphs, pageType: rendered } = drawn(asRecordPage);
      expect(rendered).toBe('record');
      expect(h1s).toEqual([]);
      if (typeof doc.description === 'string') expect(paragraphs).not.toContain(doc.description);
    },
  );

  const RECORD_HEADER_DRAWN = HEADED.filter(
    (p) => p.heading.by === 'page:header' && effectivePageType(p.doc) === 'record',
  );
  it('LIVE CONTROL — a record page with its heading back on the page node draws no h1', () => {
    // The shape the layout guide's Detail Page with Actions had: `title` on a
    // record page, no `page:header`. The page type is read too, so "no h1" is
    // about the heading and not about the document failing to render.
    expect(RECORD_HEADER_DRAWN.map(label)).toContain('content/docs/guide/layout.md › Detail Page with Actions');
    for (const p of RECORD_HEADER_DRAWN) {
      const children = (Array.isArray(p.doc.children) ? p.doc.children : [p.doc.children]).filter(
        (n) => (n as Doc | undefined)?.type !== 'page:header',
      );
      const { h1s, pageType } = drawn({ ...p.doc, title: p.heading.text, children });
      expect({ page: label(p), pageType, h1s }).toEqual({ page: label(p), pageType: 'record', h1s: [] });
    }
  });

  it('a TypeScript shape of the page node that declares `title` also declares `pageType`', () => {
    // The Page reference's Schema block omitted `pageType`, so the one key that
    // decides whether `title` draws was missing from the shape that lists `title`.
    const titled = DECLARATIONS.filter((d) => d.members.includes('title'));
    expect(titled.map((d) => d.file)).toContain('content/docs/components/layout/page.mdx');
    const offenders = titled.filter((d) => !d.members.includes('pageType')).map((d) => `${d.file} › ${d.where}`);
    expect(offenders).toEqual([]);
  });
});
