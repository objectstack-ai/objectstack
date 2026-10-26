/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#6816 — `ActivityFeed`'s notification filter read an unrecognised
 * kind as "off".
 *
 * `activities.filter(a => notificationPreferences[a.type])` is a truthiness
 * test over a `Record<ActivityItemType, boolean>`, so it answers the same
 * `false` to two different questions:
 *
 *  - the kind IS in the record and the user toggled it off — hide the row,
 *    which is the feature;
 *  - the kind is ABSENT from the record — which made the row VANISH.
 *
 * In-repo `tsc` keeps that second case out of reach (three exhaustive
 * `Record<ActivityItemType, …>` tables), but `ActivityFeed` is published API
 * — exported from the package barrel at `src/index.ts` — and a host that
 * mounts it can pass a kind that came from its own data. `sys_activity.type`
 * is author-extensible (objectstack#11507, ruled 2026-08-24), so those kinds
 * exist. The failure mode was a missing row: stored, queryable, invisible.
 *
 * These pin BOTH directions, because either one alone is satisfiable by a
 * broken filter: fail-open alone passes on a filter that shows everything,
 * and still-filtered alone passes on the defect itself.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ActivityFeed } from '../ActivityFeed.js';
import type { ActivityItem, ActivityItemType } from '../activityItemType.js';

// Key-echoing stub: the assertions below address the filter badges by their
// i18n key, so a stub returning the key verbatim is what makes them legible.
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ language: 'en', t: (key: string) => key }),
}));

// Passthrough primitives so the Sheet body renders without driving Radix
// open/close in happy-dom (the pattern InboxPopover's tests use). `variant`
// is surfaced as `data-variant` rather than dropped: it is the only rendered
// consequence of the SECOND preferences read (the toggle badge's own state),
// so keeping it is what lets a test observe that read at all.
vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Button: ({ children, variant, size: _size, ...p }: Record<string, any>) => (
    <button type="button" data-variant={variant} {...p}>{children}</button>
  ),
  Badge: ({ children, variant, ...p }: Record<string, any>) => (
    <span data-variant={variant} {...p}>{children}</span>
  ),
  Sheet: ({ children }: Record<string, any>) => <div>{children}</div>,
  SheetContent: ({ children }: Record<string, any>) => <div>{children}</div>,
  SheetHeader: ({ children }: Record<string, any>) => <div>{children}</div>,
  SheetTitle: ({ children }: Record<string, any>) => <div>{children}</div>,
  SheetTrigger: ({ children }: Record<string, any>) => <div>{children}</div>,
}));

// Named test ids so a row's icon identifies WHICH presentation it rendered
// through — "it did not throw" is a weaker claim than "it took the generic
// bucket".
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const icon = (name: string) => (props: Record<string, unknown>) => (
    <span data-testid={`icon-${name}`} {...props} />
  );
  return {
    ...actual,
    Activity: icon('Activity'),
    Plus: icon('Plus'),
    Pencil: icon('Pencil'),
    Trash2: icon('Trash2'),
    MessageSquare: icon('MessageSquare'),
    Filter: icon('Filter'),
    Info: icon('Info'),
  };
});

/**
 * A kind no `Record<ActivityItemType, …>` table in this repo has an entry for.
 *
 * The cast is the whole point and not a shortcut: `tsc` is exactly the
 * protection a published consumer does NOT have, so reaching the defect from
 * inside this repo means stepping around the compiler the way a JavaScript
 * host does for free.
 */
const UNKNOWN_KIND = 'contract_countersigned' as ActivityItemType;

const row = (id: string, type: ActivityItemType, description: string): ActivityItem => ({
  id,
  type,
  objectName: 'accounts',
  user: 'Ada Lovelace',
  description,
  timestamp: new Date().toISOString(),
});

const KNOWN_ROW = row('a1', 'create', 'Created the Acme account');
const UNKNOWN_ROW = row('a2', UNKNOWN_KIND, 'Countersigned the Acme MSA');

/** Open the filter strip (its badges are the notification toggles). */
function openFilters() {
  fireEvent.click(screen.getByText('layout.activityFeed.filter'));
}

describe('ActivityFeed — an unrecognised activity kind (objectui#6816)', () => {
  it('renders the row rather than dropping it from the panel', () => {
    render(<ActivityFeed activities={[KNOWN_ROW, UNKNOWN_ROW]} />);

    // The defect: this row was absent from the panel entirely.
    expect(screen.getByText('Countersigned the Acme MSA')).toBeInTheDocument();
    expect(screen.getByText('Created the Acme account')).toBeInTheDocument();
  });

  it('renders it through the declared generic bucket, not a missing presentation', () => {
    render(<ActivityFeed activities={[UNKNOWN_ROW]} />);

    const item = screen.getByText('Countersigned the Acme MSA').closest('li');
    expect(item).not.toBeNull();
    // `UNMAPPED_ACTIVITY_ITEM_TYPE` is `system`, whose icon is `Info`.
    expect(within(item as HTMLElement).getByTestId('icon-Info')).toBeInTheDocument();
    // Not `update` — reading an unmapped kind as an update is the claim
    // objectui#6730 removed from the mapping side.
    expect(within(item as HTMLElement).queryByTestId('icon-Pencil')).toBeNull();
  });

  it('still filters a kind the user has toggled OFF, and leaves the unknown kind alone', () => {
    render(<ActivityFeed activities={[KNOWN_ROW, UNKNOWN_ROW]} />);
    openFilters();

    // Both rows are in the panel before the toggle.
    expect(screen.getByText('Created the Acme account')).toBeInTheDocument();
    expect(screen.getByText('Countersigned the Acme MSA')).toBeInTheDocument();

    fireEvent.click(screen.getByText('layout.activityFeed.typeCreate'));

    // Present-and-false is still a hide — fail-open must not degrade into
    // "show everything", which would make the filter feature dead.
    expect(screen.queryByText('Created the Acme account')).toBeNull();
    // …and it did not take the unrecognised row with it.
    expect(screen.getByText('Countersigned the Acme MSA')).toBeInTheDocument();
  });

  it('shows the toggle badge as off for a kind the user disabled', () => {
    render(<ActivityFeed activities={[KNOWN_ROW]} />);
    openFilters();

    const badge = () => screen.getByText('layout.activityFeed.typeCreate');
    expect(badge()).toHaveAttribute('data-variant', 'default');

    fireEvent.click(badge());

    // The second preferences read (the badge's own state) agrees with the
    // first (the filter) — one predicate, so they cannot drift.
    expect(badge()).toHaveAttribute('data-variant', 'outline');
  });
});
