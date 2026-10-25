/**
 * Leaving a wizard step while its upload is in flight must not lose the file
 * (objectui#10180).
 *
 * ## The defect, as measured on the tree this fix landed on
 *
 * The user picks a file on step 1, presses Next before the upload settles,
 * fills the last step and presses Create. The record was written WITHOUT the
 * attachment and the wizard reported success.
 *
 * The file itself was never the casualty: `FileField` does not abort its upload
 * when the step unmounts, and the settle still reaches the form's `onChange`,
 * which accepts it (react-hook-form re-registers a field it no longer tracks).
 * A Create pressed AFTER the settle already stored the fileId. What the unmount
 * ended was the widget's REPORT: leaving the step released its entry in the
 * uploading scope, so the final-commit gate objectui#10166 put on `WizardForm`
 * read `false` while the file was still on its way — Create was enabled and
 * labelled "Create", and pressing it in that window wrote the record without
 * the file. The repair is on the producer side, in `@object-ui/fields`: the
 * upload widgets hold the scope for the upload's own lifetime, which outlasts
 * the step (`useUploadingScopeHold`).
 *
 * ## Why this is a DIFFERENTIAL on the stored value
 *
 * Same shape as `uploadInFlightSave.test.tsx`, for the same reason: the defect
 * is a success, so "no error" passes on it. Each row issues the SAME final
 * gesture twice — mid-upload, then after the settle — and asserts the STORED
 * VALUE first, before any affordance, so it fails on the write and not on a
 * label. It closes on the invariant no weakening can satisfy on the defect:
 * exactly one record reached the adapter across both gestures, and it carries
 * the file the user picked on step 1.
 *
 * ## What is real and what is faked
 *
 * Only the upload TRANSPORT is faked — `useUpload` answers an upload whose
 * promise this test settles — because that is what makes the mid-upload window
 * deterministic. It is swapped with `vi.mock` rather than mounted as an
 * `UploadProvider` because `@object-ui/providers` is not a dependency of this
 * package: the widgets reach it through `@object-ui/fields`, and importing it
 * here would be an undeclared import. The rest of that module is the real one.
 * The widgets are the shipping `FileField` / `ImageField`, driven through their
 * real file input; the form renderer, react-hook-form and the wizard are real.
 * Both widgets are registered directly rather than through their lazy entries
 * so no module load races the assertions, and the lazy entries are put back
 * afterwards because the registry is shared per worker.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { registerAllFields, FileField, ImageField } from '@object-ui/fields';
import { WizardForm } from './WizardForm';

/** The upload the current row installs; see `deferredUpload`. */
const transport = vi.hoisted(() => ({
  upload: (_f: File | Blob): Promise<unknown> => Promise.reject(new Error('no upload installed')),
}));
vi.mock('@object-ui/providers', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useUpload: () => ({
      upload: (f: File | Blob) => transport.upload(f),
      adapter: { name: 'deferred', upload: (f: File | Blob) => transport.upload(f) },
    }),
  };
});

registerAllFields();

beforeAll(() => {
  ComponentRegistry.register('file', FileField as any, { namespace: 'field' });
  ComponentRegistry.register('image', ImageField as any, { namespace: 'field' });
});
afterAll(() => {
  registerAllFields();
});

const objectSchema = {
  name: 'o',
  fields: {
    name: { type: 'text', label: 'Name' },
    note: { type: 'text', label: 'Note' },
    attachment: { type: 'file', label: 'Attachment' },
    photo: { type: 'image', label: 'Photo' },
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

/**
 * Install an upload that stays in flight until `settle()`. It surfaces a
 * `sys_file` id, so the stored value is the bare fileId.
 */
function deferredUpload() {
  let settle!: () => void;
  const gate = new Promise<void>((r) => {
    settle = r;
  });
  const upload = vi.fn(async (f: File | Blob) => {
    await gate;
    return {
      url: 'https://cdn.example/x',
      name: (f as File).name ?? 'upload',
      size: f.size,
      mimeType: f.type,
      meta: { fileId: 'file_123' },
    };
  });
  transport.upload = upload;
  return { upload, settle };
}

const UPLOADING_LABEL = 'Uploading…';
const REASON = 'Wait for the upload to finish before saving.';

/**
 * Let a submit that WAS accepted reach the adapter before asserting that none
 * was — the submit path is async, so asserting straight after the click would
 * pass on the defect too. On the defect the record IS written, and this flush
 * is what lets the row see it.
 */
async function settleSubmit(ms = 50) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

describe('WizardForm — Next pressed while an upload is in flight (objectui#10180)', () => {
  it.each([
    ['file', 'attachment'],
    ['image', 'photo'],
  ])('keeps the %s picked on step 1 and stores it on Create', async (_kind, fieldName) => {
    const { created, ds } = makeDataSource();
    const { upload, settle } = deferredUpload();
    render(
      <WizardForm
        schema={{
          type: 'object-form',
          formType: 'wizard',
          objectName: 'o',
          mode: 'create',
          sections: [
            { name: 's1', label: 'One', fields: ['name', fieldName] },
            { name: 's2', label: 'Two', fields: ['note'] },
          ],
        } as any}
        dataSource={ds}
      />,
    );

    // ── Step 1: a value typed, a file picked through the widget's real input,
    // and Next pressed while that upload is still in flight.
    await screen.findByRole('button', { name: /Next/ });
    const fileInput = await waitFor(() => {
      const el = document.querySelector('input[type="file"]');
      if (!el) throw new Error('the upload widget has not rendered its file input yet');
      return el as HTMLInputElement;
    });
    fireEvent.change(document.querySelector('input[name="name"]') as HTMLInputElement, {
      target: { value: 'Alice' },
    });
    fireEvent.change(fileInput, {
      target: { files: [new File(['x'], 'contract.png', { type: 'image/png' })] },
    });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));

    // Step 2 is showing and step 1's widget is gone — the unmount this card is
    // about has happened, and the upload has not settled.
    await waitFor(() => expect(document.querySelector('input[name="note"]')).not.toBeNull());
    expect(document.querySelector('input[type="file"]')).toBeNull();
    const create = () => screen.getByRole('button', { name: /Create|Uploading/ });

    // ── Leg A: the final gesture, issued while step 1's upload is in flight.
    // Stored value first: nothing may be written yet.
    fireEvent.click(create());
    await settleSubmit();
    expect(created).toEqual([]);
    expect(ds.create).not.toHaveBeenCalled();
    // …and the wizard says why, with the gate objectui#10166 already gave it.
    expect(create().textContent).toContain(UPLOADING_LABEL);
    expect(create()).toBeDisabled();
    expect(screen.getByTestId('upload-in-flight-notice').textContent).toBe(REASON);

    // ── Leg B: the same gesture once the upload settles.
    await act(async () => {
      settle();
    });
    await waitFor(() => expect(screen.queryByTestId('upload-in-flight-notice')).toBeNull());
    fireEvent.click(create());
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));

    // The differential as one statement: ONE record across both gestures, and
    // it carries the file picked on step 1 next to the value typed there. A
    // mid-upload write shows up here as an extra, file-less row.
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ name: 'Alice', [fieldName]: 'file_123' });
    expect(created.every((r) => r[fieldName] === 'file_123')).toBe(true);
  });
});
