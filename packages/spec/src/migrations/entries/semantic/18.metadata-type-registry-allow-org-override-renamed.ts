// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0131 C5's spec half. The registry flag and the wire field that projects
// it move together, in one landing (the maintainer's ruling: no dual spelling
// on the wire), so this one entry records both. The key's own retired-keys
// entry is `kernel/MetadataTypeRegistryEntry:allowOrgOverride`.
export const entry: SemanticMigration = {
  id: 'metadata-type-registry-allow-org-override-renamed',
  surface:
    'MetadataTypeRegistryEntry.allowOrgOverride (DEFAULT_METADATA_TYPE_REGISTRY, '
    + 'kernel/metadata-plugin.zod.ts) / the allowOrgOverride field of every entries[] item of the '
    + 'GET /api/v1/meta/types response (GetMetaTypesResponse, api/protocol.zod.ts)',
  replacement:
    '`allowEnvironmentOverlay` on both — rename the key in a registry entry and read the new '
    + 'field from `GET /api/v1/meta/types`; every value is unchanged (`true` on `view`, '
    + '`dashboard`, `report`, `translation` and `email_template`, `false` on every other built-in '
    + 'type), and `overrideSource` keeps its `registry` / `env` values and now names the new field',
  reason:
    'ADR-0131 D6 retired the per-organization overlay axis: an organization-scoped metadata '
    + 'write is refused and every metadata row is environment-wide. The flag kept its old name '
    + 'and so said "per-org" while it decided one environment-scope question at every door — '
    + 'whether an environment may overlay an item of the type that a managed package ships: the '
    + 'metadata protocol\'s save door, the managed-content seal on write and on the served read '
    + '(a stored environment overlay of a packaged item of a type without the flag is withheld), '
    + 'the repository put gate, and Studio\'s write gate through the wire field. Renamed to say '
    + 'that, as a hard rename: no second key, not the old name with a new meaning, and no window '
    + 'in which both spellings are accepted or served. Why no D2 conversion: no manifest, stack, '
    + 'plugin configuration or stored row can carry a type-registry entry (`contributes.kinds` is '
    + 'closed, `config.additionalTypes` is a tombstone, and the registry is the TypeScript literal '
    + '`DEFAULT_METADATA_TYPE_REGISTRY`), so a conversion would be a transform with no seam that '
    + 'ever runs; and a response field has no source a conversion could rewrite. What the '
    + 'consumer still owes is the READ side: a truthiness reader of the old key '
    + '(`if (!entry.allowOrgOverride)`, a filter, a partial-match assertion) still compiles '
    + 'against the tombstone and reads `undefined`, which treats every type as closed to '
    + 'environment overlays; and a client that declares its own type for the `/meta/types` '
    + 'response instead of importing `GetMetaTypesResponse` sees no compile error at all, and '
    + 'reads every type as locked. The value the wire carries is also unchanged in meaning: it '
    + 'is `true` when the registry grants the overlay OR when `OS_METADATA_WRITABLE` names the '
    + 'type (`overrideSource: env`), and the hatch opens only items no managed package ships, '
    + 'never a managed one.',
  acceptanceCriteria:
    'No registry entry, fixture or reader spells `allowOrgOverride`: writing it fails to compile '
    + '(its input type is `never`) and fails to parse with the rename prescription at path '
    + '`allowOrgOverride` (issue code `invalid_type`); every reader of the flag reads '
    + '`allowEnvironmentOverlay`. `GET /api/v1/meta/types` carries `allowEnvironmentOverlay` on '
    + 'every entry, a registry type and a registry-less runtime type alike, and no entry carries '
    + '`allowOrgOverride`. Behaviour is unchanged and must be verified as such: the five types '
    + 'that opted in still accept an environment overlay of a packaged item and still serve it, '
    + 'every other type still refuses one with 403 `NOT_OVERRIDABLE`, and Studio still opens '
    + 'exactly the same editors.',
};
