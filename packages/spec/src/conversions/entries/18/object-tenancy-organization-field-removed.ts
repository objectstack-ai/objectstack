// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `object-tenancy-organization-field-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `objectTenancyOrganizationFieldRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { stripKeys } from '../shared.js';

/**
 * `object.tenancy.organizationField` leaves the authorable surface (protocol
 * 18, #19054 — ADR-0049 enforce-or-remove; maintainer ruling 2026-09-18,
 * verbatim and untranslated: 「organizationField 撤出可授权面 同意你的建议」).
 *
 * The key named the column a platform row is STAMPED from, as opposed to the
 * column the object is WALLED by (`tenantField`). On an ordinary object those
 * are the same column — the spec's own docblock said "for ordinary objects the
 * two coincide and `organizationField` is never needed" — and the whole
 * repository declared it exactly once, on `sys_api_key`, a table this platform
 * ships. An authorable key whose only real declaration is ours makes every
 * future piece of organization logic ask "what if somebody set this?" for a
 * divergence no sanctioned consumer would honour: the cloud#1395 scope-pin
 * allows exactly three readers, all of them platform-row writers.
 *
 * The divergence itself is NOT retired — only its authorability. It moves to
 * `@objectstack/metadata-core`'s `PLATFORM_STAMP_ORGANIZATION_COLUMNS`
 * (`sys_api_key` → `active_organization_id`, read by the stamp face alone), so
 * the three writers keep their behaviour unchanged with no authorable input.
 *
 * **Retired from the load path** — the `tenancy` block is `.strict()` and
 * rejects the key with its prescription (`TENANCY_RETIRED_KEY_GUIDANCE`), so a
 * live author is taught at parse. This entry exists so stored 17.x rows replay
 * clean (`applyConversionsToStoredItem` — without it a pre-removal row flags
 * `metadata_spec_invalid` forever, mislabelling chain-owned history as a
 * current-contract violation) and so `os migrate meta --from 17` lists the
 * mechanical edits for existing sources.
 *
 * Deletion is the whole conversion, and it is behaviour-preserving in both
 * directions for everything outside this repository: an application that
 * declared the key was never read by anything (the three sanctioned consumers
 * are platform writers over platform tables), so dropping it changes no
 * stamp. A row on a platform object is unreachable from an authored stack —
 * `sys_api_key` is `managedBy: 'better-auth'` and protection-locked.
 */
const objectTenancyOrganizationFieldRemoved: MetadataConversion = {
  id: 'object-tenancy-organization-field-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.4.0',
  surface: 'object.tenancy.organizationField',
  summary:
    'object `tenancy.organizationField` removed (ADR-0049 — the stamp-only column '
    + 'declaration was authorable by every application and declared exactly once in the whole '
    + 'protocol, on the platform\'s own credential table; the divergence moves to a '
    + 'platform-internal table in @objectstack/metadata-core and stops being a knob)',
  apply(stack, emit) {
    return mapCollection(stack, 'objects', (obj, path) => {
      // `tenancy.*` sits one level down, so the top-level-only `stripKeys`
      // cannot reach it — drill in and copy-on-write, so an untouched object
      // keeps its identity (pattern of `object-enable-trash-mru-removed`).
      const tenancy = obj.tenancy;
      if (!tenancy || typeof tenancy !== 'object' || Array.isArray(tenancy)) return obj;
      const stripped = stripKeys(
        tenancy as Record<string, unknown>,
        ['organizationField'],
        emit,
        `${path}.tenancy`,
      );
      if (stripped === tenancy) return obj;
      return { ...obj, tenancy: stripped };
    });
  },
  fixture: {
    before: {
      objects: [
        {
          name: 'billing_api_credential',
          label: 'Billing API Credential',
          tenancy: { enabled: false, organizationField: 'active_organization_id' },
        },
        // The walled neighbour passes through untouched: `tenantField` is the
        // key that survives, and it answers the other question.
        {
          name: 'billing_invoice',
          label: 'Invoice',
          tenancy: { enabled: true, tenantField: 'workspace_id' },
        },
      ],
    },
    after: {
      objects: [
        {
          name: 'billing_api_credential',
          label: 'Billing API Credential',
          tenancy: { enabled: false },
        },
        {
          name: 'billing_invoice',
          label: 'Invoice',
          tenancy: { enabled: true, tenantField: 'workspace_id' },
        },
      ],
    },
    expectedNotices: 1,
  },
};

export { objectTenancyOrganizationFieldRemoved };
