// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12056 — the page designer writes `element:repeater`'s query into
 * the node-level `dataSource`, as objectui#11880 moved `element:number`'s.
 *
 * The repeater's renderer reads the binding first (objectui#11880), and the
 * spec retires the flat `object` / `limit` in v18 (objectstack#11509, ruled
 * objectui first). The inspector's curated Object picker and Limit box wrote
 * `properties.object` / `properties.limit`, and its two field pickers read
 * their object from that flat key. These rows drive the REAL inspector and
 * assert the patch it hands the editor: both values land at node level under
 * `dataSource`, never under `properties`, and both field pickers list the
 * fields of `dataSource.object`.
 */

import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PageSchema } from '@objectstack/spec/ui';
import { PageBlockInspector } from './PageBlockInspector';
import type { MetadataInspectorProps } from '../inspector-registry';

// The field catalog hook, observed: which object each field picker asked for.
// Each object has its own field, so a picker's rendered roster names the
// object it resolved.
const fieldsFor = vi.hoisted(() => vi.fn((_objectName: string | undefined) => undefined));
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: (objectName: string | undefined) => {
    fieldsFor(objectName);
    const catalog: Record<string, Array<{ name: string; label: string; type: string; hidden: boolean }>> = {
      contact: [{ name: 'email', label: 'Email', type: 'text', hidden: false }],
      lead: [{ name: 'company', label: 'Company', type: 'text', hidden: false }],
    };
    return { fields: (objectName && catalog[objectName]) || [], loading: false, error: null };
  },
}));
// No object catalog: the Object picker falls back to its labelled text box.
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => ({ get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]) }),
}));

afterEach(() => {
  cleanup();
  fieldsFor.mockClear();
});

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

function renderInspector(draft: Record<string, unknown>): Mock<MetadataInspectorProps['onPatch']> {
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
      locale="en-US"
    />,
  );
  return onPatch;
}

/** The block as the inspector last wrote it (the patch is shallow: `{ regions }`). */
const committedBlock = (onPatch: Mock<MetadataInspectorProps['onPatch']>): Record<string, unknown> =>
  (onPatch.mock.calls.at(-1)![0] as { regions: Array<{ components: Array<Record<string, unknown>> }> }).regions[0]
    .components[0];

describe('the designer writes the node-level `dataSource` for element:repeater (objectui#12056)', () => {
  it('the Object picker writes `dataSource.object`, not `properties.object`', () => {
    const onPatch = renderInspector(pageDraft({ type: 'element:repeater', properties: {} }));
    fireEvent.change(screen.getByLabelText('Object'), { target: { value: 'contact' } });
    const block = committedBlock(onPatch);
    expect(block.dataSource).toEqual({ object: 'contact' });
    // The parsed page's empty bag, untouched: no `properties.object`.
    expect(block.properties).toEqual({});
  });

  it('the Limit box writes `dataSource.limit` beside the bound object, not `properties.limit`', () => {
    const onPatch = renderInspector(pageDraft({ type: 'element:repeater', dataSource: { object: 'contact' }, properties: {} }));
    fireEvent.change(screen.getByLabelText('Limit'), { target: { value: '25' } });
    const block = committedBlock(onPatch);
    expect(block.dataSource).toEqual({ object: 'contact', limit: 25 });
    expect(block.properties).toEqual({});
  });

  it('CONTROL: a display control on the same block still writes `properties`, beside the binding', () => {
    const onPatch = renderInspector(pageDraft({ type: 'element:repeater', dataSource: { object: 'contact', limit: 5 } }));
    fireEvent.change(screen.getByLabelText('Empty text'), { target: { value: 'Nothing yet' } });
    const block = committedBlock(onPatch);
    expect(block.properties).toEqual({ emptyText: 'Nothing yet' });
    expect(block.dataSource).toEqual({ object: 'contact', limit: 5 });
  });

  it('both field pickers read their object from `dataSource.object`, not a flat `properties.object`', () => {
    renderInspector(
      pageDraft({
        type: 'element:repeater',
        dataSource: { object: 'contact' },
        properties: { object: 'lead', titleField: 'email', fields: ['email'] },
      }),
    );
    const asked = new Set(fieldsFor.mock.calls.map((call) => call[0]));
    expect(asked).toContain('contact');
    expect(asked).not.toContain('lead');
    // Each picker's own roster is the bound object's: the Title field picker is
    // a dropdown showing `contact`'s field, and so is the Fields list's row.
    // Resolved from the flat `lead` (or from nothing) the stored `email` would
    // not be offered, and neither control would read `Email (email)`.
    expect(screen.getByLabelText('Title field').getAttribute('role')).toBe('combobox');
    expect(screen.getAllByText('Email (email)')).toHaveLength(2);
  });

  it('the Object and Limit controls show the binding, and stored flat `properties.object` / `.limit` stay visible under Advanced', () => {
    renderInspector(
      pageDraft({
        type: 'element:repeater',
        dataSource: { object: 'contact', limit: 25 },
        properties: { object: 'lead', limit: 7 },
      }),
    );
    expect((screen.getByLabelText('Object') as HTMLInputElement).value).toBe('contact');
    expect((screen.getByLabelText('Limit') as HTMLInputElement).value).toBe('25');
    // The Advanced editor labels a generic property by its key.
    expect((screen.getByLabelText('object') as HTMLInputElement).value).toBe('lead');
    expect(screen.getByLabelText('limit')).toBeTruthy();
  });
});
