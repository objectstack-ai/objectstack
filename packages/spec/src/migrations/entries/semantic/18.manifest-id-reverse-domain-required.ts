// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A rename is the one thing this entry deliberately does NOT prescribe
// mechanically. An id is an IDENTITY: it is what the registry addresses the
// package by (`manifest_id`), what an installed row is keyed on, and what a
// dependent declares. Rewriting `com.acme.my_app` to `com.acme.my-app` on the
// author's behalf would silently make the artifact a DIFFERENT package from the
// one already installed somewhere — so this is a structured TODO the human
// answers, not a D2 conversion.
export const entry: SemanticMigration = {
  id: 'manifest-id-reverse-domain-required',
  surface: 'manifest.id — `ObjectStackManifest.id`, i.e. `defineStack({ manifest: { id } })` '
    + 'and the `id:` key of a package manifest — and its registry face '
    + '`PackageSchema.manifestId` (`marketplace/package.zod.ts`)',
  replacement: 'a reverse-domain identifier matching `MANIFEST_ID_PATTERN` '
    + '(`kernel/manifest.zod.ts`): dot-separated lowercase segments, each opening with a '
    + 'letter, digits and hyphens allowed inside a segment — `com.acme.crm`, '
    + '`org.apache.superset`. ⛔ Underscores are not admitted, so `manifest.namespace` is '
    + 'never a legal id and never a legal last segment of one: `com.acme.my_app` becomes '
    + '`com.acme.my-app`. A bare word gains a prefix: `blank` becomes `com.example.blank`. '
    + 'The refusal carries the repaired value it has already checked against the pattern, so '
    + 'the prescription is in the error text, not only here.',
  reason:
    'Two declarations named one identity and drifted. `PackageSchema.manifestId` — what the '
    + 'registry stores and addresses a package by — has always carried the reverse-domain '
    + 'regex; `ManifestSchema.id`, the key an author actually writes, was `z.string()` and '
    + 'accepted anything. So a package scaffolded, validated, built and booted with an id the '
    + 'publish path would refuse, and the author met the rule for the first time at the one '
    + 'moment it was most expensive to meet. The two sites now reference ONE exported '
    + 'constant, which is what makes a future divergence a visible edit rather than a silent '
    + 'one. Why the rule holds for a package nobody publishes: the TSDoc\'s own words are '
    + '"unique across the entire ecosystem" — an id names the artifact for the ecosystem it '
    + 'may one day join, so a private app is named under the same rule as a listed one. '
    + 'Why it is a D3 semantic TODO and not a D2 conversion: the value IS the identity. A '
    + 'mechanical rewrite would re-point every install, dependency declaration and stored '
    + '`manifest_id` row at a package that, to the registry, is a different one — and the '
    + 'safe choice between "rename the package" and "keep the id and change nothing that '
    + 'depends on it" is not derivable from the metadata.',
  acceptanceCriteria:
    'Every `manifest.id` you author matches the pattern, and `defineStack` / '
    + '`objectstack validate` report no `manifest.id` finding. Prove the rename side '
    + 'separately, because the schema cannot: for each id you changed, confirm nothing still '
    + 'addresses the old value — no installed row, no `dependencies` entry in another '
    + 'package\'s manifest, and no registry listing. If any does, the correct answer is a '
    + 'deliberate republish under the new id, not an in-place edit.',
};
