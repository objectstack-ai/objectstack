/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Example: the pie, donut and radar chart families
 *
 * Each example is the generic `chart` node with `chartType` naming the family,
 * the spelling that draws (objectui#8760). Until objectui#10859 batch 8 (phase
 * 2c) they authored the `pie-chart` / `donut-chart` / `radar-chart` keys, which
 * that phase retired once these examples, their last producer, had moved.
 * `__tests__/chart-family-from-type-7401.test.tsx` renders each one and asserts
 * it draws its family and no bar (objectui#7401, ruling item 3).
 */

export const pieChartExample = {
  type: 'chart',
  chartType: 'pie',
  data: [
    { name: 'Chrome', value: 65 },
    { name: 'Firefox', value: 20 },
    { name: 'Safari', value: 10 },
    { name: 'Edge', value: 5 },
  ],
  xAxisKey: 'name',
  series: [{ dataKey: 'value' }],
  config: {
    Chrome: { label: 'Chrome', color: 'hsl(var(--chart-1))' },
    Firefox: { label: 'Firefox', color: 'hsl(var(--chart-2))' },
    Safari: { label: 'Safari', color: 'hsl(var(--chart-3))' },
    Edge: { label: 'Edge', color: 'hsl(var(--chart-4))' },
  }
};

export const donutChartExample = {
  type: 'chart',
  chartType: 'donut',
  data: [
    { category: 'Electronics', revenue: 45000 },
    { category: 'Clothing', revenue: 32000 },
    { category: 'Food', revenue: 28000 },
    { category: 'Books', revenue: 15000 },
  ],
  xAxisKey: 'category',
  series: [{ dataKey: 'revenue' }]
};

export const radarChartExample = {
  type: 'chart',
  chartType: 'radar',
  data: [
    { skill: 'React', score: 90 },
    { skill: 'TypeScript', score: 85 },
    { skill: 'Node.js', score: 80 }
  ],
  xAxisKey: 'skill',
  series: [{ dataKey: 'score' }]
};
