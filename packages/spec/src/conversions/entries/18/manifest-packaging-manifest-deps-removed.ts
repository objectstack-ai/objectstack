// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `manifest-packaging-manifest-deps-removed` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there. A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `manifestPackagingManifestDepsRemoved` and lists it where it stood.

import type { MetadataConversion } from '../../types.js';
import { type Dict, isDict } from '../shared.js';

/**
 * A plugin manifest's `packaging: 'manifest-deps'` → dropped (protocol 18 —
 * ADR-0025 v2 §3.3, maintainer decision Q6; ADR-0049 enforce-or-remove).
 *
 * `PluginPackagingSchema` was `bundled | manifest-deps`. The second member
 * existed on the build side only: `os plugin build` kept the `package.json`
 * dependencies out of the bundle and packed `package.json` + `pnpm-lock.yaml`
 * for an install-time resolution that nothing ever ran — `os plugin install`
 * and the boot-time loader import `dist/index.mjs` as packed — so an artifact
 * built with it could not load the dependencies it left out. The build forks
 * are gone, `bundled` is the one strategy, and an absent key means the same.
 *
 * ## Why a strip and not a rewrite to `bundled`
 *
 * The key is optional with no default, and `bundled` is what the build does
 * with or without it, so the delete is lossless and leaves no new authored
 * value behind; writing `bundled` in would author a key the author never
 * chose.
 *
 * ## Reach
 *
 * The manifest sits in two places a converted definition carries it, as for
 * `manifest-permissions-string-list-removed` below: the stack's own
 * `manifest`, and each `packages[].manifest` of a multi-package artifact
 * (ADR-0130 D4). Only the exact retired string is this entry's surface; a
 * live `bundled` or any other value is left for the schema to judge.
 * `devPlugins[]` is not walked (its entries may be live plugin objects).
 * `objectstack.plugin.json`, the plugin project's own manifest, is no stack
 * source: `os plugin build` parses it straight through `ManifestSchema`,
 * whose refusal carries the prescription.
 *
 * ## Why `retiredFromLoadPath`
 *
 * The schema refuses the value with its prescription, so a live author is
 * taught rather than silently rewritten; the entry exists so a stored
 * artifact built while the value was legal replays clean at the artifact
 * door, and so `os migrate meta --from 17` lists the mechanical edit for
 * author sources. Deletion is idempotent by construction: a manifest without
 * the value is returned as is.
 */
const manifestPackagingManifestDepsRemoved: MetadataConversion = {
  id: 'manifest-packaging-manifest-deps-removed',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '18.2.0',
  surface: 'manifest.packaging',
  summary:
    "manifest 'packaging: manifest-deps' removed (ADR-0025 v2 §3.3, ADR-0049 — nothing ever installed the "
    + "dependencies it left out of the bundle; 'bundled' is the only strategy and the default, so the key is "
    + 'deleted)',
  apply(stack, emit) {
    const stripValue = (manifest: unknown, path: string): unknown => {
      if (!isDict(manifest) || manifest.packaging !== 'manifest-deps') return manifest;
      const next: Dict = { ...manifest };
      delete next.packaging;
      emit({ from: 'manifest-deps', to: '(removed)', path: `${path}.packaging` });
      return next;
    };

    let next = stack;
    const manifest = stripValue(stack.manifest, 'manifest');
    if (manifest !== stack.manifest) next = { ...next, manifest };

    const packages = stack.packages;
    if (Array.isArray(packages)) {
      let touched = false;
      const nextPackages = packages.map((entry, i) => {
        if (!isDict(entry)) return entry;
        const converted = stripValue(entry.manifest, `packages[${i}].manifest`);
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
      manifest: { id: 'com.acme.stripe', packaging: 'manifest-deps', runtime: 'node' },
      packages: [
        { manifest: { id: 'com.acme.stripe.webhooks', packaging: 'manifest-deps' } },
        // The live value rides through untouched — the strip dispatches on
        // the retired string, never on the key.
        { manifest: { id: 'com.acme.stripe.billing', packaging: 'bundled' } },
      ],
    },
    after: {
      manifest: { id: 'com.acme.stripe', runtime: 'node' },
      packages: [
        { manifest: { id: 'com.acme.stripe.webhooks' } },
        { manifest: { id: 'com.acme.stripe.billing', packaging: 'bundled' } },
      ],
    },
    // One per stripped value — the stack's own manifest and one package entry.
    expectedNotices: 2,
  },
};

export { manifestPackagingManifestDepsRemoved };
