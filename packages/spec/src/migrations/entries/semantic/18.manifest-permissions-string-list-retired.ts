// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0049 enforce-or-remove, ruled option A on the plugin-permissions parent
// card (2026-08-30): the legacy flat-list arm of a package manifest's
// `permissions` leaves, and the structured ADR-0025 §3.2 block is the only
// form. The list's deletion is mechanical (the D2 conversion
// `manifest-permissions-string-list-removed`); what each dropped string meant
// in terms of services, hooks, network hosts and filesystem paths is not, and
// that judgement is what this entry carries.
export const entry: SemanticMigration = {
  id: 'manifest-permissions-string-list-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a code span.
  surface:
    'manifest.permissions as a flat list of permission strings (and packages[].manifest.permissions) — '
    + 'the legacy arm of ManifestPermissionsSchema left; the schema is now the structured plugin '
    + 'permission block alone',
  replacement:
    'the structured block `permissions: { services, hooks, network, fs }` — each a list naming the '
    + 'platform services the plugin resolves, the lifecycle hooks it registers, the network hosts it '
    + 'reaches and the filesystem paths it touches; or no `permissions` key when the plugin needs none',
  reason:
    'ADR-0049 enforce-or-remove: the flat list was parsed and never acted on. The loader registers the '
    + 'consented grant set on the environment artifact with the permission enforcer, never the '
    + 'manifest\'s request, so a list granted, refused and requested nothing at load; the only code that '
    + 'met one was two reports saying it had been skipped. The D2 conversion '
    + '`manifest-permissions-string-list-removed` deletes the list from existing sources and stored '
    + 'artifacts, losslessly for every load. What it cannot do is translate: a capability string such as '
    + '`system.user.read` names no service, hook, host or path, so whether the plugin needs a grant at '
    + 'all, and which, is the author\'s judgement. Authoring now refuses a list at parse with that '
    + 'prescription, and TypeScript rejects it',
  acceptanceCriteria:
    'No manifest — the stack\'s own, any packages[] entry, any objectstack.plugin.json — declares '
    + '`permissions` as a list; a list is refused at parse with its prescription, and TypeScript rejects '
    + 'it. Every plugin whose dropped list stood for a real need declares it in the structured block, '
    + 'naming each service, hook, network host and filesystem path it touches, and `os plugin build` '
    + 'parses the manifest clean. A plugin that needs no grant declares no `permissions` key.',
  conversionIds: ['manifest-permissions-string-list-removed'],
};
