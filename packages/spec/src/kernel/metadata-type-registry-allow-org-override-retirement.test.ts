// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_METADATA_TYPE_REGISTRY,
  MetadataTypeRegistryEntrySchema,
} from './metadata-plugin.zod';
import { RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';

// ─── `MetadataTypeRegistryEntry.allowOrgOverride` → `allowEnvironmentOverlay` ──
//
// ADR-0131 C5's spec half. ADR-0131 D6 retired the per-organization overlay
// axis, so the registry flag that said "per-org" now decides one
// environment-scope question at every door — whether an environment may
// overlay an item a managed package ships — and is renamed to say that. Ruling
// C on the C5 split: no second key, and not the old name with a new meaning.
// The maintainer's ruling on the mechanism (Q1 A): a `retiredKey()` tombstone,
// the retired-keys entry and a D3 semantic entry, no D2 conversion — no
// manifest, stack or stored row can carry a registry entry. The wire field of
// `GET /meta/types` moves in the same landing (Q2 A); its pin is
// `packages/objectql/src/protocol-meta-types-rich.test.ts`.
//
// The four legs below, and why each exists:
//
//   1. The PARSE refuses the old key with the rename (the
//      `customizationPolicies` pin's shape: the issue code, the path naming
//      WHICH key, and the prescription text).
//   2. The REGISTRY: every row spells the new key, none spells the old one,
//      and the true set is exactly the five that opted in before the rename.
//   3. The REGISTRATION: the retired-keys entry is the exact string the
//      build's gate reads.
//   4. The READ-SIDE TRAP, tree-scoped. The tombstone fails `tsc` for every
//      WRITER of the old key, but a truthiness READER (`if (!e.allowOrgOverride)`,
//      a `filter`, a `toMatchObject`) still compiles — the tombstone's output
//      is an optional `undefined` — and reads `undefined`, which treats every
//      type as closed: measured as 403 `NOT_OVERRIDABLE` on all five types.
//      No type error, gate or consumer would say so. So this leg walks every
//      TypeScript source in the declared radius and refuses ANY code
//      reference to the old name — a comment or a string is a mention, not a
//      reference, and is left to the history it records. That leg reads
//      outside this package, so it lives in its own `repo`-project file:
//      `metadata-type-registry-allow-org-override-absence.test.ts`.
describe('MetadataTypeRegistryEntry.allowOrgOverride is renamed to allowEnvironmentOverlay', () => {
  const base = { type: 'view', label: 'View', filePatterns: ['**/*.view.ts'], domain: 'ui' } as const;

  it('REJECTS an authored `allowOrgOverride`, naming the key and carrying the rename', () => {
    const result = MetadataTypeRegistryEntrySchema.safeParse({ ...base, allowOrgOverride: true });

    expect(result.success).toBe(false);
    if (result.success) return; // narrowing; the assertion above already failed

    const issue = result.error.issues.find((i) => i.path[0] === 'allowOrgOverride');
    expect(issue, 'the refusal must name `allowOrgOverride`').toBeDefined();
    expect(issue!.code).toBe('invalid_type');
    expect(issue!.path).toEqual(['allowOrgOverride']);
    // The prescription IS the migration doc for whoever hits it.
    expect(issue!.message).toMatch(
      /`MetadataTypeRegistryEntry\.allowOrgOverride` was renamed to `allowEnvironmentOverlay` in @objectstack\/spec 17/s,
    );
    expect(issue!.message).toMatch(/Rename the key to `allowEnvironmentOverlay`; the value is unchanged/s);
    // `false` is refused exactly like `true`: the key is gone, not one value of it.
    expect(MetadataTypeRegistryEntrySchema.safeParse({ ...base, allowOrgOverride: false }).success).toBe(false);
  });

  it('parses the new key, defaults it to false, and grows no old key back', () => {
    const opted = MetadataTypeRegistryEntrySchema.parse({ ...base, allowEnvironmentOverlay: true });
    expect(opted.allowEnvironmentOverlay).toBe(true);
    expect(opted).not.toHaveProperty('allowOrgOverride');

    const defaulted = MetadataTypeRegistryEntrySchema.parse({ ...base });
    expect(defaulted.allowEnvironmentOverlay).toBe(false); // control: defaults still apply
    expect(defaulted).not.toHaveProperty('allowOrgOverride');
  });

  it('every built-in row spells the new key, none the old one, and the true set is the five', () => {
    const lacking = DEFAULT_METADATA_TYPE_REGISTRY
      .filter((e) => typeof e.allowEnvironmentOverlay !== 'boolean')
      .map((e) => e.type);
    expect(lacking, 'every row states the flag as a boolean').toEqual([]);
    const oldSpelling = DEFAULT_METADATA_TYPE_REGISTRY
      .filter((e) => Object.prototype.hasOwnProperty.call(e, 'allowOrgOverride'))
      .map((e) => e.type);
    expect(oldSpelling, 'no row carries the retired spelling').toEqual([]);
    // The values did not move with the name: exactly the five that opted in.
    expect(
      DEFAULT_METADATA_TYPE_REGISTRY.filter((e) => e.allowEnvironmentOverlay === true).map((e) => e.type).sort(),
    ).toEqual(['dashboard', 'email_template', 'report', 'translation', 'view']);
    // Control: the registry is the whole universe, not an empty array.
    expect(DEFAULT_METADATA_TYPE_REGISTRY.length).toBeGreaterThan(20);
  });

  it('is registered in RETIRED_KEYS_BY_MAJOR[18] under the exact surface spelling', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toContain('kernel/MetadataTypeRegistryEntry:allowOrgOverride');
    expect(RETIRED_KEYS_BY_MAJOR[18]).not.toContain('kernel/MetadataTypeRegistryEntry:allowEnvironmentOverlay');
  });
});
