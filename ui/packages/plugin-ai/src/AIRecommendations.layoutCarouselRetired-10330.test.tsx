/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `carousel` is retired from `AIRecommendationsSchema.layout` and from the
 * `ai-recommendations` designer enum (objectui#10330, ADR-0049
 * enforce-or-remove).
 *
 * The value was declared on the type and offered in the designer, but
 * `AIRecommendations` renders only `grid` specially: an author who picked
 * `carousel` stored a value the renderer never honoured and got a list with no
 * diagnostic. It was never implemented, so it is removed rather than enforced.
 *
 * Two pins:
 *
 * 1. The designer enum and the type union AGREE, in both directions. The
 *    union side is checked by the compiler (`tsconfig.test.json` compiles this
 *    file), the enum side at runtime against the live registration. A value
 *    added to one and not the other turns this red.
 * 2. A node that still STORES `layout: 'carousel'` does not crash: it falls
 *    through to the list layout, the same as before the retirement. `grid` is
 *    the control that the instrument can tell the two layouts apart.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import type { AIRecommendationItem, AIRecommendationsSchema } from '@object-ui/types';
import { AIRecommendations } from './AIRecommendations';
import './index';

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type Layout = NonNullable<AIRecommendationsSchema['layout']>;

/**
 * Every value of the `layout` union, spelled once. `satisfies` refuses a value
 * the union does not declare; the `Equal` below refuses a union member missing
 * from this list. Together they make this tuple the union, checked by `tsc`.
 */
const LAYOUTS = ['list', 'grid'] as const satisfies readonly Layout[];

export type assertionLayoutsTupleIsTheWholeUnion = [
  Expect<Equal<(typeof LAYOUTS)[number], Layout>>,
];

const layoutEnumValues = (): unknown[] => {
  const input = ComponentRegistry.getMeta('ai-recommendations')?.inputs?.find(
    (entry) => entry.name === 'layout',
  );
  return (input?.enum ?? []).map((option) =>
    typeof option === 'object' && option !== null ? (option as { value: unknown }).value : option,
  );
};

const items: AIRecommendationItem[] = [
  { id: 'rec-1', title: 'Recommendation 1', score: 0.9 },
  { id: 'rec-2', title: 'Recommendation 2', score: 0.5 },
  { id: 'rec-3', title: 'Recommendation 3', score: 0.2 },
];

afterEach(() => cleanup());

describe('the `ai-recommendations` designer enum agrees with `AIRecommendationsSchema.layout`', () => {
  it('offers exactly the values the type union declares', () => {
    const offered = layoutEnumValues();
    // Lit control first: an empty enum would satisfy the absence check below
    // for the wrong reason.
    expect(offered.length, 'the `layout` input has no enum at all').toBeGreaterThan(0);
    expect([...offered].sort()).toEqual([...LAYOUTS].sort());
  });

  it('no longer offers `carousel`', () => {
    expect(layoutEnumValues()).not.toContain('carousel');
  });
});

describe('a stored `layout: \'carousel\'` still renders', () => {
  const renderWith = (layout: unknown) => {
    // `as never`: the value is outside the union now, which is the point — this
    // is metadata stored before the retirement, not something a caller can type.
    const schema = { type: 'ai-recommendations', recommendations: items, layout } as never;
    return render(<AIRecommendations schema={schema} />);
  };

  it('does not crash and falls through to the list layout', () => {
    const { container } = renderWith('carousel');
    expect(screen.getAllByText(/^Recommendation \d$/)).toHaveLength(items.length);
    expect(container.querySelector('.grid'), 'carousel rendered the grid layout').toBeNull();
  });

  it('renders the same DOM as an explicit `list`', () => {
    const carousel = renderWith('carousel').container.innerHTML;
    cleanup();
    const list = renderWith('list').container.innerHTML;
    expect(carousel).toBe(list);
  });

  it('CONTROL — the same instrument sees the grid layout when it is asked for', () => {
    const { container } = renderWith('grid');
    expect(screen.getAllByText(/^Recommendation \d$/)).toHaveLength(items.length);
    expect(container.querySelector('.grid')).not.toBeNull();
  });
});
