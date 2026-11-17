/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectstack#34627 — the result card's checklist gains cloud's
 * `ChecklistVerificationLine` (`{ kind: 'verification', status: 'failed',
 * label, count }`), appended when the build's verdict has errors, with
 * `status` and `passed/total` following the verdict. The console draws it as
 * a red row (the producer's label, then the issue count), and a failed
 * checklist is the one place the turn states the failure: the build's draft
 * card draws neither its issue-count chip nor the red summary beside it.
 *
 * A line of any other kind that carries a valid `status` and a string `line`
 * (cloud's `publish` line is the next one) is drawn by those two fields.
 *
 * The verification line's shape is the producer's `build-cards.schema.json`
 * as the card names it; the vendored copy in `fixtures/build-cards.schema.ts`
 * predates it, so these fixtures are not routed through the contract test.
 *
 * Each message goes through the real mapper (`uiMessageToChatMessage`) from a
 * raw tool part, so the lift is under test, not a hand-built invocation.
 */
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { ChatbotEnhanced } from '../ChatbotEnhanced';
import { detectBuildChecklist, uiMessageToChatMessage } from '../mapMessages';
import { applyEnvelope, checklistOf } from './fixtures/buildCards.fixtures';

const VERIFICATION = { kind: 'verification', status: 'failed', label: '校验未通过', count: 3 } as const;

/** Three objects and the board view, all passed, then the verification line: 4/5, failed. */
function failedChecklist() {
  const base = checklistOf('zh');
  return { ...base, status: 'failed', passed: 4, total: 5, lines: [...base.lines.slice(0, 4), VERIFICATION] };
}

const ISSUES = [
  { severity: 'error', code: 'seed_column_empty', message: 'Seed "loan_sample" sets "due_date" on none of its rows.' },
  { severity: 'error', code: 'view_filter_field', message: 'View "loan.overdue_loans" filters on an unknown field.' },
  { severity: 'error', code: 'seed_lookup', message: 'Seed "loan_sample" points at a missing reader.' },
];

/** `apply_blueprint`'s envelope with the verdict's errors, and the checklist given. */
const failedBuild = (checklist: unknown) => {
  const { checklist: _served, ...envelope } = applyEnvelope('zh');
  return {
    ...envelope,
    verification: { errors: 3, warnings: 0 },
    issues: ISSUES,
    ...(checklist === undefined ? {} : { checklist }),
  };
};

const turn = (output: unknown) =>
  uiMessageToChatMessage({
    id: 'built',
    role: 'assistant',
    parts: [{ type: 'tool-apply_blueprint', toolCallId: 'apply-1', state: 'output-available', input: {}, output }],
  });

const renderBuild = (output: unknown) =>
  render(
    <I18nProvider config={{ defaultLanguage: 'zh', detectBrowserLanguage: false }}>
      <ChatbotEnhanced messages={[turn(output)]} onOpenBuiltApp={vi.fn()} onReviewDraft={vi.fn()} />
    </I18nProvider>,
  );

describe('objectstack#34627 — detectBuildChecklist keeps the verification line and any new kind', () => {
  it('a verification line is kept with its label and count', () => {
    const checklist = detectBuildChecklist(failedBuild(failedChecklist()))!;
    expect([checklist.status, checklist.passed, checklist.total]).toEqual(['failed', 4, 5]);
    expect(checklist.lines).toHaveLength(5);
    expect(checklist.lines[4]).toEqual({ kind: 'verification', status: 'failed', label: '校验未通过', count: 3 });
  });

  it('a verification line without its label or count, or not failed, is dropped', () => {
    for (const bad of [
      { ...VERIFICATION, label: '' },
      { ...VERIFICATION, count: -1 },
      { ...VERIFICATION, count: '3' },
      { ...VERIFICATION, status: 'passed' },
      { kind: 'verification', status: 'failed', line: '校验未通过 · 3' },
    ]) {
      const checklist = detectBuildChecklist(failedBuild({ ...failedChecklist(), lines: [bad] }))!;
      expect(checklist.lines).toEqual([]);
    }
  });

  it('a line of another kind is kept by its status and line; one without them is dropped', () => {
    const publish = { kind: 'publish', status: 'failed', outcome: 'rolled_back', reason: 'x', line: '发布已回滚' };
    const checklist = detectBuildChecklist(
      failedBuild({ ...failedChecklist(), lines: [publish, { kind: 'publish', status: 'failed' }, { kind: 'publish', status: 'maybe', line: 'x' }] }),
    )!;
    expect(checklist.lines).toEqual([{ kind: 'other', servedKind: 'publish', status: 'failed', line: '发布已回滚' }]);
  });

  it('CONTROL: a checklist without the new line maps as before', () => {
    expect(detectBuildChecklist(applyEnvelope('zh'))!.lines).toEqual(
      checklistOf('zh').lines.map((l) => ({ kind: l.kind, status: l.status, line: l.line })),
    );
  });
});

describe('objectstack#34627 — a failed build: 4/5 over five rows, the failure stated once', () => {
  it('the chip reads 4/5, five rows, one red row with the label and the issue count', () => {
    renderBuild(failedBuild(failedChecklist()));
    const chip = screen.getByTestId('build-checklist-chip');
    expect(chip).toHaveTextContent(/^核对通过 4\/5$/);
    expect(chip).toHaveAttribute('data-status', 'failed');
    const rows = screen.getAllByTestId('build-checklist-line');
    expect(rows).toHaveLength(5);
    const failed = rows.filter((r) => r.getAttribute('data-status') === 'failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toHaveAttribute('data-kind', 'verification');
    expect(failed[0]).toHaveTextContent(/^校验未通过 · 3 处待修复$/);
    expect(failed[0].className).toContain('text-red-600');
    expect(within(failed[0]).getByTestId('build-checklist-verification-count')).toHaveTextContent('3 处待修复');
  });

  it('the draft card draws no issue-count chip and no red summary; the findings stay behind Technical details', () => {
    renderBuild(failedBuild(failedChecklist()));
    expect(screen.queryByTestId('draft-verification-chip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('draft-issues-summary')).not.toBeInTheDocument();
    expect(screen.getByTestId('draft-issues-details')).toBeInTheDocument();
  });

  it('a new kind renders by its status and line beside the others', () => {
    const publish = { kind: 'publish', status: 'failed', outcome: 'rolled_back', reason: 'x', line: '发布已回滚，应用保持原样' };
    const base = checklistOf('zh');
    renderBuild(failedBuild({ ...base, status: 'failed', passed: 7, total: 8, lines: [...base.lines, publish] }));
    const rows = screen.getAllByTestId('build-checklist-line');
    expect(rows).toHaveLength(8);
    expect(rows[7]).toHaveTextContent(/^发布已回滚，应用保持原样$/);
    expect(rows[7]).toHaveAttribute('data-status', 'failed');
    expect(rows[7]).not.toHaveAttribute('data-kind');
  });

  it('CONTROL: a passed checklist without the new line draws as before, and the draft card keeps its chip and summary', () => {
    renderBuild(failedBuild(checklistOf('zh')));
    expect(screen.getByTestId('build-checklist-chip')).toHaveTextContent(/^核对通过 7\/7$/);
    const rows = screen.getAllByTestId('build-checklist-line');
    expect(rows).toHaveLength(7);
    for (const r of rows) expect(r).not.toHaveAttribute('data-kind');
    expect(screen.getByTestId('draft-verification-chip')).toHaveTextContent('3 处待修复');
    expect(screen.getByTestId('draft-issues-summary')).toBeInTheDocument();
  });

  it('CONTROL: no checklist (an older producer): the draft card keeps its chip and summary', () => {
    renderBuild(failedBuild(undefined));
    expect(screen.queryByTestId('build-checklist')).not.toBeInTheDocument();
    expect(screen.getByTestId('draft-verification-chip')).toHaveTextContent('3 处待修复');
    expect(screen.getByTestId('draft-issues-summary')).toBeInTheDocument();
  });
});
