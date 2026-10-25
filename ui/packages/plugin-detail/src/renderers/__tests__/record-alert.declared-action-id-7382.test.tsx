/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:alert`'s CTA lookup goes through the shared
 * `resolveDeclaredActionIds` (objectui#7382) — the one function
 * `page:header` and `record:quick_actions` call — instead of a third
 * hand-written `find` by name.
 *
 * What these pins hold, row by row:
 *   (a) a known `actionName` renders the CTA with the SAME definition the
 *       object registers — handed to the engine by reference, and the first
 *       registration wins on a duplicate name, as `Array#find` did;
 *   (b) an unknown `actionName` renders no CTA and hands the engine nothing
 *       (unchanged behaviour — the misspelling is refused at authoring time,
 *       objectstack#20105, not at runtime);
 *   (c) no `actionName` asks the metadata layer for nothing — the
 *       `needsMeta` short-circuit;
 *   (d) an OBJECT at `actionName` renders no CTA and never reaches the
 *       engine: the shared function's inline-object arm is not a way to
 *       author an executable action on this surface;
 *   (e) object metadata whose `actions` is not an array renders the banner
 *       with no CTA rather than throwing.
 *
 * Only the DATA layer is doubled — record context, the metadata read, the
 * action engine — and each double RECORDS what it was asked, because the
 * questions here are "what name was read" and "what definition was handed
 * over", not "what did the stub return". The predicate entry and the rest of
 * `@object-ui/react` are the real ones, as in `record-alert.test.tsx`.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const mockExecuteAction = vi.fn(async () => ({ success: true }));

const stub = {
  recordCtx: undefined as Record<string, unknown> | undefined,
  metadataItem: undefined as { actions?: unknown } | undefined,
  /** Every name `useMetadataItem('object', name)` was called with, in order. */
  metadataReads: [] as Array<string | null>,
  /** Every `actions` array handed to `useActionEngine`, in order. */
  engineActions: [] as unknown[][],
};

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    useRecordContext: () => stub.recordCtx,
    useMetadataItem: (_type: string, name: string | null) => {
      stub.metadataReads.push(name);
      return { item: name ? stub.metadataItem : null, loading: false, error: null };
    },
    useActionEngine: (opts: { actions?: unknown[] }) => {
      stub.engineActions.push(Array.isArray(opts?.actions) ? opts.actions : []);
      return {
        executeAction: mockExecuteAction,
        getActionsForLocation: () => [],
        getBulkActions: () => [],
        handleShortcut: async () => null,
        engine: {},
      };
    },
  };
});

vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Alert: ({ children, className, role }: { children?: React.ReactNode; className?: string; role?: string }) => (
    <div data-testid="alert" role={role} className={className}>
      {children}
    </div>
  ),
  AlertTitle: ({ children }: { children?: React.ReactNode }) => <h5 data-testid="alert-title">{children}</h5>,
  AlertDescription: ({ children }: { children?: React.ReactNode }) => <div data-testid="alert-body">{children}</div>,
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button data-testid="alert-cta" onClick={onClick}>
      {children}
    </button>
  ),
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
  LazyIcon: ({ name }: { name?: string }) => <svg data-testid="alert-icon" data-name={name} />,
}));

import { RecordAlertRenderer } from '../record-alert';

const RESEND = {
  name: 'resend_verification_email',
  label: 'Resend Verification Email',
  type: 'api',
  target: '/api/v1/auth/send-verification-email',
};
/** A second registration under the SAME name — never the one that renders. */
const RESEND_SHADOWED = { ...RESEND, label: 'Shadowed Duplicate' };

/** Every definition any render handed to the engine, flattened. */
const handedToEngine = (): unknown[] => stub.engineActions.flat();

beforeEach(() => {
  cleanup();
  mockExecuteAction.mockClear();
  stub.recordCtx = {
    data: { id: 'rec_1', name: 'Acme' },
    objectName: 'sys_user',
    recordId: 'rec_1',
  };
  stub.metadataItem = { actions: [RESEND, RESEND_SHADOWED] };
  stub.metadataReads = [];
  stub.engineActions = [];
});

describe('record:alert CTA — resolved through resolveDeclaredActionIds (objectui#7382)', () => {
  it('(a) a known actionName renders the CTA with the registered definition, first registration winning', () => {
    render(
      <RecordAlertRenderer
        schema={{ properties: { title: 'Verify', action: { actionName: 'resend_verification_email' } } }}
      />,
    );
    const cta = screen.getByTestId('alert-cta');
    expect(cta.textContent).toBe('Resend Verification Email');
    // The object's own definition, by reference — not a copy, not the
    // duplicate registered after it.
    const last = stub.engineActions[stub.engineActions.length - 1];
    expect(last).toHaveLength(1);
    expect(last[0]).toBe(RESEND);
    expect(handedToEngine()).not.toContain(RESEND_SHADOWED);

    fireEvent.click(cta);
    expect(mockExecuteAction).toHaveBeenCalledTimes(1);
    expect(mockExecuteAction).toHaveBeenCalledWith('resend_verification_email');
  });

  it('(b) an unknown actionName renders no CTA and hands the engine nothing', () => {
    render(
      <RecordAlertRenderer schema={{ properties: { title: 'Verify', action: { actionName: 'resend_verifcation_email' } } }} />,
    );
    // The banner itself still renders — "no CTA" is about the id, not about
    // the alert failing to draw.
    expect(screen.getByTestId('alert-title').textContent).toBe('Verify');
    expect(screen.queryByTestId('alert-cta')).toBeNull();
    // The lookup WAS asked for (so the miss is the id's, not a skipped read).
    expect(stub.metadataReads).toContain('sys_user');
    expect(handedToEngine()).toEqual([]);
    expect(mockExecuteAction).not.toHaveBeenCalled();
  });

  it('(c) no actionName asks the metadata layer for nothing — and the control with one does', () => {
    render(<RecordAlertRenderer schema={{ properties: { title: 'Plain' } }} />);
    expect(screen.getByTestId('alert-title').textContent).toBe('Plain');
    expect(screen.queryByTestId('alert-cta')).toBeNull();
    // Called every render (Rules of Hooks), but always with the documented
    // `null` no-op name.
    expect(stub.metadataReads.length).toBeGreaterThan(0);
    expect(stub.metadataReads.every((n) => n === null)).toBe(true);

    // An empty `actionName` is "no CTA" too, byte-for-byte as `needsMeta` reads it.
    cleanup();
    stub.metadataReads = [];
    render(<RecordAlertRenderer schema={{ properties: { title: 'Blank', action: { actionName: '' } } }} />);
    expect(stub.metadataReads.every((n) => n === null)).toBe(true);
    expect(screen.queryByTestId('alert-cta')).toBeNull();

    // Live control: the same double DOES record a real read when a CTA is
    // requested, so the two `null`-only readings above are not a double that
    // never records anything.
    cleanup();
    stub.metadataReads = [];
    render(
      <RecordAlertRenderer schema={{ properties: { title: 'Cta', action: { actionName: 'resend_verification_email' } } }} />,
    );
    expect(stub.metadataReads).toContain('sys_user');
  });

  it('(d) an object at actionName renders no CTA and never reaches the engine', () => {
    // A complete, executable-looking definition authored where a NAME
    // belongs. Nothing on the object declares it.
    const inline = {
      name: 'inline_injected',
      label: 'Injected Inline',
      type: 'url',
      target: 'https://example.invalid/',
      locations: ['record_header'],
    };
    render(
      <RecordAlertRenderer schema={{ properties: { title: 'Verify', action: { actionName: inline as unknown as string } } }} />,
    );
    expect(screen.getByTestId('alert-title').textContent).toBe('Verify');
    expect(screen.queryByTestId('alert-cta')).toBeNull();
    expect(screen.queryByText('Injected Inline')).toBeNull();
    expect(handedToEngine()).not.toContain(inline);
    expect(handedToEngine()).toEqual([]);
    expect(mockExecuteAction).not.toHaveBeenCalled();
  });

  it('(e) object metadata whose `actions` is not an array renders the banner without a CTA instead of throwing', () => {
    // Off-contract metadata (the object's `actions` is an array). The old
    // hand-written `find` called `.find` on whatever was there, so a map-shaped
    // `actions` threw inside the banner's render.
    stub.metadataItem = { actions: { resend_verification_email: RESEND } };
    render(
      <RecordAlertRenderer schema={{ properties: { title: 'Verify', action: { actionName: 'resend_verification_email' } } }} />,
    );
    expect(screen.getByTestId('alert-title').textContent).toBe('Verify');
    expect(screen.queryByTestId('alert-cta')).toBeNull();
    expect(handedToEngine()).toEqual([]);
  });
});
