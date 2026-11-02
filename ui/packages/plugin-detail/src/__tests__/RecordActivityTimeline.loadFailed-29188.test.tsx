/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * A FAILED feed read is not an empty feed (objectstack#29188).
 *
 * The record page's comments read answered a 500 (`DATABASE_ERROR`) on every
 * hosted environment for days, and the discussion panel said 「暂无评论」 /
 * "No comments yet": comments users wrote looked lost. The host now reports a
 * failed read (`commentsFailed` / `activityFailed` on the DiscussionContext,
 * beside the refusal flags of objectui#11195) and offers a re-read
 * (`onRetryFeed`). The timeline renders a load-failure notice with a Retry in
 * place of the empty state, keeps the rows it holds, and names no count.
 *
 * Read through the real `en` and `zh` packs and the `record:chatter` block
 * under a host `DiscussionContext`, the way the record page mounts it; the
 * `peek` face (the 动态 panel) directly.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { DiscussionContextProvider, RecordContextProvider } from '@object-ui/react';
import type { FeedItem } from '@object-ui/types';
import { RecordChatterRenderer } from '../renderers/record-chatter';
import { RecordActivityTimeline } from '../RecordActivityTimeline';

const COMMENTS_FAILED = "We couldn't load the comments for this record.";
const ACTIVITY_FAILED = "We couldn't load the activity for this record.";
const NO_COMMENTS = 'No comments yet';

type HostItems = React.ComponentProps<typeof DiscussionContextProvider>['items'];

function mountChatter(
  ctx: {
    items: HostItems;
    commentsFailed?: boolean;
    activityFailed?: boolean;
    commentsDenied?: boolean;
    onRetryFeed?: () => void;
    loading?: boolean;
  },
  language: 'en' | 'zh' = 'en',
) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <RecordContextProvider objectName="crm_account" recordId="rec-1" data={{ id: 'rec-1' }}>
        <DiscussionContextProvider loading={false} {...ctx}>
          <RecordChatterRenderer schema={{} as never} />
        </DiscussionContextProvider>
      </RecordContextProvider>
    </I18nProvider>,
  );
}

const failedSources = () =>
  Array.from(document.querySelectorAll('[data-failed-source]')).map((e) => e.getAttribute('data-failed-source'));
const retry = () => document.querySelector('[data-feed-retry]') as HTMLButtonElement | null;
const heading = () => screen.getByRole('heading', { level: 2 });

afterEach(() => cleanup());

describe('a failed comments read shows the load-failure notice (objectstack#29188)', () => {
  it('shows the notice with a Retry in place of "No comments yet", and no count', () => {
    const onRetryFeed = vi.fn();
    mountChatter({ items: [], commentsFailed: true, onRetryFeed });

    const notice = screen.getByTestId('activity-load-failed');
    expect(notice.textContent).toContain(COMMENTS_FAILED);
    expect(failedSources()).toEqual(['comments']);
    expect(screen.queryByText(NO_COMMENTS)).toBeNull();
    expect(heading().textContent).not.toMatch(/\(\d+\)/);
    // Not a refusal: no lock line.
    expect(screen.queryByTestId('activity-access-denied')).toBeNull();

    fireEvent.click(retry()!);
    expect(onRetryFeed).toHaveBeenCalledTimes(1);
  });

  it('renders the zh sentence, never 「暂无评论」', () => {
    mountChatter({ items: [], commentsFailed: true, onRetryFeed: () => {} }, 'zh');
    const notice = screen.getByTestId('activity-load-failed');
    expect(notice.textContent).toContain('无法加载此记录的评论。');
    expect(retry()!.textContent).toContain('重试');
    expect(document.body.textContent).not.toContain('暂无评论');
  });

  it('keeps the rows that answered and puts the notice above them', () => {
    const row = {
      id: 'a-1',
      type: 'field_change',
      actor: 'Grace',
      body: 'Stage moved to qualified',
      createdAt: '2026-01-02T00:00:00.000Z',
    } satisfies FeedItem;
    mountChatter({ items: [row], commentsFailed: true, onRetryFeed: () => {} });
    expect(screen.getByText('Stage moved to qualified')).toBeTruthy();
    expect(failedSources()).toEqual(['comments']);
    expect(heading().textContent).not.toMatch(/\(\d+\)/);
  });

  it('a failed activity read says so for the activity', () => {
    mountChatter({ items: [], activityFailed: true, onRetryFeed: () => {} });
    expect(screen.getByTestId('activity-load-failed').textContent).toContain(ACTIVITY_FAILED);
    expect(failedSources()).toEqual(['activity']);
  });

  it('offers no Retry when the host offers no re-read', () => {
    mountChatter({ items: [], commentsFailed: true });
    expect(failedSources()).toEqual(['comments']);
    expect(retry()).toBeNull();
  });

  it('a refusal and a failure side by side show both lines', () => {
    mountChatter({ items: [], commentsDenied: true, activityFailed: true, onRetryFeed: () => {} });
    expect(document.querySelector('[data-denied-source="comments"]')).not.toBeNull();
    expect(failedSources()).toEqual(['activity']);
  });

  it('control: an answered empty read still says "No comments yet", with no notice', () => {
    mountChatter({ items: [] });
    expect(screen.getByText(NO_COMMENTS)).toBeTruthy();
    expect(screen.queryByTestId('activity-load-failed')).toBeNull();
    expect(heading().textContent).toMatch(/\(0\)/);
  });
});

describe('the 动态 panel (peek) shows the same notice (objectstack#29188)', () => {
  const renderPeek = (props: Partial<React.ComponentProps<typeof RecordActivityTimeline>>) =>
    render(
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
        <RecordActivityTimeline items={[]} variant="peek" {...props} />
      </I18nProvider>,
    );

  it('shows the notice with a Retry instead of the empty line', () => {
    const onRetryFeed = vi.fn();
    renderPeek({ commentsFailed: true, onRetryFeed });
    expect(screen.getByTestId('activity-load-failed').textContent).toContain(COMMENTS_FAILED);
    expect(screen.queryByText('No activity recorded')).toBeNull();
    fireEvent.click(retry()!);
    expect(onRetryFeed).toHaveBeenCalledTimes(1);
  });

  it('the Retry is disabled while the re-read is in flight over rows on screen', () => {
    const row = {
      id: 'a-1',
      type: 'record_create',
      actor: 'Grace',
      body: 'created the account',
      createdAt: '2026-01-02T00:00:00.000Z',
    } satisfies FeedItem;
    renderPeek({ items: [row], commentsFailed: true, onRetryFeed: () => {}, loading: true });
    expect(retry()!.disabled).toBe(true);
  });
});
