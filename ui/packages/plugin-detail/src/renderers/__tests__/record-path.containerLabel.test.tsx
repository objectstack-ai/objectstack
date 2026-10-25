/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * `record:path`'s CONTAINER labels (objectui#5956)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * objectui#5916 localized every STAGE's accessible name and deliberately left
 * the two container labels alone. That left one control announcing in two
 * languages at once: a zh session heard `Record path` for the list itself while
 * every stage inside it announced in Chinese. This file pins the fix — and the
 * OTHER container label, which was a different defect entirely.
 *
 * ── Two defects, two shapes of assertion ──────────────────────────────────
 *
 * 1. `role="list"` on both rows: a hardcoded English literal became
 *    `detail.pathLabel`, with an authored name still winning ahead of it. That
 *    name was `schema.aria.label` when this file was written; objectui#9556
 *    made it the contract spelling `aria.ariaLabel`, and objectui#9945
 *    retired the refused `aria.label`.
 *    Assertable as an accessible NAME, because `list` takes a name from the
 *    author.
 *
 * 2. The lost-terminal alt group: `aria-label="Alternative terminal stages"` sat
 *    on a bare `div`. A `div` is `generic`, and browsers expose no accessible
 *    name on a generic element — so that string reached NOBODY. It was inert,
 *    not untranslated. The assertion below is therefore an ABSENCE (no element
 *    carries that name and no wrapper claims a named role), paired with the
 *    positive fact that makes the absence safe: the stages inside already
 *    announce `closed lost` themselves, so nothing a user could hear is lost.
 *    The renderer's own comment records the three measurements behind the pick.
 *
 * ── Why every case here mounts a provider ─────────────────────────────────
 *
 * `createI18n` registers its instance as react-i18next's module-global default
 * and the registration survives `cleanup()`, so a provider-LESS render in this
 * file would silently resolve against whichever locale a previous case mounted
 * — the same hazard `record-path.stageStateAccessibleName.i18n.test.tsx` records
 * and splits two files over. Rather than re-open that split, every case here is
 * provider-mounted. The provider-less path's own invariant — that
 * `DETAIL_DEFAULT_TRANSLATIONS` serves the same bytes the `en` pack does, so
 * `detail.pathLabel` cannot fork by host — is owned globally and per key by
 * `app-shell/src/__tests__/defaults-maps-mirror-en-pack.test.tsx` (objectui#4401),
 * which compares the map against the pack key by key and now covers this row.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, cleanup, within, type RenderResult } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { RecordContextProvider } from '@object-ui/react';
import { RecordPathRenderer } from '../record-path';

const STAGES = [
  { value: 'draft', label: '草稿' },
  { value: 'in_review', label: '审核中' },
  { value: 'submitted', label: '已提交' },
  { value: 'declined', label: '已拒绝', terminal: 'lost' as const },
];

function mountIn(language: string, schemaExtra: Record<string, unknown> = {}): RenderResult {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <RecordContextProvider objectName="crm_quote" recordId="q1" data={{ id: 'q1', status: 'submitted' }}>
        <RecordPathRenderer schema={{ statusField: 'status', stages: STAGES, ...schemaExtra } as never} />
      </RecordContextProvider>
    </I18nProvider>,
  );
}

/** Both rows are rendered on every host; the viewport split is CSS-only. */
const rows = (r: RenderResult): HTMLElement[] =>
  Array.from(r.container.querySelectorAll('[role="list"]')) as HTMLElement[];

afterEach(() => cleanup());

describe('record:path container label speaks the session locale (objectui#5956)', () => {
  it('en names both rows from the pack', () => {
    const [desktop, mobile] = rows(mountIn('en'));
    expect(desktop).toHaveAccessibleName('Record path');
    expect(mobile).toHaveAccessibleName('Record path');
  });

  it('zh names both rows in Chinese — no English left on the container', () => {
    const [desktop, mobile] = rows(mountIn('zh'));
    expect(desktop).toHaveAccessibleName('记录路径');
    expect(mobile).toHaveAccessibleName('记录路径');
    // The point of the card: the list must not announce in English while the
    // stages inside it announce in Chinese.
    for (const row of rows(mountIn('zh'))) {
      expect(row).not.toHaveAccessibleName(/Record path/);
    }
  });

  it('de and ja name both rows in their own locale', () => {
    for (const [lang, name] of [
      ['de', 'Datensatzpfad'],
      ['ja', 'レコードパス'],
    ] as const) {
      for (const row of rows(mountIn(lang))) expect(row).toHaveAccessibleName(name);
      cleanup();
    }
  });

  it('the three locales do not all render the same string — the key is really consulted', () => {
    // Non-vacuity: if `t()` were bypassed (or every pack carried the English),
    // these three would coincide and every case above would still pass.
    const seen = new Set<string>();
    for (const lang of ['en', 'zh', 'de']) {
      seen.add(rows(mountIn(lang))[0].getAttribute('aria-label') ?? '');
      cleanup();
    }
    expect(seen.size).toBe(3);
  });

  it('an author `schema.aria.ariaLabel` still wins ahead of the pack fallback', () => {
    // The override is the whole reason the literal was a FALLBACK; localizing it
    // must not promote the pack above what the author asked for. This case
    // authored the refused `aria.label` until objectui#9945 retired it; the
    // override it pins is the author's, so it now uses the contract spelling.
    for (const row of rows(mountIn('zh', { aria: { ariaLabel: 'Deal stages' } }))) {
      expect(row).toHaveAccessibleName('Deal stages');
    }
  });
});

describe('the lost-terminal alt group carries no inert label (objectui#5956)', () => {
  it('no element anywhere claims the old hardcoded group name', () => {
    const r = mountIn('en');
    // It was never announced — it sat on a `generic` element. Removing it costs
    // no user anything, and it must not come back untranslated either.
    expect(r.container.querySelector('[aria-label="Alternative terminal stages"]')).toBeNull();
    expect(r.container.textContent).not.toContain('Alternative terminal stages');
  });

  it('the alt-group wrapper claims no named role at all', () => {
    const r = mountIn('en');
    const desktop = rows(r)[0];
    // Every element inside the desktop row is either the list itself, a stage
    // `listitem`, a presentational wrapper, or a stage's own decoration — no
    // `group`/`region`/`navigation` box was introduced to hold a name.
    expect(desktop.querySelectorAll('[role="group"],[role="region"],[role="navigation"]')).toHaveLength(0);
  });

  it('what the group would have said is already on the stages themselves', () => {
    // The positive half: the absence above is only safe because each lost stage
    // announces its own terminal state, in the session locale, after #5916.
    const zhRow = rows(mountIn('zh'))[0];
    const zhStages = within(zhRow).getAllByRole('listitem');
    expect(zhStages[3]).toHaveAccessibleName('已拒绝，已失败，未到达');
    cleanup();
    const enRow = rows(mountIn('en'))[0];
    const enStages = within(enRow).getAllByRole('listitem');
    expect(enStages[3]).toHaveAccessibleName('已拒绝, closed lost, not reached');
  });
});
