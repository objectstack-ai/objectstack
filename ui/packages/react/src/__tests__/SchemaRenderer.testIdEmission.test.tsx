/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8268 — `BaseSchema.testId` is emitted as `data-testid`, and this
 * file is the assertion that keeps that true.
 *
 * `base.ts` declared "Rendered as data-testid attribute" while nothing rendered
 * it. The key was absent from the metadata destructure in `SchemaRenderer.tsx`,
 * so it fell through into `componentProps` and was spread onto the component
 * and from there onto the DOM element, where React — which does not recognise a
 * `testId` DOM prop — wrote it as the non-standard lowercase `testid`.
 * `screen.getByTestId(...)` and `[data-testid=...]` both miss that spelling, so
 * an author who followed the declaration got a failing test with no diagnostic
 * pointing anywhere near the cause. React's own dev warning did fire, and made
 * it worse: it instructs the author to spell the prop lowercase `testid`, which
 * is the attribute that does not work.
 *
 * Measured on `93127bd6f` through the real `ui:scroll-area` renderer with
 * `{ id: 'my-scroll', testId: 'my-tid' }` — `[data-testid="my-tid"]` absent,
 * `[testid="my-tid"]` present, root attributes ending
 * `id="my-scroll" testid="my-tid" data-obj-id="my-scroll"`. The probe below
 * reproduces that shape: `Spreader` spreads the props it is handed onto a
 * `div`, which is exactly what `scroll-area` does with `...scrollAreaProps`.
 * The real renderer is not imported here because `@object-ui/components`
 * depends on this package, not the other way round.
 *
 * The direction NOT taken, for whoever reads this next: retiring the promise
 * instead. See the `testId` JSDoc in `packages/types/src/base.ts` for why —
 * the promise has carriers outside this repository's type declaration.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer } from '../SchemaRenderer';

/** Spreads whatever it is handed onto a DOM node — `scroll-area`'s shape. */
const Spreader = ({ schema: _schema, ...rest }: { schema: unknown }) => (
  <div {...(rest as Record<string, unknown>)} />
);

const TYPE = 'probe-8268';

describe('SchemaRenderer — `testId` is emitted as `data-testid` (objectui#8268)', () => {
  beforeEach(() => {
    ComponentRegistry.register(TYPE, Spreader as never);
  });
  afterEach(() => {
    ComponentRegistry.unregister?.(TYPE);
    cleanup();
  });

  it('emits the documented attribute, and NOT the lowercase spelling the raw spread produced', () => {
    const { container } = render(
      <SchemaRenderer schema={{ type: TYPE, id: 'my-scroll', testId: 'my-tid' } as never} />
    );

    // The promise `base.ts` makes.
    expect(container.querySelector('[data-testid="my-tid"]')).not.toBeNull();
    // The query helper an author actually reaches for.
    expect(screen.getByTestId('my-tid')).not.toBeNull();
    // The defect: the key must no longer reach the DOM under its own name.
    expect(container.querySelector('[testid="my-tid"]')).toBeNull();
  });

  it('CONTROL (green in both worlds) — `id` still reaches the DOM as `id` + `data-obj-id`', () => {
    // Deliberately green before and after the fix. It guards against ONE wrong
    // fix in particular: stopping the `testid` leak by widening the metadata
    // strip list mechanically — sweeping `id` (or the `data-obj-*` pair that is
    // emitted from the same place) out of the spread along with `testId`. That
    // edit makes the assertion above pass and silently removes the locator every
    // designer overlay and `data-obj-id` consumer depends on. Nothing else in
    // this file would notice.
    const { container } = render(
      <SchemaRenderer schema={{ type: TYPE, id: 'my-scroll', testId: 'my-tid' } as never} />
    );
    expect(container.querySelector('[id="my-scroll"]')).not.toBeNull();
    expect(container.querySelector('[data-obj-id="my-scroll"]')).not.toBeNull();
    expect(container.querySelector(`[data-obj-type="${TYPE}"]`)).not.toBeNull();
  });

  it('a node that authors no `testId` is handed no `data-testid` KEY at all', () => {
    // The key is spread conditionally, and the assertion is on the props bag,
    // not only on the DOM. `'data-testid': undefined` would be invisible in the
    // rendered HTML — React omits an undefined attribute — while still adding
    // the key to what every component receives, and a component that sets its
    // own `data-testid` before spreading what it is handed (the ADR-0054 C4
    // shape) would have its locator overwritten with `undefined`. Measured on
    // the unconditional form: 9 tests red across 5 files, three of them the
    // byte-for-byte props-bag pins (objectui#6708 / #6752 / #6760).
    const seen: Record<string, unknown>[] = [];
    const Recorder = ({ schema: _schema, ...rest }: { schema: unknown }) => {
      seen.push(rest as Record<string, unknown>);
      return <div {...(rest as Record<string, unknown>)} />;
    };
    ComponentRegistry.register('probe-8268-bag', Recorder as never);
    try {
      const { container } = render(
        <SchemaRenderer schema={{ type: 'probe-8268-bag', id: 'bare' } as never} />
      );
      // Length is not pinned — the harness may render more than once; every
      // bag it produced must satisfy the invariant.
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((bag) => !('data-testid' in bag))).toBe(true);

      const root = container.firstElementChild as HTMLElement;
      expect(root.hasAttribute('data-testid')).toBe(false);
      expect(root.hasAttribute('testid')).toBe(false);
      // Contrast leg on the SAME render: the node did render and its sibling
      // locator did land, so the `false`s above are a reading, not a miss.
      expect(seen.every((bag) => 'data-obj-id' in bag)).toBe(true);
      expect(root.getAttribute('data-obj-id')).toBe('bare');
    } finally {
      ComponentRegistry.unregister?.('probe-8268-bag');
    }
  });

  it("does not overwrite a component's own `data-testid` when the node authors none", () => {
    // The concrete failure the conditional spread prevents, stated as a case a
    // future edit trips over rather than as a comment.
    const SelfLabelled = ({ schema: _schema, ...rest }: { schema: unknown }) => (
      <div data-testid="component-own" {...(rest as Record<string, unknown>)} />
    );
    ComponentRegistry.register('probe-8268-own', SelfLabelled as never);
    try {
      render(<SchemaRenderer schema={{ type: 'probe-8268-own', id: 'bare' } as never} />);
      expect(screen.getByTestId('component-own')).not.toBeNull();
    } finally {
      ComponentRegistry.unregister?.('probe-8268-own');
    }
  });

  it("an authored `testId` DOES win over a component's own default", () => {
    // The other side of the same precedence, so the case above cannot be
    // "fixed" by dropping the emission entirely.
    const SelfLabelled = ({ schema: _schema, ...rest }: { schema: unknown }) => (
      <div data-testid="component-own" {...(rest as Record<string, unknown>)} />
    );
    ComponentRegistry.register('probe-8268-own2', SelfLabelled as never);
    try {
      const { container } = render(
        <SchemaRenderer schema={{ type: 'probe-8268-own2', testId: 'authored' } as never} />
      );
      expect(screen.getByTestId('authored')).not.toBeNull();
      expect(container.querySelector('[data-testid="component-own"]')).toBeNull();
    } finally {
      ComponentRegistry.unregister?.('probe-8268-own2');
    }
  });

  it('the objectui#4795 unevaluated-expression diagnostic still sees `testId` after the strip', () => {
    // The strip list is that diagnostic's exclusion list, because every other
    // member holds raw predicate SOURCE by design. `testId` holds a literal, so
    // it is stripped from the spread but kept in the scan set. Measured before
    // this change: the diagnostic reported an authored `testId: '${data.x}'`;
    // it must still.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<SchemaRenderer schema={{ type: TYPE, testId: '${data.x}' } as never} />);
      const reported = spy.mock.calls
        .map((call) => String(call[0]))
        .filter((message) => message.includes('Unevaluated expression'));
      expect(reported.length).toBeGreaterThan(0);
      expect(reported.join('\n')).toContain('testId');
    } finally {
      spy.mockRestore();
    }
  });
});
