/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Who owns the bare `timeline` key (objectui#6353).
 *
 * This package registers the same short name twice: `plugin-timeline:timeline`
 * (`../renderer`, presentational) and `view:timeline` (`../index`, object-bound).
 * Both used to claim the bare-name fallback as well, so `type: 'timeline'`
 * resolved to whichever module evaluated LAST. `../index` re-exports `../renderer`
 * (line 300) before its own `import` (line 307), so the presentational one
 * registered first and the object-bound one overwrote it. Right answer, wrong
 * mechanism — swapping those two lines would have handed `type: 'timeline'` to the
 * presentational renderer, which reads none of the object-bound keys, so an
 * authored timeline would stop fetching with no error and no failing test.
 *
 * The fix is the remedy the registry's own collision guard names: `skipFallback:
 * true` on the presentational registration. These pins are the half that outlives
 * it — they fail if the declaration is dropped, if a third registration starts
 * claiming the bare key, or if the resolution ever becomes order-dependent again.
 *
 * WHY THE REPLAY (`resolves the same way in EITHER evaluation order`): asserting
 * only today's outcome cannot distinguish "declared" from "happened to be last".
 * The replay reads the two registrations' REAL declared metadata out of the
 * registry — nothing here is a hand-copied mirror of the source, so it cannot
 * drift from it — and re-registers them into a fresh `Registry` in both orders.
 * Order-dependence is then a property under test rather than a property of the
 * file this test happens to import.
 */
import { describe, it, expect, vi } from 'vitest';
import { ComponentRegistry, Registry, type ComponentMeta } from '@object-ui/core';
// Importing the package entry is what performs BOTH registrations, exactly as a
// host does. `ObjectTimelineRenderer` and `TimelineRenderer` are compared by
// IDENTITY below, so these pins cannot be satisfied by a look-alike.
import { ObjectTimelineRenderer } from '../index';
import { TimelineRenderer } from '../renderer';

/** The short name both registrations claim. */
const BARE = 'timeline';
/** The namespace whose renderer must own the bare key: the object-bound one. */
const OWNER_NS = 'view';
/** The namespaced-only registration: presentational, reached by explicit key. */
const PRESENTATIONAL_NS = 'plugin-timeline';

const COLLISION_WARNING = 'bare-name fallback is being overwritten';

/** Every registry key that is this short name, bare or namespaced. */
function keysForShortName(): string[] {
  return ComponentRegistry.getAllTypes()
    .filter((t) => t === BARE || t.endsWith(`:${BARE}`))
    .sort();
}

/**
 * The registration a namespace actually declared — component plus meta, read back
 * from the registry rather than restated here.
 */
function declaredRegistration(namespace: string): {
  component: unknown;
  meta: ComponentMeta;
} {
  const config = ComponentRegistry.getConfig(BARE, namespace);
  expect(config, `nothing is registered as "${namespace}:${BARE}"`).toBeDefined();
  // `type` is the FULL type (`ns:name`); `register` re-derives it from the bare
  // name + namespace, so replaying it would double the prefix.
  const { type: _fullType, component, ...meta } = config!;
  return { component, meta: meta as ComponentMeta };
}

describe('bare "timeline" ownership is declared, not decided by module-evaluation order', () => {
  it('both registrations exist, and exactly one of them claims the bare key', () => {
    const keys = keysForShortName();
    expect(keys).toContain(`${OWNER_NS}:${BARE}`);
    expect(keys).toContain(`${PRESENTATIONAL_NS}:${BARE}`);
    expect(keys).toContain(BARE);

    // A namespaced registration claims the bare fallback unless it declares
    // `skipFallback` — this is `Registry.register`'s own condition.
    const bareClaimants = keys
      .filter((t) => t.includes(':'))
      .filter((t) => !ComponentRegistry.getMeta(t)?.skipFallback);

    expect(
      bareClaimants,
      'exactly one registration of the short name "timeline" may claim the bare key, ' +
        'and it must be the object-bound "view:timeline" — otherwise the winner is ' +
        'decided by module-evaluation order again (objectui#6353)',
    ).toEqual([`${OWNER_NS}:${BARE}`]);
  });

  it('the presentational registration declares skipFallback; the object-bound one does not', () => {
    expect(ComponentRegistry.getMeta(`${PRESENTATIONAL_NS}:${BARE}`)?.skipFallback).toBe(true);
    expect(ComponentRegistry.getMeta(`${OWNER_NS}:${BARE}`)?.skipFallback).toBeFalsy();
  });

  it('resolves bare to the object-bound renderer, and keeps both reachable by namespace', () => {
    expect(ComponentRegistry.get(BARE)).toBe(ObjectTimelineRenderer);
    expect(ComponentRegistry.get(BARE, OWNER_NS)).toBe(ObjectTimelineRenderer);
    // The presentational renderer is not lost — it is namespaced-only now, which
    // is the lookup a presentational host already uses.
    expect(ComponentRegistry.get(BARE, PRESENTATIONAL_NS)).toBe(TimelineRenderer);
  });

  // The pin the card is actually about: a reorder must be unable to swap the
  // renderer. Both orders replay the SAME declared metadata; only the sequence
  // differs. Before the fix, the second row resolved bare `timeline` to
  // `TimelineRenderer` and fired the registry's collision warning.
  const ORDERS: Array<[label: string, order: string[]]> = [
    ['presentational first — what ../index evaluates today', [PRESENTATIONAL_NS, OWNER_NS]],
    ['object-bound first — the reorder that used to swap the renderer', [OWNER_NS, PRESENTATIONAL_NS]],
  ];

  it.each(ORDERS)('resolves the same way in EITHER evaluation order (%s)', (_label, order) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const fresh = new Registry<unknown>();
      for (const namespace of order) {
        const { component, meta } = declaredRegistration(namespace);
        fresh.register(BARE, component, meta);
      }

      expect(
        fresh.get(BARE),
        `registering in the order [${order.join(', ')}] changed who answers bare "${BARE}"`,
      ).toBe(ObjectTimelineRenderer);
      expect(fresh.get(BARE, OWNER_NS)).toBe(ObjectTimelineRenderer);
      expect(fresh.get(BARE, PRESENTATIONAL_NS)).toBe(TimelineRenderer);

      // The registry's collision guard is the mechanism this fix uses, so its
      // silence is part of the contract: a warning here means two registrations
      // are fighting over the bare key again.
      const collided = warn.mock.calls.some(
        (args: unknown[]) => typeof args[0] === 'string' && args[0].includes(COLLISION_WARNING),
      );
      expect(collided, 'the registry warned that the bare-name fallback was overwritten').toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});
