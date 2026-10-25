// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12488 — the flow canvas's node card, as the Studio artboard draws it,
 * in both the Studio canvas and the metadata-admin designer (one renderer):
 * an 8 px card, a 28 px tile tinted by kind (start green, screen pink, record
 * blue, decision amber, loop violet, end grey), the kind by its display name in
 * the designer locale with the raw type on its tooltip, and the primary border
 * with a 3 px ring when selected.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { NodeCard, nodeTone } from './flow-canvas-parts';

afterEach(cleanup);

function card(type: string, opts: { selected?: boolean; locale?: string; summary?: string } = {}) {
  const { container } = render(
    <NodeCard
      id="n"
      type={type}
      label="Campaign Open?"
      summary={opts.summary}
      locale={opts.locale}
      position={{ x: 0, y: 0 }}
      selected={opts.selected ?? false}
      editable={false}
    />,
  );
  const button = container.querySelector('[data-node-id="n"] [role="button"]') as HTMLElement;
  return {
    button,
    tile: container.querySelector('[data-testid="flow-node-tile"]') as HTMLElement,
    kind: container.querySelector('[data-testid="flow-node-kind"]') as HTMLElement,
  };
}

describe('the node card (objectui#12488)', () => {
  it('is an 8 px card with a 28 px tile', () => {
    const { button, tile } = card('decision');
    expect(button).toHaveClass('rounded-lg');
    expect(tile).toHaveClass('h-7', 'w-7', 'rounded-md');
  });

  it.each([
    ['start', 'emerald'],
    ['screen', 'pink'],
    ['get_record', 'blue'],
    ['decision', 'amber'],
    ['loop', 'violet'],
  ])('tints a %s tile %s', (type, hue) => {
    const { tile } = card(type);
    expect(tile).toHaveClass(`bg-${hue}-100`);
  });

  it('draws the end tile grey, on the muted token', () => {
    expect(card('end').tile).toHaveClass('bg-muted');
    expect(nodeTone('end').icon).toBe('text-muted-foreground');
  });

  it('names the kind by its display name, with the raw type on the tooltip', () => {
    const { kind } = card('get_record');
    expect(kind).toHaveTextContent('Get record');
    expect(kind).toHaveAttribute('title', 'get_record');
    expect(kind).toHaveClass('uppercase', 'text-[10px]');
  });

  it('reads the kind in the designer locale', () => {
    expect(card('decision', { locale: 'zh-CN' }).kind).not.toHaveTextContent('decision');
  });

  it('carries the primary border and a 3 px ring when selected, and neither when not', () => {
    expect(card('decision', { selected: true }).button).toHaveClass('border-primary', 'ring-[3px]');
    cleanup();
    const plain = card('decision').button;
    expect(plain).not.toHaveClass('border-primary');
    expect(plain).not.toHaveClass('ring-[3px]');
  });
});
