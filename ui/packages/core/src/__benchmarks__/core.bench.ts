/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Performance benchmark suite for @object-ui/core.
 *
 * Part of Q1 2026 roadmap §1.4 Test Coverage Improvement.
 *
 * Run with: npx vitest bench packages/core/src/__benchmarks__/
 */

import { bench, describe } from 'vitest';
// This package's own entry is imported RELATIVELY, not as `@object-ui/core`.
// A package self-import resolves through the published `exports` map to
// `dist/index.d.ts`, and `core:type-check` has no dependency edge on this
// package's own build (turbo gives `type-check` `dependsOn: ["^build"]` — the
// DEPENDENCIES' builds), so on a cold CI cache that artifact does not exist yet
// and the specifier fails with TS2307. That is objectui#4801, and PR #4789 paid
// for it once in `@object-ui/fields`. Here the failure was latent rather than
// live — this file is in the build program, which keeps the root tsconfig's
// `paths` mapping the name back to source — but a specifier that compiles only
// because a path alias happens to cover it is one root-config edit from the
// same TS2307. Mechanised by scripts/check-package-self-import.mjs.
import { ExpressionEvaluator, ComponentRegistry, contrastRatio, meetsContrastLevel, hexToHSL } from '../index.js';

describe('ExpressionEvaluator performance', () => {
  const evaluator = new ExpressionEvaluator({ data: { name: 'Alice', age: 30, active: true } });

  bench('evaluate simple string', () => {
    evaluator.evaluate('Hello ${data.name}');
  });

  bench('evaluate 100 expressions', () => {
    for (let i = 0; i < 100; i++) {
      evaluator.evaluate('Hello ${data.name}');
    }
  });
});

describe('ComponentRegistry performance', () => {
  bench('get registered component', () => {
    ComponentRegistry.get('button');
  });

  bench('has check', () => {
    ComponentRegistry.has('button');
  });
});

describe('Theme utilities performance', () => {
  bench('hexToHSL conversion', () => {
    hexToHSL('#336699');
  });

  bench('contrastRatio calculation', () => {
    contrastRatio('#000000', '#ffffff');
  });

  bench('meetsContrastLevel check', () => {
    meetsContrastLevel('#000000', '#ffffff', 'AA');
  });

  bench('100 contrast checks', () => {
    for (let i = 0; i < 100; i++) {
      meetsContrastLevel('#336699', '#ffffff', 'AA');
    }
  });
});
