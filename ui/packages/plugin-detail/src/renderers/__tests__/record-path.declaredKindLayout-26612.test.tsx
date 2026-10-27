/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * Once a field declares an option `kind`, the path is laid out by kind and
 * nothing is guessed from spelling (objectstack#26612)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * objectui#12907 taught `record:path` to read a declared `kind`, but it still
 * (1) filled any option WITHOUT a kind from the `closed_won` / `closed_lost`
 * spelling heuristic, though the spec reads an absent kind as `open`, and
 * (2) laid the stages out by POSITION: everything from the first lost option
 * on went into the separated group, so a lost option authored mid-list pulled
 * the open and won options after it out of the forward path.
 *
 * Rows:
 *   (a) a lost option authored mid-list sits apart, and the open and won
 *       options authored after it stay on the forward path, won last;
 *   (b) an option without a kind on a field that declares kinds reads as
 *       open, whatever its spelling;
 *   (c) every declared won option is a terminus, not only the last one;
 *   (d) the spelling fallback (no kind on any option) warns once in a dev
 *       build, naming the field and the guessed stages; nothing warns once a
 *       kind is declared, nor when the fallback guessed nothing.
 *
 * Resolution: `../../index` is this package's own source, and
 * `@object-ui/react` / `@object-ui/i18n` map to their `src` through the root
 * `vitest.config.mts` alias table, so no `dist/` sits between this file and
 * the renderer.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, cleanup, within, type RenderResult } from '@testing-library/react';
import type { SelectOptionKind } from '@objectstack/spec/data';
import { I18nProvider } from '@object-ui/i18n';
import { RecordContextProvider, SchemaRenderer } from '@object-ui/react';
// Registers `record:path`, the block under test.
import '../../index';

type Option = { value: string; label: string; kind?: SelectOptionKind };

const defOf = (name: string, options: Option[]) => ({
  name,
  label: name,
  fields: { status: { name: 'status', label: 'Status', type: 'select', options } },
});

/** The spec's own lead order would be fine; this one authors the lost option mid-list. */
const LEAD_LOST_MIDLIST = defOf('kind_lead', [
  { value: 'new', label: 'New', kind: 'open' },
  { value: 'unqualified', label: 'Unqualified', kind: 'lost' },
  { value: 'qualified', label: 'Qualified', kind: 'open' },
  { value: 'converted', label: 'Converted', kind: 'won' },
]);

/** Kinds declared on two options; `closed_lost` declares none. */
const PARTIAL = defOf('kind_partial', [
  { value: 'prospecting', label: 'Prospecting', kind: 'open' },
  { value: 'closed_lost', label: 'Closed Lost' },
  { value: 'activated', label: 'Activated', kind: 'won' },
]);

const TWO_WON = defOf('kind_two_won', [
  { value: 'open_case', label: 'Open', kind: 'open' },
  { value: 'resolved', label: 'Resolved', kind: 'won' },
  { value: 'cancelled', label: 'Cancelled', kind: 'lost' },
  { value: 'workaround', label: 'Workaround', kind: 'won' },
]);

const SPELLED_UNDECLARED = defOf('spelled_deal', [
  { value: 'prospecting', label: 'Prospecting' },
  { value: 'closed_won', label: 'Closed Won' },
  { value: 'closed_lost', label: 'Closed Lost' },
]);

const PLAIN_UNDECLARED = defOf('plain_loan', [
  { value: 'borrowed', label: 'Borrowed' },
  { value: 'returned', label: 'Returned' },
]);

const NODE = { type: 'record:path', properties: { statusField: 'status' } };

function mount(def: { name: string }, status: string): RenderResult {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <RecordContextProvider
        objectName={def.name}
        recordId="r1"
        data={{ id: 'r1', status }}
        objectSchema={def as never}
      >
        <SchemaRenderer schema={NODE as never} />
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

/** The desktop row's forward rail (the first stage's box) and separated group. */
function desktopGroups(desktop: HTMLElement): { forward: string[]; separated: string[] } {
  const stages = stagesOf(desktop);
  const forwardBox = stages[0].parentElement;
  return {
    forward: stages.filter((s) => s.parentElement === forwardBox).map(textOf),
    separated: stages.filter((s) => s.parentElement !== forwardBox).map(textOf),
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('(a) a declared kind lays the path out, not the option order (objectstack#26612)', () => {
  it('a lost option authored mid-list sits apart; open steps, then the won terminus', () => {
    const [desktop, mobile] = rowsOf(mount(LEAD_LOST_MIDLIST, 'qualified'));
    expect(desktopGroups(desktop)).toEqual({
      forward: ['New', 'Qualified', 'Converted'],
      separated: ['Unqualified'],
    });
    expect(terminalsOf(desktop)).toEqual([null, null, 'won', 'lost']);
    // The mobile row reads the same laid-out array, in the same order.
    expect(stagesOf(mobile).map(textOf)).toEqual(['New', 'Qualified', 'Converted', 'Unqualified']);
    expect(terminalsOf(mobile)).toEqual([null, null, 'won', 'lost']);
    // Progress follows the laid-out order: New is travelled, Qualified current.
    expect(stagesOf(desktop).map((s) => s.getAttribute('data-stage-state'))).toEqual([
      'completed',
      'current',
      'upcoming',
      'upcoming',
    ]);
  });

  it('a record in the lost state marks the lost stage current, apart from the rail', () => {
    const [desktop, mobile] = rowsOf(mount(LEAD_LOST_MIDLIST, 'unqualified'));
    const lost = stagesOf(desktop)[3];
    expect(textOf(lost)).toBe('Unqualified');
    expect(lost).toHaveAttribute('data-stage-state', 'current');
    expect(lost).toHaveAttribute('data-stage-terminal', 'lost');
    expect(stagesOf(mobile)[3]).toHaveAttribute('data-stage-state', 'current');
  });
});

describe('(b) once the field declares a kind, nothing is guessed from spelling (objectstack#26612)', () => {
  it('an option without a kind reads as open, though it is spelled closed_lost', () => {
    const [desktop, mobile] = rowsOf(mount(PARTIAL, 'prospecting'));
    expect(desktopGroups(desktop)).toEqual({
      forward: ['Prospecting', 'Closed Lost', 'Activated'],
      separated: [],
    });
    expect(terminalsOf(desktop)).toEqual([null, null, 'won']);
    expect(terminalsOf(mobile)).toEqual([null, null, 'won']);
  });
});

describe('(c) every declared won option is a terminus (objectstack#26612)', () => {
  it('two won options both end the forward path, in their authored order', () => {
    const [desktop, mobile] = rowsOf(mount(TWO_WON, 'open_case'));
    expect(desktopGroups(desktop)).toEqual({
      forward: ['Open', 'Resolved', 'Workaround'],
      separated: ['Cancelled'],
    });
    expect(terminalsOf(desktop)).toEqual([null, 'won', 'won', 'lost']);
    expect(terminalsOf(mobile)).toEqual([null, 'won', 'won', 'lost']);
  });
});

describe('(d) the spelling fallback warns in a dev build, naming the field (objectstack#26612)', () => {
  const pathWarnings = (spy: ReturnType<typeof vi.spyOn>) =>
    spy.mock.calls.map((c) => String(c[0])).filter((m) => m.startsWith('record:path'));

  it('no kind on any option: the guess still lays the path out, and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = mount(SPELLED_UNDECLARED, 'prospecting');
    const [desktop] = rowsOf(r);
    // The fallback renders as before.
    expect(desktopGroups(desktop)).toEqual({ forward: ['Prospecting', 'Closed Won'], separated: ['Closed Lost'] });
    expect(terminalsOf(desktop)).toEqual([null, 'won', 'lost']);

    const messages = pathWarnings(warn);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('field "status"');
    expect(messages[0]).toContain('object "spelled_deal"');
    expect(messages[0]).toContain('"closed_won", "closed_lost"');

    // Re-rendering the same picklist does not repeat it.
    cleanup();
    rowsOf(mount(SPELLED_UNDECLARED, 'closed_won'));
    expect(pathWarnings(warn)).toHaveLength(1);
  });

  it('a field that declares kinds never warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    rowsOf(mount(PARTIAL, 'prospecting'));
    rowsOf(mount(LEAD_LOST_MIDLIST, 'new'));
    expect(pathWarnings(warn)).toEqual([]);
  });

  it('no kind declared and nothing guessed: no warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [desktop] = rowsOf(mount(PLAIN_UNDECLARED, 'borrowed'));
    expect(terminalsOf(desktop)).toEqual([null, null]);
    expect(pathWarnings(warn)).toEqual([]);
  });
});
