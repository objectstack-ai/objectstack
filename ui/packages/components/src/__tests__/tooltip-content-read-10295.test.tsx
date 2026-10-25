/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10295 — what the `tooltip` read site renders, through the real
 * `SchemaRenderer` and the real registry.
 *
 * `@object-ui/types` narrowed `TooltipSchema.content` to text on both faces
 * because this read places `content` raw in a React child position. These
 * cases pin the read the declaration now describes:
 *
 *   - text at `content` renders;
 *   - rich content under `children` renders through `renderChildren`;
 *   - when both are authored, a non-empty `content` wins and `children` is not
 *     rendered — the precedence the declaration's JSDoc and the docs state.
 *
 * The node-at-`content` crash itself is not pinned here: validation refuses
 * that document now (`packages/types`, `tooltip-content-is-text-10295.test.ts`),
 * and a test that renders it would pin a crash, not a contract.
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
// Module scope, not a hook — this import IS the registration (objectui#3010/#3021).
import '../index';

const TRIGGER = { type: 'button', label: 'Hover me' };
const RICH = { type: 'text', content: 'Rich body' };

const bodyText = (schema: Record<string, unknown>) =>
  render(<SchemaRenderer schema={{ type: 'tooltip', open: true, trigger: TRIGGER, ...schema } as never} />)
    .baseElement.textContent ?? '';

describe('objectui#10295 — the tooltip content read', () => {
  it('renders text authored at `content`', () => {
    expect(bodyText({ content: 'Plain text' })).toContain('Plain text');
  });

  it('renders a node authored under `children`', () => {
    expect(bodyText({ children: RICH })).toContain('Rich body');
  });

  it('when both are authored, `content` wins and `children` is not rendered', () => {
    const text = bodyText({ content: 'Plain text', children: RICH });

    expect(text).toContain('Plain text');
    expect(text).not.toContain('Rich body');
  });
});
