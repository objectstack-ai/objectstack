// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `declared-index-unique-scope` conversion (`toMajor:
// 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `declaredIndexUniqueScope` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { type Dict, isDict } from '../shared.js';

/**
 * A declared index's bare `unique: true` → `unique: 'global'` (protocol 18,
 * #5082 — ADR-0120 D2, the conversion half of D7's protocol-18 wave).
 *
 * ADR-0120 D1 made uniqueness scope an explicit vocabulary on both surfaces:
 * `'global'` (one holder across the whole installation — materialized over
 * exactly the listed `fields`) and `'organization'` (one holder per
 * organization — the driver prepends the NULL-safe organization key part at
 * registration). On a declared index, bare `true` was the one spelling whose
 * scope was encoded by POSITION: it set neither driver flag and materialized
 * verbatim, i.e. it meant `'global'`, while reading like "unique per
 * organization" to anyone who knew the field-level meaning (the #4986 trap).
 * 17.x warned (lint `unique/unscoped-declared-index`); protocol 18 refuses it
 * at the parse (`IndexSchema.unique`).
 *
 * **Lossless by construction — `'global'` IS what bare `true` built.** Every
 * driver resolves the two identically: `driver-sql`'s `normalizeDeclaredIndex`
 * takes both verbatim and names the index from the same boolean
 * (`isUniqueScopeDeclared`), the memory driver's declared-index constraint and
 * the Mongo/Turso index sync read the same truthiness. So the physical index is
 * byte-identical and schema drift sees nothing (ADR-0120 matrix invariant 2:
 * the S4/S5 corpus — the nine engine-owned idempotency/dedup keys among them —
 * keeps its expected-index output byte for byte; `driver-sql`'s
 * `sql-driver-unique-tenancy.test.ts` replays this conversion over that corpus
 * and asserts it).
 *
 * **Field-level `unique: true` is NOT converted** (ADR-0120 D1): there it has
 * one documented meaning — per organization — and stays valid indefinitely.
 * Only `indexes[]` entries are walked, on `objects[]` and on
 * `objectExtensions[]` (both embed `IndexSchema`). `false`, `'global'` and
 * `'organization'` pass through untouched, so the transform is idempotent:
 * a second pass finds no bare `true` left.
 *
 * **Retired from the load path** — the authoring funnel does NOT replay it, so
 * a live author meets `IndexSchema`'s refusal and its prescription (state
 * `'global'` or `'organization'`) instead of being converted silently: the
 * whole point of D1 is that the author STATES the scope. Data at rest has no
 * author to teach, so the stored-row seam (`applyConversionsToStoredItem`), the
 * artifact door inside its declared-floor window, and `os migrate meta --from
 * 17` all replay it — a `sys_metadata` row or a built artifact carrying the old
 * spelling converts to the index it always built, and never flags
 * `metadata_spec_invalid`.
 */
const declaredIndexUniqueScope: MetadataConversion = {
  id: 'declared-index-unique-scope',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'object.indexes[].unique / objectExtensions[].indexes[].unique',
  summary:
    "declared-index bare `unique: true` → `unique: 'global'` (ADR-0120 D2 — the scope is "
    + 'stated, never positional; `\'global\'` is exactly the index bare `true` built, so the '
    + 'physical index is byte-identical; field-level `unique: true` is not converted)',
  apply(stack, emit) {
    // `indexes` is an ARRAY one level down, so drill in and copy-on-write: an
    // owner whose indexes carry no bare `true` keeps its identity (pattern of
    // `object-index-type-partial-removed`).
    const respell = (owner: Dict, path: string): Dict => {
      const indexes = owner.indexes;
      if (!Array.isArray(indexes)) return owner;
      let changed = false;
      const next = indexes.map((idx, i) => {
        if (!isDict(idx) || idx.unique !== true) return idx;
        changed = true;
        emit({ from: 'true', to: 'global', path: `${path}.indexes[${i}].unique` });
        return { ...idx, unique: 'global' };
      });
      return changed ? { ...owner, indexes: next } : owner;
    };
    let out = mapCollection(stack, 'objects', respell);
    out = mapCollection(out, 'objectExtensions', respell);
    return out;
  },
  fixture: {
    before: {
      objects: [
        {
          // S4 — a platform-wide composite dedup key.
          name: 'http_delivery',
          label: 'HTTP Delivery',
          indexes: [
            { fields: ['source', 'dedup_key'], unique: true },
            // A non-unique index passes through untouched.
            { fields: ['status'] },
          ],
        },
        {
          // S5 — an engine idempotency key written by sudo (organization NULL).
          name: 'sys_notification',
          label: 'Notification',
          // Field-level bare `true` is per-organization and stays valid (D1).
          fields: { recipient_key: { type: 'text', unique: true } },
          indexes: [
            { name: 'idx_notification_dedup', fields: ['dedup_key'], unique: true },
            { fields: ['recipient_key', 'read'], unique: false },
          ],
        },
        {
          // Both stated scopes pass through untouched.
          name: 'crm_case',
          label: 'Case',
          indexes: [
            { fields: ['department', 'code'], unique: 'organization' },
            { fields: ['external_ref'], unique: 'global' },
          ],
        },
      ],
      objectExtensions: [
        {
          extend: 'crm_case',
          indexes: [{ fields: ['legacy_ref'], unique: true }],
        },
      ],
    },
    after: {
      objects: [
        {
          name: 'http_delivery',
          label: 'HTTP Delivery',
          indexes: [
            { fields: ['source', 'dedup_key'], unique: 'global' },
            { fields: ['status'] },
          ],
        },
        {
          name: 'sys_notification',
          label: 'Notification',
          fields: { recipient_key: { type: 'text', unique: true } },
          indexes: [
            { name: 'idx_notification_dedup', fields: ['dedup_key'], unique: 'global' },
            { fields: ['recipient_key', 'read'], unique: false },
          ],
        },
        {
          name: 'crm_case',
          label: 'Case',
          indexes: [
            { fields: ['department', 'code'], unique: 'organization' },
            { fields: ['external_ref'], unique: 'global' },
          ],
        },
      ],
      objectExtensions: [
        {
          extend: 'crm_case',
          indexes: [{ fields: ['legacy_ref'], unique: 'global' }],
        },
      ],
    },
    // Three notices: one per declared index carrying bare `true` (two on
    // objects, one on the extension). The field-level `true`, the `false`, the
    // two stated scopes and the non-unique index emit none.
    expectedNotices: 3,
  },
};

export { declaredIndexUniqueScope };
