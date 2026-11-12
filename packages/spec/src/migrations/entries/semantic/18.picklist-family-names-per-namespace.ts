// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A narrowing of answers, not of any key: ADR-0150 D2/D9 (child B, #31700)
// hold a picklist, mapping, dataset, API and engine function name per
// namespace, so two packages of two namespaces may each hold one name, and a
// read that names no package can no longer be answered by the item registered
// last. No key is added, removed or re-shaped, so no tombstone and no D2
// conversion: which holder a reader meant is the author's judgement. One entry
// for the family, as the changeset declares it. No relevance question: the
// refusals turn on what two installed packages hold, which no question over
// one stack can name.
export const entry: SemanticMigration = {
  id: 'picklist-family-names-per-namespace',
  surface:
    'A picklist, mapping, dataset, API or engine function name that two packages of two namespaces hold: the '
    + 'metadata service\'s read and removal naming no package (MetadataManager get / unregister, GET and DELETE '
    + '/api/v1/meta/{picklist,mapping,dataset,api}/NAME), the engine\'s bare function read '
    + '(ObjectQL#resolveFunction, ObjectQL#resolveFunctionEntry), a picklistExtensions entry extending such a list, '
    + 'and an install, upgrade, hot reload or late item registration whose lists, extensions or field '
    + 'redeclarations would leave a picklist reference already installed with no one list',
  replacement:
    'Name the holder. On the REST door add ?package=<id> or use the qualified address '
    + '/api/v1/meta/:type/:ns/:name; in process pass packageId; read an engine function through the caller\'s '
    + 'package (ObjectQL#functionHoldersOf(name).packageItem(<id>)). A field or extension reaches one list when its '
    + 'package depends on exactly one holder. For an install refused because it would leave an installed '
    + 'reference with no one list: rename the list in the package being installed, or remove the reference or '
    + 'extension that names it first.',
  reason:
    'Before ADR-0150 child B a second package of another namespace was refused 422 NAMESPACE_CONFLICT at install, '
    + 'so a name had one package holder per deployment and a read naming no package answered that holder. Two '
    + 'namespaces\' packages may now each hold the name, and a reader with no package cannot pick one: the metadata '
    + 'service answers 409 RESOURCE_CONFLICT naming both holders where it answered or removed the item registered '
    + 'last, and the engine\'s bare function read answers 409 naming both where it answered the last '
    + 'registration (reachable on earlier releases only through direct ObjectQL#registerFunction under two package '
    + 'owners). A picklistExtensions entry extending a list two namespaces hold is refused 422 INVALID_METADATA at '
    + 'install and refuses the cold boot, naming the extension and both holders. An install, upgrade, hot reload or '
    + 'late registration that would leave an installed field or extension with no one list, or a field written by '
    + 'packages that reach different lists, is refused before anything of it registers, naming each reference and '
    + 'the holders. A name one package holds answers exactly as before. There is no mechanical rewrite: which '
    + 'holder a reader, a field or an extension meant is a judgement about that caller.',
  acceptanceCriteria:
    'For every picklist, mapping, dataset, API and function name the deployment\'s packages hold, list its holders '
    + '(GET /api/v1/meta/:type/:ns/:name per namespace, or the registry\'s packageScopedHoldersOf). Where two '
    + 'packages hold a name, every caller that reads it names the package (?package=, the qualified address, '
    + 'packageId), and GET /api/v1/meta/TYPE/NAME?package=<id> answers 200 with that holder\'s item for each holder. '
    + 'Each package installs and the server boots with no refusal naming a picklist reference or extension, and '
    + 'each select field bound to a shared list name is served its own package\'s options.',
};
