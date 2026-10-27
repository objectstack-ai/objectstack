// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26794 — the page designer's add-block picker offers `list-view`.
 *
 * objectstack#26703 gave the `list-view` block an inspector panel (Object, View,
 * Row limit), but the picker is built from `BLOCK_TYPE_META` alone and had no
 * `list-view` row, so a designer could edit a list block a page already carried
 * and never add one. These cases drive the REAL picker in `PageBlockCanvas`:
 * the row sits under the Data heading, picking it writes a bare `list-view`
 * node and selects it, and that selection, handed to the REAL inspector with
 * the draft the canvas wrote, opens the three controls with nothing bound yet.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { PageSchema } from '@objectstack/spec/ui';
import { PageBlockCanvas } from './PageBlockCanvas';
import { PageBlockInspector } from '../inspectors/PageBlockInspector';
import { CATEGORY_LABEL_KEY } from './block-types';
import { t } from '../i18n';
import type { MetadataSelection } from '../preview-registry';

vi.mock('./useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));
// No object catalog: the Object picker falls back to its labelled text box.
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => ({ get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]) }),
}));

// The new type label and the inspector rows live in `@object-ui/i18n`'s
// `studio` namespace, whose `zh` catalogue is fetched on demand
// (objectstack#25922). Resident before any case, so zh reads synchronously.
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

afterEach(cleanup);

type Draft = Record<string, unknown>;

const EMPTY_PAGE: Draft = {
  name: 'home',
  label: 'Home',
  type: 'home',
  template: 'default',
  regions: [{ name: 'main', components: [] }],
};

/** Mounts the canvas over `EMPTY_PAGE` and records the drafts and selections it produces. */
function renderCanvas(locale: string) {
  const drafts: Draft[] = [];
  const selections: Array<MetadataSelection | null> = [];
  function Harness() {
    const [draft, setDraft] = React.useState<Draft>(EMPTY_PAGE);
    return (
      <PageBlockCanvas
        draft={draft}
        locale={locale}
        onPatch={(patch) => {
          const next = { ...draft, ...patch };
          drafts.push(next);
          setDraft(next);
        }}
        onSelectionChange={(next) => selections.push(next)}
      />
    );
  }
  render(<Harness />);
  return { drafts, selections };
}

/** Opens the first region's picker and returns the `list-view` row and the heading of the group it sits in. */
function openPickerAtListView(locale: string): { row: HTMLButtonElement; heading: string } {
  const [add] = screen.getAllByRole('button', { name: t('engine.inspector.add.block', locale) });
  fireEvent.click(add);
  const code = screen.getAllByText('list-view').find((el) => el.tagName === 'CODE');
  expect(code, 'the picker offers a `list-view` row').toBeDefined();
  const row = code!.closest('button') as HTMLButtonElement;
  const group = row.parentElement!;
  return { row, heading: group.firstElementChild!.textContent ?? '' };
}

describe('the add-block picker offers list-view (objectstack#26794)', () => {
  it('lists it under the Data heading, named in the designer locale', () => {
    for (const locale of ['en-US', 'zh-CN']) {
      renderCanvas(locale);
      const { row, heading } = openPickerAtListView(locale);
      expect(heading).toBe(t(CATEGORY_LABEL_KEY.data, locale));
      expect(within(row).getByText(t('engine.pageBlockCanvas.type.listView', locale))).toBeTruthy();
      cleanup();
    }
    // Control: the zh row is a translation, not the en name read through.
    expect(t('engine.pageBlockCanvas.type.listView', 'zh-CN')).not.toBe(t('engine.pageBlockCanvas.type.listView', 'en-US'));
  });

  it('adding it writes a bare list-view node the spec accepts, and selects it', () => {
    const { drafts, selections } = renderCanvas('en-US');
    fireEvent.click(openPickerAtListView('en-US').row);

    const written = drafts.at(-1)!;
    expect((written.regions as Array<{ components: unknown[] }>)[0].components).toEqual([{ type: 'list-view' }]);
    expect(PageSchema.safeParse(written).success).toBe(true);
    expect(selections.at(-1)).toMatchObject({ kind: 'block', id: 'regions[0].components[0]' });
  });

  it('selecting the added block opens the Object, View and Row limit panel, nothing bound yet', () => {
    const { drafts, selections } = renderCanvas('en-US');
    fireEvent.click(openPickerAtListView('en-US').row);
    const draft = drafts.at(-1)!;
    const selection = selections.at(-1)!;
    cleanup();

    const onPatch = vi.fn();
    render(
      <PageBlockInspector
        type="page"
        name="home"
        draft={draft}
        selection={selection}
        onPatch={onPatch}
        onClearSelection={() => {}}
        readOnly={false}
        locale="en-US"
      />,
    );
    const object = screen.getByLabelText('Object') as HTMLInputElement;
    const view = screen.getByLabelText('View') as HTMLInputElement;
    const limit = screen.getByLabelText('Row limit') as HTMLInputElement;
    expect([object.value, view.value, limit.value]).toEqual(['', '', '']);
    expect(limit.placeholder).toBe('5');

    // The Object control is how the fresh block gets its object: it writes the
    // node-level `dataSource` binding the list reads.
    fireEvent.change(object, { target: { value: 'contact' } });
    const block = (onPatch.mock.calls.at(-1)![0] as { regions: Array<{ components: Array<Record<string, unknown>> }> })
      .regions[0].components[0];
    expect(block).toEqual({ type: 'list-view', dataSource: { object: 'contact' } });
  });
});
