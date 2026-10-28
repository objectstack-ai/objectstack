/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Behaviour pin — the deprecated singular `dependencyField` is READ NOWHERE
 * since objectstack#25923.
 *
 * ## History
 *
 * objectui#6470 marked the singular `@deprecated` on both published declaration
 * faces, naming the spec's `dependenciesField` as canonical, and this suite
 * pinned that `getGanttConfig`'s flat branch still read
 * `dependenciesField || dependencyField`, so removal would be a decision rather
 * than an accident. objectstack#25923 took that decision: the singular left the
 * published faces first, then the flat fallback branch retired, and the alias
 * limb with it. The spec never had the singular (`GanttConfigSchema` declares
 * `dependenciesField` only), so the one spelling left is the plural, inside the
 * `gantt` block.
 *
 * ## Why the spellings name DIFFERENT record fields here
 *
 * The legacy field's ids start `L`, the canonical field's start `C`, so the
 * rendered tasks say WHICH field was read, and `autoSchedule` says whether the
 * config resolved to a dependency field at all.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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
 * One record carrying both candidate fields, with values that cannot be
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
  },
];

const DATES = { startDateField: 'start', endDateField: 'end', titleField: 'name' };

/** `gantt` adds members to the node's `gantt` block; `flat` lands on the node itself. */
async function rendered(gantt: Record<string, unknown>, flat: Record<string, unknown>, objectName: string) {
  const { container } = render(
    <ObjectGantt
      schema={
        {
          type: 'object-gantt',
          objectName,
          gantt: { ...DATES, ...gantt },
          data: { provider: 'value', items: INLINE },
          ...flat,
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

describe('the dependency binding has one spelling: `gantt.dependenciesField` (objectstack#25923)', () => {
  it('the CANONICAL plural in the block is read', async () => {
    const { deps, autoSchedule } = await rendered({ dependenciesField: 'canonical_preds' }, {}, 'alias_plural');
    expect(deps).toBe('C1+C2');
    expect(autoSchedule).toBe('true');
  });

  it('the DEPRECATED singular written flat beside the block is not read', async () => {
    const { deps, autoSchedule } = await rendered({}, { dependencyField: 'legacy_preds' }, 'alias_singular_flat');
    expect(deps).toBe('');
    expect(autoSchedule).toBe('false');
  });

  it('the canonical spelling is the one read when a node carries both', async () => {
    const { deps } = await rendered(
      { dependenciesField: 'canonical_preds' },
      { dependencyField: 'legacy_preds' },
      'alias_both',
    );
    expect(deps).toBe('C1+C2');
  });

  it('the singular INSIDE the block is refused, never drawn', async () => {
    // `GanttConfigSchema` is closed (objectstack#15469) and has no singular, so
    // the block fails its parse and reaches the refusal screen.
    render(
      <ObjectGantt
        schema={
          {
            type: 'object-gantt',
            objectName: 'alias_singular_block',
            gantt: { ...DATES, dependencyField: 'legacy_preds' },
            data: { provider: 'value', items: INLINE },
          } as any
        }
      />,
    );
    await waitFor(() => expect(screen.getByTestId('gantt-invalid-config')).toBeTruthy());
    expect(screen.getByTestId('gantt-invalid-config').textContent).toContain('dependencyField');
    expect(screen.queryByTestId('gantt-view')).toBeNull();
  });

  it('neither spelling authored: no dependencies, and auto-scheduling stays OFF', async () => {
    // Non-vacuity for the absence rows above — without this, a harness that
    // always reported the same string would pass them.
    const { deps, autoSchedule } = await rendered({}, {}, 'alias_none');
    expect(deps).toBe('');
    expect(autoSchedule).toBe('false');
  });
});
