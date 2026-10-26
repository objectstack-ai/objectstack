/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#12894 (with objectui#12725's item 4) — the copilot's change card
 * and applied card draw the draft posture cloud#2924 sends (the
 * StudioRailCopilot artboard):
 *
 *  - the change card: 「修改方案 · N 项」, one row per change (the ＋ / ✎ / －
 *    symbol, the kind, `object · field`, the type and the row's `details` in
 *    small type), the posture note in amber for a live app with records, and
 *    the primary button labelled by `primaryAction` (存为草稿 for
 *    `save_draft`, the host's label for `confirm`);
 *  - the applied card: `appliedCard.title` and its lines, 查看变更并发布 (the
 *    host's review door) and 撤销 (the host's discard door, which drops EVERY
 *    pending draft of the package, so the card says so and asks first whenever
 *    other drafts are pending).
 *
 * An envelope from an older cloud carries none of the new keys and the card
 * draws as before. Every message goes through the real mapper from a raw tool
 * part, so the lift is under test too.
 */
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import { uiMessageToChatMessage } from '../mapMessages';
import { PACKAGE_ID, draftedEnvelope, proposedEnvelope, type Lang } from './fixtures/changePosture.fixtures';

function inLocale(lang: Lang, ui: React.ReactElement) {
  return (
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>{ui}</I18nProvider>
  );
}

/** The proposal turn: `apply_edit` answered with a `changes_proposed` envelope. */
const proposalTurn = (envelope: unknown) =>
  uiMessageToChatMessage({
    id: 'a1',
    role: 'assistant',
    parts: [
      { type: 'tool-apply_edit', toolCallId: 'call_1', state: 'output-available', input: {}, output: envelope },
    ],
  });

/** The confirm replay of that proposal (`replay_…`), answered with the applied envelope. */
const replayTurn = (envelope: unknown) =>
  uiMessageToChatMessage({
    id: 'a2',
    role: 'assistant',
    parts: [
      { type: 'tool-apply_edit', toolCallId: 'replay_t2_0', state: 'output-available', input: {}, output: envelope },
    ],
  });

describe('objectui#12894 — the change card draws the posture', () => {
  it('zh: 「修改方案 · 2 项」, the rows, the amber note, and 存为草稿 as the primary action', () => {
    render(
      inLocale(
        'zh',
        <ChatbotEnhanced
          messages={[proposalTurn(proposedEnvelope('zh', 'draft'))]}
          onSendMessage={vi.fn()}
          changesConfirmLabel="确认修改"
          planAdjustLabel="调整"
        />,
      ),
    );
    expect(screen.getByTestId('proposed-changes-title')).toHaveTextContent('修改方案 · 2 项');
    const note = screen.getByTestId('proposed-changes-posture-note');
    expect(note).toHaveTextContent('这个应用已上线，有 12 条记录在用。改动先存为草稿');
    expect(note.className).toContain('bg-amber-50');
    expect(screen.getByTestId('proposed-changes-confirm')).toHaveTextContent('存为草稿');
    expect(screen.getByTestId('proposed-changes-confirm')).not.toHaveTextContent('确认修改');
    expect(screen.getByTestId('proposed-changes-adjust')).toHaveTextContent('调整');
  });

  it('zh: one row per change — symbol, kind, object · field, and the type and details in small type', () => {
    render(
      inLocale('zh', <ChatbotEnhanced messages={[proposalTurn(proposedEnvelope('zh', 'draft'))]} onSendMessage={vi.fn()} />),
    );
    const rows = screen.getAllByTestId('proposed-change-row');
    expect(rows).toHaveLength(2);
    const [field, view] = rows.map((r) => within(r));
    expect(rows[0]).toHaveAttribute('data-change', 'add');
    expect(field.getByTestId('proposed-change-symbol')).toHaveTextContent('＋');
    expect(field.getByTestId('proposed-change-kind')).toHaveTextContent('字段');
    expect(field.getByTestId('proposed-change-target')).toHaveTextContent('lib_borrowing_record · renewal_count');
    const params = field.getByTestId('proposed-change-params');
    expect(params).toHaveTextContent('number · 续借次数 · 默认 0 · 不必填');
    expect(params.className).toContain('font-mono');
    expect(rows[1]).toHaveAttribute('data-change', 'modify');
    expect(view.getByTestId('proposed-change-symbol')).toHaveTextContent('✎');
    expect(view.getByTestId('proposed-change-kind')).toHaveTextContent('视图');
    expect(view.getByTestId('proposed-change-target')).toHaveTextContent('borrowing_board');
  });

  it('en: the same card in English', () => {
    render(
      inLocale('en', <ChatbotEnhanced messages={[proposalTurn(proposedEnvelope('en', 'draft'))]} onSendMessage={vi.fn()} />),
    );
    expect(screen.getByTestId('proposed-changes-title')).toHaveTextContent('Change plan · 2 changes');
    expect(screen.getByTestId('proposed-changes-confirm')).toHaveTextContent('Save as draft');
    const [field, view] = screen.getAllByTestId('proposed-change-row').map((r) => within(r));
    expect(field.getByTestId('proposed-change-kind')).toHaveTextContent('Field');
    expect(field.getByTestId('proposed-change-params')).toHaveTextContent('number · Renewals · default 0 · optional');
    expect(view.getByTestId('proposed-change-kind')).toHaveTextContent('View');
  });

  it('a removal row draws the remove symbol', () => {
    const env = {
      ...proposedEnvelope('en', 'draft'),
      changes: [{ verb: 'delete_field', object: 'lib_borrowing_record', field: 'due_date' }],
    };
    render(inLocale('en', <ChatbotEnhanced messages={[proposalTurn(env)]} onSendMessage={vi.fn()} />));
    const row = screen.getByTestId('proposed-change-row');
    expect(row).toHaveAttribute('data-change', 'remove');
    expect(within(row).getByTestId('proposed-change-symbol')).toHaveTextContent('－');
    expect(screen.getByTestId('proposed-changes-title')).toHaveTextContent('Change plan · 1 change');
  });

  it('`confirm` keeps the host label, and the publish posture reads its summary as plain text', () => {
    render(
      inLocale(
        'zh',
        <ChatbotEnhanced
          messages={[proposalTurn(proposedEnvelope('zh', 'publish'))]}
          onSendMessage={vi.fn()}
          changesConfirmLabel="确认修改"
        />,
      ),
    );
    expect(screen.getByTestId('proposed-changes-confirm')).toHaveTextContent('确认修改');
    expect(screen.queryByTestId('proposed-changes-posture-note')).not.toBeInTheDocument();
    expect(screen.getByTestId('proposed-changes-summary')).toHaveTextContent('应用前请确认这次改动。');
    expect(screen.getByTestId('proposed-changes-title')).toHaveTextContent('修改方案 · 2 项');
  });

  it('存为草稿 sends the same approval the host gave for Confirm: the cloud gate reads that text', () => {
    const onSendMessage = vi.fn();
    render(
      inLocale(
        'zh',
        <ChatbotEnhanced
          messages={[proposalTurn(proposedEnvelope('zh', 'draft'))]}
          onSendMessage={onSendMessage}
          changesConfirmMessage="确认修改，应用你刚才提议的改动。"
        />,
      ),
    );
    fireEvent.click(screen.getByTestId('proposed-changes-confirm'));
    expect(onSendMessage).toHaveBeenCalledWith('确认修改，应用你刚才提议的改动。');
  });

  it('an older cloud (no posture) draws the card as before: the host title, the v1 rows, the host label', () => {
    render(
      <ChatbotEnhanced
        messages={[proposalTurn(proposedEnvelope('en', 'absent'))]}
        onSendMessage={vi.fn()}
        changesTitleLabel="Confirm changes"
        changesConfirmLabel="Confirm"
      />,
    );
    const card = screen.getByTestId('proposed-changes');
    expect(card).toHaveTextContent('Confirm changes');
    expect(card).toHaveTextContent('Add field lib_borrowing_record.renewal_count (number) Renewals · default 0 · optional');
    expect(screen.queryByTestId('proposed-changes-title')).not.toBeInTheDocument();
    expect(screen.queryByTestId('proposed-change-row')).not.toBeInTheDocument();
    expect(screen.getByTestId('proposed-changes-confirm')).toHaveTextContent('Confirm');
  });
});

describe('objectui#12894 — the applied card of a change saved as a draft', () => {
  const renderApplied = (
    lang: Lang,
    replay: unknown,
    props: Partial<React.ComponentProps<typeof ChatbotEnhanced>> = {},
  ) =>
    render(
      inLocale(
        lang,
        <ChatbotEnhanced
          messages={[proposalTurn(proposedEnvelope(lang, 'draft')), replayTurn(replay)]}
          onSendMessage={vi.fn()}
          {...props}
        />,
      ),
    );

  it('zh: the title and lines as the producer wrote them, 查看变更并发布 and 撤销', () => {
    const onReviewDrafts = vi.fn();
    const onDiscardDrafts = vi.fn(async () => true);
    renderApplied('zh', draftedEnvelope('zh'), { onReviewDrafts, onDiscardDrafts, onPublishDrafts: vi.fn() });
    expect(screen.getByTestId('applied-card-title')).toHaveTextContent('已存为草稿 · 1 项未发布');
    expect(screen.getAllByTestId('applied-card-line').map((l) => l.textContent)).toEqual([
      '已有 12 条记录的续借次数为空',
      '核对：结构 ✓',
    ]);
    expect(screen.getByTestId('applied-card-review')).toHaveTextContent('查看变更并发布');
    expect(screen.getByTestId('applied-card-discard')).toHaveTextContent('撤销');
    // The review door takes the inline publish button's place.
    expect(screen.queryByTestId('proposed-changes-publish')).not.toBeInTheDocument();
    // …and the drafted badge's: the card's title says what happened.
    expect(screen.queryByTestId('proposed-changes-drafted')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('applied-card-review'));
    expect(onReviewDrafts).toHaveBeenCalledWith(PACKAGE_ID);
  });

  it('en: the same card in English', () => {
    renderApplied('en', draftedEnvelope('en'), { onReviewDrafts: vi.fn(), onDiscardDrafts: vi.fn() });
    expect(screen.getByTestId('applied-card-title')).toHaveTextContent('Saved as a draft · 1 unpublished change(s)');
    expect(screen.getByTestId('applied-card-review')).toHaveTextContent('Review changes and publish');
    expect(screen.getByTestId('applied-card-discard')).toHaveTextContent('Undo');
  });

  it('撤销 with no other draft pending runs the discard door at once, with the package id', async () => {
    const onDiscardDrafts = vi.fn(async () => ({ ok: true }));
    renderApplied('zh', draftedEnvelope('zh', { others: 0 }), { onDiscardDrafts });
    await act(async () => {
      fireEvent.click(screen.getByTestId('applied-card-discard'));
    });
    expect(onDiscardDrafts).toHaveBeenCalledTimes(1);
    expect(onDiscardDrafts).toHaveBeenCalledWith(PACKAGE_ID);
    expect(screen.getByTestId('applied-card-discarded')).toHaveTextContent('已撤销');
    expect(screen.queryByTestId('applied-card-discard')).not.toBeInTheDocument();
  });

  it('撤销 with other drafts pending says so, and asks with the counts before it runs', async () => {
    const onDiscardDrafts = vi.fn(async () => true);
    renderApplied('zh', draftedEnvelope('zh', { others: 2 }), { onDiscardDrafts });
    expect(screen.getByTestId('applied-card-discard')).toHaveTextContent('撤销（连同另外 2 项草稿）');
    await act(async () => {
      fireEvent.click(screen.getByTestId('applied-card-discard'));
    });
    expect(onDiscardDrafts).not.toHaveBeenCalled();
    expect(screen.getByTestId('applied-card-discard-confirm-text')).toHaveTextContent(
      '撤销会丢弃这个应用包全部 3 项未发布的草稿，其中 2 项不属于这次修改。',
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('applied-card-discard-confirm-run'));
    });
    expect(onDiscardDrafts).toHaveBeenCalledWith(PACKAGE_ID);
    expect(screen.getByTestId('applied-card-discarded')).toBeInTheDocument();
  });

  it('en: the button and the confirm name the other drafts in English; cancelling runs nothing', async () => {
    const onDiscardDrafts = vi.fn();
    renderApplied('en', draftedEnvelope('en', { others: 1 }), { onDiscardDrafts });
    expect(screen.getByTestId('applied-card-discard')).toHaveTextContent('Undo (and 1 other draft)');
    await act(async () => {
      fireEvent.click(screen.getByTestId('applied-card-discard'));
    });
    expect(screen.getByTestId('applied-card-discard-confirm-text')).toHaveTextContent(
      'Undo discards all 2 unpublished drafts of this package, including 1 that is not part of this change.',
    );
    fireEvent.click(screen.getByTestId('applied-card-discard-cancel'));
    expect(screen.queryByTestId('applied-card-discard-confirm')).not.toBeInTheDocument();
    expect(screen.getByTestId('applied-card-discard')).toBeInTheDocument();
    expect(onDiscardDrafts).not.toHaveBeenCalled();
  });

  it('the live count wins over the snapshot: a later change staged more drafts, so 撤销 asks', async () => {
    const onDiscardDrafts = vi.fn(async () => true);
    // The snapshot says only this change was pending; the package holds 3 now.
    const fetchPendingDraftCount = vi.fn(async () => 3);
    renderApplied('zh', draftedEnvelope('zh', { others: 0 }), { onDiscardDrafts, fetchPendingDraftCount });
    await act(async () => {
      fireEvent.click(screen.getByTestId('applied-card-discard'));
    });
    expect(fetchPendingDraftCount).toHaveBeenCalledWith(PACKAGE_ID);
    expect(onDiscardDrafts).not.toHaveBeenCalled();
    expect(screen.getByTestId('applied-card-discard-confirm-text')).toHaveTextContent(
      '撤销会丢弃这个应用包全部 3 项未发布的草稿，其中 2 项不属于这次修改。',
    );
  });

  it('the live count confirming only this change is pending runs at once', async () => {
    const onDiscardDrafts = vi.fn(async () => true);
    renderApplied('zh', draftedEnvelope('zh', { others: 0 }), {
      onDiscardDrafts,
      fetchPendingDraftCount: vi.fn(async () => 1),
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('applied-card-discard'));
    });
    expect(onDiscardDrafts).toHaveBeenCalledWith(PACKAGE_ID);
  });

  it('no draft state and no live count: 撤销 cannot tell what else is pending, so it asks', async () => {
    const onDiscardDrafts = vi.fn(async () => true);
    renderApplied('zh', draftedEnvelope('zh', { withDraftState: false }), { onDiscardDrafts });
    await act(async () => {
      fireEvent.click(screen.getByTestId('applied-card-discard'));
    });
    expect(onDiscardDrafts).not.toHaveBeenCalled();
    expect(screen.getByTestId('applied-card-discard-confirm-text')).toHaveTextContent(
      '撤销会丢弃这个应用包里全部未发布的草稿，不只是这次修改。',
    );
  });

  it('a refused discard says so, with the host reason, and keeps 撤销', async () => {
    const onDiscardDrafts = vi.fn(async () => ({ ok: false, error: 'forbidden' }));
    renderApplied('zh', draftedEnvelope('zh'), { onDiscardDrafts });
    await act(async () => {
      fireEvent.click(screen.getByTestId('applied-card-discard'));
    });
    const failed = screen.getByTestId('applied-card-discard-failed');
    expect(failed).toHaveTextContent('撤销失败');
    expect(failed).toHaveTextContent('forbidden');
    expect(screen.getByTestId('applied-card-discard')).toBeInTheDocument();
    expect(screen.queryByTestId('applied-card-discarded')).not.toBeInTheDocument();
  });

  it('without a review door the inline Publish keeps its place; without a discard door there is no 撤销', () => {
    const onPublishDrafts = vi.fn(async () => true);
    renderApplied('zh', draftedEnvelope('zh'), { onPublishDrafts, publishDraftsLabel: '发布' });
    expect(screen.getByTestId('applied-card-title')).toBeInTheDocument();
    expect(screen.queryByTestId('applied-card-review')).not.toBeInTheDocument();
    expect(screen.queryByTestId('applied-card-discard')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('proposed-changes-publish'));
    expect(onPublishDrafts).toHaveBeenCalledWith(PACKAGE_ID);
  });

  it('an older cloud drafted replay draws the drafted badge and Publish, as before', () => {
    const onPublishDrafts = vi.fn(async () => true);
    renderApplied('en', draftedEnvelope('en', { withCard: false }), {
      onPublishDrafts,
      onReviewDrafts: vi.fn(),
      onDiscardDrafts: vi.fn(),
    });
    expect(screen.queryByTestId('applied-card')).not.toBeInTheDocument();
    expect(screen.getByTestId('proposed-changes-drafted')).toHaveTextContent('Saved as draft');
    fireEvent.click(screen.getByTestId('proposed-changes-publish'));
    expect(onPublishDrafts).toHaveBeenCalledWith(PACKAGE_ID);
  });
});
