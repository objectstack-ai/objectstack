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

/** Strip comments so a `: Page =` inside prose is not read as a declaration. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
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
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const match of source.matchAll(/export\s+const\s+(\w+)\s*:\s*Page\s*=/g)) {
      out.push({ name: match[1]!, file: file.slice(HERE.length + 1) });
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
