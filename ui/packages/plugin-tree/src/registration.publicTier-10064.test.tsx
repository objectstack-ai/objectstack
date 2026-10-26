/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10064 — `object-tree` is on the curated PUBLIC tier (ADR-0080).
 *
 * ## What was wrong, stated as the direction it was wrong in
 *
 * `@objectstack/spec` DECLARES this block: `object-tree` is a key of
 * `ComponentPropsMap`. This repo registered the renderer (twice — see the alias
 * pin below) and curated neither spelling, so `getPublicConfigs()` — the read
 * both manifest producers serialize — could not report a block the contract
 * says exists. The public tier was NARROWER than the declaration, and every
 * downstream artefact faithfully reported that: regenerating
 * `sdui.manifest.json` upstream was a byte-identical no-op and moving the
 * objectui pin could not help, because the pinned source had nothing to carry.
 *
 * ⇒ this pin is over the ADMISSION, and it fails by ABSENCE.
 *
 * ## The instrument, and the lit control in the same test
 *
 * Every assertion below reads `getPublicConfigs()` / `PUBLIC_BLOCKS` — the same
 * public path `apps/console/dev/manifest-dump.tsx` and the framework's
 * `gen-sdui-manifest-node.mjs` both serialize through `manifestFromConfigs`.
 * `object-grid` is asserted beside `object-tree` every time, so a zero for the
 * tree is an absence this instrument could have seen: a lookup that has stopped
 * reaching the curated roster reports BOTH missing and fails on the control
 * first, rather than reading as a finding about the tree (objectui#8410).
 *
 * ## Which mechanism, and why not the other one
 *
 * `getPublicConfigs()` admits a block by TWO routes: membership of the curated
 * `PUBLIC_BLOCKS` roster, or `tier: 'public'` on the registration itself. The
 * siblings settle it — `object-grid`, `object-map`, `object-gantt` and every
 * other view block reach the tier through the roster, and NO registration in
 * this repo's published source declares `tier: 'public'`. So the admission is a
 * roster entry, ⛔ not a flag here, and ⛔ not both: two mechanisms for one
 * block is the ambiguity `public-blocks.ts` asks callers to avoid in its own
 * words ("prefer editing this list over scattering `tier` flags").
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry, PUBLIC_BLOCKS } from '@object-ui/core';
// The registration under test: importing the plugin runs its side-effectful
// `ComponentRegistry.register` calls, which is how every host reaches it.
import './index';

const publicTypes = (): string[] => ComponentRegistry.getPublicConfigs().map((c) => c.type);

describe('object-tree on the curated public tier (objectui#10064)', () => {
  it('curates object-tree beside its sibling view blocks', () => {
    // Lit control first: the roster read is live, so an absence below is a
    // reading and not a failed lookup.
    expect(PUBLIC_BLOCKS).toContain('object-grid');
    expect(PUBLIC_BLOCKS).toContain('object-tree');
  });

  it('reports object-tree through the read both manifest producers serialize', () => {
    // The registration has to RESOLVE, not merely be listed: a curated tag with
    // no registration behind it is skipped silently ("aspirational-safe"), which
    // is a roster that advertises a block no manifest can carry.
    expect(ComponentRegistry.getConfig('object-tree')).toBeDefined();
    expect(publicTypes()).toContain('object-tree');
  });

  it('carries the block real inputs, not a propless entry', () => {
    // `manifestFromConfigs` copies `inputs` verbatim, so a block admitted with
    // none reads downstream as "this block takes no configuration" and turns
    // every prop an author writes into an unknown-prop diagnostic.
    const cfg = ComponentRegistry.getPublicConfigs().find((c) => c.type === 'object-tree');
    expect((cfg?.inputs ?? []).map((i) => i.name)).toContain('objectName');
  });

  it('withholds the `tree` alias — retired outright since objectui#10859 batch 8', () => {
    // `index.tsx` used to register the SAME renderer twice: `object-tree` (the
    // name @objectstack/spec declares on `ComponentPropsMap`) and `tree` (a bare
    // view-namespace alias the spec does not declare), and this row pinned that
    // only the declared spelling was curated. objectui#10859 batch 8 went the
    // rest of the way and unregistered the alias (`objectui validate` refused it
    // at `type`, and nothing authored it), so it is now absent from the registry
    // itself, not only from the roster. Lit control: `object-tree` resolves.
    expect(ComponentRegistry.getConfig('object-tree')).toBeDefined();
    expect(ComponentRegistry.getConfig('tree')).toBeUndefined();
    expect(ComponentRegistry.getConfig('view:tree')).toBeUndefined();
    expect(PUBLIC_BLOCKS).not.toContain('tree');
    expect(publicTypes()).not.toContain('tree');
  });

  it('admits it through the roster, not through a second mechanism', () => {
    // `tier: 'public'` on the registration is the other route into
    // `getPublicConfigs()`. Both at once is what the roster's header asks
    // callers not to do, and it would make the admission un-reviewable from the
    // one list that is meant to be the single source of truth.
    expect(ComponentRegistry.getMeta('object-tree')?.tier).toBeUndefined();
  });
});
