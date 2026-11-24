// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * WorkspaceSwitcherMenu — the avatar menu's "Switch organization" submenu
 * (objectstack-ai/objectstack#34591 moved the web switcher out of the top bar).
 *
 * ADR-0105 group-posture semantics: under `group` tenancy posture the active
 * organization is only the WRITE target (reads span every organization the
 * member belongs to), so the submenu labels it "Working organization" and
 * explains the split. ADR-0105's Risks paragraph requires that write-context
 * switcher to stay reachable in group posture; the AppHeader harness
 * (`AppHeader.myOrganizations.test.tsx`) pins that the avatar menu offers it.
 * Every other posture keeps the plain "Switch organization" rendering.
 *
 * The component's own guards: nothing at one membership (nothing to switch
 * to), nothing without a server-active organization, and nothing inside a
 * mobile shell that carries its own switcher (the top bar's button is the
 * shell's control there).
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
}));

let authState: Record<string, unknown>;
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => authState,
}));

vi.mock('../../console/organizations/resolveHomeUrl', () => ({ resolveRootUrl: () => '#switched' }));

// Passthrough submenu primitives so the open submenu's rows render inline.
vi.mock('@object-ui/components', async (importOriginal) => {
  const Pass = ({ children, ...p }: any) => <div {...p}>{children}</div>;
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    DropdownMenuSub: Pass,
    DropdownMenuSubTrigger: Pass,
    DropdownMenuSubContent: Pass,
    DropdownMenuItem: ({ onClick, children, ...p }: any) => (
      <button type="button" onClick={onClick} {...p}>{children}</button>
    ),
    DropdownMenuLabel: Pass,
  };
});

import { NATIVE_HOST_GLOBAL } from '@object-ui/mobile';
import { WorkspaceSwitcherMenu } from '../WorkspaceSwitcher';

const ORGS = [
  { id: 'org_a', name: 'Plant A', slug: 'plant-a' },
  { id: 'org_b', name: 'Plant B', slug: 'plant-b' },
];

beforeEach(() => {
  delete (window as unknown as Record<string, unknown>)[NATIVE_HOST_GLOBAL];
  authState = {
    organizations: ORGS,
    activeOrganization: ORGS[0],
    switchOrganization: vi.fn(async () => undefined),
  };
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>)[NATIVE_HOST_GLOBAL];
  window.history.replaceState(null, '', '/');
});

describe('WorkspaceSwitcherMenu (ADR-0105 tenancy posture)', () => {
  it('group posture: labels the active org as the working organization and explains the read/write split', () => {
    render(<WorkspaceSwitcherMenu isGroupPosture />);
    expect(screen.getByText('Working organization')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-switcher-group-hint')).toHaveTextContent(
      'New records are created here. Views show data from all your organizations.',
    );
    // The submenu is still reached by its plain entry in the avatar menu.
    expect(screen.getByTestId('header-switch-organization')).toHaveTextContent('Switch organization');
  });

  it('any other posture: the plain switch entry, with no group hint', () => {
    render(<WorkspaceSwitcherMenu isGroupPosture={false} />);
    expect(screen.getByTestId('header-switch-organization')).toHaveTextContent('Switch organization');
    expect(screen.queryByText('Working organization')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-switcher-group-hint')).not.toBeInTheDocument();
  });
});

describe('WorkspaceSwitcherMenu — rows and switching', () => {
  it('lists every membership; picking another one switches and reloads to the console root', async () => {
    render(<WorkspaceSwitcherMenu isGroupPosture={false} />);
    expect(screen.getByTestId('workspace-switcher-org-org_a')).toHaveTextContent('Plant A');

    fireEvent.click(screen.getByTestId('workspace-switcher-org-org_b'));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

    expect(authState.switchOrganization).toHaveBeenCalledWith('org_b');
    expect(window.location.hash).toBe('#switched');
  });

  it('picking the active organization sends nothing', async () => {
    render(<WorkspaceSwitcherMenu isGroupPosture={false} />);
    fireEvent.click(screen.getByTestId('workspace-switcher-org-org_a'));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

    expect(authState.switchOrganization).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
  });
});

describe('WorkspaceSwitcherMenu — renders nothing', () => {
  it('at one membership: nothing to switch to', () => {
    authState = { ...authState, organizations: [ORGS[0]] };
    render(<WorkspaceSwitcherMenu isGroupPosture={false} />);
    expect(screen.queryByTestId('header-switch-organization')).not.toBeInTheDocument();
  });

  it('without a server-active organization (objectui#12698)', () => {
    authState = { ...authState, activeOrganization: null };
    render(<WorkspaceSwitcherMenu isGroupPosture={false} />);
    expect(screen.queryByTestId('header-switch-organization')).not.toBeInTheDocument();
    for (const org of ORGS) expect(screen.queryByText(org.name)).not.toBeInTheDocument();
  });

  it('inside a mobile shell that announces its own switcher', () => {
    const capabilities = ['showConnectionSwitcher'];
    (window as unknown as Record<string, unknown>)[NATIVE_HOST_GLOBAL] = {
      version: 1,
      platform: 'ios',
      appVersion: '2.1.0',
      capabilities,
      safeArea: { top: 0, bottom: 0, left: 0, right: 0 },
      has: (capability: string) => capabilities.includes(capability),
      showConnectionSwitcher: vi.fn(async () => null),
      ready: vi.fn(),
      routeChanged: vi.fn(),
    };
    render(<WorkspaceSwitcherMenu isGroupPosture={false} />);
    expect(screen.queryByTestId('header-switch-organization')).not.toBeInTheDocument();
  });

  it('control: the same harness with no shell renders the entry', () => {
    render(<WorkspaceSwitcherMenu isGroupPosture={false} />);
    expect(screen.getByTestId('header-switch-organization')).toBeInTheDocument();
  });
});

describe('WorkspaceSwitcherMenu — phone width: inline rows, no submenu', () => {
  // A submenu opens beside the avatar menu; at phone width the menu already
  // spans the screen, so a submenu would open off the screen. Below the phone
  // breakpoint the rows render inline under a label instead.
  const realWidth = window.innerWidth;
  const setWidth = (w: number) =>
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
  afterEach(() => setWidth(realWidth));

  it('at 375 px: no sub-trigger; the label and every row render inline, and a row still switches', async () => {
    setWidth(375);
    render(<WorkspaceSwitcherMenu isGroupPosture={false} />);
    expect(screen.queryByTestId('header-switch-organization')).not.toBeInTheDocument();
    expect(screen.getByTestId('header-switch-organization-label')).toHaveTextContent('Switch organization');
    const group = screen.getByTestId('workspace-switcher-menu');
    for (const org of ORGS) expect(group).toContainElement(screen.getByTestId(`workspace-switcher-org-${org.id}`));

    fireEvent.click(screen.getByTestId('workspace-switcher-org-org_b'));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    expect(authState.switchOrganization).toHaveBeenCalledWith('org_b');
  });

  it('at 375 px under group posture: the working-organization hint stays, width-bounded so it wraps', () => {
    setWidth(375);
    render(<WorkspaceSwitcherMenu isGroupPosture />);
    // The menu sizes to its content: an unbounded hint line widened it to 442 px on a 375 px screen.
    expect(screen.getByTestId('workspace-switcher-group-hint')).toHaveClass('max-w-60');
  });

  it('control: at 1024 px the submenu trigger renders and the inline label does not', () => {
    setWidth(1024);
    render(<WorkspaceSwitcherMenu isGroupPosture={false} />);
    expect(screen.getByTestId('header-switch-organization')).toBeInTheDocument();
    expect(screen.queryByTestId('header-switch-organization-label')).not.toBeInTheDocument();
  });
});
