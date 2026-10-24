/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8908 — the reachable, SHIPPED instance: `empty` printed a stray "0".
 *
 * ## What was wrong
 *
 * `EmptySchema.action` is a `SchemaNode` (objectui#7105), and the renderer gates
 * the slot on NULLISH — deliberately, so a bare string node renders instead of
 * being dropped. `0` and `false` are not nullish, so they went through
 * `toRenderableSchema`, which mapped every `number` / `boolean` onto
 * `String(node)`. `'0'` and `'false'` are non-empty strings, so they sailed past
 * `SchemaRenderer`'s own `!evaluatedSchema` leg and rendered as their own text:
 * `{ type: 'empty', title: 'T', action: 0 }` painted "T0".
 *
 * Handing the same `0` to `SchemaRenderer` directly renders nothing
 * (objectui#4548, pinned in
 * `packages/react/src/__tests__/SchemaRenderer.primitiveSchema.test.tsx`), so
 * the two disagreed — which is the guarantee objectui#8908 repaired at the
 * bridge.
 *
 * ## Why this suite lives here and not only next to the bridge
 *
 * The bridge's own suite measures the two render paths against each other. This
 * one measures the SHIPPED renderer a user actually reaches, through the whole
 * stack, which is the thing the finding observed. Both are needed: a bridge-only
 * pin would keep passing if some future slot re-introduced a `String()` of its
 * own.
 *
 * ## Discriminating power
 *
 * The `0` and `false` rows fail on the pre-fix tree — measured, "T0" and
 * "Tfalse". The `''` row and the object / string / absent rows are CONTROLS:
 * green on both sides, and they are what stops "renders nothing for everything"
 * from passing as a fix.
 *
 * Module-scope import of the renderers, not `beforeAll` (AGENTS.md §测试纪律).
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer } from '@object-ui/react';
import '../renderers';

/** `title: 'T'` so the row's whole text is the title plus whatever the slot adds. */
function renderEmpty(action: unknown): string {
  const { container, unmount } = render(
    <SchemaRenderer schema={{ type: 'empty', title: 'T', action } as never} />,
  );
  const text = container.textContent ?? '';
  unmount();
  return text;
}

describe('objectui#8908 — a falsy primitive in `empty.action` renders nothing', () => {
  it('the finding\'s three-row table: 0, false and \'\' all render just the title', () => {
    // Measured on the pre-fix tree as "T0" / "Tfalse" / "T".
    expect({
      zero: renderEmpty(0),
      no: renderEmpty(false),
      emptyString: renderEmpty(''),
    }).toEqual({ zero: 'T', no: 'T', emptyString: 'T' });
  });

  it('agrees with the title-only baseline, which is what "renders nothing" means here', () => {
    // Asserted against the renderer's OWN chrome rather than a substring guess:
    // if `DataEmptyState` ever grows text of its own, this moves with it.
    const baseline = renderEmpty(undefined);
    for (const value of [0, false, '', null] as const) {
      expect(renderEmpty(value)).toBe(baseline);
    }
  });
});

describe('objectui#8908 — the truthy slot values are untouched (controls)', () => {
  it('still renders a truthy number / boolean as its own text', () => {
    // The bridge's other leg. These are the rows that read `same=true` before
    // the fix and must keep reading it — a repair that swallowed every
    // primitive would fail here.
    expect(renderEmpty(42)).toBe('T42');
    expect(renderEmpty(true)).toBe('Ttrue');
  });

  it('still renders a bare string action as text (objectui#7105)', () => {
    expect(renderEmpty('Ask an admin for access')).toBe('TAsk an admin for access');
  });

  it('still renders an object action through the registry', () => {
    expect(renderEmpty({ type: 'button', label: 'Create' })).toContain('Create');
  });
});
