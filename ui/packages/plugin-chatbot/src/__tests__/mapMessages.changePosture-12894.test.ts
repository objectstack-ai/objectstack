/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectui#12894 — the two mappers keep the keys cloud#2924 declares on the
 * copilot's change envelopes, and only those:
 *
 *  - `detectProposedChanges` keeps `posture` (`mode`, `liveRecords`,
 *    `platformPackage?`, `buildTurnRows?`) and `primaryAction` beside the
 *    `summary` and the rows (with their `details`) it kept before;
 *  - `detectReplayOutcome` keeps `draftState`, `existingRows` and
 *    `appliedCard` on a `drafted` replay.
 *
 * Each absent key degrades to the shape an older cloud produced, and a value
 * that does not carry its declared required members is dropped whole rather
 * than half-read. The envelopes are the producer's (`fixtures/changePosture.fixtures.ts`).
 */
import { describe, expect, it } from 'vitest';
import { detectProposedChanges, detectReplayOutcome, uiMessageToChatMessage } from '../mapMessages';
import { BORROWING, PACKAGE_ID, changeRows, draftedEnvelope, proposedEnvelope } from './fixtures/changePosture.fixtures';

/** The SDK's `{ type: 'text', value }` wrapper a real tool part carries. */
const wrapped = (env: unknown) => ({ type: 'text', value: JSON.stringify(env) });

describe('objectui#12894 — detectProposedChanges keeps the posture and the primary action', () => {
  it('a change to a live app with records: posture draft, save_draft, the ruled note, the rows with details', () => {
    const out = detectProposedChanges(wrapped(proposedEnvelope('zh', 'draft')));
    expect(out).toEqual({
      summary:
        '这个应用已上线，有 12 条记录在用。改动先存为草稿；画布和右侧属性里能看到效果，你在「变更」里核对后再发布。',
      changes: changeRows('zh'),
      posture: { mode: 'draft', liveRecords: 12 },
      primaryAction: 'save_draft',
    });
    // The row's parameters ride `details` as the producer wrote them.
    expect(out!.changes[0].details).toBe('续借次数 · 默认 0 · 不必填');
  });

  it('a change that publishes: posture publish, confirm', () => {
    const out = detectProposedChanges(proposedEnvelope('en', 'publish'));
    expect(out?.posture).toEqual({ mode: 'publish', liveRecords: 0 });
    expect(out?.primaryAction).toBe('confirm');
    expect(out?.summary).toBe('Confirm this change before it is applied.');
  });

  it('keeps the optional posture members the producer declares, and only when well-formed', () => {
    const env = proposedEnvelope('en', 'publish');
    const withExtras = {
      ...env,
      posture: { mode: 'publish', liveRecords: 0, platformPackage: true, buildTurnRows: 24 },
    };
    expect(detectProposedChanges(withExtras)?.posture).toEqual({
      mode: 'publish',
      liveRecords: 0,
      platformPackage: true,
      buildTurnRows: 24,
    });
    const malformedExtras = {
      ...env,
      posture: { mode: 'publish', liveRecords: 0, platformPackage: 'yes', buildTurnRows: -1 },
    };
    expect(detectProposedChanges(malformedExtras)?.posture).toEqual({ mode: 'publish', liveRecords: 0 });
  });

  it('an older cloud (no posture, no primaryAction) lifts exactly what it lifted before', () => {
    const out = detectProposedChanges(proposedEnvelope('en', 'absent'));
    expect(out).toEqual({ summary: 'Confirm this change before it is applied.', changes: changeRows('en') });
    expect(out).not.toHaveProperty('posture');
    expect(out).not.toHaveProperty('primaryAction');
  });

  it('a posture without its declared required pair is not a posture; an undeclared action is not an action', () => {
    const env = proposedEnvelope('zh', 'draft');
    for (const posture of [
      { mode: 'draft' },
      { liveRecords: 12 },
      { mode: 'live', liveRecords: 12 },
      { mode: 'draft', liveRecords: '12' },
      { mode: 'draft', liveRecords: 1.5 },
      'draft',
      null,
    ]) {
      expect(detectProposedChanges({ ...env, posture }), JSON.stringify(posture)).not.toHaveProperty('posture');
    }
    for (const primaryAction of ['publish', 'SAVE_DRAFT', '', 1, true]) {
      expect(detectProposedChanges({ ...env, primaryAction }), String(primaryAction)).not.toHaveProperty(
        'primaryAction',
      );
    }
  });

  it('keeps no other envelope key: the model note and the applied flag stay behind', () => {
    const out = detectProposedChanges(proposedEnvelope('zh', 'draft'))!;
    expect(Object.keys(out).sort()).toEqual(['changes', 'posture', 'primaryAction', 'summary']);
  });
});

describe('objectui#12894 — detectReplayOutcome keeps the applied card of a change saved as a draft', () => {
  it('a drafted replay: draftState, existingRows and appliedCard, beside the package', () => {
    const out = detectReplayOutcome('replay_turn_0', wrapped(draftedEnvelope('zh', { others: 1 })));
    expect(out).toEqual({
      kind: 'drafted',
      packageId: PACKAGE_ID,
      // objectui#12968 — the items this replay drafted, for the card's Preview.
      items: [{ type: 'object', name: BORROWING }],
      draftState: {
        pending: 2,
        items: [
          { type: 'object', name: BORROWING },
          { type: 'view', name: `${BORROWING}.list_0` },
        ],
        others: 1,
      },
      existingRows: [{ object: BORROWING, field: 'renewal_count', label: '续借次数', rows: 12 }],
      appliedCard: { title: '已存为草稿 · 2 项未发布', lines: ['已有 12 条记录的续借次数为空', '核对：结构 ✓'] },
    });
  });

  it('an older cloud drafted replay lifts none of the cloud#2924 keys', () => {
    const out = detectReplayOutcome('replay_turn_0', draftedEnvelope('en', { withCard: false }));
    // `items` is objectui#12968's lift of `drafted[]`, which every cloud sends.
    expect(out).toEqual({ kind: 'drafted', packageId: PACKAGE_ID, items: [{ type: 'object', name: BORROWING }] });
  });

  it('each key degrades on its own: a card without a draft state keeps the card', () => {
    const out = detectReplayOutcome('replay_turn_0', draftedEnvelope('en', { withDraftState: false }));
    expect(out).toMatchObject({ kind: 'drafted', appliedCard: { title: 'Saved as a draft · 1 unpublished change(s)' } });
    expect(out).not.toHaveProperty('draftState');
    expect(out?.existingRows).toHaveLength(1);
  });

  it('a draft state without both counts, a card without a title, and malformed rows are dropped whole', () => {
    const env = draftedEnvelope('zh', { others: 1 });
    const out = detectReplayOutcome('replay_turn_0', {
      ...env,
      draftState: { pending: 2, items: [] },
      appliedCard: { lines: ['已有 12 条记录的续借次数为空'] },
      existingRows: [{ object: BORROWING, field: 'renewal_count', rows: 12 }, 'x'],
    });
    expect(out).toEqual({ kind: 'drafted', packageId: PACKAGE_ID, items: [{ type: 'object', name: BORROWING }] });
  });

  it('a card keeps only its string lines; a draft state only its well-formed items', () => {
    const env = draftedEnvelope('zh', { others: 0 });
    const out = detectReplayOutcome('replay_turn_0', {
      ...env,
      draftState: { pending: 1, items: [{ type: 'object', name: BORROWING }, { type: 'view' }, null], others: 0 },
      appliedCard: { title: '已存为草稿 · 1 项未发布', lines: ['核对：结构 ✓', '', 3, null] },
    });
    expect(out?.draftState).toEqual({ pending: 1, items: [{ type: 'object', name: BORROWING }], others: 0 });
    expect(out?.appliedCard).toEqual({ title: '已存为草稿 · 1 项未发布', lines: ['核对：结构 ✓'] });
  });

  it('the applied card rides only a drafted outcome: a published or failed replay keeps its old shape', () => {
    const env = draftedEnvelope('zh');
    expect(detectReplayOutcome('replay_turn_0', { ...env, status: 'published' })).toEqual({ kind: 'published' });
    expect(
      detectReplayOutcome('replay_turn_0', { ...env, publishFailed: true, publishOutcome: 'rolled_back' }),
    ).toEqual({ kind: 'failed', outcome: 'rolled_back', packageId: PACKAGE_ID });
  });

  it('a non-replay tool call is not a replay outcome, whatever it carries', () => {
    expect(detectReplayOutcome('call_1', draftedEnvelope('zh'))).toBeUndefined();
  });
});

describe('objectui#12894 — the live mapper carries both lifts onto the invocation', () => {
  it('a raw proposal part and its replay part map to proposedChanges and replayOutcome', () => {
    const msg = uiMessageToChatMessage({
      id: 'm1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-apply_edit',
          toolCallId: 'call_1',
          state: 'output-available',
          input: {},
          output: wrapped(proposedEnvelope('zh', 'draft')),
        },
        {
          type: 'tool-apply_edit',
          toolCallId: 'replay_turn_0',
          state: 'output-available',
          input: {},
          output: wrapped(draftedEnvelope('zh')),
        },
      ],
    });
    const [proposal, replay] = msg.toolInvocations ?? [];
    expect(proposal.proposedChanges?.primaryAction).toBe('save_draft');
    expect(proposal.proposedChanges?.posture).toEqual({ mode: 'draft', liveRecords: 12 });
    expect(replay.replayOutcome?.appliedCard?.title).toBe('已存为草稿 · 1 项未发布');
    // A matched replay never doubles as an ordinary draft card.
    expect(replay.draftReview).toBeUndefined();
  });
});
