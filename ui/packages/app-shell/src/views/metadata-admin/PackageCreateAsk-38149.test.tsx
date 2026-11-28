// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#38149 — the create ask itself (`PackageCreateAsk.tsx`).
 *
 * Pinned:
 *  - the list holds what the server says this caller may write, never a
 *    kernel package, by name;
 *  - the heuristic pick is pre-selected only when the list holds it, and
 *    Continue waits for a choice;
 *  - "New package…" opens the Packages page's create dialog, and the package
 *    it creates is the answer; closing that dialog without one returns to the
 *    ask;
 *  - Cancel answers `null`, once;
 *  - `usePackageCreateAsk`: a second ask answers the first `null`.
 *
 * The create dialog is a stub here (its own tests are
 * `CreatePackageDialog.namespace.test.tsx` and its neighbours): the subject is
 * the ask's wiring around it.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { PkgEntry } from '../studio-design/packages-io';

vi.mock('./PackagesPage.js', () => ({
  CreatePackageDialog: ({ open, onOpenChange, onCreated }: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    onCreated: (id: string) => void;
  }) =>
    open ? (
      <div data-testid="create-package-stub">
        <button type="button" onClick={() => onCreated('app.fresh')}>create</button>
        <button type="button" onClick={() => onOpenChange(false)}>close</button>
      </div>
    ) : null,
}));

import { PackageCreateAskDialog, packageAskOptions, usePackageCreateAsk } from './PackageCreateAsk';

afterEach(() => cleanup());

const entry = (id: string, name: string, extra: Partial<PkgEntry> = {}): PkgEntry =>
  ({ id, name, writable: true, ...extra }) as PkgEntry;

const LIST: PkgEntry[] = [
  entry('app.zulu', 'Zulu'),
  entry('app.alpha', 'Alpha'),
  entry('com.vendor.crm', 'Vendor CRM', { writable: false }),
  entry('com.objectstack.setup', 'Setup', { kernel: true }),
];

function open(props: Partial<React.ComponentProps<typeof PackageCreateAskDialog>> = {}) {
  const onAnswer = vi.fn();
  render(<PackageCreateAskDialog open onAnswer={onAnswer} readPackages={async () => LIST} {...props} />);
  return onAnswer;
}

describe('packageAskOptions: the server verdict, kernel packages out, by name (objectstack#38149)', () => {
  it('keeps the writable, drops the read-only and the kernel, and sorts by name', () => {
    expect(packageAskOptions(LIST).map((p) => p.id)).toEqual(['app.alpha', 'app.zulu']);
  });
});

describe('PackageCreateAskDialog (objectstack#38149)', () => {
  it('offers the writable packages only; Continue waits for a choice, then answers it', async () => {
    const onAnswer = open();
    const dialog = await screen.findByTestId('package-create-ask');
    await within(dialog).findByTestId('package-create-ask-option-app.alpha');
    expect(within(dialog).queryByTestId('package-create-ask-option-com.vendor.crm')).toBeNull();
    expect(within(dialog).queryByTestId('package-create-ask-option-com.objectstack.setup')).toBeNull();
    expect(within(dialog).getByTestId('package-create-ask-continue')).toBeDisabled();
    fireEvent.click(within(dialog).getByTestId('package-create-ask-option-app.zulu'));
    fireEvent.click(within(dialog).getByTestId('package-create-ask-continue'));
    expect(onAnswer).toHaveBeenCalledWith('app.zulu');
  });

  it('pre-selects the heuristic pick the list holds, and never one it does not', async () => {
    open({ preselect: 'app.zulu' });
    expect(await screen.findByTestId('package-create-ask-option-app.zulu')).toHaveAttribute('data-state', 'checked');
    cleanup();
    open({ preselect: 'com.vendor.crm' });
    await screen.findByTestId('package-create-ask-option-app.alpha');
    expect(screen.getByTestId('package-create-ask-continue')).toBeDisabled();
  });

  it('Cancel answers null, once', async () => {
    const onAnswer = open();
    fireEvent.click(await screen.findByTestId('package-create-ask-cancel'));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith(null);
  });

  it('"New package…" opens the create dialog, and the package it creates is the answer', async () => {
    const onAnswer = open();
    fireEvent.click(await screen.findByTestId('package-create-ask-new'));
    const stub = await screen.findByTestId('create-package-stub');
    expect(screen.queryByTestId('package-create-ask')).toBeNull();
    fireEvent.click(within(stub).getByText('create'));
    expect(onAnswer).toHaveBeenCalledWith('app.fresh');
  });

  it('closing the create dialog without a package returns to the ask, answering nothing', async () => {
    const onAnswer = open();
    fireEvent.click(await screen.findByTestId('package-create-ask-new'));
    fireEvent.click(within(await screen.findByTestId('create-package-stub')).getByText('close'));
    expect(await screen.findByTestId('package-create-ask')).toBeInTheDocument();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('a list that cannot be read says so, and offers no package', async () => {
    open({ readPackages: async () => { throw new Error('HTTP 503'); } });
    expect(await screen.findByTestId('package-create-ask-failed')).toHaveTextContent('HTTP 503');
    expect(screen.getByTestId('package-create-ask-continue')).toBeDisabled();
  });
});

describe('usePackageCreateAsk (objectstack#38149)', () => {
  it('a second ask answers the first null', async () => {
    const { result } = renderHook(() => usePackageCreateAsk());
    let first: Promise<string | null> | undefined;
    act(() => {
      first = result.current.ask();
    });
    act(() => {
      void result.current.ask();
    });
    await waitFor(async () => expect(await first).toBeNull());
  });
});
