/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12968 (objectstack#24324 ruling A, preview-first) — the drafted
 * result's Preview button appears for ANY draft kind, not only when the draft
 * set includes an app.
 *
 * The drafted results here go through the chat's own lift
 * (`detectDraftResult`), so each fixture is the envelope an authoring tool
 * answers, not a hand-built `draftReview`.
 *
 * Pinned:
 *  - a field, view or page draft draws Preview, and the click hands the host
 *    the drafted items and the package's route segment (`onPreviewDraft`);
 *  - an app draft keeps today's button and callback (`onPreviewDraftApp`),
 *    unchanged;
 *  - CONTROL: a host that passes no `onPreviewDraft` (the read-only share page,
 *    any host that never opted in) draws no Preview for a non-app draft, and a
 *    published draft draws none at all;
 *  - Preview publishes nothing: no publish callback, no request.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChatbotEnhanced, type ChatbotEnhancedMessage } from '../ChatbotEnhanced';
import { detectDraftResult } from '../mapMessages';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** One assistant message whose single tool part drafted `envelope`. */
function draftedMessage(toolName: string, envelope: Record<string, unknown>): ChatbotEnhancedMessage {
  const draftReview = detectDraftResult(envelope);
  if (!draftReview) throw new Error(`fixture is not a drafted envelope: ${JSON.stringify(envelope)}`);
  return {
    id: 'a1',
    role: 'assistant',
    content: '',
    toolInvocations: [{ toolCallId: 't1', toolName, state: 'output-available', draftReview }],
  };
}

/** `add_field` on an existing object: the draft is the OBJECT, its fields changed. */
const FIELD_DRAFT = {
  status: 'drafted',
  type: 'object',
  name: 'crm_account',
  summary: 'Added field Priority',
  changedKeys: ['fields'],
  packageId: 'app.crm',
};
const VIEW_DRAFT = { status: 'drafted', type: 'view', name: 'crm_account.pipeline', packageId: 'app.crm' };
const PAGE_DRAFT = { status: 'drafted', type: 'page', name: 'crm_home', packageId: 'app.crm' };

describe('the drafted result Preview button (objectui#12968)', () => {
  it.each([
    ['a field draft on an existing object', 'add_field', FIELD_DRAFT, [{ type: 'object', name: 'crm_account' }]],
    ['a view draft', 'create_metadata', VIEW_DRAFT, [{ type: 'view', name: 'crm_account.pipeline' }]],
    ['a page draft', 'create_metadata', PAGE_DRAFT, [{ type: 'page', name: 'crm_home' }]],
  ])('%s draws Preview, and the click hands the host the drafted items and route segment', (_label, toolName, envelope, items) => {
    const onPreviewDraft = vi.fn();
    const onPreviewDraftApp = vi.fn();
    render(
      <ChatbotEnhanced
        messages={[draftedMessage(toolName, envelope)]}
        onPreviewDraft={onPreviewDraft}
        onPreviewDraftApp={onPreviewDraftApp}
        onPublishDrafts={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('draft-preview'));
    expect(onPreviewDraft).toHaveBeenCalledTimes(1);
    expect(onPreviewDraft).toHaveBeenCalledWith(items, { appSegment: 'app.crm' });
    // Not the app door: a non-app draft has no app name to hand it.
    expect(onPreviewDraftApp).not.toHaveBeenCalled();
    expect(screen.queryByTestId('draft-preview-app')).not.toBeInTheDocument();
  });

  it('an app draft keeps the app button and its callback, unchanged', () => {
    const onPreviewDraft = vi.fn();
    const onPreviewDraftApp = vi.fn();
    render(
      <ChatbotEnhanced
        messages={[
          draftedMessage('apply_blueprint', {
            status: 'drafted',
            drafted: [
              { type: 'app', name: 'library' },
              { type: 'object', name: 'fh79_book' },
            ],
            packageId: 'app.fh79',
          }),
        ]}
        onPreviewDraft={onPreviewDraft}
        onPreviewDraftApp={onPreviewDraftApp}
        onPublishDrafts={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('draft-preview')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('draft-preview-app'));
    expect(onPreviewDraftApp).toHaveBeenCalledWith('library', { materialized: false, appSegment: 'app.fh79' });
    expect(onPreviewDraft).not.toHaveBeenCalled();
  });

  it('CONTROL: without onPreviewDraft a non-app draft draws no Preview, as before', () => {
    render(
      <ChatbotEnhanced
        messages={[draftedMessage('add_field', FIELD_DRAFT)]}
        onPreviewDraftApp={vi.fn()}
        onPublishDrafts={vi.fn()}
      />,
    );
    expect(screen.getByTestId('draft-publish')).toBeInTheDocument();
    expect(screen.queryByTestId('draft-preview')).not.toBeInTheDocument();
    expect(screen.queryByTestId('draft-preview-app')).not.toBeInTheDocument();
  });

  it('CONTROL: a draft without an owning package has no route segment, so no Preview', () => {
    const { packageId: _dropped, ...noPackage } = FIELD_DRAFT;
    render(
      <ChatbotEnhanced
        messages={[draftedMessage('add_field', noPackage)]}
        onPreviewDraft={vi.fn()}
        onReviewDraft={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('draft-preview')).not.toBeInTheDocument();
  });

  it('Preview publishes nothing: no publish callback, no request', () => {
    const onPublishDrafts = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    render(
      <ChatbotEnhanced
        messages={[draftedMessage('add_field', FIELD_DRAFT)]}
        onPreviewDraft={vi.fn()}
        onPublishDrafts={onPublishDrafts}
      />,
    );
    fireEvent.click(screen.getByTestId('draft-preview'));
    expect(onPublishDrafts).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
