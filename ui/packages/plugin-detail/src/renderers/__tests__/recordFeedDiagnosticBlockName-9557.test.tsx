/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The shared feed pipeline's author diagnostics name the block that carries
 * the bad value, and warn once per (block, value) — objectui#9557.
 *
 * `recordActivityFeed.ts` is run by three blocks: `record:activity` reads
 * `filterMode` / `types` off its own node, and `record:chatter` /
 * `record:discussion` read them off their nested `feed`. Its diagnostics used
 * to hard-code the prefix `[record:activity]` and dedupe on the offending value
 * alone, so a bad value on a chatter block was reported under another block's
 * name, and the same bad value on two block kinds warned once in total.
 *
 * Every emit leg below is paired with a control:
 *
 *   ONE-PER-BLOCK   the same value on two block kinds warns twice, each
 *                   message under its own block's name;
 *   STILL-ONCE      the same value on the same block warns once however many
 *                   times the pipeline runs, so the fix did not trade the
 *                   under-report for a warning per render;
 *   NO-FOREIGN-NAME a chatter-path message carries no `[record:activity]`.
 *
 * The rendered legs mount through `SchemaRenderer`, so the block name the
 * renderer reads is the `type` a real page node carries, not a prop this file
 * chose.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { DiscussionContextProvider, SchemaRenderer } from '@object-ui/react';
import type { FeedItem } from '@object-ui/types';
import {
  applyFeedConfig,
  normalizeFeedTypes,
  normalizeFilterMode,
  resetUnproducedFeedTypeWarnings,
  resetUnrecognisedFeedTypeWarnings,
  resetUnrecognisedFilterModeWarnings,
} from '../recordActivityFeed';
import '../../index';

/** Not a declared filter mode (the declared spelling is `comments_only`). */
const BAD_MODE = 'comments-only';
/** Not a declared feed item type (an object name where a kind belongs). */
const BAD_TYPE = 'crm_task';

const ITEMS: FeedItem[] = [
  { id: 'c-1', type: 'comment', actor: 'Ada', body: 'Root comment', createdAt: '2026-01-02T00:00:00.000Z' },
];

const spyWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

/** The warnings that concern `fragment`, in the order they were raised. */
function warningsAbout(warn: ReturnType<typeof spyWarn>, fragment: string): string[] {
  return warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(fragment));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetUnrecognisedFilterModeWarnings();
  resetUnrecognisedFeedTypeWarnings();
  resetUnproducedFeedTypeWarnings();
});

describe('the pure half names the calling block and dedupes per block (objectui#9557)', () => {
  it('ONE-PER-BLOCK — the same bad `filterMode` on two block kinds warns once under each name', () => {
    const warn = spyWarn();

    expect(normalizeFilterMode(BAD_MODE, 'record:activity')).toBe('all');
    expect(normalizeFilterMode(BAD_MODE, 'record:chatter')).toBe('all');

    const messages = warningsAbout(warn, BAD_MODE);
    expect(messages).toHaveLength(2);
    expect(messages[0].startsWith('[record:activity] ')).toBe(true);
    expect(messages[1].startsWith('[record:chatter] ')).toBe(true);
  });

  it('STILL-ONCE — the same bad `filterMode` on the same block warns once', () => {
    const warn = spyWarn();

    for (let i = 0; i < 5; i += 1) normalizeFilterMode(BAD_MODE, 'record:chatter');

    expect(warningsAbout(warn, BAD_MODE)).toHaveLength(1);
  });

  it('ONE-PER-BLOCK — an unrecognised `types` entry, through the pipeline each block calls', () => {
    const warn = spyWarn();

    applyFeedConfig(ITEMS, { types: [BAD_TYPE] }, 20, 'record:activity');
    applyFeedConfig(ITEMS, { types: [BAD_TYPE] }, 20, 'record:discussion');
    // STILL-ONCE on the same channel: a re-render of either block says nothing new.
    applyFeedConfig(ITEMS, { types: [BAD_TYPE] }, 20, 'record:discussion');

    const messages = warningsAbout(warn, BAD_TYPE);
    expect(messages).toHaveLength(2);
    expect(messages[0].startsWith('[record:activity] ')).toBe(true);
    expect(messages[1].startsWith('[record:discussion] ')).toBe(true);
  });

  it('ONE-PER-BLOCK — a non-array `types` and an unproduced kind are scoped the same way', () => {
    const warn = spyWarn();

    normalizeFeedTypes('comment', 'record:activity');
    normalizeFeedTypes('comment', 'record:chatter');
    normalizeFeedTypes('comment', 'record:chatter');
    const nonArray = warningsAbout(warn, 'not an array');
    expect(nonArray.map((m) => m.slice(0, m.indexOf(']') + 1)))
      .toEqual(['[record:activity]', '[record:chatter]']);

    // `approval` is a declared kind nothing in ObjectUI produces (objectui#5877).
    normalizeFeedTypes(['approval'], 'record:activity');
    normalizeFeedTypes(['approval'], 'record:chatter');
    normalizeFeedTypes(['approval'], 'record:chatter');
    const unproduced = warningsAbout(warn, 'NO ObjectUI producer');
    expect(unproduced.map((m) => m.slice(0, m.indexOf(']') + 1)))
      .toEqual(['[record:activity]', '[record:chatter]']);
  });
});

/** A page node exactly as an author writes it for each block. */
function nodeFor(block: 'record:activity' | 'record:chatter' | 'record:discussion', feed: Record<string, unknown>) {
  if (block === 'record:activity') return { type: block, items: ITEMS, ...feed };
  return { type: block, feed };
}

function mount(node: Record<string, unknown>) {
  return render(
    <DiscussionContextProvider items={ITEMS as never} loading={false}>
      <SchemaRenderer schema={node as never} />
    </DiscussionContextProvider>,
  );
}

describe('the rendered blocks address their own authors (objectui#9557)', () => {
  it('ONE-PER-BLOCK — `record:activity` and `record:chatter` with the same bad `filterMode` on one page', () => {
    const warn = spyWarn();

    mount(nodeFor('record:activity', { filterMode: BAD_MODE }));
    mount(nodeFor('record:chatter', { filterMode: BAD_MODE }));

    const messages = warningsAbout(warn, BAD_MODE);
    expect(messages.map((m) => m.slice(0, m.indexOf(']') + 1)))
      .toEqual(['[record:activity]', '[record:chatter]']);
  });

  it('NO-FOREIGN-NAME — a bad `feed.filterMode` and `feed.types` on `record:discussion` never say `record:activity`', () => {
    const warn = spyWarn();

    mount(nodeFor('record:discussion', { filterMode: BAD_MODE, types: [BAD_TYPE] }));

    const mode = warningsAbout(warn, BAD_MODE);
    const types = warningsAbout(warn, BAD_TYPE);
    expect(mode).toHaveLength(1);
    expect(types).toHaveLength(1);
    for (const m of [...mode, ...types]) {
      expect(m.startsWith('[record:discussion] ')).toBe(true);
      expect(m).not.toContain('[record:activity]');
    }
  });

  it('STILL-ONCE — the same block with the same bad value, mounted twice, warns once', () => {
    const warn = spyWarn();

    const first = mount(nodeFor('record:chatter', { filterMode: BAD_MODE }));
    first.rerender(
      <DiscussionContextProvider items={ITEMS as never} loading={false}>
        <SchemaRenderer schema={nodeFor('record:chatter', { filterMode: BAD_MODE }) as never} />
      </DiscussionContextProvider>,
    );
    mount(nodeFor('record:chatter', { filterMode: BAD_MODE }));

    expect(warningsAbout(warn, BAD_MODE)).toHaveLength(1);
  });
});
