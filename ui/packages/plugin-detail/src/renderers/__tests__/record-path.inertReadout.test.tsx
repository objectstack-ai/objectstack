/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `record:path` is a READOUT and must not look like a control (objectui#5768)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The card was measured in a running browser against a shipped build, on
 * HotCRM `crm_quote` (the object declares a `stageField`, so this is generic
 * record chrome, not one app's skin). What the browser reported:
 *
 *     document.querySelectorAll('main [role="listitem"]')  // listitem, not button/tab
 *     getComputedStyle(el).cursor                          // "auto"
 *     el.getAttribute('tabindex')                          // null
 *     el.closest('button,[role=button],[role=tab],a')      // null
 *     // pointerdown → mousedown → pointerup → mouseup → click: status unchanged
 *
 * Every one of those readings is CORRECT for a status readout. The defect was
 * that the pixels said otherwise: filled, shadowed, equal-width pills — a
 * segmented button group — sitting exactly where a CRM user reaches for the
 * stage control. Maintainer ruling (2026-08-23): direction 2, stop-loss. The
 * markup stops claiming to be a control; a real click-to-advance stage control
 * is a separate card with its own appetite, NOT folded in here.
 *
 * ── What each group is for ────────────────────────────────────────────────
 *
 * Group A is the CONTROL — what must not move. It also establishes
 * non-vacuity: it proves this harness can move `aria-current` between stages,
 * so "the current stage is the current one" below is a verdict rather than an
 * inability to tell the stages apart.
 *
 * Group B is the readout contract. Its legs divide, and the division is
 * recorded here because it is what reverse verification measured:
 *
 *   • B1–B3 (no interactive role, no tab stop, inert on a full pointer
 *     sequence) were ALREADY TRUE before this change — they re-measure the
 *     browser's readings at the live source and pin them against the *wrong*
 *     fix, i.e. bolting a control onto a surface that has no write path.
 *     They do NOT discriminate this PR's change; ablating the styling leaves
 *     them green. Named, not hidden.
 *   • B4 is the discriminating leg. A rail has a decorative indicator that is
 *     a SEPARATE element from its label; a pill IS its own label's surface and
 *     cannot have one. Ablating the rail turns B4 red and nothing else.
 *
 * ── Why no CSS is asserted ────────────────────────────────────────────────
 *
 * The test DOM resolves no Tailwind, so `getComputedStyle` here answers
 * nothing about what a user sees, and class strings are not a contract. The
 * state a colour used to be the only carrier of is therefore read off
 * `data-stage-state` / `data-stage-terminal`, and the pill-vs-rail difference
 * off `data-stage-rail` — semantics and structure, never appearance.
 *
 * ── Resolution path (ablation validity) ───────────────────────────────────
 *
 * The subject is imported RELATIVELY (`../record-path`), i.e. straight from
 * this package's source, and the only cross-package import is
 * `@object-ui/react`, which the root `vitest.config.mts` alias table maps to
 * `packages/react/src`. Nothing in this file resolves through any `dist/`, so
 * an ablation of `record-path.tsx` is visible to this suite without a rebuild.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, within, type RenderResult } from '@testing-library/react';
import { RecordContextProvider } from '@object-ui/react';
import { RecordPathRenderer } from '../record-path';

/** The card's own fixture: HotCRM `crm_quote`, six stages, none terminal. */
const QUOTE_STAGES = [
  { value: 'draft', label: '草稿' },
  { value: 'in_review', label: '审核中' },
  { value: 'submitted', label: '已提交' },
  { value: 'accepted', label: '已接受' },
  { value: 'rejected', label: '已拒绝' },
  { value: 'expired', label: '已过期' },
];

/** A declared `lost` terminal, so the separated alt-group renders too. */
const WITH_LOST_STAGES = [
  { value: 'draft', label: '草稿' },
  { value: 'in_review', label: '审核中' },
  { value: 'submitted', label: '已提交' },
  { value: 'declined', label: '已拒绝', terminal: 'lost' as const },
];

function mount(status: string, stages = QUOTE_STAGES): RenderResult {
  return render(
    <RecordContextProvider objectName="crm_quote" recordId="q1" data={{ id: 'q1', status }}>
      <RecordPathRenderer schema={{ statusField: 'status', stages } as never} />
    </RecordContextProvider>,
  );
}

/**
 * Both the desktop and the mobile row are in the DOM at once (they are
 * separated by a CSS breakpoint, which this environment does not apply), so
 * every invariant is asserted on BOTH — a regression that reached only one
 * viewport would otherwise pass.
 */
const rows = (r: RenderResult): HTMLElement[] =>
  Array.from(r.container.querySelectorAll('[role="list"]')) as HTMLElement[];

const stageOf = (row: HTMLElement, label: string): HTMLElement => {
  const el = within(row).getByText(label).closest('[role="listitem"]');
  if (!el) throw new Error(`no [role="listitem"] ancestor for stage ${label}`);
  return el as HTMLElement;
};

const currentLabels = (row: HTMLElement): string[] =>
  Array.from(row.querySelectorAll('[aria-current="step"]')).map((el) => (el.textContent || '').trim());

afterEach(() => cleanup());

describe('#5768 group A — controls: the stages still render, and the current one is still the current one', () => {
  it('every stage label is on screen, in both rows', () => {
    // Non-vacuity for everything below: if the path painted nothing, an
    // "is not a button" assertion would pass for the wrong reason.
    const r = mount('draft');
    expect(rows(r)).toHaveLength(2);
    for (const row of rows(r)) {
      for (const s of QUOTE_STAGES) expect(within(row).getByText(s.label)).toBeTruthy();
    }
  });

  it('exactly one stage per row is marked current, and it is the record\'s stage', () => {
    const r = mount('in_review');
    for (const row of rows(r)) {
      expect(currentLabels(row)).toEqual(['审核中']);
      expect(stageOf(row, '审核中')).toHaveAttribute('data-stage-state', 'current');
    }
  });

  it('the mark MOVES with the record — so the assertion above is a verdict, not a tie', () => {
    for (const row of rows(mount('draft'))) expect(currentLabels(row)).toEqual(['草稿']);
    cleanup();
    for (const row of rows(mount('submitted'))) {
      expect(currentLabels(row)).toEqual(['已提交']);
    }
  });

  it('travelled / untravelled stages keep their classification', () => {
    const r = mount('submitted');
    for (const row of rows(r)) {
      expect(stageOf(row, '草稿')).toHaveAttribute('data-stage-state', 'completed');
      expect(stageOf(row, '审核中')).toHaveAttribute('data-stage-state', 'completed');
      expect(stageOf(row, '已提交')).toHaveAttribute('data-stage-state', 'current');
      expect(stageOf(row, '已接受')).toHaveAttribute('data-stage-state', 'upcoming');
      expect(stageOf(row, '已过期')).toHaveAttribute('data-stage-state', 'upcoming');
    }
  });

  it('a declared `lost` terminal still renders, still separated from the forward stages', () => {
    const r = mount('in_review', WITH_LOST_STAGES);
    for (const row of rows(r)) {
      expect(stageOf(row, '已拒绝')).toHaveAttribute('data-stage-terminal', 'lost');
      // The forward stages did not get swept into the terminal group.
      expect(stageOf(row, '已提交')).not.toHaveAttribute('data-stage-terminal');
      expect(within(row).getByText('草稿')).toBeTruthy();
    }
  });
});

describe('#5768 group B — the readout does not claim to be a control', () => {
  // B1–B3 re-measure the browser's readings at the live source. They pin the
  // surface against the wrong fix (a control with no write path behind it);
  // they are NOT what this PR changed. See the docblock.

  it('B1 — no element in the path carries an interactive role', () => {
    const r = mount('draft');
    for (const row of rows(r)) {
      for (const role of ['button', 'tab', 'link', 'menuitem', 'radio', 'checkbox', 'switch']) {
        expect(within(row).queryAllByRole(role)).toHaveLength(0);
      }
      expect(row.querySelectorAll('[role="button"],[role="tab"],[role="link"]')).toHaveLength(0);
    }
  });

  it('B2 — nothing in the path is a tab stop or natively focusable', () => {
    const r = mount('draft');
    for (const row of rows(r)) {
      expect(
        row.querySelectorAll('[tabindex],button,a[href],input,select,textarea,summary,[contenteditable]'),
      ).toHaveLength(0);
      for (const item of Array.from(row.querySelectorAll('[role="listitem"]'))) {
        expect(item.getAttribute('tabindex')).toBeNull();
        expect(item.closest('button,[role="button"],[role="tab"],a')).toBeNull();
      }
    }
  });

  it('B3 — a full pointer sequence on the next stage changes nothing', () => {
    // The card's exact gesture: the user, on a `draft` quote, presses 审核中.
    const r = mount('draft');
    for (const row of rows(r)) {
      const target = stageOf(row, '审核中');
      fireEvent.pointerDown(target);
      fireEvent.mouseDown(target);
      fireEvent.pointerUp(target);
      fireEvent.mouseUp(target);
      fireEvent.click(target);

      expect(currentLabels(row)).toEqual(['草稿']);
      expect(target).toHaveAttribute('data-stage-state', 'upcoming');
      // …and the gesture did not park focus on a thing that cannot use it.
      expect(document.activeElement).toBe(document.body);
    }
  });

  it('B4 — each stage is an indicator PLUS a label, not a label on a pressable surface', () => {
    // The discriminating leg. A rail's indicator is a separate, decorative,
    // text-free element; a filled pill is its own label's surface and has
    // none. Remove the rail and only this leg goes red.
    const r = mount('in_review');
    for (const row of rows(r)) {
      const items = Array.from(row.querySelectorAll('[role="listitem"]')) as HTMLElement[];
      expect(items.length).toBe(QUOTE_STAGES.length);
      for (const item of items) {
        const rail = item.querySelector('[data-stage-rail]');
        expect(rail).not.toBeNull();
        expect(rail).toHaveAttribute('aria-hidden', 'true');
        // The indicator carries no label — the label lives beside it.
        expect((rail!.textContent || '')).toBe('');
        expect((item.textContent || '').trim().length).toBeGreaterThan(0);
      }
    }
  });
});
