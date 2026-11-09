// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `manifest-permissions-string-list-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `manifestPermissionsStringListRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { type Dict, isDict } from '../shared.js';

/**
 * A package manifest's `permissions` as a flat list of permission strings →
 * dropped (protocol 18 — ADR-0049 enforce-or-remove, ruled option A: retire
 * the legacy arm so the structured ADR-0025 §3.2 block is the only one).
 *
 * `ManifestPermissionsSchema` was a union of that list and the structured
 * `{ services, hooks, network, fs }` block. Nothing in this repository ever
 * acted on the list: the loader registers the CONSENTED grant set
 * (`grantedPermissions` on the environment artifact) with the permission
 * enforcer, never the manifest's request, and the only code that met a list
 * on a manifest was two drop reports saying it had been skipped. So the delete
 * changes no load, no grant and no refusal.
 *
 * ## Why a strip and not a rewrite
 *
 * A capability string (`system.user.read`) names no platform service, hook,
 * network host or filesystem path, and no table maps one onto the four lists —
 * inventing one would write grants nobody asked for into a consent request. So
 * the list is removed whole and the notice carries the strings it dropped
 * (`from`), which is what the author translates by hand; the schema's own
 * answer to a list says the same.
 *
 * ## Reach
 *
 * A manifest sits in two places a converted definition carries it: the stack's
 * own `manifest`, and each `packages[].manifest` of a multi-package artifact
 * (ADR-0130 D4). Only a list whose every member is a string is this entry's
 * surface — that is exactly what the retired arm accepted, so an array of
 * objects (a permission-set collection written one stage too early) is left as
 * stored for the schema to refuse, never deleted. `devPlugins[]` is not walked:
 * its entries are assembly instructions that may be live plugin objects, which
 * a copy-on-write spread would strip of their prototype.
 *
 * The top-level `permissions` key is the ADR-0090 permission-SET collection
 * and is never touched.
 *
 * ## Why `retiredFromLoadPath`
 *
 * The schema refuses the list with its prescription, so a live author is
 * taught the structured block rather than silently rewritten; the entry
 * exists so a stored artifact built while the list was legal replays clean at
 * the artifact door, and so `os migrate meta --from 17` lists the mechanical
 * edits for author sources. Deletion is idempotent by construction: a manifest
 * without the key is returned as is.
 */
const manifestPermissionsStringListRemoved: MetadataConversion = {
  id: 'manifest-permissions-string-list-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.7.0',
  surface: 'manifest.permissions',
  summary:
    "manifest 'permissions' as a flat list of permission strings removed (ADR-0049 — no loader ever read "
    + 'the list, so dropping it changes no grant; the structured { services, hooks, network, fs } block is '
    + 'the only form, and a permission string has no mechanical mapping onto it)',
  apply(stack, emit) {
    const stripList = (manifest: unknown, path: string): unknown => {
      if (!isDict(manifest)) return manifest;
      const list = manifest.permissions;
      if (!Array.isArray(list) || !list.every((entry) => typeof entry === 'string')) return manifest;
      const next: Dict = { ...manifest };
      delete next.permissions;
      emit({ from: `permissions: ${JSON.stringify(list)}`, to: '(removed)', path: `${path}.permissions` });
      return next;
    };

    let next = stack;
    const manifest = stripList(stack.manifest, 'manifest');
    if (manifest !== stack.manifest) next = { ...next, manifest };

    const packages = stack.packages;
    if (Array.isArray(packages)) {
      let touched = false;
      const nextPackages = packages.map((entry, i) => {
        if (!isDict(entry)) return entry;
        const converted = stripList(entry.manifest, `packages[${i}].manifest`);
        if (converted === entry.manifest) return entry;
        touched = true;
        return { ...entry, manifest: converted };
      });
      if (touched) next = { ...next, packages: nextPackages };
    }
    return next;
  },
  fixture: {
    before: {
      manifest: { id: 'com.acme.reports', permissions: ['system.user.read', 'system.data.write'] },
      packages: [
        { manifest: { id: 'com.acme.reports.export', permissions: ['system.object.read'] } },
        // The structured block is the canonical form and rides through
        // untouched — the strip dispatches on a list, never on the key.
        { manifest: { id: 'com.acme.reports.share', permissions: { services: ['object'] } } },
      ],
    },
    after: {
      manifest: { id: 'com.acme.reports' },
      packages: [
        { manifest: { id: 'com.acme.reports.export' } },
        { manifest: { id: 'com.acme.reports.share', permissions: { services: ['object'] } } },
      ],
    },
    // One per stripped list — the stack's own manifest and one package entry.
    expectedNotices: 2,
  },
};

export { manifestPermissionsStringListRemoved };
