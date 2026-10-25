/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10291 — a single select / radio emptied by a cascade prune must
 * reach the WIRE as an explicit `null`, on the inline-edit save path.
 *
 * ## The defect
 *
 * Since objectui#7190 entering inline edit runs the option widgets' cascade
 * clear: a value the current parent no longer offers is dropped. The multi
 * select dropped it to a real array; the single select and the radio dropped
 * it to `undefined`. `InlineEditSaveBar.handleSave` hands the draft unchanged
 * to `dataSource.update`, and `@objectstack/client`'s `data.update` sends
 * `body: JSON.stringify(data)` — which omits an own key whose value is
 * `undefined`. So the field the user saw emptied was never written, and its
 * stored value came back on refresh.
 *
 * ## What this file observes
 *
 * The WIRE BODY, not the call argument: the data source below serialises the
 * payload exactly as that client does, so an own `undefined` is lost here the
 * same way it is lost in production. Asserting on the `update` argument alone
 * would read `{ tier: undefined }` as "the key is there" and stay green on the
 * defect.
 *
 * The host is the real inline-edit composition — `InlineEditProvider`, the
 * real `DetailSection` (whose `InlineFieldInput` renders the real
 * `SelectField` / `RadioField` / multi-select), and the real
 * `InlineEditSaveBar` — overlaid with the draft by the same spread `DetailView`
 * uses (`{ ...data, ...editedValues }`).
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { InlineEditProvider, useInlineEdit } from '@object-ui/react';
import type { DetailViewSection } from '@object-ui/types';
import { DetailSection } from '../DetailSection';
import { InlineEditSaveBar } from '../InlineEditSaveBar';

/** `gold` is offered only under `emea`, `silver` only under `apac`. */
const REGIONAL_OPTIONS = [
  { label: 'Gold', value: 'gold', visibleWhen: "record.region == 'emea'" },
  { label: 'Silver', value: 'silver', visibleWhen: "record.region == 'apac'" },
];
/** The same two values with no option rule — what the control select offers. */
const PLAIN_OPTIONS = [
  { label: 'Gold', value: 'gold' },
  { label: 'Silver', value: 'silver' },
];

const objectSchema = {
  fields: {
    title: { type: 'text', label: 'Title' },
    region: { type: 'text', label: 'Region' },
    /** Single select, pruned by the parent → the defect's first carrier. */
    tier: { type: 'select', label: 'Tier', dependsOn: ['region'], options: REGIONAL_OPTIONS },
    /** Radio, pruned by the parent → the defect's second carrier. */
    band: { type: 'radio', label: 'Band', dependsOn: ['region'], options: REGIONAL_OPTIONS },
    /** Multi select, pruned by the parent → the positive control: a real array. */
    tags: {
      type: 'select',
      multiple: true,
      label: 'Tags',
      dependsOn: ['region'],
      options: REGIONAL_OPTIONS,
    },
    /** Untouched select → the negative control: never staged, never sent. */
    tier_any: { type: 'select', label: 'Tier (any)', options: PLAIN_OPTIONS },
  },
};

const section = {
  fields: ['title', 'region', 'tier', 'band', 'tags', 'tier_any'].map((name) => ({ name })),
} as DetailViewSection;

/** Every value admissible under `emea`, so nothing is pruned on entry. */
const SAVED = {
  id: 'r1',
  title: 'Task one',
  region: 'emea',
  tier: 'gold',
  band: 'gold',
  tags: ['gold'],
  tier_any: 'gold',
  updated_at: 'v1',
};

/** Stand-in for `DetailView`: the saved record overlaid with the draft. */
function Host() {
  const inline = useInlineEdit()!;
  return (
    <>
      <button onClick={() => inline.enter()}>enter-edit</button>
      <DetailSection
        section={section}
        data={{ ...SAVED, ...inline.draft }}
        objectSchema={objectSchema}
        isEditing={inline.editing}
        onFieldChange={inline.setField}
      />
    </>
  );
}

function renderInlineEdit() {
  /** The PATCH bodies, serialised the way `@objectstack/client` does it. */
  const wire: string[] = [];
  const update = vi.fn(async (_object: string, _id: string, data: Record<string, unknown>) => {
    wire.push(JSON.stringify(data));
    return {};
  });
  const utils = render(
    <InlineEditProvider canEdit>
      <Host />
      <InlineEditSaveBar
        dataSource={{ update }}
        objectName="task"
        recordId="r1"
        data={SAVED}
        refresh={vi.fn(async () => {})}
      />
    </InlineEditProvider>,
  );
  return { ...utils, wire, update };
}

/** `title` and `region` both edit through the plain-text input; pick by value. */
function regionInput(container: HTMLElement): HTMLInputElement {
  const inputs = Array.from(
    container.querySelectorAll('[data-testid="inline-plain-text-input"]'),
  ) as HTMLInputElement[];
  const hit = inputs.find((el) => el.value === 'emea');
  if (!hit) throw new Error('region input not found');
  return hit;
}

async function enterAndMoveRegionToApac(container: HTMLElement) {
  fireEvent.click(screen.getByText('enter-edit'));
  await waitFor(() => {
    expect(container.querySelector('[data-testid="select-trigger-tier"]')).toBeTruthy();
  });
  // The parent moves: `gold` is no longer offered to any regional field.
  await act(async () => {
    fireEvent.change(regionInput(container), { target: { value: 'apac' } });
  });
}

async function save() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  });
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* happy-dom */
  }
});

describe('objectui#10291 — inline edit: a cascade-cleared scalar reaches the wire as null', () => {
  it('the pruned single select AND radio are in the PATCH body as null; the multi select writes its array; the untouched select is absent', async () => {
    const { container, wire, update } = renderInlineEdit();
    await enterAndMoveRegionToApac(container);

    await save();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));

    expect(wire).toHaveLength(1);
    const body = JSON.parse(wire[0]);
    // (a) the scalar prunes are written — as an explicit null, the sentinel
    // the write contract reads as "clear the stored value".
    expect(body).toHaveProperty('tier', null);
    expect(body).toHaveProperty('band', null);
    // (c) positive control: the multi-value prune still writes a real array.
    expect(body).toHaveProperty('tags', []);
    // (d) negative control: an untouched select is not staged at all — the
    // fix must not turn "never edited" into a spurious null.
    expect(body).not.toHaveProperty('tier_any');
    // The parent edit itself, and nothing else.
    expect(body).toEqual({ region: 'apac', tier: null, band: null, tags: [] });
  });
});
