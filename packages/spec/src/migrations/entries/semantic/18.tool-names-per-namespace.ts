// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// A narrowing of answers, not of any key: ADR-0150 D2/D9 (child B, #31985)
// hold a tool name per namespace, so two packages of two namespaces may each
// ship a tool of one name, and the metadata service stores a tool per
// (package, name). No key is added, removed or re-shaped, so no tombstone and
// no D2 conversion: which holder an in-process caller meant is the caller's
// judgement. The stored row's package column is filled on the package's next
// save, or by the operator's re-runnable row-binding migration; reads are
// right without it. No relevance question: the refusals turn on what two
// installed packages hold, which no question over one stack can name.
export const entry: SemanticMigration = {
  id: 'tool-names-per-namespace',
  surface:
    'A tool name that two packages of two namespaces hold, read or removed in process with no package: the '
    + 'metadata service\'s get, getDiagnosed, unregister, getHistory, diff and rollback for type tool, and '
    + 'DatabaseLoader.delete by name; a read naming a package that holds no slot of the name; and a sys_metadata '
    + 'row of type tool that the database loader wrote before this release (package_id empty)',
  replacement:
    'Name the holder: pass the package (get, getDiagnosed, getHistory, diff and rollback with packageId, '
    + 'unregister with packageId, or unregisterPackage for the whole package); over REST add ?package=ID or use '
    + 'the qualified address /api/v1/meta/tool/NS/NAME. A legacy loader row binds to the package its body names '
    + 'on that package\'s next save, or at once through migrateDatabaseLoaderRowPackages from '
    + '@objectstack/metadata/migrations, which is safe to run any number of times and leaves a row whose body '
    + 'names no package as it is.',
  reason:
    'Before this release a second package of another namespace was refused 422 NAMESPACE_CONFLICT at install, so '
    + 'a tool name had one package holder per deployment and the metadata service kept one tool per name. Two '
    + 'namespaces\' packages may now each hold the name, and the service keeps each package\'s tool in its own '
    + '(package, name) slot, so a caller naming no package cannot be answered one of them: the read, the removal, '
    + 'the history, the diff and the rollback answer 409 RESOURCE_CONFLICT naming both holders where they answered '
    + 'or removed the item registered or saved last, a read naming a package that holds no slot answers nothing, '
    + 'and a rollback to a version a removed package wrote is refused where it wrote that version into the '
    + 'remaining holder\'s row. The loader writes a row per (package, name) with package_id filled, where it wrote '
    + 'one row per name with the column empty. GET /api/v1/meta/tool/NAME already answered by (package, name) '
    + '(ADR-0150 D3) and is unchanged. A name one package holds answers exactly as before. Measured when the '
    + 'change landed: no first-party caller in this repository reads or removes a tool by name in process.',
  acceptanceCriteria:
    'For every tool name the deployment\'s packages hold, list its holders (GET /api/v1/meta/tool/NS/NAME per '
    + 'namespace). Where two packages hold a name, every in-process caller that reads, removes, diffs or rolls '
    + 'back the tool passes the package, and GET /api/v1/meta/tool/NAME?package=ID answers 200 with that holder\'s '
    + 'tool for each holder. After migrateDatabaseLoaderRowPackages, its result lists no tool row left as '
    + 'slot-taken or update-failed; a row left as package-less is the environment\'s own tool.',
};
