// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12742 — the canvas draws an `http` node, the spec's HTTP node type,
 * as an integration step: the globe glyph, the integration tone and the
 * Integration palette section. Before this card the icon switch named
 * `http_request` and `webhook` and not `http`, so the node the palette adds fell
 * through to the generic task glyph. Spec 18 reserves `http_request`,
 * `http_call` and `webhook` (the authoring doors refuse them, a stored row loads
 * as `http`), so no case keeps them: a node typed with one draws like any type
 * the canvas does not know.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Globe } from 'lucide-react';
import { NodeCard, nodeCategory, nodeIcon, nodeTone } from './flow-canvas-parts';

afterEach(cleanup);

const RESERVED = ['http_request', 'http_call', 'webhook'];

function tileOf(type: string): HTMLElement {
  const { container } = render(
    <NodeCard id="n" type={type} label="Enqueue Billing Hand-off" position={{ x: 0, y: 0 }} selected={false} editable={false} />,
  );
  return container.querySelector('[data-testid="flow-node-tile"]') as HTMLElement;
}

describe('the canvas draws an `http` node as an integration step (objectui#12742)', () => {
  it('draws the globe glyph on the integration tone', () => {
    const tile = tileOf('http');
    expect(tile.querySelector('svg.lucide-globe')).not.toBeNull();
    expect(tile).toHaveClass('bg-orange-100');
  });

  it('resolves the globe, the integration tone and the Integration section', () => {
    expect(nodeIcon('http')).toBe(Globe);
    expect(nodeTone('http')).toBe(nodeTone('connector_action'));
    expect(nodeTone('http')).not.toBe(nodeTone('an_unknown_type'));
    expect(nodeCategory('http')).toBe('Integration');
  });

  it('keeps no case for a reserved name', () => {
    for (const name of RESERVED) {
      expect(nodeIcon(name), name).toBe(nodeIcon('an_unknown_type'));
      expect(nodeTone(name), name).toBe(nodeTone('an_unknown_type'));
      expect(nodeCategory(name), name).toBe('Flow');
    }
  });
});
