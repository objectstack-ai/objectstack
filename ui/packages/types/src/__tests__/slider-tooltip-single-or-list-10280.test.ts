/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10280 — objectui#7759 group B, the SINGLE-OR-LIST keys, resolved by
 * their read sites.
 *
 * None of the three keys is declared by `@objectstack/spec` (no `SliderSchema` /
 * `TooltipSchema` component node there), so the director's rule for an
 * objectui-own key applies: the read site is the truth, and the zod mirror and
 * the TypeScript declaration follow it. The predicate (proposal B1): a mirror may
 * spell a single-or-list union only where the read site normalizes the scalar.
 *
 *   - `SliderSchema.defaultValue` — the renderer wraps a scalar into a list on
 *     purpose, so the DECLARATION widens to `number | number[]`.
 *   - `SliderSchema.value` — no read site at all, so the key is RETIRED on both
 *     faces (ADR-0049, a named refusal rather than a deletion: `BaseSchema` is
 *     `.passthrough()`, and an undeclared key would be KEPT, not refused).
 *   - `TooltipSchema.content` — placed RAW in a React child position, so a list
 *     failed to render; the MIRROR narrows to the declaration. (objectui#10295
 *     then narrowed BOTH faces to text, for the same reason on the node arm.)
 *
 * Each block below reddens when its change is reverted. The type-level legs are
 * read by `tsc -p tsconfig.test.json` (this package's `type-check`), the runtime
 * legs by vitest.
 */

import { describe, expect, it } from 'vitest';

import type { SliderSchema } from '../form';
import type { TooltipSchema } from '../overlay';
import { SliderSchema as SliderZod } from '../zod/form.zod.js';
import { TooltipSchema as TooltipZod } from '../zod/overlay.zod.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

const issuesAt = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; code: string; message: string }[] } }, key: string) =>
  (result.success ? [] : result.error?.issues ?? []).filter((issue) => issue.path.join('.') === key);

/* ────────────────────────────────────────────────────────────────────────────
 * SliderSchema.defaultValue — the DECLARATION widened to what the renderer reads
 * ───────────────────────────────────────────────────────────────────────── */

export type _SliderDefaultValueIsSingleOrList =
  Expect< Equal< SliderSchema['defaultValue'], number | number[] | undefined > >;

describe('objectui#10280 — `SliderSchema.defaultValue` is single-or-list on both faces', () => {
  it('the declaration accepts a scalar and a list', () => {
    // Reverting the declaration to `number[]` makes the first line a `tsc` error.
    const scalar: SliderSchema = { type: 'slider', defaultValue: 30 };
    const list: SliderSchema = { type: 'slider', defaultValue: [20, 80] };

    expect(scalar.defaultValue).toBe(30);
    expect(list.defaultValue).toEqual([20, 80]);
  });

  it('the mirror accepts the same two spellings, and refuses a non-number', () => {
    expect(SliderZod.safeParse({ type: 'slider', defaultValue: 30 }).success).toBe(true);
    expect(SliderZod.safeParse({ type: 'slider', defaultValue: [20, 80] }).success).toBe(true);
    // Control: the slot is not open — the union still judges its value.
    expect(SliderZod.safeParse({ type: 'slider', defaultValue: 'thirty' }).success).toBe(false);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * SliderSchema.value — RETIRED on both faces
 * ───────────────────────────────────────────────────────────────────────── */

describe('objectui#10280 — `SliderSchema.value` is a named refusal', () => {
  it.each([
    ['a list', [40]],
    ['a scalar', 40],
  ] as const)('refuses %s at `value`, with the tombstone code and guidance', (_label, value) => {
    const result = SliderZod.safeParse({ type: 'slider', defaultValue: [10], value });
    const [issue] = issuesAt(result, 'value');

    expect(result.success).toBe(false);
    expect(issue?.code).toBe('invalid_type');
    // The message names the retirement and the working spelling; zod's own
    // `never` message says neither.
    expect(issue?.message.startsWith('REFUSED (objectui#10280, ADR-0049)')).toBe(true);
    expect(issue?.message).toContain('Author `defaultValue`');
  });

  it('`value` stays DECLARED, so the refusal is by name rather than a silent keep', () => {
    expect(Object.keys(SliderZod.shape)).toContain('value');
  });

  it('POSITIVE CONTROL — the same node without `value` parses green', () => {
    expect(SliderZod.safeParse({ type: 'slider', defaultValue: [10], min: 0, max: 100, step: 5 }).success).toBe(true);
  });

  it('the TypeScript twin refuses `value` too', () => {
    // @ts-expect-error objectui#10280 — `value` is a `?: never` tombstone
    const refused: SliderSchema = { type: 'slider', value: [40] };
    const accepted: SliderSchema = { type: 'slider', defaultValue: [40] };

    expect(refused.type).toBe('slider');
    expect(accepted.defaultValue).toEqual([40]);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * TooltipSchema.content — the MIRROR narrowed to the declaration
 * ───────────────────────────────────────────────────────────────────────── */

describe('objectui#10280 — `TooltipSchema.content` refuses a list', () => {
  const NODE = { type: 'text', content: 'A' } as const;

  it('refuses a list at `content`', () => {
    // The renderer places `schema.content` raw in a React child position, so a
    // list of nodes reached React as objects and the tooltip failed to render.
    const result = TooltipZod.safeParse({ type: 'tooltip', content: [NODE, NODE] });

    expect(result.success).toBe(false);
    expect(issuesAt(result, 'content').length).toBeGreaterThan(0);
  });

  it('still accepts the text arm', () => {
    // objectui#10295 narrowed `content` further, to text: the single-node arm this
    // block used to accept failed at the same raw read. That refusal is pinned in
    // `tooltip-content-is-text-10295.test.ts`.
    expect(TooltipZod.safeParse({ type: 'tooltip', content: 'Helpful information' }).success).toBe(true);
  });

  it('the list spelling is still legal where the renderer renders one — under `children`', () => {
    expect(TooltipZod.safeParse({ type: 'tooltip', children: [NODE, NODE] }).success).toBe(true);
  });

  it('the declaration refuses the list too', () => {
    // @ts-expect-error objectui#10280 — `content` is text (objectui#10295), not a list
    const refused: TooltipSchema = { type: 'tooltip', content: [NODE] };
    const accepted: TooltipSchema = { type: 'tooltip', content: 'x' };

    expect(refused.type).toBe('tooltip');
    expect(accepted.content).toBe('x');
  });
});
