/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#33471 — a record page Studio seeds for an object with no field
 * groups heads its "More details" section with the translated heading.
 *
 * The running record page draws the secondary fields under
 * `detail.sectionMoreDetails`, translated for the viewer. Studio's full-page
 * seed wrote that section's `label` as the plain English text, so a saved
 * seeded page drew "More details" for every viewer. A saved page is metadata
 * and cannot call `t()`, so the seed writes the `label` as the inline locale
 * map the spec's `I18nLabel` declares, built from every shipped catalogue's
 * `detail.sectionMoreDetails` (the form objectstack#33377 gave the ungrouped
 * bucket).
 *
 * The section keeps its `name: 'details'`, so the per-object bundle key
 * `objects.OBJECT._sections.details.label` still wins: `record:details`
 * resolves the map for the viewer first and hands the result to `sectionLabel`
 * as the fallback, and `sectionLabel` answers the bundle's text when it has one.
 *
 * - the seed: the `details` section carries the map, and the sections parse
 *   under `RecordDetailsProps`;
 * - the saved seed drawn by the real `record:details` renderer: 「更多详情」
 *   under zh-CN, "More details" under en (CONTROL), and the object bundle's own
 *   `_sections.details.label` over both (CONTROL).
 *
 * "Convert to full page" writes the same map, pinned in
 * `metadata-admin/previews/PagePreview.slottedDefault-27054.test.tsx`.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RecordDetailsProps } from '@objectstack/spec/ui';
// Every catalogue resident at import time, so the heading loader answers
// without fetching inside a test's clock (AGENTS.md, flaky test discipline).
import { builtInLocales, registerBuiltInLocales } from '@object-ui/i18n/locales';
import { BUILT_IN_LANGUAGE_CODES, I18nProvider, createI18n } from '@object-ui/i18n';
import { RecordContextProvider } from '@object-ui/react';
import { RecordDetailsRenderer } from '@object-ui/plugin-detail';
import { registerBuiltinAnchors } from './metadata-admin/anchors';
import { resolveResourceConfig } from './metadata-admin/registry';

registerBuiltInLocales();
registerBuiltinAnchors();

afterEach(cleanup);

/**
 * No `fieldGroups`, and `notes` is long text, so the running split draws an
 * untitled primary section and the "More details" section. `name` is declared
 * and left UNSET on the record: the renderer's page-H1 dedupe then resolves its
 * title to `name` and hides no row these legs read.
 */
const flatDef = {
  name: 'os_33471_ticket',
  label: 'Ticket',
  fields: {
    name: { label: 'Ticket Name', type: 'text' },
    subject: { label: 'Subject', type: 'text' },
    notes: { label: 'Notes', type: 'textarea' },
  },
};

const RECORD = { id: 'R1', subject: 'Printer jam', notes: 'Toner low' };

/** The one `record:details` node of a seeded page. */
function theDetailsNode(doc: unknown): Record<string, any> {
  const found: Array<Record<string, any>> = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (!n || typeof n !== 'object') return;
    const rec = n as Record<string, any>;
    if (rec.type === 'record:details') found.push(rec);
    Object.values(rec).forEach(walk);
  };
  walk(doc);
  expect(found, 'the page carries exactly one record:details node').toHaveLength(1);
  return found[0];
}

/** The seed of a record page the author explicitly created `full`. */
async function fullSeedFor(def: { name: string }): Promise<Record<string, any>> {
  const cfg = resolveResourceConfig('page');
  const client = { get: async () => def };
  return (await cfg.createSeed!({ type: 'record', object: def.name, kind: 'full' }, { client })) as Record<string, any>;
}

/** `detail.sectionMoreDetails` in the shipped catalogue `code`. */
const catalogueText = (code: string): unknown =>
  ((builtInLocales as Record<string, any>)[code]?.detail as Record<string, unknown> | undefined)?.sectionMoreDetails;

describe('objectstack#33471 — a seeded flat record page heads its More details section, translated', () => {
  it('the details section carries the locale map of every shipped catalogue', async () => {
    const sections = theDetailsNode(await fullSeedFor(flatDef)).properties.sections as Array<Record<string, any>>;
    // Firing control: the fixture yields the untitled primary section and "More details".
    expect(sections.map((s) => s.fields)).toEqual([['name', 'subject'], ['notes']]);
    expect(sections[0].label).toBeUndefined();

    const details = sections[1];
    expect(details.name).toBe('details');
    // ⛔ Never a plain string: one language for every viewer.
    expect(typeof details.label).toBe('object');
    expect(Object.keys(details.label).sort()).toEqual([...BUILT_IN_LANGUAGE_CODES].sort());
    for (const code of BUILT_IN_LANGUAGE_CODES) {
      expect(details.label[code], code).toBe(catalogueText(code));
    }
    expect(details.label.en).toBe('More details');
    expect(details.label['zh-Hans']).toBe('更多详情');
  });

  it('the seeded sections are spec-legal: they parse under RecordDetailsProps', async () => {
    const sections = theDetailsNode(await fullSeedFor(flatDef)).properties.sections;
    expect(sections).toHaveLength(2);
    const parsed = RecordDetailsProps.safeParse({ sections });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });
});

type Provider = { config: Record<string, unknown> } | { instance: ReturnType<typeof createI18n> };

/** Draw the saved seed's `record:details` through the real renderer. */
async function drawSavedSeed(provider: Provider) {
  const details = theDetailsNode(await fullSeedFor(flatDef)).properties;
  return render(
    <I18nProvider {...(provider as any)} persistLanguage={false}>
      <RecordContextProvider objectName={flatDef.name} recordId="R1" data={RECORD} objectSchema={flatDef}>
        <RecordDetailsRenderer schema={{ type: 'record:details', ...details } as any} />
      </RecordContextProvider>
    </I18nProvider>,
  );
}

/** Document order of two on-screen texts: negative when `a` comes first. */
function order(a: string, b: string): number {
  const na = screen.getByText(a);
  const nb = screen.getByText(b);
  return na.compareDocumentPosition(nb) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

const language = (code: string): Provider => ({ config: { defaultLanguage: code, detectBrowserLanguage: false } });

describe('objectstack#33471 — record:details draws the saved seed\'s More details heading', () => {
  it('zh-CN: the section is headed 更多详情, never the English text, above its field', async () => {
    await drawSavedSeed(language('zh-CN'));
    expect(screen.getByText('更多详情')).toBeInTheDocument();
    expect(screen.queryByText('More details')).toBeNull();
    expect(order('更多详情', 'Toner low')).toBe(-1);
  });

  it('CONTROL, en: the section is headed More details', async () => {
    await drawSavedSeed(language('en'));
    expect(screen.getByText('More details')).toBeInTheDocument();
    expect(screen.queryByText('更多详情')).toBeNull();
    expect(order('More details', 'Toner low')).toBe(-1);
  });

  it('CONTROL: the object bundle\'s _sections.details.label still wins over the saved heading', async () => {
    const instance = createI18n({
      defaultLanguage: 'zh-CN',
      detectBrowserLanguage: false,
      resources: {
        'zh-CN': { app: { objects: { [flatDef.name]: { _sections: { details: { label: '补充信息' } } } } } },
      },
    });
    await drawSavedSeed({ instance });
    expect(screen.getByText('补充信息')).toBeInTheDocument();
    expect(screen.queryByText('更多详情')).toBeNull();
    expect(screen.queryByText('More details')).toBeNull();
    expect(order('补充信息', 'Toner low')).toBe(-1);
  });
});
