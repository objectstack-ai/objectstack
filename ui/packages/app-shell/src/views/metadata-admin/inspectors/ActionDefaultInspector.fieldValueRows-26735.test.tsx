// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26735 — "Add field value" adds a row the author can fill, and
 * the row reaches the update action's `patch` once it names a field.
 *
 * Measured before the fix: the button committed `['', '']`, the write dropped
 * the blank key, so no row appeared and `patch` stayed `{}` — an update action
 * made in Studio could never be given a field to set.
 *
 * The pins drive the real inspector in a host that merges each patch
 * shallowly, the way the action hosts do, and parse the sent draft with the
 * spec's `ActionSchema`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ActionSchema } from '@objectstack/spec/ui';

const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]), withPreviewDrafts() { return this; } },
}));
vi.mock('../useMetadata', () => ({ useMetadataClient: () => state.metadataClient }));

import { ActionDefaultInspector } from './ActionDefaultInspector';

afterEach(cleanup);

type Draft = Record<string, unknown>;

function mountHost(initial: Draft) {
  const seen: { draft: Draft; writes: Draft[]; setDraft: (d: Draft) => void } = {
    draft: initial,
    writes: [],
    setDraft: () => {},
  };
  function Host() {
    const [draft, setDraft] = React.useState<Draft>(initial);
    seen.draft = draft;
    seen.setDraft = (d) => setDraft(d);
    return (
      <ActionDefaultInspector
        type="action"
        name={String(initial.name)}
        locale={'en-US' as never}
        readOnly={false}
        draft={draft}
        onPatch={(patch) => {
          seen.writes.push(patch);
          setDraft((d) => ({ ...d, ...patch }));
        }}
      />
    );
  }
  render(<Host />);
  return seen;
}

const sent = (draft: Draft): Draft => JSON.parse(JSON.stringify(draft));

function refusals(draft: Draft): string[] {
  const parsed = ActionSchema.safeParse(sent(draft));
  return parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}:${i.code}`);
}

/** The text inputs under every visible label `label`, in row order. */
function inputsUnder(label: string): HTMLInputElement[] {
  return screen
    .queryAllByText(label, { selector: 'label' })
    .map((lab) => lab.parentElement!.querySelector('input') as HTMLInputElement);
}

const addRow = () => fireEvent.click(screen.getByRole('button', { name: 'Add field value' }));

/** The skeleton Studio's New starts from (objectui#11820): `type` left to the spec. */
const NEW_UPDATE_ACTION: Draft = {
  name: 'invoice_action_2',
  label: 'New action',
  objectName: 'invoice',
  locations: ['record_header'],
  operation: 'update',
  patch: {},
};

describe('fieldValueRowsPin — a new field-value row is held until it names a field (objectstack#26735)', () => {
  it('add row → field → value: the row shows at once, and `patch` holds it once it names a field', () => {
    const seen = mountHost(NEW_UPDATE_ACTION);
    expect(inputsUnder('Field')).toHaveLength(0);

    addRow();
    // The row is on screen, and nothing was written: a blank row never
    // reaches the draft.
    expect(inputsUnder('Field')).toHaveLength(1);
    expect(seen.writes).toStrictEqual([]);
    expect(sent(seen.draft).patch).toStrictEqual({});

    const field = inputsUnder('Field')[0];
    fireEvent.change(field, { target: { value: 'status' } });
    expect(sent(seen.draft).patch).toStrictEqual({ status: '' });
    // The row was written in place: the same input, so the focus stays.
    expect(inputsUnder('Field')[0]).toBe(field);
    expect(field).toHaveValue('status');

    fireEvent.change(inputsUnder('Value')[0], { target: { value: 'done' } });
    expect(sent(seen.draft).patch).toStrictEqual({ status: 'done' });
    expect(refusals(seen.draft)).toEqual([]);
  });

  it('a row whose field is cleared stays on screen, held, and leaves `patch`', () => {
    const seen = mountHost({ ...NEW_UPDATE_ACTION, type: 'script', patch: { status: 'done', priority: 'high' } });
    expect(inputsUnder('Field').map((i) => i.value)).toEqual(['status', 'priority']);

    fireEvent.change(inputsUnder('Field')[0], { target: { value: '' } });
    expect(sent(seen.draft).patch).toStrictEqual({ priority: 'high' });
    expect(inputsUnder('Field').map((i) => i.value)).toEqual(['', 'priority']);
    expect(inputsUnder('Value').map((i) => i.value)).toEqual(['done', 'high']);

    fireEvent.change(inputsUnder('Field')[0], { target: { value: 'stage' } });
    expect(sent(seen.draft).patch).toStrictEqual({ priority: 'high', stage: 'done' });
    expect(refusals(seen.draft)).toEqual([]);
  });

  it('removing a held row writes nothing; removing a written one takes it out of `patch`', () => {
    const seen = mountHost({ ...NEW_UPDATE_ACTION, type: 'script', patch: { status: 'done' } });
    addRow();
    expect(inputsUnder('Field')).toHaveLength(2);

    const removes = () => screen.getAllByRole('button', { name: 'Remove field value' });
    fireEvent.click(removes()[1]);
    expect(seen.writes).toStrictEqual([]);
    expect(inputsUnder('Field')).toHaveLength(1);

    fireEvent.click(removes()[0]);
    expect(seen.writes).toStrictEqual([{ patch: {} }]);
    expect(inputsUnder('Field')).toHaveLength(0);
  });

  it('control: another write to `patch` shows the draft\'s rows, not the held ones', () => {
    const seen = mountHost({ ...NEW_UPDATE_ACTION, type: 'script' });
    addRow();
    expect(inputsUnder('Field')).toHaveLength(1);

    React.act(() => seen.setDraft({ ...seen.draft, patch: { owner: 'me' } }));
    expect(inputsUnder('Field').map((i) => i.value)).toEqual(['owner']);
  });

  it('control: an action that holds a `type` is written with `patch` alone', () => {
    const seen = mountHost({ ...NEW_UPDATE_ACTION, type: 'script', patch: { status: 'done' } });
    addRow();
    fireEvent.change(inputsUnder('Field')[1], { target: { value: 'stage' } });
    expect(seen.writes).toStrictEqual([{ patch: { status: 'done', stage: '' } }]);
  });
});
