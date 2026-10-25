/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ONE record, ONE classification — not one per viewport (objectui#5998)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `record:path` renders two rows from the same `stages[]` — a desktop row
 * (`hidden sm:flex`) and a mobile row (`flex sm:hidden`) — and each used to
 * derive its own `terminal` classification from that array. Because
 * `renderStage` hands the same `terminal` to `railClass` AND (since
 * objectui#5957) to `stageAriaLabel`, a disagreement showed up in the paint and
 * in the accessible name at once: one stage of one record, described two
 * different ways, chosen by nothing but the width of the window.
 *
 * ── What this file pins, and why it is a CROSS-ROW assertion ──────────────
 *
 * The fix is not "make the two rows agree" — two independently-derived
 * classifications that happen to agree today leave the defect one edit away.
 * The fix is ONE array (`stageTerminals`) that both rows index. So the pin is
 * stated as the invariant that array exists to guarantee: for every stage, the
 * desktop row and the mobile row report the SAME `data-stage-terminal`, the
 * same `data-stage-state`, and the same accessible name.
 *
 * ── Why the fixtures are permutations of one another ──────────────────────
 *
 * `MID_PATH_WON` and `WON_LAST` carry the SAME three stages with the same
 * labels; only the position of `完成` differs. That is deliberate on two counts:
 *
 *   • A fixture whose `won`-classified stage happens to sit last cannot
 *     distinguish the two readings of this card — it goes green either way. The
 *     load-bearing case therefore puts `完成` mid-path, which is exactly the
 *     card's reproducer (`草稿 → 完成 → 已归档`, `last` at index 2).
 *   • `WON_LAST` is the COUNTER-PROBE. Without it, "the two rows agree" would
 *     also be satisfied by never marking a goal terminus at all — the suite
 *     would pin the wrong invariant and nobody would notice. Since it differs
 *     from the load-bearing fixture only in WHERE `完成` sits, its green also
 *     proves the heuristic still fires on `完成`: the mid-path result is a
 *     positional decision, not `WON_TOKENS` failing to match.
 *
 * ── The `lost` axis, which the card does not name ─────────────────────────
 *
 * The rows diverged on a SECOND axis. Desktop renders `stages.slice(firstLostIdx)`
 * as a separated alt group and used to hardcode `terminal: 'lost'` on every
 * member of it — a POSITIONAL group — while mobile classified each stage on its
 * own. So a plain stage sitting after a `lost` one (`草稿 → 失败 → 已归档`)
 * painted destructive and announced `closed lost` on desktop and painted plain
 * on mobile; and a `won`-classified stage there (`草稿 → 失败 → 完成`) drew
 * `'lost'` from one row and `'won'` from the other. Same defect, same fix, so
 * it is pinned in the same file.
 *
 * ── Resolution ────────────────────────────────────────────────────────────
 *
 * Nothing here resolves through any `dist/`: `../record-path` is this package's
 * own source and `@object-ui/react` / `@object-ui/i18n` are mapped to their
 * `src` by the root `vitest.config.mts` alias table. An ablation of
 * `record-path.tsx` is visible to this suite without a rebuild.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, cleanup, within, type RenderResult } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { RecordContextProvider } from '@object-ui/react';
import { RecordPathRenderer } from '../record-path';

/**
 * The card's reproducer. `WON_TOKENS` matches `完成`, an ordinary mid-path word,
 * so index 1 classifies `won` while `last` is index 2.
 */
const MID_PATH_WON = [
  { value: 'draft', label: '草稿' },
  { value: 'done', label: '完成' },
  { value: 'archived', label: '已归档' },
];

/** The counter-probe: the same three stages, with `完成` moved to the end. */
const WON_LAST = [
  { value: 'draft', label: '草稿' },
  { value: 'archived', label: '已归档' },
  { value: 'done', label: '完成' },
];

/** A plain stage sitting AFTER a `lost` one — desktop's positional alt group. */
const PLAIN_AFTER_LOST = [
  { value: 'draft', label: '草稿' },
  { value: 'failed', label: '失败' },
  { value: 'archived', label: '已归档' },
];

/** A `won`-classified stage sitting after a `lost` one: `'lost'` vs `'won'`. */
const WON_AFTER_LOST = [
  { value: 'draft', label: '草稿' },
  { value: 'failed', label: '失败' },
  { value: 'done', label: '完成' },
];

function mount(stages: ReadonlyArray<Record<string, unknown>>, status = 'draft'): RenderResult {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <RecordContextProvider objectName="crm_quote" recordId="q1" data={{ id: 'q1', status }}>
        <RecordPathRenderer schema={{ statusField: 'status', stages } as never} />
      </RecordContextProvider>
    </I18nProvider>,
  );
}

/**
 * Both rows are in the DOM at once — they are separated by a CSS breakpoint,
 * which jsdom does not apply. Index 0 is desktop, index 1 is mobile.
 */
const rows = (r: RenderResult): HTMLElement[] =>
  Array.from(r.container.querySelectorAll('[role="list"]')) as HTMLElement[];

const stagesOf = (row: HTMLElement): HTMLElement[] => within(row).getAllByRole('listitem');

/**
 * Everything about a row that `terminal` can move: the classification itself,
 * the state it combines with, and the name the pair composes. Desktop renders
 * its forward slice then its alt group, and the alt group is the tail of the
 * same array, so both rows list the stages in `stages[]` order.
 */
const signature = (row: HTMLElement): string[] =>
  stagesOf(row).map((el) =>
    [
      (el.querySelector('span:last-of-type')?.textContent ?? '').trim(),
      el.getAttribute('data-stage-state') ?? '-',
      el.getAttribute('data-stage-terminal') ?? '-',
      el.getAttribute('aria-label') ?? '-',
    ].join(' | '),
  );

const terminalsOf = (row: HTMLElement): Array<string | null> =>
  stagesOf(row).map((el) => el.getAttribute('data-stage-terminal'));

afterEach(() => cleanup());

describe('the two rows read ONE classification (objectui#5998)', () => {
  it('a mid-path `won` heuristic hit is classified the same on both rows', () => {
    // THE load-bearing case. Before the fix: desktop gave index 1
    // `terminal: undefined` (`bg-muted`, "upcoming") because it is not the last
    // forward stage, while mobile gave it `terminal: 'won'`
    // (`bg-emerald-500/30`, "goal stage, not reached").
    const [desktop, mobile] = rows(mount(MID_PATH_WON));

    expect(signature(desktop)).toEqual(signature(mobile));
    // ...and the value they agree on is the narrowed one: the goal terminus is
    // the terminus of the forward path, so a mid-path `完成` is not it.
    expect(terminalsOf(desktop)).toEqual([null, null, null]);
  });

  it('COUNTER-PROBE: the same `完成`, moved last, IS the goal terminus on both rows', () => {
    // Without this, "both rows agree" would be satisfied by never marking a goal
    // at all. It also proves `WON_TOKENS` still fires on `完成` — the fixture
    // above differs from this one only in where that stage sits.
    const [desktop, mobile] = rows(mount(WON_LAST));

    expect(signature(desktop)).toEqual(signature(mobile));
    expect(terminalsOf(desktop)).toEqual([null, null, 'won']);
    expect(stagesOf(mobile)[2]).toHaveAccessibleName('完成, goal stage, not reached');
  });

  it('the goal terminus is not lost when the record has reached the stage before it', () => {
    // The `won` classification must not depend on where the record sits, only
    // on where the stage sits — checked on both rows for the same reason.
    const [desktop, mobile] = rows(mount(WON_LAST, 'archived'));

    expect(signature(desktop)).toEqual(signature(mobile));
    expect(terminalsOf(desktop)).toEqual([null, null, 'won']);
    expect(stagesOf(desktop)[1]).toHaveAttribute('data-stage-state', 'current');
  });
});

describe('the `lost` axis diverged too — desktop grouped positionally (objectui#5998)', () => {
  it('a plain stage after a `lost` one is not `lost` on either row', () => {
    // Before the fix desktop swept `已归档` into the alt group and hardcoded
    // `terminal: 'lost'` on it — destructive paint, "closed lost" announcement —
    // while mobile left it plain.
    const [desktop, mobile] = rows(mount(PLAIN_AFTER_LOST));

    expect(signature(desktop)).toEqual(signature(mobile));
    expect(terminalsOf(desktop)).toEqual([null, 'lost', null]);
  });

  it('a `won`-classified stage after a `lost` one is not read as two different terminals', () => {
    // The sharpest form of the second axis: the rows disagreed on the VALUE,
    // not merely on whether one was present — desktop `'lost'`, mobile `'won'`.
    // Neither survives: it is not the last forward stage, and it is not lost.
    const [desktop, mobile] = rows(mount(WON_AFTER_LOST));

    expect(signature(desktop)).toEqual(signature(mobile));
    expect(terminalsOf(desktop)).toEqual([null, 'lost', null]);
  });

  it('the declared `lost` terminal itself still announces as one on both rows', () => {
    // Non-vacuity for the two cases above: the narrowing is confined to stages
    // that are not themselves lost-classified.
    const [desktop, mobile] = rows(mount(PLAIN_AFTER_LOST));

    for (const row of [desktop, mobile]) {
      expect(stagesOf(row)[1]).toHaveAccessibleName('失败, closed lost, not reached');
    }
  });
});
