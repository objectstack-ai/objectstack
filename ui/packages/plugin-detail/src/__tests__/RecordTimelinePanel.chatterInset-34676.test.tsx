/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#34676 — the 动态 card of the record page's right column draws
 * its body edge to edge: it expects `record:activity`'s peek face, whose rows
 * pad themselves. A slotted page's `discussion` slot puts `record:chatter`
 * there instead, and the chatter block draws the
 * timeline's panel face — the 全部动态 filter, full rows — which pads only its
 * top, so its icons and long rows would sit on the card's border.
 *
 * objectstack#35596 moved the card into the 概览 tab's rail as 「最近动态」;
 * objectstack#35890 retired the rail, so on the record page the chatter block
 * is drawn only in the 动态 tab, de-boxed.
 *
 * Drawn here through the real default record page (`buildDefaultPageSchema`
 * → `buildDefaultPageColumns` → `RecordPageColumns`, real block renderers), so
 * the chatter node lands in the 动态 tab the way it does on the page.
 * jsdom lays nothing out, so the pins read the classes that make the inset.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { DiscussionContextProvider } from '@object-ui/react';
import type { FeedItem } from '@object-ui/types';
import { RecordPageColumns } from '../RecordPageColumns';
import { RECORD_PAGE_TIMELINE_PANEL, buildDefaultPageColumns } from '../synth/recordPageColumns';
import { buildDefaultPageSchema } from '../synth/buildDefaultPageSchema';
import '../index';

afterEach(cleanup);

const notes: FeedItem[] = Array.from({ length: 3 }, (_, i) => ({
  id: `c${i}`,
  type: 'comment',
  actor: 'Ada',
  body: `Note ${i}`,
  createdAt: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
}));

const OBJECT = { name: 'account', label: 'Account', fields: { name: { name: 'name', type: 'text' } } };

/** A slotted page whose `discussion` slot is `record:chatter`. */
const chatterColumns = () =>
  buildDefaultPageColumns(
    buildDefaultPageSchema(OBJECT as any, {
      slots: { discussion: { type: 'record:chatter', id: 'account_chatter', label: 'Discussion', properties: {} } },
    } as any),
  )!;

function draw(columns: ReturnType<typeof chatterColumns>, enlarged?: string) {
  return render(
    <DiscussionContextProvider items={notes as any[]} loading={false} onAddComment={(async () => {}) as any}>
      <RecordPageColumns
        tier="wide"
        columns={columns}
        onEnlargeRelated={() => {}}
        enlargedRelated={enlarged as any}
      />
    </DiscussionContextProvider>,
  );
}


const CARD = '[data-record-summary-card="timeline"]';

describe('the 动态 tab holding a record:chatter block (objectstack#34676; the rail card retired, objectstack#35890)', () => {
  it('the 动态 tab draws the chatter block with no card, so no inset: the de-boxed face', () => {
    const { container } = draw(chatterColumns(), RECORD_PAGE_TIMELINE_PANEL);
    const face = container.querySelector(`[data-related-enlarged="${RECORD_PAGE_TIMELINE_PANEL}"]`) as HTMLElement;
    expect(face).not.toBeNull();
    expect(face.closest(CARD)).toBeNull();
    const timeline = face.querySelector('section[aria-label="Discussion"]') as HTMLElement;
    expect(timeline).not.toBeNull();
    // pt-3 since the dense activity rows (objectstack#35602).
    expect(timeline.getAttribute('class')).toBe('border-t border-border/60 pt-3');
  });
});
