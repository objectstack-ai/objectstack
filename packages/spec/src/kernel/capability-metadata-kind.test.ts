// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5961 — `capability` is a REGISTERED metadata kind; #35157 — runtime-creatable,
 * overlay-closed.
 *
 * ## The hole #5961 closed
 *
 * `capability` was ENFORCED BUT UNDECLARED — the mirror of `declared ≠
 * enforced`, and the exact shape #5271 closed for `api`. Three registries were
 * missing an entry the rest of the platform behaved as if they had:
 *
 *   1. `MetadataTypeSchema` (the kind enum),
 *   2. `BUILTIN_METADATA_TYPE_SCHEMAS` (schema resolution), and
 *   3. `DEFAULT_METADATA_TYPE_REGISTRY` (who may write, and how it is loaded).
 *
 * So `getMetadataTypeSchema('capability')` answered `undefined`, `saveMetaItem`
 * took its "unregistered type → store without validation" branch, and
 * `PUT /api/v1/meta/capability/:name` accepted ANY JSON into the live
 * authorization namespace. That half stands: a write is judged by
 * `CapabilityDeclarationSchema`.
 *
 * ## Why `allowRuntimeCreate: true` now (#35157)
 *
 * ADR-0066 D1: packages DEFINE capabilities, permission sets GRANT them,
 * resources REQUIRE them. The kind was first code-only on the reading that a
 * runtime-minted capability has no requirement side. Environment metadata now
 * carries both other edges (an action, flow or object authored there declares
 * `requiredPermissions`; a set authored there grants), and an `unmanaged`
 * install (ADR-0131 D6) copies an app into environment rows through the save
 * door — so an app that gates its own actions could not be copied at all.
 * `allowEnvironmentOverlay: false` stays: a capability a package ships is not
 * an environment author's to re-declare, so nobody re-scopes it.
 *
 * The enforcement half lives in
 * `@objectstack/metadata-protocol`'s `protocol.capability-write-door.test.ts`
 * — the write path is there, and a registry pin alone would be a document.
 * This file pins the DECLARATION, plus the half of the ruling that is a
 * refusal.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_METADATA_TYPE_REGISTRY, MetadataTypeSchema } from './metadata-plugin.zod';
import { getMetadataTypeSchema, listMetadataTypeSchemaTypes } from './metadata-type-schemas';
import { PLURAL_TO_SINGULAR, SINGULAR_TO_PLURAL } from '../shared/metadata-collection.zod';

const entry = (type: string) => DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === type);

/** A well-formed package-level declaration, as `defineCapability` would produce. */
const DECLARATION = {
  name: 'billing.refund',
  label: 'Issue Refunds',
  description: 'Refund a captured payment.',
  scope: 'org' as const,
  packageId: 'com.acme.billing',
};

describe('capability is a registered metadata kind', () => {
  // ── the three registries that were missing it ─────────────────────────

  it('is a member of the kind enum', () => {
    expect(MetadataTypeSchema.safeParse('capability').success).toBe(true);
  });

  it('resolves a schema — the branch that made PUT store raw JSON is gone', () => {
    // The single most load-bearing assertion in this file. `saveMetaItem`
    // decides between "validate" and "store verbatim" purely on whether this
    // returns something.
    expect(getMetadataTypeSchema('capability')).toBeDefined();
    expect(listMetadataTypeSchemaTypes()).toContain('capability');
  });

  it('has a registry entry: runtime-creatable, never an overlay of a packaged declaration (#35157)', () => {
    // The pair is the declaration: `allowRuntimeCreate: true` lets an
    // environment (an unmanaged copy among them) declare its own capability;
    // `allowEnvironmentOverlay: false` keeps it from re-declaring one a
    // package ships — a re-declaration could re-scope `org` ↔ `platform`.
    // Asserted together, because flipping the second with the first would
    // open the re-scoping door.
    expect(entry('capability')).toMatchObject({
      domain: 'security',
      supportsOverlay: false,
      allowEnvironmentOverlay: false,
      allowRuntimeCreate: true,
    });
  });

  it('loads before the permission sets that grant it', () => {
    // A set's `systemPermissions` names capabilities; resolving that against
    // rows that do not exist yet is the ordering bug this avoids.
    expect(entry('capability')!.loadOrder).toBeLessThan(entry('permission')!.loadOrder);
    expect(entry('capability')!.loadOrder).toBeLessThan(entry('position')!.loadOrder);
  });

  it('declares file patterns, so the loader finds a `*.capability.ts` file', () => {
    // The filesystem loader globs this list, and the CLI derives the file name
    // `objectstack generate` writes from it, so it is not decoration.
    expect(entry('capability')!.filePatterns[0]).toMatch(/\.capability\./);
  });

  it('the singular/plural mapping the rest of the platform already used still holds', () => {
    // #5870 added this; the registry entry is what it was always missing.
    // Both directions matter: `STATIC_REGISTRY_TYPES` / `RUNTIME_CREATE_ALLOWED_TYPES`
    // are built by walking the registry and adding `SINGULAR_TO_PLURAL[type]`,
    // so a missing reverse entry would leave `PUT /meta/capabilities/:name`
    // judged by a different rule than `PUT /meta/capability/:name`.
    expect(PLURAL_TO_SINGULAR.capabilities).toBe('capability');
    expect(SINGULAR_TO_PLURAL.capability).toBe('capabilities');
  });

  // ── the schema, now that something resolves it ────────────────────────

  it('accepts a well-formed declaration', () => {
    expect(getMetadataTypeSchema('capability')!.safeParse(DECLARATION).success).toBe(true);
  });

  it('accepts the ADR-0010 envelope the loader stamps on every registered type', () => {
    // `applyProtection` runs on every registered kind. Now that this schema is
    // strict, a body carrying the loader's own output must still parse — the
    // #4001 gap that was a hard 422 on `permission` and `position`.
    const stamped = { ...DECLARATION, _packageId: 'com.acme.billing', _provenance: 'package' };
    expect(getMetadataTypeSchema('capability')!.safeParse(stamped).success).toBe(true);
  });

  it('rejects a payload that is not a capability at all', () => {
    // The specimen the old behaviour stored verbatim into the authorization
    // namespace: arbitrary JSON under a capability name.
    const result = getMetadataTypeSchema('capability')!.safeParse({
      name: 'billing.refund',
      sql: 'DROP TABLE sys_capability',
      grantTo: ['*'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a name that is not a resolvable capability key', () => {
    // References resolve by exact string, so a name outside the key grammar
    // could never be matched by a grant — it would sit in the registry
    // unreachable.
    expect(getMetadataTypeSchema('capability')!.safeParse({ name: 'Billing Refund' }).success)
      .toBe(false);
  });

  it('names the surface and suggests the canonical key when an author mistypes one', () => {
    // The difference between a silent strip and a fixable error — the whole
    // point of closing the shape rather than merely registering it.
    const result = getMetadataTypeSchema('capability')!.safeParse({ ...DECLARATION, title: 'Refunds' });
    expect(result.success).toBe(false);
    const message = result.error!.issues.map((i) => i.message).join(' ');
    expect(message).toContain('this capability declaration');
    expect(message).toContain('label');
  });

  it('refuses the neighbouring concepts by name, not by edit distance', () => {
    // ADR-0066's three-way separation, enforced at the point an author would
    // collapse it: a capability never names its own holders or its own
    // requirements. `guidance` answers these with the layer they belong to.
    const result = getMetadataTypeSchema('capability')!
      .safeParse({ ...DECLARATION, permissionSets: ['admin_full_access'] });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.message).join(' ')).toContain('systemPermissions');
  });

  // ── the half of the ruling that is a refusal ──────────────────────────

  it('⛔ role / profile / policy are NOT admitted alongside it', () => {
    // #5961's ruling is explicit that these are a different question and do
    // not ride along: they have no `PLURAL_TO_SINGULAR` mapping, no
    // declaration schema and no read-back seam, so there is nothing to make
    // `declared = enforced` about. Pinned because "capability got an entry, so
    // should its neighbours" is the obvious next edit, and it would be wrong.
    for (const type of ['role', 'profile', 'policy']) {
      expect(MetadataTypeSchema.safeParse(type).success, `${type} must not be a kind`).toBe(false);
      expect(entry(type), `${type} must have no registry entry`).toBeUndefined();
      expect(getMetadataTypeSchema(type), `${type} must resolve no schema`).toBeUndefined();
    }
  });
});
