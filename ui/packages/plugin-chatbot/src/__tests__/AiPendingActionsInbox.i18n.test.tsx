/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `AiPendingActionsInbox` speaks the session locale — objectui#7173.
 *
 * The file held its own `formatRelative` returning hardcoded English, and had
 * no translation wiring at all (2 incidental matches, neither a `t()` call).
 * That is the UNWIRED-COMPONENT shape, so it is swept WHOLE here rather than
 * having only its timestamps converted: objectui#7142 wired one string into an
 * otherwise untranslated component and shipped something visibly half-done, and
 * objectui#7149 is what finishing that afterwards cost.
 *
 * ## Why zh/ar and not `en`
 *
 * The four relative-time keys already existed in all ten packs, and each `en`
 * value is BYTE-IDENTICAL to the literal it replaces (`'just now'`,
 * `'{{count}}m ago'`, …). An `en`-only assertion is therefore green before the
 * fix too — it cannot discriminate a pack lookup from a hardcoded string. The
 * zh and ar legs are the ones that can, and they are what makes this suite
 * evidence: run against the unconverted file, 8 of these 12 cases fail and the
 * 4 survivors are exactly the `en`/provider-less ones.
 *
 * That measurement is also why the `en` case below is labelled honestly: it does
 * NOT discriminate the fix — the `aiApprovals.*` `en` values are byte-identical
 * to the literals too, so it was green on the old file as well. What it holds is
 * the other direction, that the English copy still says what it said, plus this
 * copy's own arithmetic.
 *
 * ## The provider-less leg lives in a SEPARATE file, deliberately
 *
 * `AiPendingActionsInbox.noProviderFallback.test.tsx`. `createI18n` installs
 * itself as react-i18next's module-level global (`initReactI18next`), so once
 * ANY test in a file has mounted an `I18nProvider`, a later provider-less
 * render in the same file reads that global instead of the defaults map — and
 * a "provider-less" assertion in this file would silently be measuring the
 * previous test's pack. Vitest isolates module state per FILE, so a file that
 * never mounts a provider is the only place that leg can be measured. Measured
 * here first: the two mounts in one test rendered zh twice.
 *
 * ## The four thresholds are pinned, deliberately
 *
 * This is the FIFTH spelling of the helper in the repo and the variants are not
 * interchangeable (objectui#7173's own triage: ⛔ do not unify them). This one
 * uses `Math.round` — not `Math.floor` — and breaks at 45s / 60min / 24h / 30d,
 * not 60s / 7d. Two rows below exist only to hold that:
 *
 *   - 50 s -> `1m ago`. A 60 s threshold (`ActivityTimeline`, `RecordComments`)
 *     would still say "just now".
 *   - 90 s -> `2m ago`. `Math.floor` would say `1m ago`.
 *   - 20 d -> `20d ago`. A 7 d threshold would already have fallen through to
 *     `toLocaleDateString()`.
 *
 * A later "unification" that changes any of those turns these red.
 *
 * `{{count}}`, `{{id}}`, `{{message}}`, `{{tool}}` and `{{object}}` are spelled
 * with no inner spaces — the one spelling BOTH paths resolve (i18next on the
 * provider path, `interpolateFallback` on the provider-less one, objectui#3512 /
 * #6219). No inline `defaultValue` anywhere (objectui#3517): every string
 * resolves from the packs, and provider-lessly from the defaults map.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { I18nProvider, en } from '@object-ui/i18n';
import type { PendingActionRow } from '@objectstack/spec/contracts';
import { AiPendingActionsInbox } from '../AiPendingActionsInbox';
import { AI_APPROVALS_DEFAULT_TRANSLATIONS } from '../useAiApprovalsTranslation';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function rows(): PendingActionRow[] {
  const base = {
    object_name: 'task',
    action_name: 'delete',
    tool_name: 'action_delete_task',
    tool_input: '{"id":"t1"}',
    status: 'pending' as const,
    proposed_by: 'agent_1',
  };
  return [
    { ...base, id: 'aaaaaaaa1111', proposed_at: ago(30 * SEC) },
    { ...base, id: 'bbbbbbbb2222', proposed_at: ago(50 * SEC) },
    { ...base, id: 'cccccccc3333', proposed_at: ago(90 * SEC) },
    { ...base, id: 'dddddddd4444', proposed_at: ago(3 * HOUR) },
    { ...base, id: 'eeeeeeee5555', proposed_at: ago(20 * DAY) },
  ];
}

function stubList(items: PendingActionRow[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({ items, total: items.length }) }) as unknown as Response),
  );
}

beforeEach(() => stubList(rows()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderIn(language: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <AiPendingActionsInbox pollInterval={0} />
    </I18nProvider>,
  );
}

/** Wait for the first fetch to settle and the table to paint. */
async function firstRow(text: string) {
  return waitFor(() => expect(screen.getAllByText(text).length).toBeGreaterThan(0));
}

const EN = {
  title: 'AI Approvals',
  description: 'Actions an AI agent proposed that need a human review before execution.',
  tabDecided: 'Decided',
  colTool: 'Tool',
  colDecision: 'Decision',
  view: 'View',
  approve: 'Approve',
  reject: 'Reject',
  emptyTitle: 'No actions waiting',
  emptyDescription: 'When the AI proposes a sensitive action it will appear here for review.',
  justNow: 'just now',
  oneMinute: '1m ago',
  twoMinutes: '2m ago',
  threeHours: '3h ago',
  twentyDays: '20d ago',
};

const ZH = {
  title: 'AI 审批',
  description: 'AI 智能体提出的操作，需要人工审核后才会执行。',
  tabDecided: '已处理',
  colTool: '工具',
  colDecision: '决定',
  view: '查看',
  approve: '通过',
  reject: '拒绝',
  emptyTitle: '暂无待处理操作',
  emptyDescription: '当 AI 提出敏感操作时，会显示在这里等待审核。',
  justNow: '刚刚',
  oneMinute: '1分钟前',
  twoMinutes: '2分钟前',
  threeHours: '3小时前',
  twentyDays: '20天前',
};

const AR = {
  title: 'موافقات الذكاء الاصطناعي',
  colTool: 'الأداة',
  view: 'عرض',
  approve: 'موافقة',
  reject: 'رفض',
  emptyTitle: 'لا توجد إجراءات في الانتظار',
  justNow: 'الآن',
  // `detail.*Ago` are count families since objectui#11445, so each count reads
  // its own `ar` category: 1 `one`, 2 `two` (the dual), 3 `few` (the plural),
  // 20 `many` (accusative singular). The single forms they replaced read
  // «منذ 2 دقيقة», «منذ 3 ساعة» and «منذ 20 يوم».
  oneMinute: 'منذ 1 دقيقة',
  twoMinutes: 'منذ دقيقتين (2)',
  threeHours: 'منذ 3 ساعات',
  twentyDays: 'منذ 20 يومًا',
};

describe('AiPendingActionsInbox — relative times resolve from the packs (objectui#7173)', () => {
  it('renders all four relative-time branches from the zh pack', async () => {
    renderIn('zh');
    await firstRow(ZH.justNow);

    expect(screen.getAllByText(ZH.justNow).length).toBe(1);
    expect(screen.getByText(ZH.oneMinute)).toBeTruthy();
    expect(screen.getByText(ZH.twoMinutes)).toBeTruthy();
    expect(screen.getByText(ZH.threeHours)).toBeTruthy();
    expect(screen.getByText(ZH.twentyDays)).toBeTruthy();
  });

  it('leaves no English relative time behind in a zh session', async () => {
    // The defect itself. Green before the fix on an `en` assertion; red here.
    renderIn('zh');
    await firstRow(ZH.justNow);

    for (const en of [EN.justNow, EN.oneMinute, EN.twoMinutes, EN.threeHours, EN.twentyDays]) {
      expect(screen.queryByText(en)).toBeNull();
    }
  });

  it('renders all four relative-time branches from the ar pack', async () => {
    renderIn('ar');
    await firstRow(AR.justNow);

    expect(screen.getByText(AR.oneMinute)).toBeTruthy();
    expect(screen.getByText(AR.twoMinutes)).toBeTruthy();
    expect(screen.getByText(AR.threeHours)).toBeTruthy();
    expect(screen.getByText(AR.twentyDays)).toBeTruthy();
    expect(screen.queryByText(EN.justNow)).toBeNull();
  });

  it('keeps this copy’s own arithmetic: Math.round, 45s / 60min / 24h / 30d', async () => {
    // 50s -> "1m ago" pins the 45s threshold (a 60s one still says "just now");
    // 90s -> "2m ago" pins Math.round (floor gives 1m); 20d -> "20d ago" pins
    // the 30d tail (a 7d one would already show a date).
    renderIn('en');
    await firstRow(EN.justNow);

    expect(screen.getAllByText(EN.justNow).length).toBe(1);
    expect(screen.getByText(EN.oneMinute)).toBeTruthy();
    expect(screen.getByText(EN.twoMinutes)).toBeTruthy();
    expect(screen.getByText(EN.threeHours)).toBeTruthy();
    expect(screen.getByText(EN.twentyDays)).toBeTruthy();
  });

  it('falls past 30 days to a locale date, not to a relative phrase', async () => {
    stubList([{ ...rows()[0], id: 'ffffffff6666', proposed_at: ago(40 * DAY) }]);
    renderIn('en');

    const when = new Date(Date.now() - 40 * DAY).toLocaleDateString();
    await firstRow(when);
    expect(screen.queryByText(/\d+d ago/)).toBeNull();
  });
});

describe('AiPendingActionsInbox — the whole file is swept, not just the timestamps', () => {
  it('renders its chrome from the zh pack', async () => {
    renderIn('zh');
    await firstRow(ZH.justNow);

    expect(screen.getByText(ZH.title)).toBeTruthy();
    expect(screen.getByText(ZH.description)).toBeTruthy();
    expect(screen.getByText(ZH.tabDecided)).toBeTruthy();
    expect(screen.getByText(ZH.colTool)).toBeTruthy();
    expect(screen.getByText(ZH.colDecision)).toBeTruthy();
    expect(screen.getAllByText(ZH.view).length).toBe(5);
    expect(screen.getAllByText(ZH.approve).length).toBe(5);
  });

  it('leaves no English chrome behind in a zh session', async () => {
    renderIn('zh');
    await firstRow(ZH.justNow);

    for (const en of [EN.title, EN.description, EN.tabDecided, EN.colTool, EN.colDecision]) {
      expect(screen.queryByText(en)).toBeNull();
    }
    expect(screen.queryByText(EN.view)).toBeNull();
    expect(screen.queryByText(EN.approve)).toBeNull();
  });

  it('renders its chrome from the ar pack', async () => {
    renderIn('ar');
    await firstRow(AR.justNow);

    expect(screen.getByText(AR.title)).toBeTruthy();
    expect(screen.getByText(AR.colTool)).toBeTruthy();
    expect(screen.getAllByText(AR.view).length).toBe(5);
    expect(screen.queryByText(EN.title)).toBeNull();
  });

  it('translates the empty state in zh and ar', async () => {
    stubList([]);
    renderIn('zh');
    await firstRow(ZH.emptyTitle);
    expect(screen.getByText(ZH.emptyDescription)).toBeTruthy();
    expect(screen.queryByText(EN.emptyTitle)).toBeNull();
    cleanup();

    stubList([]);
    renderIn('ar');
    await firstRow(AR.emptyTitle);
    expect(screen.queryByText(EN.emptyTitle)).toBeNull();
  });

  it('translates the reject dialog in zh', async () => {
    renderIn('zh');
    await firstRow(ZH.justNow);

    fireEvent.click(screen.getAllByText(ZH.reject)[0]);

    expect(await screen.findByText('要拒绝此操作吗？')).toBeTruthy();
    expect(screen.getByText('该原因会回传给 AI，便于它调整下一步回复。')).toBeTruthy();
    expect(screen.queryByText('Reject this action?')).toBeNull();
  });
});

describe('AiPendingActionsInbox — every status badge resolves from the packs', () => {
  // All five lifecycle statuses, because objectui#7149's lesson bites exactly
  // here: the labels are selected by a `switch` over literal keys, and only a
  // row carrying that status proves the branch resolves. The unknown status is
  // the negative control — it is DATA, so it must survive verbatim rather than
  // being run through `t` and coming back as its own key.
  const statuses = ['pending', 'approved', 'executed', 'failed', 'rejected', 'archived_by_ops'];

  it('renders all five plus an unrecognised one in zh', async () => {
    stubList(
      statuses.map((status, i) => ({
        ...rows()[0],
        id: `s${i}${'0'.repeat(9)}`,
        status: status as PendingActionRow['status'],
        proposed_at: ago(3 * HOUR),
      })),
    );
    renderIn('zh');
    await firstRow(ZH.threeHours);

    for (const zh of ['待审批', '已通过', '已执行', '失败', '已拒绝']) {
      expect(screen.getAllByText(zh).length).toBeGreaterThan(0);
    }
    // Unknown status: verbatim, never a raw key.
    expect(screen.getByText('archived_by_ops')).toBeTruthy();
    for (const en of ['Approved', 'Executed', 'Failed', 'Rejected']) {
      expect(screen.queryByText(en)).toBeNull();
    }
  });
});

describe('the defaults map mirrors the en pack, row for row', () => {
  // The invariant `app-shell/src/__tests__/defaults-maps-mirror-en-pack.test.tsx`
  // holds the detail / list / designer maps to, asserted here for this map
  // because it is the package that owns it. A row that disagrees with the pack
  // labels one control two ways — the map's on a provider-less embed, the
  // pack's in the console — and each path looks correct on its own.
  const packValue = (dotted: string): unknown =>
    dotted.split('.').reduce<unknown>(
      (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
      en as unknown,
    );

  it('compares every row — not an empty assertion', () => {
    expect(Object.keys(AI_APPROVALS_DEFAULT_TRANSLATIONS).length).toBeGreaterThan(40);
  });

  it('every row exists in the en pack and says the same thing', () => {
    const mismatches: string[] = [];
    for (const [key, value] of Object.entries(AI_APPROVALS_DEFAULT_TRANSLATIONS)) {
      const packed = packValue(key);
      if (typeof packed !== 'string') mismatches.push(`${key}: absent from the en pack`);
      else if (packed !== value) mismatches.push(`${key}: map ${JSON.stringify(value)} vs pack ${JSON.stringify(packed)}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('a deliberately wrong row would be caught', () => {
    // The negative control: without it "0 mismatches" cannot be told apart from
    // a comparison that never ran.
    expect(packValue('aiApprovals.title')).toBe('AI Approvals');
    expect(packValue('aiApprovals.zzzAbsentControl7173')).toBeUndefined();
  });
});
