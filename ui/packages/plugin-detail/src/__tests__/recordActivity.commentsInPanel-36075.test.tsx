/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36075, item 5 — where the comment panel holds the record's
 * comments, the default page's 动态 stream holds the system entries only: no
 * comment rows, no 全部 / 活动 / 讨论 / 变更 chips, no comment box, and a
 * refused comment read is not the stream's to report.
 *
 * Measured against a CONTROL: the same stream without the panel keeps all of
 * them, and an authored `record:activity` (a hand-written page, not the
 * default stream) is untouched by the flag.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DiscussionContextProvider } from '@object-ui/react';
import type { FeedItem } from '@object-ui/types';
import { RecordCommentsInPanelContext } from '../recordTimelineStream';
import { RecordActivityRenderer, RecordTimelineCountProbe } from '../renderers/record-activity';
import { DefaultRecordPageContext } from '../defaultRecordPage';

afterEach(cleanup);

const comment: FeedItem = { id: 'c1', type: 'comment', actor: 'Ada', body: 'Budget is set', createdAt: '2026-10-23T10:00:00Z' };
const call: FeedItem = { id: 'a1', type: 'task', actor: 'Dev', body: 'Logged a call', createdAt: '2026-10-28T10:20:00Z' };

function mount({ inPanel, onDefaultPage = true, commentsDenied = false }: { inPanel: boolean; onDefaultPage?: boolean; commentsDenied?: boolean }) {
  return render(
    <DefaultRecordPageContext.Provider value={onDefaultPage}>
      <RecordCommentsInPanelContext.Provider value={inPanel}>
        <DiscussionContextProvider
          items={[call, comment] as any[]}
          loading={false}
          commentsDenied={commentsDenied}
          onAddComment={() => undefined}
        >
          <RecordActivityRenderer schema={{ type: 'record:activity', showCompleted: true } as any} />
        </DiscussionContextProvider>
      </RecordCommentsInPanelContext.Provider>
    </DefaultRecordPageContext.Provider>,
  );
}

describe('record:activity while the comments are in the panel (objectstack#36075)', () => {
  it('draws the system entries only: no comments, no chips, no comment box', () => {
    const { container } = mount({ inPanel: true });
    expect(screen.getByText('Logged a call')).toBeTruthy();
    expect(screen.queryByText('Budget is set')).toBeNull();
    expect(container.querySelector('[data-stream-filters]')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('CONTROL — without the panel the stream keeps comments, chips and the comment box', () => {
    const { container } = mount({ inPanel: false });
    expect(screen.getByText('Budget is set')).toBeTruthy();
    expect(container.querySelector('[data-stream-filters]')).toBeTruthy();
    expect(container.querySelector('textarea')).toBeTruthy();
  });

  it('a refused comment read does not replace the system entries', () => {
    mount({ inPanel: true, commentsDenied: true });
    expect(screen.getByText('Logged a call')).toBeTruthy();
  });

  it("the tab row's count, read while no face is drawn, counts the system entries alone", () => {
    const counts: Array<number | null> = [];
    const probe = (inPanel: boolean) => (
      <RecordCommentsInPanelContext.Provider value={inPanel}>
        <DiscussionContextProvider items={[call, comment] as any[]} loading={false}>
          <RecordTimelineCountProbe
            nodes={[{ type: 'record:activity', properties: { showCompleted: true } }]}
            onCount={(count) => counts.push(count)}
          />
        </DiscussionContextProvider>
      </RecordCommentsInPanelContext.Provider>
    );
    render(probe(true));
    expect(counts.at(-1)).toBe(1);
    cleanup();
    // CONTROL: without the panel the comment is counted too.
    render(probe(false));
    expect(counts.at(-1)).toBe(2);
  });

  it('an authored record:activity off the default page is untouched by the flag', () => {
    mount({ inPanel: true, onDefaultPage: false });
    expect(screen.getByText('Budget is set')).toBeTruthy();
  });
});
