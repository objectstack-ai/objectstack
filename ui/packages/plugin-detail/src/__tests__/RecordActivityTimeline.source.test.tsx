/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * ADR-0052 ActivityPointer: a timeline row carrying a `sourceObject`/`sourceId`
 * pointer (e.g. an email derived from a `sys_email` row) renders a "view source"
 * link so the user can drill from the one-line summary to the full record.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecordActivityTimeline } from '../RecordActivityTimeline';
import type { FeedItem } from '@object-ui/types';

describe('RecordActivityTimeline — source drill link (ADR-0052 ActivityPointer)', () => {
  it('renders a "view source" link to the source entity when sourceObject/sourceId are present', () => {
    const items: FeedItem[] = [
      {
        id: 'act-1',
        type: 'comment',
        actor: 'System',
        body: 'Email: Q3 proposal',
        createdAt: new Date().toISOString(),
        sourceObject: 'sys_email',
        sourceId: 'email-123',
      },
    ];
    render(<RecordActivityTimeline items={items} />);
    const link = screen.getByTestId('activity-source-link') as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('/objects/sys_email/email-123');
  });

  it('renders no source link when the activity has no source pointer', () => {
    const items: FeedItem[] = [
      {
        id: 'act-2',
        type: 'comment',
        actor: 'System',
        body: 'Status: To Do → Done',
        createdAt: new Date().toISOString(),
      },
    ];
    render(<RecordActivityTimeline items={items} />);
    expect(screen.queryByTestId('activity-source-link')).toBeNull();
  });
});
