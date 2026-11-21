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
 * objectstack#35596 moved the card into the 概览 tab's rail as 「最近动态」
 * (`RecordSummaryRail`, replacing `RecordTimelinePanel` on the page): the
 * same inset holds there, and nothing in the rail is editable — neither face
 * offers a composer.
 *
 * Drawn here through the real default record page (`buildDefaultPageSchema`
 * → `buildDefaultPageColumns` → `RecordPageColumns`, real block renderers), so
 * the chatter node lands in the rail's card the way it does on the page.
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
/** The synthesized default: the `record:activity` stream. */
const activityColumns = () => buildDefaultPageColumns(buildDefaultPageSchema(OBJECT as any, {}))!;

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

const classesOf = (el: Element | null | undefined) => (el?.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
const hasInlinePadding = (el: Element | null | undefined) =>
  classesOf(el).some((c) => /^(px|pl|pr|p)-/.test(c));

const CARD = '[data-record-summary-card="timeline"]';

describe('the rail\'s 最近动态 card holding a record:chatter block (objectstack#34676, objectstack#35596)', () => {
  it('the chatter timeline is inset inside the card: horizontal and bottom padding, one divider under the head', () => {
    const { container } = draw(chatterColumns());
    const panel = container.querySelector(CARD) as HTMLElement;
    expect(panel).not.toBeNull();
    // A chatter stream reports no count: its card is drawn as it comes.
    expect(panel.hidden).toBe(false);
    // The block in the card is the chatter's panel face (filter), not a peek.
    expect(panel.querySelector('[data-record-timeline-peek]')).toBeNull();
    const timeline = panel.querySelector('section[aria-label="Discussion"]') as HTMLElement;
    expect(timeline).not.toBeNull();
    // Nothing in the rail is editable (objectstack#35596): no composer.
    expect(timeline.querySelector('textarea')).toBeNull();
    const cls = classesOf(timeline);
    // Inset on both sides and at the foot, like the related panels' rows (px-3).
    expect(cls).toContain('px-3');
    expect(cls).toContain('py-3');
    expect(cls).not.toContain('pt-5');
    // One divider between the panel head and the body, in the card's border colour.
    expect(cls).toContain('border-t');
    expect(cls).toContain('border-border');
    expect(cls).not.toContain('border-border/60');
    // Nothing between the card and the timeline pads or borders it a second time.
    for (let el = timeline.parentElement; el && el !== panel; el = el.parentElement) {
      expect(hasInlinePadding(el)).toBe(false);
      expect(classesOf(el).some((c) => c === 'border' || c.startsWith('border-t') || c.startsWith('border-l'))).toBe(false);
    }
  });

  it('CONTROL — record:activity in the same card keeps its peek face, edge to edge, rows padding themselves', () => {
    const { container } = draw(activityColumns());
    const panel = container.querySelector(CARD) as HTMLElement;
    const peek = panel.querySelector('[data-record-timeline-peek]') as HTMLElement;
    expect(peek).not.toBeNull();
    // The peek root carries no class of its own: its rows bleed to the card's edge.
    expect(peek.getAttribute('class')).toBeNull();
    for (let el = peek.parentElement; el && el !== panel; el = el.parentElement) {
      expect(hasInlinePadding(el)).toBe(false);
    }
    const rows = Array.from(panel.querySelectorAll('[data-record-timeline-peek-row]'));
    // The newest three (the rail's row cap), each padding itself.
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.getAttribute('class')).toBe('flex h-8 items-center gap-2 border-t border-border px-3 text-sm');
    }
    // Read-only: the peek's composer is not offered in the rail.
    expect(panel.querySelector('[data-record-timeline-composer]')).toBeNull();
  });

  it('CONTROL — the 动态 tab draws the same chatter block with no card, so no inset: the de-boxed face', () => {
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
