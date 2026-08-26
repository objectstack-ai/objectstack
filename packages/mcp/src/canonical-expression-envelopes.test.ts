// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Gate — every `Page` this package ships must serve the CANONICAL
 * `{ dialect, source }` envelope at every `ExpressionInputSchema` position
 * (#12269, extending #11255's platform-objects gate and #11480's
 * cloud-connection gate to the third page-shipping package).
 *
 * `CONNECT_AGENT_PAGE` is a raw typed object literal reaching the kernel
 * through this plugin's own manifest bundle (`CONNECT_AGENT_UI_BUNDLE`,
 * registered on `kernel:ready`) — the same wire path as the pages the two
 * sibling gates cover, in a `*-ui.ts` file no `*.page.ts` sweep ever looked
 * at. It authors ZERO expression keys today, which is exactly why the gate is
 * worth having; #11480's header states the argument and it is quoted on the
 * card that ordered this file:
 *
 * > They author ZERO expression keys today, which is exactly why the gate is
 * > worth having: the hazard is the NEXT predicate added to one of them, which
 * > would ship bare with every authoring-time signal green.
 *
 * The page body is a single `mcp:connect-agent` widget plus a `page:header`,
 * both live SDUI surfaces that can grow a `visibleWhen` at any time.
 *
 * The detector lives in `@objectstack/lint` (`page-envelope-audit.ts` — its
 * header carries the hazard and the three-door design; its own test file
 * carries the negative controls). What this file owns is this package's
 * POPULATION: the export-shape scan over `src/`, the per-page door
 * preconditions, the verdict, and a downgrade control proving the detector
 * reaches this package's real export.
 *
 * ## Third hand-copy, deliberately — not a hoist
 *
 * This is the THIRD per-package copy of the same shape. That count is live
 * evidence for hoisting the population discovery into one shared helper
 * instead of repeating it, which is #11576's option C and #12307's subject —
 * a different card and a different decision. Copying is what THIS card is.
 * Recorded here so the next author inherits the count rather than the habit.
 *
 * ## No standing exemptions (#12344)
 *
 * `mcp:connect-agent` was exempted here between #12269 and #12344: a
 * console-registered widget provided by objectui's app-shell with no
 * `ComponentPropsMap` row, so door 3 had no schema to read its `properties`
 * with — the same standing-exemption shape `cloud-connection`'s two widgets
 * were in between #11480 and #11575. #12344 gave the type its row (strict,
 * empty — measured from the renderer's read points at the `.objectui-sha`
 * pin, where the registration discards the schema node entirely and the
 * component function takes no parameters), so door 3 now reads its bag and
 * the exemption list is empty. The machinery stays: the exemption set is
 * still asserted EXACTLY, so any NEW unmapped type reds and forces the same
 * decision — declare the props schema in `ComponentPropsMap`, or record the
 * exemption here with the reason (and then also pin the exempted bag empty
 * and the list non-vacuous, as the pre-#12344 revision of this file did).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Page } from '@objectstack/spec/ui';
import {
  auditPageExpressionEnvelopes,
  renderBareExpressionFindings,
} from '@objectstack/lint';
// The one answer this tree has to "comment, literal, or code". It is a plain
// `.mjs`, but `scripts/js-comment-mask.d.mts` beside it is a hand-written
// declaration mirror (governed by `check:declaration-mirrors`), so this import
// is typed and needs no suppression -- a `@ts-expect-error` here would be an
// UNUSED directive. That `.d.mts` is what gives `maskComments` its type.
// Same spelling the two sibling gates use.
import { maskComments } from '../../../scripts/js-comment-mask.mjs';
import { CONNECT_AGENT_PAGE } from './connect-ui.js';

type AnyRec = Record<string, unknown>;

/** This file lives in `src/`, so the scan root IS the package's `src/`. */
const HERE = dirname(fileURLToPath(import.meta.url));

// ───────────────────────────────────────────────────────────────────────────
// The population this gate covers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Every page this package ships, audited by export name — with the unmapped
 * component types each page is EXPECTED to report (none since #12344; see
 * the module header).
 */
const AUDITED_PAGES: { exportName: string; page: Page; exemptUnmappedTypes: string[] }[] = [
  {
    exportName: 'CONNECT_AGENT_PAGE',
    page: CONNECT_AGENT_PAGE,
    exemptUnmappedTypes: [],
  },
];

function pageLabel(exportName: string, page: Page): string {
  const name = typeof (page as AnyRec).name === 'string' ? (page as AnyRec).name : '(unnamed)';
  return `${exportName} (${String(name)})`;
}

function tsFilesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      tsFilesUnder(full, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every `export const X: Page = …` this source text declares, read from CODE.
 *
 * ## Why the shared mask and not a private comment-stripper
 *
 * Masking is not a detail of this scan, it is the scan's population rule: text
 * this function mistakes for a comment is a page this gate never audits, and
 * the gate still reports GREEN — a green line over a page nobody read, which is
 * the exact defect class this file exists to prevent, re-entering through the
 * detector instead of through the authoring.
 *
 * What used to stand in both sibling gates was two regexes, block pass first
 * (`/\*[\s\S]*?\*\/` lazily, then `^[ \t]*\/\/.*$`) — the same pair #9367
 * retired from six gates and #10453 found surviving in two `packages/cli`
 * tests. Its failure is the silent one: a block-comment OPENER that is not a
 * comment at all — inside a string literal, or inside a line comment — opens a
 * phantom comment that runs to the next real `\*\/` and deletes every line
 * between, declarations included.
 *
 * This copy was held until #12317 converted BOTH siblings onto the shared mask,
 * precisely so a third hand-copy would not carry that defect forward a third
 * time. `maskComments` blanks comment spans and leaves string, template and
 * regex literals intact, so offsets and line numbers both survive and a
 * `: Page =` inside prose still cannot be read as a declaration.
 *
 * Split out from the walk so the pin below drives the REAL scan over a fixture
 * rather than over whatever this package happens to contain today.
 */
function pageDeclarationsIn(source: string): string[] {
  return [...maskComments(source).matchAll(/export\s+const\s+(\w+)\s*:\s*Page\s*=/g)]
    .map(match => match[1]!);
}

/**
 * Every `export const X: Page = …` declared anywhere in this package's `src/`.
 *
 * Discovery is by EXPORT SHAPE, never by a hard-coded name and never by
 * filename — the sweep that first recorded this defect class looked at
 * `*.page.ts` and therefore missed raw-literal pages living in `*-ui.ts`
 * files. A gate that audits one page in a package that ships two is worse than
 * no gate: it reports green over the one it cannot see. Scanning source text is
 * what makes "a page nobody covered" visible.
 */
function declaredPageExports(): { name: string; file: string }[] {
  const out: { name: string; file: string }[] = [];
  for (const file of tsFilesUnder(HERE)) {
    for (const name of pageDeclarationsIn(readFileSync(file, 'utf8'))) {
      out.push({ name, file: file.slice(HERE.length + 1) });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const AUDITS = AUDITED_PAGES.map(({ exportName, page, exemptUnmappedTypes }) => ({
  exportName,
  page,
  exemptUnmappedTypes,
  audit: auditPageExpressionEnvelopes(page, pageLabel(exportName, page)),
}));

// ───────────────────────────────────────────────────────────────────────────
// The gate
// ───────────────────────────────────────────────────────────────────────────

describe('mcp Page exports serve canonical expression envelopes', () => {
  it('covers every `Page` declared in this package — and audits nothing undeclared', () => {
    const declared = declaredPageExports();
    const audited = new Set(AUDITED_PAGES.map(p => p.exportName));
    const uncovered = declared.filter(d => !audited.has(d.name));
    expect(
      uncovered.map(d => `${d.name} (${d.file})`).join('\n'),
      'a raw-literal `Page` in this package is not audited by this gate. Add it to '
        + 'AUDITED_PAGES above (or, if it is deliberately unshipped, say so here).',
    ).toBe('');

    // Both directions: a page audited here but invisible to the export-shape
    // scan means its declaration lost the `: Page` annotation — the state this
    // package's page shipped in until #12266 added the annotation, which is
    // what made it discoverable enough for this gate to exist.
    const declaredNames = new Set(declared.map(d => d.name));
    const undeclared = AUDITED_PAGES.filter(p => !declaredNames.has(p.exportName));
    expect(
      undeclared.map(p => p.exportName).join('\n'),
      'this page is audited but not discovered by the `export const X: Page =` scan — '
        + 'restore the `: Page` annotation on its declaration so the NEXT page authored '
        + 'beside it is discoverable too.',
    ).toBe('');

    // Population floor: the gate is worthless if it silently reads nothing.
    // A scan returning zero pages passes every assertion below exactly like a
    // scan over a clean page, and the two readings mean opposite things.
    expect(AUDITED_PAGES.length).toBeGreaterThanOrEqual(1);
    expect(declared.length).toBeGreaterThanOrEqual(1);
  });

  it.each(AUDITS)('$exportName parses through PageSchema (door 1 precondition)', ({ audit }) => {
    expect(
      audit.pageParseError ?? '',
      'door 1 cannot run: this page does not parse, so every schema-typed expression '
        + 'position on it is unread by this gate.',
    ).toBe('');
  });

  it.each(AUDITS)('$exportName: every component parses through PageComponentSchema (door 2 precondition)', ({ audit }) => {
    expect(
      audit.componentParseErrors.map(e => `${e.path} [${e.type}]: ${e.issues}`).join('\n'),
      'door 2 cannot run for these components: they do not parse, so their expression '
        + 'positions are unread by this gate.',
    ).toBe('');
    expect(audit.componentCount).toBeGreaterThan(0);
  });

  it.each(AUDITS)('$exportName: unmapped component types are EXACTLY the recorded exemptions (door 3 precondition)', ({ audit, exemptUnmappedTypes }) => {
    // No exemptions stand since #12344 (see the module header). Anything
    // unmapped is a new door-3 blind spot: declare the props schema in
    // `ComponentPropsMap`, or record the exemption here with the reason —
    // and then also pin the exempted bag empty and the exemption list
    // non-vacuous, as the pre-#12344 revision of this file did.
    expect(audit.unmappedTypes.map(e => e.type).sort()).toEqual([...exemptUnmappedTypes].sort());
  });

  it.each(AUDITS)('$exportName: every authored `properties` bag parses against its props schema (door 3 precondition)', ({ audit }) => {
    expect(
      audit.unreadableProps.map(e => `${e.path} [${e.type}]: ${e.issues}`).join('\n'),
      'door 3 cannot run for these components: their authored `properties` are refused by '
        + 'the declared props schema, so a props-level expression key there is unread by '
        + 'this gate.',
    ).toBe('');
  });

  it.each(AUDITS)('$exportName authors NO bare expression string', ({ audit }) => {
    expect(renderBareExpressionFindings(audit.findings)).toBe('');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Downgrade control — the imported detector reaches this package's REAL page
// ───────────────────────────────────────────────────────────────────────────

const BARE = 'has(record.status) && record.status == "bound"';

describe('downgrade control — the shipped page, bare predicate injected', () => {
  it('flags CONNECT_AGENT_PAGE the moment a bare predicate lands on the connect widget', () => {
    // Deep-cloned — the export itself is untouched (the pristine re-audit
    // below proves it). The injected position is the widget's `visibleWhen`,
    // i.e. the exact next-predicate the card names as the hazard for this page.
    const source = JSON.parse(JSON.stringify(CONNECT_AGENT_PAGE)) as AnyRec;
    const regions = source.regions as AnyRec[];
    const widget = (regions[1]!.components as AnyRec[])[0]!;
    expect(widget.type).toBe('mcp:connect-agent');
    widget.visibleWhen = BARE;

    const audit = auditPageExpressionEnvelopes(source, pageLabel('CONNECT_AGENT_PAGE', source as unknown as Page));
    expect(audit.findings.map(f => f.path)).toEqual(['regions[1].components[0].visibleWhen']);
    const rendered = renderBareExpressionFindings(audit.findings);
    expect(rendered).toContain('connect_agent');
    expect(rendered).toContain('regions[1].components[0].visibleWhen');
    expect(rendered).toContain('authored BARE');

    const pristine = auditPageExpressionEnvelopes(
      CONNECT_AGENT_PAGE,
      pageLabel('CONNECT_AGENT_PAGE', CONNECT_AGENT_PAGE),
    );
    expect(renderBareExpressionFindings(pristine.findings)).toBe('');
  });

  it('flags the header region too — the other live SDUI surface on this page', () => {
    const source = JSON.parse(JSON.stringify(CONNECT_AGENT_PAGE)) as AnyRec;
    const regions = source.regions as AnyRec[];
    const header = (regions[0]!.components as AnyRec[])[0]!;
    expect(header.type).toBe('page:header');
    header.visibleWhen = BARE;

    const audit = auditPageExpressionEnvelopes(source, pageLabel('CONNECT_AGENT_PAGE', source as unknown as Page));
    expect(audit.findings.map(f => f.path)).toEqual(['regions[0].components[0].visibleWhen']);
    expect(renderBareExpressionFindings(audit.findings)).toContain('connect_agent');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Pin — a phantom comment cannot delete a page from the population
// ───────────────────────────────────────────────────────────────────────────

/**
 * The shared mask, pinned by the shape it was adopted for.
 *
 * Both fixtures carry a block-comment OPENER that is not a comment — one in a
 * line comment, one in a string literal — followed by a real terminator further
 * down, with a `Page` declaration in between. The retired two-regex stripper
 * honours the opener, runs lazily to that terminator, and the declaration
 * between them is gone; the scan then reports a population one page short and
 * every audit above is green over a page it never read.
 *
 * This package is not hypothetically exposed to that shape. `src/plugin.ts`
 * and `src/mcp-http-tools.ts` both carry line comments naming glob-shaped
 * route paths, and a page declared below one of them would simply vanish from
 * the population under the retired stripper.
 *
 * The `openerIsNotAComment` precondition is here so the pin cannot go quietly
 * vacuous: strip the opener out of a fixture while editing and both strippers
 * agree again, leaving two tests that pass without asserting anything.
 */
const PHANTOM_IN_LINE_COMMENT = [
  "import type { Page } from '@objectstack/spec/ui';",
  '',
  '// The connect widget reads /discovery and mints keys for the',
  '// /api/v1/mcp/* routes this plugin mounts.',
  '',
  'export const PhantomPage: Page = {',
  "    name: 'phantom_page',",
  "    regions: [{ name: 'main', width: 'full', components: [] }],",
  '};',
  '',
  '/** Setup-nav contribution — the terminator that closes the phantom. */',
  "export const LaterPage: Page = { name: 'later_page', regions: [] };",
].join('\n');

const PHANTOM_IN_STRING_LITERAL = [
  "import type { Page } from '@objectstack/spec/ui';",
  '',
  "const MCP_ROUTE_GLOB = '/api/v1/mcp/*';",
  '',
  'export const LiteralPhantomPage: Page = {',
  "    name: 'literal_phantom_page',",
  '    regions: [],',
  '};',
  '',
  '/** A docblock whose terminator closes the phantom opened in the string. */',
  "export const LiteralLaterPage: Page = { name: 'literal_later', regions: [] };",
].join('\n');

/** The fixture still carries the shape: an opener above, a terminator below. */
function openerIsNotAComment(fixture: string, declaration: string): void {
  const opener = fixture.indexOf('/' + '*');
  const declaredAt = fixture.indexOf(declaration);
  const terminator = fixture.indexOf('*' + '/', opener);
  expect(opener, 'fixture lost its block-comment opener').toBeGreaterThan(-1);
  expect(declaredAt, 'fixture lost its page declaration').toBeGreaterThan(opener);
  expect(terminator, 'fixture lost the terminator that closes the phantom')
    .toBeGreaterThan(declaredAt);
}

describe('population scan reads comments, not comment-shaped text', () => {
  it('keeps a page straddled by an opener inside a LINE COMMENT', () => {
    openerIsNotAComment(PHANTOM_IN_LINE_COMMENT, 'export const PhantomPage');
    expect(pageDeclarationsIn(PHANTOM_IN_LINE_COMMENT)).toEqual(['PhantomPage', 'LaterPage']);
  });

  it('keeps a page straddled by an opener inside a STRING LITERAL', () => {
    openerIsNotAComment(PHANTOM_IN_STRING_LITERAL, 'export const LiteralPhantomPage');
    expect(pageDeclarationsIn(PHANTOM_IN_STRING_LITERAL))
      .toEqual(['LiteralPhantomPage', 'LiteralLaterPage']);
  });

  it('still refuses a `: Page =` written inside genuine prose', () => {
    const prose = [
      '/** Authors write `export const X: Page = {}` in docblocks like this. */',
      '// and in line comments: export const YPage: Page = {}',
      "export const RealPage: Page = { name: 'real', regions: [] };",
    ].join('\n');
    expect(pageDeclarationsIn(prose)).toEqual(['RealPage']);
  });
});
