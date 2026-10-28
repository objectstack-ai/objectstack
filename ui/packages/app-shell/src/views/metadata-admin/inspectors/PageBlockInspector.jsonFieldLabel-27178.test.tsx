// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The page block inspector's JSON editor (`InspectorJsonField`) is named by the
 * label drawn above it: `Label htmlFor` ↔ textarea `id`, the pairing the
 * inspector's other rows already carry. Without it every curated JSON prop
 * exposed an unnamed text box to a screen reader, and `getByLabelText` found
 * the label but "no form control … associated to that label".
 *
 * Both doors that draw the editor are read through their label here:
 *  - a curated `kind: 'json'` prop (`record:related_list.add`), unset, which is
 *    the only door that can ADD the key;
 *  - the JSON fallback for a stored value in another arm of a union
 *    (`record:related_list.sort` stored as a string).
 * Two editors in one panel each resolve to their own textarea.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// The filter builder lives inside a Radix popover, which does not open in
// jsdom; the popover parts render inline (this directory's existing way).
vi.mock('@object-ui/components', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@object-ui/components');
  const Pass = ({ children }: { children?: unknown }) => children as never;
  return { ...actual, Popover: Pass, PopoverTrigger: Pass, PopoverContent: Pass };
});
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({
    fields: [{ name: 'subject', label: 'Subject', type: 'text', hidden: false }],
    loading: false,
    error: null,
  }),
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => ({ get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]) }),
}));

import { PageBlockInspector } from './PageBlockInspector';

afterEach(() => cleanup());

type Row = Record<string, unknown>;

function Host({ props, writes }: { props: Row; writes: Row[] }) {
  const [draft, setDraft] = React.useState<Row>({
    name: 'lead_page',
    type: 'record',
    object: 'lead',
    kind: 'full',
    regions: [{ name: 'main', components: [{ id: 'tasks', type: 'record:related_list', properties: props }] }],
  });
  return (
    <PageBlockInspector
      type="page"
      name="lead_page"
      draft={draft}
      selection={{ kind: 'block', id: 'regions[0].components[0]' }}
      onPatch={(patch: Row) => setDraft((d) => {
        const next = { ...d, ...patch };
        const regions = next.regions as Array<{ components: Array<{ properties: Row }> }>;
        writes.push(regions[0].components[0].properties);
        return next;
      })}
      onClearSelection={() => {}}
      readOnly={false}
      locale="en-US"
    />
  );
}

const BASE = { objectName: 'task', relationshipField: 'lead' };
const ADD_LABEL = 'Add existing records (picker)';

describe('page block inspector — the JSON editor is named by its label', () => {
  it('finds a curated JSON prop by its label, and the textarea it finds is the editor', () => {
    const writes: Row[] = [];
    render(<Host props={BASE} writes={writes} />);
    const box = screen.getByLabelText(ADD_LABEL);
    expect(box.tagName).toBe('TEXTAREA');
    expect(box).toHaveAccessibleName(ADD_LABEL);

    const add = { picker: { object: 'sys_user' }, linkField: 'user_id' };
    fireEvent.change(box, { target: { value: JSON.stringify(add) } });
    fireEvent.blur(box);
    expect(writes.at(-1)!.add).toEqual(add);
  });

  it('names the JSON fallback of a stored other-arm value, and each editor keeps its own id', () => {
    render(<Host props={{ ...BASE, sort: 'subject' }} writes={[]} />);
    const sort = screen.getByLabelText('Sort');
    expect(sort.tagName).toBe('TEXTAREA');
    expect((sort as HTMLTextAreaElement).value).toBe('"subject"');

    const add = screen.getByLabelText(ADD_LABEL);
    expect(add).not.toBe(sort);
    expect(sort.id).not.toBe('');
    expect(add.id).not.toBe(sort.id);
  });
});
