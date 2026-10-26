/**
 * The gantt's two write-confirmation dialogs interpolate their `{{count}}`
 * through i18next, under a real loaded locale pack (objectui#4157).
 *
 * ## Why this has to render inside an I18nProvider
 *
 * The reported symptom — a literal `{2}` in the conflict dialog — is invisible
 * to a provider-less render. `useGanttTranslation` falls back to the plugin's
 * own `GANTT_DEFAULT_TRANSLATIONS` when the host returns the key unchanged, and
 * the bundled default was authored with the same SINGLE-brace spelling the old
 * `t(key).replace('{count}', n)` call site expected, so the fallback path
 * rendered correctly and masked the bug. It only appears once a pack is loaded:
 * every pack spells the placeholder `{{count}}` (i18next convention), and
 * `"…{{count}}…".replace("{count}", "2")` eats the inner seven characters and
 * leaves `{2}`.
 *
 * So each case here is pinned under BOTH `en` and `zh`. `en` is not redundant
 * with the provider-less tests: the `en` *pack* is a different string source
 * from the bundled fallback map, and it carried the same defect.
 *
 * The auto-schedule dialog is the control. Its two keys were never broken —
 * pack and call site both used single braces — so these cases were green before
 * the fix and stay green after it. They fail only if the packs are converted
 * without the call site (or the reverse), which is exactly the half-migration
 * that produced the defect.
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
// Same package `useGanttTranslation` reads `useObjectTranslation` from, so the
// provider's i18next instance is the one GanttView resolves against.
import { I18nProvider } from '@object-ui/react';
import { GanttView, type GanttTask } from './GanttView';

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
});

const D = (s: string) => new Date(s);

function makeTask(id: string, start: string, end: string, extra: Partial<GanttTask> = {}): GanttTask {
  return { id, title: `Task ${id}`, start: D(start), end: D(end), progress: 0, ...extra };
}

/**
 * Render pinned to `lang`. `detectBrowserLanguage: false` + `persistLanguage`
 * are load-bearing: the provider bootstrap otherwise reads a persisted language
 * out of localStorage and overrides `defaultLanguage`, which would make the
 * `en` case depend on whether the `zh` case ran first.
 *
 * `onTaskUpdate` is equally load-bearing and is supplied by default: BOTH
 * dialogs are gated on a write handler, and without one they never open, so
 * every case here would fail on "the dialog did not open" instead of on the
 * placeholder residue it means to pin. The bar only gets an `onPointerDown`
 * when it is draggable (`canDrag`, GanttView.tsx), so the drag never commits
 * and `maybeFlagConflict` never runs; the toolbar wand is rendered only under
 * `autoSchedule && onTaskUpdate`, and `runAutoSchedule` returns early without
 * it. Same gating as the sibling harnesses in `GanttView.interactions.test.tsx`
 * and `GanttView.autoscheduledlg.test.tsx`.
 */
function renderIn(
  lang: string,
  tasks: GanttTask[],
  props: Partial<React.ComponentProps<typeof GanttView>> = {},
) {
  return render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }} persistLanguage={false}>
      <div style={{ width: 1280, height: 600 }}>
        <GanttView
          tasks={tasks}
          startDate={D('2024-06-01T00:00:00.000Z')}
          endDate={D('2024-06-30T00:00:00.000Z')}
          onTaskUpdate={vi.fn()}
          {...props}
        />
      </div>
    </I18nProvider>,
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

/** Drag a bar horizontally by whole day-columns (columnWidth=110 at innerWidth=1280). */
function dragBar(container: HTMLElement, id: string, deltaCols: number) {
  const bar = container.querySelector(`[data-testid="gantt-task-bar-${id}"]`) as HTMLElement;
  expect(bar, `no bar for ${id}`).toBeTruthy();
  const originX = 800;
  fireEvent.pointerDown(bar, { button: 0, clientX: originX, clientY: 100 });
  act(() => { window.dispatchEvent(pointer('pointermove', originX + deltaCols * 110)); });
  act(() => { window.dispatchEvent(pointer('pointerup', originX + deltaCols * 110)); });
}

/**
 * Every way an uninterpolated placeholder can reach the screen. `{2}` is the
 * exact reported symptom (the single-brace `.replace` biting a `{{count}}`
 * pack string); the other two are the failure modes of the opposite
 * half-migration.
 */
function expectNoPlaceholderResidue(text: string, count: number) {
  expect(text, 'the count never reached the sentence').toContain(String(count));
  expect(text, `rendered the reported literal {${count}}`).not.toContain(`{${count}}`);
  expect(text, 'rendered a raw i18next placeholder').not.toContain('{{count}}');
  expect(text, 'rendered a raw single-brace placeholder').not.toContain('{count}');
}

describe('gantt conflict dialog interpolates its count under a loaded pack (objectui#4157)', () => {
  // B depends on A (FS): A ends 06-13, B starts 06-17 with slack.
  const linked = () => [
    makeTask('a', '2024-06-03T00:00:00.000Z', '2024-06-13T00:00:00.000Z', { progress: 50 }),
    makeTask('b', '2024-06-17T00:00:00.000Z', '2024-06-21T00:00:00.000Z', {
      dependencies: [{ id: 'a', type: 'fs' }],
    }),
  ];

  it.each(['en', 'zh'])('renders the number, not a placeholder, under a `%s` session', (lang) => {
    const { container } = renderIn(lang, linked(), { rescheduleOnConflict: true });

    // Drag B 6 days earlier → 06-11, which violates the FS link (A ends 06-13).
    dragBar(container, 'b', -6);

    const dialog = container.querySelector('[data-testid="gantt-conflict-dialog"]');
    expect(dialog, 'the conflict dialog did not open').toBeTruthy();
    expectNoPlaceholderResidue(dialog!.textContent ?? '', 1);
  });

  it('serves the localized sentence, not the bundled English fallback, under `zh`', () => {
    // Guards the other direction, and it is not hypothetical: `t(key, { count })`
    // hands i18next its PLURAL selector, so a pack whose key has no plural form
    // could in principle resolve to a miss, land on `useGanttTranslation`'s
    // per-key English fallback, and "fix" the residue by un-localizing the
    // sentence. This case is what proves the zh pack value is what reaches the
    // screen.
    const { container } = renderIn('zh', linked(), { rescheduleOnConflict: true });
    dragBar(container, 'b', -6);

    const text = container.querySelector('[data-testid="gantt-conflict-dialog"]')!.textContent ?? '';
    expect(text).toContain('自动重新排程');
    expect(text).not.toContain('Auto-reschedule');
  });
});

describe('gantt auto-schedule dialog keeps interpolating its counts (objectui#4157 control)', () => {
  // P is the predecessor; B1/B2 violate the link and will shift; C violates it
  // too but is locked, so it is reported as skipped instead of moved.
  const violating = (): GanttTask[] => [
    makeTask('p', '2024-06-01T00:00:00.000Z', '2024-06-10T00:00:00.000Z'),
    makeTask('b1', '2024-06-05T00:00:00.000Z', '2024-06-08T00:00:00.000Z', { dependencies: ['p'] }),
    makeTask('b2', '2024-06-05T00:00:00.000Z', '2024-06-07T00:00:00.000Z', { dependencies: ['p'] }),
    makeTask('c', '2024-06-05T00:00:00.000Z', '2024-06-06T00:00:00.000Z', { dependencies: ['p'], locked: true }),
  ];

  it.each(['en', 'zh'])('body and skipped both interpolate under a `%s` session', (lang) => {
    const { container, baseElement } = renderIn(lang, violating(), { autoSchedule: true });

    const wand = container.querySelector('[data-testid="gantt-auto-schedule"]') as HTMLElement;
    expect(wand, 'the auto-schedule wand is not in the toolbar').toBeTruthy();
    act(() => { fireEvent.click(wand); });

    const dialog = baseElement.querySelector('[data-testid="gantt-autoschedule-dialog"]');
    expect(dialog, 'the auto-schedule dialog did not open').toBeTruthy();
    // Two unlocked violators shift; the locked one is reported separately.
    expectNoPlaceholderResidue(dialog!.textContent ?? '', 2);

    const skipped = baseElement.querySelector('[data-testid="gantt-autoschedule-skipped"]');
    expect(skipped, 'the skipped notice did not render').toBeTruthy();
    expectNoPlaceholderResidue(skipped!.textContent ?? '', 1);
  });
});
