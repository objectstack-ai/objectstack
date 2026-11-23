// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36745 — with the property panel open, the Studio flow header's
 * meta ("Trigger: … · Status: … · Run as: … · v3 · On error: …") shrank every
 * item at once, to one character each (objectui#13135's shrinking grid). The
 * row now gives way item by item:
 *
 *   - every item keeps its whole text (no item truncates);
 *   - items drop from the end — On error, then version, then Run as — and the
 *     row's hover text names each dropped item's whole text, in row order;
 *   - Trigger and Status are the floor: when the row cannot hold those two
 *     whole, every item hides and the hover text names all of them;
 *   - an item that fits again comes back when the row widens;
 *   - CONTROL: the designer's info bar (`bar`) has no such row.
 *
 * jsdom lays nothing out, so widths are the elements' own readings, stubbed
 * here per element: the row reads the width under test, each item its width.
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('not found', { status: 404 })),
);

import { FlowMetaPills, fitFlowMetaItems } from './FlowPreview';
import { t, translateFlowMeta } from '../i18n';

const LOCALE = 'en-US';
const en = (key: string): string => t(key, LOCALE);

const DRAFT: Record<string, unknown> = {
  name: 'f1',
  label: 'F1',
  type: 'autolaunched',
  version: 3,
  runAs: 'system',
  errorHandling: { strategy: 'continue' },
  nodes: [
    { id: 'start', type: 'start', label: 'Start', config: {} },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
};

/** Each item's whole width with its leading separator; the five sum to 400. */
const WIDTH: Record<string, number> = { trigger: 120, status: 110, runAs: 80, version: 30, onError: 60 };

let rowWidth = 0;
const original = HTMLElement.prototype.getBoundingClientRect;

beforeEach(() => {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const key = this.dataset.metaItem;
    const width = this.dataset.testid === 'flow-meta-row' ? rowWidth : key ? (WIDTH[key] ?? 0) : 0;
    return { x: 0, y: 0, top: 0, left: 0, bottom: 16, right: width, width, height: 16, toJSON: () => ({}) } as DOMRect;
  };
});

afterEach(() => {
  cleanup();
  HTMLElement.prototype.getBoundingClientRect = original;
});

const whole = {
  trigger: () => `${en('engine.flowPreview.pill.trigger')}: autolaunched`,
  status: () => `${en('engine.flowPreview.pill.status')}: ${en('engine.studio.unpublishedDraft')}`,
  runAs: () => `${en('engine.flowPreview.pill.runAs')}: ${translateFlowMeta('runAs', 'system', LOCALE)}`,
  version: () => 'v3',
  onError: () => `${en('engine.flowPreview.pill.onError')}: ${translateFlowMeta('onError', 'continue', LOCALE)}`,
};

function renderHeaderAt(width: number, variant: 'header' | 'bar' = 'header') {
  rowWidth = width;
  return render(<FlowMetaPills draft={DRAFT} runStatus={{ kind: 'unpublished' }} locale={LOCALE} variant={variant} />);
}

function row(): HTMLElement {
  return screen.getByTestId('flow-meta-row');
}

/** The items the row shows, in order: the ones not made invisible. */
function shownKeys(): string[] {
  return Array.from(row().querySelectorAll<HTMLElement>('[data-meta-item]'))
    .filter((el) => !el.classList.contains('invisible'))
    .map((el) => el.dataset.metaItem!);
}

describe('the flow header meta gives way item by item (objectstack#36745)', () => {
  it('wide row (400 px): every item shows whole, and the row has no hover text', () => {
    renderHeaderAt(400);
    expect(shownKeys()).toEqual(['trigger', 'status', 'runAs', 'version', 'onError']);
    expect(row()).not.toHaveAttribute('title');
  });

  it('middle row (320 px): On error, then version, drop; the hover text names both whole', () => {
    renderHeaderAt(320);
    expect(shownKeys()).toEqual(['trigger', 'status', 'runAs']);
    expect(row()).toHaveAttribute('title', [whole.version(), whole.onError()].join('\n'));
  });

  it('narrow row (240 px): Run as drops too; Trigger and Status stay whole', () => {
    renderHeaderAt(240);
    expect(shownKeys()).toEqual(['trigger', 'status']);
    expect(row()).toHaveAttribute('title', [whole.runAs(), whole.version(), whole.onError()].join('\n'));
  });

  it('a row too narrow for Trigger and Status (200 px, the panel-open case) hides every item', () => {
    renderHeaderAt(200);
    expect(shownKeys()).toEqual([]);
    expect(row()).toHaveAttribute(
      'title',
      [whole.trigger(), whole.status(), whole.runAs(), whole.version(), whole.onError()].join('\n'),
    );
    // Hidden items are out of the accessibility tree, not half-drawn.
    for (const el of row().querySelectorAll('[data-meta-item]')) expect(el).toHaveAttribute('aria-hidden', 'true');
  });

  it('an item that fits again comes back when the row re-renders wider', () => {
    const view = renderHeaderAt(200);
    expect(shownKeys()).toEqual([]);
    rowWidth = 400;
    view.rerender(<FlowMetaPills draft={{ ...DRAFT }} runStatus={{ kind: 'unpublished' }} locale={LOCALE} variant="header" />);
    expect(shownKeys()).toEqual(['trigger', 'status', 'runAs', 'version', 'onError']);
  });

  it('no header item truncates: each keeps its whole text on one line', () => {
    renderHeaderAt(240);
    for (const el of row().querySelectorAll('[data-meta-item], [data-meta-item] *')) {
      expect(el).not.toHaveClass('truncate');
    }
    expect(within(row()).getByText(`${en('engine.flowPreview.pill.status')}:`).parentElement).toHaveClass('whitespace-nowrap');
  });

  it("CONTROL: a shown Status keeps its own hover text (the run status's reason)", () => {
    renderHeaderAt(400);
    expect(within(row()).getByText(`${en('engine.flowPreview.pill.status')}:`).parentElement).toHaveAttribute(
      'title',
      en('engine.studio.auto.unpublishedTitle'),
    );
  });

  it("CONTROL: the designer's info bar has no give-way row and shows every item", () => {
    renderHeaderAt(0, 'bar');
    expect(screen.queryByTestId('flow-meta-row')).toBeNull();
    expect(screen.getByText(`${en('engine.flowPreview.pill.onError')}:`)).toBeVisible();
  });
});

describe('fitFlowMetaItems', () => {
  const widths = [120, 110, 80, 30, 60];
  it('keeps as many whole items from the front as fit', () => {
    expect(fitFlowMetaItems(widths, 400)).toBe(5);
    expect(fitFlowMetaItems(widths, 399)).toBe(4);
    expect(fitFlowMetaItems(widths, 310)).toBe(3);
    expect(fitFlowMetaItems(widths, 230)).toBe(2);
  });
  it('shows nothing below the Trigger + Status floor', () => {
    expect(fitFlowMetaItems(widths, 229)).toBe(0);
    expect(fitFlowMetaItems(widths, 0)).toBe(0);
  });
  it('absorbs a half-pixel of fractional width', () => {
    expect(fitFlowMetaItems([120.4, 110.3], 230.5)).toBe(2);
  });
});
