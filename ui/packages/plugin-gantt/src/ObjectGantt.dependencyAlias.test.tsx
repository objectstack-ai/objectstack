/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Behaviour pin — deprecating `dependencyField` changed NOTHING at the read site
 * (objectui#6470).
 *
 * ## What this file is for
 *
 * objectui#6470 marks the singular `dependencyField` `@deprecated` on both
 * published declaration faces (`packages/types/src/objectql.ts` and its zod
 * mirror), naming the spec's `dependenciesField` as canonical. The marker is
 * documentation; `getGanttConfig`'s flat branch still reads
 * `dependenciesField || dependencyField` and every author who wrote the singular
 * must keep rendering exactly as before.
 *
 * ⛔ Removal was explicitly excluded from that card and deferred to a future
 * enforce-or-remove decision. This suite is what makes the exclusion mechanical:
 * drop the `|| schema.dependencyField` limb and the first two cases below go red
 * naming the break, rather than a published surface silently losing an accepted
 * spelling.
 *
 * ## Why the two spellings name DIFFERENT record fields here
 *
 * A fixture where both spellings point at the same field can only prove that
 * SOMETHING resolved; it cannot show WHICH limb of the `||` produced it, so it
 * would stay green with either limb deleted. Pointing them at different fields
 * (`legacy_preds` vs `canonical_preds`, with values that cannot be confused)
 * makes the resolved config visible in the rendered tasks — the same technique
 * `ObjectGantt.blockPrecedence.test.tsx` uses for the block/flat flip.
 *
 * The "same config" half the card asks for is then pinned directly, by the
 * third case: the two spellings aimed at ONE field produce byte-identical task
 * dependencies.
 *
 * ## The observable
 *
 * `dependenciesField` is not passed to `GanttView` as a config value — it is
 * consumed on the way in (`dependencies: normalizeDependencies(record[dep])`)
 * and again as the `autoSchedule` / `onDependencyCreate` switches. Both are
 * observed: the per-task dependency ids say WHICH field was read, and
 * `autoSchedule` says the config resolved to a truthy field name at all.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ObjectGantt } from './ObjectGantt';

vi.mock('./GanttView', () => ({
  GanttView: ({ tasks, autoSchedule }: any) => (
    <div
      data-testid="gantt-view"
      data-count={tasks.length}
      data-deps={tasks.map((t: any) => t.dependencies.join('+')).join('|')}
      data-autoschedule={String(!!autoSchedule)}
    />
  ),
}));

vi.mock('./ResourceWorkload', () => ({
  ResourceWorkload: ({ tasks }: any) => <div data-testid="resource-workload" data-count={tasks.length} />,
}));

/**
 * One record carrying BOTH candidate fields, with values that cannot be
 * confused: the legacy field's ids start `L`, the canonical field's start `C`.
 */
const INLINE = [
  {
    id: '1',
    name: 'Alpha',
    start: '2024-01-01',
    end: '2024-01-05',
    legacy_preds: 'L1,L2',
    canonical_preds: 'C1,C2',
    shared_preds: 'S1,S2',
  },
];

const DATES = { startDateField: 'start', endDateField: 'end', titleField: 'name' };

async function rendered(extra: Record<string, unknown>, objectName: string) {
  const { container } = render(
    <ObjectGantt
      schema={
        {
          type: 'object-gantt',
          objectName,
          ...DATES,
          data: { provider: 'value', items: INLINE },
          ...extra,
        } as any
      }
    />,
  );
  const el = () => container.querySelector('[data-testid="gantt-view"]') as HTMLElement;
  await waitFor(() => expect(el()?.getAttribute('data-count')).toBe('1'));
  return {
    deps: el().getAttribute('data-deps'),
    autoSchedule: el().getAttribute('data-autoschedule'),
  };
}

describe('both dependency spellings still resolve to the same config (objectui#6470)', () => {
  it('the DEPRECATED singular is still read', async () => {
    // ⛔ The removal guard. Deleting `|| schema.dependencyField` from
    // `getGanttConfig` turns this red — every author who wrote the singular
    // loses their dependency links, and `autoSchedule` silently switches off
    // with them.
    const { deps, autoSchedule } = await rendered(
      { dependencyField: 'legacy_preds' },
      'alias_singular',
    );
    expect(deps).toBe('L1+L2');
    expect(autoSchedule).toBe('true');
  });

  it('the CANONICAL plural is read', async () => {
    // The counter-probe: the assertion above must be about the singular limb,
    // not about dependencies working at all.
    const { deps, autoSchedule } = await rendered(
      { dependenciesField: 'canonical_preds' },
      'alias_plural',
    );
    expect(deps).toBe('C1+C2');
    expect(autoSchedule).toBe('true');
  });

  it('aimed at ONE field, the two spellings produce an identical result', async () => {
    // The card's acceptance criterion, stated directly: the deprecation is a
    // marker, so the singular and the plural are interchangeable at the read
    // site. Compared value-to-value rather than each against a literal, so this
    // stays true however `normalizeDependencies` evolves.
    const viaLegacy = await rendered({ dependencyField: 'shared_preds' }, 'alias_same_a');
    const viaCanonical = await rendered({ dependenciesField: 'shared_preds' }, 'alias_same_b');
    expect(viaLegacy).toEqual(viaCanonical);
    expect(viaLegacy.deps).toBe('S1+S2');
  });

  it('the canonical spelling WINS when a node carries both', async () => {
    // Precedence, and the reason the deprecation marker is truthful: an author
    // migrating key-by-key gets the canonical value, not a merge and not the
    // legacy one.
    const { deps } = await rendered(
      { dependenciesField: 'canonical_preds', dependencyField: 'legacy_preds' },
      'alias_both',
    );
    expect(deps).toBe('C1+C2');
  });

  it('an EMPTY canonical value falls through to the alias — a property of `||`', async () => {
    // Recorded, not designed. `dependenciesField: ''` is falsy, so the `||`
    // reaches the singular; `??` would not. Pinned so that a future rewrite of
    // that expression is a decision rather than an accident — and so the
    // enforce-or-remove card inherits the real accept semantics instead of
    // re-deriving them.
    const { deps } = await rendered(
      { dependenciesField: '', dependencyField: 'legacy_preds' },
      'alias_empty_canonical',
    );
    expect(deps).toBe('L1+L2');
  });

  it('neither spelling authored: no dependencies, and auto-scheduling stays OFF', async () => {
    // Non-vacuity for every case above — without this, a harness that always
    // reported the same string would pass them all.
    const { deps, autoSchedule } = await rendered({}, 'alias_none');
    expect(deps).toBe('');
    expect(autoSchedule).toBe('false');
  });
});
