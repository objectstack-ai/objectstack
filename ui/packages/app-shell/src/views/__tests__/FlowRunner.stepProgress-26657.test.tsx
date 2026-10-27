// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26657 — a step says Next or Submit, and counts itself only
 * when it can.
 *
 * The flat footer's button read Submit on every step of a wizard, so a
 * requester believed the contract was submitted on step 1. The engine now
 * serves `ScreenSpec.progress` off the flow graph, and the runner reads it:
 *
 * 1. `nextScreen` `'certain'` or `'possible'` reads Next; `'none'` reads Submit.
 * 2. The counter is drawn only from a served `step` AND `stepCount`.
 * 3. No `progress` keeps Submit and no counter — the pre-#26657 answer.
 * 4. A resume that pauses again relabels from the NEXT screen's progress.
 * 5. The words come from the catalog: zh reads 下一步 / 提交 / 第 N 步，共 M 步.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createI18n, I18nProvider } from '@object-ui/i18n';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const { FlowRunner } = await import('../FlowRunner');
type ScreenFlowState = import('../FlowRunner').ScreenFlowState;
type ScreenSpec = ScreenFlowState['screen'];
type Progress = NonNullable<ScreenSpec['progress']>;

const step = (nodeId: string, title: string, progress?: Progress): ScreenSpec => ({
  nodeId,
  title,
  fields: [{ name: `${nodeId}_note`, label: 'Note', type: 'text' }],
  ...(progress ? { progress } : {}),
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function mount(s: ScreenSpec, next?: ScreenSpec) {
  const body = next
    ? { success: true, data: { success: true, status: 'paused', runId: 'run_1', screen: next } }
    : { success: true, data: { success: true } };
  const authFetch = vi.fn(async () => jsonResponse(body));
  const ui = (
    <FlowRunner
      state={{ flowName: 'start_contract', runId: 'run_1', screen: s }}
      authFetch={authFetch}
      baseUrl=""
      onClose={vi.fn()}
      onComplete={vi.fn()}
    />
  );
  return { authFetch, ui };
}

describe('objectstack#26657 — the step button and counter follow ScreenSpec.progress', () => {
  it('a step another screen surely follows reads Next and counts itself', () => {
    render(mount(step('s1', 'Details', { nextScreen: 'certain', step: 1, stepCount: 3 })).ui);
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
    expect(screen.getByTestId('flow-step-counter')).toHaveTextContent('Step 1 of 3');
  });

  it('a step a branch may end still reads Next, and draws no counter without a total', () => {
    render(mount(step('s1', 'Details', { nextScreen: 'possible', step: 1 })).ui);
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    expect(screen.queryByTestId('flow-step-counter')).not.toBeInTheDocument();
  });

  it('the last step reads Submit and still counts itself', () => {
    render(mount(step('s3', 'Send to legal', { nextScreen: 'none', step: 3, stepCount: 3 })).ui);
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(screen.getByTestId('flow-step-counter')).toHaveTextContent('Step 3 of 3');
  });

  it('a screen served without progress keeps Submit and no counter', () => {
    render(mount(step('s1', 'Details')).ui);
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
    expect(screen.queryByTestId('flow-step-counter')).not.toBeInTheDocument();
  });

  it('a resume that pauses again relabels from the next screen', async () => {
    const { ui, authFetch } = mount(
      step('s1', 'Details', { nextScreen: 'certain', step: 1, stepCount: 2 }),
      step('s2', 'Send to legal', { nextScreen: 'none', step: 2, stepCount: 2 }),
    );
    render(ui);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByRole('heading', { name: 'Send to legal' })).toBeInTheDocument();
    expect(authFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
    expect(screen.getByTestId('flow-step-counter')).toHaveTextContent('Step 2 of 2');
  });

  it('reads the words from the catalog — zh: 下一步, 提交 and the step counter', async () => {
    const zh = createI18n({ defaultLanguage: 'zh', detectBrowserLanguage: false });
    expect(zh.language).toBe('zh');
    const { ui } = mount(
      step('s1', '合同信息', { nextScreen: 'certain', step: 1, stepCount: 2 }),
      step('s2', '提交法务', { nextScreen: 'none', step: 2, stepCount: 2 }),
    );
    render(<I18nProvider instance={zh}>{ui}</I18nProvider>);

    expect(await screen.findByRole('button', { name: '下一步' })).toBeInTheDocument();
    expect(screen.getByTestId('flow-step-counter')).toHaveTextContent('第 1 步，共 2 步');
    await userEvent.setup().click(screen.getByRole('button', { name: '下一步' }));
    expect(await screen.findByRole('button', { name: '提交' })).toBeInTheDocument();
    expect(screen.getByTestId('flow-step-counter')).toHaveTextContent('第 2 步，共 2 步');
  });
});
