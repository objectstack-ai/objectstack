/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `AppShellBranding.title` is assigned to `document.title` as given — the whole
 * title, not a suffix (objectui#6872).
 *
 * objectui#6872 is a documentation defect: the JSDoc said "suffix" while the
 * code assigns wholesale. The plausible WRONG fix is the other direction — edit
 * the code to match the comment and have `useAppShellBranding` append a product
 * name. That would double-concatenate for every caller that already composes the
 * whole string (`ConsoleLayout.tsx` passes `"App label — Product name"`), and it
 * would break two teaching surfaces that were already right to satisfy the one
 * that was wrong. This file pins the behaviour the corrected wording describes,
 * so the wording and the code cannot be reconciled in the wrong direction.
 *
 * Shape: set `document.title` to a sentinel, render `AppShell` with a known
 * `branding.title`, and assert `document.title` EQUALS that string — `toBe`, not
 * `toContain`, so an appended product name is a failure, not a superset that
 * still matches. The first test is an environment control: happy-dom must let
 * the assignment be observed at all, otherwise every later assertion would be
 * asserting about a property this environment never lets anyone write.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { AppShell, useAppShellBranding, type AppShellBranding } from '../AppShell';

const SENTINEL = 'sentinel — document.title before AppShell mounted';

/** Mounts only the hook — the actual `document.title` writer — with no shell chrome. */
function HookOnly({ branding, title }: { branding?: AppShellBranding; title?: string }) {
  useAppShellBranding(branding, title);
  return null;
}

beforeEach(() => {
  document.title = SENTINEL;
});

afterEach(() => {
  cleanup();
});

describe('environment control', () => {
  it('happy-dom lets `document.title` be written and read back', () => {
    // Without this the assertions below could all be vacuous in a DOM whose
    // `title` setter is a no-op. Measured, not assumed.
    document.title = 'probe';
    expect(document.title).toBe('probe');
    document.title = SENTINEL;
    expect(document.title).toBe(SENTINEL);
  });
});

describe('`AppShell` writes `branding.title` to `document.title` as given (objectui#6872)', () => {
  it('a bare app label stays a bare app label — nothing is appended', () => {
    render(
      <AppShell branding={{ title: 'Sales CRM' }}>
        <div>content</div>
      </AppShell>,
    );
    expect(
      document.title,
      [
        '`document.title` is not the `title` the caller passed. `AppShellBranding.title` is the',
        'WHOLE title: the caller composes the string it wants (ConsoleLayout.tsx passes',
        '"App label — Product name"). Appending here double-concatenates for every such caller.',
      ].join('\n'),
    ).toBe('Sales CRM');
  });

  it('a caller-composed "App label — Product name" passes through with exactly one separator', () => {
    render(
      <AppShell branding={{ title: 'Sales CRM — ObjectStack' }}>
        <div>content</div>
      </AppShell>,
    );
    expect(document.title).toBe('Sales CRM — ObjectStack');
    expect(document.title.split(' — ')).toHaveLength(2);
  });

  it('no `title` leaves `document.title` untouched', () => {
    render(
      <AppShell branding={{ primaryColor: '#3B82F6' }}>
        <div>content</div>
      </AppShell>,
    );
    expect(document.title).toBe(SENTINEL);
  });
});

describe('`useAppShellBranding` is the writer, and it writes the second argument as given', () => {
  it('assigns the `title` argument wholesale', () => {
    render(<HookOnly title="Hook Title" />);
    expect(document.title).toBe('Hook Title');
  });

  it('does not read `branding.title` on its own — `AppShell` is what forwards it', () => {
    // `AppShell` calls `useAppShellBranding(branding, branding?.title)`; the hook
    // itself only writes its explicit second argument. Pinned so the two halves
    // of the contract (who composes, who forwards, who writes) stay legible.
    render(<HookOnly branding={{ title: 'Not Forwarded' }} />);
    expect(document.title).toBe(SENTINEL);
  });
});
