// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5870, #4967 Part 2] `capabilities` in the provenance-stamping seam.
 *
 * ADR-0066 D1 says a package DEFINES its authorization capabilities and the
 * registry attributes them to that package. The attribution only happens on ONE
 * path: `ObjectQL.registerApp()` decomposes a manifest's metadata arrays and
 * calls `SchemaRegistry.registerItem(type, item, 'name', packageId)`, which runs
 * `applyProtection(item, { packageId })` and stamps `_packageId` /
 * `_provenance`. The key list that drives that decomposition — at the time,
 * `metadataArrayKeys`, declared TWICE in `engine.ts`, once per seam: the
 * manifest seam and the nested `registerPlugin` seam — carried every other
 * Security-Protocol collection — `permissions`, `sharingRules`, `roles`,
 * `profiles`, `policies` — but not `capabilities`.
 *
 * The two copies are one `METADATA_ARRAY_KEYS` since #7049, which found four
 * MORE collections (`jobs`, `emailTemplates`, `tools`, `skills`) that this
 * fix's one-name-at-a-time shape had left diverged. The seams' agreement is
 * pinned as a property in `engine-nested-plugin-collections.test.ts`; the
 * nested-seam case below stays because `capabilities` is the collection whose
 * absence had a NAMED downstream consequence.
 *
 * Consequence before the fix: `plugin-security`'s `bootstrapDeclaredCapabilities`
 * resolves the owner as `cap._packageId ?? cap.packageId` and reads its input
 * with `readDeclared(ql, 'capability')`, which is
 * `engine.registry.listItems('capability')` mapped through `i?.content ?? i`
 * (`packages/plugins/plugin-security/src/bootstrap-declared-permissions.ts:61-69`).
 * With `capabilities` outside the seam that list was ALWAYS empty, so the
 * `_packageId` half of that `??` could never be satisfied and the author-side
 * `packageId` — documented in `CapabilityDeclarationSchema` as the *fallback*
 * for "registry-stamped absent" — was in fact mandatory. Omitting it produced a
 * boot `warn` and one authorization grant that never took effect: declared ≠
 * enforced.
 *
 * These tests assert the registry state `readDeclared` consumes rather than
 * importing it — `@objectstack/plugin-security` does not depend on
 * `@objectstack/objectql` (nor the reverse), and a test-only edge between them
 * would invent a package dependency the runtime does not have. The expression
 * under test is quoted from that file above and pinned by
 * {@link readDeclaredShape} below.
 */

import { describe, it, expect } from 'vitest';
import { pluralToSingular } from '@objectstack/spec/shared';
import { ObjectQL } from './engine';

/**
 * The exact read `bootstrapDeclaredCapabilities` performs on the engine, kept
 * in one place so the shape this suite depends on is stated once:
 * `readDeclared(ql, type)` → `registry.listItems(type)` unwrapped by
 * `content ?? item`.
 */
function readDeclaredShape(engine: ObjectQL, type: string): any[] {
  return (engine.registry.listItems<any>(type) ?? []).map((i: any) => i?.content ?? i).filter(Boolean);
}

const PKG = 'com.acme.exporter';

/** A declaration with NO author-side `packageId` — the registry must supply it. */
function manifestWithCapability() {
  return {
    id: PKG,
    name: 'exporter',
    capabilities: [
      { name: 'export_data', label: 'Export Data', description: 'Bulk-export records.', scope: 'org' },
    ],
    permissions: [
      { name: 'ops', label: 'Ops', systemPermissions: ['export_data'] },
    ],
  };
}

describe('registerApp — declared capabilities carry registry provenance (#5870)', () => {
  it('registers a manifest capability under the singular `capability` type', () => {
    const engine = new ObjectQL();
    engine.registerApp(manifestWithCapability());

    const caps = readDeclaredShape(engine, 'capability');
    expect(caps.map((c) => c.name)).toEqual(['export_data']);
  });

  it('stamps `_packageId` so the seeder resolves an owner without an author-side packageId', () => {
    const engine = new ObjectQL();
    engine.registerApp(manifestWithCapability());

    const cap = readDeclaredShape(engine, 'capability')[0];
    // The seeder's own expression: registry provenance first (ADR-0010),
    // author-declared `packageId` (ADR-0086 D3) only as fallback.
    expect(cap._packageId ?? cap.packageId).toBe(PKG);
    // …and the fallback really is a fallback: nothing authored `packageId`.
    expect(cap.packageId).toBeUndefined();
    expect(cap._packageId).toBe(PKG);
    expect(cap._provenance).toBe('package');
  });

  it('reaches the registry on exactly the same terms as its `permissions` sibling', () => {
    const engine = new ObjectQL();
    engine.registerApp(manifestWithCapability());

    const cap = readDeclaredShape(engine, 'capability')[0];
    const permission = readDeclaredShape(engine, 'permission')[0];

    expect(permission?._packageId).toBe(PKG);
    expect(cap?._packageId).toBe(permission?._packageId);
    expect(cap?._provenance).toBe(permission?._provenance);
  });

  it('keeps two packages\' same-named capabilities attributed to their own owner', () => {
    const engine = new ObjectQL();
    engine.registerApp({ id: 'com.acme.crm', capabilities: [{ name: 'export_data', label: 'CRM Export' }] });
    engine.registerApp({ id: 'com.acme.hr', capabilities: [{ name: 'export_data', label: 'HR Export' }] });

    expect(engine.registry.getItem<any>('capability', 'export_data', 'com.acme.crm')?.label).toBe('CRM Export');
    expect(engine.registry.getItem<any>('capability', 'export_data', 'com.acme.hr')?.label).toBe('HR Export');
    expect(readDeclaredShape(engine, 'capability')).toHaveLength(2);
  });

  it('stamps capabilities declared by a NESTED plugin too (the second seam)', () => {
    // `engine.ts` reaches this seam from two entry points — the manifest seam
    // and the `registerPlugin` seam reached via `manifest.plugins[]`. A fix
    // applied to only one leaves a package's nested plugin declaring
    // capabilities that still never get stamped, which is the same defect one
    // level down. (Since #7049 both entry points read ONE collection list, so
    // this can no longer be half-fixed; the assertion stays as the regression
    // pin for the collection that first exposed it.)
    const engine = new ObjectQL();
    engine.registerApp({
      id: PKG,
      plugins: [
        { name: 'billing', capabilities: [{ name: 'billing.refund', label: 'Refund' }] },
      ],
    });

    const caps = readDeclaredShape(engine, 'capability');
    expect(caps.map((c) => c.name)).toEqual(['billing.refund']);
    // Nested plugins contribute UNDER the parent package's ownership.
    expect(caps[0]._packageId).toBe(PKG);
  });
});

describe('metadataArrayKeys ↔ stamping consistency pin (#5870)', () => {
  /**
   * The three Security-Protocol collections a boot seeder reads back by
   * SINGULAR type name: `bootstrapDeclaredPermissions` (`permission`),
   * `bootstrapDeclaredCapabilities` (`capability`) and
   * `bootstrapDeclaredSharingRules` (`sharing_rule`). Membership in
   * `metadataArrayKeys` alone is not enough — the plural key must also map to
   * the singular type the seeder asks for, or the items land in a store nobody
   * reads. This pin holds both halves at once.
   */
  const SEEDED_SECURITY_COLLECTIONS: ReadonlyArray<readonly [string, string]> = [
    ['permissions', 'permission'],
    ['capabilities', 'capability'],
    ['sharingRules', 'sharing_rule'],
  ];

  it('maps each seeded security collection to the singular type its seeder reads', () => {
    for (const [plural, singular] of SEEDED_SECURITY_COLLECTIONS) {
      expect(pluralToSingular(plural), `${plural} must register as '${singular}'`).toBe(singular);
    }
  });

  it('stamps every seeded security collection through the manifest seam', () => {
    const engine = new ObjectQL();
    engine.registerApp({
      id: PKG,
      permissions: [{ name: 'ops', label: 'Ops' }],
      capabilities: [{ name: 'export_data', label: 'Export Data' }],
      sharingRules: [{ name: 'share_all', object: 'account', accessLevel: 'read' }],
    });

    for (const [, singular] of SEEDED_SECURITY_COLLECTIONS) {
      const items = readDeclaredShape(engine, singular);
      expect(items, `nothing registered under '${singular}'`).toHaveLength(1);
      expect(items[0]._packageId, `'${singular}' reached the registry unstamped`).toBe(PKG);
    }
  });
});
