/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12992 — `page:tabs` builds no `visibleWhen` scope of its own. Its
 * gates are decided over the scope `@object-ui/react`'s
 * `buildNodeEvaluationScope` builds, the same function `SchemaRenderer` calls,
 * so a root added there is not silently missing here.
 *
 * Read from source with the comment spans masked, so the prose that explains
 * the scope does not count as a spelling of it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CONTAINERS = path.resolve(here, '../renderers/layout/containers.tsx');
const code = maskComments(readFileSync(CONTAINERS, 'utf8'));

describe('page:tabs visibleWhen scope (objectui#12992)', () => {
  it('imports buildNodeEvaluationScope from @object-ui/react', () => {
    expect(code).toMatch(
      /import\s*\{[^}]*\bbuildNodeEvaluationScope\b[^}]*\}\s*from\s*'@object-ui\/react'/,
    );
  });

  it('calls it for the scope it evaluates', () => {
    expect(code).toMatch(/\bbuildNodeEvaluationScope\s*\(\s*predicateScope\b/);
  });

  it('no longer spells `current_user` itself', () => {
    expect(code).not.toMatch(/\bcurrent_user\b/);
  });
});
