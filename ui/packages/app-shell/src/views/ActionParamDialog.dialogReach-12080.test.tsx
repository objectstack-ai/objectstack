/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12080 — the action parameter dialog takes the screen dialog's bound:
 * at most 90vh tall, the param list as the one scrolling region, Confirm in a
 * footer OUTSIDE it; a long list widens to two columns, a short one keeps the
 * default width.
 *
 * ⚠️ The test DOM computes no layout, so nothing here can say Confirm is ON
 * SCREEN — that was measured in Chromium with a real mouse wheel and a real
 * click, and the readings are on the pull request. These tests pin the
 * contract that measurement rests on, and that the two dialogs share it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ActionParamDef } from '@object-ui/core';
import { ActionParamDialog } from './ActionParamDialog';
import { FlowRunner } from './FlowRunner';

const params = (n: number, over: Partial<ActionParamDef> = {}): ActionParamDef[] =>
  Array.from({ length: n }, (_, i) => ({ name: `p${i}`, label: `Param ${i}`, type: 'text', ...over }));

function openDialog(list: ActionParamDef[]) {
  render(
    <ActionParamDialog
      state={{ open: true, params: list, title: 'Backfill Executed Contract', resolve: vi.fn() }}
      onOpenChange={() => {}}
    />,
  );
  return { content: screen.getByRole('dialog'), body: screen.getByTestId('action-param-body') };
}

/** `a` comes before `b` in document order. */
const precedes = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

/** The tokens that make up the bound, on the dialog and on its scrolling body. */
const CONTENT_BOUND = ['flex', 'flex-col', 'max-h-[90vh]'];
const BODY_SCROLL = ['-mx-6', 'px-6', 'min-h-0', 'flex-1', 'overflow-y-auto'];

describe('ActionParamDialog — Confirm stays reachable on a long `params` list (objectui#12080)', () => {
  it('bounds a long list, scrolls only the list, and keeps Confirm outside the scrolling region', async () => {
    const { content, body } = openDialog(params(13));
    for (const token of CONTENT_BOUND) expect(content).toHaveClass(token);
    expect(content).not.toHaveClass('overflow-y-auto');
    for (const token of BODY_SCROLL) expect(body).toHaveClass(token);

    const inputs = await screen.findAllByRole('textbox');
    expect(inputs).toHaveLength(13);
    for (const input of inputs) expect(body).toContainElement(input);
    const heading = screen.getByRole('heading', { name: 'Backfill Executed Contract' });
    const confirm = screen.getByRole('button', { name: /confirm/i });
    const cancel = screen.getByRole('button', { name: /cancel/i });
    for (const outside of [heading, confirm, cancel]) expect(body).not.toContainElement(outside);
    expect(precedes(heading, body)).toBe(true);
    expect(precedes(body, confirm)).toBe(true);
  });

  it('widens a long list to two columns from `sm` up', () => {
    const { content, body } = openDialog(params(13));
    expect(content).toHaveClass('sm:max-w-3xl');
    expect(body).toHaveClass('grid');
    expect(body).toHaveClass('sm:grid-cols-2');
  });

  it('control: a short list keeps the default width and its single column', () => {
    const { content, body } = openDialog(params(2));
    // No width class of its own, so `DialogContent`'s default `max-w-lg` holds.
    expect(content.className).not.toMatch(/sm:max-w-/);
    expect(content).toHaveClass('max-w-lg');
    expect(body).not.toHaveClass('sm:grid-cols-2');
    expect(content).toHaveClass('max-h-[90vh]');
    expect(body).not.toContainElement(screen.getByRole('button', { name: /confirm/i }));
  });

  it.each([
    [8, false],
    [9, true],
  ])('switches width at more than eight params: %i params wide=%s', (n, wide) => {
    const { content } = openDialog(params(n));
    expect(content.classList.contains('sm:max-w-3xl')).toBe(wide);
  });

  it('counts the params the dialog SHOWS: a param gated off by `visible: false` does not widen it', () => {
    const list = [...params(8), { name: 'hidden', label: 'Hidden', type: 'text', visible: 'false' }];
    const { content } = openDialog(list);
    expect(content).not.toHaveClass('sm:max-w-3xl');
  });

  it('is the SAME bound as the flow screen dialog, so the two cannot drift apart unseen', () => {
    openDialog(params(13));
    const paramContent = screen.getByRole('dialog');
    // A second modal marks the first `aria-hidden`, so both are read with `hidden: true`.
    const paramBody = screen.getByTestId('action-param-body');
    render(
      <FlowRunner
        state={{
          flowName: 'contract_intake',
          runId: 'run-1',
          screen: {
            nodeId: 'details',
            fields: Array.from({ length: 13 }, (_, i) => ({ name: `f${i}`, label: `Field ${i}`, type: 'text' })),
          },
        }}
        authFetch={vi.fn()}
        baseUrl=""
        onClose={() => {}}
        onComplete={() => {}}
      />,
    );
    const screenContent = screen.getAllByRole('dialog', { hidden: true }).find((d) => d !== paramContent)!;
    const screenBody = screen.getByTestId('flow-screen-body');
    for (const token of [...CONTENT_BOUND, 'sm:max-w-3xl']) {
      expect(paramContent).toHaveClass(token);
      expect(screenContent).toHaveClass(token);
    }
    for (const token of BODY_SCROLL) {
      expect(paramBody).toHaveClass(token);
      expect(screenBody).toHaveClass(token);
    }
  });
});
