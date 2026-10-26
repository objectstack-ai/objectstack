/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6654 — `DiscoveryInfo` no longer declares the retired preview wire.
 *
 * `@objectstack/spec` retired the `RuntimeMode` value `'preview'` and the
 * `PreviewModeConfig` block (objectstack#11846). The behaviour that consumed
 * them is pinned where it lives, in
 * `packages/app-shell/src/chrome/ConditionalAuthWrapper.previewRetired-6654.test.tsx`.
 * This file pins the DECLARATION half: the keys are gone from the published
 * type.
 *
 * ## Why this reads source text instead of asserting a type error
 *
 * `DiscoveryInfo` ends in `[key: string]: any`, so `discovery.previewMode`
 * still type-checks whether or not the property is declared — a
 * `@ts-expect-error` pin here could never fail, which is exactly the shape that
 * reads as coverage while measuring nothing. The declaration itself is
 * therefore what gets asserted, scoped to the one file that carries it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.resolve(here, '../useDiscovery.ts'), 'utf8');

describe('DiscoveryInfo — the retired preview wire (objectui#6654)', () => {
  it('declares no previewMode block', () => {
    expect(source).not.toMatch(/previewMode/);
  });

  it('does not document the retired preview runtime mode', () => {
    expect(source).not.toMatch(/'preview'/);
  });
});
