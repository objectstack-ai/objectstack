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
 * element text or a quoted attribute value. This package has exactly one such
 * outlet today: the `GET {base}/docs` viewer in `discovery-routes.ts`, which
 * places the request-derived openapi URL into a `data-url="…"` attribute.
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
 * its author says which it is. A positive control proves the census actually
 * finds the known outlet.
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
import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server.js';

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

const OUTLETS: Readonly<Record<string, OutletEntry>> = {
  'discovery-routes.ts': {
    renders: 'the GET {base}/docs Scalar viewer page, which places the request-derived openapi URL into a data-url attribute',
    pin: pinDocsViewer,
  },
};

const NOT_OUTLETS: Readonly<Record<string, NotOutletEntry>> = {
  'html-escape.ts': { why: 'the escaper the outlet calls; renders nothing itself' },
  'import-template.ts': { why: 'names "html" as a sample field-type string in SAMPLE_TEXT_TYPES; renders nothing' },
  'rest-route-ledger.ts': { why: 'a route-ledger note describing the docs page in prose; renders nothing' },
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

describe('the outlet list — every file here that touches HTML is classified', () => {
  it('the census reads code, not comments (control)', () => {
    expect(touchesHtml('a.ts', '// renders html\nexport const x = 1;')).toBe(false);
    expect(touchesHtml('a.ts', 'export const x = `<p>${1}</p>`;')).toBe(true);
    expect(touchesHtml('a.ts', 'export const bodyHtml = 1;')).toBe(true);
    expect(touchesHtml('a.ts', "export const t = 'text/html';")).toBe(true);
  });

  it('the census finds the known outlet (positive control)', () => {
    const outlet = 'discovery-routes.ts';
    expect(Object.keys(OUTLETS)).toContain(outlet);
    expect(touchesHtml(outlet, readFileSync(join(SRC, outlet), 'utf8'))).toBe(true);
  });

  it('the files that touch HTML are exactly the listed outlets and non-outlets', () => {
    const touching = shippedSources().filter((rel) => touchesHtml(rel, readFileSync(join(SRC, rel), 'utf8')));
    const listed = [...Object.keys(OUTLETS), ...Object.keys(NOT_OUTLETS)].sort();
    expect(touching).toEqual(listed);
  });

  it('no file is both an outlet and a non-outlet', () => {
    expect(Object.keys(OUTLETS).filter((f) => f in NOT_OUTLETS)).toEqual([]);
  });
});

// ── The per-entry pin ─────────────────────────────────────────────────────

const UNSCOPED = '/api/v1';
const SCOPED = '/api/v1/environments/:environmentId';

/** Mount both bases, a signed-in context, and drive the GET {base}/docs handler. */
function makeRest() {
  const httpServer = {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn(), close: vi.fn(),
  } as any;
  const protocol: any = { getMetaItems: vi.fn(async () => ({ items: [] })) };
  const rest = new RestServer(
    httpServer, protocol,
    { api: { version: 'v1', enableProjectScoping: true, projectResolution: 'auto' } } as any,
  );
  (rest as any).resolveExecCtx = vi.fn(async () => ({ userId: 'u_docs_reader' }));
  rest.registerRoutes();
  return rest;
}

/** The viewer's `data-url` attribute value, as served for a request whose path is `reqPath`. */
async function dataUrlFor(rest: RestServer, mountPath: string, reqPath: string, environmentId?: string): Promise<string> {
  const entry = (rest as any).routeManager.get('GET', mountPath);
  expect(entry, `GET ${mountPath} must be mounted`).toBeDefined();
  let html = '';
  const res: any = {
    status: () => res,
    json: () => res,
    send: (body: string) => { html = body; return res; },
    setHeader: () => res,
    header: () => res,
  };
  await entry.handler({
    method: 'GET', path: reqPath, url: reqPath,
    params: environmentId ? { environmentId } : {}, query: {},
    headers: { host: 'example.test' },
  }, res);
  const m = html.match(/data-url="([^\n]*)"><\/script>/);
  expect(m, 'the viewer page carries a data-url attribute').not.toBeNull();
  return m![1];
}

function pinDocsViewer(): void {
  /**
   * A path segment carrying the characters a quoted HTML attribute interprets.
   * Kept to the minimum the context reads — a quote, an angle bracket, an
   * ampersand, an apostrophe — not an attack string.
   */
  const SPECIAL_ENV = 'a"<&\'b';
  const SPECIAL_ENV_ESCAPED = 'a&quot;&lt;&amp;&#39;b';

  it('a value carrying attribute-interpreted characters is escaped for the attribute context', async () => {
    const rest = makeRest();
    const reqPath = `/api/v1/environments/${SPECIAL_ENV}/docs`;
    const dataUrl = await dataUrlFor(rest, `${SCOPED}/docs`, reqPath, SPECIAL_ENV);
    expect(dataUrl).toBe(`/api/v1/environments/${SPECIAL_ENV_ESCAPED}/openapi.json`);
    // The literal characters do not survive into the served attribute value.
    expect(dataUrl).not.toContain('"');
    expect(dataUrl).not.toContain('<');
  });

  it('an ordinary URL is served byte-identical', async () => {
    const rest = makeRest();
    const unscoped = await dataUrlFor(rest, `${UNSCOPED}/docs`, '/api/v1/docs');
    expect(unscoped).toBe('/api/v1/openapi.json');
    const scoped = await dataUrlFor(rest, `${SCOPED}/docs`, '/api/v1/environments/env_1/docs', 'env_1');
    expect(scoped).toBe('/api/v1/environments/env_1/openapi.json');
  });
}

// Registered last, so every helper above is initialised before the pin reads it.
for (const [file, entry] of Object.entries(OUTLETS)) {
  describe(`${file} — ${entry.renders}`, entry.pin);
}
