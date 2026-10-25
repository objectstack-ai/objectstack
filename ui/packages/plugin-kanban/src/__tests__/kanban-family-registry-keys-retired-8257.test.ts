/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The kanban family converged on ONE registered node type key (objectui#8257
 * for `kanban-ui` / `kanban-enhanced`, objectui#8802 for the bare `kanban` —
 * both maintainer rulings, 2026-09-09).
 *
 * ## Why the three retirements are pinned in ONE file
 *
 * They are one convergence, not three coincidences, and the claim that matters
 * is about the SET: exactly one key resolves. A file per key would let the set
 * grow back a member without any single file going red.
 *
 * ## The two mechanisms, kept apart on purpose
 *
 * ⚠️ `kanban-ui` and `kanban-enhanced` were REGISTRATION-ONLY: measured
 * whole-repo, no schema face in `@object-ui/types` ever declared either name as
 * a component node type, so unregistering IS the whole retirement. The bare
 * `kanban` key DID have a declared arm, so its retirement needed a NAMED
 * REFUSAL as well — that half lives in `@object-ui/types`
 * (`__tests__/bare-kanban-node-key-retired-8802.test.ts`) and is deliberately
 * not restated here.
 *
 * ⛔ Do not "simplify" this file by asserting the refusal here too: this
 * package cannot see the union the CLI applies, and a second copy of the claim
 * is a second thing to keep true.
 *
 * ## ⭐ objectui#8818 — what retiring `kanban-ui` closed, and what closed the rest
 *
 * `SchemaRenderer` strips a fixed enumerated metadata list and spreads the rest
 * as React props. When `kanban-ui` was retired `objectFields` was not on that
 * list, and `KanbanRenderer` — the component `kanban-ui` resolved to — declares
 * `objectFields` as a real prop (objectui#7742). An AUTHORED `objectFields`
 * therefore reached the predicate layer on that entry with no schema face
 * declaring or judging it. With the registration gone no authored node can
 * reach `KanbanRenderer` through the registry at all, which closed that ENTRY.
 *
 * The CLASS is closed at the boundary: since objectui#8818 `objectFields` is on
 * `SchemaRenderer`'s stripped-metadata list, and the legacy `props` alias bag
 * drops it too, so an authored value reaches no component prop on any type
 * key. That half is pinned in `@object-ui/react`
 * (`SchemaRenderer.objectFieldsStrip-8818.test.tsx`) and ⛔ not restated here.
 * Suite 3 pins this package's two halves: the entry stays closed, and
 * `KanbanRenderer` keeps the prop its host passes the catalogue through.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ComponentRegistry } from '@object-ui/core';
import { KanbanRenderer, kanbanComponents } from './../index';
import './../index';

const INDEX_TSX = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.tsx');

/** The three retired keys, and the one that survives. */
const RETIRED_KEYS = ['kanban', 'kanban-ui', 'kanban-enhanced'] as const;
const SURVIVOR = 'object-kanban';

describe('suite 1 — exactly one kanban node type key resolves', () => {
  it.each(RETIRED_KEYS)('`%s` is NOT registered, under its bare spelling', (key) => {
    expect(ComponentRegistry.has(key)).toBe(false);
  });

  it('`view:kanban` and `plugin-kanban:kanban-ui` — the namespaced spellings — are gone too', () => {
    // `register(key, C, { namespace })` stores BOTH the namespaced key and a
    // bare fallback, so a retirement that only removed one spelling would leave
    // the other resolving. Measured through `getConfig`, which takes the
    // namespace explicitly.
    expect(ComponentRegistry.getConfig('kanban', 'view')).toBeFalsy();
    expect(ComponentRegistry.getConfig('kanban-ui', 'plugin-kanban')).toBeFalsy();
    expect(ComponentRegistry.getConfig('kanban-enhanced', 'plugin-kanban')).toBeFalsy();
  });

  it('FIRING CONTROL — the survivor still resolves under both of its spellings', () => {
    // Without this every assertion above would also pass against a registry
    // that had failed to load this package at all.
    expect(ComponentRegistry.has(SURVIVOR)).toBe(true);
    expect(ComponentRegistry.getConfig(SURVIVOR, 'plugin-kanban')).toBeTruthy();
  });
});

describe('suite 2 — the manual-integration map publishes the same one key', () => {
  it('`kanbanComponents` names only the survivor', () => {
    // A host that mounted the map's keys into its own registry would otherwise
    // re-teach the retired spellings under a name this package still publishes.
    expect(Object.keys(kanbanComponents)).toEqual([SURVIVOR]);
  });
});

describe('suite 3 — objectui#8818: the `objectFields` ENTRY is closed, and the prop stays the host channel', () => {
  it('no registry key resolves to `KanbanRenderer` any more — the authored-`objectFields` path is gone', () => {
    // `KanbanRenderer` is still exported and still rendered (by `ObjectKanban`,
    // which supplies `objectFields` itself as a prop). What is gone is any way
    // for an AUTHOR to reach it: nothing in the registry resolves to it.
    const src = readFileSync(INDEX_TSX, 'utf8');
    const registeredComponents = [
      ...src.matchAll(/ComponentRegistry\.register\(\s*'([^']+)'\s*,\s*(\w+)/g),
    ].map((m) => ({ key: m[1], component: m[2] }));

    // Anti-vacuity for the extraction: it found the registrations it claims to
    // read. A regex that matched nothing would make the filter below empty and
    // the assertion green forever.
    expect(registeredComponents.length).toBeGreaterThan(0);
    expect(registeredComponents.map((r) => r.key)).toContain(SURVIVOR);

    expect(registeredComponents.filter((r) => r.component === 'KanbanRenderer')).toEqual([]);
    // And through the live registry, not only off disk.
    expect(ComponentRegistry.get(SURVIVOR)).not.toBe(KanbanRenderer);
  });

  it('`KanbanRenderer` still declares `objectFields` as a React prop — the channel `ObjectKanban` passes the catalogue through', () => {
    // The CLASS is closed in `@object-ui/react`: since objectui#8818
    // `SchemaRenderer`'s stripped-metadata list names `objectFields`, so an
    // authored value reaches no component prop. What this package owns is the
    // host half, and that is all this asserts: `KanbanRenderer` still DECLARES
    // the prop, which is how `ObjectKanban` hands the fetched field catalogue
    // down. Dropping it would break that channel, not reopen the hole.
    const src = readFileSync(INDEX_TSX, 'utf8');
    expect(src).toContain('objectFields?: unknown;');
  });
});

describe('suite 4 — `kanban-enhanced`\'s three keys lost their only authorable surface', () => {
  it('none of `onColumnToggle` / `enableVirtualScrolling` / `virtualScrollThreshold` is declared anywhere in this package', () => {
    // objectui#8257's own subject, CONFIRMED rather than assumed: the three
    // keys were read by the `kanban-enhanced` registration and declared as its
    // `inputs`, with no schema arm anywhere. With the registration gone they
    // have no authorable surface at all — which resolves the card by removing
    // its subject.
    const src = readFileSync(INDEX_TSX, 'utf8');
    const declaredInputNames = [...src.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]);

    // Anti-vacuity: the extraction reads a real, populated input list.
    expect(declaredInputNames).toContain('groupBy');

    for (const key of ['onColumnToggle', 'enableVirtualScrolling', 'virtualScrollThreshold']) {
      expect(declaredInputNames, `\`${key}\` is still a declared input`).not.toContain(key);
    }
  });
});
