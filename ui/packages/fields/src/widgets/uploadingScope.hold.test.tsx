/**
 * The upload-LIFETIME half of the uploading scope (objectui#10180).
 *
 * `uploadingScope.test.tsx` pins the mount-bound report every widget publishes
 * through `useUploadingSignal`, including its unmount release. That release is
 * right for the widget and wrong for the upload: `FileField` does not abort an
 * upload when it unmounts, and the settle still hands the value to the form.
 * So a widget unmounted mid-upload — a wizard step the user left — used to take
 * the scope's "uploading" with it while the file was still on its way, and the
 * host's gate let a save through that wrote the record without it.
 *
 * These rows drive the shipping `FileField` / `ImageField` through their real
 * file input; only the upload transport is faked, so the in-flight window is
 * deterministic. The release rows matter as much as the hold rows: a hold that
 * can be taken and not given back wedges the host's Save.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { UploadProvider } from '@object-ui/providers';
import { useUploadingScope, UploadingScopeProvider } from './uploadingScope.js';
import { FileField } from './FileField.js';
import { ImageField } from './ImageField.js';

function Host({ children }: { children: React.ReactNode }) {
  const scope = useUploadingScope();
  return (
    <>
      <span data-testid="any">{String(scope.anyUploading)}</span>
      <UploadingScopeProvider scope={scope}>{children}</UploadingScopeProvider>
    </>
  );
}

const any = () => screen.getByTestId('any').textContent;

/** One upload that stays in flight until `settle()` or `fail()`. */
function controlledUpload() {
  let settle!: () => void;
  let fail!: (e: Error) => void;
  const gate = new Promise<void>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  const adapter = {
    name: 'controlled',
    upload: vi.fn(async (f: File | Blob) => {
      await gate;
      return {
        url: 'https://cdn.example/x',
        name: (f as File).name ?? 'upload',
        size: f.size,
        mimeType: f.type,
        meta: { fileId: 'file_123' },
      };
    }),
  };
  return { adapter, settle, fail };
}

const WIDGETS = [
  ['FileField', FileField],
  ['ImageField', ImageField],
] as const;

function view(
  Widget: React.ComponentType<any>,
  adapter: unknown,
  onChange: (v: unknown) => void,
  mounted: boolean,
) {
  return (
    <UploadProvider adapter={adapter as any}>
      <Host>
        {mounted ? <Widget value={null} onChange={onChange} field={{ name: 'f', type: 'file' }} /> : null}
      </Host>
    </UploadProvider>
  );
}

async function pick() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () => {
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } });
  });
}

describe('uploading scope — the upload outlives its widget (objectui#10180)', () => {
  it.each(WIDGETS)('%s: stays uploading after an unmount until the upload settles', async (_n, Widget) => {
    const { adapter, settle } = controlledUpload();
    const onChange = vi.fn();
    const { rerender } = render(view(Widget, adapter, onChange, true));
    expect(any()).toBe('false');

    await pick();
    await waitFor(() => expect(any()).toBe('true'));

    // The widget goes — a wizard step left behind. Its mount-bound report is
    // released (that release is pinned in `uploadingScope.test.tsx`), but the
    // upload is still running, so the scope must still say so.
    rerender(view(Widget, adapter, onChange, false));
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(any()).toBe('true');

    // The settle hands the value over and ONLY THEN releases the scope.
    await act(async () => {
      settle();
    });
    await waitFor(() => expect(any()).toBe('false'));
    expect(onChange).toHaveBeenCalledWith('file_123');
  });

  // FileField only: ImageField's pick handler has no `catch`, so a failed
  // upload leaves it as an unhandled rejection and this row would be measuring
  // that instead. Its `finally` releases the hold on the same path.
  it.each([WIDGETS[0]])('%s: a FAILED upload after an unmount releases the scope too', async (_n, Widget) => {
    const { adapter, fail } = controlledUpload();
    const { rerender } = render(view(Widget, adapter, vi.fn(), true));
    await pick();
    await waitFor(() => expect(any()).toBe('true'));
    rerender(view(Widget, adapter, vi.fn(), false));
    expect(any()).toBe('true');

    await act(async () => {
      fail(new Error('network down'));
    });
    // A hold that a failure could not give back would wedge Save for good.
    await waitFor(() => expect(any()).toBe('false'));
  });

  it.each(WIDGETS)('%s: mounted throughout, the scope clears when the upload settles', async (_n, Widget) => {
    const { adapter, settle } = controlledUpload();
    const onChange = vi.fn();
    render(view(Widget, adapter, onChange, true));
    await pick();
    await waitFor(() => expect(any()).toBe('true'));
    await act(async () => {
      settle();
    });
    // Both entries — the widget's report and the upload's hold — end together.
    await waitFor(() => expect(any()).toBe('false'));
    expect(onChange).toHaveBeenCalledWith('file_123');
  });
});
