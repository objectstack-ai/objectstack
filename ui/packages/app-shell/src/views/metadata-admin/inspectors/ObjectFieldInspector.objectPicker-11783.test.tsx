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
// Paid at collection, not inside a clocked case: the picker's closure and the
// CEL authoring helpers load it lazily (check:test-source-alias).
import '@objectstack/lint';

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

/**
 * objectstack#36747 — the Lookup's *Related object* and the roll-up's *Child
 * object* take objects only. No expression is legal at either door, so once
 * the catalog has answered, typed text that names no listed object is refused:
 * the picker says so, nothing is committed, and a target the field already
 * has stays as it was. An object the catalog lists — here one that exists
 * only as a pending draft (served by the draft-overlaid list, absent from the
 * published one) — is still chosen.
 */
describe('Lookup and roll-up target doors take objects only (objectstack#36747)', () => {
  const DOORS = [
    {
      door: 'Lookup Related object',
      label: 'Related object',
      field: { type: 'lookup', label: 'Technician' },
      withTarget: { type: 'lookup', label: 'Technician', reference: 'sys_user' },
      target: (def: Record<string, unknown> | undefined) => def?.reference,
    },
    {
      door: 'roll-up Child object',
      label: 'Child object',
      field: { type: 'summary', label: 'Total' },
      withTarget: { type: 'summary', label: 'Total', summaryOperations: { object: 'sys_user', function: 'count' } },
      target: (def: Record<string, unknown> | undefined) =>
        (def?.summaryOperations as Record<string, unknown> | undefined)?.object,
    },
  ] as const;

  function DoorHarness({ field, onPatch }: { field: Record<string, unknown>; onPatch: (p: Record<string, unknown>) => void }) {
    const [draft, setDraft] = React.useState<Record<string, unknown>>({
      name: 'repairs_work_order',
      fields: { target_field: field },
    });
    return (
      <ObjectFieldInspector
        type="object"
        name="repairs_work_order"
        draft={draft}
        selection={{ kind: 'field', id: 'target_field' }}
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

  /** The input under the door's visible label. */
  const doorInput = (label: string): HTMLInputElement =>
    screen.getByText(label, { selector: 'label' }).parentElement!.querySelector('input')!;

  /** Focus the door and wait until the catalog has answered (its draft-only object is offered). */
  async function openLoaded(input: HTMLInputElement): Promise<HTMLElement> {
    await userEvent.click(input);
    return waitFor(() => {
      const o = document.querySelector(`[data-object-name="${h.NAME}"]`);
      expect(o).not.toBeNull();
      return o as HTMLElement;
    });
  }

  for (const d of DOORS) {
    const targetsIn = (onPatch: ReturnType<typeof vi.fn>) =>
      onPatch.mock.calls
        .map(([p]) => d.target(readFields((p as Record<string, unknown>).fields).entries.find((e) => e.name === 'target_field')?.def))
        .filter((v) => v !== undefined);

    it(`${d.door}: a refused typo keeps the target the field already has`, async () => {
      const onPatch = vi.fn();
      render(<DoorHarness field={d.withTarget} onPatch={onPatch} />);
      const input = doorInput(d.label);
      await openLoaded(input);
      await userEvent.clear(input);
      await userEvent.type(input, 'no_such_object');
      await userEvent.keyboard('{Enter}');
      // No patch touches the field: its stored target is not erased.
      expect(onPatch).not.toHaveBeenCalled();
      expect(input).toHaveValue('sys_user');
      expect(document.querySelector('[data-object-refused]')).not.toBeNull();
    });

    it(`${d.door}: typed text naming no listed object is refused, not saved`, async () => {
      const onPatch = vi.fn();
      render(<DoorHarness field={d.field} onPatch={onPatch} />);
      const input = doorInput(d.label);
      await openLoaded(input);
      await userEvent.type(input, 'no_such_object');
      await userEvent.keyboard('{Enter}');
      expect(targetsIn(onPatch)).toEqual([]);
      expect(document.querySelector('[data-object-refused]')).not.toBeNull();
    });

    it(`${d.door}: a listed object that exists only as a draft is chosen`, async () => {
      // The premise: the draft-only object is absent from the published list…
      expect((await h.client.list('object')).map((o) => o.name)).not.toContain(h.NAME);
      const onPatch = vi.fn();
      render(<DoorHarness field={d.field} onPatch={onPatch} />);
      // …and offered by the picker's catalog all the same.
      const option = await openLoaded(doorInput(d.label));
      await userEvent.click(option);
      expect(targetsIn(onPatch)).toEqual([h.NAME]);
      expect(document.querySelector('[data-object-refused]')).toBeNull();
    });
  }
});
