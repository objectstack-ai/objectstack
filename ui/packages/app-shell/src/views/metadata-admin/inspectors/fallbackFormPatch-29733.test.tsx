// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A key cleared in a default inspector's "More fields" fallback `SchemaForm`
 * reaches the draft as ABSENT, through the host's merging `onPatch`.
 *
 * `SchemaForm` reports a clear by deleting the key from the object it emits.
 * The hosts merge each patch over the draft (`{ ...draft, ...patch }`), so the
 * five fallback call sites handed the merge an object that merely LACKED the
 * key, and the old value survived: a "— None —" pick on an optional enum, or
 * an emptied text box, was undone at once. `fallbackFormPatch` returns the
 * dropped keys as explicit `undefined`, which the merge applies and the saved
 * JSON omits.
 *
 * Pins:
 *  - the helper, through a merge: a cleared key is absent, an edited key takes
 *    its new value;
 *  - CONTROL: a key the form never touched is not turned into `undefined`;
 *  - the real `ActionDefaultInspector` under a merging host: "— None —" on
 *    `openIn` and an emptied `description` both leave the draft without the
 *    key, and the curated keys the fallback form hides are untouched.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { fallbackFormPatch } from './fallbackFormPatch';
import { t } from '../i18n';

// The inspector calls `useObjectOptions()` / `useObjectFields()` on mount.
// Stub the shared client so no fetch escapes; nothing below reads the catalog.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]) },
}));
vi.mock('../useMetadata', () => ({ useMetadataClient: () => state.metadataClient }));

import { ActionDefaultInspector } from './ActionDefaultInspector';

afterEach(cleanup);

type Json = Record<string, unknown>;

/** What the hosts do with an inspector patch (ResourceEditPage's `onPatch`). */
const merge = (draft: Json, patch: Json): Json => ({ ...draft, ...patch });

describe('fallbackFormPatch — a cleared key survives the host merge as absent', () => {
  it('⭐ a key the form deleted is absent after the merge; an edited key takes its value', () => {
    const draft = { name: 'go', openIn: 'self', order: 3 };
    // SchemaForm's emitted object after "— None —" on openIn and order → 4.
    const next = { name: 'go', order: 4 };
    const merged = merge(draft, fallbackFormPatch(draft, next));
    expect(JSON.parse(JSON.stringify(merged))).toEqual({ name: 'go', order: 4 });
    // The unfixed wiring for contrast: the merge keeps the cleared value.
    expect(merge(draft, next)).toEqual({ name: 'go', openIn: 'self', order: 4 });
  });

  it('CONTROL — a key the form never touched is passed through, never made undefined', () => {
    const draft = { name: 'go', label: 'Go', openIn: 'self' };
    const next = { name: 'go', label: 'Go', openIn: 'new-tab' };
    const patch = fallbackFormPatch(draft, next);
    expect(patch).toEqual(next);
    expect(Object.values(patch)).not.toContain(undefined);
    expect(merge(draft, patch)).toEqual({ name: 'go', label: 'Go', openIn: 'new-tab' });
  });
});

/** A trimmed served `action` schema: two curated keys and two fallback rows. */
const SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    label: { type: 'string' },
    openIn: { type: 'string', enum: ['self', 'new-tab'] },
    description: { type: 'string' },
  },
  required: ['name'],
};

/** A host that merges every patch, as ResourceEditPage does, and reports the draft. */
function MergingHost({ initial, onDraft }: { initial: Json; onDraft: (d: Json) => void }) {
  const [draft, setDraft] = React.useState<Json>(initial);
  React.useEffect(() => onDraft(draft), [draft, onDraft]);
  return (
    <ActionDefaultInspector
      type="action"
      name="go"
      draft={draft}
      onPatch={(patch) => setDraft((d) => merge(d, patch))}
      readOnly={false}
      locale={'en-US' as never}
      serverSchema={SCHEMA}
    />
  );
}

describe('ActionDefaultInspector "More fields" — clears reach the draft', () => {
  it('⭐ "— None —" on an optional enum leaves the saved draft without the key', async () => {
    let latest: Json = {};
    const onDraft = (d: Json) => { latest = d; };
    render(<MergingHost initial={{ name: 'go', label: 'Go', type: 'url', target: 'https://example.com', openIn: 'self' }} onDraft={onDraft} />);

    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Open In' }), { key: 'ArrowDown' });
    await waitFor(() => expect(screen.queryAllByRole('option').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('option', { name: t('engine.form.none', 'en-US') }));

    await waitFor(() => expect(JSON.parse(JSON.stringify(latest))).not.toHaveProperty('openIn'));
    // The curated keys the fallback form hides are untouched.
    expect(JSON.parse(JSON.stringify(latest))).toEqual({
      name: 'go', label: 'Go', type: 'url', target: 'https://example.com',
    });
  });

  it('⭐ an emptied text box leaves the saved draft without the key', async () => {
    let latest: Json = {};
    const onDraft = (d: Json) => { latest = d; };
    render(<MergingHost initial={{ name: 'go', label: 'Go', type: 'url', target: 'https://example.com', description: 'Opens the ticket' }} onDraft={onDraft} />);

    fireEvent.change(screen.getByDisplayValue('Opens the ticket'), { target: { value: '' } });

    await waitFor(() => expect(JSON.parse(JSON.stringify(latest))).not.toHaveProperty('description'));
    expect(JSON.parse(JSON.stringify(latest))).toEqual({
      name: 'go', label: 'Go', type: 'url', target: 'https://example.com',
    });
  });
});
