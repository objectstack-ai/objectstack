// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30358 — on a zh-CN console the view panel's 允许的可视化 chips
 * (`appearance.allowedVisualizations`) read Grid / Kanban / Gallery …, while
 * the view-type select a few rows up already reads 表格 / 列表 / 看板 ….
 *
 * The chips are the `multiselect` widget over the spec's
 * `VisualizationTypeSchema` enum. Pinned here, against the spec's real enum
 * (not a copy of it):
 *
 *  - zh-CN: every chip reads exactly the view-type select's word for that value.
 *  - en-US: the nine chips keep the names they had (the card's "en unchanged").
 *  - an enum that is not all view types keeps the humanised names in zh-CN too.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
import { WIDGETS } from './widgets';
import { getListVariantSchema } from './view-schema';
import { t } from './i18n';

// The view-type words live in `@object-ui/i18n`'s `studio` namespace, whose zh
// catalogue is fetched on demand; resident before any case.
await loadStudioCatalogue('zh');

let localeFixture: 'en-US' | 'zh-CN' = 'en-US';
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => localeFixture,
}));

afterEach(() => {
  cleanup();
  localeFixture = 'en-US';
});

const MultiSelect = WIDGETS['multiselect'];

/** The `appearance.allowedVisualizations` JSONSchema exactly as the spec serialises it. */
function allowedVisualizationsSchema(): Record<string, any> {
  const schema = getListVariantSchema()?.properties?.appearance?.properties?.allowedVisualizations;
  expect(schema?.items?.enum, 'spec allowedVisualizations enum').toBeTruthy();
  return schema as Record<string, any>;
}

function chipNames(): string[] {
  return screen.getAllByRole('checkbox').map((el) => el.textContent?.replace('✓', '').trim() ?? '');
}

describe('allowedVisualizations chips read the view-type words (objectstack#30358)', () => {
  it('zh-CN: every chip reads the view-type select word for that value', () => {
    localeFixture = 'zh-CN';
    const schema = allowedVisualizationsSchema();
    const values = schema.items.enum as string[];
    render(<MultiSelect value={[]} onChange={() => {}} schema={schema} />);
    // The select's word for each value, straight from the shipped catalogue
    // key the view-type select reads (`engine.inspector.view.type.*`).
    const selectWords = values.map((v) => t(`engine.inspector.view.type.${v}`, 'zh-CN'));
    expect(chipNames()).toEqual(selectWords);
    // And those are the catalogue's Chinese rows, not an English fallback.
    expect(selectWords).toContain('表格 / 列表');
    expect(selectWords).toContain('看板');
    for (const word of selectWords) expect(word).not.toMatch(/^[A-Za-z /]+$/);
  });

  it('en-US: the nine chips keep their existing names', () => {
    localeFixture = 'en-US';
    const schema = allowedVisualizationsSchema();
    render(<MultiSelect value={[]} onChange={() => {}} schema={schema} />);
    expect(chipNames()).toEqual([
      'Grid',
      'Kanban',
      'Gallery',
      'Calendar',
      'Timeline',
      'Gantt',
      'Map',
      'Chart',
      'Tree',
    ]);
  });

  it('zh-CN: an enum that is not all view types keeps the humanised names', () => {
    localeFixture = 'zh-CN';
    const schema = { type: 'array', items: { type: 'string', enum: ['grid', 'start_date'] } };
    render(<MultiSelect value={[]} onChange={() => {}} schema={schema} />);
    expect(chipNames()).toEqual(['Grid', 'Start Date']);
  });
});
