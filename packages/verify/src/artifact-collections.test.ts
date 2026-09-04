// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0130 D4 / option B — this package's readers over a multi-package app
 * (#15229, reader program 5/4 of the ruling on #14512).
 *
 * The acceptance pin for the program lives in `@objectstack/cli`
 * (`option-b-reader-acceptance.pin.test.ts`, #15004) and measures these readers
 * through a booted two-package fixture. What is here instead is the CONTRACT of
 * the resolution itself, which that pin cannot see: that the flattened top level
 * still answers FIRST — including when it is an empty array — and that a
 * malformed `packages` refuses rather than reading as "no collections".
 *
 * Every test drives a SHIPPED reader (`deriveCrudCases`, `declaredPositionNames`,
 * `rlsProbePermissionSet`), never `declaredCollection` directly: a test shaped
 * like the helper would pass over a reader that never calls it.
 */

import { describe, expect, it } from 'vitest';

import { deriveCrudCases } from './derive.js';
import { declaredPositionNames, rlsProbePermissionSet } from './rls.js';

/**
 * One package body, as `packages[i].manifest` carries it: an
 * `AssembledPackageBodySchema` — `ManifestSchema` fields at the TOP of the body
 * with the collections beside them, never a nested `manifest` key.
 * `resolveArtifactPackageOrder` parses each entry whole, so these bodies are
 * real definitions and not sketches.
 */
const corePackage = {
  id: 'com.example.readers.core',
  name: 'Readers Core',
  version: '1.0.0',
  type: 'app',
  objects: [
    {
      name: 'reader_account',
      label: 'Reader Account',
      fields: { name: { name: 'name', type: 'text', label: 'Name', required: true } },
    },
  ],
  datasources: [
    {
      name: 'reader_warehouse',
      label: 'Reader Warehouse',
      driver: 'sqlite',
      config: { filename: '.objectstack/data/reader-warehouse.db' },
      schemaMode: 'external',
      external: { allowWrites: true },
    },
  ],
  positions: [{ name: 'reader_position', label: 'Reader Position' }],
};

const ordersPackage = {
  id: 'com.example.readers.orders',
  name: 'Readers Orders',
  version: '1.0.0',
  type: 'module',
  dependencies: { 'com.example.readers.core': '^1.0.0' },
  objects: [
    {
      name: 'reader_wh_order',
      label: 'Warehouse Order',
      datasource: 'reader_warehouse',
      external: { remoteName: 'orders', writable: true },
      fields: { name: { name: 'name', type: 'text', label: 'Number', required: true } },
    },
  ],
  positions: [{ name: 'reader_second_position', label: 'Second Position' }],
};

/** The option-B shape: `packages[]` carries everything, nothing is flattened. */
const optionB = () => ({
  manifest: { id: 'com.example.readers.app', name: 'Readers App', version: '1.0.0', type: 'app' },
  packages: [{ manifest: corePackage }, { manifest: ordersPackage }],
});

describe('#15229 — `@objectstack/verify` reads its collections from `packages[]` too', () => {
  it('deriveCrudCases derives a case per package-owned object', () => {
    const cases = deriveCrudCases(optionB());
    expect(cases.map((c) => c.object).sort()).toEqual(['reader_account', 'reader_wh_order']);
  });

  it('the ADR-0015 write gate resolves the datasource from the OTHER package', () => {
    // The object is in `orders`, the datasource that opens the write gate is in
    // `core`. A reader that resolved `objects` but not `datasources` reports the
    // app's write-opted-in external object as read-only and skips it — a
    // verifier quietly proving less, which is the failure mode of this card.
    const federated = deriveCrudCases(optionB()).find((c) => c.object === 'reader_wh_order');
    expect(federated?.blocked).toBeUndefined();
  });

  it('declaredPositionNames covers every package, in package order', () => {
    expect(declaredPositionNames(optionB())).toEqual(['reader_position', 'reader_second_position']);
  });

  it('rlsProbePermissionSet grants AND narrows every package-owned object', () => {
    const set = rlsProbePermissionSet(optionB()) as unknown as {
      objects: Record<string, unknown>;
      rowLevelSecurity: Array<{ object: string; operation: string }>;
    };
    expect(Object.keys(set.objects).sort()).toEqual(['reader_account', 'reader_wh_order']);
    // Both halves are load-bearing: the grants stop the OBJECT gate answering
    // 403 first, the owner-scoped select is what puts the persona outside the
    // record scope. A set with grants and no narrowing is not a probe.
    expect(set.rowLevelSecurity.map((r) => r.object).sort())
      .toEqual(['reader_account', 'reader_wh_order']);
    expect(new Set(set.rowLevelSecurity.map((r) => r.operation))).toEqual(new Set(['select']));
  });

  describe('the flattened top level answers FIRST — `packages[]` supplies only what it lacks', () => {
    it("today's additive artifact answers bit-identically, and does not merge the second copy", () => {
      // The additive shape carries every definition TWICE. `packages[]` here
      // deliberately carries an object the top level does NOT — if the reader
      // merged instead of preferring, this would come back with three cases and
      // every app on the additive artifact would be verified against a stack
      // that is not the one it composed.
      const additive = {
        objects: [
          { name: 'reader_account', label: 'Account', fields: { name: { name: 'name', type: 'text' } } },
          { name: 'reader_order', label: 'Order', fields: { name: { name: 'name', type: 'text' } } },
        ],
        packages: [{ manifest: corePackage }, { manifest: ordersPackage }],
      };
      expect(deriveCrudCases(additive).map((c) => c.object))
        .toEqual(['reader_account', 'reader_order']);
    });

    it('a DECLARED-EMPTY collection stays empty (`objects: []` is truthy)', () => {
      // Measured on the sibling card #15006: re-expressing one of these reads as
      // "resolve, then take what came back" silently changes the answer for a
      // stack that declares an empty collection. Falsy — absent or null — is the
      // only thing that reaches `packages[]`.
      const declaredEmpty = { objects: [], positions: [], packages: [{ manifest: corePackage }] };
      expect(deriveCrudCases(declaredEmpty)).toEqual([]);
      expect(declaredPositionNames(declaredEmpty)).toEqual([]);
      expect(Object.keys(
        (rlsProbePermissionSet(declaredEmpty) as unknown as { objects: Record<string, unknown> }).objects,
      )).toEqual([]);
    });

    it('a single-package app with no `packages` key is unchanged', () => {
      const flat = { objects: [{ name: 'reader_solo', fields: { name: { name: 'name', type: 'text' } } }] };
      expect(deriveCrudCases(flat).map((c) => c.object)).toEqual(['reader_solo']);
      expect(declaredPositionNames({ positions: [{ name: 'solo_position' }] }))
        .toEqual(['solo_position']);
      expect(deriveCrudCases(undefined)).toEqual([]);
      expect(declaredPositionNames(null)).toEqual([]);
    });
  });

  it('a malformed `packages` REFUSES with the ADR-0112 envelope, never as "no collections"', () => {
    // `resolveArtifactPackageOrder` owns this verdict (`@objectstack/core`,
    // ADR-0130 D4) — asserted here as the envelope (`code` + `status`) rather
    // than as a bare throw, so a driver that throws a plain Error cannot pass.
    let raised: (Error & { code?: string; status?: number }) | undefined;
    try {
      deriveCrudCases({ packages: [{ notAManifest: true }] });
    } catch (e) {
      raised = e as Error & { code?: string; status?: number };
    }
    expect(raised?.code).toBe('INVALID_ARTIFACT_PACKAGE_ENTRY');
    expect(raised?.status).toBe(422);
  });
});
