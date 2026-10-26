/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * The GOAL terminus in the accessible name (objectui#5957)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * objectui#5916 gave every stage a name carrying travelled / current / upcoming
 * / lost-terminal, and deliberately left the `won` terminus announcing through
 * the ordinary three. The renderer still distinguished it — and only visually:
 *
 *     terminal !== 'lost' && state === 'upcoming'
 *       && (terminal === 'won' ? 'bg-emerald-500/30' : 'bg-muted')
 *
 * so two stages ahead of the record painted differently and announced
 * identically as `{{stage}}, upcoming`. The same WCAG 2.2 SC 1.4.1 class #5916
 * closed, on the one distinction it left behind.
 *
 * ── The criterion, asserted as a DIFFERENCE, not as a string ──────────────
 *
 * "Two upcoming stages that paint differently must not announce identically" is
 * a claim about a PAIR, so the load-bearing case below compares the two names to
 * each other rather than each to a literal. A literal-only suite would still
 * pass if some later edit made every upcoming stage announce as a goal stage.
 *
 * ── The scope decision this file also pins ────────────────────────────────
 *
 * Only the UNREACHED goal terminus gets a name of its own. A reached one paints
 * `bg-primary` when current and `bg-emerald-500` when completed — byte-identical
 * to any other current/completed stage — so naming it apart would hand a screen
 * reader a distinction the screen does not make, which is the mirror image of
 * the defect. That is a decision, so it is pinned as one (`a reached goal
 * terminus announces as an ordinary current stage`) rather than left to drift
 * silently into a fourth state later.
 *
 * ── Reachability without authors opting in ────────────────────────────────
 *
 * `classify()` reaches `won` from an explicit `terminal: 'won'` AND from the
 * `WON_TOKENS` heuristic (`won|success|成交|赢|完成`), so both routes are
 * exercised — a fix that only honoured the explicit spelling would leave every
 * Salesforce-style `closed_won` picklist on the defect.
 *
 * Every case mounts a provider: `createI18n` registers its instance as
 * react-i18next's module-global default and the registration survives
 * `cleanup()`, so a provider-less render here would resolve against whichever
 * locale a previous case mounted (the hazard
 * `record-path.stageStateAccessibleName.i18n.test.tsx` splits two files over).
 * The provider-less path's own invariant — `DETAIL_DEFAULT_TRANSLATIONS` serving
 * the same bytes as the `en` pack — is owned by
 * `app-shell/src/__tests__/defaults-maps-mirror-en-pack.test.tsx` (objectui#4401).
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, cleanup, within, type RenderResult } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { RecordContextProvider } from '@object-ui/react';
import { RecordPathRenderer } from '../record-path';

/** The goal terminus declared outright by the author. */
const EXPLICIT_STAGES = [
  { value: 'draft', label: '草稿' },
  { value: 'negotiation', label: '谈判中' },
  { value: 'closed_won', label: '已成交', terminal: 'won' as const },
  { value: 'closed_lost', label: '已流失', terminal: 'lost' as const },
];

/** The same path with NO `terminal` on the goal — `WON_TOKENS` has to find it. */
const HEURISTIC_STAGES = [
  { value: 'draft', label: '草稿' },
  { value: 'negotiation', label: '谈判中' },
  { value: 'closed_won', label: '已成交' },
  { value: 'closed_lost', label: '已流失', terminal: 'lost' as const },
];

function mountIn(
  language: string,
  status: string,
  stages: ReadonlyArray<Record<string, unknown>> = EXPLICIT_STAGES,
): RenderResult {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <RecordContextProvider objectName="crm_opportunity" recordId="o1" data={{ id: 'o1', status }}>
        <RecordPathRenderer schema={{ statusField: 'status', stages, ...{} } as never} />
      </RecordContextProvider>
    </I18nProvider>,
  );
}

const rows = (r: RenderResult): HTMLElement[] =>
  Array.from(r.container.querySelectorAll('[role="list"]')) as HTMLElement[];

const stagesOf = (row: HTMLElement): HTMLElement[] => within(row).getAllByRole('listitem');

/**
 * The state half of a composed name — everything the pack contributes once the
 * stage's own label is removed. Every `detail.pathStage*` value is
 * `'{{stage}}' + state`, so stripping the label leaves exactly the state.
 */
const stateHalf = (item: HTMLElement): string => {
  const name = item.getAttribute('aria-label') ?? '';
  const label = (item.querySelector('span:last-of-type')?.textContent ?? '').trim();
  return name.startsWith(label) ? name.slice(label.length) : name;
};

/** Index 1 is a plain upcoming stage; index 2 is the goal terminus. */
const PLAIN_UPCOMING = 1;
const GOAL = 2;

afterEach(() => cleanup());

describe('an unreached goal terminus announces as one (objectui#5957)', () => {
  it('en names it a goal stage instead of a plain upcoming stage', () => {
    const [desktop, mobile] = rows(mountIn('en', 'draft'));
    expect(stagesOf(desktop)[GOAL]).toHaveAccessibleName('已成交, goal stage, not reached');
    // Both rows, so the fix does not land on one viewport only.
    expect(stagesOf(mobile)[GOAL]).toHaveAccessibleName('已成交, goal stage, not reached');
  });

  it('two upcoming stages that PAINT differently no longer ANNOUNCE identically', () => {
    // The card's criterion, asserted as the pair it is. Before the fix both of
    // these read `{{stage}}, upcoming` while the rails differed by hue alone.
    const desktop = rows(mountIn('en', 'draft'))[0];
    const items = stagesOf(desktop);
    const plain = items[PLAIN_UPCOMING];
    const goal = items[GOAL];

    // Same state — so the ONLY thing that distinguished them was colour.
    expect(plain).toHaveAttribute('data-stage-state', 'upcoming');
    expect(goal).toHaveAttribute('data-stage-state', 'upcoming');
    // And the renderer really does treat them as different kinds of upcoming.
    expect(plain).not.toHaveAttribute('data-stage-terminal');
    expect(goal).toHaveAttribute('data-stage-terminal', 'won');

    // Compare the STATE half, not the whole name. Each name is `{{stage}}` plus
    // its state, and the two stages carry different labels — so comparing whole
    // names is VACUOUS: it stays green with the fix reverted, purely because
    // `已成交` is not `谈判中`. Measured, by deleting the `won` branch and
    // watching this case pass anyway. The state half is the half the card is
    // about, and it is what colour was carrying alone.
    expect(stateHalf(goal)).not.toBe(stateHalf(plain));
    // ...and it is genuinely the goal wording, not merely some other string.
    expect(stateHalf(goal)).toBe(', goal stage, not reached');
    expect(stateHalf(plain)).toBe(', upcoming');
  });

  it('the heuristic route reaches it too — no author opt-in required', () => {
    // `classify()` finds `won` in `closed_won` via WON_TOKENS with no `terminal`
    // in the config, which is how Salesforce-style picklists arrive.
    const desktop = rows(mountIn('en', 'draft', HEURISTIC_STAGES))[0];
    const goal = stagesOf(desktop)[GOAL];
    expect(goal).toHaveAttribute('data-stage-terminal', 'won');
    expect(goal).toHaveAccessibleName('已成交, goal stage, not reached');
  });

  it('zh and de announce the goal state in their own locale', () => {
    for (const [lang, name] of [
      ['zh', '已成交，目标阶段，未到达'],
      ['de', '已成交, Zielphase, nicht erreicht'],
    ] as const) {
      expect(stagesOf(rows(mountIn(lang, 'draft'))[0])[GOAL]).toHaveAccessibleName(name);
      cleanup();
    }
  });

  it('a zh session hears no English in the goal stage name', () => {
    const goal = stagesOf(rows(mountIn('zh', 'draft'))[0])[GOAL];
    expect(goal).not.toHaveAccessibleName(/goal stage|not reached|upcoming/);
  });

  it('the three locales do not all render the same string — the key is really consulted', () => {
    // Non-vacuity: if `t()` were bypassed, or every pack carried the English,
    // these three would coincide and every case above would still pass.
    const seen = new Set<string>();
    for (const lang of ['en', 'zh', 'de']) {
      seen.add(stagesOf(rows(mountIn(lang, 'draft'))[0])[GOAL].getAttribute('aria-label') ?? '');
      cleanup();
    }
    expect(seen.size).toBe(3);
  });
});

describe('a REACHED goal terminus stays an ordinary stage — deliberately', () => {
  it('announces as a plain current stage, because it paints as one', () => {
    // `railClass` gives a current stage `bg-primary` whether or not it is the
    // goal, so there is no colour-only distinction here to mirror. Naming it
    // apart would ADD information the screen does not carry. Pinned so the
    // decision cannot drift into a fourth state unnoticed.
    const desktop = rows(mountIn('en', 'closed_won'))[0];
    const goal = stagesOf(desktop)[GOAL];
    expect(goal).toHaveAttribute('data-stage-state', 'current');
    expect(goal).toHaveAttribute('data-stage-terminal', 'won');
    expect(goal).toHaveAccessibleName('已成交, current stage');
  });

  it('the lost terminus is untouched by any of this (objectui#5916 stays closed)', () => {
    const desktop = rows(mountIn('en', 'draft'))[0];
    expect(stagesOf(desktop)[3]).toHaveAccessibleName('已流失, closed lost, not reached');
  });
});
