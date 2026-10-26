// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Wiring guard for the package-namespace field (framework#2694) in the
 * spec-driven create dialog (`CreatePackageDialog` → `PackageFormDialog`): it
 * defaults to the id-derived namespace, tracks the id input until the user
 * edits it, sanitizes keystrokes to the allowed alphabet, and gates submit on a
 * valid `^[a-z][a-z0-9_]{1,19}$` value.
 *
 * The form is now rendered from the manifest spec via SchemaForm, so fields are
 * targeted by their label rather than the old hand-rolled test ids.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CreatePackageDialog } from './PackagesPage';

afterEach(cleanup);

function open() {
  render(<CreatePackageDialog open onOpenChange={vi.fn()} onCreated={vi.fn()} />);
  return {
    id: screen.getByLabelText(/package id/i) as HTMLInputElement,
    ns: screen.getByLabelText(/object namespace/i) as HTMLInputElement,
    name: screen.getByLabelText(/display name/i) as HTMLInputElement,
    submit: screen.getByTestId('package-form-submit') as HTMLButtonElement,
  };
}

describe('CreatePackageDialog — namespace field (spec form)', () => {
  it('derives the namespace from the package id and tracks it', () => {
    const { id, ns } = open();
    fireEvent.change(id, { target: { value: 'com.example.leave' } });
    expect(ns.value).toBe('leave');
    // Still tracking: change the id again.
    fireEvent.change(id, { target: { value: 'com.acme.repairs' } });
    expect(ns.value).toBe('repairs');
  });

  it('stops tracking the id once the user edits the namespace', () => {
    const { id, ns } = open();
    fireEvent.change(id, { target: { value: 'com.example.leave' } });
    fireEvent.change(ns, { target: { value: 'hr' } });
    expect(ns.value).toBe('hr');
    // A later id change must NOT clobber the user's namespace.
    fireEvent.change(id, { target: { value: 'com.acme.repairs' } });
    expect(ns.value).toBe('hr');
  });

  it('sanitizes namespace keystrokes to the allowed alphabet', () => {
    const { ns } = open();
    fireEvent.change(ns, { target: { value: 'HR Tickets!' } });
    expect(ns.value).toBe('hrtickets');
  });

  it('disables submit while the namespace is invalid, enables it when valid', () => {
    const { id, ns, name, submit } = open();
    fireEvent.change(id, { target: { value: 'com.example.leave' } });
    fireEvent.change(name, { target: { value: 'Leave' } });
    expect(submit).toBeEnabled();
    // Single char is below the 2-char minimum → invalid.
    fireEvent.change(ns, { target: { value: 'a' } });
    expect(submit).toBeDisabled();
    fireEvent.change(ns, { target: { value: 'leave' } });
    expect(submit).toBeEnabled();
  });
});
