/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Palette-offered page blocks render in EVERY host (#2943).
 *
 * Placeholder registration was entirely opt-in (`registerPlaceholders()`), and
 * only `apps/console` calls it. So `nav:menu`, `nav:breadcrumb`,
 * `global:search` and `ai:suggestion` — blocks the Studio palette offers —
 * rendered `SchemaRenderer`'s red `role="alert"` panel in every other host,
 * dumping the page JSON, purely because that host skipped an optional
 * bootstrap.
 *
 * These four now register eagerly through the `./renderers` barrel. The rest of
 * the protocol vocabulary stays opt-in on purpose: a genuinely missing renderer
 * must keep failing loudly so the misconfiguration gets fixed at the source.
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom';
import { ComponentRegistry } from '@object-ui/core';
import { PALETTE_PLACEHOLDER_BLOCKS } from '../renderers/placeholders';

// Import the barrel ONLY — never `registerPlaceholders()`, which is what this
// test exists to prove is not required for these blocks. At module scope, NOT
// inside a `beforeAll` — there the cold transform is billed to `hookTimeout`,
// which is why this carried a raised timeout. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';

describe('palette-offered blocks render without the optional bootstrap', () => {
  it('declares a non-empty eager set', () => {
    expect(PALETTE_PLACEHOLDER_BLOCKS.length).toBeGreaterThan(0);
  });

  it.each(PALETTE_PLACEHOLDER_BLOCKS)('%s resolves to a renderer', (type) => {
    expect(
      ComponentRegistry.get(type),
      `${type} is offered by the Studio palette — it must not red-box in a host that skips registerPlaceholders()`,
    ).toBeTruthy();
  });

  it('keeps the rest of the protocol vocabulary opt-in (loud by design)', () => {
    // A sample of PROTOCOL_COMPONENTS members outside the eager set: these are
    // NOT palette blocks, and a page referencing one is a misconfiguration that
    // should stay loud.
    for (const type of ['view:kanban', 'widget:heatmap', 'field:duration']) {
      expect(
        ComponentRegistry.get(type),
        `${type} must stay opt-in — auto-registering it would mask a missing renderer`,
      ).toBeFalsy();
    }
  });

  it('ai:chat_window stays unregistered — the exclusion is deliberate', () => {
    // The floating chat overlay (plugin-chatbot) is canonical; #2943 pruned the
    // palette entry rather than adding a placeholder for it.
    expect(ComponentRegistry.get('ai:chat_window')).toBeFalsy();
  });
});
