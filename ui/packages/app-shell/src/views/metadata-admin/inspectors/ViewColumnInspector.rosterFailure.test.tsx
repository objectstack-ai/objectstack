// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#9651, end to end — the seam a primitive-only pin cannot reach.
 *
 * `ViewColumnInspector` builds its field roster from `useObjectFields`, which
 * has published THREE facts all along: `fields`, `loading` and `error`. Only the
 * first two were passed on. So a `client.get` that REJECTED left the picker with
 * an empty roster and nothing in flight — the same residue an object with no
 * fields leaves — and a column bound to a real field rendered
 * `amount (not in object)` from then on, with nothing on screen saying the
 * request had failed. Unlike the in-flight window objectui#8862 closed, this one
 * never ends.
 *
 * ## ⭐ Why the whole chain is mounted instead of the primitive alone
 *
 * `_shared.rosterFailure.test.tsx` pins what the primitive does when it is TOLD
 * the roster failed. That leaves the seam this suite exists for: whether this
 * call site actually passes the fact its hook already publishes. A primitive
 * fixed with the prop unthreaded here is green there and still ships the defect
 * — which is exactly how the `error` channel came to be dropped in the first
 * place.
 *
 * ## The three arms, with their controls, in one instrument
 *
 *   • in flight   → no flag (objectui#8862's delivery, and the control that it
 *                   still works)
 *   • answered, value genuinely absent → flag (the control that the flag still
 *                   fires when it should)
 *   • FAILED      → no flag, plus a notice naming the cause (the subject)
 *
 * ⚠️ The measured pre-fix reading of the third arm was `amount (not in object)`
 * with zero elements carrying `role="status"` anywhere in the tree.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';

/**
 * A metadata client whose `get` is settled by the test — resolved for the
 * answered arms, REJECTED for the failure arm, left hanging for the in-flight
 * one. The same promise is handed to every caller (`ViewColumnInspector`'s own
 * hook and the `FieldsListEditor` it renders both ask for the object), so one
 * settle releases the whole tree.
 */
const state = vi.hoisted(() => {
  let settle = {
    resolve: (_d: unknown) => {},
    reject: (_e: unknown) => {},
  };
  const pending = { current: new Promise<unknown>(() => {}) };
  return {
    metadataClient: {
      get: vi.fn(() => pending.current),
      withPreviewDrafts() { return this; },
      list: vi.fn(async () => [] as unknown[]),
    },
    /** Arm a fresh unsettled response; call before mounting. */
    hold() {
      pending.current = new Promise<unknown>((resolve, reject) => {
        settle = { resolve, reject };
      });
      // Every consumer attaches its own handler, but the promise is created
      // before any of them exist; without this the rejection is "unhandled" for
      // one turn and the runner treats that as a failure of the test itself.
      pending.current.catch(() => {});
    },
    /** Land the response the inspector has been waiting for. */
    land(doc: unknown) {
      settle.resolve(doc);
    },
    /** Fail the request the inspector has been waiting for. */
    fail(err: unknown) {
      settle.reject(err);
    },
  };
});

vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { ViewColumnInspector } from './ViewColumnInspector';

afterEach(cleanup);

const FIELD_KEY = 'Field key'; // engine.inspector.viewColumn.accessorKey

/** A view draft whose `list` variant IS bound to an object → the roster is fetched. */
const draft = {
  name: 'invoices',
  label: 'Invoices',
  list: { type: 'grid', object: 'invoices', columns: [{ field: 'amount', label: 'Amount' }] },
};

function mount() {
  state.hold();
  render(
    <ViewColumnInspector
      type="view"
      name="invoices"
      draft={draft}
      selection={{ kind: 'column', id: 'list.columns[0]' } as never}
      onPatch={vi.fn()}
      onClearSelection={() => {}}
      onSelectionChange={() => {}}
      readOnly={false}
      locale={'en-US' as never}
    />,
  );
}

/** The field-key control's rendered text — a Radix `button[role=combobox]`. */
const fieldKeyTrigger = () => screen.getByRole('combobox', { name: FIELD_KEY });

/** The notice `InspectorSelectField` renders for a failed roster, if any. */
const failureNotice = () => screen.queryByTestId('inspector-select-roster-failure');

/**
 * Reject the in-flight request and flush the hook's `catch` plus the re-render
 * it schedules.
 *
 * ⭐ Deliberately NOT `waitFor(failureNotice())`. Measured: with the notice as
 * the settle gate, ablating the notice turned the flag-suppression and
 * editability rows red too — for want of a settle, not for their own reason —
 * so the two halves of this repair were not separately pinned at this level.
 * Flushing explicitly decouples them: those rows now fail only when the thing
 * they assert breaks.
 */
async function failRequest(err: unknown): Promise<void> {
  await act(async () => {
    state.fail(err);
    // Two turns: one for the rejection to reach the hook's `catch`, one for the
    // `setState` it makes to land.
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ViewColumnInspector — the field roster FAILED to load (objectui#9651)', () => {
  it('does not call a real field "not in object" after the fetch failed', async () => {
    mount();
    await failRequest(new Error('503 Service Unavailable'));

    expect(
      fieldKeyTrigger().textContent,
      'the bound field key is legible and carries no absence claim',
    ).toBe('amount');
    expect(
      screen.queryByText('amount (not in object)'),
      'a roster that never answered cannot testify that the column is absent',
    ).toBeNull();
  });

  it('tells the author the roster failed, and names the cause', async () => {
    mount();
    await failRequest(new Error('503 Service Unavailable'));

    expect(failureNotice(), 'the failure reached the picker').not.toBeNull();
    // The localized copy this host passes is the shared picker-failure title
    // objectui#5170 landed for the widget family.
    expect(failureNotice()?.textContent).toContain('Options could not be loaded');
    expect(
      failureNotice()?.textContent,
      'without the cause the author cannot tell a broken fetch from a retired field',
    ).toContain('503 Service Unavailable');
  });

  it('leaves the picker EDITABLE after the failure', async () => {
    mount();
    await failRequest(new Error('boom'));

    expect(
      (fieldKeyTrigger() as HTMLButtonElement).disabled,
      'a failed catalog must not also block authoring',
    ).toBe(false);
  });

  it('CONTROL — in flight is still silent, and is NOT reported as a failure', () => {
    // objectui#8862's arm. No `waitFor`: waiting is what made that defect
    // invisible to testing.
    mount();
    expect(fieldKeyTrigger().textContent).toBe('amount');
    expect(screen.queryByText('amount (not in object)')).toBeNull();
    expect(
      failureNotice(),
      'an unanswered request is not a failed one',
    ).toBeNull();
  });

  it('CONTROL — an ANSWERED roster without the key still flags it, with no notice', async () => {
    // The true negative. Without it, deleting the marker outright passes
    // everything above.
    mount();
    state.land({ name: 'invoices', fields: { stage: { type: 'text', label: 'Stage' } } });

    await waitFor(() => {
      expect(
        fieldKeyTrigger().textContent,
        'an answered roster without the key is exactly what the marker is for',
      ).toBe('amount (not in object)');
    });
    expect(failureNotice(), 'a completed load is not a failure').toBeNull();
  });
});
