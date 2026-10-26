/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Regression tests for HistoryTimeline. The original implementation rendered
 * a raw user UUID and the action verb only; these tests lock in the new
 * mainstream-style contract: never expose raw IDs, always render a
 * resolved display name (or "Unknown user" for an id that resolved to no name,
 * "System" for an entry with no actor at all), and surface field-level diffs.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { HistoryTimeline, type HistoryEntry } from '../HistoryTimeline';

const SYSTEM_GLYPH = 'history-system-actor-glyph';

describe('HistoryTimeline', () => {
  it('renders display name + avatar initials instead of raw user_id', () => {
    const entries: HistoryEntry[] = [
      {
        id: 1,
        action: 'update',
        user_id: 'kie15eCYTcCTAUE6REeyW3qcsF9LdfOa',
        user_name: 'Jane Doe',
        created_at: new Date().toISOString(),
      },
    ];
    render(<HistoryTimeline entries={entries} />);
    expect(screen.getByText('Jane Doe')).toBeTruthy();
    expect(screen.queryByText('kie15eCYTcCTAUE6REeyW3qcsF9LdfOa')).toBeNull();
    expect(screen.getByText('JD')).toBeTruthy(); // initials
  });

  it('falls back to "Unknown user" when no name is resolved (never shows raw id)', () => {
    const entries: HistoryEntry[] = [
      {
        id: 2,
        action: 'update',
        user_id: 'abc123XYZopaque',
        created_at: new Date().toISOString(),
      },
    ];
    render(<HistoryTimeline entries={entries} />);
    expect(screen.getByText('Unknown user')).toBeTruthy();
    expect(screen.queryByText('abc123XYZopaque')).toBeNull();
  });

  it('uses the localized unknownUserText when provided', () => {
    const entries: HistoryEntry[] = [
      {
        id: 5,
        action: 'update',
        user_id: 'abc123XYZopaque',
        created_at: new Date().toISOString(),
      },
    ];
    render(<HistoryTimeline entries={entries} unknownUserText="未知用户" />);
    expect(screen.getByText('未知用户')).toBeTruthy();
    expect(screen.queryByText('Unknown user')).toBeNull();
  });

  // objectui#12527 — an entry with neither a name nor a user id is a system
  // write (a seed backfill, a hook with no user in context): it reads
  // "System" with a cog glyph, never a person-shaped unknown.
  it('renders "System" with the system glyph for an entry with no actor at all', () => {
    const entries: HistoryEntry[] = [
      { id: 10, action: 'update', user_id: null, user_name: null, created_at: new Date().toISOString() },
    ];
    render(<HistoryTimeline entries={entries} unknownUserText="Someone" />);
    expect(screen.getByText('System')).toBeTruthy();
    expect(screen.getByTestId(SYSTEM_GLYPH)).toBeTruthy();
    // Neither the unknown label (nor its override) nor the "?" avatar.
    expect(screen.queryByText('Someone')).toBeNull();
    expect(screen.queryByText('Unknown user')).toBeNull();
    expect(screen.queryByText('?')).toBeNull();
  });

  it('keeps "Unknown user" and the "?" avatar for a user_id that resolved to no name', () => {
    const entries: HistoryEntry[] = [
      { id: 11, action: 'update', user_id: 'u-deleted', user_name: null, created_at: new Date().toISOString() },
    ];
    render(<HistoryTimeline entries={entries} />);
    expect(screen.getByText('Unknown user')).toBeTruthy();
    expect(screen.getByText('?')).toBeTruthy();
    expect(screen.queryByText('System')).toBeNull();
    expect(screen.queryByTestId(SYSTEM_GLYPH)).toBeNull();
  });

  it('reads the system label from the session locale pack (detail.systemActor)', () => {
    const entries: HistoryEntry[] = [
      { id: 12, action: 'create', created_at: new Date().toISOString() },
    ];
    render(
      <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
        <HistoryTimeline entries={entries} />
      </I18nProvider>,
    );
    expect(screen.getByText('系统')).toBeTruthy();
    expect(screen.queryByText('System')).toBeNull();
  });

  it('renders per-field diff (old → new) with friendly labels', () => {
    const entries: HistoryEntry[] = [
      {
        id: 3,
        action: 'update',
        user_name: 'Jane Doe',
        created_at: new Date().toISOString(),
        changes: [
          { field: 'industry', label: 'Industry', from: 'finance', to: 'healthcare' },
          { field: 'name', label: 'Name', from: 'Acme', to: 'Acme Corp' },
        ],
      },
    ];
    render(<HistoryTimeline entries={entries} />);
    expect(screen.getByText('Industry')).toBeTruthy();
    expect(screen.getByText('finance')).toBeTruthy();
    expect(screen.getByText('healthcare')).toBeTruthy();
    expect(screen.getByText('Name')).toBeTruthy();
  });

  it('renders empty state when no entries', () => {
    render(<HistoryTimeline entries={[]} emptyText="Nothing here yet" />);
    expect(screen.getByText('Nothing here yet')).toBeTruthy();
  });

  // objectui#4476: ACTION_VARIANT no longer has a 'restore' entry (the value
  // was retired — no writer anywhere ever produces it). Before removal it
  // mapped to 'outline', which is also the `?? 'outline'` fallback used for
  // any unrecognized action — so dropping the key is a pure no-op for
  // rendering. This test locks that reading in: the badge for a (now
  // unrecognized) 'restore' action must render with exactly the classes the
  // 'outline' variant contributes (see packages/components/src/ui/badge.tsx),
  // and none of the classes unique to the other named variants.
  it('renders the retired "restore" action badge identically to the outline fallback (confirms removing the key changed no rendering)', () => {
    const entries: HistoryEntry[] = [
      {
        id: 6,
        action: 'restore',
        user_name: 'Jane Doe',
        created_at: new Date().toISOString(),
      },
    ];
    render(<HistoryTimeline entries={entries} />);
    const badge = screen.getByText('restore');
    expect(badge.className).toContain('text-foreground');
    expect(badge.className).not.toContain('bg-secondary');
    expect(badge.className).not.toContain('bg-primary');
    expect(badge.className).not.toContain('bg-destructive');
    expect(badge.className).not.toContain('border-transparent');
  });
});
