/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `record:path.stages` — the MEMBER shape, not the row layout (objectui#8071)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The per-block member pin objectui#8068 asks for on this key: `stages` is
 * declared `type: 'array', of: 'object'` with the member set spelled only in
 * its description (`[{ value, label }]`), and until this file nothing asserted
 * WHICH members `record-path.tsx` reads or what each one decides.
 *
 * ## Why the existing `record:path` suites are not this pin
 *
 * Six of them mount `stages[]` and were read end to end before this file was
 * written rather than credited on their fixtures: `stageStateAccessibleName`
 * (+`.i18n`), `wonTerminusAccessibleName`, `containerLabel`, `inertReadout`
 * and `crossRowClassification`. Every one uses `stages` as a FIXTURE for a
 * different subject — an accessible name's composition, the container's label,
 * the readout staying non-interactive, the two rows agreeing with each other.
 * `crossRowClassification` comes closest and is still explicitly a CROSS-ROW
 * invariant: it asserts desktop and mobile report the SAME classification, a
 * property that holds just as well if both rows read the wrong member. None
 * asserts the precedence below, and none would fail if `value`, `label` or
 * `terminal` swapped roles. So this is a new file rather than a promotion.
 *
 * ## What is pinned, member by member
 *
 *   • `value`   — stage IDENTITY. It is compared against the record's
 *                 `statusField` value to choose the current stage, and it is
 *                 not what the user reads.
 *   • `label`   — the stage's rendered TEXT, and only that.
 *   • `terminal`— `'won' | 'lost'`, honoured BEFORE the label/value heuristic.
 *
 * Each leg carries the counter-probe that makes it a measurement. The
 * `terminal` legs matter most: `classify()` tries `s.terminal` first and falls
 * back to `WON_TOKENS` / `LOST_TOKENS` over `value + label`, so a fixture whose
 * explicit `terminal` AGREES with what the heuristic would have guessed cannot
 * tell the two apart. Both `terminal` cases below therefore CONTRADICT the
 * heuristic, and each is paired with the identical stage minus `terminal` to
 * show the heuristic really was pointing the other way.
 *
 * ## Resolution
 *
 * Nothing here resolves through any `dist/`: `../record-path` is this package's
 * own source and `@object-ui/react` / `@object-ui/i18n` are mapped to their
 * `src` by the root `vitest.config.mts` alias table. An ablation of
 * `record-path.tsx` is visible to this suite without a rebuild.
 */

import * as React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup, within, type RenderResult } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { RecordContextProvider } from '@object-ui/react';
import { RecordPathRenderer } from '../record-path';

type Stage = { value: string; label: string; terminal?: 'won' | 'lost' };

function mount(stages: readonly Stage[], status: string | undefined = 'draft'): RenderResult {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <RecordContextProvider objectName="crm_quote" recordId="q1" data={{ id: 'q1', status }}>
        <RecordPathRenderer schema={{ statusField: 'status', stages } as never} />
      </RecordContextProvider>
    </I18nProvider>,
  );
}

/**
 * The DESKTOP row only. Both rows are in the DOM at once (they are separated by
 * a CSS breakpoint jsdom does not apply) and `crossRowClassification` already
 * owns the invariant that they agree — reading one row here keeps this file
 * about the member shape instead of re-pinning that.
 */
const stagesOf = (r: RenderResult): HTMLElement[] => {
  const row = r.container.querySelectorAll('[role="list"]')[0] as HTMLElement;
  return within(row).getAllByRole('listitem');
};

const stateOf = (el: HTMLElement) => el.getAttribute('data-stage-state');
const terminalOf = (el: HTMLElement) => el.getAttribute('data-stage-terminal');

beforeEach(() => {
  cleanup();
});

describe('`record:path.stages` member `value` is the stage IDENTITY (objectui#8071)', () => {
  const STAGES: Stage[] = [
    { value: 'draft', label: 'Drafting' },
    { value: 'review', label: 'In review' },
    { value: 'signed', label: 'Signed off' },
  ];

  it('the stage whose `value` equals the record\'s statusField is the current one', () => {
    const items = stagesOf(mount(STAGES, 'review'));
    expect(items.map(stateOf)).toEqual(['completed', 'current', 'upcoming']);
  });

  it('CONTROL — moving the RECORD, not the array, moves `current`', () => {
    // Without this the leg above is satisfiable by "index 1 is always current".
    // Same `stages[]`, a different record value, a different current stage.
    expect(stagesOf(mount(STAGES, 'draft')).map(stateOf))
      .toEqual(['current', 'upcoming', 'upcoming']);
    expect(stagesOf(mount(STAGES, 'signed')).map(stateOf))
      .toEqual(['completed', 'completed', 'current']);
  });

  it('a statusField value matching no `value` leaves NO stage current', () => {
    // The member is matched, not merely counted: an unrecognised record value
    // selects nothing rather than defaulting to the first stage.
    const items = stagesOf(mount(STAGES, 'archived_elsewhere'));
    expect(items.map(stateOf)).toEqual(['upcoming', 'upcoming', 'upcoming']);
  });

  it('`value` is matched, NOT `label` — the two are not interchangeable', () => {
    // The discriminating fixture: the record carries a string that is some
    // stage's LABEL. If the renderer matched on `label` this would go current.
    const items = stagesOf(mount(STAGES, 'In review'));
    expect(items.map(stateOf)).toEqual(['upcoming', 'upcoming', 'upcoming']);
  });
});

describe('`record:path.stages` member `label` is the rendered TEXT (objectui#8071)', () => {
  const STAGES: Stage[] = [
    { value: 'stage_one_value', label: 'Qualification' },
    { value: 'stage_two_value', label: 'Proposal' },
  ];

  it('renders every `label`, and never the `value` that carries it', () => {
    const items = stagesOf(mount(STAGES, 'stage_one_value'));
    expect(items.map((el) => el.textContent)).toEqual(['Qualification', 'Proposal']);
    // The counter-probe: the values are deliberately distinguishable strings,
    // so "the label is shown" cannot be satisfied by showing both.
    for (const el of items) {
      expect(el.textContent).not.toContain('stage_one_value');
      expect(el.textContent).not.toContain('stage_two_value');
    }
  });

  it('renders one listitem per member, in the authored order', () => {
    // Non-vacuity for the whole file: an empty or dropped array would make
    // every `toEqual([])` above pass on nothing.
    expect(stagesOf(mount(STAGES, 'stage_one_value'))).toHaveLength(2);
    // The record points at the FIRST member of the reversed array on purpose:
    // a `completed` stage also renders a `\u2713` glyph inside its listitem, so a
    // fixture with a completed stage would be asserting the checkmark here
    // rather than the order. Nothing is completed in this arrangement.
    const reversed = [...STAGES].reverse();
    expect(stagesOf(mount(reversed, 'stage_two_value')).map((el) => el.textContent))
      .toEqual(['Proposal', 'Qualification']);
  });
});

describe('`record:path.stages` member `terminal` OUTRANKS the heuristic (objectui#8071)', () => {
  // `WON_TOKENS` matches `完成`; `LOST_TOKENS` matches `失败`. Both fixtures
  // below therefore set `terminal` to the OPPOSITE of what the tokens say, so a
  // renderer that ignored the member would produce the other answer.
  const WON_LABEL_MARKED_LOST: Stage[] = [
    { value: 'draft', label: '草稿' },
    { value: 'done', label: '完成', terminal: 'lost' },
  ];
  const LOST_LABEL_MARKED_WON: Stage[] = [
    { value: 'draft', label: '草稿' },
    { value: 'failed', label: '失败', terminal: 'won' },
  ];

  it('an explicit `terminal: \'lost\'` beats a label the WON heuristic matches', () => {
    const items = stagesOf(mount(WON_LABEL_MARKED_LOST, 'draft'));
    expect(terminalOf(items[1])).toBe('lost');
  });

  it('CONTROL — the same stage WITHOUT `terminal` is classified `won` by the label', () => {
    // This is what makes the leg above a measurement rather than a coincidence:
    // it shows the heuristic really was pointing at `won`, so `lost` could only
    // have come from the member.
    const withoutMember = WON_LABEL_MARKED_LOST.map(({ terminal: _terminal, ...rest }) => rest);
    expect(terminalOf(stagesOf(mount(withoutMember, 'draft'))[1])).toBe('won');
  });

  it('an explicit `terminal: \'won\'` beats a label the LOST heuristic matches', () => {
    const items = stagesOf(mount(LOST_LABEL_MARKED_WON, 'draft'));
    expect(terminalOf(items[1])).toBe('won');
  });

  it('CONTROL — the same stage WITHOUT `terminal` is classified `lost` by the label', () => {
    const withoutMember = LOST_LABEL_MARKED_WON.map(({ terminal: _terminal, ...rest }) => rest);
    expect(terminalOf(stagesOf(mount(withoutMember, 'draft'))[1])).toBe('lost');
  });

  it('a stage with neither an explicit `terminal` nor a matching label is unclassified', () => {
    // The third arm of `classify()`, and the control that stops "terminal is
    // always set" from satisfying the four legs above.
    const plain: Stage[] = [
      { value: 'draft', label: 'Drafting' },
      { value: 'review', label: 'In review' },
    ];
    expect(stagesOf(mount(plain, 'draft')).map(terminalOf)).toEqual([null, null]);
  });
});
