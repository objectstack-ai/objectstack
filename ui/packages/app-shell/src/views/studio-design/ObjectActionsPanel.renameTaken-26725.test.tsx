// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26725 — a rename never writes an action name another action of
 * the object holds.
 *
 * The spec refuses an object that declares one action name twice (its save
 * answers 422). New already derived a name no listed action held; the pair
 * came from the editor's Name field, which wrote whatever was typed, so three
 * actions renamed to `call_api` sat in the draft side by side. A rename to a
 * taken name is now written as the first free `<name>_N`, and the draft it
 * produces parses through the spec's `ObjectSchema`.
 *
 * Control: a rename to a free name is written as typed.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ObjectSchema } from '@objectstack/spec/data';

import { registerMetadataDefaultInspector, type MetadataDefaultInspectorProps } from '../metadata-admin/default-inspector-registry';
import { ObjectActionsPanel } from './ObjectActionsPanel';

afterEach(cleanup);

/** Stands in for the Name field: each button commits one name. */
function RenameInspector({ onPatch }: MetadataDefaultInspectorProps) {
  return (
    <div>
      <button type="button" onClick={() => onPatch({ name: 'call_api' })}>rename to call_api</button>
      <button type="button" onClick={() => onPatch({ name: 'fresh_name' })}>rename to fresh_name</button>
    </div>
  );
}
registerMetadataDefaultInspector('action', RenameInspector);

const act = (name: string, label: string) => ({
  name,
  label,
  type: 'script',
  objectName: 'invoice',
  locations: ['record_header'],
  body: { language: 'expression', source: 'true' },
});

const draftWith = (actions: unknown[]) => ({
  name: 'invoice',
  label: 'Invoice',
  sharingModel: 'private',
  fields: { name: { type: 'text', label: 'Name' } },
  actions,
});

function renameSecond(actions: unknown[], button: string): string[] {
  const onPatch = vi.fn();
  render(<ObjectActionsPanel draft={draftWith(actions)} onPatch={onPatch} />);
  fireEvent.click(screen.getByText('Second'));
  fireEvent.click(screen.getByRole('button', { name: button }));
  expect(onPatch).toHaveBeenCalledTimes(1);
  const written = onPatch.mock.calls[0][0].actions as Array<{ name: string }>;
  expect(ObjectSchema.safeParse(draftWith(written)).success).toBe(true);
  return written.map((a) => a.name);
}

describe('objectstack#26725 a rename to a taken action name takes the first free name', () => {
  it('renaming to a name another action holds writes `<name>_2`', () => {
    expect(renameSecond([act('call_api', 'First'), act('other', 'Second')], 'rename to call_api'))
      .toEqual(['call_api', 'call_api_2']);
  });

  it('skips a suffix another action already holds', () => {
    expect(renameSecond(
      [act('call_api', 'First'), act('other', 'Second'), act('call_api_2', 'Third')],
      'rename to call_api',
    )).toEqual(['call_api', 'call_api_3', 'call_api_2']);
  });

  it('control: a rename to a free name is written as typed', () => {
    expect(renameSecond([act('call_api', 'First'), act('other', 'Second')], 'rename to fresh_name'))
      .toEqual(['call_api', 'fresh_name']);
  });
});
