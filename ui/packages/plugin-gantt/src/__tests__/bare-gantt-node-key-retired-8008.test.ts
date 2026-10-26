/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The bare `gantt` NODE TYPE key is retired; `object-gantt` is the one spelling
 * this plugin serves (objectui#8008, maintainer ruling 2026-09-09, route 3).
 *
 * ## ⚠️ Why this is a plain unregistration and not a named refusal
 *
 * `BaseSchema` is `.passthrough()`, so a dropped MEMBER key is KEPT, not
 * refused, and a retirement that forgets it ships a document that validates
 * green and renders nothing (objectui#7664). That hazard needs a schema face to
 * arise on. This key never had one: `@object-ui/types` declares `gantt` as a
 * component node type ZERO times — `ObjectGanttSchema.type` is the literal
 * `'object-gantt'` and nothing else names the bare spelling. ⇒ Unregistering IS
 * the retirement here, which is exactly what separates this card from its
 * `kanban` sibling (objectui#8802), where an arm DID exist and therefore got a
 * named refusal.
 *
 * ## ⛔ The layer this does not touch
 *
 * `gantt` also names a STORED `NamedListView.type`. `plugin-view`'s `ObjectView`
 * maps a stored `gantt` view onto the node type `object-gantt` already, so no
 * saved view moves. That layer is pinned in `@object-ui/types`
 * (`__tests__/bare-kanban-node-key-retired-8802.test.ts`, which guards BOTH
 * spellings) and deliberately not restated here — this package cannot see it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComponentRegistry } from '@object-ui/core';
import '../index';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

const INDEX_TSX = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.tsx');

describe('the bare `gantt` node type key is retired (objectui#8008)', () => {
  it('`gantt` resolves to nothing, under the bare AND the namespaced spelling', () => {
    // `register(key, C, { namespace })` stores BOTH, so checking one spelling
    // would leave the other resolving.
    expect(ComponentRegistry.has('gantt')).toBe(false);
    expect(ComponentRegistry.getConfig('gantt', 'view')).toBeFalsy();
  });

  it('FIRING CONTROL — `object-gantt` still resolves, so the `false` above is a reading', () => {
    // Without this the assertion above would also pass against a registry that
    // had failed to load this package at all.
    expect(ComponentRegistry.has('object-gantt')).toBe(true);
    expect(ComponentRegistry.getConfig('object-gantt', 'plugin-gantt')).toBeTruthy();
  });

  it('the source registers ONE key, measured off disk rather than through the registry', () => {
    // The registry answer above is about this process; this one is about the
    // file, so a registration added in a form the registry happens not to reach
    // still shows up.
    // ⚠️ Comments are STRIPPED first, and that is load-bearing rather than
    // tidy: the retirement left a tombstone docblock that quotes the removed
    // `ComponentRegistry.register('gantt', …)` call verbatim, so a raw scan
    // reads the retired key back out of the prose that records its removal.
    // Measured — this exact leg failed that way on its first run.
    const src = mask(readFileSync(INDEX_TSX, 'utf8'));
    const keys = [...src.matchAll(/ComponentRegistry\.register\(\s*'([^']+)'/g)].map((m) => m[1]);
    // Anti-vacuity for the extraction: a regex that matched nothing would make
    // the equality below hold forever.
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toEqual(['object-gantt']);
    // And the stripper is not eating the code: the surviving registration's own
    // renderer name survives the strip.
    expect(src).toContain('ObjectGanttRenderer');
  });
});
