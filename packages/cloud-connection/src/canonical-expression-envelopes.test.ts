// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Gate — every `Page` this package ships must serve the CANONICAL
 * `{ dialect, source }` envelope at every `ExpressionInputSchema` position
 * (#11480, extending #11255's platform-objects gate to this package).
 *
 * Both pages here are raw typed object literals reaching the kernel through
 * this plugin's own manifest bundles (`CLOUD_CONNECTION_UI_BUNDLE`,
 * `MARKETPLACE_INSTALLED_UI_BUNDLE`) — the same wire path as
 * `platform-objects`' pages, in files no `*.page.ts` sweep ever looked at.
 * They author ZERO expression keys today, which is exactly why the gate is
 * worth having: the hazard is the NEXT predicate added to one of them, which
 * would ship bare with every authoring-time signal green.
 *
 * The detector lives in `@objectstack/lint` (`page-envelope-audit.ts` — its
 * header carries the hazard and the three-door design; its own test file
 * carries the negative controls). What this file owns is this package's
 * POPULATION: the export-shape scan over `src/`, the per-page door
 * preconditions, the verdict, and a downgrade control proving the detector
 * reaches these real exports.
 *
 * ## No standing exemptions (#11575)
 *
 * `cloud-connection:panel` and `marketplace:installed-list` were exempted
 * here between #11480 and #11575: console-registered widgets with no
 * `ComponentPropsMap` row, so door 3 had no schema to read their
 * `properties` with. #11575 gave both types their rows (strict, empty —
 * measured from the renderers' read points at the `.objectui-sha` pin), so
 * door 3 now reads both bags and the exemption lists are empty. The
 * machinery stays: the exemption set is still asserted EXACTLY, so any NEW
 * unmapped type reds and forces the same decision — declare the props
 * schema in `ComponentPropsMap`, or record the exemption here with the
 * reason (and then also pin the exempted bags empty, as the pre-#11575
 * revision of this file did).
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
// UNUSED directive. That `.d.mts` is what gives `maskComments` its type, so it
// is an input to this package's typecheck verdict as well as to this scan.
// Same spelling `packages/cli`'s contract tests use.
import { maskComments } from '../../../scripts/js-comment-mask.mjs';
import { CloudConnectionSettingsPage } from './cloud-connection-ui.js';
import { MarketplaceInstalledPage } from './marketplace-ui.js';

type AnyRec = Record<string, unknown>;

/** This file lives in `src/`, so the scan root IS the package's `src/`. */
const HERE = dirname(fileURLToPath(import.meta.url));

// ───────────────────────────────────────────────────────────────────────────
// The population this gate covers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Every page this package ships, audited by export name — with the unmapped
 * component types each page is EXPECTED to report (none since #11575; see
 * the module header).
 */
const AUDITED_PAGES: { exportName: string; page: Page; exemptUnmappedTypes: string[] }[] = [
  {
    exportName: 'CloudConnectionSettingsPage',
    page: CloudConnectionSettingsPage,
    exemptUnmappedTypes: [],
  },
  {
    exportName: 'MarketplaceInstalledPage',
    page: MarketplaceInstalledPage,
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
 * What used to stand here was two regexes, block pass first
 * (`/\*[\s\S]*?\*\/` lazily, then `^[ \t]*\/\/.*$`) — the same pair #9367
 * retired from six gates and #10453 found surviving in two `packages/cli`
 * tests. Its failure is the silent one: a block-comment OPENER that is not a
 * comment at all — inside a string literal, or inside a line comment — opens a
 * phantom comment that runs to the next real `\*\/` and deletes every line
 * between, declarations included.
 *
 * This package is where that stopped being hypothetical. Measured on this tree
 * at the time of the conversion, `src/cloud-connection-ui.ts` — the file
 * declaring `CloudConnectionSettingsPage` — carries one: the line comment
 * `// … /api/v1/cloud-connection/* routes this plugin mounts.` opens a phantom
 * that the NEXT docblock's terminator closes, and the retired regex deletes 122
 * bytes of live page literal in between, `type: 'cloud-connection:panel'`
 * included. `src/marketplace-proxy-plugin.ts` carries two more spans, 277 bytes.
 * This gate stayed green only because that opener sits BELOW the
 * `export const … : Page =` the scan anchors on — a page declared thirty lines
 * further down that file would simply have vanished from the population, and
 * every audit below would have reported green over it.
 *
 * `maskComments` blanks comment spans and leaves string, template and regex
 * literals intact, so offsets and line numbers both survive and a `: Page =`
 * inside prose still cannot be read as a declaration.
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
 * Discovery is by EXPORT SHAPE, never by filename — the sweep that first
 * recorded this defect class looked at `*.page.ts` and therefore missed this
 * package's pages entirely (they live in `*-ui.ts` files). Scanning source
 * text rather than a barrel is what makes "a page nobody covered" visible.
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

describe('cloud-connection Page exports serve canonical expression envelopes', () => {
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
    // scan means its declaration lost the `: Page` annotation — the exact way
    // MarketplaceInstalledPage shipped un-discoverable before #11480.
    const declaredNames = new Set(declared.map(d => d.name));
    const undeclared = AUDITED_PAGES.filter(p => !declaredNames.has(p.exportName));
    expect(
      undeclared.map(p => p.exportName).join('\n'),
      'this page is audited but not discovered by the `export const X: Page =` scan — '
        + 'restore the `: Page` annotation on its declaration so the NEXT page authored '
        + 'beside it is discoverable too.',
    ).toBe('');

    // Population floor: the gate is worthless if it silently reads nothing.
    expect(AUDITED_PAGES.length).toBeGreaterThanOrEqual(2);
    expect(declared.length).toBeGreaterThanOrEqual(2);
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
    // No exemptions stand since #11575 (see the module header). Anything
    // unmapped is a new door-3 blind spot: declare the props schema in
    // `ComponentPropsMap`, or record the exemption here with the reason —
    // and then also pin the exempted bags empty, as the pre-#11575 revision
    // of this file did.
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
// Downgrade control — the imported detector reaches this package's REAL pages
// ───────────────────────────────────────────────────────────────────────────

const BARE = 'has(record.status) && record.status == "bound"';

describe('downgrade control — a shipped page, bare predicate injected', () => {
  it('flags CloudConnectionSettingsPage the moment a bare predicate lands on its panel', () => {
    // Deep-cloned — the export itself is untouched (the pristine re-audit
    // below proves it). The injected position is the panel component's
    // `visibleWhen`, i.e. the exact next-predicate the card names as the
    // hazard for this page.
    const source = JSON.parse(JSON.stringify(CloudConnectionSettingsPage)) as AnyRec;
    const regions = source.regions as AnyRec[];
    const panel = (regions[1]!.components as AnyRec[])[0]!;
    expect(panel.type).toBe('cloud-connection:panel');
    panel.visibleWhen = BARE;

    const audit = auditPageExpressionEnvelopes(source, pageLabel('CloudConnectionSettingsPage', source as unknown as Page));
    expect(audit.findings.map(f => f.path)).toEqual(['regions[1].components[0].visibleWhen']);
    const rendered = renderBareExpressionFindings(audit.findings);
    expect(rendered).toContain('cloud_connection_settings');
    expect(rendered).toContain('regions[1].components[0].visibleWhen');
    expect(rendered).toContain('authored BARE');

    const pristine = auditPageExpressionEnvelopes(
      CloudConnectionSettingsPage,
      pageLabel('CloudConnectionSettingsPage', CloudConnectionSettingsPage),
    );
    expect(renderBareExpressionFindings(pristine.findings)).toBe('');
  });

  it('flags MarketplaceInstalledPage the same way — the page the `: Page` scan used to miss', () => {
    const source = JSON.parse(JSON.stringify(MarketplaceInstalledPage)) as AnyRec;
    const regions = source.regions as AnyRec[];
    const list = (regions[1]!.components as AnyRec[])[0]!;
    expect(list.type).toBe('marketplace:installed-list');
    list.visibleWhen = BARE;

    const audit = auditPageExpressionEnvelopes(source, pageLabel('MarketplaceInstalledPage', source as unknown as Page));
    expect(audit.findings.map(f => f.path)).toEqual(['regions[1].components[0].visibleWhen']);
    const rendered = renderBareExpressionFindings(audit.findings);
    expect(rendered).toContain('marketplace_installed');

    const pristine = auditPageExpressionEnvelopes(
      MarketplaceInstalledPage,
      pageLabel('MarketplaceInstalledPage', MarketplaceInstalledPage),
    );
    expect(renderBareExpressionFindings(pristine.findings)).toBe('');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Pin — a phantom comment cannot delete a page from the population
// ───────────────────────────────────────────────────────────────────────────

/**
 * The conversion above, pinned by the shape it was made for.
 *
 * Both fixtures carry a block-comment OPENER that is not a comment — one in a
 * line comment (the shape `src/cloud-connection-ui.ts` ships today), one in a
 * string literal — followed by a real terminator further down, with a `Page`
 * declaration in between. The retired two-regex stripper honours the opener,
 * runs lazily to that terminator, and the declaration between them is gone; the
 * scan then reports a population one page short and every audit below is green
 * over a page it never read.
 *
 * Measured at the conversion, on this exact text: the retired regex found only
 * the trailing page in each fixture, `maskComments` finds both. Reverting
 * `pageDeclarationsIn` to that stripper reds these two cases and nothing else in
 * this file — the scan is the only thing they exercise.
 *
 * The `openerIsNotAComment` precondition is here so the pin cannot go quietly
 * vacuous: strip the opener out of a fixture while editing and both strippers
 * agree again, leaving two tests that pass without asserting anything.
 */
const PHANTOM_IN_LINE_COMMENT = [
  "import type { Page } from '@objectstack/spec/ui';",
  '',
  '// The console panel talks to the same-origin /api/v1/cloud-connection/*',
  '// routes this plugin mounts.',
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
  "const PROXY_GLOB = '/api/v1/marketplace/*';",
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
