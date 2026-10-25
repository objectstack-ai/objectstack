/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `DesignerCanvasConfig.backgroundColor` is DRAWN on all three canvases that
 * share the record (objectui#11434).
 *
 * The card's measurement found the member declared on both faces and drawn by
 * none of `PageDesigner`, `DataModelDesigner` and `ProcessDesigner`. The seat
 * ruled it READ on all three, through the styling rule's carve-out for an
 * author-declared colour: the colour is published as a CSS custom property and
 * painted by a static utility class.
 *
 * Each row is a render probe through the real `SchemaRenderer` and registry:
 * the canvas markup with the colour against the markup without it. The diff
 * does not rest on a colour-valued style alone (the class that paints it is
 * asserted too), because the test DOM drops some style values silently.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
import '../index';

afterEach(() => cleanup());

const COLOR = '#123456';
const CANVAS = { width: 800, height: 600 };

const CASES = [
  ['page-designer', 'page-canvas', (canvas: Record<string, unknown>) => ({ type: 'page-designer', canvas, components: [] })],
  ['data-model-designer', 'data-model-canvas', (canvas: Record<string, unknown>) => ({ type: 'data-model-designer', canvas, entities: [], relationships: [] })],
  ['process-designer', 'process-canvas', (canvas: Record<string, unknown>) => ({ type: 'process-designer', canvas, processName: 'p', nodes: [], edges: [] })],
] as const;

function canvasOf(node: Record<string, unknown>, testId: string): HTMLElement {
  const { container } = render(<SchemaRenderer schema={node as never} />);
  return container.querySelector(`[data-testid="${testId}"]`) as HTMLElement;
}

describe('`DesignerCanvasConfig.backgroundColor` is drawn on every canvas that declares it (objectui#11434)', () => {
  it.each(CASES)('%s paints the declared colour through its custom property', (_type, testId, build) => {
    const painted = canvasOf(build({ ...CANVAS, backgroundColor: COLOR }), testId);
    const paintedMarkup = painted.outerHTML;
    expect(painted.className).toContain('bg-[color:var(--designer-canvas-bg)]');
    expect(painted.style.getPropertyValue('--designer-canvas-bg')).toBe(COLOR);
    cleanup();
    const plain = canvasOf(build(CANVAS), testId);
    expect(plain.outerHTML).not.toBe(paintedMarkup);
    expect(plain.className).not.toContain('--designer-canvas-bg');
    expect(plain.style.getPropertyValue('--designer-canvas-bg')).toBe('');
  });
});
