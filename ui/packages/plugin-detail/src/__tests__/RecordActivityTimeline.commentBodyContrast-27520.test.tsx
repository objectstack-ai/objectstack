/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A comment's text reads in the foreground colour (objectstack#27520 row 14).
 *
 * The sighting was a project record whose Discussion drew the comment text in
 * the muted grey the meta line uses (`text-muted-foreground`), so what the
 * author wrote read as fainter than the name above it. The body now takes
 * `text-foreground`, as a reply's body already did; the actor and timestamp
 * keep the muted grey.
 */
import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { FeedItem } from '@object-ui/types';
import { RecordActivityTimeline } from '../RecordActivityTimeline';

afterEach(cleanup);

const BODY = 'Kickoff moved to Monday, please review the plan.';

const COMMENT: FeedItem = {
  id: 'c-1',
  type: 'comment',
  actor: 'Ada',
  body: BODY,
  createdAt: '2026-10-01T08:00:00.000Z',
};

describe('comment text contrast (objectstack#27520 row 14)', () => {
  it('draws the comment body in the foreground colour, not the muted grey', () => {
    render(<RecordActivityTimeline items={[COMMENT]} />);
    const body = screen.getByText(BODY);
    expect(body.className).toContain('text-foreground');
    expect(body.className).not.toContain('text-muted-foreground');
  });

  it('CONTROL: the meta line beside it keeps the muted grey', () => {
    render(<RecordActivityTimeline items={[COMMENT]} />);
    // The timestamp is the meta line's muted span; the actor's name is not.
    const actor = screen.getByText('Ada');
    const meta = actor.parentElement as HTMLElement;
    const muted = meta.querySelectorAll('.text-muted-foreground');
    expect(muted.length).toBeGreaterThan(0);
  });
});
