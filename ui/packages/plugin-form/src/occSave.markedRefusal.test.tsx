/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The THIRD drag-/record-write surface objectui#5902 covers, and the one its
 * card did not name: `useOccSave`'s conflict dialog.
 *
 * The census the card carried was two (kanban card-move, calendar reschedule).
 * `occSave.tsx` already reached into the conflict error for `currentVersion`
 * but never for the producer's `userMessage`, so a 409 an author had marked
 * showed the same canned sentence as every other 409 — the objectui#5210
 * defect, on a dialog instead of a toast.
 *
 * ── Why this surface renders the marking ADDITIVELY, not as a replacement ──
 * The toast surfaces substitute: one slot, one string, the marking wins it.
 * This dialog's description does two different jobs in one paragraph — it says
 * WHY the write was refused, and it explains what the DESTRUCTIVE button will
 * do ("Overwriting will replace their changes with yours."). `userMessage` is
 * a refusal message; it is not affordance copy for a button this surface owns.
 * Replacing the whole description would therefore leave "Overwrite" unexplained
 * on the one surface where the choice is irreversible. So the marking is
 * rendered first and in its own right, and the existing copy stays under it.
 * Pinned below in both directions so the choice is visible rather than implied.
 *
 * ── Direction of these pins ───────────────────────────────────────────────
 *  - marked 409   → RED before the fix (the marking was never rendered).
 *  - unmarked 409 → GREEN before and after: nothing the producer did not opt
 *                   into may reach the user (objectstack#3821).
 *  - marked 400   → GREEN before and after. `saveWithOcc` rethrows everything
 *                   that is not a conflict, and the caller (form.tsx, already
 *                   fixed by objectui#5210) renders the marking. Pinned here so
 *                   a future change to this seam cannot quietly swallow or
 *                   re-wrap the marking on its way past.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { declaredUserMessage } from '@object-ui/react';
import { normaliseClientError } from '@object-ui/data-objectstack';
import { useOccSave, type OccSaveOutcome } from './occSave';

const MARKED = 'Reload first — the quote was re-priced while you were editing.';

/** A fragment of the canned copy, distinguishable from the marking above. */
const GENERIC = /This record was changed by someone else while you were editing/;
/** The destructive button's own explanation, which must survive the fix. */
const AFFORDANCE = /Overwriting will replace their changes with yours/;

const conflict = (userMessage?: string) =>
  normaliseClientError(
    Object.assign(new Error('Record was modified by another user'), {
      code: 'CONCURRENT_UPDATE',
      httpStatus: 409,
      details: {
        currentVersion: '2026-05-22T07:14:00.000Z',
        ...(userMessage ? { userMessage } : {}),
      },
    }),
  );

const validation = (userMessage?: string) =>
  normaliseClientError(
    Object.assign(new Error('Validation failed'), {
      code: 'VALIDATION_FAILED',
      httpStatus: 400,
      details: {
        code: 'VALIDATION_FAILED',
        fields: [{ field: 'amount', message: 'Amount is not allowed' }],
        ...(userMessage ? { userMessage } : {}),
      },
    }),
  );

/**
 * The smallest honest host for the hook: it renders the real `conflictDialog`
 * and drives the real `saveWithOcc`, with nothing between them and the test.
 */
function harness(rejectWith: unknown) {
  const outcome: { value?: OccSaveOutcome; error?: unknown } = {};
  const dataSource = {
    update: vi.fn(async () => {
      throw rejectWith;
    }),
  };

  const Host: React.FC = () => {
    const { saveWithOcc, conflictDialog } = useOccSave();
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            void saveWithOcc({
              dataSource,
              objectName: 'quote',
              recordId: 'q1',
              payload: { amount: 12000 },
              baseRecord: { updated_at: '2026-05-22 07:00:00.000' },
            }).then(
              (value) => {
                outcome.value = value;
              },
              (error) => {
                outcome.error = error;
              },
            );
          }}
        >
          save
        </button>
        {conflictDialog}
      </div>
    );
  };

  render(<Host />);
  return { outcome, dataSource };
}

const save = async () => {
  await act(async () => {
    fireEvent.click(screen.getByText('save'));
  });
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useOccSave — a marked refusal reaches the conflict dialog (#5902)', () => {
  it('renders the marking on a MARKED 409, above the copy it does not replace', async () => {
    harness(conflict(MARKED));
    await save();

    // The gate: pre-fix the dialog opens with the canned copy only.
    expect(await screen.findByText(MARKED)).toBeInTheDocument();
    // …and the destructive button keeps its explanation. The marking is a
    // refusal message, not affordance copy — it augments, it does not evict.
    expect(screen.getByText(AFFORDANCE, { exact: false })).toBeInTheDocument();

    // Settle the pending decision so nothing is left awaiting at teardown.
    fireEvent.click(screen.getByText('Keep editing'));
    await waitFor(() => expect(screen.queryByText('Keep editing')).toBeNull());
  });

  it('says nothing extra on an UNMARKED 409', async () => {
    harness(conflict());
    await save();

    expect(await screen.findByText(GENERIC, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(MARKED)).toBeNull();

    fireEvent.click(screen.getByText('Keep editing'));
    await waitFor(() => expect(screen.queryByText('Keep editing')).toBeNull());
  });

  it('rethrows a MARKED non-conflict rejection with the marking intact', async () => {
    // The second error shape never reaches this surface's own rendering — it
    // is rethrown for the caller. What this seam owes is that it passes it on
    // UNCHANGED, so the caller's `declaredUserMessage` still finds the marking.
    const marked = validation(MARKED);
    const { outcome } = harness(marked);
    await save();

    await waitFor(() => expect(outcome.error).toBeDefined());
    expect(outcome.error).toBe(marked);
    expect(declaredUserMessage(outcome.error)).toBe(MARKED);
    // No conflict dialog for a shape that is not a conflict.
    expect(screen.queryByText('Keep editing')).toBeNull();
  });
});
