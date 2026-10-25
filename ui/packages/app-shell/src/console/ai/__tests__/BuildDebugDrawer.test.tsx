// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { BuildDebugDrawer } from '../BuildDebugDrawer';
import type { BuildDebugReport } from '../buildDebugApi';

const REPORT: BuildDebugReport = {
  conversationId: 'conv_x',
  title: '开发报销流程',
  summary: { models: ['openai/gpt-5.4-mini'], userTurns: 3, messages: 36, totalTokens: 242495, llmMs: 82900 },
  reconciliation: {
    orphaned: [
      { t: '04:29:43', tool: 'create_metadata', status: 'changes_proposed', artifact: { type: 'flow', name: 'reimbursement_approval_flow' } },
    ],
    missing: [],
    errors: [],
    liveCount: 9,
    ok: false,
  },
  verify: { status: 'failed', errors: 2, warnings: 16, userIssues: [], platformNoise: 18 },
  timeline: [{ t: '04:23:45', kind: 'user', text: '开发报销流程' }],
  pendingActions: [],
};

// The drawer's chrome reads `console.ai.buildDoctorDrawer.*` (objectui#10969),
// so it renders under the en pack the console always mounts; its zh reading is
// pinned in `buildDoctor.drawerBody-10969`.
function renderDrawer() {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <BuildDebugDrawer apiBase="/api/v1/ai" conversationId="conv_x" open onOpenChange={() => {}} />
    </I18nProvider>,
  );
}

describe('BuildDebugDrawer', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => REPORT })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the orphaned proposal (审批流 evaporated) + de-noised verify when opened', async () => {
    renderDrawer();

    // The headline failure: a proposed change that never landed.
    expect(await screen.findByText(/Proposed but never applied/)).toBeInTheDocument();
    expect(screen.getByText(/reimbursement_approval_flow/)).toBeInTheDocument();
    // Verdict reflects a discrepancy.
    expect(screen.getByText(/doesn't match what's live/)).toBeInTheDocument();
    // verify_build de-noised: platform noise hidden, not failing the user's app.
    expect(screen.getByText(/18 platform sys_\* finding/)).toBeInTheDocument();
  });

  it('hits the debug endpoint for the conversation', async () => {
    const spy = vi.fn(async () => ({ ok: true, status: 200, json: async () => REPORT }));
    vi.stubGlobal('fetch', spy);
    renderDrawer();
    await screen.findByText(/Proposed but never applied/);
    expect(spy).toHaveBeenCalledWith('/api/v1/ai/conversations/conv_x/debug', { credentials: 'include' });
  });
});
