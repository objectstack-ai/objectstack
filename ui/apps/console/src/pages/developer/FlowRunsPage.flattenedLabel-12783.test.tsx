// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Flow Runs flow picker names a labelled flow `label (name)` on the list
 * the server actually serves (objectui#12783).
 *
 * objectstack's `getMetaItems` answers `meta.getItems('flow')` with FLATTENED
 * items: each flow's `name` and `label` sit at the top level of the item, and
 * no item carries a `spec` member. The page read the name with a fallback to
 * the flat item but the label from `it.spec.label` alone, so on a real server
 * every flow was listed by its API name only, `showcase_batch_reminders` where
 * "Batch Task Reminders (Loop) (showcase_batch_reminders)" belongs. The page's
 * other suites fed `{ spec: {...} }` items, which is why none of them saw it.
 *
 * What is pinned:
 *   - a flattened answer, shaped as the served list is: the option text is
 *     `label (name)`;
 *   - a `spec`-wrapped item is NOT read (objectui#12829): no server serves that
 *     shape, so the page keeps no arm for it and such an item lists no flow;
 *   - an unlabelled flow: its bare name, not the name standing in for a label.
 *
 * DIRECTION, observed on unchanged `main` at objectui#12783: the flattened case
 * was red there (the option read the bare name); the unlabelled case is green
 * by design, as a no-regression guard. The `spec`-wrapped case is red on any
 * page that still reads a `spec` arm (objectui#12829).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const { catalog, ADAPTER } = vi.hoisted(() => {
  const catalog: { answer: unknown } = { answer: [] };
  // A STABLE singleton: a fresh object per render loops the page's fetch effects.
  const client = {
    meta: { getItems: async (type: string) => (type === 'flow' ? catalog.answer : []) },
    automation: {
      execute: async () => ({ success: true, status: 'completed', durationMs: 1 }),
      listRuns: async () => ({ runs: [] }),
    },
  };
  return { catalog, ADAPTER: { getClient: () => client } };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
  useMetadata: () => ({ objects: [] }),
}));

// Imported AFTER the mocks so the page picks them up.
import { FlowRunsPage } from './FlowRunsPage';

/**
 * One flow as the showcase server lists it: the `{ type, items }` envelope,
 * the item flattened, its `name` and `label` top-level, no `spec` member.
 */
const SERVED_BATCH_REMINDERS = {
  name: 'showcase_batch_reminders',
  label: 'Batch Task Reminders (Loop)',
  type: 'autolaunched',
  status: 'active',
  version: 1,
  variables: [{ name: 'tasks', type: 'list', isInput: true }],
  _packageId: 'com.example.showcase',
  _provenance: 'package',
};

/** A served flow that declares no label. */
const SERVED_UNLABELLED = {
  name: 'nightly_sync',
  type: 'autolaunched',
  status: 'active',
  version: 1,
  variables: [],
  _packageId: 'com.example.showcase',
  _provenance: 'package',
};

beforeEach(() => {
  catalog.answer = [];
});
afterEach(cleanup);

/** Open the picker from the keyboard once the list has loaded; return the option texts, in order. */
async function optionTexts(): Promise<string[]> {
  await screen.findByRole('button', { name: /Run Flow/i });
  const trigger = await screen.findByRole('combobox');
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  return within(listbox).getAllByRole('option').map((o) => o.textContent ?? '');
}

describe('the flow picker names a labelled flow by its label (objectui#12783)', () => {
  it('a flattened meta.getItems answer, as the server serves it: label (name)', async () => {
    catalog.answer = { type: 'flow', items: [SERVED_BATCH_REMINDERS, SERVED_UNLABELLED] };
    render(<FlowRunsPage />);
    expect(await optionTexts()).toEqual([
      'Batch Task Reminders (Loop) (showcase_batch_reminders)',
      'nightly_sync',
    ]);
  });

  it('a spec-wrapped item is not read: it lists no flow (objectui#12829)', async () => {
    catalog.answer = {
      type: 'flow',
      items: [
        { spec: { name: 'showcase_batch_reminders', label: 'Batch Task Reminders (Loop)', variables: [] } },
      ],
    };
    render(<FlowRunsPage />);
    expect(await screen.findByText('No flow definitions found.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('an unlabelled flow: its bare name, never the name doubled as a label', async () => {
    catalog.answer = { type: 'flow', items: [SERVED_UNLABELLED] };
    render(<FlowRunsPage />);
    expect(await optionTexts()).toEqual(['nightly_sync']);
  });
});
