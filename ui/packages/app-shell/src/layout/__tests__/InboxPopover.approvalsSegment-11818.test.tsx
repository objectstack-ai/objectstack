// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The bell's approvals link addresses the app by its ROUTE SEGMENT
 * (objectui#11818).
 *
 * ## The defect
 *
 * ADR-0048 option A keys `/apps/<segment>` on the package id; the app name is
 * only a fallback alias (`utils/appRoute.ts`). `ConsoleLayout` publishes the
 * app's `name` as `currentAppName`, and `goToApprovals` spliced
 * `currentAppName ?? params.appName` into the path raw — so the name won over
 * the route's own segment. Measured in the browser QA pass the card was filed
 * from: on `/apps/com.example.showcase/…`, *View approvals* landed on
 * `/apps/showcase_app/system/approvals`, the same app under a second address.
 *
 * The two "see all" drills one handler below already answer the same question
 * through `resolveHostAppSegment` (objectui#4074); the approvals link now reads
 * the same `hostAppSegment`.
 *
 * ## What these cases assert
 *
 * The argument `navigate()` receives — nothing about the far end. The fixtures
 * hand the popover what the console does: `currentAppName` is the app's NAME,
 * `params.appName` the URL's segment.
 *
 * Direction, written before the run: on the pre-fix handler, every case under
 * "lands on the route segment" and "outside the app router" is RED (the name,
 * or `setup`, instead of the segment); the controls are GREEN on both sides.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const navigateMock = vi.fn();

let currentAppNameFixture: string | undefined;
let routeAppNameFixture: string | undefined;
let appsFixture: Array<Record<string, unknown>> = [];

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ appName: routeAppNameFixture }),
}));

vi.mock('../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ currentAppName: currentAppNameFixture }),
}));

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: appsFixture, loading: false }),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    language: 'en',
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
        String(options?.[name] ?? ''),
      ),
  }),
}));

// Passthrough primitives so the popover body renders without driving Radix
// open/close in jsdom (the pattern `InboxPopover.viewAllTarget.test.tsx` uses).
vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Button: ({ children, ...p }: any) => <button type="button" {...p}>{children}</button>,
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <div>{children}</div>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children }: any) => <button type="button">{children}</button>,
  TabsContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('lucide-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Bell: () => <span />,
  CheckSquare: () => <span />,
  Activity: () => <span />,
  ChevronRight: () => <span />,
}));

import { InboxPopover } from '../InboxPopover';

/** The showcase app as the metadata catalog serves it: a name AND a package id. */
const SHOWCASE = { name: 'showcase_app', label: 'Showcase', _packageId: 'com.example.showcase' };
const SETUP = { name: 'setup', label: 'Setup', _packageId: 'com.objectstack.setup' };

/** Click `label` in a popover with `pendingApprovalsCount`; the path it navigated to. */
async function clickTo(label: string, pendingApprovalsCount: number): Promise<string> {
  const user = userEvent.setup();
  render(
    <InboxPopover
      notifications={[]}
      unreadCount={0}
      pendingApprovalsCount={pendingApprovalsCount}
      activity={{ value: [], status: 'ready', readable: true }}
      onMarkAllRead={vi.fn()}
      onMarkRead={vi.fn()}
    />,
  );
  await user.click(screen.getByText(label));
  expect(navigateMock).toHaveBeenCalledTimes(1);
  return navigateMock.mock.calls[0][0] as string;
}

/** The two approvals entry points: with pending items, and with none. */
const viewApprovals = () => clickTo('View approvals', 3);
const openApprovalsInbox = () => clickTo('Open Approvals Inbox', 0);

describe('InboxPopover approvals link keys on the route segment (objectui#11818)', () => {
  beforeEach(() => {
    cleanup();
    navigateMock.mockReset();
    appsFixture = [SETUP, SHOWCASE];
  });

  describe('inside an app routed by its package id, the link lands on the route segment', () => {
    beforeEach(() => {
      // What the console holds on `/apps/com.example.showcase/…`.
      currentAppNameFixture = 'showcase_app';
      routeAppNameFixture = 'com.example.showcase';
    });

    it('View approvals: the triage pin', async () => {
      expect(await viewApprovals()).toBe('/apps/com.example.showcase/system/approvals');
    });

    it('Open Approvals Inbox (nothing pending): the same target', async () => {
      expect(await openApprovalsInbox()).toBe('/apps/com.example.showcase/system/approvals');
    });

    it('the approvals link and the "see all" drill name the same app segment', async () => {
      const approvals = await viewApprovals();
      cleanup();
      navigateMock.mockReset();
      const inbox = await clickTo('View all notifications', 3);
      expect(approvals.split('/')[2]).toBe(inbox.split('/')[2]);
    });
  });

  describe('outside the app router (the bell on /home), the link still lands on a route segment', () => {
    beforeEach(() => {
      routeAppNameFixture = undefined;
    });

    it('the remembered app is addressed by its package id, not its name', async () => {
      currentAppNameFixture = 'showcase_app';
      expect(await viewApprovals()).toBe('/apps/com.example.showcase/system/approvals');
    });

    it('a cold landing (no app remembered) opens the first active app, as Home\'s approvals card does', async () => {
      currentAppNameFixture = undefined;
      appsFixture = [SHOWCASE, SETUP];
      expect(await viewApprovals()).toBe('/apps/com.example.showcase/system/approvals');
    });
  });

  describe('CONTROLS — green before and after', () => {
    it('an app with no package id is addressed by its name, which IS its route segment', async () => {
      appsFixture = [SETUP, { name: 'crm', label: 'CRM' }];
      currentAppNameFixture = 'crm';
      routeAppNameFixture = 'crm';
      expect(await viewApprovals()).toBe('/apps/crm/system/approvals');
    });

    it('with no app name published, the URL segment was already the answer', async () => {
      // The defect is precisely the NAME winning: with only the route's own
      // segment to read, the old expression already produced the right path.
      currentAppNameFixture = undefined;
      routeAppNameFixture = 'com.example.showcase';
      expect(await viewApprovals()).toBe('/apps/com.example.showcase/system/approvals');
    });
  });
});
