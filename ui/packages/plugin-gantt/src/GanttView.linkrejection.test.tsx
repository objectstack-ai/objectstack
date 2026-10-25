/**
 * An illegal dependency link tells the user WHY it was refused (objectui#4158).
 *
 * ## What was wrong
 *
 * The built-in drop-target policy (`canReceiveLink`) correctly refuses four
 * kinds of link — self, locked row, group row, and one that would close a
 * dependency cycle — but it refused them as a bare boolean, and the refusal
 * was invisible in both places a user could have noticed it:
 *
 *  - **During the drag**: a bar only registers itself as the drop target when
 *    the policy accepts it, so a rejected bar never became `targetId`. It got
 *    no ring, no cursor change, and the rubber band never showed a target end.
 *    Hovering an illegal target and hovering empty space looked identical.
 *  - **On release**: `onUp` runs `if (cur.targetId != null && onDependencyCreate)`,
 *    and `targetId` was null, so the drop did nothing at all — no toast, no
 *    console warning.
 *
 * Users re-drew a legitimate-looking dependency over and over with no way to
 * learn the constraint.
 *
 * ## What this pins
 *
 * Every reason is asserted SEPARATELY, against its own message. That is the
 * point of the change: a single "link rejected" string would have satisfied a
 * toast-was-raised assertion while telling the user nothing more than the
 * silence did. The messages come from `gantt.link.rejected.<reason>`, whose
 * leaves are the classifier's own branch names, so a new branch that forgets
 * its message is a missing key rather than a wrong one.
 *
 * The legal-link control is what stops the feature from degenerating into
 * "always toast": it must create the link and raise nothing.
 */
import React from 'react';
import { render, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toast } from 'sonner';
import { GanttView, type GanttTask } from './GanttView';
import { GANTT_DEFAULT_TRANSLATIONS } from './useGanttTranslation';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
});

const D = (s: string) => new Date(s);

function makeTask(id: string, start: string, end: string, extra: Partial<GanttTask> = {}): GanttTask {
  return { id, title: `Task ${id}`, start: D(start), end: D(end), progress: 0, ...extra };
}

const A = () => makeTask('a', '2024-06-03T00:00:00.000Z', '2024-06-13T00:00:00.000Z', { progress: 50 });
const B = () => makeTask('b', '2024-06-17T00:00:00.000Z', '2024-06-21T00:00:00.000Z');

function renderView(tasks: GanttTask[], props: Partial<React.ComponentProps<typeof GanttView>> = {}) {
  return render(
    <div style={{ width: 1280, height: 600 }}>
      <GanttView
        tasks={tasks}
        startDate={D('2024-06-01T00:00:00.000Z')}
        endDate={D('2024-06-30T00:00:00.000Z')}
        {...props}
      />
    </div>,
  );
}

function pointer(type: string, clientX: number, clientY = 100) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    pointerType: 'mouse',
    button: 0,
    isPrimary: true,
  } as PointerEventInit);
}

/** Same drag the sibling harness in `GanttView.interactions.test.tsx` uses. */
function dragLink(container: HTMLElement, fromDot: string, toBar: string) {
  const dot = container.querySelector(`[data-testid="${fromDot}"]`) as HTMLElement;
  expect(dot, `no link dot ${fromDot}`).toBeTruthy();
  fireEvent.pointerDown(dot, { button: 0, clientX: 600, clientY: 20 });
  act(() => { window.dispatchEvent(pointer('pointermove', 700, 60)); });
  const bar = container.querySelector(`[data-testid="${toBar}"]`) as HTMLElement;
  expect(bar, `no bar ${toBar}`).toBeTruthy();
  fireEvent.pointerMove(bar, { clientX: 980, clientY: 60 });
  act(() => { window.dispatchEvent(pointer('pointerup', 980, 60)); });
}

/** Drag and HOLD over `toBar` — stops before release so hover state is readable. */
function hoverLinkOver(container: HTMLElement, fromDot: string, toBar: string): HTMLElement {
  const dot = container.querySelector(`[data-testid="${fromDot}"]`) as HTMLElement;
  expect(dot, `no link dot ${fromDot}`).toBeTruthy();
  fireEvent.pointerDown(dot, { button: 0, clientX: 600, clientY: 20 });
  act(() => { window.dispatchEvent(pointer('pointermove', 700, 60)); });
  const bar = container.querySelector(`[data-testid="${toBar}"]`) as HTMLElement;
  expect(bar, `no bar ${toBar}`).toBeTruthy();
  act(() => { fireEvent.pointerMove(bar, { clientX: 980, clientY: 60 }); });
  return bar;
}

const messageOf = (reason: string) => GANTT_DEFAULT_TRANSLATIONS[`gantt.link.rejected.${reason}`];

/**
 * The four illegal drops, each against its OWN message. Every case also
 * asserts the link was not created — the guard's existing behaviour, which
 * the feedback must not weaken into "warn and allow".
 */
describe('rejected dependency link explains itself (objectui#4158)', () => {
  it('cycle: dropping onto a task the source already depends on', () => {
    const onDependencyCreate = vi.fn();
    // a already depends on b (edge b→a); dragging a→b would close the loop.
    const a = makeTask('a', '2024-06-03T00:00:00.000Z', '2024-06-13T00:00:00.000Z', { dependencies: ['b'] });
    const { container } = renderView([a, B()], { onDependencyCreate });

    dragLink(container, 'gantt-link-dot-end-a', 'gantt-task-bar-b');

    expect(onDependencyCreate).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(messageOf('cycle'));
  });

  it('locked: dropping onto a 仅查看 row', () => {
    const onDependencyCreate = vi.fn();
    const lockedB = makeTask('b', '2024-06-17T00:00:00.000Z', '2024-06-21T00:00:00.000Z', { locked: true });
    const { container } = renderView([A(), lockedB], { onDependencyCreate });

    dragLink(container, 'gantt-link-dot-end-a', 'gantt-task-bar-b');

    expect(onDependencyCreate).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(messageOf('locked'));
  });

  /**
   * The `group` branch is the one reason with NO end-to-end case, and that is
   * a property of the renderer rather than a gap in this file: a
   * `type: 'group'` row is "a pure tree header — the timeline row carries NO
   * bar" (`GanttView.tsx`), so there is nothing to hover, no bar to register
   * a drop target, and the row's own `onPointerMove` is `clearLinkTarget`.
   * The drag interaction therefore cannot reach the branch at all today.
   *
   * The message is kept regardless, because the branch is live in the
   * classifier: dropping it would make a future group row that DOES render a
   * bar surface the raw key `gantt.link.rejected.group` on screen, which is
   * strictly worse than an unused string. This case pins the reachability
   * fact instead, so it goes red the day group rows gain a bar — at which
   * point whoever adds it owns wiring the toast and the end-to-end case.
   * Filed as objectui#4209.
   */
  it('group: the row renders no bar, so the drag cannot reach the branch', () => {
    const onDependencyCreate = vi.fn();
    const group = makeTask('g', '2024-06-15T00:00:00.000Z', '2024-06-25T00:00:00.000Z', { type: 'group' });
    const { container } = renderView([A(), group], { onDependencyCreate });

    expect(container.querySelector('[data-testid="gantt-task-bar-g"]'), 'group row grew a task bar').toBeFalsy();
    expect(container.querySelector('[data-testid="gantt-summary-bar-g"]'), 'group row grew a summary bar').toBeFalsy();
    // The message exists and is distinct, so the branch cannot render a raw key.
    expect(typeof messageOf('group')).toBe('string');
  });

  it('self: dropping a task onto its own bar', () => {
    const onDependencyCreate = vi.fn();
    const { container } = renderView([A(), B()], { onDependencyCreate });

    dragLink(container, 'gantt-link-dot-end-a', 'gantt-task-bar-a');

    expect(onDependencyCreate).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(messageOf('self'));
  });

  it('the four reasons carry four DIFFERENT messages', () => {
    // A single shared string would satisfy every case above while telling the
    // user no more than the silence did.
    const messages = ['self', 'locked', 'group', 'cycle'].map(messageOf);
    expect(messages.every((m) => typeof m === 'string' && m.length > 0)).toBe(true);
    expect(new Set(messages).size).toBe(4);
  });
});

describe('a legal link is still created silently (objectui#4158 control)', () => {
  it('creates the dependency and raises no toast', () => {
    const onDependencyCreate = vi.fn();
    const { container } = renderView([A(), B()], { onDependencyCreate });

    dragLink(container, 'gantt-link-dot-end-a', 'gantt-task-bar-b');

    expect(onDependencyCreate).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('a host veto is NOT reported by the built-in policy', () => {
    // `onBeforeDependencyCreate` is the HOST's decision and the host knows its
    // own reason; the gantt has none to show. Surfacing it is the public
    // rejection-reason API that objectui#4158 deliberately scoped out, so the
    // built-in toast must stay quiet here rather than invent a message.
    const onDependencyCreate = vi.fn();
    const onBeforeDependencyCreate = vi.fn().mockReturnValue(false);
    const { container } = renderView([A(), B()], { onDependencyCreate, onBeforeDependencyCreate });

    dragLink(container, 'gantt-link-dot-end-a', 'gantt-task-bar-b');

    expect(onBeforeDependencyCreate).toHaveBeenCalledTimes(1);
    expect(onDependencyCreate).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

/**
 * The hover half of the affordance. Asserted through INLINE style, not through
 * Tailwind classes, and that is deliberate rather than a shortcut: the bar's
 * read-only cursor three lines away in `GanttView.tsx` is already driven from
 * `style` because `cursor-not-allowed` is not emitted in the prebuilt
 * components CSS. A class assertion would pass in jsdom and render nothing in
 * a browser.
 */
describe('an illegal drop target refuses under the cursor (objectui#4158)', () => {
  it('marks the rejected bar not-allowed while the link drag is live', () => {
    const a = makeTask('a', '2024-06-03T00:00:00.000Z', '2024-06-13T00:00:00.000Z', { dependencies: ['b'] });
    const { container } = renderView([a, B()], { onDependencyCreate: vi.fn() });

    const bar = hoverLinkOver(container, 'gantt-link-dot-end-a', 'gantt-task-bar-b');

    expect(bar.style.cursor).toBe('not-allowed');
    expect(bar.style.boxShadow, 'no rejection outline on the target row').toContain('destructive');
  });

  it('leaves a LEGAL target alone — no not-allowed, no rejection outline', () => {
    const { container } = renderView([A(), B()], { onDependencyCreate: vi.fn() });

    const bar = hoverLinkOver(container, 'gantt-link-dot-end-a', 'gantt-task-bar-b');

    expect(bar.style.cursor).not.toBe('not-allowed');
    expect(bar.style.boxShadow ?? '').not.toContain('destructive');
  });

  it('clears the rejection when the pointer leaves the bar for empty row space', () => {
    const a = makeTask('a', '2024-06-03T00:00:00.000Z', '2024-06-13T00:00:00.000Z', { dependencies: ['b'] });
    const { container } = renderView([a, B()], { onDependencyCreate: vi.fn() });

    const bar = hoverLinkOver(container, 'gantt-link-dot-end-a', 'gantt-task-bar-b');
    expect(bar.style.cursor).toBe('not-allowed');

    // The row clears the target when the pointer is over empty row space
    // (target === currentTarget), which is how the bar's own handler is bypassed.
    const row = bar.parentElement as HTMLElement;
    act(() => { fireEvent.pointerMove(row, { clientX: 1200, clientY: 60 }); });

    expect(bar.style.cursor).not.toBe('not-allowed');
  });
});
