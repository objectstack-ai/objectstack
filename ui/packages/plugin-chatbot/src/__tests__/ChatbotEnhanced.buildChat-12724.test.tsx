/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12724 — the build conversation per the AiBuild artboard, the
 * halves that need no new payload:
 *
 *  1. Progress: ONE collapsed line per phase (「设计方案 · 4 步 · 0:48 · 查阅编写
 *     规范 · 列出已有对象 ×3 …」), repeated calls folded into one step with a
 *     count, and a chevron that expands the per-tool rows.
 *  2. The finished build card: the 「已搭建并上线 · APP」 header when the build
 *     is live, 打开应用 (primary) and 在 Studio 中查看, the 「接下来可以说」 line
 *     from the envelope's `nextSteps`, and the draft-posture sentence.
 *  3. The plan card: field chips from `blueprint.objects[].fields`, view rows,
 *     the app name in the header — and today's object chips when the plan
 *     carries no field rows.
 *
 * Rendered through a real `I18nProvider` where the wording is the point, so
 * the zh strings are the shipped pack's, not this file's.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ChatbotEnhanced, type ChatbotEnhancedMessage } from '../ChatbotEnhanced';
import { detectProposedPlan } from '../mapMessages';

function inLocale(lang: 'zh' | 'en', ui: React.ReactElement) {
  return (
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>{ui}</I18nProvider>
  );
}

const done = (toolCallId: string, toolName: string) => ({
  toolCallId,
  toolName,
  state: 'output-available' as const,
  result: { ok: true },
});

/** The design turn the artboard draws: rules, objects ×3, todos ×2, then the plan. */
const designTurn = (streaming: boolean): ChatbotEnhancedMessage => ({
  id: 'design-1',
  role: 'assistant',
  content: '',
  streaming,
  toolInvocations: [
    done('a', 'get_authoring_rules'),
    done('b', 'list_objects'),
    done('c', 'list_objects'),
    done('d', 'todo_write'),
    done('e', 'list_objects'),
    done('f', 'todo_write'),
    done('g', 'propose_blueprint'),
  ],
});

describe('objectui#12724 — the progress collapses to one line per phase', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('zh: one line with the phase, its folded step count, the elapsed time and the folded steps', () => {
    const { rerender } = render(inLocale('zh', <ChatbotEnhanced messages={[designTurn(true)]} isLoading />));
    act(() => {
      vi.advanceTimersByTime(48_000);
    });
    rerender(inLocale('zh', <ChatbotEnhanced messages={[designTurn(false)]} />));
    expect(screen.getAllByTestId('tool-phase')).toHaveLength(1);
    expect(screen.getByTestId('tool-phase-headline')).toHaveTextContent(/^设计方案 · 4 步 · 0:48$/);
    expect(screen.getByTestId('tool-phase-steps')).toHaveTextContent(
      /^查阅编写规范 · 列出已有对象 ×3 · 记下后续检查项 ×2 · 拟定应用方案$/,
    );
  });

  it('a settled phase is collapsed; the chevron expands the steps and collapses them again', () => {
    render(<ChatbotEnhanced messages={[designTurn(false)]} />);
    const toggle = screen.getByTestId('tool-phase-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('tool-phase-steps-expanded')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const rows = screen.getByTestId('tool-phase-steps-expanded');
    expect(within(rows).getByText('List objects')).toBeInTheDocument();
    expect(within(rows).getByText('x3')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByTestId('tool-phase-steps-expanded')).not.toBeInTheDocument();
  });

  it('a plan that waits on the user does not hold the line open — its own card says so', () => {
    const turn = designTurn(false);
    const plan = {
      status: 'blueprint_proposed',
      blueprint: { objects: [{ name: 'book', label: 'Book', fields: [{ name: 'title' }] }] },
    };
    turn.toolInvocations = turn.toolInvocations!.map((tool) =>
      tool.toolName === 'propose_blueprint'
        ? { ...tool, result: plan, proposedPlan: detectProposedPlan(plan) }
        : tool,
    );
    render(<ChatbotEnhanced messages={[turn]} onSendMessage={vi.fn()} />);
    expect(screen.getByTestId('tool-phase-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('tool-phase-headline')).toHaveTextContent(/^Design the plan · 4 steps/);
    expect(screen.getByTestId('proposed-plan-awaiting')).toBeInTheDocument();
  });

  it('a reopened phase (never measured here) omits the time instead of inventing one', () => {
    render(<ChatbotEnhanced messages={[{ ...designTurn(false), id: 'design-reopened' }]} />);
    expect(screen.getByTestId('tool-phase-headline')).toHaveTextContent(/^Design the plan · 4 steps$/);
  });

  it('a running step keeps the rows open, so its live timer is not hidden', () => {
    const { container } = render(
      <ChatbotEnhanced
        isLoading
        messages={[
          {
            id: 'build-1',
            role: 'assistant',
            content: '',
            streaming: true,
            toolInvocations: [
              done('a', 'list_objects'),
              { toolCallId: 'b', toolName: 'apply_blueprint', state: 'input-available' },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByTestId('tool-phase-headline')).toHaveTextContent(/^Build · 2 steps/);
    expect(screen.getByTestId('tool-phase-toggle')).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('[data-tool-running-timer]')).not.toBeNull();
  });
});

const builtMessage = (opts: { published?: boolean; nextSteps?: string[] }): ChatbotEnhancedMessage => ({
  id: 'built-1',
  role: 'assistant',
  content: '',
  buildProgress: {
    phase: 'done',
    appLabel: '图书借阅管理',
    items: [
      { type: 'object', name: 'book' },
      { type: 'app', name: 'library_app' },
    ],
    done: 2,
    total: 2,
  },
  toolInvocations: [
    {
      toolCallId: 'apply-1',
      toolName: 'apply_blueprint',
      state: 'output-available',
      result: {
        status: opts.published ? 'published' : 'drafted',
        packageId: 'app.hcpl',
        drafted: [
          { type: 'object', name: 'book' },
          { type: 'app', name: 'library_app' },
        ],
      },
      ...(opts.published
        ? {}
        : {
            draftReview: {
              packageId: 'app.hcpl',
              items: [
                { type: 'object', name: 'book' },
                { type: 'app', name: 'library_app' },
              ],
              ...(opts.nextSteps ? { nextSteps: opts.nextSteps } : {}),
            },
          }),
    },
  ],
});

describe('objectui#12724 — the finished build card', () => {
  it('zh: a live build reads「已搭建并上线 · APP」, with both doors, the next-steps line and the posture', () => {
    const onOpenBuiltApp = vi.fn();
    const onDesignBuiltApp = vi.fn();
    render(
      inLocale(
        'zh',
        <ChatbotEnhanced
          messages={[builtMessage({ published: true })]}
          onOpenBuiltApp={onOpenBuiltApp}
          openBuiltAppLabel="打开应用"
          onDesignBuiltApp={onDesignBuiltApp}
          designBuiltAppLabel="在 Studio 中查看"
        />,
      ),
    );
    expect(screen.getByTestId('build-progress-title')).toHaveTextContent('已搭建并上线 · 图书借阅管理');
    const open = screen.getByTestId('build-progress-open-app');
    const studio = screen.getByTestId('build-progress-design-app');
    expect(open).toHaveTextContent('打开应用');
    expect(open.className).toContain('bg-primary');
    expect(studio).toHaveTextContent('在 Studio 中查看');
    fireEvent.click(open);
    expect(onOpenBuiltApp).toHaveBeenCalledWith('library_app');
    fireEvent.click(studio);
    // The published envelope lifts no draft review; the package is its own.
    expect(onDesignBuiltApp).toHaveBeenCalledWith('library_app', 'app.hcpl');
    expect(screen.getByTestId('build-result-posture')).toHaveTextContent(
      '之后的修改先存草稿，由你在 Studio 发布。',
    );
  });

  it('zh: the next-steps line quotes each of the envelope\'s `nextSteps`', () => {
    render(
      inLocale(
        'zh',
        <ChatbotEnhanced
          messages={[builtMessage({ nextSteps: ['给借阅记录加续借次数', '只允许管理员删除图书'] })]}
          onOpenBuiltApp={vi.fn()}
          onDesignBuiltApp={vi.fn()}
          onReviewDraft={vi.fn()}
        />,
      ),
    );
    expect(screen.getByTestId('build-result-next-steps')).toHaveTextContent(
      '接下来可以说：「给借阅记录加续借次数」 「只允许管理员删除图书」',
    );
    // Said once: the draft card below no longer repeats them as a list.
    expect(screen.queryByTestId('draft-next-steps')).not.toBeInTheDocument();
  });

  it('a build with no publish signal only says it was built — never "live"', () => {
    render(<ChatbotEnhanced messages={[builtMessage({})]} onOpenBuiltApp={vi.fn()} />);
    expect(screen.getByTestId('build-progress-title')).toHaveTextContent(/^Built 图书借阅管理$/);
    expect(screen.queryByTestId('build-result-next-steps')).not.toBeInTheDocument();
    expect(screen.getByTestId('build-result-posture')).toBeInTheDocument();
  });
});

/** A plan envelope shaped as the spec's `SolutionBlueprintSchema` declares it. */
const planEnvelope = {
  status: 'blueprint_proposed',
  summary: '独立的图书借阅管理应用',
  counts: { objects: 2, views: 1, dashboards: 0, seedData: 0 },
  blueprint: {
    app: { name: 'library_app', label: '图书借阅管理' },
    objects: [
      {
        name: 'book',
        label: '图书',
        fields: [
          { name: 'title', label: '书名', type: 'text' },
          { name: 'isbn', label: 'ISBN', type: 'text' },
        ],
      },
      { name: 'reader', label: '读者', fields: [{ name: 'full_name', label: '姓名', type: 'text' }] },
    ],
    views: [{ object: 'book', name: 'loan_board', label: '借阅看板', type: 'kanban', groupBy: 'status' }],
    assumptions: ['只建这三部分'],
  },
};

const planMessage = (envelope: unknown): ChatbotEnhancedMessage => ({
  id: 'plan-1',
  role: 'assistant',
  content: '',
  toolInvocations: [
    {
      toolCallId: 'p1',
      toolName: 'propose_blueprint',
      state: 'output-available',
      result: envelope,
      proposedPlan: detectProposedPlan(envelope),
    },
  ],
});

describe('objectui#12724 — the plan card from what the envelope declares', () => {
  it('zh: the header names the app, each object row draws a chip per field, views get rows', () => {
    render(
      inLocale(
        'zh',
        <ChatbotEnhanced messages={[planMessage(planEnvelope)]} onSendMessage={vi.fn()} planTitleLabel="方案" />,
      ),
    );
    expect(screen.getByTestId('proposed-plan-title')).toHaveTextContent(/^方案 · 图书借阅管理$/);
    expect(screen.getByTestId('proposed-plan-awaiting')).toHaveTextContent('等待确认');
    const book = screen.getByTestId('proposed-plan-object-book');
    expect(within(book).getAllByTestId('proposed-plan-field').map((c) => c.textContent)).toEqual([
      '书名',
      'ISBN',
    ]);
    const reader = screen.getByTestId('proposed-plan-object-reader');
    expect(within(reader).getAllByTestId('proposed-plan-field').map((c) => c.textContent)).toEqual(['姓名']);
    expect(screen.getAllByTestId('proposed-plan-view').map((v) => v.textContent)).toEqual(['·借阅看板']);
    expect(screen.getByTestId('proposed-plan-reply-hint')).toBeInTheDocument();
    expect(screen.queryByTestId('proposed-plan-object-chips')).not.toBeInTheDocument();
  });

  it('degrades to today\'s object chips when the plan carries no field rows (the cache copy)', () => {
    const countOnly = {
      status: 'blueprint_proposed',
      blueprint: { objects: [{ name: 'book', label: '图书', fields: [null, null, null, null] }] },
    };
    render(<ChatbotEnhanced messages={[planMessage(countOnly)]} onSendMessage={vi.fn()} />);
    const chips = screen.getByTestId('proposed-plan-object-chips');
    expect(chips).toHaveTextContent('图书· 4');
    expect(screen.queryByTestId('proposed-plan-objects')).not.toBeInTheDocument();
    expect(screen.queryByTestId('proposed-plan-field')).not.toBeInTheDocument();
    expect(screen.queryByTestId('proposed-plan-views')).not.toBeInTheDocument();
    expect(screen.getByTestId('proposed-plan-title')).toHaveTextContent(/^Proposed plan$/);
  });
});
