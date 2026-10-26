/**
 * A record form may NOT be saved while an upload is still in flight
 * (objectui#10166).
 *
 * ## What is pinned here, and why it is a DIFFERENTIAL
 *
 * The defect is not an error — it is a success. A `file`/`image` value only
 * becomes its fileId once the presigned upload settles, so a Save pressed
 * during that window wrote the record WITHOUT the attachment and reported
 * success. Nothing threw, nothing warned, and the record looked saved.
 *
 * ⛔ A pin that asserts "no error" therefore passes on exactly the defect, and
 * so does one that asserts the mid-upload Save produced no attachment — that is
 * the defect's own behaviour. These rows compare the SAME save gesture at two
 * timings and assert the STORED VALUE at each:
 *
 *   - issued while the upload is pending → nothing is written at all;
 *   - issued after it resolves           → the record is written WITH the fileId.
 *
 * Each row asserts the stored value FIRST, before any affordance, so it fails
 * on the WRITE rather than on a missing label. And each closes on the invariant
 * no weakening can satisfy on the defect: exactly one record reached the
 * adapter across both gestures, and it carries the file the user picked.
 *
 * ## What is real here and what is faked
 *
 * Only the upload TRANSPORT is faked. The stub widget drives the real
 * `useUploadingSignal` from `@object-ui/fields`, so the signal path under test
 * is the shipping one: `useUploadingSignal` → `UploadingScope` →
 * the host's gate. Faking the transport is what makes the mid-upload window
 * deterministic; `ActionParamDialog.uploading.test.tsx` fakes it the same way
 * for the one host that already had a gate.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { registerAllFields, useUploadingSignal } from '@object-ui/fields';
import { ObjectForm } from './ObjectForm';
import { ModalForm } from './ModalForm';
import { DrawerForm } from './DrawerForm';
import { SplitForm } from './SplitForm';
import { TabbedForm } from './TabbedForm';
import { WizardForm } from './WizardForm';
import { MasterDetailForm } from './MasterDetailForm';
import { EmbeddableForm } from './EmbeddableForm';

registerAllFields();

/**
 * Stands in for `FileField` — a control whose value is only usable once the
 * upload settles. It publishes through the REAL hook, so nothing about the
 * signal path is simulated.
 */
function FakeUploadWidget({ onChange }: { onChange?: (v: unknown) => void }) {
  const [uploading, setUploading] = React.useState(false);
  useUploadingSignal(uploading);
  return (
    <div>
      <button type="button" data-testid="start-upload" onClick={() => setUploading(true)}>
        start
      </button>
      <button
        type="button"
        data-testid="finish-upload"
        onClick={() => {
          onChange?.('file_123');
          setUploading(false);
        }}
      >
        finish
      </button>
    </div>
  );
}

beforeAll(() => {
  ComponentRegistry.register('file', FakeUploadWidget as any, { namespace: 'field' });
});
afterAll(() => {
  // Put the real lazy entry back: the registry is shared by every test in this
  // worker, and a leaked stub would shadow `field:file` for all of them.
  registerAllFields();
});

const objectSchema = {
  name: 'o',
  fields: {
    name: { type: 'text', label: 'Name' },
    attachment: { type: 'file', label: 'Attachment' },
  },
};

function makeDataSource() {
  const created: Record<string, any>[] = [];
  return {
    created,
    ds: {
      getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
      create: vi.fn(async (_o: string, data: Record<string, any>) => {
        created.push(data);
        return { id: 'r1', ...data };
      }),
      update: vi.fn(),
      findOne: vi.fn(),
      find: vi.fn().mockResolvedValue([]),
    } as any,
  };
}

const UPLOADING_LABEL = 'Uploading…';
const REASON = 'Wait for the upload to finish before saving.';

/**
 * Let a submit that WAS accepted reach the adapter before asserting that none
 * was. The submit path is async (react-hook-form → the host's handler → the
 * adapter), so asserting straight after the click would pass on the defect too
 * — the write simply would not have landed yet. This is the flush, not a
 * timeout papering over a race: on the defect the record IS written and this
 * wait is what lets the row see it.
 */
async function settleSubmit(ms = 50) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

describe('record form — save while an upload is in flight (objectui#10166)', () => {
  it('stores nothing mid-upload and the attachment once it resolves (ObjectForm)', async () => {
    const { created, ds } = makeDataSource();
    render(
      <ObjectForm
        schema={{
          type: 'object-form',
          objectName: 'o',
          mode: 'create',
          fields: ['name', 'attachment'],
        } as any}
        dataSource={ds}
      />,
    );
    const save = () => screen.getByRole('button', { name: /Create|Uploading/ });
    await screen.findByTestId('start-upload');

    // ── Leg A: the SAME save gesture, issued while the upload is pending.
    // The STORED VALUE is asserted first and on its own, so this row fails on
    // the write and not merely on a missing affordance.
    fireEvent.click(screen.getByTestId('start-upload'));
    fireEvent.click(save());
    await settleSubmit();
    expect(created).toEqual([]);
    expect(ds.create).not.toHaveBeenCalled();

    // The affordance says WHY, in words — not merely "nothing happened".
    expect(screen.getByTestId('upload-in-flight-notice').textContent).toBe(REASON);
    expect(save().textContent).toContain(UPLOADING_LABEL);

    // ── Leg B: the same gesture after the upload resolves.
    fireEvent.click(screen.getByTestId('finish-upload'));
    await waitFor(() => expect(screen.queryByTestId('upload-in-flight-notice')).toBeNull());
    fireEvent.click(save());

    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    // The differential, as one statement: ONE record reached the adapter across
    // both gestures, and it carries the file the user picked. A mid-upload write
    // shows up here as a second, attachment-less row — which is the defect, and
    // which no weakening of the rows above can hide.
    expect(created).toHaveLength(1);
    expect(created[0].attachment).toBe('file_123');
    expect(created.every((r) => r.attachment === 'file_123')).toBe(true);
  });

  it('disables Save and names the reason while uploading (ModalForm footer)', async () => {
    const { created, ds } = makeDataSource();
    render(
      <ModalForm
        schema={{
          type: 'object-modal-form',
          objectName: 'o',
          mode: 'create',
          open: true,
          fields: ['name', 'attachment'],
        } as any}
        dataSource={ds}
      />,
    );
    await screen.findByTestId('start-upload');
    const save = () => screen.getByRole('button', { name: /Create|Uploading/ });

    expect(save()).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('start-upload'));
    // Again the stored value first: the save gesture mid-upload writes nothing.
    fireEvent.click(save());
    await settleSubmit();
    expect(created).toEqual([]);

    await waitFor(() => expect(save()).toBeDisabled());
    expect(screen.getByTestId('upload-in-flight-notice').textContent).toBe(REASON);
    expect(save().textContent).toContain(UPLOADING_LABEL);

    fireEvent.click(screen.getByTestId('finish-upload'));
    await waitFor(() => expect(save()).not.toBeDisabled());
    expect(screen.queryByTestId('upload-in-flight-notice')).toBeNull();
  });

  /**
   * Every remaining submit owner in this package, one row each. The gate is one
   * mechanism, but the rows are not a formality: each host reaches it by a
   * different route — two through the `form` node renderer's button, one
   * through a step's final commit, one through an action bar that drives a
   * button-less child form, one through a nested `ObjectForm` it does not own.
   * A host wired without a pin would be a claim nothing re-derives.
   */
  it.each([
    ['SplitForm', SplitForm as any, { type: 'object-split-form', sections: [{ name: 's1', label: 'Main', fields: ['name', 'attachment'] }] }],
    ['TabbedForm', TabbedForm as any, { type: 'object-tabbed-form', sections: [{ name: 's1', label: 'Main', fields: ['name', 'attachment'] }] }],
    ['DrawerForm', DrawerForm as any, { type: 'object-drawer-form', open: true, fields: ['name', 'attachment'] }],
  ])('stores nothing mid-upload and the attachment once it resolves (%s)', async (_name, Host, extra) => {
    const { created, ds } = makeDataSource();
    render(<Host schema={{ objectName: 'o', mode: 'create', ...extra } as any} dataSource={ds} />);
    await screen.findByTestId('start-upload');
    const save = () => screen.getByRole('button', { name: /Create|Uploading/ });

    fireEvent.click(screen.getByTestId('start-upload'));
    fireEvent.click(save());
    await settleSubmit();
    expect(created).toEqual([]);
    expect(screen.getByTestId('upload-in-flight-notice').textContent).toBe(REASON);
    expect(save().textContent).toContain(UPLOADING_LABEL);

    fireEvent.click(screen.getByTestId('finish-upload'));
    await waitFor(() => expect(screen.queryByTestId('upload-in-flight-notice')).toBeNull());
    fireEvent.click(save());

    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    expect(created).toHaveLength(1);
    expect(created[0].attachment).toBe('file_123');
    expect(created.every((r) => r.attachment === 'file_123')).toBe(true);
  });

  /**
   * ⚠️ This row pins the FINAL COMMIT only, for an upload on the LAST step.
   * `Next` is not gated — step navigation writes nothing. An upload started on
   * an EARLIER step and still in flight when the user presses Next is
   * objectui#10180, pinned in `WizardForm.nextMidUpload.test.tsx`: leaving the
   * step unmounts the widget, and the gate used to lose sight of the upload
   * with it, so Create wrote the record without the file.
   */
  it('refuses the final commit while an upload on the last step is in flight (WizardForm)', async () => {
    const { created, ds } = makeDataSource();
    render(
      <WizardForm
        schema={{
          type: 'object-wizard-form',
          objectName: 'o',
          mode: 'create',
          sections: [
            { name: 's1', label: 'One', fields: ['name'] },
            { name: 's2', label: 'Two', fields: ['attachment'] },
          ],
        } as any}
        dataSource={ds}
      />,
    );
    // Step 1 → Next, with nothing uploading: this only gets the wizard to the
    // step that carries the file field.
    fireEvent.click(await screen.findByRole('button', { name: /Next/ }));
    await screen.findByTestId('start-upload');

    const create = () => screen.getByRole('button', { name: /Create|Uploading/ });
    fireEvent.click(screen.getByTestId('start-upload'));
    fireEvent.click(create());
    await settleSubmit();
    expect(created).toEqual([]);
    await waitFor(() => expect(create()).toBeDisabled());
    expect(screen.getByTestId('upload-in-flight-notice').textContent).toBe(REASON);

    fireEvent.click(screen.getByTestId('finish-upload'));
    await waitFor(() => expect(create()).not.toBeDisabled());
    fireEvent.click(create());
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    expect(created[0].attachment).toBe('file_123');
  });

  it('gates the atomic Save on an upload in the PARENT fields (MasterDetailForm)', async () => {
    const { created, ds } = makeDataSource();
    render(
      <MasterDetailForm
        schema={{
          type: 'object-master-detail-form',
          objectName: 'o',
          mode: 'create',
          fields: ['name', 'attachment'],
          details: [],
        } as any}
        dataSource={ds}
      />,
    );
    await screen.findByTestId('start-upload');
    const save = () => screen.getByTestId('md-form-submit');

    fireEvent.click(screen.getByTestId('start-upload'));
    fireEvent.click(save());
    // A longer settle than the other rows, and the reason is this host's: the
    // action bar drives the parent form through `requestSubmit()` deferred into
    // a macrotask, so a write that WAS accepted lands a beat later than a
    // direct submit. Too short a wait here would let the row pass on the defect.
    await settleSubmit(400);
    expect(created).toEqual([]);
    // The parent fields are a nested ObjectForm with a scope of its own; this
    // is what proves the chain reaches THIS host's action bar, the control that
    // persists parent and children as one batch.
    await waitFor(() => expect(save()).toBeDisabled());
    expect(screen.getAllByTestId('upload-in-flight-notice').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId('finish-upload'));
    await waitFor(() => expect(save()).not.toBeDisabled());
  });

  it('is gated through the ObjectForm it hosts (EmbeddableForm)', async () => {
    // EmbeddableForm owns no Save of its own — it renders an ObjectForm and
    // takes its submit. The row exists because "covered transitively" is a
    // claim, and an untested one would be indistinguishable from an oversight
    // if that composition ever changed.
    const { created, ds } = makeDataSource();
    render(
      <EmbeddableForm
        config={{
          formId: 'f1',
          objectName: 'o',
          fields: ['name', 'attachment'],
          texts: { submit: 'Create' },
          // Without this the public-form min-fill-time gate refuses every
          // submission a test can issue, and the stored-value assertions below
          // would pass on the defect for a reason that has nothing to do with
          // uploads. Turned off so the write path is genuinely reachable.
          minFillTime: 0,
        } as any}
        dataSource={ds}
      />,
    );
    await screen.findByTestId('start-upload');
    const save = () => screen.getByRole('button', { name: /Create|Uploading/ });

    fireEvent.click(screen.getByTestId('start-upload'));
    fireEvent.click(save());
    await settleSubmit(400);
    // `dataSource.create` is this host's OWN write — the ObjectForm it hosts is
    // handed a neutralised adapter and only `EmbeddableForm.handleSubmit` talks
    // to the real one, so this asserts the submission, not the inner form.
    expect(created).toEqual([]);
    expect(ds.create).not.toHaveBeenCalled();
    expect(screen.getByTestId('upload-in-flight-notice').textContent).toBe(REASON);

    fireEvent.click(screen.getByTestId('finish-upload'));
    await waitFor(() => expect(screen.queryByTestId('upload-in-flight-notice')).toBeNull());
    fireEvent.click(save());
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    expect(created[0].attachment).toBe('file_123');
  });
});
