// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { resolveInjectedSystemColumns } from '@objectstack/spec/data';
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
    });

    it('carries NO tenant column — this is deployment-level state, owned by no organization', () => {
      // ⚠️ This replaces a pin that asserted the OPPOSITE: the column used to
      // be declared here as "nullable — RESERVED", never written. A reserved
      // nullable tenant column is the shape the total-organization-ownership
      // record proposed in PR #14976 rules out, and a ledger row says "this
      // ENVIRONMENT switched this managed item off" — a fact no organization
      // owns. So the column is gone, and its absence is the contract.
      //
      // ⛔ Asserting only `fields` would be a phantom check. The tenant anchor
      // is INJECTED at registration, not authored: an object that merely omits
      // the field still gets the column. `resolveInjectedSystemColumns` is the
      // spec's derivation of which system columns an object actually carries —
      // the same one `applySystemFields` consumes to do the injecting — so it,
      // not the declaration, is the authority on whether the column exists.
      const plan = resolveInjectedSystemColumns(SysMetadataActivation);

      expect(plan.tenant).toBe(false);
      expect([...plan.names]).not.toContain('organization_id');
      expect(Object.keys(SysMetadataActivation.fields ?? {})).not.toContain('organization_id');

      // Anti-vacuity: the plan really does report columns for this object, so
      // a `names` set that is empty for some unrelated reason cannot make the
      // assertion above pass by saying nothing.
      expect([...plan.names]).toContain('id');
    });
  });

  describe('row identity — one row per (metadata_type, name)', () => {
    const uniqueIndexes = (SysMetadataActivation.indexes ?? []).filter((i: any) => i.unique);

    it('declares exactly one unique index, on (metadata_type, name)', () => {
      expect(uniqueIndexes).toHaveLength(1);
      expect((uniqueIndexes[0] as any).fields).toEqual(['metadata_type', 'name']);
    });

    it("states the scope as 'global' — NOT bare `true`, and NOT 'organization'", () => {
      // ⛔ Asserted by EQUALITY, never by truthiness — bare `true` here IS a
      // bug and a truthy check passes on it. On a DECLARED index bare `true`
      // is the positional spelling of `'global'` (ADR-0120 D1) with the scope
      // left unstated: same materialized shape, warned by lint
      // (`unique/unscoped-declared-index`) and rejected at protocol 18.
      //
      // `'organization'` was the spelling while the table carried a reserved
      // tenant column, and it is now wrong in a way nothing else would catch:
      // `normalizeDeclaredIndex` prepends the tenant key part only when the
      // table HAS a tenant column, so on this table it would silently degrade
      // to exactly these two columns — identical DDL, and a declaration
      // claiming a per-organization boundary that does not exist.
      expect((uniqueIndexes[0] as any).unique).toBe('global');
      expect((uniqueIndexes[0] as any).unique).not.toBe(true);
      expect((uniqueIndexes[0] as any).unique).not.toBe('organization');
    });

    it('names no tenant column in the column list — the two real key parts are the whole identity', () => {
      // Kept from the reserved-column era, where it carried the
      // "NULL-collapsed" half of §4: a hand-written composite ending in the
      // tenant column is NULL-DISTINCT in SQL, so with that column NULL on
      // every row it enforced NOTHING (#5030, measured) and one artifact could
      // carry two contradictory `active` rows. With no tenant column on the
      // table the hazard cannot recur — and this assertion is what makes a
      // re-added column loud here rather than silent.
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
