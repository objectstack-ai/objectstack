/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * A `record:path` stage announces its STATE, not just its label (objectui#5916)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * The defect: travelled / upcoming / lost reached a sighted user through colour
 * (emerald / muted / destructive) and a glyph, and BOTH glyphs are `aria-hidden`
 * decoration. `aria-current="step"` marked the current stage and nothing else, so
 * a screen-reader user got a list of identically-announced items and could not
 * tell 草稿 (behind the record) from 已接受 (ahead of it). A `lost` terminal was
 * the sharpest case: 已拒绝 announced exactly like an ordinary unreached stage.
 * WCAG 2.2 SC 1.4.1 *Use of Color*.
 *
 * ── Why `aria-label` and not visually-hidden text ─────────────────────────
 *
 * The card offered both shapes. The choice is a MEASUREMENT, not a preference:
 * `listitem` is not a name-from-contents role, so text placed inside a stage —
 * `sr-only` or otherwise — leaves the accessible name EMPTY. Measured on this
 * tree with this exact harness before the fix was written:
 *
 *     <div role="listitem"><span class="sr-only">completed, </span>草稿</div>
 *     // → toHaveAccessibleName('')          ← the visually-hidden shape
 *     <div role="listitem" aria-label="草稿, completed">…</div>
 *     // → toHaveAccessibleName('草稿, completed')
 *
 * So the visually-hidden shape would have satisfied a DOM assertion ("the span
 * is there") while delivering nothing to the accessibility tree.
 *
 * ── Every case here reads the ACCESSIBLE NAME, never the DOM ──────────────
 *
 * `toHaveAccessibleName` and the `{ name }` option of `getAllByRole` both run
 * the accessible-name computation (`dom-accessibility-api`). Nothing below
 * asserts a class, a span or an `aria-label` attribute — reading the attribute
 * back would only restate the markup, which is precisely the evidence this card
 * says is not evidence.
 *
 * ── Selection is positional, assertion is by name (non-circular) ──────────
 *
 * Per-stage cases pick the stage out by its INDEX among the row's `listitem`s and
 * then read the name off it. Selecting by name would assume the answer: with the
 * fix reverted every name is '', so a name-keyed query would report "no such
 * stage" rather than "wrong name".
 *
 * ── Resolution path (ablation validity) ───────────────────────────────────
 *
 * The subject is imported RELATIVELY (`../record-path`) and the cross-package
 * imports are mapped to each package's own `src` by the root `vitest.config.mts`
 * alias table. Nothing here resolves through a `dist/`, so an ablation of
 * `record-path.tsx` is visible to this suite WITHOUT a rebuild — the same
 * property `record-path.inertReadout.test.tsx` records next door.
 *
 * ── Direction, predicted before running ───────────────────────────────────
 *
 * Deleting the `aria-label` line from `renderStage` turns every case in groups
 * B, C and D red (names collapse to ''), and leaves group A — the #5768 readout
 * contract: `aria-current`, the decorative glyphs, the labels on screen — GREEN,
 * because none of it ever depended on the name. Measured, not assumed; the
 * numbers are in the PR body.
 *
 * ── Provider-less on purpose ──────────────────────────────────────────────
 *
 * No `I18nProvider` is mounted, so `useDetailTranslation` serves
 * `DETAIL_DEFAULT_TRANSLATIONS` and the expected strings are that map's English.
 * The pack-backed path is a SEPARATE file
 * (`record-path.stageStateAccessibleName.i18n.test.tsx`) because `createI18n`
 * registers its instance as react-i18next's module-global default and that
 * registration survives `cleanup()` — a provider-less render sharing a file with
 * a provider-mounted one would silently resolve against whichever locale ran
 * first. Same split, same reason, as plugin-kanban's overlay-title pair.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, cleanup, within, type RenderResult } from '@testing-library/react';
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

function mount(status: string, stages: unknown[] = QUOTE_STAGES): RenderResult {
  return render(
    <RecordContextProvider objectName="crm_quote" recordId="q1" data={{ id: 'q1', status }}>
      <RecordPathRenderer schema={{ statusField: 'status', stages } as never} />
    </RecordContextProvider>,
  );
}

/**
 * Desktop and mobile are both in the DOM at once (a CSS breakpoint separates
 * them and this environment applies none), so every invariant is asserted on
 * BOTH — a regression reaching only one viewport would otherwise pass.
 */
const rows = (r: RenderResult): HTMLElement[] =>
  Array.from(r.container.querySelectorAll('[role="list"]')) as HTMLElement[];

/** The row's stages in DOM order. Positional, so per-stage cases stay non-circular. */
const stagesOf = (row: HTMLElement): HTMLElement[] => within(row).getAllByRole('listitem');

/** Stages of `row` whose COMPUTED ACCESSIBLE NAME matches — not a DOM query. */
const announcedAs = (row: HTMLElement, name: string | RegExp): HTMLElement[] =>
  within(row).queryAllByRole('listitem', { name });

afterEach(() => cleanup());

describe('#5916 group A — the #5768 readout contract still holds', () => {
  it('both rows render every stage, and the glyphs stay decorative', () => {
    const r = mount('submitted');
    expect(rows(r)).toHaveLength(2);

    for (const row of rows(r)) {
      expect(stagesOf(row)).toHaveLength(QUOTE_STAGES.length);
      // The ✓ is decoration and must REMAIN decoration — the fix adds a text
      // equivalent, it does not un-hide the glyph (the card's triage ruling).
      for (const span of Array.from(row.querySelectorAll('span'))) {
        const text = span.textContent ?? '';
        if (text === '✓' || text === '✗') expect(span).toHaveAttribute('aria-hidden', 'true');
      }
    }
  });

  it('`aria-current="step"` still marks exactly the current stage', () => {
    const r = mount('submitted');
    for (const row of rows(r)) {
      const marked = stagesOf(row).filter((el) => el.getAttribute('aria-current') === 'step');
      expect(marked).toHaveLength(1);
      expect(marked[0].textContent).toContain('已提交');
    }
  });
});

describe('#5916 group B — travelled / current / upcoming reach the accessible name', () => {
  it('no stage is left nameless — non-vacuity for every case below', () => {
    // Before the fix every one of these was ''. If the renderer ever stops
    // naming stages this fails first, naming the file as vacuous rather than
    // letting a later case compare '' against ''.
    const r = mount('submitted');
    for (const row of rows(r)) {
      for (const stage of stagesOf(row)) expect(stage).toHaveAccessibleName();
    }
  });

  it('a travelled stage announces that it is completed, in both rows', () => {
    const r = mount('submitted');
    for (const row of rows(r)) {
      expect(stagesOf(row)[0]).toHaveAccessibleName('草稿, completed');
      expect(stagesOf(row)[1]).toHaveAccessibleName('审核中, completed');
    }
  });

  it('the current stage announces that it is current, in both rows', () => {
    const r = mount('submitted');
    for (const row of rows(r)) {
      expect(stagesOf(row)[2]).toHaveAccessibleName('已提交, current stage');
    }
  });

  it('an upcoming stage announces that it is upcoming, in both rows', () => {
    const r = mount('submitted');
    for (const row of rows(r)) {
      expect(stagesOf(row)[3]).toHaveAccessibleName('已接受, upcoming');
      expect(stagesOf(row)[5]).toHaveAccessibleName('已过期, upcoming');
    }
  });

  it('THE defect, stated as a partition: six stages, three distinct announcements', () => {
    // The card's complaint was "six identically-announced items". Each stage now
    // falls into exactly one bucket and the buckets sum to every stage, so no
    // stage is announced ambiguously and none was missed.
    const r = mount('submitted');
    for (const row of rows(r)) {
      expect(announcedAs(row, /, completed$/)).toHaveLength(2);
      expect(announcedAs(row, /, current stage$/)).toHaveLength(1);
      expect(announcedAs(row, /, upcoming$/)).toHaveLength(3);
      expect(stagesOf(row)).toHaveLength(2 + 1 + 3);
    }
  });

  it('the state follows the record rather than the position', () => {
    // Non-vacuity of a second kind: the names are computed from the record's
    // value, not baked into the markup. On stage 1 nothing is completed yet.
    const r = mount('draft');
    for (const row of rows(r)) {
      expect(stagesOf(row)[0]).toHaveAccessibleName('草稿, current stage');
      expect(stagesOf(row)[1]).toHaveAccessibleName('审核中, upcoming');
      expect(announcedAs(row, /, completed$/)).toHaveLength(0);
    }
  });
});

describe('#5916 group C — the lost terminal, which used to announce like any other stage', () => {
  it('an unreached lost terminal says so, and is NOT announced as an ordinary upcoming stage', () => {
    const r = mount('submitted', WITH_LOST_STAGES);
    for (const row of rows(r)) {
      expect(stagesOf(row)[3]).toHaveAccessibleName('已拒绝, closed lost, not reached');
      // The card verbatim: "已拒绝 announces exactly like an ordinary upcoming
      // stage". It must not. In this fixture the lost terminal is the ONLY
      // unreached stage, so if it still announced as a plain upcoming one this
      // query would find it.
      expect(announcedAs(row, /, upcoming$/)).toHaveLength(0);
      expect(announcedAs(row, /closed lost/)).toHaveLength(1);
    }
  });

  it('a lost terminal the record SITS on announces both facts', () => {
    const r = mount('declined', WITH_LOST_STAGES);
    for (const row of rows(r)) {
      expect(stagesOf(row)[3]).toHaveAccessibleName('已拒绝, closed lost, current stage');
      // …and it is still the current step programmatically.
      expect(stagesOf(row)[3]).toHaveAttribute('aria-current', 'step');
    }
  });

  it('a reached lost terminal and an unreached one do not announce alike', () => {
    const reached = mount('declined', WITH_LOST_STAGES);
    const reachedName = /closed lost, current stage$/;
    for (const row of rows(reached)) expect(announcedAs(row, reachedName)).toHaveLength(1);
    cleanup();

    const unreached = mount('submitted', WITH_LOST_STAGES);
    for (const row of rows(unreached)) expect(announcedAs(row, reachedName)).toHaveLength(0);
  });

  it('the ✗ stays aria-hidden — the fix adds a text equivalent, it does not expose the glyph', () => {
    const r = mount('submitted', WITH_LOST_STAGES);
    const crosses = Array.from(r.container.querySelectorAll('span')).filter(
      (s) => (s.textContent ?? '') === '✗',
    );
    expect(crosses.length).toBeGreaterThan(0);
    for (const c of crosses) expect(c).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('#5916 group D — the announced name never drifts from what is on screen', () => {
  it("every stage's accessible name contains its own visible label", () => {
    // An author-supplied name REPLACES the contents in the name computation, so
    // this is the invariant that keeps the two from forking: both are rendered
    // from the same already-picklist-localized `stage.label`.
    const r = mount('submitted');
    for (const row of rows(r)) {
      stagesOf(row).forEach((el, i) => {
        expect(announcedAs(row, new RegExp(`^${QUOTE_STAGES[i].label},`))).toContain(el);
      });
    }
  });
});
