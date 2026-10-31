/**
 * objectstack#28242 — a `page:header` action that declares `pressed` (the
 * reader's own state, `ActionSchema.pressed`) is a toggle button: drawn with
 * `aria-pressed="true"` and the pressed face while the predicate holds for
 * this record, `aria-pressed="false"` while it does not. An action that
 * declares no predicate carries no `aria-pressed` at all.
 *
 * Display only: a pressed action stays enabled and still dispatches, and a
 * predicate that cannot be evaluated draws the plain button (never a claim
 * that the reader acted) and says so once.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
// Registers `page:header` at module scope (object-ui/no-dynamic-import-in-test-hook).
import '../renderers';

const HELPFUL = {
  name: 'mark_article_helpful',
  label: 'Helpful',
  type: 'script',
  locations: ['record_header'],
  pressed: "has(record.viewer) && record.viewer.vote == 'helpful'",
};
const NOT_HELPFUL = {
  name: 'mark_article_not_helpful',
  label: 'Not helpful',
  type: 'script',
  locations: ['record_header'],
  pressed: { dialect: 'cel', source: "has(record.viewer) && record.viewer.vote == 'not_helpful'" },
};
const SHARE = { name: 'share_article', label: 'Share', type: 'script', locations: ['record_header'] };

function PageHeader({ schema }: { schema: any }) {
  const Component = ComponentRegistry.get('page:header');
  if (!Component) throw new Error('page:header not registered');
  // eslint-disable-next-line react-hooks/static-components -- ComponentRegistry.get returns a registered component (stable), not one created during render
  return <Component schema={schema} />;
}

function mount(actions: Record<string, unknown>[], record: Record<string, unknown>, handler?: (a: any) => any) {
  return render(
    <ActionProvider handlers={handler ? { 'vote-run': handler } : undefined}>
      <RecordContextProvider
        objectName="kb_article"
        recordId="a-1"
        data={{ id: 'a-1', ...record }}
        objectSchema={{ name: 'kb_article', label: 'Article' }}
      >
        <PageHeader schema={{ type: 'page:header', title: 'Article', maxVisible: 5, actions }} />
      </RecordContextProvider>
    </ActionProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('page:header — `pressed` draws the reader\'s own state (objectstack#28242)', () => {
  it('the predicate holds: aria-pressed="true" and the pressed face; the sibling vote is unpressed', () => {
    mount([HELPFUL, NOT_HELPFUL], { viewer: { vote: 'helpful' } });
    const helpful = screen.getByRole('button', { name: 'Helpful' });
    expect(helpful).toHaveAttribute('aria-pressed', 'true');
    expect(helpful.className).toContain('aria-pressed:bg-accent');
    expect(screen.getByRole('button', { name: 'Not helpful' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('the envelope arm reads the same: the other vote is the pressed one', () => {
    mount([HELPFUL, NOT_HELPFUL], { viewer: { vote: 'not_helpful' } });
    expect(screen.getByRole('button', { name: 'Helpful' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Not helpful' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('a row with no served block (fetched by another route) draws both unpressed', () => {
    mount([HELPFUL, NOT_HELPFUL], {});
    expect(screen.getByRole('button', { name: 'Helpful' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Not helpful' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('display only: a pressed action stays enabled and still dispatches', async () => {
    const user = userEvent.setup();
    const handler = vi.fn(async () => ({ success: true }));
    mount([{ ...HELPFUL, type: 'vote-run' }], { viewer: { vote: 'helpful' } }, handler);
    const helpful = screen.getByRole('button', { name: 'Helpful' });
    expect(helpful).not.toBeDisabled();
    await user.click(helpful);
    await waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    expect((handler.mock.calls[0] as unknown[])[0]).toMatchObject({ name: 'mark_article_helpful' });
  });

  it('a predicate that cannot be evaluated draws the plain button, and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount([{ ...HELPFUL, pressed: "record.viewer.vote == 'helpful'" }], {});
    expect(screen.getByRole('button', { name: 'Helpful' })).toHaveAttribute('aria-pressed', 'false');
    expect(warn.mock.calls.some((c) => String(c[0]).includes('pressed'))).toBe(true);
  });

  it('control — an action that declares no predicate is a plain button: no aria-pressed, no face', () => {
    mount([SHARE], { viewer: { vote: 'helpful' } });
    const share = screen.getByRole('button', { name: 'Share' });
    expect(share).not.toHaveAttribute('aria-pressed');
    expect(share.className).not.toContain('aria-pressed:');
  });
});
