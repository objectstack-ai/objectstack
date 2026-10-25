/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A stage's declared lifecycle `kind` decides its terminal, not its spelling
 * (objectui#12907)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * `@objectstack/spec` lets a select option declare `kind: 'open' | 'won' |
 * 'lost'` (objectstack#23809), mandatory on the options of an object's
 * `stageField`. `deriveStages` dropped it, so `record:path` still guessed the
 * terminal stages from `WON_TOKENS` / `LOST_TOKENS` over the value and label.
 * A loan's `borrowed` 借出 / `returned` 已还 / `overdue` 逾期 matched no token,
 * so the successful end drew as a middle step and the overdue end inside the
 * forward path.
 *
 * Rows:
 *   (a) options that declare `kind` draw the `won` option as the forward
 *       terminus and the `lost` option in the separated group, whatever their
 *       spelling — through the renderer's own derivation AND through the
 *       synthesized default page's node, the latter with no object definition
 *       bound, so the stage-borne `terminal` is what carries it there;
 *   (b) a declared `open` on values spelled like terminal tokens keeps them
 *       middle steps;
 *   (c) CONTROL: options that declare no kind are classified by spelling, as
 *       before.
 *
 * Resolution: `../../index` and `../../synth/buildDefaultPageSchema` are this
 * package's own source, and `@object-ui/react` / `@object-ui/i18n` map to their
 * `src` through the root `vitest.config.mts` alias table, so no `dist/` sits
 * between this file and the renderer.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, cleanup, within, type RenderResult } from '@testing-library/react';
import type { SelectOptionKind } from '@objectstack/spec/data';
import { I18nProvider } from '@object-ui/i18n';
import { RecordContextProvider, SchemaRenderer } from '@object-ui/react';
import { buildDefaultHighlights } from '../../synth/buildDefaultPageSchema';
// Registers `record:path`, the block under test.
import '../../index';

const OBJECT_NAME = 'library_loan';

const loanDef = (options: Array<{ value: string; label: string; kind?: SelectOptionKind }>) => ({
  name: OBJECT_NAME,
  label: 'Loan',
  fields: { status: { name: 'status', label: 'Status', type: 'select', options } },
});

/** The card's loan: no option is spelled like a WON / LOST token. */
const LOAN_DECLARED = loanDef([
  { value: 'borrowed', label: '借出', kind: 'open' },
  { value: 'returned', label: '已还', kind: 'won' },
  { value: 'overdue', label: '逾期', kind: 'lost' },
]);

const LOAN_UNDECLARED = loanDef([
  { value: 'borrowed', label: '借出' },
  { value: 'returned', label: '已还' },
  { value: 'overdue', label: '逾期' },
]);

/**
 * Values spelled like terminal tokens, every one declared `open` but the last.
 * By spelling, `closed_lost` would open the separated group at index 1 and
 * carry everything after it there; by declaration it is a middle step.
 */
const DECLARED_OPEN = loanDef([
  { value: 'prospecting', label: 'Prospecting', kind: 'open' },
  { value: 'closed_lost', label: 'Closed Lost', kind: 'open' },
  { value: 'closed_won', label: 'Closed Won', kind: 'open' },
  { value: 'activated', label: 'Activated', kind: 'won' },
]);

/** The same spelling with no declared kinds: the heuristic's own answer. */
const SPELLED_UNDECLARED = loanDef([
  { value: 'prospecting', label: 'Prospecting' },
  { value: 'closed_won', label: 'Closed Won' },
  { value: 'closed_lost', label: 'Closed Lost' },
]);

const doc = (properties: Record<string, unknown>) => ({ type: 'record:path', properties });

/** `objectSchema: null` binds NO object definition. */
function mount(node: unknown, objectSchema: unknown, status: string): RenderResult {
  return render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <RecordContextProvider
        objectName={OBJECT_NAME}
        recordId="l1"
        data={{ id: 'l1', status }}
        objectSchema={(objectSchema ?? undefined) as never}
      >
        <SchemaRenderer schema={node as never} />
      </RecordContextProvider>
    </I18nProvider>,
  );
}

/** Both rows (desktop and mobile), in DOM order. */
function rowsOf(r: RenderResult): [HTMLElement, HTMLElement] {
  const text = r.container.textContent ?? '';
  expect(text).not.toContain('failed to render');
  expect(text).not.toContain('no stages configured');
  const rows = Array.from(r.container.querySelectorAll('[role="list"]')) as HTMLElement[];
  expect(rows).toHaveLength(2);
  return [rows[0], rows[1]];
}

const stagesOf = (row: HTMLElement): HTMLElement[] => within(row).getAllByRole('listitem');
const textOf = (stage: HTMLElement): string => (stage.textContent ?? '').replace(/[✓✗]/g, '').trim();
const terminalsOf = (row: HTMLElement): Array<string | null> =>
  stagesOf(row).map((s) => s.getAttribute('data-stage-terminal'));

/**
 * The desktop row's two groups by the box each stage sits in: the forward rail
 * is the first stage's box; anything elsewhere is the separated lost group.
 */
function desktopGroups(desktop: HTMLElement): { forward: string[]; separated: string[] } {
  const stages = stagesOf(desktop);
  const forwardBox = stages[0].parentElement;
  return {
    forward: stages.filter((s) => s.parentElement === forwardBox).map(textOf),
    separated: stages.filter((s) => s.parentElement !== forwardBox).map(textOf),
  };
}

afterEach(() => cleanup());

describe('(a) a declared kind decides the terminus, whatever the spelling (objectui#12907)', () => {
  it('derived by the renderer: 已还 (won) ends the forward path, 逾期 (lost) is separated', () => {
    const [desktop, mobile] = rowsOf(mount(doc({ statusField: 'status' }), LOAN_DECLARED, 'borrowed'));
    expect(desktopGroups(desktop)).toEqual({ forward: ['借出', '已还'], separated: ['逾期'] });
    expect(terminalsOf(desktop)).toEqual([null, 'won', 'lost']);
    expect(terminalsOf(mobile)).toEqual([null, 'won', 'lost']);
  });

  it('the synthesized default page node carries the terminal itself, with no object definition bound', () => {
    const [node] = buildDefaultHighlights(LOAN_DECLARED, { statusField: 'status', hideHighlights: true });
    expect(node.properties.stages).toEqual([
      { value: 'borrowed', label: '借出' },
      { value: 'returned', label: '已还', terminal: 'won' },
      { value: 'overdue', label: '逾期', terminal: 'lost' },
    ]);
    const [desktop, mobile] = rowsOf(mount(node, null, 'overdue'));
    expect(desktopGroups(desktop)).toEqual({ forward: ['借出', '已还'], separated: ['逾期'] });
    expect(terminalsOf(desktop)).toEqual([null, 'won', 'lost']);
    expect(terminalsOf(mobile)).toEqual([null, 'won', 'lost']);
    expect(stagesOf(desktop)[2]).toHaveAttribute('data-stage-state', 'current');
  });
});

describe('(b) a declared open beats a terminal-sounding spelling (objectui#12907)', () => {
  it('closed_lost / closed_won declared open stay middle steps; the won option is the terminus', () => {
    const [desktop, mobile] = rowsOf(mount(doc({ statusField: 'status' }), DECLARED_OPEN, 'closed_won'));
    expect(desktopGroups(desktop)).toEqual({
      forward: ['Prospecting', 'Closed Lost', 'Closed Won', 'Activated'],
      separated: [],
    });
    expect(terminalsOf(desktop)).toEqual([null, null, null, 'won']);
    expect(terminalsOf(mobile)).toEqual([null, null, null, 'won']);
  });

  it('the same holds for the synthesized default page node, read against the bound definition', () => {
    const [node] = buildDefaultHighlights(DECLARED_OPEN, { statusField: 'status', hideHighlights: true });
    const [desktop] = rowsOf(mount(node, DECLARED_OPEN, 'prospecting'));
    expect(desktopGroups(desktop).separated).toEqual([]);
    expect(terminalsOf(desktop)).toEqual([null, null, null, 'won']);
  });
});

describe('(c) CONTROL: options that declare no kind are classified by spelling, as before', () => {
  it('the loan without kinds: no token matches, so no stage is a terminal', () => {
    const [desktop, mobile] = rowsOf(mount(doc({ statusField: 'status' }), LOAN_UNDECLARED, 'borrowed'));
    expect(desktopGroups(desktop)).toEqual({ forward: ['借出', '已还', '逾期'], separated: [] });
    expect(terminalsOf(desktop)).toEqual([null, null, null]);
    expect(terminalsOf(mobile)).toEqual([null, null, null]);
  });

  it('closed_won / closed_lost without kinds: won terminus and separated lost, by spelling', () => {
    const [desktop, mobile] = rowsOf(mount(doc({ statusField: 'status' }), SPELLED_UNDECLARED, 'prospecting'));
    expect(desktopGroups(desktop)).toEqual({
      forward: ['Prospecting', 'Closed Won'],
      separated: ['Closed Lost'],
    });
    expect(terminalsOf(desktop)).toEqual([null, 'won', 'lost']);
    expect(terminalsOf(mobile)).toEqual([null, 'won', 'lost']);
  });
});
