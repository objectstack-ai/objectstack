/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5247 — the OBJUI-001 panel names the case-only spelling it missed.
 *
 * ## What was ruled, and what this suite therefore has to prove
 *
 * The maintainer ruled Option C on 2026-08-19: **keep lookup strict, make the
 * failure teach.** Registry lookup stays exactly case-sensitive, so a node
 * typed `Page` still MISSES a registered `page` and still fails; only the
 * message changes. Option B — normalising at lookup so `Page` renders — was
 * rejected as a permanent stack-wide contract change that also legalises the
 * typo class (`PAGE`, `pAge`).
 *
 * Every case below therefore asserts BOTH halves in one assertion set:
 *
 *   1. the node still fails — the registered component did not render, and the
 *      `role="alert"` panel did;
 *   2. the panel carries `did you mean '<the spelling that works>'`.
 *
 * Half 1 alone would pass on a revert of objectui#5247 — it is the guard
 * against implementing option B by accident, not the pin on this change. Half 2
 * is the load-bearing assertion: it is the only one here that fails if the
 * suggestion is removed. The same is true of the no-match case: `not.toContain`
 * passes on a revert by construction, which is exactly why it runs in the same
 * file as the match case rather than on its own — together they distinguish
 * "says the right thing" from "says nothing" and from "says something always".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';
// Every type below is deliberately one no registration and no declaration names:
// the suggestion is the point, so each crosses through the one test helper for
// undeclared input (objectui#11466).
import { undeclaredNode } from '@object-ui/test-support';

/** Marker text that appears ONLY if the component actually rendered. */
const RENDERED_MARKER = 'the-component-actually-rendered';

const Stub: React.FC = () => <div>{RENDERED_MARKER}</div>;

const originalWarn = console.warn;

beforeEach(() => {
  console.warn = vi.fn();
  ComponentRegistry.register('page', Stub, { namespace: 'test5247' });
  ComponentRegistry.register('button', Stub, { namespace: 'ui' });
});

afterEach(() => {
  ComponentRegistry.unregister('page', 'test5247');
  ComponentRegistry.unregister('button', 'ui');
  console.warn = originalWarn;
});

describe('objectui#5247 — case-only miss on the OBJUI-001 panel', () => {
  it("still fails on 'Page' AND names 'page'", () => {
    // Sanity: the canonical spelling is the one the registry holds. Without
    // this the suite could pass against a registry that holds neither, which
    // would make the two assertions below agree about nothing.
    expect(ComponentRegistry.getKnownTypes()).toContain('page');

    const { container } = render(<SchemaRenderer schema={undeclaredNode({ type: 'Page' })} />);
    const text = container.textContent ?? '';

    // Half 1 — the ruled behaviour that must NOT change (this passes on a
    // revert; it is the anti-option-B guard).
    expect(text).not.toContain(RENDERED_MARKER);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(text).toContain('Unknown component type');
    expect(text).toContain('Page');

    // Half 2 — the load-bearing pin. Fails if objectui#5247 is reverted.
    expect(text).toContain("did you mean 'page'");
  });

  it('names the namespaced spelling too', () => {
    const { container } = render(<SchemaRenderer schema={undeclaredNode({ type: 'UI:Button' })} />);
    const text = container.textContent ?? '';

    expect(text).not.toContain(RENDERED_MARKER);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(text).toContain("did you mean 'ui:button'");
  });

  it('says nothing when no registered type differs by case alone', () => {
    // The counter-probe for the "always suggests" failure mode. On its own it
    // is a phantom — it passes on a revert — so it is pinned in the same run as
    // the two cases above.
    const { container } = render(<SchemaRenderer schema={undeclaredNode({ type: 'zzz' })} />);
    const text = container.textContent ?? '';

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(text).toContain('Unknown component type');
    expect(text).not.toContain('did you mean');
  });

  it('does not reach for an edit distance — a typo that is not a case typo suggests nothing', () => {
    // `pge` is one deletion away from `page`. The ruling granted case, and only
    // case; a fuzzy match here would be scope it did not give.
    const { container } = render(<SchemaRenderer schema={undeclaredNode({ type: 'pge' })} />);
    const text = container.textContent ?? '';

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(text).not.toContain('did you mean');
  });

  it('reads its candidates from the live registry, not from a snapshot', () => {
    // Unregister the canonical spelling and the suggestion must disappear —
    // this is what makes the candidate set demonstrably the registry's own.
    // A hand-kept list would keep suggesting `page` here (objectui#5115).
    ComponentRegistry.unregister('page', 'test5247');
    expect(ComponentRegistry.getKnownTypes()).not.toContain('page');

    const { container } = render(<SchemaRenderer schema={undeclaredNode({ type: 'Page' })} />);
    const text = container.textContent ?? '';

    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(text).not.toContain('did you mean');
  });
});
