// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11783 — the Lookup's *Related object* resolves the name the author
 * COMMITS, never each prefix they type on the way to it.
 *
 * The chain is the real one: the inspector, its `LookupConfigFields` and the
 * real `useObjectFields`, which reads the related object with
 * `client.get('object', NAME)` — the `GET /meta/object/NAME` the card measured
 * once per keystroke. Only the metadata client is a double, so the count read
 * here is the count of that request.
 *
 * The double also answers the reads the inspector made before this card (the
 * published list and the draft headers), so the reverse check runs the old
 * input to its measurement rather than to a missing method.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => {
  const NAME = 'repairs_repair_ticket';
  const CATALOG: Array<Record<string, unknown>> = [
    { name: NAME, label: 'Repair Ticket', _packageId: 'com.example.repairs', _draft: true },
    { name: 'sys_user', label: 'User', isSystem: true, _packageId: 'com.objectstack.plugin-auth' },
  ];
  const get = vi.fn(async (_type: string, name: string) =>
    name === NAME ? { name, fields: { subject: { type: 'text', label: 'Subject' } } } : null,
  );
  const previewList = vi.fn(async (_type: string) => CATALOG);
  const client = {
    get,
    withPreviewDrafts: vi.fn((_on: boolean) => ({ list: previewList, get })),
    list: vi.fn(async (type: string) => (type === 'object' ? CATALOG.filter((o) => !o._draft) : [])),
    listDrafts: vi.fn(async () => [] as unknown[]),
  };
  return { NAME, get, client };
});

vi.mock('../useMetadata', () => ({ useMetadataClient: () => h.client }));

import { ObjectFieldInspector } from './ObjectFieldInspector';
import { readFields } from '../previews/object-fields-io';

afterEach(cleanup);
beforeEach(() => h.get.mockClear());

/** The inspector over a draft that takes its own patches, as the editor host does. */
function Harness({ onPatch }: { onPatch: (p: Record<string, unknown>) => void }) {
  const [draft, setDraft] = React.useState<Record<string, unknown>>({
    name: 'repairs_work_order',
    fields: { technician: { type: 'lookup', label: 'Technician' } },
  });
  return (
    <ObjectFieldInspector
      type="object"
      name="repairs_work_order"
      draft={draft}
      selection={{ kind: 'field', id: 'technician' }}
      onPatch={(p) => {
        onPatch(p);
        setDraft((d) => ({ ...d, ...p }));
      }}
      onClearSelection={vi.fn()}
      onSelectionChange={vi.fn()}
      readOnly={false}
      locale="en-US"
    />
  );
}

/** The `reference` a patch writes onto the lookup field, if it writes one. */
function referenceIn(patch: Record<string, unknown>): unknown {
  return readFields(patch.fields).entries.find((e) => e.name === 'technician')?.def.reference;
}

/**
 * The input under the visible *Related object* label. Located by the label's
 * container, not by accessible name, so the reverse check finds the old
 * datalist input too (its label was never associated with it).
 */
function relatedObjectInput(): HTMLInputElement {
  return screen.getByText('Related object', { selector: 'label' }).parentElement!.querySelector('input')!;
}

const objectGets = () => h.get.mock.calls.filter(([type]) => type === 'object').map(([, name]) => name);

describe('Lookup Related object — resolves the committed name only (objectui#11783)', () => {
  it('typing a name issues no object read; committing it issues one, for that name', async () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} />);
    const input = relatedObjectInput();

    await userEvent.click(input);
    await userEvent.type(input, h.NAME);
    expect(objectGets()).toEqual([]);
    expect(onPatch.mock.calls.filter(([p]) => referenceIn(p) !== undefined)).toEqual([]);

    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(objectGets()).toEqual([h.NAME]));
    expect(onPatch.mock.calls.map(([p]) => referenceIn(p)).filter((r) => r !== undefined)).toEqual([h.NAME]);
  });

  // Control: true before this card and after it — the saved value did not change.
  it('the committed name saves exactly as typed', async () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} />);
    const input = relatedObjectInput();
    await userEvent.click(input);
    await userEvent.type(input, h.NAME);
    await userEvent.keyboard('{Enter}');
    const refs = onPatch.mock.calls.map(([p]) => referenceIn(p)).filter((r) => r !== undefined);
    expect(refs.at(-1)).toBe(h.NAME);
  });

  it('a platform object stays choosable for a Lookup (sys_user, through a search)', async () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} />);
    const input = relatedObjectInput();
    await userEvent.click(input);
    await userEvent.type(input, 'sys_us');
    const option = await waitFor(() => {
      const o = document.querySelector('[data-object-name="sys_user"]');
      expect(o).not.toBeNull();
      return o as HTMLElement;
    });
    await userEvent.click(option);
    const refs = onPatch.mock.calls.map(([p]) => referenceIn(p)).filter((r) => r !== undefined);
    expect(refs).toEqual(['sys_user']);
  });
});
