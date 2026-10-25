/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#6868 — the inline-edit surface's validation authority is the SERVER
 * (maintainer ruling, 2026-08-31, decision batch #13), and the deliverable that
 * follows from it is presentation only: a `VALIDATION_FAILED` refusal must
 * reach the user as a reason PER FIELD instead of the raw server string
 * `cleanError` used to produce.
 *
 * These pin the acceptance contract of that mapping:
 *
 *   - the atomic multi-key write attributes each rejected key from the
 *     ENVELOPE, and the raw server string stops being shown;
 *   - callback mode attributes from the CALL SHAPE (one key per
 *     `onFieldSave`), which is a fact about the write, not an inference;
 *   - a refusal that is NOT field-scoped keeps the cleaned string — no input
 *     is marked on a guess;
 *   - an envelope entry with no usable `field` is DROPPED rather than pinned
 *     on whichever input happens to be nearby, which would be worse than the
 *     undirected string it replaces;
 *   - the attribution cannot outlive its edit session.
 *
 * ⚠️ These assert PRESENTATION of a server verdict. Nothing here evaluates a
 * rule, and nothing here may start to: the ruling forbids a second validation
 * implementation on this surface.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { InlineEditProvider, useInlineEdit } from '@object-ui/react';
import { InlineEditSaveBar } from '../InlineEditSaveBar';
import { DetailSection } from '../DetailSection';
import { HeaderHighlight } from '../HeaderHighlight';

/** The raw server text the user must STOP seeing once the mapping is in place. */
const RAW_SERVER_TEXT = 'VALIDATION_FAILED: Validation failed for crm_opportunity';

/**
 * A `VALIDATION_FAILED` exactly as `@objectstack/client` delivers it: the
 * client sets `details` to the parsed body's `details`, falling back to the
 * WHOLE body — and the validation envelope has no `details` key, so `fields[]`
 * lands there. (`@object-ui/data-objectstack`'s re-wrap moves the same entries
 * onto `validationErrors`; the shared normaliser reads both.)
 */
function validationRefusal(fields: Array<Record<string, unknown>>) {
  return {
    code: 'VALIDATION_FAILED',
    message: RAW_SERVER_TEXT,
    details: { error: 'Validation failed', code: 'VALIDATION_FAILED', fields },
  };
}

function Harness() {
  const inline = useInlineEdit()!;
  return (
    <>
      <button onClick={() => inline.enter('status')}>edit-enter</button>
      <button onClick={() => inline.setField('status', '')}>edit-status</button>
      <button onClick={() => inline.setField('budget', -5)}>edit-budget</button>
      <button onClick={() => inline.cancel()}>edit-cancel</button>
    </>
  );
}

const LABELS: Record<string, string> = { status: 'Stage', budget: 'Budget' };

function renderAtomic(
  update: ReturnType<typeof vi.fn>,
  data: Record<string, unknown> = { updated_at: 'v1' },
) {
  return render(
    <InlineEditProvider canEdit>
      <Harness />
      <InlineEditSaveBar
        dataSource={{ update }}
        objectName="crm_opportunity"
        recordId="o1"
        data={data}
        refresh={vi.fn()}
        fieldLabelFor={(n) => LABELS[n]}
      />
    </InlineEditProvider>,
  );
}

const stageBoth = () => {
  fireEvent.click(screen.getByText('edit-enter'));
  fireEvent.click(screen.getByText('edit-status'));
  fireEvent.click(screen.getByText('edit-budget'));
};
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));

/** Every hint the bar is currently showing, keyed by the field it is attributed to. */
function hints(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const li of Array.from(document.querySelectorAll('[data-inline-field-error]'))) {
    out[li.getAttribute('data-inline-field-error')!] = li.textContent ?? '';
  }
  return out;
}

describe('objectui#6868 — a VALIDATION_FAILED becomes a per-field hint (atomic mode)', () => {
  it('attributes EVERY rejected key from the envelope, by label, and stops showing the raw server string', async () => {
    const update = vi.fn().mockRejectedValue(
      validationRefusal([
        { field: 'status', code: 'required', message: 'Stage is required' },
        { field: 'budget', code: 'min', message: 'Budget must be at least 0' },
      ]),
    );
    renderAtomic(update);
    stageBoth();
    save();

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    // THE deliverable: one reason per rejected field, named by its own label.
    await waitFor(() =>
      expect(hints()).toEqual({
        status: 'Stage: Stage is required',
        budget: 'Budget: Budget must be at least 0',
      }),
    );
    // ...and the raw server text the user used to be shown is gone.
    expect(screen.getByRole('alert').textContent).not.toContain('VALIDATION_FAILED');
    expect(screen.queryByText(RAW_SERVER_TEXT)).toBeNull();
    // The draft is kept — the refusal is a correction prompt, not a discard.
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('falls back to the field machine name when the host resolves no label', async () => {
    const update = vi.fn().mockRejectedValue(
      validationRefusal([{ field: 'close_date', message: 'Close date must be in the future' }]),
    );
    // `close_date` is a field of the record (objectui#13292: a name the bar
    // cannot place on the record is record-level, not an unlabelled field).
    renderAtomic(update, { updated_at: 'v1', close_date: null });
    stageBoth();
    save();
    await waitFor(() =>
      expect(hints()).toEqual({ close_date: 'close_date: Close date must be in the future' }),
    );
  });

  it('DROPS an entry with no usable `field` rather than marking an innocent input', async () => {
    const update = vi.fn().mockRejectedValue(
      validationRefusal([{ code: 'required', message: 'something is required' }]),
    );
    renderAtomic(update);
    stageBoth();
    save();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    // No attribution at all — and the user still gets the cleaned reason.
    expect(hints()).toEqual({});
    expect(screen.getByRole('alert').textContent).toContain('Validation failed for crm_opportunity');
  });

  it('leaves a NON field-scoped failure on the cleaned string (no invented attribution)', async () => {
    const update = vi.fn().mockRejectedValue(new Error('[api] NETWORK_ERROR: connection reset'));
    renderAtomic(update);
    stageBoth();
    save();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(hints()).toEqual({});
    expect(screen.getByRole('alert').textContent).toContain('connection reset');
  });

  it('does not let an attribution outlive its edit session', async () => {
    const update = vi.fn().mockRejectedValue(
      validationRefusal([{ field: 'status', message: 'Stage is required' }]),
    );
    renderAtomic(update);
    stageBoth();
    save();
    await waitFor(() => expect(Object.keys(hints())).toEqual(['status']));

    fireEvent.click(screen.getByText('edit-cancel'));
    fireEvent.click(screen.getByText('edit-enter'));
    // A fresh session shows no stale hint and no stale banner.
    expect(hints()).toEqual({});
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('objectui#6868 — callback (drawer) mode attributes from the CALL SHAPE', () => {
  it('names the field whose own onFieldSave rejected, even with no fields[] in the envelope', async () => {
    // Rejects only the SECOND key, and carries no per-field entries at all —
    // the drawer's per-field contract is what makes this attributable.
    const onFieldSave = vi.fn(async (field: string) => {
      if (field === 'budget') {
        throw { code: 'VALIDATION_FAILED', message: RAW_SERVER_TEXT, details: { error: 'Budget must be at least 0' } };
      }
    });
    render(
      <InlineEditProvider canEdit>
        <Harness />
        <InlineEditSaveBar onFieldSave={onFieldSave} fieldLabelFor={(n) => LABELS[n]} />
      </InlineEditProvider>,
    );
    stageBoth();
    save();

    await waitFor(() => expect(onFieldSave).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(hints()).toEqual({ budget: 'Budget: Budget must be at least 0' }));
    expect(screen.getByRole('alert').textContent).not.toContain('VALIDATION_FAILED');
  });

  it('still prefers the ENVELOPE over the call shape when the server names fields', async () => {
    const onFieldSave = vi.fn(async (field: string) => {
      if (field === 'status') {
        throw validationRefusal([{ field: 'budget', message: 'Budget must be at least 0' }]);
      }
    });
    render(
      <InlineEditProvider canEdit>
        <Harness />
        <InlineEditSaveBar onFieldSave={onFieldSave} fieldLabelFor={(n) => LABELS[n]} />
      </InlineEditProvider>,
    );
    stageBoth();
    save();

    // `status` was in flight, but the server said `budget` — the server wins.
    await waitFor(() => expect(hints()).toEqual({ budget: 'Budget: Budget must be at least 0' }));
  });
});

/**
 * The hint IN PLACE — beside the input, which is what the ruling's 就地字段提示
 * actually asks for. The save bar and the field renderers are SIBLINGS under
 * one `InlineEditProvider`, exactly as both real hosts mount them
 * (`app-shell/RecordDetailView.tsx:2340`/`:2509`, `RecordDetailDrawer.tsx:346`/
 * `:398`), so these drive the real transport rather than a stand-in for it.
 */
describe('objectui#6868 — the reason renders beside the input it is about', () => {
  const objectSchema = { fields: { status: { type: 'text' }, budget: { type: 'number' } } };
  const section = {
    fields: [
      { name: 'status', label: 'Stage' },
      { name: 'budget', label: 'Budget' },
    ],
  } as any;

  /** One session: the details body and the save bar, as the record page mounts them. */
  function renderBodyAndBar(update: ReturnType<typeof vi.fn>) {
    function Body() {
      const inline = useInlineEdit()!;
      return (
        <DetailSection
          section={section}
          data={{ status: 'open', budget: 10 }}
          objectSchema={objectSchema}
          isEditing={inline.editing}
          onFieldChange={(f, v) => inline.setField(f, v)}
          autoFocusField={inline.autoFocusField}
        />
      );
    }
    return render(
      <InlineEditProvider canEdit>
        <Harness />
        <Body />
        <InlineEditSaveBar
          dataSource={{ update }}
          objectName="crm_opportunity"
          recordId="o1"
          data={{ updated_at: 'v1' }}
          refresh={vi.fn()}
          fieldLabelFor={(n) => LABELS[n]}
        />
      </InlineEditProvider>,
    );
  }

  const inPlaceHint = (field: string) =>
    document.querySelector(`[data-inline-field-hint="${field}"]`);

  it('draws the server reason under the refused field, and only under that field', async () => {
    const update = vi.fn().mockRejectedValue(
      validationRefusal([{ field: 'budget', code: 'min', message: 'Budget must be at least 0' }]),
    );
    const { container } = renderBodyAndBar(update);
    stageBoth();
    // CONTROL that must hit: the body really rendered editors for both fields,
    // so a later zero on `status` is a real absence and not an empty harness.
    expect(container.querySelectorAll('input').length).toBeGreaterThanOrEqual(2);
    save();

    await waitFor(() => expect(inPlaceHint('budget')?.textContent).toBe('Budget must be at least 0'));
    // The field the server did NOT refuse carries no hint.
    expect(inPlaceHint('status')).toBeNull();
    // ...and it is announced, not merely printed.
    expect(inPlaceHint('budget')?.getAttribute('role')).toBe('alert');
  });

  it('marks the refused input aria-invalid, and leaves the accepted one unmarked', async () => {
    const update = vi.fn().mockRejectedValue(
      validationRefusal([{ field: 'budget', message: 'Budget must be at least 0' }]),
    );
    renderBodyAndBar(update);
    stageBoth();
    save();

    await waitFor(() => expect(inPlaceHint('budget')).not.toBeNull());
    const marked = Array.from(document.querySelectorAll('[aria-invalid="true"]'));
    expect(marked.length).toBe(1);
  });

  it('clears the in-place hint when the session is cancelled and re-entered', async () => {
    const update = vi.fn().mockRejectedValue(
      validationRefusal([{ field: 'budget', message: 'Budget must be at least 0' }]),
    );
    renderBodyAndBar(update);
    stageBoth();
    save();
    await waitFor(() => expect(inPlaceHint('budget')).not.toBeNull());

    fireEvent.click(screen.getByText('edit-cancel'));
    fireEvent.click(screen.getByText('edit-enter'));
    expect(inPlaceHint('budget')).toBeNull();
    expect(document.querySelectorAll('[aria-invalid="true"]').length).toBe(0);
  });

  it('reaches the highlights strip too — one session, both surfaces', async () => {
    const update = vi.fn().mockRejectedValue(
      validationRefusal([{ field: 'budget', message: 'Budget must be at least 0' }]),
    );
    function Strip() {
      return (
        <HeaderHighlight
          fields={[{ name: 'budget', label: 'Budget', type: 'number' }] as any}
          data={{ budget: 10 }}
          objectSchema={objectSchema}
        />
      );
    }
    render(
      <InlineEditProvider canEdit>
        <Harness />
        <Strip />
        <InlineEditSaveBar
          dataSource={{ update }}
          objectName="crm_opportunity"
          recordId="o1"
          data={{ updated_at: 'v1' }}
          refresh={vi.fn()}
          fieldLabelFor={(n) => LABELS[n]}
        />
      </InlineEditProvider>,
    );
    stageBoth();
    save();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(inPlaceHint('budget')?.textContent).toBe('Budget must be at least 0'),
    );
  });
});
