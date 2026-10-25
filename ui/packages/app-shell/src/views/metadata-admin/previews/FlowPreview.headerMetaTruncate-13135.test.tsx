// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13135 — the Studio flow header's meta pills ("Trigger: … · Status:
 * … · Run as: …") were clipped mid-word ("Status: Unpublis") with no ellipsis
 * and no tooltip: the header row was a flex row whose minimum width is the sum
 * of its items' text, so the meta slot cut it like a picture.
 *
 *   - each header pill truncates with an ellipsis (`truncate`), never a bare
 *     clip on an unshrinkable `whitespace-nowrap` box;
 *   - a cut pill names its whole `Label: value` in its `title`, before the
 *     hover text it already had (the run status's reason);
 *   - CONTROL: a pill that is not cut keeps the hover text it had, and the
 *     designer's info bar (`bar`) is not measured at all.
 *
 * jsdom lays nothing out, so "cut" is the element's own reading, stubbed here:
 * `scrollWidth` wider than `clientWidth`, as a browser reports a cut box.
 */

import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('not found', { status: 404 })),
);

import { FlowMetaPills } from './FlowPreview';
import { t } from '../i18n';

const LOCALE = 'en-US';
const en = (key: string): string => t(key, LOCALE);

const DRAFT: Record<string, unknown> = {
  name: 'f1',
  label: 'F1',
  type: 'autolaunched',
  nodes: [
    { id: 'start', type: 'start', label: 'Start', config: {} },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
};

const restores: Array<() => void> = [];

/** Every element reports its text wider than its box: a browser's reading of a cut element. */
function everyBoxCut(): void {
  for (const [prop, value] of [
    ['scrollWidth', 200],
    ['clientWidth', 100],
  ] as const) {
    const before = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value });
    restores.push(() => {
      if (before) Object.defineProperty(HTMLElement.prototype, prop, before);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
    });
  }
}

afterEach(() => {
  cleanup();
  while (restores.length) restores.pop()!();
});

/** The pill whose caption is `label`: the element that carries the class and the `title`. */
function pill(label: string): HTMLElement {
  return screen.getByText(`${label}:`).parentElement as HTMLElement;
}

function renderHeader(variant: 'header' | 'bar' = 'header'): void {
  render(<FlowMetaPills draft={DRAFT} runStatus={{ kind: 'unpublished' }} locale={LOCALE} variant={variant} />);
}

describe('the flow header meta pills truncate with an ellipsis and a title (objectui#13135)', () => {
  it('the header Status pill ellipsizes rather than clipping bare', () => {
    renderHeader();
    const status = pill(en('engine.flowPreview.pill.status'));
    expect(status).toHaveClass('truncate');
    expect(status).not.toHaveClass('shrink-0');
  });

  it('a cut Status pill names its whole "Label: value" first, then its reason', () => {
    everyBoxCut();
    renderHeader();
    const label = en('engine.flowPreview.pill.status');
    expect(pill(label)).toHaveAttribute(
      'title',
      `${label}: ${en('engine.studio.unpublishedDraft')}\n${en('engine.studio.auto.unpublishedTitle')}`,
    );
  });

  it('a cut pill with no hover text of its own names its whole "Label: value"', () => {
    everyBoxCut();
    renderHeader();
    const label = en('engine.flowPreview.pill.trigger');
    expect(pill(label)).toHaveAttribute('title', `${label}: autolaunched`);
  });

  it('CONTROL: a header pill that is not cut keeps the hover text it had', () => {
    renderHeader();
    expect(pill(en('engine.flowPreview.pill.status'))).toHaveAttribute('title', en('engine.studio.auto.unpublishedTitle'));
    expect(pill(en('engine.flowPreview.pill.trigger'))).not.toHaveAttribute('title');
  });

  it("CONTROL: the designer's info bar is not measured — its pills keep their hover text", () => {
    everyBoxCut();
    renderHeader('bar');
    expect(pill(en('engine.flowPreview.pill.status'))).toHaveAttribute('title', en('engine.studio.auto.unpublishedTitle'));
  });
});
