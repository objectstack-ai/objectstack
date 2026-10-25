/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#12968 (objectstack#24324 ruling A, preview-first) — the confirm
 * path previews too. A change confirmed on the change card and saved as a
 * draft answers with a `drafted` replay envelope; `detectReplayOutcome` lifts
 * the items that replay drafted, and the applied card draws Preview through
 * the same `onPreviewDraft` door the drafted result uses.
 *
 * Pinned:
 *  - the lift: a drafted replay carries its `drafted[]` items (not the
 *    package's whole `draftState.items`), and a published one carries none;
 *  - the applied card draws Preview and the click hands the host the items
 *    and the package id; the bare drafted badge (an older cloud with no
 *    applied card) does the same;
 *  - CONTROL: a host with no `onPreviewDraft` draws no Preview, and the card's
 *    other doors are unchanged.
 *
 * Every message goes through the real mapper from a raw tool part.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import { detectReplayOutcome, uiMessageToChatMessage } from '../mapMessages';
import { BORROWING, PACKAGE_ID, draftedEnvelope, proposedEnvelope } from './fixtures/changePosture.fixtures';

afterEach(() => {
  cleanup();
});

const proposalTurn = (envelope: unknown) =>
  uiMessageToChatMessage({
    id: 'a1',
    role: 'assistant',
    parts: [
      { type: 'tool-apply_edit', toolCallId: 'call_1', state: 'output-available', input: {}, output: envelope },
    ],
  });

const replayTurn = (envelope: unknown) =>
  uiMessageToChatMessage({
    id: 'a2',
    role: 'assistant',
    parts: [
      { type: 'tool-apply_edit', toolCallId: 'replay_t2_0', state: 'output-available', input: {}, output: envelope },
    ],
  });

const renderApplied = (replay: unknown, props: Partial<React.ComponentProps<typeof ChatbotEnhanced>> = {}) =>
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <ChatbotEnhanced
        messages={[proposalTurn(proposedEnvelope('en', 'draft')), replayTurn(replay)]}
        onSendMessage={vi.fn()}
        {...props}
      />
    </I18nProvider>,
  );

describe('detectReplayOutcome lifts the drafted items (objectui#12968)', () => {
  it('a drafted replay carries the items it drafted, not every pending draft of the package', () => {
    const outcome = detectReplayOutcome('replay_t2_0', draftedEnvelope('en', { others: 2 }));
    expect(outcome?.kind).toBe('drafted');
    expect(outcome?.items).toEqual([{ type: 'object', name: BORROWING }]);
    expect(outcome?.draftState?.items).toHaveLength(3);
  });

  it('a one-item stage reports its type and name, and those are the item', () => {
    const outcome = detectReplayOutcome('replay_t2_0', {
      status: 'drafted',
      type: 'view',
      name: `${BORROWING}.board`,
      packageId: PACKAGE_ID,
    });
    expect(outcome?.items).toEqual([{ type: 'view', name: `${BORROWING}.board` }]);
  });

  it('a published replay carries no items', () => {
    expect(detectReplayOutcome('replay_t2_0', { status: 'published', drafted: [{ type: 'object', name: BORROWING }] })).toEqual({
      kind: 'published',
    });
  });
});

describe('the confirm-gated applied card draws Preview (objectui#12968)', () => {
  it('the applied card draws Preview, and the click hands the host the drafted items and the package id', () => {
    const onPreviewDraft = vi.fn();
    const onReviewDrafts = vi.fn();
    renderApplied(draftedEnvelope('en', { others: 2 }), { onPreviewDraft, onReviewDrafts, onDiscardDrafts: vi.fn() });
    const preview = screen.getByTestId('applied-card-preview');
    expect(preview).toHaveTextContent('Preview');
    fireEvent.click(preview);
    expect(onPreviewDraft).toHaveBeenCalledTimes(1);
    expect(onPreviewDraft).toHaveBeenCalledWith([{ type: 'object', name: BORROWING }], { appSegment: PACKAGE_ID });
    // Preview publishes and reviews nothing.
    expect(onReviewDrafts).not.toHaveBeenCalled();
    // The card's other doors are where they were.
    expect(screen.getByTestId('applied-card-review')).toBeInTheDocument();
    expect(screen.getByTestId('applied-card-discard')).toBeInTheDocument();
  });

  it('an older cloud (no applied card): the drafted badge draws Preview through the same door', () => {
    const onPreviewDraft = vi.fn();
    renderApplied(draftedEnvelope('en', { withCard: false }), { onPreviewDraft, onPublishDrafts: vi.fn() });
    expect(screen.queryByTestId('applied-card')).not.toBeInTheDocument();
    expect(screen.getByTestId('proposed-changes-drafted')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('proposed-changes-preview'));
    expect(onPreviewDraft).toHaveBeenCalledWith([{ type: 'object', name: BORROWING }], { appSegment: PACKAGE_ID });
  });

  it('CONTROL: a host with no onPreviewDraft draws no Preview on either rendering', () => {
    renderApplied(draftedEnvelope('en'), { onReviewDrafts: vi.fn(), onDiscardDrafts: vi.fn() });
    expect(screen.getByTestId('applied-card')).toBeInTheDocument();
    expect(screen.queryByTestId('applied-card-preview')).not.toBeInTheDocument();
    cleanup();
    renderApplied(draftedEnvelope('en', { withCard: false }), { onPublishDrafts: vi.fn() });
    expect(screen.getByTestId('proposed-changes-drafted')).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-changes-preview')).not.toBeInTheDocument();
  });
});
