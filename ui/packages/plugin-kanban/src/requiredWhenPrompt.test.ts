/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The pre-evaluation half of objectui#4254, pinned directly.
 *
 * The board-level test (`ObjectKanban.requiredWhenPrompt.test.tsx`) drives the
 * whole flow through a real drop; this file pins the SET the flow is built on,
 * because several of its exclusions are decisions rather than mechanics and two
 * of them (`visibleWhen` FALSE, `readonlyWhen` TRUE) cannot be told apart from
 * "no dialog appeared" through the DOM.
 *
 * Every case here is GREEN only with the module present — the module is the
 * change — so the direction that matters is the reverse verification recorded
 * in the PR: deleting the `requiredWhen` limb turns the board test red.
 */

import { describe, it, expect } from 'vitest';
import { collectRequiredWhenPromptFields } from './requiredWhenPrompt';

/** The card's own predicate: `has()` + `==` + `&&`. */
const WHEN_WON = 'has(record.stage) && record.stage == "closed_won"';

const record = { id: 'o1', stage: 'negotiation', win_reason: null };

function fields(winReason: Record<string, unknown>) {
  return {
    stage: { type: 'picklist', label: 'Stage' },
    win_reason: { type: 'text', label: 'Win Reason', ...winReason },
  };
}

describe('collectRequiredWhenPromptFields (#4254)', () => {
  it('collects a field the target value makes required while empty', () => {
    const out = collectRequiredWhenPromptFields(
      fields({ requiredWhen: WHEN_WON }),
      record,
      'stage',
      'closed_won',
    );
    expect(out.map((f) => f.name)).toEqual(['win_reason']);
    // The definition travels with it so the dialog can render the right widget.
    expect(out[0].def).toMatchObject({ name: 'win_reason', type: 'text' });
  });

  it('collects nothing when the target value leaves the predicate FALSE', () => {
    expect(
      collectRequiredWhenPromptFields(
        fields({ requiredWhen: WHEN_WON }),
        { ...record, stage: 'closed_won' },
        'stage',
        'negotiation',
      ),
    ).toEqual([]);
  });

  it('skips a required field that already has a value', () => {
    expect(
      collectRequiredWhenPromptFields(
        fields({ requiredWhen: WHEN_WON }),
        { ...record, win_reason: 'Better price' },
        'stage',
        'closed_won',
      ),
    ).toEqual([]);
  });

  it('treats false and 0 as VALUES, not absences', () => {
    // The presence contract core/objectql share — a required checkbox whose
    // answer is "no" is answered, and zero hours logged is data.
    for (const value of [false, 0]) {
      expect(
        collectRequiredWhenPromptFields(
          { stage: {}, flag: { type: 'boolean', requiredWhen: WHEN_WON } },
          { stage: 'negotiation', flag: value },
          'stage',
          'closed_won',
        ),
      ).toEqual([]);
    }
  });

  it('skips a field the record form would not show (visibleWhen FALSE)', () => {
    expect(
      collectRequiredWhenPromptFields(
        fields({ requiredWhen: WHEN_WON, visibleWhen: 'false' }),
        record,
        'stage',
        'closed_won',
      ),
    ).toEqual([]);
  });

  it('skips a readonly field — there is nothing the user could author', () => {
    expect(
      collectRequiredWhenPromptFields(
        fields({ requiredWhen: WHEN_WON, readonlyWhen: 'true' }),
        record,
        'stage',
        'closed_won',
      ),
    ).toEqual([]);
  });

  it('skips a type with no edit widget, leaving the server refusal to speak', () => {
    expect(
      collectRequiredWhenPromptFields(
        fields({ type: 'file', requiredWhen: WHEN_WON }),
        record,
        'stage',
        'closed_won',
      ),
    ).toEqual([]);
  });

  it('never prompts for the groupBy field itself — the drop IS its value', () => {
    expect(
      collectRequiredWhenPromptFields(
        { stage: { type: 'picklist', requiredWhen: WHEN_WON } },
        { stage: null },
        'stage',
        'closed_won',
      ),
    ).toEqual([]);
  });

  it('ignores fields with no requiredWhen predicate at all', () => {
    expect(
      collectRequiredWhenPromptFields(
        { stage: {}, note: { type: 'text', required: true } },
        { stage: 'negotiation', note: null },
        'stage',
        'closed_won',
      ),
    ).toEqual([]);
  });

  it('returns [] rather than throwing on absent metadata or record', () => {
    expect(collectRequiredWhenPromptFields(undefined, record, 'stage', 'x')).toEqual([]);
    expect(collectRequiredWhenPromptFields(fields({}), undefined, 'stage', 'x')).toEqual([]);
  });

  it('keeps the object’s declared field order', () => {
    const out = collectRequiredWhenPromptFields(
      {
        stage: {},
        b_field: { type: 'text', requiredWhen: WHEN_WON },
        a_field: { type: 'text', requiredWhen: WHEN_WON },
      },
      { stage: 'negotiation', a_field: null, b_field: null },
      'stage',
      'closed_won',
    );
    expect(out.map((f) => f.name)).toEqual(['b_field', 'a_field']);
  });

  it('fails OPEN on a broken predicate — a typo must not block the move', () => {
    // Same direction as the record form: an unevaluable predicate resolves to
    // the safe default (not required), so a metadata typo cannot wedge a board.
    expect(
      collectRequiredWhenPromptFields(
        fields({ requiredWhen: 'this is not ( valid CEL' }),
        record,
        'stage',
        'closed_won',
      ),
    ).toEqual([]);
  });
});
