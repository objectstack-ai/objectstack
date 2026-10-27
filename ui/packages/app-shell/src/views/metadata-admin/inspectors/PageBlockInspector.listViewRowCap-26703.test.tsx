// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26703 — the page designer can set a `list-view` block's row cap.
 *
 * A list block in a wide page region draws its first `dataSource.limit` rows,
 * 5 when none is stated (objectstack#26613). `BLOCK_CONFIG` had no `list-view`
 * entry, so selecting one opened an inspector with no typed fields, and the
 * "Advanced" section lists only keys the block already has: the cap could be
 * set only in JSON. These rows drive the REAL inspector and assert the patch
 * it hands the editor: the Object, View and Row limit controls write the
 * node-level `dataSource` binding `ListViewBlock` reads, never `properties`.
 */

import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PageSchema } from '@objectstack/spec/ui';
import { PageBlockInspector } from './PageBlockInspector';
import type { MetadataInspectorProps } from '../inspector-registry';
import type { SupportedLocale } from '../i18n';

vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));
// No object catalog: the Object picker falls back to its labelled text box.
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => ({ get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]) }),
}));

// The inspector's `engine.inspector.*` rows live in `@object-ui/i18n`'s `studio`
// namespace, whose `zh` catalogue is fetched on demand (objectstack#25922).
// Resident before any case, so the zh rows below read synchronously.
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

afterEach(cleanup);

const BLOCK_PATH = 'regions[0].components[0]';

/** Author a page the way a user does, parse it with the spec, and hand the RESULT to the inspector. */
function pageDraft(block: Record<string, unknown>): Record<string, unknown> {
  return PageSchema.parse({
    name: 'home',
    label: 'Home',
    type: 'home',
    template: 'default',
    regions: [{ name: 'main', components: [{ id: 'b1', ...block }] }],
  }) as unknown as Record<string, unknown>;
}

function renderInspector(draft: Record<string, unknown>, locale: SupportedLocale = 'en-US'): Mock<MetadataInspectorProps['onPatch']> {
  const onPatch: Mock<MetadataInspectorProps['onPatch']> = vi.fn();
  render(
    <PageBlockInspector
      type="page"
      name="home"
      draft={draft}
      selection={{ kind: 'block', id: BLOCK_PATH }}
      onPatch={onPatch}
      onClearSelection={() => {}}
      readOnly={false}
      locale={locale}
    />,
  );
  return onPatch;
}

/** The block as the inspector last wrote it (the patch is shallow: `{ regions }`). */
const committedBlock = (onPatch: Mock<MetadataInspectorProps['onPatch']>): Record<string, unknown> =>
  (onPatch.mock.calls.at(-1)![0] as { regions: Array<{ components: Array<Record<string, unknown>> }> }).regions[0]
    .components[0];

describe('the designer sets a list-view block’s row cap (objectstack#26703)', () => {
  it('shows an editable Row limit box, hinting the capped list’s own 5 when empty', () => {
    renderInspector(pageDraft({ type: 'list-view', dataSource: { object: 'contact' } }));
    const limit = screen.getByLabelText('Row limit') as HTMLInputElement;
    expect(limit.type).toBe('number');
    expect(limit.value).toBe('');
    expect(limit.placeholder).toBe('5');
    expect(limit.disabled).toBe(false);
  });

  it('editing the box writes `dataSource.limit` beside the bound object, not `properties.limit`', () => {
    const onPatch = renderInspector(pageDraft({ type: 'list-view', dataSource: { object: 'contact', view: 'mine' }, properties: {} }));
    fireEvent.change(screen.getByLabelText('Row limit'), { target: { value: '12' } });
    const block = committedBlock(onPatch);
    expect(block.dataSource).toEqual({ object: 'contact', view: 'mine', limit: 12 });
    expect(block.properties).toEqual({});
  });

  it('the box shows a stored cap, and the Object and View controls show and write the binding', () => {
    const onPatch = renderInspector(pageDraft({ type: 'list-view', dataSource: { object: 'contact', view: 'mine', limit: 8 } }));
    expect((screen.getByLabelText('Row limit') as HTMLInputElement).value).toBe('8');
    expect((screen.getByLabelText('Object') as HTMLInputElement).value).toBe('contact');
    expect((screen.getByLabelText('View') as HTMLInputElement).value).toBe('mine');
    fireEvent.change(screen.getByLabelText('View'), { target: { value: 'all_open' } });
    expect(committedBlock(onPatch).dataSource).toEqual({ object: 'contact', view: 'all_open', limit: 8 });
  });

  it('labels the controls in the designer locale', () => {
    renderInspector(pageDraft({ type: 'list-view', dataSource: { object: 'contact' } }), 'zh-CN');
    expect(screen.getByLabelText('条数上限')).toBeTruthy();
    expect(screen.getByLabelText('视图')).toBeTruthy();
  });
});
