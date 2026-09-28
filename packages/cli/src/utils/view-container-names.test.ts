// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20331] `findViewContainerNameRefusals` — the WALK `os validate` runs the
 * boot registrar's view-container `name` judgment over.
 *
 * The verdict is `@objectstack/objectql`'s `viewContainerNameRefusal`, the
 * function the boot loop throws the answer of; its own file pins that. What
 * this module owns, and what is pinned here, is which `views:` entries it hands
 * that judge and under which package id — the load path's answer:
 *
 *   - no `packages[]` → the top-level `views`, owned by `manifest.id`;
 *   - `packages[]`    → each body's own `views`, owned by that package, and the
 *     top level NOT at all (the load path does not register from it).
 *
 * Every row's message is asserted EQUAL to the judge's answer for the same
 * entry, source label and id — never re-spelled — so this file cannot drift
 * into a second copy of the words it exists to repeat.
 */

import { describe, expect, it } from 'vitest';
import { viewContainerNameRefusal } from '@objectstack/objectql';
import { findViewContainerNameRefusals } from './view-container-names.js';

const ID = 'com.example.vcn';

const view = (extra: Record<string, unknown>) => ({
  object: 'vcn_order_line',
  list: { type: 'grid', columns: [{ field: 'name' }] },
  ...extra,
});

const divergent = view({ name: 'order_line' });

const manifest = (id: string) => ({ id, name: id, version: '1.0.0', type: 'app' });

describe('#20331 — findViewContainerNameRefusals walks what the load path registers', () => {
  it('a one-package stack: the top-level `views`, under the manifest id, in the judge\'s words', () => {
    const rows = findViewContainerNameRefusals({ manifest: manifest(ID), views: [divergent] });
    expect(rows).toHaveLength(1);
    const expected = viewContainerNameRefusal(divergent, 'manifest', ID);
    expect(expected).toBeDefined();
    expect(rows[0]).toEqual({
      path: 'views[0]',
      code: 'VALIDATION_ERROR',
      httpStatus: 400,
      message: expected!.message,
    });
    expect(rows[0].message).toContain(`from manifest '${ID}'`);
  });

  it('reports EVERY divergent container, located, and none of the others', () => {
    const rows = findViewContainerNameRefusals({
      manifest: manifest(ID),
      views: [
        view({ name: 'vcn_order_line' }),
        divergent,
        view({}),
        view({ name: 'order_line_two' }),
      ],
    });
    expect(rows.map((r) => r.path)).toEqual(['views[1]', 'views[3]']);
  });

  it('CONTROL: a matching `name`, an absent one, and no `views` at all report nothing', () => {
    expect(findViewContainerNameRefusals({ manifest: manifest(ID), views: [view({ name: 'vcn_order_line' })] }))
      .toEqual([]);
    expect(findViewContainerNameRefusals({ manifest: manifest(ID), views: [view({})] })).toEqual([]);
    expect(findViewContainerNameRefusals({ manifest: manifest(ID) })).toEqual([]);
  });

  it('a `packages[]` stack: each body\'s own `views`, under THAT package\'s id', () => {
    const rows = findViewContainerNameRefusals({
      packages: [
        { manifest: { ...manifest('com.example.core'), views: [view({ name: 'vcn_order_line' })] } },
        { manifest: { ...manifest('com.example.orders'), views: [divergent] } },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe('packages[1].manifest.views[0]');
    expect(rows[0].message).toBe(viewContainerNameRefusal(divergent, 'manifest', 'com.example.orders')!.message);
  });

  it('a `packages[]` stack: the top-level `views` is NOT judged, because the load path does not register it', () => {
    // `resolveArtifactPackageOrder` returns the package bodies alone once
    // `packages` is present, so a top-level copy never reaches the registrar.
    // Judging it here would refuse a stack the server loads.
    const rows = findViewContainerNameRefusals({
      manifest: manifest(ID),
      views: [divergent],
      packages: [{ manifest: { ...manifest('com.example.core'), views: [view({ name: 'vcn_order_line' })] } }],
    });
    expect(rows).toEqual([]);
  });
});
