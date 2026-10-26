/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6124 — the three `on*` mirrors in `views.zod.ts` that a handler-key
 * census reads as dead callbacks and are in fact LIVE, JSON-authorable
 * capabilities.
 *
 * ## What was measured, and why a pin exists at all
 *
 * #6182's census bucketed handler keys BY ZOD TYPE, which cannot tell a
 * "handler expression" (a dialect this repo does not support — measurably
 * dropped at runtime, #4453) from an EVENT NAME (a string the renderer
 * dispatches). Three rows are the second kind, and the scope extension that
 * swept them in for retirement would have DELETED WORKING BEHAVIOUR:
 *
 *   - `ViewSwitcherSchema.onViewChange` — `ViewSwitcher`'s `notifyChange`
 *   - `FilterUISchema.onChange`         — `FilterUI`'s `notifyChange`
 *   - `SortUISchema.onChange`           — `SortUI`'s `notifyChange`
 *
 * each hands `schema.<key>` to `notifyViewHandlerChannels`
 * (`viewHandlerChannels.ts`), which runs
 * `window.dispatchEvent(new CustomEvent(schema.<key>, { detail }))`, i.e. the
 * AUTHORED STRING IS THE EVENT NAME. Note the dual channel that produced the
 * mislabel: the same helper also calls the REACT PROP `onViewChange` (a
 * function a host passes), while `schema.onViewChange` is the authored string.
 * Same name, two channels — which is exactly what a type-shaped census cannot
 * see, and why the `.describe()` text on those three rows now says "event name"
 * rather than "callback".
 *
 * ⚠️ This file renders the components DIRECTLY and mocks `SchemaRenderer`, so
 * the callback prop is always `undefined` here. Through the real renderer the
 * authored string also lands in that prop, and calling it threw
 * `TypeError: onChange is not a function` while every pin below stayed green
 * (objectui#10616). That entry is pinned in
 * `handlerEventNameThroughRenderer-10616.test.tsx`.
 *
 * ## Why BOTH halves, and why the declared half is not a `safeParse`
 *
 * A retirement of one of these keys has two independent failure surfaces, so
 * the pin has two halves:
 *
 *  1. DECLARED — the key is in the mirror's `shape`. ⚠️ This deliberately does
 *     NOT assert via `safeParse`: `BaseSchema` is `.passthrough()`, so a
 *     retired key still PARSES GREEN and the parsed output still CARRIES the
 *     value (measured on #6124). A `safeParse`-based pin would therefore stay
 *     green through the very deletion it exists to catch — absence is not
 *     refusal here, so the pin has to read the DECLARATION.
 *  2. LIVE — the authored string reaches `new CustomEvent(...)` on `window`.
 *
 * Either half alone is passable by a change that breaks the capability: half 1
 * alone allows the renderer's dispatch to be deleted; half 2 alone allows the
 * key to leave the authorable surface while the runtime keeps working for React
 * hosts only.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import {
  ViewSwitcherSchema as ViewSwitcherMirror,
  FilterUISchema as FilterUIMirror,
  SortUISchema as SortUIMirror,
} from '@object-ui/types/zod';
import type {
  ViewSwitcherSchema,
  FilterUISchema,
  SortUISchema,
} from '@object-ui/types';
import { ViewSwitcher } from '../ViewSwitcher';
import { FilterUI } from '../FilterUI';
import { SortUI } from '../SortUI';

vi.mock('@object-ui/react', async (importOriginal) => {
  const React = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ({ schema }: { schema?: { type?: string } }) => (
      <div data-schema-type={schema?.type} />
    ),
    SchemaRendererContext: React.createContext(null),
    subscribeDataChanges: () => () => {},
    notifyDataChanged: () => {},
  };
});

afterEach(() => cleanup());

/** Record every CustomEvent of `name` dispatched on `window` while `fn` runs. */
function captureWindowEvents<D>(name: string, fn: () => void): D[] {
  const seen: D[] = [];
  const listener = (e: Event) => seen.push((e as CustomEvent<D>).detail);
  window.addEventListener(name, listener);
  try { fn(); } finally { window.removeEventListener(name, listener); }
  return seen;
}

describe('#6124 half 1 — the three event-name keys are DECLARED on the authorable surface', () => {
  // Reading `.shape`, not `.safeParse`: under `BaseSchema.passthrough()` a
  // retired key still parses green, so only the declaration can report a
  // deletion. Retiring any of these three turns exactly this half red.
  it('ViewSwitcherSchema declares onViewChange', () => {
    expect(Object.keys(ViewSwitcherMirror.shape)).toContain('onViewChange');
  });
  it('FilterUISchema declares onChange', () => {
    expect(Object.keys(FilterUIMirror.shape)).toContain('onChange');
  });
  it('SortUISchema declares onChange', () => {
    expect(Object.keys(SortUIMirror.shape)).toContain('onChange');
  });

  it('each is a STRING mirror — an authored event name parses, a function does not', () => {
    const base = { type: 'sort-ui' as const, fields: [{ field: 'name' }] };
    expect(SortUIMirror.safeParse({ ...base, onChange: 'sort:changed' }).success).toBe(true);
    // control: the instrument can say no — the string arm is a real constraint
    expect(SortUIMirror.safeParse({ ...base, onChange: () => {} }).success).toBe(false);
  });

  it('the describe() text names the EVENT-NAME channel, not "callback"', () => {
    // The mislabel is the measured root cause of the wrong bucketing, so the
    // corrected wording is pinned rather than left to survive by luck.
    for (const d of [
      ViewSwitcherMirror.shape.onViewChange.description,
      FilterUIMirror.shape.onChange.description,
      SortUIMirror.shape.onChange.description,
    ]) {
      // Names the real channel …
      expect(d).toMatch(/event name/i);
      // … and carries the DISCLAIMER, because "callback" in the old wording is
      // what a type-shaped census read to mean "dead handler". The wording has
      // to refuse that reading explicitly, not merely omit the word.
      expect(d).toMatch(/not a callback or a handler expression/i);
    }
  });
});

describe('#6124 half 2 — the authored string is LIVE: it is the CustomEvent name', () => {
  it('ViewSwitcher dispatches the authored name on view change', () => {
    const schema: ViewSwitcherSchema = {
      type: 'view-switcher', variant: 'buttons',
      views: [{ type: 'list' }, { type: 'grid' }],
      onViewChange: 'zz6124:view',
    };
    render(<ViewSwitcher schema={schema} />);
    const details = captureWindowEvents<{ view: string }>('zz6124:view', () => {
      fireEvent.click(screen.getByRole('button', { name: /grid/i }));
    });
    expect(details).toHaveLength(1);
    expect(details[0].view).toBe('grid');
  });

  it('FilterUI dispatches the authored name on filter change', () => {
    const schema: FilterUISchema = {
      type: 'filter-ui', layout: 'inline',
      filters: [{ field: 'qty', label: 'Qty', type: 'number' }],
      onChange: 'zz6124:filter',
    };
    const { container } = render(<FilterUI schema={schema} />);
    const input = container.querySelector('input[type="number"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    const details = captureWindowEvents<{ values: Record<string, unknown> }>('zz6124:filter', () => {
      fireEvent.change(input, { target: { value: '7' } });
    });
    expect(details).toHaveLength(1);
    expect(details[0].values.qty).toBe(7);
  });

  it('SortUI dispatches the authored name on sort change', () => {
    const schema: SortUISchema = {
      type: 'sort-ui', variant: 'buttons',
      fields: [{ field: 'name', label: 'Name' }],
      onChange: 'zz6124:sort',
    };
    render(<SortUI schema={schema} />);
    const details = captureWindowEvents<{ sort: Array<{ field: string }> }>('zz6124:sort', () => {
      fireEvent.click(screen.getByRole('button', { name: /name/i }));
    });
    expect(details).toHaveLength(1);
    expect(details[0].sort[0].field).toBe('name');
  });
});
