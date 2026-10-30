/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * The discussion header shows no count when a feed read was refused
 * (objectstack#27820).
 *
 * The timeline's heading drew `(N)` from the rows it holds. A refused comment
 * read leaves no rows, so a member who may not read the comments saw
 * `Discussion (0)` right above "You don't have permission to view comments on
 * this record." — a count the server never gave. The host's refusal signal
 * (`commentsDenied` / `activityDenied`, the same one that draws the refusal
 * line) now withholds the count; a readable feed keeps it, `(0)` included.
 *
 * Read through the real `en` pack and the `record:chatter` block under a host
 * `DiscussionContext`, the way the record page mounts it.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { DiscussionContextProvider, RecordContextProvider } from '@object-ui/react';
import type { FeedItem } from '@object-ui/types';
import { RecordChatterRenderer } from '../renderers/record-chatter';
import { RecordChatterPanel } from '../RecordChatterPanel';

const COMMENTS_DENIED = "You don't have permission to view comments on this record.";
const ACTIVITY_DENIED = "You don't have permission to view activity on this record.";

const comment = (n: number) =>
  ({
    id: `c-${n}`,
    type: 'comment',
    actor: 'Ada',
    body: `Comment ${n}`,
    createdAt: `2026-01-0${n}T00:00:00.000Z`,
  }) satisfies FeedItem;

type HostItems = React.ComponentProps<typeof DiscussionContextProvider>['items'];

function mountChatter(ctx: { items: HostItems; commentsDenied?: boolean; activityDenied?: boolean }) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <RecordContextProvider objectName="crm_account" recordId="rec-1" data={{ id: 'rec-1' }}>
        <DiscussionContextProvider loading={false} {...ctx}>
          <RecordChatterRenderer schema={{} as never} />
        </DiscussionContextProvider>
      </RecordContextProvider>
    </I18nProvider>,
  );
}

const heading = () => screen.getByRole('heading', { level: 2 });

afterEach(() => cleanup());

describe('the discussion header withholds its count when a feed read was refused (objectstack#27820)', () => {
  it('a refused comment read: the header shows no count, the refusal line still shows', () => {
    mountChatter({ items: [], commentsDenied: true });

    expect(heading().textContent?.trim()).toBe('Discussion');
    expect(heading().textContent).not.toMatch(/\(\d+\)/);
    expect(screen.queryByTestId('activity-count')).toBeNull();
    expect(screen.getByTestId('activity-access-denied').textContent).toContain(COMMENTS_DENIED);
  });

  it('a refused comment read beside readable activity rows still shows no count', () => {
    const row = {
      id: 'a-1',
      type: 'field_change',
      actor: 'Grace',
      body: 'Stage moved to qualified',
      createdAt: '2026-01-02T00:00:00.000Z',
    } satisfies FeedItem;
    mountChatter({ items: [row], commentsDenied: true });

    expect(screen.getByText('Stage moved to qualified')).toBeTruthy();
    expect(heading().textContent).not.toMatch(/\(\d+\)/);
    expect(screen.getByTestId('activity-access-denied').textContent).toContain(COMMENTS_DENIED);
  });

  it('a refused activity read shows no count either', () => {
    mountChatter({ items: [], activityDenied: true });

    expect(heading().textContent).not.toMatch(/\(\d+\)/);
    expect(screen.getByTestId('activity-access-denied').textContent).toContain(ACTIVITY_DENIED);
  });

  it('control: a readable record with no comments shows (0)', () => {
    mountChatter({ items: [] });

    expect(heading()).toHaveTextContent(/^Discussion\s*\(0\)$/);
    expect(screen.queryByTestId('activity-access-denied')).toBeNull();
  });

  it('control: a readable record with 3 comments shows (3)', () => {
    mountChatter({ items: [comment(1), comment(2), comment(3)] });

    expect(heading()).toHaveTextContent(/^Discussion\s*\(3\)$/);
  });
});

describe('the collapsed discussion toggle withholds its count the same way (objectstack#27820)', () => {
  const mountCollapsed = (props: { commentsDenied?: boolean }) =>
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <RecordChatterPanel
          items={[]}
          config={{ position: 'bottom', collapsible: true, defaultCollapsed: true } as never}
          {...props}
        />
      </I18nProvider>,
    );

  it('refused: the toggle names the panel without a count', () => {
    mountCollapsed({ commentsDenied: true });

    const toggle = screen.getByRole('button', { name: 'Open discussion panel' });
    expect(toggle.textContent).not.toMatch(/\(\d+\)/);
  });

  it('control: readable, the toggle keeps its (0)', () => {
    mountCollapsed({});

    expect(screen.getByRole('button', { name: 'Show Discussion (0)' })).toBeTruthy();
  });
});
