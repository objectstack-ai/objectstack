/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#25887 — a whole-app build that ran as a confirm-replay draws the
 * same result card as a model-driven one.
 *
 * Approving the proposed plan sends the approval sentence, and the runtime
 * replays the approved `apply_blueprint` under a synthetic `replay_` tool-call
 * id. A replay streams no `data-build-progress` frames, and the mapper used to
 * suppress the draft review of every `replay_` result (objectui#5695, there to
 * keep a live Publish off a rolled-back confirm card). So the build's own
 * envelope, `drafted[]`, `packageId`, `checklist` and `nextSteps` included,
 * reached `tool.result` and was drawn nowhere: no result card, no 打开应用, no
 * checklist, no next steps, live or after a reload.
 *
 * Each message goes through the real mapper from a raw tool part, in the
 * shapes the result arrives in: the live stream's object, and the stored
 * tool row's `{type:'json'}` and `{type:'text'}` wrappers. The envelope is the
 * vendored `build-cards` fixture; the producer lives outside this repository.
 */
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import { uiMessageToChatMessage } from '../mapMessages';
import { applyEnvelope } from './fixtures/buildCards.fixtures';

const NEXT = '接下来可以说：「给借阅记录加续借次数」 「做一个本月借出统计的仪表盘」 「只允许管理员删除图书」';

/** The assistant turn the replay appends: one `apply_blueprint` under a `replay_` id. */
const replayTurn = (output: unknown) =>
  uiMessageToChatMessage({
    id: 'replayed',
    role: 'assistant',
    parts: [
      {
        type: 'tool-apply_blueprint',
        toolCallId: 'replay_BFpdNra4mJHv5BMH_0',
        state: 'output-available',
        input: {},
        output,
      },
    ],
  });

const renderZh = (output: unknown, props: { onOpenBuiltApp?: (app: string) => void } = {}) =>
  render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <ChatbotEnhanced messages={[replayTurn(output)]} onOpenBuiltApp={props.onOpenBuiltApp ?? vi.fn()} />
    </I18nProvider>,
  );

describe('a replayed whole-app apply_blueprint draws the result card (objectstack#25887)', () => {
  it.each([
    ['live: the streamed envelope object', applyEnvelope('zh')],
    ['reload: the stored json wrapper', { type: 'json', value: applyEnvelope('zh') }],
    ['reload: the stored text wrapper', { type: 'text', value: JSON.stringify(applyEnvelope('zh')) }],
  ])('%s — the card, its checklist, its next steps and 打开应用', (_shape, output) => {
    const onOpenBuiltApp = vi.fn();
    renderZh(output, { onOpenBuiltApp });
    expect(screen.getByTestId('build-progress-title')).toHaveTextContent('图书借阅管理');
    expect(screen.getByTestId('build-checklist-chip')).toHaveTextContent(/^核对通过 7\/7$/);
    expect(screen.getByTestId('build-result-next-steps')).toHaveTextContent(NEXT);
    fireEvent.click(screen.getByTestId('build-progress-open-app'));
    expect(onOpenBuiltApp).toHaveBeenCalledWith('library_app');
  });

  it('the auto-publish posture: a published replay envelope draws the card and its next steps', () => {
    renderZh({ ...applyEnvelope('zh'), status: 'published' });
    expect(screen.getByTestId('build-progress-title')).toHaveTextContent('图书借阅管理');
    expect(screen.getByTestId('build-checklist-chip')).toHaveTextContent(/^核对通过 7\/7$/);
    expect(screen.getByTestId('build-result-next-steps')).toHaveTextContent(NEXT);
  });

  it('a replay whose in-turn publish rolled back still draws no result card', () => {
    renderZh({ ...applyEnvelope('zh'), publishFailed: true, publishOutcome: 'rolled_back', publishError: 'boom' });
    expect(screen.queryByTestId('build-progress-title')).not.toBeInTheDocument();
    expect(screen.queryByTestId('build-result-next-steps')).not.toBeInTheDocument();
  });

  it('a replayed incremental edit (kind edit) is still not a build', () => {
    renderZh({ ...applyEnvelope('zh'), kind: 'edit' });
    expect(screen.queryByTestId('build-progress-title')).not.toBeInTheDocument();
  });
});

describe('the mapper keeps the replay verdict and lifts the build (objectstack#25887)', () => {
  it('a drafted whole-app replay carries both its replayOutcome and its draftReview', () => {
    const msg = replayTurn(applyEnvelope('zh'));
    const tool = msg.toolInvocations?.[0];
    expect(tool?.replayOutcome).toMatchObject({ kind: 'drafted', packageId: 'app.hcpl' });
    expect(tool?.draftReview).toMatchObject({ packageId: 'app.hcpl', autoPublishable: true });
    expect(tool?.draftReview?.nextSteps).toEqual(applyEnvelope('zh').nextSteps);
    expect(msg.buildProgress).toMatchObject({ phase: 'done' });
  });

  it('a published whole-app replay lifts no draftReview (nothing left to publish) but a done tree', () => {
    const msg = replayTurn({ ...applyEnvelope('zh'), status: 'published' });
    expect(msg.toolInvocations?.[0]?.replayOutcome).toMatchObject({ kind: 'published' });
    expect(msg.toolInvocations?.[0]?.draftReview).toBeUndefined();
    expect(msg.buildProgress).toMatchObject({ phase: 'done' });
  });

  it('a failed replay keeps the objectui#5695 suppression: no draftReview, no tree', () => {
    const msg = replayTurn({ ...applyEnvelope('zh'), publishFailed: true });
    expect(msg.toolInvocations?.[0]?.replayOutcome).toMatchObject({ kind: 'failed' });
    expect(msg.toolInvocations?.[0]?.draftReview).toBeUndefined();
    expect(msg.buildProgress).toBeUndefined();
  });

  it('a replayed non-build draft (no app in drafted[]) keeps the suppression', () => {
    const msg = replayTurn({ status: 'drafted', packageId: 'app.k9', drafted: [{ type: 'view', name: 'v' }] });
    expect(msg.toolInvocations?.[0]?.replayOutcome).toMatchObject({ kind: 'drafted' });
    expect(msg.toolInvocations?.[0]?.draftReview).toBeUndefined();
  });
});
