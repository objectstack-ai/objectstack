// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25077] Every outlet in this package that renders a value into HTML escapes
 * it by the context it lands in — ruling 3C on #25040.
 *
 * ## The rule
 *
 * The burden sits on the OUTLET: the code that places a value into markup. A
 * value reaching an HTML outlet may carry any character, and nothing upstream
 * strips or refuses it, so the outlet escapes it for the context it lands in —
 * element text or a quoted attribute value. This package has NO such outlet
 * today. Its one outlet, the `GET {base}/docs` viewer page in
 * `discovery-routes.ts`, was retired with its route (#25104), and the escaper
 * that page called left with it, having no other caller. A new outlet escapes
 * by context and joins {@link OUTLETS} with a pin that drives its real render
 * path.
 *
 * ## The list, and the pin on the list itself
 *
 * {@link OUTLETS} names every file of this package that renders a value into
 * HTML, each with a pin that drives its real render path. A per-entry pin
 * cannot see an outlet nobody listed, so the LIST is pinned too: the census
 * walks this package's source and finds every file that touches HTML at all —
 * an identifier or a string naming `html`, or a string carrying an HTML tag —
 * and requires each one to be on {@link OUTLETS} or on {@link NOT_OUTLETS} with
 * the reason it renders nothing. A new file that touches HTML fails here until
 * its author says which it is. A positive control proves the census finds an
 * outlet and reds on it while it is unlisted: it runs over this package's tree
 * plus a FIXTURE source shaped like the retired viewer page, because the tree
 * itself no longer holds one.
 *
 * ⚠️ LIMIT, stated so it is not read as more: the census reads source text of
 * THIS package. It proves no unlisted file here touches HTML; it does not see
 * another package (each package holding an outlet carries its own list), and it
 * does not prove a listed outlet escapes — that is what the per-entry pin is
 * for.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, it, expect } from 'vitest';

/** …/packages/rest/src — this package's whole source tree. */
const SRC = dirname(fileURLToPath(import.meta.url));

/** A file that renders a value into HTML, and the pin that holds it to the rule. */
interface OutletEntry {
  /** What it renders. */
  readonly renders: string;
  /** Registers the pin that drives its real render path — an outlet cannot be listed without one. */
  readonly pin: () => void;
}

/** A file that touches HTML without rendering a value into it. */
interface NotOutletEntry {
  readonly why: string;
}

/** Empty since #25104: the one outlet, the `GET {base}/docs` viewer page, was retired with its route. */
const OUTLETS: Readonly<Record<string, OutletEntry>> = {};

const NOT_OUTLETS: Readonly<Record<string, NotOutletEntry>> = {
  'import-template.ts': { why: 'names "html" as a sample field-type string in SAMPLE_TEXT_TYPES; renders nothing' },
};

// ── The census ──────────────────────────────────────────────────────────────

const HTML_WORD = /html/i;
/** An HTML element opening or closing tag inside a string. */
const HTML_TAG =
  /<(?:!doctype|\/?(?:html|head|body|title|meta|style|script|link|p|a|b|i|u|em|strong|small|span|div|br|hr|img|table|thead|tbody|tfoot|tr|td|th|ul|ol|li|h[1-6]|form|input|button|textarea|select|option|label|pre|code|blockquote|section|article|header|footer|nav|main|center|font|iframe|svg|mj-[a-z-]+))(?=[\s>/])/i;

/** Does this source touch HTML in CODE — comments never count. */
function touchesHtml(fileName: string, text: string): boolean {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  let hit = false;
  const visit = (node: ts.Node): void => {
    if (hit) return;
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      if (HTML_WORD.test(node.text)) hit = true;
    } else if (
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
    ) {
      if (HTML_WORD.test(node.text) || HTML_TAG.test(node.text)) hit = true;
    }
    if (!hit) ts.forEachChild(node, visit);
  };
  visit(source);
  return hit;
}

/** Every shipped source file, package-relative. Tests and test kits ship nothing. */
function shippedSources(dir = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...shippedSources(full));
      continue;
    }
    if (!entry.endsWith('.ts') || entry.endsWith('.d.ts')) continue;
    if (entry.endsWith('.test.ts') || entry.endsWith('.testkit.ts')) continue;
    out.push(relative(SRC, full).split(sep).join('/'));
  }
  return out.sort();
}

/** Every shipped source file's text, keyed package-relative. */
function shippedSourceTexts(): Map<string, string> {
  return new Map(shippedSources().map((rel) => [rel, readFileSync(join(SRC, rel), 'utf8')]));
}

/** The files among `sources` whose code touches HTML, sorted. */
function touchingFiles(sources: ReadonlyMap<string, string>): string[] {
  return [...sources].filter(([rel, text]) => touchesHtml(rel, text)).map(([rel]) => rel).sort();
}

/** The listed files, outlets and non-outlets together, sorted. */
function listedFiles(): string[] {
  return [...Object.keys(OUTLETS), ...Object.keys(NOT_OUTLETS)].sort();
}

/**
 * The positive control's fixture: a source shaped like the retired viewer page,
 * a request-derived value placed into a quoted attribute of a served document.
 * It is a string, never a file, so the tree the census reads is unchanged.
 */
const FIXTURE_OUTLET_FILE = 'fixture-viewer-page.ts';
const FIXTURE_OUTLET_SOURCE = [
  'export function page(specUrl: string): string {',
  '  return `<!doctype html>',
  '<html><body>',
  '<script id="api-reference" data-url="${specUrl}"></script>',
  '</body></html>`;',
  '}',
].join('\n');

describe('the outlet list — every file here that touches HTML is classified', () => {
  it('the census reads code, not comments (control)', () => {
    expect(touchesHtml('a.ts', '// renders html\nexport const x = 1;')).toBe(false);
    expect(touchesHtml('a.ts', 'export const x = `<p>${1}</p>`;')).toBe(true);
    expect(touchesHtml('a.ts', 'export const bodyHtml = 1;')).toBe(true);
    expect(touchesHtml('a.ts', "export const t = 'text/html';")).toBe(true);
  });

  it('the census finds an outlet, and an unlisted one breaks the classification (positive control, on a fixture)', () => {
    // The tree holds no outlet since #25104, so the control is a fixture source
    // added to the tree's own texts: the census must find it, and it must be
    // exactly what the classification below would red on.
    const sources = shippedSourceTexts();
    expect(sources.has(FIXTURE_OUTLET_FILE), 'the fixture names no real file').toBe(false);
    sources.set(FIXTURE_OUTLET_FILE, FIXTURE_OUTLET_SOURCE);
    const touching = touchingFiles(sources);
    expect(touching).toContain(FIXTURE_OUTLET_FILE);
    expect(touching.filter((f) => !listedFiles().includes(f))).toEqual([FIXTURE_OUTLET_FILE]);
    expect(touching).not.toEqual(listedFiles());
  });

  it('the files that touch HTML are exactly the listed outlets and non-outlets', () => {
    expect(touchingFiles(shippedSourceTexts())).toEqual(listedFiles());
  });

  it('no file is both an outlet and a non-outlet', () => {
    expect(Object.keys(OUTLETS).filter((f) => f in NOT_OUTLETS)).toEqual([]);
  });
});

// ── The per-entry pin ─────────────────────────────────────────────────────

// Each listed outlet registers the pin that drives its real render path. The
// list is empty today (see OUTLETS), so this registers nothing until an outlet
// joins it.
for (const [file, entry] of Object.entries(OUTLETS)) {
  describe(`${file} — ${entry.renders}`, entry.pin);
}
