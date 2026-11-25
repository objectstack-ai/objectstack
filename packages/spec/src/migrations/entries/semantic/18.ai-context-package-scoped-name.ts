// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A narrowing of answers, not of any key: ADR-0150's addendum of 2026-11-25
// puts the context pack (`ai_context`) in bucket 3 beside `skill`, so a pack is
// identified by its package and its name, and `ai_context` joins the four
// package-scoped lists (PACKAGE_SCOPED_TYPES, PACKAGE_SCOPED_READ_TYPES,
// PACKAGE_SLOTTED_METADATA_TYPES, NAMESPACE_UNIQUE_TYPES). No key is added,
// removed or re-shaped, so no tombstone and no D2 conversion: which holder a
// caller meant is the caller's judgement. The stored row's package column is
// filled on the package's next save, or by the operator's re-runnable
// row-binding migration, which covers every slotted type. No relevance
// question: the refusals turn on what two installed packages hold, which no
// question over one stack can name.
export const entry: SemanticMigration = {
  id: 'ai-context-package-scoped-name',
  surface:
    'A context pack (metadata type ai_context) name that two packages hold: GET /api/v1/meta/ai_context/NAME '
    + 'with no package; the metadata service\'s in-process reads and removals of type ai_context by name with no '
    + 'package; get_record_context\'s context argument; a second package of one namespace that ships a pack name '
    + 'another package of that namespace already holds (install and os validate); a package-less ai_context row '
    + 'under a name a package ships; and a sys_metadata row of type ai_context that the database loader wrote '
    + 'before this release (package_id empty)',
  replacement:
    'Name the holder: over REST add ?package=ID to the by-name read; in process pass the package (packageId) to '
    + 'the metadata service; in get_record_context name a package\'s pack by its face NAMESPACE-NAME, as the '
    + 'refusals list it, and an environment pack by its bare name. Give a pack a name no other package of the '
    + 'same namespace uses. A legacy loader row binds to the package its body names on that package\'s next '
    + 'save, or at once through migrateDatabaseLoaderRowPackages from @objectstack/metadata/migrations, which is '
    + 'safe to run any number of times and leaves a row whose body names no package as it is.',
  reason:
    'Before this release a context pack was identified by its name alone: the metadata service kept one pack per '
    + 'name, GET /api/v1/meta/ai_context/NAME served the first match when two packages held the name, and '
    + 'get_record_context selected a pack by its bare name. Each package\'s pack now has its own (package, name) '
    + 'slot, so a caller naming no package cannot be answered one of them when two packages hold the name: the '
    + 'by-name read answers 409 RESOURCE_CONFLICT naming both holders, and get_record_context resolves a bare '
    + 'name as for a caller with no package (the environment\'s own pack, else the one package holder, else 409 '
    + 'RESOURCE_CONFLICT naming each candidate by its face). A second holder of a pack name inside one namespace '
    + 'is refused at install (409, the namespace name conflict) and by os validate. A package-less row under a '
    + 'name one package holds is that holder\'s customization and is not served (ADR-0150 D4 as ruled for skill). '
    + 'A name one package holds answers exactly as before. Measured when the change landed: no first-party '
    + 'package ships a pack name another package holds (the one declarer, examples/app-showcase, ships two packs '
    + 'of different names in one package), so 0 first-party installs, reads or rows are refused.',
  acceptanceCriteria:
    'For every context pack name the deployment\'s packages hold, list its holders (GET '
    + '/api/v1/meta/ai_context/NAME?package=ID answers 200 for each). Where two packages hold a name, every caller '
    + 'that reads the pack names the package, and every get_record_context call that names a pack uses its face. '
    + 'No two packages of one namespace ship a pack of one name (os validate is clean). After '
    + 'migrateDatabaseLoaderRowPackages, its result lists no ai_context row left as slot-taken or update-failed; '
    + 'a row left as package-less is the environment\'s own pack.',
};
