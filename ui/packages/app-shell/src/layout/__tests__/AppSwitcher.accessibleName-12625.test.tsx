// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12625 — the app pill is a button whose accessible name carries the
 * app's name, read through the REAL dropdown trigger (no primitive mocks), so
 * a restyle that moves the label into an `aria-hidden` span, or drops the
 * `title` the glyph-only phone pill is named by, turns this red.
 */

import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: [{ name: 'hotcrm', label: 'HotCRM', icon: 'flame' }] }),
}));

import { AppSwitcher } from '../AppSwitcher';

describe('the app pill is named by the app (objectui#12625)', () => {
  it('resolves by role and the app name, and its title names the app too', () => {
    render(
      <MemoryRouter>
        <AppSwitcher activeAppName="hotcrm" onAppChange={vi.fn()} />
      </MemoryRouter>,
    );
    const pill = screen.getByRole('button', { name: /HotCRM/ });
    expect(pill).toHaveAttribute('data-testid', 'app-switcher-trigger');
    expect(pill).toHaveAttribute('title', 'HotCRM');
  });
});
