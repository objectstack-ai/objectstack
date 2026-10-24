// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12080 — a screen dialog is height-bounded on every screen, its body
 * is the one scrolling region, and the footer (Submit) sits OUTSIDE that
 * region; a long flat screen widens to two columns, a short one is unchanged.
 *
 * ⚠️ What this file can and cannot show. The test DOM computes no layout, so
 * nothing here can say that Submit is ON SCREEN — that was measured in
 * Chromium with a real mouse wheel and a real click, and the readings are on
 * the pull request. What these tests pin is the contract that measurement
 * rests on: the bound's classes, which element scrolls, and that the primary
 * action is not inside it. Moving the footer into the body, or dropping the
 * bound, turns them red.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FlowRunner, type ScreenFieldSpec, type ScreenSpec } from '../FlowRunner';

const fields = (n: number): ScreenFieldSpec[] =>
  Array.from({ length: n }, (_, i) => ({ name: `f${i}`, label: `Field ${i}`, type: 'text' }));

function renderRunner(screenSpec: ScreenSpec, authFetch = vi.fn(async () => new Response('{}'))) {
  render(
    <FlowRunner
      state={{ flowName: 'contract_intake', runId: 'run-1', screen: screenSpec }}
      authFetch={authFetch}
      baseUrl=""
      onClose={() => {}}
      onComplete={() => {}}
    />,
  );
  const content = screen.getByRole('dialog');
  const body = screen.getByTestId('flow-screen-body');
  return { content, body };
}

const flat = (n: number, extra: Partial<ScreenSpec> = {}): ScreenSpec => ({
  nodeId: 'details',
  title: 'Contract details',
  fields: fields(n),
  ...extra,
});

/** The ScreenView root the body wraps — the element a long screen lays out as a grid. */
const screenRoot = (body: HTMLElement) => body.firstElementChild as HTMLElement;

/** `a` comes before `b` in document order. */
const precedes = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe('FlowRunner — the screen dialog keeps Submit reachable (objectui#12080)', () => {
  it('bounds a long screen, scrolls only its body, and keeps Submit outside the scrolling region', () => {
    const { content, body } = renderRunner(flat(13));

    // The bound: a flex column at most 90vh tall. The dialog as a whole does
    // not scroll — scrolling it would carry the footer away with the fields.
    for (const token of ['flex', 'flex-col', 'max-h-[90vh]']) expect(content).toHaveClass(token);
    expect(content).not.toHaveClass('overflow-y-auto');
    // The body is the one region that gives up height and scrolls.
    for (const token of ['min-h-0', 'flex-1', 'overflow-y-auto']) expect(body).toHaveClass(token);

    // Every field is in the scrolling body…
    const inputs = screen.getAllByRole('textbox');
    expect(inputs).toHaveLength(13);
    for (const input of inputs) expect(body).toContainElement(input);
    // …and the heading and both footer actions are not.
    const heading = screen.getByRole('heading', { name: 'Contract details' });
    const submit = screen.getByRole('button', { name: 'Submit' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    for (const outside of [heading, submit, cancel]) expect(body).not.toContainElement(outside);
    expect(precedes(heading, body)).toBe(true);
    expect(precedes(body, submit)).toBe(true);
  });

  it('widens a long screen to two columns from `sm` up', () => {
    const { content, body } = renderRunner(flat(13));
    expect(content).toHaveClass('sm:max-w-3xl');
    expect(content).not.toHaveClass('sm:max-w-md');
    const root = screenRoot(body);
    for (const token of ['grid', 'gap-4', 'sm:grid-cols-2', 'space-y-0']) expect(root).toHaveClass(token);
    // The stack spacing is replaced, not stacked under the grid's gap.
    expect(root).not.toHaveClass('space-y-4');
  });

  it('control: a short screen keeps the narrow single column it always had', () => {
    const { content, body } = renderRunner(flat(3));
    expect(content).toHaveClass('sm:max-w-md');
    expect(content).not.toHaveClass('sm:max-w-3xl');
    const root = screenRoot(body);
    expect(root).toHaveClass('space-y-4');
    expect(root).not.toHaveClass('grid');
    expect(root).not.toHaveClass('sm:grid-cols-2');
    // Bounded all the same: a short screen on a short window still keeps Submit.
    expect(content).toHaveClass('max-h-[90vh]');
    expect(body).not.toContainElement(screen.getByRole('button', { name: 'Submit' }));
  });

  it.each([
    [8, 'sm:max-w-md'],
    [9, 'sm:max-w-3xl'],
  ])('switches width at more than eight declared fields: %i fields get %s', (n, width) => {
    const { content } = renderRunner(flat(n));
    expect(content).toHaveClass(width);
  });

  it('counts DECLARED fields, so a field `visibleWhen` reveals mid-edit never makes the dialog jump width', () => {
    // Nine declared, two of them hidden until a box is ticked: seven on screen.
    const nine = fields(9).map((f, i) => (i >= 7 ? { ...f, visibleWhen: 'f0 == "show"' } : f));
    const { content } = renderRunner(flat(9, { fields: nine }));
    expect(screen.getAllByRole('textbox')).toHaveLength(7);
    expect(content).toHaveClass('sm:max-w-3xl');
  });

  it('keeps an `object-form` step on its wide dialog, inside the same bound, with no runner footer', () => {
    const { content, body } = renderRunner({ nodeId: 'customer', kind: 'object-form', objectName: 'crm_account' });
    for (const token of ['flex', 'flex-col', 'max-h-[90vh]', 'sm:max-w-3xl']) expect(content).toHaveClass(token);
    expect(content).not.toHaveClass('overflow-y-auto');
    // No data source in this test, so the step renders its refusal line — in the body.
    expect(body).toHaveTextContent('no data source');
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();
  });

  it('keeps a resume failure ABOVE the scrolling body, so it is in view however far the screen is scrolled', async () => {
    const authFetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { success: false, error: "Node 'apply' failed" } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { body } = renderRunner(flat(13), authFetch);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Submit' }));
    const alert = await waitFor(() => {
      const el = screen.getAllByRole('alert').find((a) => a.textContent?.includes("Node 'apply' failed"));
      expect(el).toBeDefined();
      return el!;
    });
    expect(body).not.toContainElement(alert);
    expect(precedes(alert, body)).toBe(true);
  });
});
