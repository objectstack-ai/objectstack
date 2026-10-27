/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:path` — terminal stages get a legible share of the desktop rail
 * (#25895, item 2).
 *
 * Measured on HotCRM's event page at 1440 px: a three-stage path plus the
 * terminal `客户未到` drew `× 已取消  客户未到` in one narrow cell at the right
 * edge while the forward stages took the width. The separated alt group was
 * `shrink-0` around content-width, `whitespace-nowrap` stages, so the terminal
 * stages got only as wide as their words and their rails shrank to match.
 *
 * The rule pinned here: on the desktop row every stage takes an EQUAL share of
 * the width. The two groups grow in proportion to the stages they hold (the
 * inline `flex-grow`, which the test DOM does resolve), each stage fills its
 * share (`flex-1 min-w-0`), and a terminal stage's label wraps rather than
 * being cut or pushed past the edge. The mobile row scrolls and is unchanged.
 *
 * The test DOM resolves no Tailwind, so the stage-level half reads class
 * tokens; the group-level half reads the computed inline style.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, cleanup, within, type RenderResult } from '@testing-library/react';
import { RecordContextProvider } from '@object-ui/react';
import { RecordPathRenderer } from '../record-path';

afterEach(() => cleanup());

/** The card's event: three stages, `cancelled` is lost-class, `no_show` follows it. */
const EVENT_STAGES = [
  { value: 'planned', label: '已计划' },
  { value: 'held', label: '已举行' },
  { value: 'cancelled', label: '已取消' },
  { value: 'no_show', label: '客户未到' },
];

/** The card's opportunity: seven forward stages ending in the won terminus, then lost. */
const OPPORTUNITY_STAGES = [
  { value: 'prospecting', label: '初步接洽' },
  { value: 'qualification', label: '需求确认' },
  { value: 'needs_analysis', label: '方案制定' },
  { value: 'proposal', label: '报价' },
  { value: 'negotiation', label: '谈判' },
  { value: 'contract', label: '合同' },
  { value: 'closed_won', label: '成交' },
  { value: 'closed_lost', label: '失败' },
];

function mount(stages: ReadonlyArray<Record<string, unknown>>, status: string): RenderResult {
  return render(
    <RecordContextProvider objectName="crm_event" recordId="e1" data={{ id: 'e1', status }}>
      <RecordPathRenderer schema={{ statusField: 'status', stages } as never} />
    </RecordContextProvider>,
  );
}

/** The desktop rail is the first `role="list"`; the mobile one is the second. */
const desktopRow = (r: RenderResult): HTMLElement =>
  r.container.querySelectorAll('[role="list"]')[0] as HTMLElement;

const stageNamed = (row: HTMLElement, label: string): HTMLElement =>
  within(row)
    .getAllByRole('listitem')
    .find((el) => (el.textContent ?? '').includes(label)) as HTMLElement;

/** A stage's visible label element: the span after the decorative rail. */
const labelOf = (stage: HTMLElement): HTMLElement =>
  stage.querySelector(':scope > span:not([data-stage-rail])') as HTMLElement;

const classTokens = (el: HTMLElement): string[] => el.className.split(/\s+/).filter(Boolean);

/** The two stage groups of the desktop row: forward, then the separated alt group. */
const groupsOf = (row: HTMLElement): HTMLElement[] => Array.from(row.children) as HTMLElement[];

describe('record:path — terminal stages share the desktop rail’s width (#25895)', () => {
  it.each([
    ['the event (2 forward + 2 after the lost stage)', EVENT_STAGES, 'cancelled', 2, 2],
    ['the opportunity (7 forward + 1 lost)', OPPORTUNITY_STAGES, 'negotiation', 7, 1],
  ])('%s: the groups grow by the stages they hold', (_name, stages, status, forward, terminal) => {
    const row = desktopRow(mount(stages, status));
    const [forwardGroup, altGroup] = groupsOf(row);
    expect(within(forwardGroup).getAllByRole('listitem')).toHaveLength(forward);
    expect(within(altGroup).getAllByRole('listitem')).toHaveLength(terminal);
    expect(getComputedStyle(forwardGroup).flexGrow).toBe(String(forward));
    expect(getComputedStyle(altGroup).flexGrow).toBe(String(terminal));
    // Both groups start from zero, so the grow ratio IS the width ratio.
    expect(getComputedStyle(forwardGroup).flexBasis).toBe('0%');
    expect(getComputedStyle(altGroup).flexBasis).toBe('0%');
  });

  it('each terminal stage fills its share instead of shrinking to its words', () => {
    const row = desktopRow(mount(EVENT_STAGES, 'cancelled'));
    for (const label of ['已取消', '客户未到']) {
      const tokens = classTokens(stageNamed(row, label));
      expect(tokens).toContain('flex-1');
      expect(tokens).toContain('min-w-0');
      expect(tokens).not.toContain('shrink-0');
    }
  });

  it('a terminal stage’s label wraps — never cut, never pushed past the edge', () => {
    const row = desktopRow(mount(OPPORTUNITY_STAGES, 'negotiation'));
    for (const label of ['成交', '失败']) {
      const stage = stageNamed(row, label);
      expect(stage).toHaveAttribute('data-stage-terminal');
      const tokens = classTokens(labelOf(stage));
      expect(tokens).not.toContain('whitespace-nowrap');
      expect(tokens).not.toContain('truncate');
      expect(tokens).toContain('[overflow-wrap:anywhere]');
    }
  });

  it('CONTROL: an ordinary forward stage keeps its one-line truncated label', () => {
    const row = desktopRow(mount(OPPORTUNITY_STAGES, 'negotiation'));
    const stage = stageNamed(row, '报价');
    expect(stage).not.toHaveAttribute('data-stage-terminal');
    expect(classTokens(labelOf(stage))).toContain('truncate');
  });

  it('CONTROL: a path with no lost stage draws one group holding every stage', () => {
    const row = desktopRow(mount(OPPORTUNITY_STAGES.slice(0, 7), 'proposal'));
    const groups = groupsOf(row);
    expect(groups).toHaveLength(1);
    expect(getComputedStyle(groups[0]).flexGrow).toBe('7');
  });
});
