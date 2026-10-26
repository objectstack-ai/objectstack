/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4425 — a `metric-card` with `label` is refused with the remedy, and
 * the same card with `title` draws its heading.
 *
 * `MetricCard` spells its heading `title`; `label` is how the sibling `metric`
 * node spells it, and the card inherited `label` from `BaseSchema` without
 * reading it. So a card authored with `label` validated and drew no heading.
 * Under the objectui#8284 ruling (one spelling per rendered thing) the card's
 * declaration refuses `label` by name and names `title`
 * (`@object-ui/types`, the widget slot's component arm). The faces' own pins
 * are in that package's `dashboard-widget-slot-component-arm-7952.test.ts`;
 * this file holds the two halves where the card renders:
 *
 *   1. the refusal, as an author reaches it: both schema faces refuse the card
 *      with `label`, naming `title`, and accept the same card with `title`;
 *   2. the heading: on both dashboard surfaces and on the bare registration,
 *      the card with `title` draws it, and the card with `label`, as stored
 *      metadata no validator ran on, draws none. The second case is why the
 *      refusal is the remedy, not a rendered alias.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
import '@object-ui/components';
import '../index';
import { DashboardRenderer } from '../DashboardRenderer';
import { DashboardGridLayout } from '../DashboardGridLayout';
import { AnyComponentSchema, StrictAnyComponentSchema } from '@object-ui/types/zod';

afterEach(cleanup);

const HEADING = 'Total Revenue';
const FIGURE = '$24k';
const TITLED = { id: 'c1', type: 'metric-card', value: FIGURE, title: HEADING } as const;
const LABELLED = { id: 'c1', type: 'metric-card', value: FIGURE, label: HEADING } as const;

const doc = (widget: Record<string, unknown>) => ({ type: 'dashboard', widgets: [widget] });

/** Every issue message, the union's per-arm `errors` included. */
const messages = (result: { success: boolean; error?: { issues: unknown[] } }): string[] => {
  type Issue = { message: string; errors?: Issue[][] };
  const out: string[] = [];
  const walk = (list: Issue[]) => {
    for (const issue of list) {
      out.push(issue.message);
      for (const arm of issue.errors ?? []) walk(arm);
    }
  };
  if (!result.success) walk(result.error!.issues as Issue[]);
  return out;
};

/** Stored metadata is what a surface receives: it crosses the declared type once, here. */
const draw = (surface: 'renderer' | 'grid' | 'registration', widget: Record<string, unknown>) => {
  if (surface === 'registration') {
    return render(<SchemaRenderer schema={{ ...widget, type: 'plugin-dashboard:metric-card' } as never} />);
  }
  const schema = doc(widget) as never;
  return surface === 'renderer'
    ? render(<DashboardRenderer schema={schema} />)
    : render(<DashboardGridLayout schema={schema} />);
};

describe('objectui#4425 — the card with `label` is refused, and the remedy names `title`', () => {
  it.each([
    ['the tolerant face', AnyComponentSchema],
    ['the strict authoring face', StrictAnyComponentSchema],
  ] as const)('%s', (_face, face) => {
    const refused = face.safeParse(doc(LABELLED));
    expect(refused.success).toBe(false);
    expect(messages(refused).some((m) => m.includes('Did you mean `label` → `title`?'))).toBe(true);
    // CONTROL — the same card with `title` is accepted.
    expect(face.safeParse(doc(TITLED)).success).toBe(true);
  });
});

describe.each(['renderer', 'grid', 'registration'] as const)('objectui#4425 — %s: `title` draws the heading, `label` draws none', (surface) => {
  it('the card with `title` draws its heading', async () => {
    draw(surface, TITLED);
    expect(await screen.findByText(FIGURE)).toBeInTheDocument();
    expect(screen.getAllByText(HEADING).length).toBeGreaterThan(0);
  });

  it('the same card with `label` draws its figure and no heading', async () => {
    draw(surface, LABELLED);
    // Non-vacuity: the card drew, so the missing heading is not a missing card.
    expect(await screen.findByText(FIGURE)).toBeInTheDocument();
    expect(screen.queryByText(HEADING)).not.toBeInTheDocument();
  });
});
