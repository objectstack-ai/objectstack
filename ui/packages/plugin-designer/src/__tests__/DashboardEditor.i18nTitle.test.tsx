/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4163 part 1 — the three `widget.title` reads in `DashboardEditor`,
 * and they are NOT the same kind of read.
 *
 * Two are DISPLAY (the widget card in the list, and the preview pane's tile):
 * a map has to resolve to the locale's string or React renders
 * `[object Object]`.
 *
 * The third is an AUTHORING WRITE — the property panel's single-line title
 * `<input>` — and it is the one where following the `I18nLabel` widening
 * mechanically would destroy data rather than merely look wrong. Resolving a
 * map into the input and writing `e.target.value` back collapses every other
 * locale on the first keystroke.
 *
 * PR #4169 met that by making a map-valued title READ-ONLY, on the premise that
 * "no persisted widget title can be a map" — a premise `@objectstack/spec`
 * 17.0.0 invalidates, so from rc.6 onward the branch denied authors an edit
 * rather than protecting anything reachable (objectui#5428).
 *
 * objectui#5301's maintainer ruling (2026-08-20) supplies the replacement: a
 * save writes back ONLY the active locale's entry and preserves the others,
 * shipped as `@object-ui/i18n`'s `setLocalized`. The pins below are that rule's
 * acceptance test at this surface, and the one that carries the weight is the
 * PRESERVATION pin — "the input is no longer read-only" is equally green
 * against a fix that flattens the map, which is the exact data loss the
 * read-only branch existed to prevent.
 *
 * ⚠️ These pins describe a SINGLE-locale editor: an author reaches only the
 * entry for the locale they are in. Authoring every locale from one panel is a
 * separate open question, deliberately not deferred to a tracker here — the
 * deferral this replaced pointed at #4163, closed as completed 2026-08-15.
 */

import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { DashboardComponentSchema } from '@object-ui/types';
import { DashboardEditor } from '../DashboardEditor';

const MAP_TITLE = { en: 'Pipeline', 'zh-CN': '销售漏斗' };

function schemaWith(title: unknown): DashboardComponentSchema {
  return {
    type: 'dashboard',
    name: 'sales',
    title: 'Sales dashboard',
    widgets: [
      // Cast at the fixture boundary only — the point is what a spec-valid
      // authored map does at the read/write sites.
      { id: 'w1', type: 'bar', title: title as never },
      { id: 'w2', type: 'metric', title: 'Revenue' },
    ],
  } as DashboardComponentSchema;
}

describe('DashboardEditor — display reads of a map-valued widget title (#4163)', () => {
  it('renders the resolved locale string on the widget card', () => {
    render(<DashboardEditor schema={schemaWith(MAP_TITLE)} onChange={() => {}} />);
    const card = screen.getByTestId('dashboard-widget-w1');
    expect(card.textContent).toContain('Pipeline');
  });

  it('never renders the stringified object anywhere in the editor', () => {
    const { container } = render(
      <DashboardEditor schema={schemaWith(MAP_TITLE)} onChange={() => {}} />,
    );
    expect(container.innerHTML).not.toContain('[object Object]');
  });

  it('leaves a plain-string title exactly as authored', () => {
    // Non-vacuity: a resolver returning '' for everything passes the assertion
    // above and fails this one.
    render(<DashboardEditor schema={schemaWith(MAP_TITLE)} onChange={() => {}} />);
    expect(screen.getByTestId('dashboard-widget-w2').textContent).toContain('Revenue');
  });
});

/**
 * The schema from the most recent `onChange` call.
 *
 * Index arithmetic rather than `calls.at(-1)`: `Array.prototype.at` is ES2022,
 * and every package hand-maintains the `lib` level of its own
 * `tsconfig.test.json` — so "does `.at()` type-check?" is a per-package
 * question whose answer moves whenever one of those files does. Read it off the
 * `lib` section of `pnpm census:tsconfig-test-parity`; ⛔ a level, a count or a
 * list of package names written down here goes stale in silence, which is
 * exactly what happened to the sentence this one replaces (objectui#9513, which
 * found it asserting the answer was "nowhere"). Index arithmetic asks no `lib`
 * question at all, which is why it is kept here rather than modernised.
 *
 * ⚠️ Note which tool decides, because `vitest` never does: esbuild strips types
 * without checking them, so an `.at()` too new for the program's `lib` passes
 * the suite and fails `tsc -p tsconfig.test.json`, the half of `type-check`
 * that compiles tests. Left as a named helper so the constraint is stated once
 * instead of re-learned at the next call site.
 */
function lastSchema(onChange: ReturnType<typeof vi.fn>): DashboardComponentSchema {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1][0] as DashboardComponentSchema;
}

/**
 * One widget by id, read through the slot's element type (objectui#11514): a
 * `widgets[]` entry is either arm of a union, and `title` is declared on both
 * (the widget arm's spec row, and the component arm's card heading), so
 * `.title` reads with a declared type off either arm.
 */
function widgetById(schema: DashboardComponentSchema, id: string): DashboardComponentSchema['widgets'][number] | undefined {
  const widgets: DashboardComponentSchema['widgets'] = schema.widgets ?? [];
  return widgets.find((w) => w.id === id);
}

describe('DashboardEditor — the title INPUT is a write path, not a display (#4163)', () => {
  /** Select the widget so the property panel mounts. */
  function openPanelFor(schema: DashboardComponentSchema, widgetTestId: string) {
    const onChange = vi.fn();
    render(<DashboardEditor schema={schema} onChange={onChange} />);
    fireEvent.click(screen.getByTestId(widgetTestId));
    return onChange;
  }

  it('shows a map-valued title resolved, and EDITABLE', () => {
    // The read-only branch is gone: its premise ("no persisted title can be a
    // map") expired at @objectstack/spec 17.0.0. Editable is NECESSARY but not
    // sufficient — the preservation pin below is what makes it correct.
    openPanelFor(schemaWith(MAP_TITLE), 'dashboard-widget-w1');
    const input = screen.getByTestId('widget-prop-title') as HTMLInputElement;
    expect(input.value).toBe('Pipeline');
    expect(input.readOnly).toBe(false);
  });

  it('⛔ a keystroke on a map-valued title writes ONLY the displayed locale — every other entry survives byte-identical', () => {
    // THE data-loss pin. The flattening write (`onChange({ title:
    // e.target.value })`) emits a plain string and `zh-CN` is gone forever on
    // the next save. Asserting the map SHAPE is what catches that; an "is no
    // longer read-only" assertion is green against it.
    const onChange = openPanelFor(schemaWith(MAP_TITLE), 'dashboard-widget-w1');
    fireEvent.change(screen.getByTestId('widget-prop-title'), {
      target: { value: 'Pipelinex' },
    });

    expect(onChange).toHaveBeenCalled();
    const title = widgetById(lastSchema(onChange), 'w1')!.title;
    // Still a map — not flattened to the edited string.
    expect(typeof title).toBe('object');
    const map = title as Record<string, string>;
    // The displayed locale carries the new string...
    expect(map.en).toBe('Pipelinex');
    // ...and the locale the author never saw is untouched, character for
    // character. This is the assertion a flattening fix cannot satisfy.
    expect(map['zh-CN']).toBe('销售漏斗');
    expect(map['zh-CN']).toBe(MAP_TITLE['zh-CN']);
    // No entry invented, none dropped: exactly the stored key set.
    expect(Object.keys(map).sort()).toEqual(['en', 'zh-CN']);
    // The stored object is not mutated in place — the editor's undo history
    // holds the previous schema by reference.
    expect(MAP_TITLE).toEqual({ en: 'Pipeline', 'zh-CN': '销售漏斗' });
  });

  it('what the panel SHOWS after a save is what was typed — this surface\'s read and write agree', () => {
    // `pickLocalized ∘ setLocalized` as this panel wires it: an edit that landed
    // in an entry the panel does not display would "save" and then vanish. The
    // pair is pinned in @object-ui/i18n; this pins that THIS panel reads and
    // writes through the pair rather than around it.
    const onChange = openPanelFor(schemaWith(MAP_TITLE), 'dashboard-widget-w1');
    fireEvent.change(screen.getByTestId('widget-prop-title'), {
      target: { value: 'Pipelinex' },
    });
    const saved = lastSchema(onChange);

    // Re-open the saved schema in a fresh editor and read the field back.
    render(<DashboardEditor schema={saved} onChange={() => {}} />);
    const reopenedCard = screen.getAllByTestId('dashboard-widget-w1')[1];
    fireEvent.click(reopenedCard);
    const reopened = screen.getAllByTestId('widget-prop-title')[1] as HTMLInputElement;
    expect(reopened.value).toBe('Pipelinex');
  });

  it('an inline map survives an UNRELATED edit-and-save round trip untouched', async () => {
    // The ruling's acceptance criterion, end to end: the author changes
    // something else entirely on the same widget, and the stored map comes back
    // byte-identical rather than flattened to one locale. The colour is picked
    // through the shared Select's trigger (objectui#11865).
    const onChange = openPanelFor(schemaWith(MAP_TITLE), 'dashboard-widget-w1');
    fireEvent.keyDown(screen.getByTestId('widget-prop-color'), { key: 'ArrowDown' });
    fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'Blue' }));

    expect(onChange).toHaveBeenCalled();
    const saved = lastSchema(onChange);
    const widget = widgetById(saved, 'w1')!;
    expect(widget.title).toEqual(MAP_TITLE);
    // `toEqual` alone would pass for a rebuilt-but-equal object; this says the
    // OTHER locale is still there, which is the thing that gets lost.
    expect((widget.title as Record<string, string>)['zh-CN']).toBe('销售漏斗');
    expect((widget as { colorVariant?: string }).colorVariant).toBe('blue');
  });

  it('a plain-string title stays fully editable — the guard is narrow', () => {
    // Non-vacuity for the two pins above: a guard that simply disabled the
    // input for everyone would satisfy them and fail here.
    const onChange = openPanelFor(schemaWith(MAP_TITLE), 'dashboard-widget-w2');
    const input = screen.getByTestId('widget-prop-title') as HTMLInputElement;
    expect(input.value).toBe('Revenue');
    expect(input.readOnly).toBe(false);

    fireEvent.change(input, { target: { value: 'Revenue (net)' } });
    expect(onChange).toHaveBeenCalled();
    const saved = lastSchema(onChange);
    expect(widgetById(saved, 'w2')!.title).toBe('Revenue (net)');
  });
});
