/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * The stage-state announcement comes from the LOCALE PACKS (objectui#5916)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * This is the half of the card that made it its own card rather than a one-line
 * addition: the state a stage announces is user-facing copy, so it has to be a
 * translated key — NOT the hardcoded English literal the component still uses
 * for its two container labels (`'Record path'`, `'Alternative terminal
 * stages'`, both untouched here and filed separately).
 *
 * `record-path.stageStateAccessibleName.test.tsx` covers the SAME assertions on
 * the provider-less path, where `useDetailTranslation` serves
 * `DETAIL_DEFAULT_TRANSLATIONS`. The two paths are split across two files, not
 * two describes: `createI18n` registers its instance as react-i18next's
 * module-global default and the registration survives `cleanup()`, so a
 * provider-less render in this file would silently resolve against whichever
 * locale a previous case mounted. plugin-kanban's overlay-title pair splits for
 * exactly this reason and records it.
 *
 * Both paths must agree byte for byte on `en` — a map row that disagrees with
 * the pack labels one control two ways depending on whether a provider is
 * mounted (objectui#4401). `defaults-maps-mirror-en-pack.test.tsx` owns that
 * invariant globally; the `en` case below is this component's local instance of
 * it, and the two would fail together.
 *
 * ── What is asserted, and what is deliberately not ────────────────────────
 *
 * The STATE half of each name. The stage LABEL half is picklist data localized
 * upstream by `translateOptions`, and with no object metadata registered it
 * falls back to the schema's own labels — so the fixture's labels are asserted
 * as-is and this file makes no claim about picklist translation, which is not
 * its subject.
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

function mountIn(language: string, status: string): RenderResult {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <RecordContextProvider objectName="crm_quote" recordId="q1" data={{ id: 'q1', status }}>
        <RecordPathRenderer schema={{ statusField: 'status', stages: STAGES } as never} />
      </RecordContextProvider>
    </I18nProvider>,
  );
}

/** The desktop row; both rows carry identical names, and the split is covered next door. */
const firstRow = (r: RenderResult): HTMLElement =>
  (Array.from(r.container.querySelectorAll('[role="list"]')) as HTMLElement[])[0];

const stagesOf = (row: HTMLElement): HTMLElement[] => within(row).getAllByRole('listitem');

afterEach(() => cleanup());

describe('record:path stage state speaks the session locale (objectui#5916)', () => {
  it('en announces the same bytes the provider-less defaults map does', () => {
    // The #4401 invariant, locally: pack and map must not fork.
    const row = firstRow(mountIn('en', 'submitted'));
    expect(stagesOf(row)[0]).toHaveAccessibleName('草稿, completed');
    expect(stagesOf(row)[2]).toHaveAccessibleName('已提交, current stage');
    expect(stagesOf(row)[3]).toHaveAccessibleName('已拒绝, closed lost, not reached');
  });

  it('zh announces the state in Chinese, with no English left in the name', () => {
    const row = firstRow(mountIn('zh', 'submitted'));
    expect(stagesOf(row)[0]).toHaveAccessibleName('草稿，已完成');
    expect(stagesOf(row)[2]).toHaveAccessibleName('已提交，当前阶段');
    expect(stagesOf(row)[3]).toHaveAccessibleName('已拒绝，已失败，未到达');
    // The point of the card: a zh session must not hear English state words.
    for (const stage of stagesOf(row)) {
      expect(stage).not.toHaveAccessibleName(/completed|current stage|upcoming|closed lost/);
    }
  });

  it('de announces the state in German', () => {
    const row = firstRow(mountIn('de', 'submitted'));
    expect(stagesOf(row)[0]).toHaveAccessibleName('草稿, abgeschlossen');
    expect(stagesOf(row)[2]).toHaveAccessibleName('已提交, aktuelle Phase');
    expect(stagesOf(row)[3]).toHaveAccessibleName('已拒绝, verloren, nicht erreicht');
  });

  it('the record on a lost terminal announces it in the session locale too', () => {
    const row = firstRow(mountIn('zh', 'declined'));
    expect(stagesOf(row)[3]).toHaveAccessibleName('已拒绝，已失败，当前阶段');
  });

  it('the three locales do not all render the same string — the key is really consulted', () => {
    // Non-vacuity: if `t()` were bypassed (or every pack carried the English),
    // these three would coincide and every case above would still pass.
    const seen = new Set<string>();
    for (const lang of ['en', 'zh', 'de']) {
      const row = firstRow(mountIn(lang, 'submitted'));
      seen.add(stagesOf(row)[2].getAttribute('aria-label') ?? '');
      cleanup();
    }
    expect(seen.size).toBe(3);
  });
});
