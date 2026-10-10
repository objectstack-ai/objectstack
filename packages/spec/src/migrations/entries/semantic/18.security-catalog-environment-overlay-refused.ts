// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// ADR-0048 addendum N.3 — a runtime narrowing at boot with no authorable key:
// a cold boot refuses an environment-wide permission-set or position row over a
// name a configured package holds. Registered because an upgrading deployment
// can carry such rows and must clear them before its first boot on this major,
// with the offline step that exists for that (the migration prescription the
// ruling on the step orders onto this change's note).
export const entry: SemanticMigration = {
  id: 'security-catalog-environment-overlay-refused',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'the cold boot of a deployment whose sys_metadata holds an active, environment-wide row of type '
    + 'permission or position (or the legacy plural permissions or positions) under the name of a '
    + 'permission set or position a configured package declares, the platform security plugin\'s '
    + 'shipped sets included',
  replacement:
    'before the first boot on this major, run `os migrate security-catalog-overlays` with the '
    + 'flags and environment the deployment boots with (`--preset` and `--dev` mean what they mean '
    + 'to `os serve`): it lists exactly those rows, each with the package '
    + 'that holds its name. Then run `os migrate security-catalog-overlays --apply` to delete them '
    + 'through the metadata write path (a history tombstone per row). Or rename the item in the '
    + 'package. Nothing is adopted: an item the environment needs under its own name is re-created '
    + 'under a name no package holds',
  reason:
    'Positions, permission sets and capabilities hold one name per deployment, and a package '
    + 'registering a name the environment catalog already holds was already refused on a hot '
    + 'install. A cold boot now refuses it too, right after the stored rows load: the stored row '
    + 'used to be served in place of the package\'s definition, with only a collision warning. '
    + 'Rows like this exist on deployments that saved over a package-held name before the packaged '
    + 'locks refused such saves, and over the security plugin\'s own sets, which it declares only '
    + 'where the boot composes it behind the auth gate (an auth secret set, or a development boot). '
    + 'The refused deployment cannot start, so no in-server action can clear the rows, and the '
    + 'metadata API reaches no legacy-plural row at all; the offline step can. No conversion '
    + 'applies: the rows are the environment\'s own work, and whether to drop or rename one is the '
    + 'operator\'s call, which the step\'s preview puts in front of them. ADR-0048, ADR-0087.',
  acceptanceCriteria:
    'On the deployment\'s database and configuration, with its boot flags and environment, '
    + '`os migrate security-catalog-overlays` lists no row (exit 0). The listing covers permission '
    + 'sets and positions and the legacy plural spellings, and never an organization-scoped or a '
    + 'draft row. After `--apply`, the next boot of the same database and configuration comes up, '
    + 'where before it was refused with NAMESPACE_CONFLICT (422) naming the environment catalog as '
    + 'the holder.',
};
