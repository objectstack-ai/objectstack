// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineStack } from '@objectstack/spec';

/**
 * `com.example.multi.orders` — a MODULE of the same artifact (ADR-0019 D2's
 * "internal contribution" tier: shipped inside an App, never browsed or
 * installed on its own).
 *
 * Two properties this fixture exists to hold, both load-bearing:
 *
 *  - It declares the **same namespace** as the App package. That is what
 *    ADR-0130 D1 buys: co-ownership of one namespace inside one artifact, so
 *    `crm_order` keeps its name instead of becoming `orders_order`.
 *  - Its served row carries **`writable: false`** — the server's OWN verdict
 *    (ADR-0070 D2 / ADR-0130 Consequences row 6). `isWritablePackage` reads
 *    `engine.manifests` FIRST, so a package booted from an artifact is
 *    read-only whatever its `scope` says.
 *
 * ⛔ This module is NOT a scope-less row, and no package of a compiled artifact
 * can be. It authors no `scope` key, but `defineStack` parses every `packages[]`
 * entry through `ManifestSchema` (`spec/src/stack.zod.ts`,
 * `ArtifactPackageEntrySchema`), whose `scope` is `.default('project')` — so
 * `dist/objectstack.json` and every served row carry `scope: 'project'`. A
 * genuinely scope-less row exists only where a manifest reaches the registry
 * WITHOUT that parse: a marketplace / offline-imported package (booted, hence
 * read-only) or a Studio-created base via `POST /api/v1/packages` (writable).
 * That discriminating pair is pinned in
 * `packages/runtime/src/domains/packages-writable-verdict.test.ts`, not here.
 *
 * `crm_order.account` looks up an object this package does NOT own. That is
 * legal and is the whole point of the split: cross-package lookups are accepted
 * (ADR-0130 §1.5), while a package's own app navigation pointing at a foreign
 * object is not — which is why the navigation lives with the App package.
 */
export default defineStack({
  manifest: {
    id: 'com.example.multi.orders',
    name: 'Multi-Package Orders',
    namespace: 'crm',
    version: '1.0.0',
    type: 'module',
    description: 'The Module half of a two-package release artifact (ADR-0130 D4)',
    engines: { protocol: '^17' },
    // The App package this module extends. `resolveArtifactPackageOrder` reads
    // it as the topological edge that registers core BEFORE orders (ADR-0130
    // D5, ADR-0116's one sorter) — the array order below is not what decides.
    dependencies: { 'com.example.multi.core': '^1.0.0' },
  },

  objects: [
    {
      name: 'crm_order',
      label: 'Order',
      pluralLabel: 'Orders',
      // ADR-0090 D1 — the org-wide default is an authored decision, never an
      // accident: the runtime fails closed to 'private', and a rule refuses the
      // silence rather than letting the fallback stand in for a choice.
      sharingModel: 'private',
      fields: {
        name: { name: 'name', type: 'text', label: 'Order Number', required: true },
        account: {
          name: 'account',
          type: 'lookup',
          label: 'Account',
          reference: 'crm_account',
        },
        amount: { name: 'amount', type: 'currency', label: 'Amount' },
      },
    },
  ],
});
