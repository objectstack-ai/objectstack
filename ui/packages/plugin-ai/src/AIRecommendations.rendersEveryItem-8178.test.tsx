/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `AIRecommendations` renders EVERY item it is handed, in both layouts, and its
 * docblock says so (objectui#8178, ADR-0049, director decision batch #78).
 *
 * ## The promise this replaces
 *
 * `AIRecommendationsSchema.maxResults` was documented as *"Maximum number of
 * results to display"*, offered as a designer input, and read by nothing: a
 * node carrying `maxResults: 5` against a fifty-item list rendered fifty rows
 * with no diagnostic. The ruling retired the key rather than implementing the
 * slice — nothing pulled on it — and required the component to STATE what it
 * does instead of promising a cap it never honoured.
 *
 * Both halves are owed, because either alone rots. This file is the
 * behavioural half — fifty items in, fifty rendered. The documentary half (the
 * docblock says so, and no cap survives in the code) reads the component source
 * off disk, which needs the node project, so it lives in
 * `registrationInputs-8178.test.ts`. A contributor who implements a cap breaks
 * this file; one who deletes the sentence breaks that one.
 *
 * The count is fifty on purpose: it is the finding's own example, and it is
 * comfortably past any plausible default cap someone might reintroduce.
 */

import { describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { AIRecommendationItem, AIRecommendationsSchema } from '@object-ui/types';
import { AIRecommendations } from './AIRecommendations';

const ITEM_COUNT = 50;

const items: AIRecommendationItem[] = Array.from({ length: ITEM_COUNT }, (_, i) => ({
  id: `rec-${i + 1}`,
  title: `Recommendation ${i + 1}`,
  score: 0.5,
}));

describe.each(['list', 'grid'] as const)(
  'every item reaches the DOM in the `%s` layout',
  (layout) => {
    it(`renders all ${ITEM_COUNT} titles`, () => {
      const schema: AIRecommendationsSchema = {
        type: 'ai-recommendations',
        recommendations: items,
        layout,
      };
      render(<AIRecommendations schema={schema} />);
      expect(screen.getAllByText(/^Recommendation \d+$/)).toHaveLength(ITEM_COUNT);
      // The first and the last, by name: a length check alone would pass on a
      // component that rendered the same item fifty times.
      expect(screen.getByText('Recommendation 1')).toBeTruthy();
      expect(screen.getByText(`Recommendation ${ITEM_COUNT}`)).toBeTruthy();
      cleanup();
    });

    it('reports that same count in the header badge', () => {
      const schema: AIRecommendationsSchema = {
        type: 'ai-recommendations',
        recommendations: items,
        layout,
      };
      render(<AIRecommendations schema={schema} />);
      expect(screen.getByText(String(ITEM_COUNT))).toBeTruthy();
      cleanup();
    });
  },
);

describe('the control — the instrument counts what is rendered, not a constant', () => {
  it('renders three when handed three', () => {
    const schema: AIRecommendationsSchema = {
      type: 'ai-recommendations',
      recommendations: items.slice(0, 3),
    };
    render(<AIRecommendations schema={schema} />);
    expect(screen.getAllByText(/^Recommendation \d+$/)).toHaveLength(3);
    cleanup();
  });

  it('renders the empty message when handed none', () => {
    const schema: AIRecommendationsSchema = {
      type: 'ai-recommendations',
      recommendations: [],
      emptyMessage: 'Nothing yet',
    };
    render(<AIRecommendations schema={schema} />);
    expect(screen.getByText('Nothing yet')).toBeTruthy();
    expect(screen.queryAllByText(/^Recommendation \d+$/)).toHaveLength(0);
    cleanup();
  });
});
