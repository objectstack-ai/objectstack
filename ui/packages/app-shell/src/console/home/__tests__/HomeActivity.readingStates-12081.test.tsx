/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12081 item 8 — Home's activity card, the second consumer of the
 * shared activity feed.
 *
 * It took the feed's rows alone, so a refused `sys_activity` read reached it as
 * `[]` and it told every non-admin "No recent activity". It now takes the
 * feed's whole reading, and these cases pin each state of it: no card for a
 * caller without the grant, a failure that says so, a pending read that claims
 * nothing, and — the control — the earned empty copy once the feed answers.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HomeActivity } from '../HomeRail';
import type { ActivityFeedReading } from '../../../hooks/sharedUserFeeds';

const t = (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key);

const EMPTY_COPY = 'No recent activity';
const ERROR_COPY = 'An unexpected error occurred.';
// U+2026, matching `common.loading` in the en pack.
const LOADING_COPY = 'Loading…';

const ROW = {
  id: 'a1',
  type: 'update' as const,
  objectName: 'crm_lead',
  user: 'Li Si',
  description: 'updated the lead',
  timestamp: '2026-10-10T08:00:00Z',
};

const card = (activity: ActivityFeedReading) =>
  render(<HomeActivity activity={activity} onViewAll={vi.fn()} t={t} />);

describe("Home's activity card reads the feed's status and grant (objectui#12081)", () => {
  it('renders nothing for a caller who may not read sys_activity', () => {
    const { container } = card({ value: [], status: 'idle', readable: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('a failed read says so, and does not say "No recent activity"', () => {
    card({ value: [], status: 'error', readable: true });
    expect(screen.getByTestId('home-activity-unanswered')).toHaveTextContent(ERROR_COPY);
    expect(screen.queryByText(EMPTY_COPY)).not.toBeInTheDocument();
  });

  it('a read still in flight claims nothing about the feed', () => {
    card({ value: [], status: 'loading', readable: true });
    expect(screen.getByTestId('home-activity-unanswered')).toHaveTextContent(LOADING_COPY);
    expect(screen.queryByText(EMPTY_COPY)).not.toBeInTheDocument();
  });

  it('a failed re-read keeps the rows it had, beside the notice', () => {
    card({ value: [ROW], status: 'error', readable: true });
    expect(screen.getByText('updated the lead')).toBeInTheDocument();
    expect(screen.getByTestId('home-activity-unanswered')).toHaveTextContent(ERROR_COPY);
  });

  it('an answered empty feed still says "No recent activity" (the control)', () => {
    card({ value: [], status: 'ready', readable: true });
    expect(screen.getByText(EMPTY_COPY)).toBeInTheDocument();
    expect(screen.queryByTestId('home-activity-unanswered')).not.toBeInTheDocument();
  });
});
