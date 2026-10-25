/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Mutable host translation table the mock resolves against. i18next returns the
// raw key on a miss, so the mock mirrors that contract.
let hostDict: Record<string, string> = {};
const hostT = (key: string) => hostDict[key] ?? key;

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: hostT, language: 'zh' }),
}));

import { useGanttTranslation, GANTT_DEFAULT_TRANSLATIONS } from './useGanttTranslation';

describe('useGanttTranslation per-key fallback', () => {
  beforeEach(() => {
    hostDict = {};
  });

  it('uses the host translation when the key is present', () => {
    hostDict = { 'gantt.linkType.fs': '完成 → 开始' };
    const { result } = renderHook(() => useGanttTranslation());
    expect(result.current.t('gantt.linkType.fs')).toBe('完成 → 开始');
  });

  it('falls back to bundled default ONLY for keys the host is missing (partial dictionary)', () => {
    // The exact os-tianshun-ehr symptom: a host that translates the *common*
    // gantt keys but lags on newer ones. The all-or-nothing probe would trust
    // the host for everything and leak raw keys like `gantt.linkType.fs`.
    hostDict = { 'gantt.column.taskName': '任务名称' };
    const { result } = renderHook(() => useGanttTranslation());
    const { t } = result.current;
    // Present in host → host wins.
    expect(t('gantt.column.taskName')).toBe('任务名称');
    // Missing in host → bundled English default, NOT the raw key.
    expect(t('gantt.linkType.fs')).toBe(GANTT_DEFAULT_TRANSLATIONS['gantt.linkType.fs']);
    expect(t('gantt.menu.removeDependency')).toBe(
      GANTT_DEFAULT_TRANSLATIONS['gantt.menu.removeDependency'],
    );
    // Never the raw key.
    expect(t('gantt.linkType.fs')).not.toBe('gantt.linkType.fs');
  });

  it('threads the host language through', () => {
    const { result } = renderHook(() => useGanttTranslation());
    expect(result.current.language).toBe('zh');
  });
});

/**
 * The provider-less fallback interpolator must be LITERAL on both sides, the
 * way i18next is — objectui#4370, the hand-rolled copy of the shared helper's
 * objectui#3418 fix.
 *
 * `String.prototype.replace` diverges from i18next twice, and this table pins
 * both. The values below are record titles: `gantt.delete.body` is rendered
 * with `t('gantt.delete.body', { title: pendingDelete.title })` at
 * `ObjectGantt.tsx`, so every one of these is a title a user can type.
 */
describe('useGanttTranslation fallback interpolation is literal (objectui#4370)', () => {
  beforeEach(() => {
    hostDict = {};
  });

  // `$&`, `` $` ``, `$'` and `$$` are replacement-string patterns to `replace`
  // and plain text to i18next. Measured on the pre-fix code, the middle column
  // is what the delete dialog actually printed.
  const CORRUPTING_TITLES: ReadonlyArray<readonly [string, string]> = [
    // title, what `replace` produced before the fix
    ['A$&B', '"A{{title}}B" will be permanently removed. This action cannot be undone.'],
    ['x$`y', '"x"y" will be permanently removed. This action cannot be undone.'],
    ['p$$q', '"p$q" will be permanently removed. This action cannot be undone.'],
    [
      "u$'v",
      '"u" will be permanently removed. This action cannot be undone.v" will be permanently removed. This action cannot be undone.',
    ],
  ];

  it.each(CORRUPTING_TITLES)(
    'renders a task titled %j verbatim in the delete dialog',
    (title, corrupted) => {
      const { result } = renderHook(() => useGanttTranslation());
      const rendered = result.current.t('gantt.delete.body', { title });
      // The `$&` row is the ugly one: the PLACEHOLDER is printed back to the
      // user, inside the record's own name.
      expect(rendered).toBe(`"${title}" will be permanently removed. This action cannot be undone.`);
      expect(rendered).not.toBe(corrupted);
      expect(rendered).not.toContain('{{title}}');
    },
  );

  it('substitutes EVERY occurrence of a placeholder, not just the first', () => {
    // `replace` with a string needle stops after the first hit; i18next does
    // not. No key in the bundled table repeats a placeholder today, so the
    // template here is a raw key (the table misses it, so `fallback` returns
    // the key and interpolates into it) — the mechanism is the same one the
    // shipped keys run through, and this pins it before a locale needs it.
    const { result } = renderHook(() => useGanttTranslation());
    expect(result.current.t('{{n}} of {{n}}', { n: 3 })).toBe('3 of 3');
  });

  it('leaves the single-brace quickFilter idiom alone', () => {
    // `gantt.quickFilter.resultSummary` is resolved by the call site's own
    // `.replace('{shown}', …)`, NOT by this interpolator — pinned as the
    // deliberate exception by `gantt-quickfilter-locale-parity.test.ts`.
    const { result } = renderHook(() => useGanttTranslation());
    expect(result.current.t('gantt.quickFilter.resultSummary', { shown: 2, total: 9 })).toBe(
      GANTT_DEFAULT_TRANSLATIONS['gantt.quickFilter.resultSummary'],
    );
  });
});
