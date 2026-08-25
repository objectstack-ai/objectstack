// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SysMetadataActivation } from './sys-metadata-activation.object.js';
import { ACCOUNT_APP, SETUP_APP, SETUP_NAV_CONTRIBUTIONS, STUDIO_APP } from '../apps/index.js';

/**
 * ADR-0126 §4 — `sys_metadata_activation`, the packaged-metadata activation
 * ledger, pinned at its DECLARATION.
 *
 * This leg ships the object and nothing else: the enable/disable actions that
 * write it and the per-runtime consult points that read it are separate legs.
 * So the two things worth pinning here are the two things a later leg could
 * silently get wrong — the SHAPE the writers will target, and the claim that
 * shipping the shape alone changes no behavior.
 *
 * ## Why the column set is asserted by EQUALITY, not by membership
 *
 * ADR-0126 §4 says "that is the whole schema", and it says so because an
 * earlier draft carried designation columns (`replaced_by`, `cloned_from`)
 * that amendment ruling 2 removed — there is no recorded linkage between a
 * clone and its base. A membership check ("has `metadata_type`") passes just
 * as green on a table that has quietly regrown the linkage, which is the exact
 * drift the ruling forbids. Equality on the key set is what makes an added
 * column loud, so the whole set is asserted at once and the two removed names
 * are additionally called out by name below — a reader who deletes the
 * equality assertion still trips the named one.
 */
describe('sys_metadata_activation — the ADR-0126 §4 activation ledger', () => {
  describe('object identity', () => {
    it('uses the canonical sys_ short name', () => {
      expect(SysMetadataActivation.name).toBe('sys_metadata_activation');
    });

    it('is a system object, engine-owned (ADR-0103)', () => {
      expect(SysMetadataActivation.isSystem).toBe(true);
      expect(SysMetadataActivation.managedBy).toBe('engine-owned');
    });

    it('does not use deprecated storage identity fields', () => {
      expect((SysMetadataActivation as any).namespace).toBeUndefined();
      expect((SysMetadataActivation as any).tableName).toBeUndefined();
    });
  });

  describe('schema identity — the columns, by name', () => {
    const columns = Object.keys(SysMetadataActivation.fields ?? {}).sort();

    it('declares exactly the ADR-0126 §4 column set (plus the primary key)', () => {
      expect(columns).toEqual([
        'active',
        'id',
        'metadata_type',
        'name',
        'organization_id',
        'package_id',
      ]);
    });

    it('carries NO designation linkage — amendment ruling 2 removed it', () => {
      // 「行为类 能否搞一个启用停用的功能，我不想要可以停用，然后克隆一个。」
      // A clone is an ordinary org-owned artifact with no upgrade linkage back
      // to its base (the landed #11513 posture). Re-adding either column would
      // re-introduce the designation model this ADR decided against, so they
      // are named here rather than left to the set-equality above.
      expect(columns).not.toContain('replaced_by');
      expect(columns).not.toContain('cloned_from');
    });

    it('types each ADR column as §4 specifies', () => {
      const f = SysMetadataActivation.fields as Record<string, any>;
      expect(f.metadata_type.type).toBe('text');
      expect(f.name.type).toBe('text');
      expect(f.package_id.type).toBe('text');
      expect(f.active.type).toBe('boolean');
      // `organization_id` is the platform's organization column — a lookup to
      // sys_organization, the idiom every data-plane sibling uses
      // (`sys_metadata_history`, `sys_automation_run`). It materializes as a
      // string column, which is what §4's "string" names.
      expect(f.organization_id.type).toBe('lookup');
      expect(f.organization_id.reference).toBe('sys_organization');
    });

    it('leaves `organization_id` nullable — it is RESERVED on this line', () => {
      // §4: "nullable — reserved"; §5: the row is install-level. No writer in
      // any leg of this line sets it. A later `required: true` would be the
      // signal that the per-org dimension arrived without its own decision.
      expect((SysMetadataActivation.fields as any).organization_id.required).toBe(false);
    });
  });

  describe('row identity — one row per (metadata_type, name, organization_id NULL-collapsed)', () => {
    const uniqueIndexes = (SysMetadataActivation.indexes ?? []).filter((i: any) => i.unique);

    it('declares exactly one unique index, on (metadata_type, name)', () => {
      expect(uniqueIndexes).toHaveLength(1);
      expect((uniqueIndexes[0] as any).fields).toEqual(['metadata_type', 'name']);
    });

    it("spells the scope 'organization' — NOT bare `true`, and NOT a hand-written composite", () => {
      // ⛔ Asserted by EQUALITY, never by truthiness — bare `true` here IS a
      // bug and a truthy check passes on it. On a DECLARED index bare `true`
      // is the positional spelling of `'global'` (ADR-0120 D1): installation-
      // wide over exactly the listed columns, which would make the ledger
      // un-scopable the moment the reserved per-org dimension is used.
      expect((uniqueIndexes[0] as any).unique).toBe('organization');
      expect((uniqueIndexes[0] as any).unique).not.toBe(true);
    });

    it('does NOT name organization_id in the column list — that spelling is the NULL hole', () => {
      // This is the assertion that carries the "NULL-collapsed" half of §4.
      // A hand-written `['metadata_type', 'name', 'organization_id']` composite
      // is NULL-DISTINCT in SQL, and `organization_id` is NULL on every row
      // this line writes — so that spelling enforces NOTHING (#5030, measured),
      // and one artifact could carry two contradictory `active` rows.
      // `unique: 'organization'` is the arm that closes it: the driver prepends
      // `COALESCE(organization_id, '__global__')` at registration (ADR-0120 D3).
      expect((uniqueIndexes[0] as any).fields).not.toContain('organization_id');
    });
  });

  describe('an empty ledger changes nothing (the acceptance claim of this leg)', () => {
    it('ships no seed rows — nothing writes a row at install, so the ledger boots EMPTY', () => {
      // The declaration surface has no seeding mechanism at all (no
      // `defaultRecords`-style key exists on the object schema), so "empty on a
      // stock boot" follows from the object carrying no such key. Pinned so a
      // future seeding feature cannot quietly arrive here first.
      expect((SysMetadataActivation as any).defaultRecords).toBeUndefined();
      expect((SysMetadataActivation as any).records).toBeUndefined();
    });

    it('absence of a row means the packaged default — active', () => {
      // §4: "absence of a row means the packaged default — active". The column
      // default is the storage-side half of that sentence: a row written
      // without the flag is armed, so no writer can produce a row that reads
      // as "disabled" by omission.
      expect((SysMetadataActivation.fields as any).active.defaultValue).toBe(true);
    });

    it('declares NO lifecycle block — a row is durable configuration, never swept', () => {
      // The absent block is the back-compat `record` class. Its telemetry
      // siblings (`sys_flow_dispatch`, `sys_automation_run`) DO declare
      // retention; this one must not. Reaping a row here would silently re-arm
      // an artifact an administrator disabled — a data-loss bug wearing a
      // tuning knob's clothes.
      expect((SysMetadataActivation as any).lifecycle).toBeUndefined();
    });

    it('opens no generic write door — reads only, writes go through the engine', () => {
      // [ADR-0103] The enable/disable actions write under a system context.
      // Until they land there is no way to put a row in this table at all,
      // which is the strongest form of "changes nothing".
      expect(SysMetadataActivation.enable?.apiMethods).toEqual(['get', 'list']);
    });

    it('adds no UI surface — no list views, and no shipped app or nav names it', () => {
      // A stock boot renders the shipped apps and their nav contributions. If
      // none of them mentions the object, the ledger cannot change what an
      // administrator sees on a boot with no rows — the visible half of "no
      // behavior change". Serialized rather than walked so a nav shape change
      // cannot make this assertion quietly stop looking.
      expect((SysMetadataActivation as any).listViews).toBeUndefined();

      const shippedSurfaces = JSON.stringify([
        SETUP_APP,
        STUDIO_APP,
        ACCOUNT_APP,
        SETUP_NAV_CONTRIBUTIONS,
      ]);
      expect(shippedSurfaces).not.toContain('sys_metadata_activation');
    });
  });
});
