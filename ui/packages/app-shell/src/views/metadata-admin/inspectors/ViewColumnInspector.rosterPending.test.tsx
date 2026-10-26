// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#8862, end to end — the frame the card was filed about.
 *
 * `ViewColumnInspector` builds its field roster from `useObjectFields`, which
 * answers over the network. While that request is out, `objectFields` is `[]`,
 * and `InspectorSelectField` used to read an empty roster as proof of absence:
 * a column bound to a REAL field of the object rendered as
 * `FIELDKEY (not in object)` for the length of the round trip, then settled to
 * the field's own label. The marker is an assertion about the author's data on
 * the authoring surface, and for that window it was false — the plausible
 * author response is to re-author a binding that was already correct.
 *
 * ## ⭐ Why the whole chain is mounted instead of the primitive alone
 *
 * `_shared.rosterPending.test.tsx` pins the primitive's tri-state by handing it
 * `loading` directly. That leaves one seam untested: whether this call site
 * actually PASSES the signal its hook already publishes. A fix to the
 * primitive with the prop unthreaded here is green there and still ships the
 * defect, so this suite drives the real hook against a metadata client whose
 * promise is held open, and reads the trigger in that frame.
 *
 * ## The pin is the IN-FLIGHT frame, not the settled one
 *
 * The settled frame was never wrong — it was correct before this change and is
 * correct after it — so a test that lets the roster land before asserting is
 * green on the defect too. The two cases that carry the repair therefore read
 * the trigger BEFORE resolving the client, and only then resolve it to pin what
 * it settles to. The third is the true negative and deliberately does the
 * opposite; the note on it says why.
 *
 * ## ⛔ What the existing pin on this exact string does NOT cover
 *
 * `ViewColumnInspector.identityRead.test.tsx` already asserts
 * `'name (not in object)'` is absent, and that case is green on the defect: its
 * draft binds NO object, so `useObjectFields` short-circuits and reports
 * `loading: false` on the first render — the roster is answered-and-empty, not
 * unanswered — and its legacy `{accessorKey, header}` column yields no field
 * key at all, so the control it reads is an `<input>` rather than this
 * combobox. It pins the retired-alias read; it says nothing about this window.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

/**
 * A metadata client whose `get` never settles until the test says so. The same
 * promise is handed to every caller (`ViewColumnInspector`'s own hook and the
 * `FieldsListEditor` it renders both ask for the object), so one `resolve`
 * releases the whole tree.
 */
const state = vi.hoisted(() => {
  let release: (doc: unknown) => void = () => {};
  const pending = { current: new Promise<unknown>(() => {}) };
  return {
    metadataClient: {
      get: vi.fn(() => pending.current),
      withPreviewDrafts() { return this; },
      list: vi.fn(async () => [] as unknown[]),
    },
    /** Arm a fresh unsettled response; call before mounting. */
    hold() {
      pending.current = new Promise<unknown>((res) => {
        release = res;
      });
    },
    /** Land the response the inspector has been waiting for. */
    land(doc: unknown) {
      release(doc);
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

/** The object the server eventually answers with — `amount` is a real field. */
const objectDoc = {
  name: 'invoices',
  fields: {
    amount: { type: 'currency', label: 'Total' },
    stage: { type: 'text', label: 'Stage' },
  },
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

describe('ViewColumnInspector — the field roster is still loading (objectui#8862)', () => {
  it('does not call a real field "not in object" while the roster is in flight', () => {
    mount();

    // Read the frame the author sees during the round trip. No `waitFor` here
    // on purpose: waiting is what made this defect invisible to testing.
    expect(
      fieldKeyTrigger().textContent,
      'the bound field key is legible and carries no absence claim',
    ).toBe('amount');
    expect(
      screen.queryByText('amount (not in object)'),
      'the marker asserts something the unanswered roster cannot know',
    ).toBeNull();
  });

  it('settles to the field’s own label once the roster lands', () => {
    mount();
    expect(fieldKeyTrigger().textContent).toBe('amount');

    state.land(objectDoc);

    // `Total · amount` is this call site's option wording for a field whose
    // label differs from its name.
    return waitFor(() => {
      expect(fieldKeyTrigger().textContent).toBe('Total · amount');
    });
  });

  it('still flags a key the LANDED roster does not carry — the true negative', () => {
    // Without this leg the suite is satisfied by deleting the marker outright.
    // Here the response arrives and genuinely does not offer `amount`, so the
    // claim becomes true and must be made.
    //
    // ⚠️ Deliberately does NOT read the in-flight frame first, although the
    // other two cases do and it would document the transition nicely. Measured:
    // with that pre-assertion in place, ablating the fix turned this row red for
    // the PENDING frame's reason and the row stopped being able to testify about
    // the answered one — both legs failing on one ablation is exactly what a
    // true negative exists to rule out. The legs are decoupled so this one is
    // green on the defect and on the fix alike, and red only if the marker is
    // deleted outright.
    mount();
    state.land({ name: 'invoices', fields: { stage: { type: 'text', label: 'Stage' } } });

    return waitFor(() => {
      expect(
        fieldKeyTrigger().textContent,
        'an answered roster without the key is exactly what the marker is for',
      ).toBe('amount (not in object)');
    });
  });
});
