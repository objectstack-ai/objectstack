/**
 * objectstack#28242 — a `DeclaredActionsBar` action that declares `pressed`
 * (the reader's own state, `ActionSchema.pressed`) is a toggle button: drawn
 * with `aria-pressed="true"` and the pressed face while the predicate holds
 * for this record, `aria-pressed="false"` while it does not. An action that
 * declares no predicate carries no `aria-pressed` at all.
 *
 * Display only: a pressed action stays enabled and still dispatches, and a
 * predicate that cannot be evaluated draws the plain button (never a claim
 * that the reader acted) and says so once.
 *
 * Doubles as the sibling suites (`DeclaredActionsBar.disabledReason-26619.test.tsx`)
 * do: only the action dispatch and the console runtime shell.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';

const executeSpy = vi.fn().mockResolvedValue({ success: true });

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/react')>();
  return {
    ...actual,
    ActionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useAction: () => ({ execute: executeSpy }),
  };
});
vi.mock('../../hooks/useConsoleActionRuntime', () => ({
  useConsoleActionRuntime: () => ({ actionProviderProps: {}, dialogs: null }),
}));
vi.mock('../../providers/AdapterProvider', () => ({ useAdapter: () => ({}) }));
vi.mock('../../utils/getIcon', () => ({ getIcon: () => () => null }));

import { DeclaredActionsBar } from '../DeclaredActionsBar';

const HELPFUL = {
  name: 'mark_article_helpful',
  type: 'script',
  label: 'Helpful',
  locations: ['record_section'],
  pressed: "has(record.viewer) && record.viewer.vote == 'helpful'",
};
const NOT_HELPFUL = {
  name: 'mark_article_not_helpful',
  type: 'script',
  label: 'Not helpful',
  locations: ['record_section'],
  pressed: { dialect: 'cel', source: "has(record.viewer) && record.viewer.vote == 'not_helpful'" },
};
const SHARE = { name: 'share_article', type: 'script', label: 'Share', locations: ['record_section'] };

function mount(record: Record<string, unknown>, actions: Record<string, unknown>[] = [HELPFUL, NOT_HELPFUL]) {
  return render(
    <DeclaredActionsBar
      objectName="kb_article"
      record={{ id: 'a-1', ...record }}
      location="record_section"
      actions={actions as any}
    />,
  );
}

const lever = (name: string) => screen.getByTestId(`declared-action-${name}`);

beforeEach(() => executeSpy.mockReset().mockResolvedValue({ success: true }));
afterEach(() => vi.restoreAllMocks());

describe('DeclaredActionsBar — `pressed` draws the reader\'s own state (objectstack#28242)', () => {
  it('the predicate holds: aria-pressed="true" and the pressed face; the sibling vote is unpressed', () => {
    mount({ viewer: { vote: 'helpful' } });
    expect(lever('mark_article_helpful')).toHaveAttribute('aria-pressed', 'true');
    expect(lever('mark_article_helpful').className).toContain('aria-pressed:bg-accent');
    expect(lever('mark_article_not_helpful')).toHaveAttribute('aria-pressed', 'false');
  });

  it('the envelope arm reads the same: the other vote is the pressed one', () => {
    mount({ viewer: { vote: 'not_helpful' } });
    expect(lever('mark_article_helpful')).toHaveAttribute('aria-pressed', 'false');
    expect(lever('mark_article_not_helpful')).toHaveAttribute('aria-pressed', 'true');
  });

  it('a row with no served block draws both unpressed', () => {
    mount({});
    expect(lever('mark_article_helpful')).toHaveAttribute('aria-pressed', 'false');
    expect(lever('mark_article_not_helpful')).toHaveAttribute('aria-pressed', 'false');
  });

  it('display only: a pressed action stays enabled and still dispatches', async () => {
    const user = userEvent.setup();
    mount({ viewer: { vote: 'helpful' } }, [HELPFUL]);
    expect(lever('mark_article_helpful')).not.toBeDisabled();
    await user.click(lever('mark_article_helpful'));
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy.mock.calls[0][0]).toMatchObject({ name: 'mark_article_helpful' });
  });

  it('a predicate that cannot be evaluated draws the plain button, and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount({}, [{ ...HELPFUL, pressed: "record.viewer.vote == 'helpful'" }]);
    expect(lever('mark_article_helpful')).toHaveAttribute('aria-pressed', 'false');
    expect(warn.mock.calls.some((c) => String(c[0]).includes('(pressed)'))).toBe(true);
  });

  it('control — an action that declares no predicate is a plain button: no aria-pressed, no face', () => {
    mount({ viewer: { vote: 'helpful' } }, [SHARE]);
    expect(lever('share_article')).not.toHaveAttribute('aria-pressed');
    expect(lever('share_article').className).not.toContain('aria-pressed:');
  });
});
