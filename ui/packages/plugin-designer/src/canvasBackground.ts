/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { CSSProperties } from 'react';

/**
 * `DesignerCanvasConfig.backgroundColor`, drawn on the canvas of all three
 * canvas designers — `PageDesigner`, `DataModelDesigner` and `ProcessDesigner`
 * (objectui#11434).
 *
 * The value is an AUTHOR-declared colour, so it takes the one carve-out the
 * styling rule allows (`skills/objectui/rules/styling.md`): it is published as
 * a CSS custom property, and a STATIC utility paints it. The stylesheet keeps
 * the rule, so a theme can still restyle or override the canvas; the component
 * never writes `backgroundColor` itself.
 */
export const CANVAS_BACKGROUND_CLASS = 'bg-[color:var(--designer-canvas-bg)]';

/** The custom property that carries the declared colour, or nothing when none is declared. */
export function canvasBackgroundStyle(color: string | undefined): CSSProperties {
  return color ? ({ '--designer-canvas-bg': color } as CSSProperties) : {};
}
