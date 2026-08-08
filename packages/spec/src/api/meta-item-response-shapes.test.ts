// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two response shapes `GET /api/v1/meta/:type/:name…` serves, each declared
 * by its own schema (sweep #6487).
 *
 * Both members here are DECLARATION changes with zero runtime effect, so the
 * assertions have to bear the load themselves: it is not enough that the new
 * keys exist in the file, they must be reachable at the type level (the thing a
 * consumer was previously forced to `cast` for) and the real wire bodies must
 * parse against them.
 *
 * - **#5950** — the uncached branch of `GET /meta/:type/:name` has always sent
 *   the ADR-0010 protection envelope (`lock` and nine siblings) on top of
 *   `{ type, name, item }`, and `GetMetaItemResponseSchema` declared only the
 *   three. `lock` is the READ half of the ADR-0008 optimistic-concurrency chain
 *   whose write half `SaveMetaItemResponseSchema` already declares (#5745).
 * - **#5882** — `?layers=true` answered a completely different projection that
 *   the route never declared. It now has its own path and its own schema.
 */

import { describe, it, expect } from 'vitest';
import {
  GetMetaItemResponseSchema,
  GetMetaItemLayeredResponseSchema,
} from './protocol.zod';
import type { GetMetaItemResponse, GetMetaItemLayeredResponse } from './protocol.zod';
import type { MetadataLock } from '../kernel/metadata-protection.zod';

/** Type-level identity / assignability helpers. */
type Eq< A, B > = (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;
type Assert< T extends true > = T;

/**
 * The compile-time half of both members, at module scope and EXPORTED.
 *
 * These have to live here rather than inside an `it()` body for two reasons
 * that both bite: an unread alias in a function body is TS6196 under
 * `noUnusedLocals`, and — the one that matters — a pin no program compiles is a
 * phantom check that stays green after someone deletes the thing it guards.
 * `packages/spec` compiles its tests via `tsconfig.test.json`, so these are
 * real: reverting either member turns them red at `pnpm typecheck`.
 */

/**
 * #5950 — `lock` is reachable AND typed as the ADR-0010 union. This is the
 * #5545 complaint stated as a compile-time fact: an SDK caller holding a
 * `GetMetaItemResponse` can branch on the lock's VALUES without a cast, which
 * is what "the read side has a contract" has to mean.
 */
export type LockIsTheAdr0010Union = Assert< Eq< GetMetaItemResponse['lock'], MetadataLock | undefined > >;

/**
 * #5882 — the two responses are genuinely different resources: neither schema
 * is a widening of the other, which is the fact that justifies a second path
 * instead of one stretched declaration.
 */
export type LayeredCarriesNoItem = Assert< Eq< 'item' extends keyof GetMetaItemLayeredResponse ? true : false, false > >;
export type PlainCarriesNoLayers = Assert< Eq< 'effective' extends keyof GetMetaItemResponse ? true : false, false > >;

/** The document under `item` — irrelevant to these shapes, so kept trivial. */
const CUSTOMER = { name: 'customer', label: 'Customer' };

describe('#5950 GetMetaItemResponseSchema — the ADR-0010 protection envelope is declared', () => {
  /**
   * The uncached branch's real body: `metadata-protocol`'s `getMetaItem`
   * return, spread onto the wire verbatim by `translateMetaEnvelope`.
   * All ten protection keys, including the six conditional ones.
   */
  const UNCACHED_BODY = {
    type: 'object',
    name: 'customer',
    item: CUSTOMER,
    lock: 'no-overlay',
    lockReason: 'Shipped by the setup package',
    lockSource: 'package',
    lockDocsUrl: 'https://docs.example.test/locks',
    provenance: 'package',
    packageId: 'com.objectstack.setup',
    packageVersion: '1.2.3',
    editable: false,
    deletable: true,
    resettable: true,
  };

  it('parses the uncached body WITHOUT stripping the protection envelope', () => {
    const parsed = GetMetaItemResponseSchema.parse(UNCACHED_BODY);
    // The substance: every carrier survives the parse. Before this change
    // `.parse()` silently dropped all ten — the same way the write side
    // dropped `version` before #5745.
    expect(parsed.lock).toBe('no-overlay');
    expect(parsed.lockReason).toBe('Shipped by the setup package');
    expect(parsed.lockSource).toBe('package');
    expect(parsed.lockDocsUrl).toBe('https://docs.example.test/locks');
    expect(parsed.provenance).toBe('package');
    expect(parsed.packageId).toBe('com.objectstack.setup');
    expect(parsed.packageVersion).toBe('1.2.3');
    expect(parsed.editable).toBe(false);
    expect(parsed.deletable).toBe(true);
    expect(parsed.resettable).toBe(true);
  });

  it('still parses the CACHED body, where every protection key is absent', () => {
    // The default deployment (`enableCache: true`) rebuilds the envelope as
    // exactly these three keys and resolves no lock. Declaring the envelope
    // REQUIRED would have made the default path fail its own contract.
    const parsed = GetMetaItemResponseSchema.parse({ type: 'object', name: 'customer', item: CUSTOMER });
    expect(parsed.type).toBe('object');
    expect(parsed.item).toEqual(CUSTOMER);
    expect(parsed.lock).toBeUndefined();
    expect(parsed.editable).toBeUndefined();
  });

  it('rejects a lock value outside the ADR-0010 vocabulary', () => {
    // The declaration is not merely wider — it is the lock vocabulary. A value
    // the resolver could never produce must not validate.
    expect(() =>
      GetMetaItemResponseSchema.parse({ ...UNCACHED_BODY, lock: 'read-only' }),
    ).toThrow();
    expect(() =>
      GetMetaItemResponseSchema.parse({ ...UNCACHED_BODY, lockSource: 'overlay' }),
    ).toThrow();
  });

  it('types `lock` as the ADR-0010 union — not `unknown`, so no cast is needed', () => {
    // Compile-time half: `LockIsTheAdr0010Union` at module scope. Runtime half:
    // a response literal that declares `lock` and narrows on it, with no cast.
    const response: GetMetaItemResponse = { type: 'object', name: 'customer', item: CUSTOMER, lock: 'full' };
    // Reading it needs no cast; narrowing works.
    const readOnly = response.lock === 'full' || response.lock === 'no-overlay';
    expect(readOnly).toBe(true);
  });
});

describe('#5882 GetMetaItemLayeredResponseSchema — the three-layer projection', () => {
  /** What `getMetaItemLayered` returns, and `GET /meta/:type/:name/layers` serves. */
  const LAYERED_BODY = {
    type: 'object',
    name: 'customer',
    code: { name: 'customer', label: 'Customer' },
    overlay: { label: 'Client' },
    overlayScope: 'org',
    effective: { name: 'customer', label: 'Client' },
    _diagnostics: { valid: true },
    lock: 'none',
    editable: true,
    deletable: true,
    resettable: false,
  };

  it('parses the layered body with all three layers intact', () => {
    const parsed = GetMetaItemLayeredResponseSchema.parse(LAYERED_BODY);
    // The whole point of the projection: the layers stay SEPARATE. Collapsing
    // them into one `item` is what the ordinary read does, and doing it here
    // would delete the diagnostic.
    expect(parsed.code).toEqual({ name: 'customer', label: 'Customer' });
    expect(parsed.overlay).toEqual({ label: 'Client' });
    expect(parsed.effective).toEqual({ name: 'customer', label: 'Client' });
    expect(parsed.overlayScope).toBe('org');
    expect(parsed._diagnostics).toEqual({ valid: true });
  });

  it('accepts an uncustomized item — null overlay, null scope', () => {
    const parsed = GetMetaItemLayeredResponseSchema.parse({
      ...LAYERED_BODY,
      overlay: null,
      overlayScope: null,
    });
    expect(parsed.overlay).toBeNull();
    expect(parsed.overlayScope).toBeNull();
  });

  it('accepts an absent `_diagnostics` — types with no registered Zod schema', () => {
    const { _diagnostics: _omitted, ...withoutDiagnostics } = LAYERED_BODY;
    const parsed = GetMetaItemLayeredResponseSchema.parse(withoutDiagnostics);
    expect(parsed._diagnostics).toBeUndefined();
  });

  it('REQUIRES the four resolved verdicts — this path always sets them', () => {
    // Unlike the ordinary read there is one producer path here (the layered
    // view skips the cache), so these are guaranteed and declared required.
    // A body missing them is not a layered response.
    for (const key of ['lock', 'editable', 'deletable', 'resettable'] as const) {
      const { [key]: _dropped, ...missing } = LAYERED_BODY;
      expect(() => GetMetaItemLayeredResponseSchema.parse(missing)).toThrow();
    }
  });

  it('rejects an overlayScope outside `org` | `env`', () => {
    expect(() =>
      GetMetaItemLayeredResponseSchema.parse({ ...LAYERED_BODY, overlayScope: 'package' }),
    ).toThrow();
  });

  it('is a DIFFERENT shape from the ordinary read — which is why it got its own path', () => {
    // The layered body carries no `item`, and the ordinary envelope carries no
    // layers. One route answering both is what #5882 was filed about; the
    // assertion states that the two really are distinct resources rather than
    // one schema that could have absorbed the other.
    // Compile-time half: `LayeredCarriesNoItem` / `PlainCarriesNoLayers` at
    // module scope.
    const layered = GetMetaItemLayeredResponseSchema.parse(LAYERED_BODY);
    expect(layered).not.toHaveProperty('item');

    // And the ordinary schema cannot stand in for it at all: the layered body
    // has no `item`, which `GetMetaItemResponseSchema` requires, so it does not
    // merely lose the layers on the way through — it fails outright. That is
    // the sharpest available statement that these are two resources and not one
    // schema stretched over both.
    const throughPlain = GetMetaItemResponseSchema.safeParse(LAYERED_BODY);
    expect(throughPlain.success).toBe(false);
    expect(throughPlain.error?.issues.map((i) => i.path.join('.'))).toContain('item');
  });
});
