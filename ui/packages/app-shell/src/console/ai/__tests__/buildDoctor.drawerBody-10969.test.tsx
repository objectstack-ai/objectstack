// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10969 — the Build Doctor drawer's body speaks the session's
 * language, as objectui#10900 made its title do.
 *
 * objectui#10900 localized the Build Doctor button, its tooltips and the
 * drawer's title (`buildDoctor.locale-10900`); the body under that title —
 * the description, the loading and not-found states, the summary line, the
 * verdict, and each section's title and hint — stayed English literals under
 * zh-CN. They now read `console.ai.buildDoctorDrawer.*`. What the report
 * itself carries (tool, artifact and status names, timeline text) is data and
 * is asserted verbatim.
 *
 * Harness: `BuildDebugDrawer.test.tsx`'s report, answered by the drawer's one
 * request, rendered under a real `I18nProvider` in zh and en.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { BuildDebugDrawer } from '../BuildDebugDrawer';
import type { BuildDebugReport } from '../buildDebugApi';

const REPORT: BuildDebugReport = {
  conversationId: 'conv_x',
  title: null,
  summary: { models: ['openai/gpt-5.4-mini'], userTurns: 3, messages: 36, totalTokens: 242495, llmMs: 82900 },
  reconciliation: {
    orphaned: [
      { t: '04:29:43', tool: 'create_metadata', status: 'changes_proposed', artifact: { type: 'flow', name: 'reimbursement_approval_flow' } },
    ],
    missing: [
      { tool: 'update_metadata', status: 'applied', artifact: { type: 'object', name: 'expense' } },
    ],
    errors: [],
    liveCount: 9,
    ok: false,
  },
  verify: { status: 'failed', errors: 2, warnings: 16, userIssues: [], platformNoise: 18 },
  timeline: [{ t: '04:23:45', kind: 'user', text: 'build an expense flow' }],
  pendingActions: [{ tool: 'create_metadata', object: 'flow', status: 'pending', error: null, createdAt: null }],
};

const ZH = { defaultLanguage: 'zh', detectBrowserLanguage: false } as const;
const EN = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;

function answer(report: BuildDebugReport | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      report
        ? { ok: true, status: 200, json: async () => report }
        : { ok: false, status: 404, json: async () => ({}) },
    ),
  );
}

function renderDrawer(config: typeof ZH | typeof EN) {
  return render(
    <I18nProvider config={config} persistLanguage={false}>
      <BuildDebugDrawer apiBase="/api/v1/ai" conversationId="conv_x" open onOpenChange={() => {}} />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Build Doctor drawer body (objectui#10969)', () => {
  it('zh: description, verdict, section titles and hints, and the summary line are Chinese', async () => {
    answer(REPORT);
    renderDrawer(ZH);

    expect(await screen.findByText(/已提议但从未应用/)).toBeInTheDocument();
    expect(screen.getByText('智能体声称的变更与实际已生效的内容对照。只读诊断。')).toBeInTheDocument();
    expect(screen.getByText('2 处不一致——对话中所说的与实际生效的内容不符。')).toBeInTheDocument();
    expect(
      screen.getByText('智能体提议了确认卡片，但之后没有任何一轮应用它——该变更被静默丢弃。'),
    ).toBeInTheDocument();
    expect(screen.getByText(/声称已应用但缺失/)).toBeInTheDocument();
    expect(screen.getByText('构建检查（verify_build）')).toBeInTheDocument();
    expect(screen.getByText(/已隐藏 18 条平台 sys_\* 发现/)).toBeInTheDocument();
    expect(screen.getByText('待处理操作')).toBeInTheDocument();
    expect(screen.getByText('时间线（1）')).toBeInTheDocument();
    expect(screen.getByText('（无标题）')).toBeInTheDocument();
    expect(screen.getByText(/3 轮 · 36 条消息/)).toBeInTheDocument();

    // The report's own data stays verbatim.
    expect(screen.getByText(/reimbursement_approval_flow/)).toBeInTheDocument();

    // None of the English chrome is left.
    for (const english of [
      /What the agent claimed/,
      /discrepancy/,
      /Proposed but never applied/,
      /Claimed but missing/,
      /Build check/,
      /Pending actions/,
      /Timeline/,
      /untitled/,
      /platform sys_\* finding/,
    ]) {
      expect(screen.queryByText(english)).toBeNull();
    }
  });

  it('zh: the all-live verdict is Chinese', async () => {
    answer({
      ...REPORT,
      reconciliation: { orphaned: [], missing: [], errors: [], liveCount: 9, ok: true },
    });
    renderDrawer(ZH);
    expect(await screen.findByText('全部 9 项尝试的变更均已生效——没有丢失。')).toBeInTheDocument();
  });

  it('zh: the not-found state is Chinese', async () => {
    answer(null);
    renderDrawer(ZH);
    expect(await screen.findByText('不可用——未找到该对话，或你没有访问权限。')).toBeInTheDocument();
  });

  it('en: the body is unchanged English', async () => {
    answer(REPORT);
    renderDrawer(EN);

    expect(await screen.findByText(/Proposed but never applied/)).toBeInTheDocument();
    expect(
      screen.getByText('What the agent claimed vs what is actually live. Read-only diagnostic.'),
    ).toBeInTheDocument();
    expect(screen.getByText("2 discrepancy(ies) — what the chat said doesn't match what's live.")).toBeInTheDocument();
    expect(screen.getByText('Build check (verify_build)')).toBeInTheDocument();
    expect(screen.getByText(/18 platform sys_\* finding\(s\) hidden/)).toBeInTheDocument();
    expect(screen.getByText('Timeline (1)')).toBeInTheDocument();
    expect(screen.getByText(/3 turn\(s\) · 36 msgs · 242,495 tok · 82\.9s LLM/)).toBeInTheDocument();
  });

  it('en: the not-found state is unchanged English', async () => {
    answer(null);
    renderDrawer(EN);
    expect(
      await screen.findByText('Not available — the conversation was not found or you are not authorized.'),
    ).toBeInTheDocument();
  });
});
