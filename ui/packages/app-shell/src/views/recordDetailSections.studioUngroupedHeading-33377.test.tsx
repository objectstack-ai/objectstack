/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#33377 — a record page Studio seeds for an object with field
 * groups heads its ungrouped bucket with the translated "Other" heading.
 *
 * The running record page draws the fields no declared group claims under
 * `common.ungroupedSection` (objectstack#33229). Studio's full-page seed wrote
 * that bucket as an untitled enumerated section, so a saved seeded page drew
 * those fields headerless under the last group. A saved page is metadata and
 * cannot call `t()`, and a plain string would render in one language for every
 * viewer, so the seed writes the bucket's `label` as the inline locale map the
 * spec's `I18nLabel` declares, built from every shipped catalogue's
 * `common.ungroupedSection`; `record:details` resolves it per viewer.
 *
 * - the seed: the `{ group }` references are the synthesizer's own, the bucket
 *   carries the locale map, and the sections parse under `RecordDetailsProps`;
 * - CONTROL: an object with no field groups seeds no heading on its primary
 *   section (flat), and no section carries the map;
 * - the saved seed and the slotted preview's sections, drawn by the real
 *   `record:details` renderer: "Other" in English, 「其他」 in Chinese, after
 *   the group and above the ungrouped field.
 *
 * The preview's own node is pinned in `metadata-admin/previews/PagePreview.test.tsx`,
 * and "Convert to full page" in `PagePreview.slottedDefault-27054.test.tsx`.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RecordDetailsProps } from '@objectstack/spec/ui';
// Every catalogue resident at import time, so the heading loader answers
// without fetching inside a test's clock (AGENTS.md, flaky test discipline).
import { builtInLocales, registerBuiltInLocales } from '@object-ui/i18n/locales';
import { BUILT_IN_LANGUAGE_CODES, I18nProvider } from '@object-ui/i18n';
import { RecordContextProvider } from '@object-ui/react';
import { buildDefaultPageSchema, RecordDetailsRenderer, resolveDetailSections } from '@object-ui/plugin-detail';
import {
  deriveStudioDetailSections,
  loadPersistedUngroupedHeading,
  MORE_DETAILS_DEFAULT_LABEL,
  UNGROUPED_SECTION_DEFAULT_LABEL,
} from './recordDetailSections';
import { registerBuiltinAnchors } from './metadata-admin/anchors';
import { resolveResourceConfig } from './metadata-admin/registry';

registerBuiltInLocales();
registerBuiltinAnchors();

afterEach(cleanup);

/**
 * Declares one group and leaves `name` and `owner_name` ungrouped. `name` is
 * declared and left UNSET on the record: the renderer's page-H1 dedupe then
 * resolves its title to `name` and hides no row these legs read.
 */
const groupedDef = {
  name: 'os_33377_account',
  label: 'Account',
  fieldGroups: [{ key: 'basic_info', label: 'Basic Information' }],
  fields: {
    name: { label: 'Account Name', type: 'text' },
    industry: { label: 'Industry', type: 'text', group: 'basic_info' },
    owner_name: { label: 'Owner Name', type: 'text' },
  },
};

/** No `fieldGroups`: the running split, whose primary section is untitled. */
const flatDef = {
  name: 'os_33377_ticket',
  label: 'Ticket',
  fields: {
    subject: { label: 'Subject', type: 'text' },
    notes: { label: 'Notes', type: 'textarea' },
  },
};

const RECORD = { id: 'R1', industry: 'Retail', owner_name: 'Ada' };

/** The one `record:details` node of a seeded or synthesized page. */
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

/** `common.ungroupedSection` in the shipped catalogue `code`. */
const catalogueText = (code: string): unknown =>
  ((builtInLocales as Record<string, any>)[code]?.common as Record<string, unknown> | undefined)?.ungroupedSection;

describe('objectstack#33377 — a seeded grouped record page heads its ungrouped bucket, translated', () => {
  it('the bucket carries the locale map of every shipped catalogue; the group references are the synthesizer\'s', async () => {
    const sections = theDetailsNode(await fullSeedFor(groupedDef)).properties.sections as Array<Record<string, any>>;
    const references = resolveDetailSections(groupedDef as any) as Array<Record<string, any>>;
    // Firing control: the fixture yields one group and one bucket.
    expect(references).toHaveLength(2);
    expect(sections[0]).toEqual(references[0]);
    expect(sections[0]).toEqual(expect.objectContaining({ group: 'basic_info' }));

    const bucket = sections[1];
    expect(bucket.fields).toEqual(['name', 'owner_name']);
    expect(bucket).toEqual({ ...references[1], label: bucket.label });
    // ⛔ Never a plain string: one language for every viewer.
    expect(typeof bucket.label).toBe('object');
    expect(Object.keys(bucket.label).sort()).toEqual([...BUILT_IN_LANGUAGE_CODES].sort());
    for (const code of BUILT_IN_LANGUAGE_CODES) {
      expect(bucket.label[code], code).toBe(catalogueText(code));
    }
    expect(bucket.label.en).toBe('Other');
    expect(bucket.label['zh-Hans']).toBe('其他');
  });

  it('the seeded sections are spec-legal: they parse under RecordDetailsProps', async () => {
    const sections = theDetailsNode(await fullSeedFor(groupedDef)).properties.sections;
    expect(sections).toHaveLength(2);
    const parsed = RecordDetailsProps.safeParse({ sections });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('CONTROL: an object with no field groups seeds a flat primary section with no heading', async () => {
    expect(await loadPersistedUngroupedHeading(flatDef)).toBe(UNGROUPED_SECTION_DEFAULT_LABEL);
    const sections = theDetailsNode(await fullSeedFor(flatDef)).properties.sections as Array<Record<string, any>>;
    expect(sections.length).toBeGreaterThan(0);
    expect(sections[0].label).toBeUndefined();
    expect(sections.some((s) => s.label && typeof s.label === 'object')).toBe(false);
  });
});

/**
 * Draw `details` (a `record:details` node's properties) through the real
 * renderer, in `language`.
 */
function drawDetails(details: Record<string, unknown>, language: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <RecordContextProvider objectName={groupedDef.name} recordId="R1" data={RECORD} objectSchema={groupedDef}>
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

/** The slotted preview's sections, as `PagePreview` builds them with its translated heading. */
function previewDetails(ungroupedLabel: string): Record<string, unknown> {
  const sections = deriveStudioDetailSections(groupedDef, { moreDetails: MORE_DETAILS_DEFAULT_LABEL, ungrouped: ungroupedLabel });
  return theDetailsNode(buildDefaultPageSchema(groupedDef as any, { sections: sections as any })).properties;
}

describe('objectstack#33377 — record:details draws the heading on the saved seed and in the preview', () => {
  for (const [language, heading, foreign] of [['en', 'Other', '其他'], ['zh-CN', '其他', 'Other']] as const) {
    it(`the saved seed, ${language}: the bucket is headed ${heading}, after the group, above its field`, async () => {
      const saved = theDetailsNode(await fullSeedFor(groupedDef)).properties;
      drawDetails(saved, language);
      expect(screen.getByText(heading)).toBeInTheDocument();
      expect(screen.queryByText(foreign)).toBeNull();
      expect(order('Basic Information', heading)).toBe(-1);
      expect(order(heading, 'Ada')).toBe(-1);
      expect(order('Retail', heading)).toBe(-1);
    });
  }

  it('the slotted preview, zh-CN: the bucket is headed 其他 above its field', () => {
    drawDetails(previewDetails('其他'), 'zh-CN');
    expect(screen.getByText('其他')).toBeInTheDocument();
    expect(order('Basic Information', '其他')).toBe(-1);
    expect(order('其他', 'Ada')).toBe(-1);
  });
});
