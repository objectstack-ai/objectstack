// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * WorkspaceSwitcher inside the ObjectStack mobile shell.
 *
 * When the shell's bridge (`window.ObjectStackNative`, read through
 * `@object-ui/mobile`) announces `showConnectionSwitcher`, the header's
 * organization button opens the shell's native switcher and the web menu does
 * not open. With no bridge, or a bridge without that capability, the web menu
 * opens exactly as before. The dropdown is the real one, opened by a real
 * click, so "the web menu opens" is observed, not assumed.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => vi.fn(),
}));

let authState: Record<string, unknown>;
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => authState,
}));

import { NATIVE_HOST_GLOBAL } from '@object-ui/mobile';
import { WorkspaceSwitcher } from '../WorkspaceSwitcher';

const ORGS = [
  { id: 'org_a', name: 'Plant A', slug: 'plant-a' },
  { id: 'org_b', name: 'Plant B', slug: 'plant-b' },
];

const BASE_METHODS = ['getPushToken', 'haptic', 'openExternal', 'navigate', 'resetServer'];

function installBridge(capabilities: string[]) {
  const showConnectionSwitcher = vi.fn(async () => null);
  (window as unknown as Record<string, unknown>)[NATIVE_HOST_GLOBAL] = {
    version: 1,
    platform: 'ios',
    appVersion: '2.1.0',
    capabilities,
    safeArea: { top: 47, bottom: 34, left: 0, right: 0 },
    has: (capability: string) => capabilities.includes(capability),
    getPushToken: vi.fn(async () => null),
    haptic: vi.fn(async () => null),
    openExternal: vi.fn(async () => null),
    navigate: vi.fn(async () => null),
    resetServer: vi.fn(async () => null),
    showConnectionSwitcher,
    ready: vi.fn(),
    routeChanged: vi.fn(),
  };
  return showConnectionSwitcher;
}

beforeEach(() => {
  delete (window as unknown as Record<string, unknown>)[NATIVE_HOST_GLOBAL];
  authState = {
    organizations: ORGS,
    activeOrganization: ORGS[0],
    switchOrganization: vi.fn(),
    getAuthConfig: vi.fn().mockResolvedValue({ features: { multiOrgEnabled: true } }),
  };
});

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>)[NATIVE_HOST_GLOBAL];
});

describe('WorkspaceSwitcher in the mobile shell', () => {
  it('with showConnectionSwitcher announced, the button opens the native switcher and no web menu', async () => {
    const showConnectionSwitcher = installBridge([...BASE_METHODS, 'showConnectionSwitcher']);
    render(<WorkspaceSwitcher />);

    const button = screen.getByTestId('workspace-switcher');
    expect(button).toHaveAttribute('data-native-switcher');
    expect(button).not.toHaveAttribute('aria-haspopup');

    await userEvent.click(button);

    expect(showConnectionSwitcher).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.queryByText('Plant B')).not.toBeInTheDocument();
    expect(authState.switchOrganization).not.toHaveBeenCalled();
  });

  it('control: with no bridge, the button opens the web organization menu', async () => {
    render(<WorkspaceSwitcher />);

    const button = screen.getByTestId('workspace-switcher');
    expect(button).not.toHaveAttribute('data-native-switcher');

    await userEvent.click(button);

    expect(await screen.findByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('Switch organization')).toBeInTheDocument();
    expect(screen.getByText('Plant B')).toBeInTheDocument();
  });

  it('control: a shell without the capability keeps the web menu and never calls the native switcher', async () => {
    const showConnectionSwitcher = installBridge(BASE_METHODS);
    render(<WorkspaceSwitcher />);

    const button = screen.getByTestId('workspace-switcher');
    expect(button).not.toHaveAttribute('data-native-switcher');

    await userEvent.click(button);

    expect(await screen.findByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('Plant B')).toBeInTheDocument();
    expect(showConnectionSwitcher).not.toHaveBeenCalled();
  });
});
