import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUploadingSignal } from './useUploadingSignal';

/**
 * useUploadingSignal — surfaces an upload widget's in-progress flips to a host
 * (ActionParamDialog blocks Confirm while a file/image param uploads). It must
 * fire only when `uploading` changes and always call the latest callback.
 */
describe('useUploadingSignal', () => {
  it('fires with the initial value on mount', () => {
    const cb = vi.fn();
    renderHook(() => useUploadingSignal(false, cb));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenLastCalledWith(false);
  });

  it('fires again only when `uploading` changes', () => {
    const cb = vi.fn();
    const { rerender } = renderHook(({ u }) => useUploadingSignal(u, cb), {
      initialProps: { u: false },
    });
    cb.mockClear();

    rerender({ u: true });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenLastCalledWith(true);

    // Same value → no extra fire.
    rerender({ u: true });
    expect(cb).toHaveBeenCalledTimes(1);

    rerender({ u: false });
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith(false);
  });

  it('always invokes the latest callback (no stale closure)', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ cb, u }) => useUploadingSignal(u, cb),
      { initialProps: { cb: first, u: false } },
    );
    // Swap the callback without changing `uploading` → no fire yet.
    rerender({ cb: second, u: false });
    expect(second).not.toHaveBeenCalled();
    // Now flip `uploading` → the NEW callback fires, not the old one.
    rerender({ cb: second, u: true });
    expect(second).toHaveBeenCalledWith(true);
    expect(first).not.toHaveBeenCalledWith(true);
  });

  it('is a no-op when no callback is provided', () => {
    expect(() => {
      const { rerender } = renderHook(({ u }) => useUploadingSignal(u), {
        initialProps: { u: false },
      });
      rerender({ u: true });
    }).not.toThrow();
  });
});
