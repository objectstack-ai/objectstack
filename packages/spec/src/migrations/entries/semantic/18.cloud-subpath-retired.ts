// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'cloud-subpath-retired',
  surface:
    '`@objectstack/spec/cloud` — the whole published subpath (`packages/spec/src/cloud/`, '
    + '11 modules, 94 JSON-Schema defs): the cloud control plane\'s own contracts '
    + '(`environment.zod`, `environment-package.zod`, `tenant.zod`, `developer-portal.zod`, '
    + '`marketplace-admin.zod`, `app-store.zod` — 62 defs) and the package & marketplace '
    + 'format (`package.zod`, `package-version.zod`, `marketplace.zod`, `package-l10n`, '
    + '`template-manifest.zod` — 30 defs)',
  replacement:
    'Two answers, by owner. (1) The package & marketplace FORMAT moved unchanged to '
    + '`@objectstack/spec/marketplace` (`packages/spec/src/marketplace/`): rewrite the import '
    + 'path — `import { PackageSchema } from \'@objectstack/spec/cloud\'` becomes '
    + '`from \'@objectstack/spec/marketplace\'` — and nothing else; every def, key and JSON '
    + 'Schema is byte-identical under its new `$id` category (`RENAMED_DEFS`, 32 entries). '
    + '`EnvironmentType(Schema)` — the 7-member taxonomy the discovery fold table is total '
    + 'over — is re-declared in `@objectstack/spec/api` (`api/discovery.zod.ts`); the '
    + 'environment-artifact envelope was only ever a re-export and is imported from '
    + '`@objectstack/spec/system`. (2) The cloud control plane\'s contracts have NO '
    + 'open-source replacement: `environment.zod` and `tenant.zod` are re-declared in the '
    + 'cloud repo beside their producer (objectstack-ai/cloud#2037), and `developer-portal.zod`, '
    + '`marketplace-admin.zod`, `app-store.zod`, `environment-package.zod` are deleted outright — '
    + 'zero consumers in any repo (maintainer ruling on #16526, option A). Recoverable from git '
    + 'history at `d5d8d50db` if a declaration is ever wanted again; that is a new card in the '
    + 'cloud repo, not a re-import.',
  reason:
    'Maintainer direction (2026-09-06, verbatim, untranslated): 「我一直觉得 cloud 的协议应该放在云端，'
    + '没必要开源」; ruled option B "cut by owner" on #16325 (director batch #62, 2026-09-07, 「同意」). '
    + 'The control-plane schemas\' producer and every consumer live in the closed cloud repo — the '
    + 'open-source tree read exactly one type from them (`EnvironmentType`, for the discovery fold '
    + 'table). Leaving them published made the obvious-looking binding of `client.environments.*` '
    + 'to a camelCase `Environment` row compile and read `undefined` at runtime against a '
    + 'snake_case wire (#11925 / #12036); with the declarations gone the mis-binding is '
    + 'structurally impossible rather than warned about in a docblock. No alias and no '
    + 'deprecation window, per the standing 2026-08-27 ruling 「项目在创业阶段，用户也很少，短期不考虑渐进。」. '
    + 'Not losslessly convertible: an import path is TypeScript source, not a metadata document '
    + '`objectstack migrate meta` can rewrite.',
  acceptanceCriteria:
    'No code imports anything from `@objectstack/spec/cloud` — the specifier is not an `exports` '
    + 'key and every such import fails to resolve (TS2307) after upgrade. Package-format consumers '
    + 'resolve the same symbols from `@objectstack/spec/marketplace` (pinned by resolved symbol '
    + 'identity in `kernel/package-dependency-dual-source.test.ts` and '
    + '`system/environment-artifact.test.ts`). `api/discovery-environment-subset.pin.test.ts` '
    + 'still proves DiscoveryEnvironment ⊂ EnvironmentType against the re-declared enum. No '
    + 'metadata document needs editing: the 509 `cloud/*` authorable-surface baseline keys are '
    + 'discharged by the deletion gate\'s own proofs — 30 defs carried by declared rename, 62 by '
    + 'whole-def retirement (`RETIRED_DEFS_BY_MAJOR[18]`) — not by a tombstone an author could hit. '
    + '⚠️ Runtime behaviour is deliberately UNCHANGED: `os package publish`, the marketplace routes '
    + 'and the metadata plugin\'s artifact ingest parse byte-identically before and after.',
};
