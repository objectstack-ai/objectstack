/**
 * `UploadingScope` — the AGGREGATED half of the upload-in-flight signal
 * (objectui#10166). `onUploadingChange` answers "is THIS widget uploading" to a
 * host that renders the control; the scope answers "is ANYTHING below me
 * uploading" to a host that does not, which is every record form.
 *
 * The rows that matter are the release paths. A scope that can be entered and
 * not left wedges its host's Save for the rest of the session — a worse failure
 * than the one the scope exists to fix, and one with no visible cause.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { useUploadingScope, UploadingScopeProvider } from './uploadingScope.js';
import { useUploadingSignal } from './useUploadingSignal.js';

/** A widget that publishes through the real hook, like FileField/ImageField. */
function Widget({ uploading, onUploadingChange }: { uploading: boolean; onUploadingChange?: (u: boolean) => void }) {
  useUploadingSignal(uploading, onUploadingChange);
  return null;
}

function Host({
  children,
  onAny,
}: {
  children: (scope: ReturnType<typeof useUploadingScope>) => React.ReactNode;
  onAny?: (any: boolean) => void;
}) {
  const scope = useUploadingScope();
  onAny?.(scope.anyUploading);
  return (
    <>
      <span data-testid="any">{String(scope.anyUploading)}</span>
      <UploadingScopeProvider scope={scope}>{children(scope)}</UploadingScopeProvider>
    </>
  );
}

const any = () => screen.getByTestId('any').textContent;

describe('UploadingScope', () => {
  it('is false with no widget uploading and true while one is', () => {
    const { rerender } = render(<Host>{() => <Widget uploading={false} />}</Host>);
    expect(any()).toBe('false');

    rerender(<Host>{() => <Widget uploading={true} />}</Host>);
    expect(any()).toBe('true');

    rerender(<Host>{() => <Widget uploading={false} />}</Host>);
    expect(any()).toBe('false');
  });

  it('stays true until the LAST widget settles', () => {
    const view = (a: boolean, b: boolean) => (
      <Host>
        {() => (
          <>
            <Widget uploading={a} />
            <Widget uploading={b} />
          </>
        )}
      </Host>
    );
    const { rerender } = render(view(true, true));
    expect(any()).toBe('true');
    rerender(view(false, true));
    expect(any()).toBe('true');
    rerender(view(false, false));
    expect(any()).toBe('false');
  });

  it('releases a widget that UNMOUNTS mid-upload', () => {
    const view = (mounted: boolean) => (
      <Host>{() => (mounted ? <Widget uploading={true} /> : null)}</Host>
    );
    const { rerender } = render(view(true));
    expect(any()).toBe('true');
    // A collapsing section / switched tab / deleted subform row. Without the
    // release the id would stay in the set forever and Save would never come
    // back.
    rerender(view(false));
    expect(any()).toBe('false');
  });

  it('keeps feeding the per-widget `onUploadingChange` prop unchanged', () => {
    const cb = vi.fn();
    const { rerender } = render(<Host>{() => <Widget uploading={false} onUploadingChange={cb} />}</Host>);
    expect(cb).toHaveBeenLastCalledWith(false);
    rerender(<Host>{() => <Widget uploading={true} onUploadingChange={cb} />}</Host>);
    expect(cb).toHaveBeenLastCalledWith(true);
    expect(any()).toBe('true');
  });

  it('CHAINS to an outer scope instead of shadowing it', () => {
    // The master-detail shape: an outer host whose Save writes parent AND
    // children, with an inner host (a row editor) owning a scope of its own.
    // If the inner scope shadowed, the outer Save would refuse nothing while a
    // child's attachment was still in flight — and would look gated while doing
    // it, which is worse than no gate at all.
    function Inner({ uploading }: { uploading: boolean }) {
      const scope = useUploadingScope();
      return (
        <>
          <span data-testid="inner-any">{String(scope.anyUploading)}</span>
          <UploadingScopeProvider scope={scope}>
            <Widget uploading={uploading} />
          </UploadingScopeProvider>
        </>
      );
    }
    const view = (u: boolean) => <Host>{() => <Inner uploading={u} />}</Host>;
    const { rerender } = render(view(false));
    expect(any()).toBe('false');
    expect(screen.getByTestId('inner-any').textContent).toBe('false');

    rerender(view(true));
    expect(screen.getByTestId('inner-any').textContent).toBe('true');
    // The load-bearing half: the OUTER host sees the inner form's upload.
    expect(any()).toBe('true');

    rerender(view(false));
    expect(any()).toBe('false');
  });

  it('releases the outer scope when a whole inner scope unmounts mid-upload', () => {
    function Inner() {
      const scope = useUploadingScope();
      return (
        <UploadingScopeProvider scope={scope}>
          <Widget uploading={true} />
        </UploadingScopeProvider>
      );
    }
    const view = (mounted: boolean) => <Host>{() => (mounted ? <Inner /> : null)}</Host>;
    const { rerender } = render(view(true));
    expect(any()).toBe('true');
    // A closed row editor must not wedge the parent's Save.
    rerender(view(false));
    expect(any()).toBe('false');
  });

  it('is inert for a widget with no provider above it', () => {
    // Every host on `main` before this change — the hook must not throw and
    // must not require a scope.
    expect(() => render(<Widget uploading={true} />)).not.toThrow();
  });

  it('does not re-render the host when an idle widget reports no change', () => {
    const renders: boolean[] = [];
    const { rerender } = render(
      <Host onAny={(a) => renders.push(a)}>{() => <Widget uploading={false} />}</Host>,
    );
    const before = renders.length;
    act(() => {
      rerender(<Host onAny={(a) => renders.push(a)}>{() => <Widget uploading={false} />}</Host>);
    });
    // One render for the rerender itself, and no extra render scheduled by a
    // report that changed nothing.
    expect(renders.length).toBe(before + 1);
  });
});
