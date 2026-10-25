/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9701 — a `collapsible` whose `trigger` is a BARE STRING is accepted
 * by both published faces and must therefore also RENDER. MEASURED here through
 * the real `SchemaRenderer` and the real registry, reading the DOM; nothing in
 * this file is inferred from a grep.
 *
 * ## What was there before, measured on this file's own fixtures
 *
 * The block handed `renderChildren(schema.trigger)` to `CollapsibleTrigger`
 * with `asChild` written unconditionally. Radix resolves `asChild` to its
 * `Slot`, which calls `React.Children.only` on what it is given — a bare string
 * is not a single React element, so the render THREW and the node landed in
 * `SchemaRenderer`'s error boundary reading `Component "collapsible" failed to
 * render`. Both published faces say a bare string is legal: the TypeScript
 * union `SchemaNode` names `string` explicitly, and the zod mirror types
 * `trigger` against that same union. Declaration said yes, runtime said no.
 *
 * The repair is on the IMPLEMENTATION side only (the direction objectui#9701's
 * triage named second). ⛔ Neither published face is narrowed by this file or
 * by the change it pins — `packages/types` is untouched.
 *
 * ## Controls — a green "the string painted" is worthless without them
 *
 *  - `OBJECT_TRIGGER` — the singular OBJECT form parses and paints its label.
 *    This is the firing control: it was green while the target was red, so a
 *    red target was about the bare string and not about a broken harness.
 *  - `ASCHILD_STILL_ON` — an ELEMENT trigger is still merged onto the Radix
 *    trigger rather than nested inside a second button. This is what makes the
 *    repair TARGETED: `asChild` is withheld only where Radix structurally
 *    cannot take the child, and the element path is unchanged.
 *  - `CONTENT_ARM` — `content`, declared identically on the same arm, already
 *    took a bare string before this change (it has no `asChild`), so this
 *    file's readings are about the `asChild` seam and not about node slots in
 *    general. objectui#9701 asked for the pair to be enumerated rather than
 *    assumed alike; this is that enumeration, asserted.
 */

import { describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer } from '@object-ui/react';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout` (objectui#3010/#3021).
import '../renderers';

/* ────────────────────────────────────────────────────────────────────────────
 * Harness
 * ───────────────────────────────────────────────────────────────────────── */

const BODY = 'Body copy';
const LABEL = 'Show more';

/** The marker `SchemaRenderer`'s error boundary paints when a node throws. */
const ERROR_BOUNDARY_MARKER = 'failed to render';

interface Reading {
  /** Whether the node reached the error boundary instead of painting. */
  erroredOut: boolean;
  /** Radix stamps `data-state` on the `Collapsible` root: `'open'` / `'closed'`. */
  state: string | null;
  /** The text content of the element Radix owns as the trigger. */
  triggerText: string | null;
  /** How many `<button>` elements the trigger subtree produced. */
  triggerButtons: number;
  /** Whether the content text is in the tree. */
  bodyVisible: boolean;
}

function probe(node: Record<string, unknown>): {
  before: Reading;
  afterClick: Reading;
} {
  cleanup();
  const { container } = render(<SchemaRenderer schema={node as never} />);
  const read = (): Reading => {
    const erroredOut = (container.textContent ?? '').includes(
      ERROR_BOUNDARY_MARKER,
    );
    const root = container.querySelector('[data-state]');
    // Radix stamps `aria-expanded` on the trigger element it owns, whether
    // that element is the authored one (`asChild`) or its own `<button>`.
    const trigger = container.querySelector<HTMLElement>('[aria-expanded]');
    return {
      erroredOut,
      state: root ? root.getAttribute('data-state') : null,
      triggerText: trigger ? (trigger.textContent ?? '') : null,
      triggerButtons: container.querySelectorAll('button').length,
      bodyVisible: (container.textContent ?? '').includes(BODY),
    };
  };
  const before = read();
  const trigger = container.querySelector<HTMLElement>('[aria-expanded]');
  if (trigger) fireEvent.click(trigger);
  return { before, afterClick: read() };
}

function content(): Array<Record<string, unknown>> {
  return [{ type: 'text', content: BODY }];
}

/* ────────────────────────────────────────────────────────────────────────────
 * Readings
 * ───────────────────────────────────────────────────────────────────────── */

describe('collapsible: a bare-string trigger renders (objectui#9701)', () => {
  it('paints the string as the trigger instead of reaching the error boundary', () => {
    const { before, afterClick } = probe({
      type: 'collapsible',
      trigger: LABEL,
      content: content(),
    });

    // The defect, inverted: this read `true` before the repair.
    expect(before.erroredOut).toBe(false);
    // The string is the trigger's own text, and Radix still owns the element.
    expect(before.triggerText).toBe(LABEL);
    expect(before.state).toBe('closed');
    expect(before.bodyVisible).toBe(false);

    // A trigger that paints but cannot toggle would be a second defect.
    expect(afterClick.state).toBe('open');
    expect(afterClick.bodyVisible).toBe(true);
  });

  it('OBJECT_TRIGGER control: the singular object form parses and paints', () => {
    const { before, afterClick } = probe({
      type: 'collapsible',
      trigger: { type: 'button', label: 'Toggle' },
      content: content(),
    });

    expect(before.erroredOut).toBe(false);
    expect(before.triggerText).toBe('Toggle');
    expect(before.state).toBe('closed');
    expect(afterClick.state).toBe('open');
  });

  it('ASCHILD_STILL_ON control: an element trigger is merged, not nested', () => {
    const { before, afterClick } = probe({
      type: 'collapsible',
      trigger: [{ type: 'button', label: 'Toggle' }],
      content: content(),
    });

    expect(before.erroredOut).toBe(false);
    // ONE button: the authored one, wearing Radix's trigger props. Two would
    // mean `asChild` was dropped on a path Radix can serve, which is the
    // over-reach this control exists to refuse.
    expect(before.triggerButtons).toBe(1);
    expect(before.triggerText).toBe('Toggle');
    expect(afterClick.state).toBe('open');
  });

  it('CONTENT_ARM control: `content` took a bare string on both sides of the change', () => {
    const { before, afterClick } = probe({
      type: 'collapsible',
      trigger: [{ type: 'button', label: 'Toggle' }],
      content: BODY,
    });

    expect(before.erroredOut).toBe(false);
    expect(afterClick.bodyVisible).toBe(true);
  });
});
